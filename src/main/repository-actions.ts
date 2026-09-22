import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  askPassPath,
  markRepositorySynced,
  readCloneRecords,
  refreshedCredentials,
  verifiedClonePath,
} from './github-repositories'
import { getDatabase } from './database'
import { readRepositoryStatus, refreshRepositoryStatus } from './repository-monitor'
import type {
  RepositoryChangedFile,
  RepositoryCommit,
  RepositoryCommitFile,
  RepositoryFileRevision,
  RepositoryFilePreview,
  RepositoryChangeAnalytics,
  RepositoryChangeCommit,
  RepositoryAnalyticsRange,
  RepositoryWorkingTreeFile,
  RepositoryWorkingFile,
  RepositoryWorkingFileWriteInput,
  RepositoryBranch,
  RepositoryBranchState,
  RepositoryCheckoutStrategy,
  RepositoryCheckoutTarget,
  RepositoryGitDetails,
  RepositoryOperationKind,
  RepositoryOperationState,
  RepositoryMergeMode,
  RepositoryMergePreview,
  RepositoryConflictResolutionInput,
  RepositoryConflictVersions,
  RepositoryOperationAction,
  RepositoryPullOptions,
  RepositoryRebasePlanItem,
  RepositoryRebasePreview,
} from '../shared/desktop-api'

interface GitRunOptions {
  env?: NodeJS.ProcessEnv
  outputLimit?: number
  timeoutMs?: number
  successCodes?: number[]
}

interface GitHubCommitIdentityResponse {
  sha: string
  author: { login: string; avatar_url: string; html_url: string } | null
  committer: { login: string; avatar_url: string; html_url: string } | null
}

interface CommitIdentity {
  login: string
  avatarUrl: string
  profileUrl: string
}

const commitIdentityCache = new Map<string, {
  expiresAt: number
  identities: Map<string, CommitIdentity>
}>()

const runGit = async (
  repositoryPath: string,
  args: string[],
  options: GitRunOptions = {},
): Promise<string> => await new Promise((resolvePromise, reject) => {
  const git = spawn('git', ['-C', repositoryPath, ...args], {
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...options.env },
  })
  const outputLimit = options.outputLimit ?? 2_000_000
  let stdout = ''
  let stderr = ''
  let outputTooLarge = false
  const timer = setTimeout(() => {
    git.kill()
    reject(new Error('The Git operation timed out.'))
  }, options.timeoutMs ?? 30_000)

  git.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
    if (stdout.length > outputLimit) {
      outputTooLarge = true
      git.kill()
    }
  })
  git.stderr.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-30_000)
  })
  git.once('error', (error) => {
    clearTimeout(timer)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      reject(new Error('Git is not installed or is not available in PATH.'))
    } else reject(error)
  })
  git.once('close', (code) => {
    clearTimeout(timer)
    if (outputTooLarge) reject(new Error('The Git output is too large to display.'))
    else if ((options.successCodes ?? [0]).includes(code ?? -1)) resolvePromise(stdout)
    else reject(new Error(stderr.trim() || stdout.trim() || `Git exited with code ${code ?? 'unknown'}.`))
  })
})

const runGitBuffer = async (
  repositoryPath: string,
  args: string[],
  outputLimit = 5_500_000,
): Promise<Buffer> => await new Promise((resolvePromise, reject) => {
  const git = spawn('git', ['-C', repositoryPath, ...args], {
    shell: false,
    windowsHide: true,
    env: process.env,
  })
  const chunks: Buffer[] = []
  let length = 0
  let stderr = ''
  let outputTooLarge = false
  const timer = setTimeout(() => {
    git.kill()
    reject(new Error('The Git operation timed out.'))
  }, 30_000)
  git.stdout.on('data', (chunk: Buffer) => {
    length += chunk.length
    if (length > outputLimit) {
      outputTooLarge = true
      git.kill()
    } else chunks.push(chunk)
  })
  git.stderr.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-30_000)
  })
  git.once('error', (error) => {
    clearTimeout(timer)
    reject(error)
  })
  git.once('close', (code) => {
    clearTimeout(timer)
    if (outputTooLarge) reject(new Error('The Git object is too large to display.'))
    else if (code === 0) resolvePromise(Buffer.concat(chunks))
    else reject(new Error(stderr.trim() || `Git exited with code ${code ?? 'unknown'}.`))
  })
})

const changedFiles = async (repositoryPath: string): Promise<RepositoryChangedFile[]> => {
  const output = await runGit(
    repositoryPath,
    ['status', '--porcelain=v1', '-z', '--untracked-files=normal'],
  )
  const records = output.split('\0')
  const files: RepositoryChangedFile[] = []
  const conflictStates = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.length < 4) continue
    const state = record.slice(0, 2)
    const indexStatus = state[0]
    const worktreeStatus = state[1]
    const untracked = state === '??'
    const path = record.slice(3)

    files.push({
      path,
      indexStatus,
      worktreeStatus,
      staged: !untracked && indexStatus !== ' ' && indexStatus !== '?',
      unstaged: !untracked && worktreeStatus !== ' ' && worktreeStatus !== '?',
      untracked,
      conflicted: conflictStates.has(state),
    })

    if (indexStatus === 'R' || indexStatus === 'C') index += 1
  }

  return files
}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const readPositiveInteger = async (path: string): Promise<number | null> => {
  try {
    const value = Number((await readFile(path, 'utf8')).trim())
    return Number.isInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

const repositoryOperationState = async (
  repositoryPath: string,
  files?: RepositoryChangedFile[],
): Promise<RepositoryOperationState> => {
  const names = [
    'rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD',
    'REVERT_HEAD', 'BISECT_LOG',
  ] as const
  const gitDirectory = (await runGit(repositoryPath, [
    'rev-parse', '--path-format=absolute', '--git-dir',
  ])).trim()
  const paths = Object.fromEntries(names.map((name) => [
    name,
    resolve(gitDirectory, name),
  ])) as Record<(typeof names)[number], string>
  const present = Object.fromEntries(await Promise.all(names.map(async (name) => [
    name,
    await pathExists(paths[name]),
  ]))) as Record<(typeof names)[number], boolean>

  let kind: RepositoryOperationKind = 'none'
  if (present['rebase-merge']) kind = 'rebase'
  else if (present['rebase-apply']) {
    kind = await pathExists(resolve(paths['rebase-apply'], 'applying')) ? 'am' : 'rebase'
  } else if (present.MERGE_HEAD) kind = 'merge'
  else if (present.CHERRY_PICK_HEAD) kind = 'cherry-pick'
  else if (present.REVERT_HEAD) kind = 'revert'
  else if (present.BISECT_LOG) kind = 'bisect'

  const operationFiles = files ?? (kind === 'none' ? [] : await changedFiles(repositoryPath))
  const conflictedFiles = operationFiles
    .filter((file) => file.conflicted)
    .map((file) => file.path)
  const rebaseDirectory = present['rebase-merge'] ? paths['rebase-merge']
    : present['rebase-apply'] ? paths['rebase-apply'] : null
  const currentStep = rebaseDirectory
    ? await readPositiveInteger(resolve(rebaseDirectory, present['rebase-merge'] ? 'msgnum' : 'next'))
    : null
  const totalSteps = rebaseDirectory
    ? await readPositiveInteger(resolve(rebaseDirectory, present['rebase-merge'] ? 'end' : 'last'))
    : null
  let originalHead: string | null = null
  if (kind !== 'none') {
    const value = (await runGit(repositoryPath, ['rev-parse', '--verify', 'ORIG_HEAD'], {
      successCodes: [0, 128],
    })).trim()
    originalHead = /^[a-f0-9]{40,64}$/i.test(value) ? value : null
  }

  return {
    kind,
    conflictedFiles,
    canContinue: kind !== 'none' && kind !== 'bisect' && conflictedFiles.length === 0,
    canSkip: kind === 'rebase' || kind === 'cherry-pick' || kind === 'revert' || kind === 'am',
    canAbort: kind !== 'none',
    currentStep,
    totalSteps,
    originalHead,
  }
}

const assertNoGitOperation = async (repositoryPath: string, action: string): Promise<void> => {
  const operation = await repositoryOperationState(repositoryPath)
  if (operation.kind !== 'none') {
    throw new Error(`Cannot ${action} while a ${operation.kind} operation is in progress.`)
  }
}

const createRecoveryRef = async (repositoryPath: string, label: string): Promise<string> => {
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  const reference = `refs/myrepos/recovery/${Date.now()}-${safeLabel || 'operation'}`
  await runGit(repositoryPath, ['update-ref', reference, 'HEAD'])
  return reference
}

const mergeTarget = async (
  repositoryPath: string,
  targetRef: unknown,
): Promise<{ state: RepositoryBranchState; target: RepositoryBranch }> => {
  if (typeof targetRef !== 'string' || targetRef.length === 0 || targetRef.length > 1_000) {
    throw new Error('Choose a valid branch to merge.')
  }
  const state = await repositoryBranchState(repositoryPath)
  if (!state.currentBranch) throw new Error('Create or checkout a branch before merging.')
  const target = state.branches.find((branch) => branch.ref === targetRef)
  if (!target) throw new Error('The selected merge branch no longer exists.')
  if (target.current) throw new Error('The selected branch is already checked out.')
  return { state, target }
}

const mergePreview = async (
  repositoryPath: string,
  targetRef: unknown,
): Promise<RepositoryMergePreview> => {
  await assertNoGitOperation(repositoryPath, 'preview a merge')
  const { state, target } = await mergeTarget(repositoryPath, targetRef)
  const [aheadText, behindText, filesText] = await Promise.all([
    runGit(repositoryPath, ['rev-list', '--count', `${target.ref}..HEAD`]),
    runGit(repositoryPath, ['rev-list', '--count', `HEAD..${target.ref}`]),
    runGit(repositoryPath, ['diff', '--name-only', '-z', `HEAD...${target.ref}`]),
  ])
  const ahead = Number(aheadText.trim())
  const behind = Number(behindText.trim())
  const files = filesText.split('\0').filter(Boolean)
  return {
    currentBranch: state.currentBranch!,
    target,
    outcome: behind === 0 ? 'already-merged' : ahead === 0 ? 'fast-forward' : 'merge-commit',
    commitCount: Number.isFinite(behind) ? behind : 0,
    fileCount: files.length,
    files: files.slice(0, 100),
  }
}

const mergeBranch = async (
  repositoryPath: string,
  targetRef: unknown,
  mode: unknown,
): Promise<RepositoryGitDetails> => {
  await assertNoGitOperation(repositoryPath, 'merge branches')
  if (mode !== 'auto' && mode !== 'no-ff') throw new Error('Choose a valid merge mode.')
  const selectedMode: RepositoryMergeMode = mode
  const { target } = await mergeTarget(repositoryPath, targetRef)
  const dirty = (await runGit(repositoryPath, [
    'status', '--porcelain=v1', '--untracked-files=normal',
  ])).trim()
  if (dirty) throw new Error('Commit, stash, or discard local changes before merging.')

  try {
    await runGit(repositoryPath, [
      'merge',
      ...(selectedMode === 'no-ff' ? ['--no-ff'] : ['--ff']),
      '--no-edit',
      target.ref,
    ], { timeoutMs: 120_000 })
  } catch (error) {
    const operation = await repositoryOperationState(repositoryPath)
    if (operation.kind === 'merge' && operation.conflictedFiles.length > 0) {
      return await refreshedDetails(repositoryPath)
    }
    throw error
  }
  return await refreshedDetails(repositoryPath)
}

const rebaseBranch = async (
  repositoryPath: string,
  targetRef: unknown,
  autoStashValue: unknown,
): Promise<RepositoryGitDetails> => {
  await assertNoGitOperation(repositoryPath, 'rebase')
  if (typeof autoStashValue !== 'boolean') throw new Error('Choose a valid auto-stash option.')
  const { target } = await mergeTarget(repositoryPath, targetRef)
  const dirty = Boolean((await runGit(repositoryPath, [
    'status', '--porcelain=v1', '--untracked-files=normal',
  ])).trim())
  if (dirty && !autoStashValue) {
    throw new Error('Commit or stash local changes, or enable auto-stash before rebasing.')
  }
  await createRecoveryRef(repositoryPath, `rebase-${target.name}`)
  try {
    await runGit(repositoryPath, [
      'rebase',
      ...(autoStashValue ? ['--autostash'] : []),
      target.ref,
    ], {
      env: { ...process.env, GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':' },
      timeoutMs: 120_000,
    })
  } catch (error) {
    const operation = await repositoryOperationState(repositoryPath)
    if (operation.kind === 'rebase') return await refreshedDetails(repositoryPath)
    throw error
  }
  return await refreshedDetails(repositoryPath)
}

const interactiveRebasePreview = async (
  repositoryPath: string,
  targetRef: unknown,
): Promise<RepositoryRebasePreview> => {
  await assertNoGitOperation(repositoryPath, 'preview an interactive rebase')
  const { state, target } = await mergeTarget(repositoryPath, targetRef)
  const output = await runGit(repositoryPath, [
    'log', '--reverse', '--format=%H%x00%h%x00%s%x1e', `${target.ref}..HEAD`,
  ])
  const items = output.split('\x1e').flatMap((record): RepositoryRebasePlanItem[] => {
    const [hash, shortHash, subject] = record.replace(/^\r?\n|\r?\n$/g, '').split('\0')
    return hash && shortHash ? [{
      action: 'pick',
      hash,
      shortHash,
      subject: subject ?? '',
    }] : []
  })
  let publishedCount = 0
  try {
    await runGit(repositoryPath, ['rev-parse', '--verify', '@{upstream}'])
    const unpushed = new Set((await runGit(repositoryPath, [
      'rev-list', '@{upstream}..HEAD',
    ])).split(/\r?\n/).filter(Boolean))
    publishedCount = items.filter((item) => !unpushed.has(item.hash)).length
  } catch {
    // A branch without an upstream has no known published commits.
  }
  return { currentBranch: state.currentBranch!, target, items, publishedCount }
}

const sequenceEditorPath = async (): Promise<string> => {
  const directory = join(app.getPath('userData'), 'git-helpers')
  await mkdir(directory, { recursive: true })
  const helper = join(directory, 'rebase-sequence-editor.cjs')
  await writeFile(helper, [
    "const fs = require('node:fs')",
    "const target = process.argv[2]",
    "if (!target) process.exit(2)",
    "fs.writeFileSync(target, Buffer.from(process.env.MYREPOS_REBASE_TODO || '', 'base64'))",
    '',
  ].join('\n'), 'utf8')
  return helper
}

const interactiveRebase = async (
  repositoryPath: string,
  targetRef: unknown,
  planValue: unknown,
  autoStashValue: unknown,
): Promise<RepositoryGitDetails> => {
  await assertNoGitOperation(repositoryPath, 'start an interactive rebase')
  if (!Array.isArray(planValue) || planValue.length === 0 || planValue.length > 200 ||
    typeof autoStashValue !== 'boolean') throw new Error('Choose a valid rebase plan.')
  const preview = await interactiveRebasePreview(repositoryPath, targetRef)
  const expected = new Set(preview.items.map((item) => item.hash))
  const plan = planValue as Array<Partial<RepositoryRebasePlanItem>>
  if (plan.some((item) =>
    !item.hash || !expected.has(item.hash) ||
    !['pick', 'squash', 'fixup', 'drop'].includes(item.action ?? '')) ||
    new Set(plan.map((item) => item.hash)).size !== expected.size ||
    plan.length !== expected.size) throw new Error('The rebase plan no longer matches this branch.')
  const firstRetained = plan.find((item) => item.action !== 'drop')
  if (firstRetained?.action === 'squash' || firstRetained?.action === 'fixup') {
    throw new Error('The first retained commit must use Pick.')
  }
  const dirty = Boolean((await runGit(repositoryPath, [
    'status', '--porcelain=v1', '--untracked-files=normal',
  ])).trim())
  if (dirty && !autoStashValue) {
    throw new Error('Commit or stash local changes, or enable auto-stash before rebasing.')
  }
  await createRecoveryRef(repositoryPath, 'interactive-rebase')
  const helper = await sequenceEditorPath()
  const todo = plan.map((item) => `${item.action} ${item.hash} ${item.subject ?? ''}`).join('\n') + '\n'
  const editorCommand = `"${process.execPath.replaceAll('"', '\\"')}" "${helper.replaceAll('"', '\\"')}"`
  try {
    await runGit(repositoryPath, [
      'rebase', '-i',
      ...(autoStashValue ? ['--autostash'] : []),
      preview.target.ref,
    ], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        GIT_SEQUENCE_EDITOR: editorCommand,
        GIT_EDITOR: ':',
        MYREPOS_REBASE_TODO: Buffer.from(todo, 'utf8').toString('base64'),
      },
      timeoutMs: 120_000,
    })
  } catch (error) {
    const operation = await repositoryOperationState(repositoryPath)
    if (operation.kind === 'rebase') return await refreshedDetails(repositoryPath)
    throw error
  }
  return await refreshedDetails(repositoryPath)
}

const pullRepository = async (
  repositoryPath: string,
  optionsValue: unknown,
): Promise<RepositoryGitDetails> => {
  await assertNoGitOperation(repositoryPath, 'pull')
  const candidate = optionsValue && typeof optionsValue === 'object'
    ? optionsValue as Partial<RepositoryPullOptions>
    : { strategy: 'ff-only', autoStash: false }
  if (!['ff-only', 'merge', 'rebase'].includes(candidate.strategy ?? '') ||
    typeof candidate.autoStash !== 'boolean') {
    throw new Error('Choose valid pull options.')
  }
  const options = candidate as RepositoryPullOptions
  const dirty = Boolean((await runGit(repositoryPath, [
    'status', '--porcelain=v1', '--untracked-files=normal',
  ])).trim())
  if (dirty && !options.autoStash && options.strategy !== 'ff-only') {
    throw new Error('Commit or stash local changes, or enable auto-stash before pulling.')
  }
  const env = await authenticatedEnvironment(repositoryPath)
  await runGit(repositoryPath, ['-c', 'credential.helper=', 'fetch', '--prune', 'origin'], {
    env,
    timeoutMs: 120_000,
  })
  await runGit(repositoryPath, ['rev-parse', '--verify', '@{upstream}'])
  if (options.strategy !== 'ff-only') await createRecoveryRef(repositoryPath, `pull-${options.strategy}`)
  const command = options.strategy === 'rebase'
    ? ['rebase', ...(options.autoStash ? ['--autostash'] : []), '@{upstream}']
    : ['merge',
        ...(options.strategy === 'ff-only' ? ['--ff-only'] : ['--no-edit']),
        ...(options.autoStash ? ['--autostash'] : []),
        '@{upstream}']
  try {
    await runGit(repositoryPath, command, {
      env: { ...env, GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':' },
      timeoutMs: 120_000,
    })
  } catch (error) {
    const operation = await repositoryOperationState(repositoryPath)
    if (operation.kind !== 'none') return await refreshedDetails(repositoryPath)
    throw error
  }
  const details = await refreshedDetails(repositoryPath)
  if (details.status.clean && details.status.ahead === 0 && details.status.behind === 0) {
    await markRepositorySynced(repositoryPath)
  }
  return details
}

const conflictVersions = async (
  repositoryPath: string,
  fileValue: unknown,
): Promise<RepositoryConflictVersions> => {
  const file = validatedFile(fileValue)
  const details = await repositoryDetails(repositoryPath)
  const changed = details.files.find((item) => item.path === file && item.conflicted)
  if (!changed) throw new Error('This file is no longer conflicted.')
  const unmerged = await runGit(repositoryPath, ['ls-files', '-u', '-z', '--', file])
  const stages = new Map(unmerged.split('\0').filter(Boolean).flatMap((record) => {
    const match = record.match(/^(\d+) ([a-f0-9]+) (\d)\t/)
    return match ? [[match[3], { mode: match[1], object: match[2] }] as const] : []
  }))
  const modes = [...stages.values()].map((stage) => stage.mode)
  const specialKind = modes.includes('160000') ? 'submodule'
    : modes.includes('120000') ? 'symlink' : null
  const readStage = async (stage: '1' | '2' | '3'): Promise<{
    exists: boolean
    content: string | null
    binary: boolean
  }> => {
    const entry = stages.get(stage)
    if (!entry) return { exists: false, content: null, binary: false }
    const buffer = await runGitBuffer(repositoryPath, ['cat-file', '-p', entry.object])
    let content: string | null = null
    let binary = buffer.includes(0)
    if (!binary) {
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
      } catch {
        binary = true
      }
    }
    return { exists: true, content: binary || specialKind ? null : content, binary }
  }
  const [baseStage, currentStage, incomingStage] = await Promise.all([
    readStage('1'),
    readStage('2'),
    readStage('3'),
  ])
  const binary = [baseStage, currentStage, incomingStage].some((stage) => stage.binary)
  const kind: RepositoryConflictVersions['kind'] = specialKind ?? (binary ? 'binary' : 'text')
  return {
    path: file,
    status: `${changed.indexStatus}${changed.worktreeStatus}`,
    kind,
    baseExists: baseStage.exists,
    currentExists: currentStage.exists,
    incomingExists: incomingStage.exists,
    base: baseStage.content,
    current: currentStage.content,
    incoming: incomingStage.content,
    binary: kind !== 'text',
  }
}

const safeConflictPath = async (repositoryPath: string, fileValue: unknown): Promise<string> => {
  const file = validatedFile(fileValue)
  const root = await realpath(repositoryPath)
  const candidate = resolve(root, file)
  const relativePath = relative(root, candidate)
  if (!relativePath || isAbsolute(relativePath) ||
    relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error('The selected file is outside this repository.')
  }
  const canonicalParent = await realpath(dirname(candidate))
  const parentRelative = relative(root, canonicalParent)
  if (isAbsolute(parentRelative) || parentRelative.startsWith(`..${sep}`) || parentRelative === '..') {
    throw new Error('The selected file is linked outside this repository.')
  }
  try {
    const canonicalCandidate = await realpath(candidate)
    const candidateRelative = relative(root, canonicalCandidate)
    if (isAbsolute(candidateRelative) ||
      candidateRelative.startsWith(`..${sep}`) || candidateRelative === '..') {
      throw new Error('The selected file is linked outside this repository.')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('linked outside')) throw error
    // A deleted side may require recreating the file inside its verified parent.
  }
  return candidate
}

const resolveConflict = async (
  inputValue: unknown,
): Promise<RepositoryGitDetails> => {
  if (!inputValue || typeof inputValue !== 'object') throw new Error('Invalid conflict resolution.')
  const input = inputValue as Partial<RepositoryConflictResolutionInput>
  if (typeof input.path !== 'string' || typeof input.file !== 'string' ||
    !['current', 'incoming', 'both', 'delete', 'content'].includes(input.resolution ?? '')) {
    throw new Error('Invalid conflict resolution.')
  }
  const repositoryPath = await verifiedClonePath(input.path)
  const versions = await conflictVersions(repositoryPath, input.file)
  const resolution = input.resolution!
  if (resolution === 'delete') {
    await runGit(repositoryPath, ['rm', '-f', '--', versions.path])
  } else if (resolution === 'current' || resolution === 'incoming') {
    const available = resolution === 'current' ? versions.currentExists : versions.incomingExists
    if (!available) throw new Error(`The ${resolution} side deleted this file. Choose Delete instead.`)
    await runGit(repositoryPath, [
      'checkout', resolution === 'current' ? '--ours' : '--theirs', '--', versions.path,
    ])
    await runGit(repositoryPath, ['add', '--', versions.path])
  } else {
    if (versions.kind !== 'text') {
      throw new Error(`${versions.kind} conflicts must use Current, Incoming, or Delete.`)
    }
    const content = resolution === 'both'
      ? [versions.current, versions.incoming].filter((value): value is string => value !== null)
        .map((value) => value.endsWith('\n') ? value : `${value}\n`).join('')
      : input.content
    if (typeof content !== 'string') throw new Error('Enter the resolved file content.')
    if (Buffer.byteLength(content, 'utf8') > 5_000_000) {
      throw new Error('The resolved file exceeds the 5 MB safety limit.')
    }
    await writeFile(await safeConflictPath(repositoryPath, versions.path), content, 'utf8')
    await runGit(repositoryPath, ['add', '--', versions.path])
  }
  return await refreshedDetails(repositoryPath)
}

const runOperationAction = async (
  repositoryPath: string,
  actionValue: unknown,
): Promise<RepositoryGitDetails> => {
  if (actionValue !== 'continue' && actionValue !== 'skip' && actionValue !== 'abort') {
    throw new Error('Invalid Git operation action.')
  }
  const action: RepositoryOperationAction = actionValue
  const operation = await repositoryOperationState(repositoryPath)
  if (operation.kind === 'none') throw new Error('There is no active Git operation.')
  if (action === 'continue' && operation.conflictedFiles.length > 0) {
    throw new Error('Resolve every conflicted file before continuing.')
  }
  if (action === 'skip' && !operation.canSkip) {
    throw new Error(`A ${operation.kind} operation cannot skip this step.`)
  }

  const commands: Record<Exclude<typeof operation.kind, 'none' | 'bisect'>,
    Record<RepositoryOperationAction, string[] | null>> = {
    merge: {
      continue: ['commit', '--no-edit'],
      skip: null,
      abort: ['merge', '--abort'],
    },
    rebase: {
      continue: ['rebase', '--continue'],
      skip: ['rebase', '--skip'],
      abort: ['rebase', '--abort'],
    },
    'cherry-pick': {
      continue: ['cherry-pick', '--continue'],
      skip: ['cherry-pick', '--skip'],
      abort: ['cherry-pick', '--abort'],
    },
    revert: {
      continue: ['revert', '--continue'],
      skip: ['revert', '--skip'],
      abort: ['revert', '--abort'],
    },
    am: {
      continue: ['am', '--continue'],
      skip: ['am', '--skip'],
      abort: ['am', '--abort'],
    },
  }
  if (operation.kind === 'bisect') {
    if (action !== 'abort') throw new Error('Bisect only supports reset from this screen.')
    await runGit(repositoryPath, ['bisect', 'reset'])
  } else {
    const command = commands[operation.kind][action]
    if (!command) throw new Error(`A ${operation.kind} operation cannot ${action}.`)
    await runGit(repositoryPath, command, {
      env: { ...process.env, GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':' },
      timeoutMs: 120_000,
    })
  }
  return await refreshedDetails(repositoryPath)
}

const historyOperation = async (
  repositoryPath: string,
  kind: 'cherry-pick' | 'revert',
  commitsValue: unknown,
  mainlineValue?: unknown,
): Promise<RepositoryGitDetails> => {
  await assertNoGitOperation(repositoryPath, kind)
  if (!Array.isArray(commitsValue) || commitsValue.length === 0 || commitsValue.length > 100) {
    throw new Error('Choose between 1 and 100 commits.')
  }
  const commits = commitsValue.map(validatedCommitHash)
  const dirty = Boolean((await runGit(repositoryPath, [
    'status', '--porcelain=v1', '--untracked-files=normal',
  ])).trim())
  if (dirty) throw new Error(`Commit or stash local changes before starting a ${kind}.`)
  await createRecoveryRef(repositoryPath, kind)

  try {
    if (kind === 'cherry-pick') {
      await runGit(repositoryPath, ['cherry-pick', ...commits], {
        env: { ...process.env, GIT_EDITOR: ':' },
        timeoutMs: 120_000,
      })
    } else {
      for (const commit of commits) {
        const parentLine = (await runGit(repositoryPath, [
          'rev-list', '--parents', '-n', '1', commit,
        ])).trim()
        const parentCount = Math.max(0, parentLine.split(/\s+/).length - 1)
        const mainline = Number.isInteger(mainlineValue) && Number(mainlineValue) > 0
          ? Number(mainlineValue)
          : 1
        if (parentCount > 1 && mainline > parentCount) {
          throw new Error(`Merge commit ${commit.slice(0, 7)} has only ${parentCount} parents.`)
        }
        await runGit(repositoryPath, [
          'revert', '--no-edit',
          ...(parentCount > 1 ? ['-m', String(mainline)] : []),
          commit,
        ], {
          env: { ...process.env, GIT_EDITOR: ':' },
          timeoutMs: 120_000,
        })
      }
    }
  } catch (error) {
    const operation = await repositoryOperationState(repositoryPath)
    if (operation.kind === kind) return await refreshedDetails(repositoryPath)
    throw error
  }
  return await refreshedDetails(repositoryPath)
}

const repositoryDetails = async (path: unknown): Promise<RepositoryGitDetails> => {
  const repositoryPath = await verifiedClonePath(path)
  const [status, files] = await Promise.all([
    readRepositoryStatus(repositoryPath),
    changedFiles(repositoryPath),
  ])
  const operation = await repositoryOperationState(repositoryPath, files)
  return { status, files, operation }
}

const validatedFiles = (files: unknown): string[] => {
  if (
    !Array.isArray(files) ||
    files.length > 1_000 ||
    files.some((file) => typeof file !== 'string' || file.length === 0 || file.length > 4_096)
  ) {
    throw new Error('Invalid Git file selection.')
  }
  return [...new Set(files as string[])]
}

const validatedCommitHash = (commitHash: unknown): string => {
  if (typeof commitHash !== 'string' || !/^[a-f0-9]{4,64}$/i.test(commitHash)) {
    throw new Error('Invalid commit selection.')
  }
  return commitHash
}

const validatedFile = (file: unknown): string => {
  if (typeof file !== 'string' || file.length === 0 || file.length > 4_096) {
    throw new Error('Invalid Git file selection.')
  }
  return file
}

const validatedAnalyticsRange = (range: unknown): RepositoryAnalyticsRange => {
  if (range === '7d' || range === '30d' || range === '90d' || range === '1y' || range === 'all') return range
  throw new Error('Invalid analytics time range.')
}

const currentRenamePath = (path: string): string => {
  const bracedRename = path.match(/^(.*)\{[^{}]* => ([^{}]*)\}(.*)$/)
  if (bracedRename) return `${bracedRename[1]}${bracedRename[2]}${bracedRename[3]}`
  const renameSeparator = path.lastIndexOf(' => ')
  return renameSeparator >= 0 ? path.slice(renameSeparator + 4) : path
}

const verifiedWorkingTreeFile = async (
  repositoryPath: string,
  file: unknown,
  sizeLimit = 5_000_000,
): Promise<{ path: string; size: number }> => {
  const filePath = validatedFile(file)
  const repositoryRoot = await realpath(repositoryPath)
  const candidate = resolve(repositoryRoot, filePath)
  const relativePath = relative(repositoryRoot, candidate)
  if (!relativePath || isAbsolute(relativePath) ||
    relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error('The selected file is outside this repository.')
  }
  let canonicalPath: string
  try {
    canonicalPath = await realpath(candidate)
  } catch {
    throw new Error('The selected file no longer exists.')
  }
  const canonicalRelative = relative(repositoryRoot, canonicalPath)
  if (!canonicalRelative || isAbsolute(canonicalRelative) ||
    canonicalRelative.startsWith(`..${sep}`) || canonicalRelative === '..') {
    throw new Error('Files linked outside this repository cannot be displayed.')
  }
  const fileStat = await stat(canonicalPath)
  if (!fileStat.isFile()) throw new Error('Select a file to preview its contents.')
  if (fileStat.size > sizeLimit) throw new Error('This file is too large to display safely.')
  return { path: canonicalPath, size: fileStat.size }
}

const workingFileResult = async (path: string): Promise<RepositoryWorkingFile> => {
  const [content, details] = await Promise.all([readFile(path), stat(path)])
  if (content.subarray(0, Math.min(content.length, 8_192)).includes(0)) {
    throw new Error('Binary files cannot be edited as text.')
  }
  return {
    content: content.toString('utf8'),
    etag: createHash('sha256').update(content).digest('hex'),
    modifiedAt: details.mtime.toISOString(),
    size: content.length,
  }
}

const previewMimeTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
}

const authenticatedEnvironment = async (repositoryPath: string): Promise<NodeJS.ProcessEnv> => {
  const records = await readCloneRecords()
  const record = records.find((item) => resolve(item.path) === repositoryPath)
  if (!record) throw new Error('The repository is not registered as a local clone.')
  const credentials = await refreshedCredentials(record.accountId)

  return {
    GIT_ASKPASS: await askPassPath(),
    GIT_TERMINAL_PROMPT: '0',
    MYREPOS_GIT_USERNAME: credentials.accountLogin,
    MYREPOS_GIT_TOKEN: credentials.token,
  }
}

const unstageFiles = async (repositoryPath: string, files: string[]): Promise<void> => {
  const pathspec = files.length > 0 ? files : ['.']
  try {
    await runGit(repositoryPath, ['rev-parse', '--verify', 'HEAD'])
    await runGit(repositoryPath, ['reset', '-q', 'HEAD', '--', ...pathspec])
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (!message.includes('Needed a single revision') && !message.includes('unknown revision')) {
      throw error
    }
    await runGit(repositoryPath, ['rm', '--cached', '-q', '-r', '--', ...pathspec])
  }
}

const refreshedDetails = async (repositoryPath: string): Promise<RepositoryGitDetails> => {
  await refreshRepositoryStatus(repositoryPath)
  return await repositoryDetails(repositoryPath)
}

const repositoryRecordForPath = async (repositoryPath: string) => {
  const records = await readCloneRecords()
  return records.find((item) => resolve(item.path) === repositoryPath)
}

const inferredGitHubIdentity = (email: string): CommitIdentity | null => {
  const match = email.trim().match(/^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$/i)
  if (!match?.[1]) return null
  const login = match[1]
  return {
    login,
    avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=64`,
    profileUrl: `https://github.com/${encodeURIComponent(login)}`,
  }
}

const githubCommitIdentities = async (
  repositoryPath: string,
): Promise<Map<string, CommitIdentity>> => {
  const repository = await repositoryRecordForPath(repositoryPath)
  if (!repository) return new Map()
  let upstreamHash = ''
  try {
    upstreamHash = (await runGit(repositoryPath, ['rev-parse', '@{upstream}'])).trim()
  } catch {
    return new Map()
  }
  const cacheKey = `${repository.accountId}:${repository.fullName.toLowerCase()}:${upstreamHash}`
  const cached = commitIdentityCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.identities
  try {
    const credentials = await refreshedCredentials(repository.accountId)
    const [owner, name] = repository.fullName.split('/', 2)
    if (!owner || !name) return new Map()
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits`)
    url.searchParams.set('sha', upstreamHash)
    url.searchParams.set('per_page', '100')
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${credentials.token}`,
        'User-Agent': 'MyRepos',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return new Map()
    const commits = await response.json() as GitHubCommitIdentityResponse[]
    const identities = new Map<string, CommitIdentity>()
    for (const commit of commits) {
      const identity = commit.author ?? commit.committer
      if (!identity) continue
      identities.set(commit.sha, {
        login: identity.login,
        avatarUrl: identity.avatar_url,
        profileUrl: identity.html_url,
      })
    }
    if (commitIdentityCache.size >= 40) {
      const oldestKey = commitIdentityCache.keys().next().value as string | undefined
      if (oldestKey) commitIdentityCache.delete(oldestKey)
    }
    commitIdentityCache.set(cacheKey, {
      expiresAt: Date.now() + 5 * 60_000,
      identities,
    })
    return identities
  } catch {
    return new Map()
  }
}

const enrichCommitIdentities = <T extends RepositoryCommit>(
  commits: T[],
  identities: Map<string, CommitIdentity>,
): T[] => {
  const identitiesByAuthor = new Map<string, CommitIdentity>()
  for (const commit of commits) {
    const identity = identities.get(commit.hash) ?? (commit.authorLogin && commit.authorAvatarUrl &&
      commit.authorProfileUrl ? {
        login: commit.authorLogin,
        avatarUrl: commit.authorAvatarUrl,
        profileUrl: commit.authorProfileUrl,
      } : null)
    if (!identity) continue
    identitiesByAuthor.set(`email:${commit.authorEmail.trim().toLowerCase()}`, identity)
    identitiesByAuthor.set(`name:${commit.author.trim().toLowerCase()}`, identity)
  }
  return commits.map((commit) => {
    const identity = identities.get(commit.hash) ??
      identitiesByAuthor.get(`email:${commit.authorEmail.trim().toLowerCase()}`) ??
      identitiesByAuthor.get(`name:${commit.author.trim().toLowerCase()}`)
    return identity ? {
      ...commit,
      authorLogin: identity.login,
      authorAvatarUrl: identity.avatarUrl,
      authorProfileUrl: identity.profileUrl,
    } : commit
  })
}

const pushTimesForCommits = async (
  repositoryPath: string,
  hashes: string[],
): Promise<Map<string, string>> => {
  const repository = await repositoryRecordForPath(repositoryPath)
  if (!repository || hashes.length === 0) return new Map()
  const statement = getDatabase().prepare(`
    SELECT pushed_at FROM repository_commit_pushes
    WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
      AND commit_hash = ?
  `)
  return new Map(hashes.flatMap((hash) => {
    const row = statement.get(repository.accountId, repository.fullName, hash) as
      { pushed_at: string } | undefined
    return row ? [[hash, row.pushed_at] as const] : []
  }))
}

const recordPushedCommits = async (
  repositoryPath: string,
  hashes: string[],
): Promise<void> => {
  if (hashes.length === 0) return
  const record = await repositoryRecordForPath(repositoryPath)
  if (!record) return
  const db = getDatabase()
  const statement = db.prepare(`
    INSERT INTO repository_commit_pushes (
      provider, account_id, full_name, commit_hash, pushed_at
    ) VALUES ('github', ?, ?, ?, ?)
    ON CONFLICT(provider, account_id, full_name, commit_hash) DO UPDATE SET
      pushed_at = excluded.pushed_at
  `)
  const pushedAt = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const hash of hashes) statement.run(record.accountId, record.fullName, hash, pushedAt)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const worktreeBranches = async (repositoryPath: string): Promise<Map<string, string>> => {
  const output = await runGit(repositoryPath, ['worktree', 'list', '--porcelain'])
  const branches = new Map<string, string>()
  let path: string | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    else if (line.startsWith('branch ') && path) branches.set(line.slice('branch '.length), path)
    else if (!line) path = null
  }
  return branches
}

const repositoryBranchState = async (repositoryPath: string): Promise<RepositoryBranchState> => {
  const [output, currentBranchOutput, currentCommit, occupiedBranches, stashOutput] = await Promise.all([
    runGit(repositoryPath, [
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)\t%(refname:short)\t%(objectname)\t%(committerdate:iso-strict)\t%(upstream:short)\t%(upstream:track)\t%(HEAD)',
      'refs/heads',
      'refs/remotes',
    ]),
    runGit(repositoryPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { successCodes: [0, 1] }),
    runGit(repositoryPath, ['rev-parse', 'HEAD']),
    worktreeBranches(repositoryPath),
    runGit(repositoryPath, ['stash', 'list', '--format=%gd']),
  ])
  const currentBranch = currentBranchOutput.trim() || null
  const branches = output.split(/\r?\n/).flatMap((line): RepositoryBranch[] => {
    if (!line) return []
    const [ref, shortName, commitHash, committedAt, upstream, tracking, head] = line.split('\t')
    if (!ref || !shortName || !commitHash) return []
    const kind = ref.startsWith('refs/heads/') ? 'local' : 'remote'
    const remoteParts = kind === 'remote'
      ? ref.slice('refs/remotes/'.length).split('/')
      : []
    const remote = kind === 'remote' ? remoteParts.shift() ?? null : null
    const name = kind === 'remote' ? remoteParts.join('/') : shortName
    if (!name || (kind === 'remote' && name === 'HEAD')) return []
    const ahead = Number(tracking?.match(/ahead (\d+)/)?.[1] ?? 0)
    const behind = Number(tracking?.match(/behind (\d+)/)?.[1] ?? 0)
    return [{
      name,
      ref,
      kind,
      remote,
      current: head === '*' || (kind === 'local' && name === currentBranch),
      upstream: upstream || null,
      ahead,
      behind,
      commitHash,
      committedAt: committedAt || null,
      checkedOutPath: kind === 'local' ? occupiedBranches.get(ref) ?? null : null,
    }]
  }).sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1
    if (left.kind !== right.kind) return left.kind === 'local' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  return {
    currentBranch,
    currentCommit: currentCommit.trim(),
    detached: currentBranch === null,
    stashCount: stashOutput.split(/\r?\n/).filter(Boolean).length,
    branches,
  }
}

const validatedBranchName = async (repositoryPath: string, value: unknown): Promise<string> => {
  if (typeof value !== 'string' || !value.trim() || value.length > 240) {
    throw new Error('Enter a valid branch name.')
  }
  const name = value.trim()
  try {
    await runGit(repositoryPath, ['check-ref-format', '--branch', name])
  } catch {
    throw new Error(`“${name}” is not a valid Git branch name.`)
  }
  return name
}

const validatedStartPoint = async (repositoryPath: string, value: unknown): Promise<string> => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || value.includes('\0')) {
    throw new Error('Choose a valid branch or commit.')
  }
  const startPoint = value.trim()
  try {
    await runGit(repositoryPath, ['rev-parse', '--verify', '--end-of-options', `${startPoint}^{commit}`])
  } catch {
    throw new Error(`Git could not find “${startPoint}”.`)
  }
  return startPoint
}

const validatedCheckoutTarget = (value: unknown): RepositoryCheckoutTarget => {
  if (!value || typeof value !== 'object') throw new Error('Choose a branch or commit.')
  const target = value as Partial<RepositoryCheckoutTarget>
  if ((target.kind !== 'local' && target.kind !== 'remote' && target.kind !== 'commit') ||
    typeof target.ref !== 'string' || !target.ref || target.ref.length > 500 ||
    typeof target.name !== 'string' || !target.name || target.name.length > 240) {
    throw new Error('Choose a valid branch or commit.')
  }
  return target as RepositoryCheckoutTarget
}

const validatedCheckoutStrategy = (value: unknown): RepositoryCheckoutStrategy => {
  if (value === 'require-clean' || value === 'carry' || value === 'stash') return value
  throw new Error('Choose how to handle local changes.')
}

const checkoutTarget = async (
  repositoryPath: string,
  targetValue: unknown,
  strategyValue: unknown,
): Promise<RepositoryBranchState> => {
  await assertNoGitOperation(repositoryPath, 'switch branches')
  const target = validatedCheckoutTarget(targetValue)
  const strategy = validatedCheckoutStrategy(strategyValue)
  const state = await repositoryBranchState(repositoryPath)
  const localBranch = state.branches.find((branch) =>
    branch.kind === 'local' && branch.name === target.name)
  if (localBranch?.checkedOutPath && resolve(localBranch.checkedOutPath) !== repositoryPath) {
    throw new Error(`Branch “${target.name}” is already checked out at ${localBranch.checkedOutPath}.`)
  }
  const dirty = Boolean((await runGit(repositoryPath, [
    'status', '--porcelain=v1', '--untracked-files=normal',
  ])).trim())
  if (dirty && strategy === 'require-clean') {
    throw new Error('This working copy has uncommitted changes. Carry them, stash them, or commit them before checkout.')
  }
  let stashed = false
  if (dirty && strategy === 'stash') {
    const output = await runGit(repositoryPath, [
      'stash', 'push', '--include-untracked', '--message', `MyRepos checkout ${target.name}`,
    ])
    stashed = !output.toLowerCase().includes('no local changes')
  }
  try {
    if (target.kind === 'commit') {
      const commit = await validatedStartPoint(repositoryPath, target.ref)
      await runGit(repositoryPath, ['switch', '--detach', commit])
    } else if (target.kind === 'local' || localBranch) {
      await runGit(repositoryPath, ['switch', '--', target.name])
    } else {
      const remoteBranch = state.branches.find((branch) =>
        branch.kind === 'remote' && branch.ref === target.ref)
      if (!remoteBranch) throw new Error('The selected remote branch no longer exists.')
      await runGit(repositoryPath, ['switch', '--track', '-c', target.name, remoteBranch.ref])
    }
  } catch (error) {
    if (stashed) {
      try { await runGit(repositoryPath, ['stash', 'pop']) } catch { /* Keep the recovery stash. */ }
    }
    throw error
  }
  await refreshRepositoryStatus(repositoryPath)
  return await repositoryBranchState(repositoryPath)
}

export const registerRepositoryActionHandlers = (): void => {
  ipcMain.handle('repositories:git-details', (_event, path: unknown) => repositoryDetails(path))
  ipcMain.handle(
    'repositories:git-diff',
    async (_event, path: unknown, file: unknown, staged: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      if (typeof file !== 'string' || file.length === 0 || file.length > 4_096) {
        throw new Error('Invalid Git file selection.')
      }
      const diff = await runGit(
        repositoryPath,
        ['diff', ...(staged === true ? ['--cached'] : []), '--', file],
      )
      if (diff || staged === true) return diff
      return await runGit(
        repositoryPath,
        ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file],
        { successCodes: [0, 1] },
      )
    },
  )
  ipcMain.handle('repositories:git-history', async (_event, path: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    const [output, unpushedOutput] = await Promise.all([
      runGit(repositoryPath, [
        'log',
        '-n',
        '100',
        '--date=iso-strict',
        '--pretty=format:%H%x1f%h%x1f%an%x1f%aE%x1f%aI%x1f%cI%x1f%s%x1e',
      ], { successCodes: [0, 128] }),
      (async (): Promise<string> => {
        try {
          await runGit(repositoryPath, ['rev-parse', '--verify', '@{upstream}'])
          return await runGit(repositoryPath, ['rev-list', '-n', '100', '@{upstream}..HEAD'])
        } catch {
          return await runGit(repositoryPath, ['rev-list', '-n', '100', 'HEAD'], {
            successCodes: [0, 128],
          })
        }
      })(),
    ])
    const unpushedHashes = new Set(unpushedOutput.split(/\r?\n/).filter(Boolean))

    const commits = output
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record): RepositoryCommit | null => {
        const [hash, shortHash, author, authorEmail, authoredAt, committedAt, ...subjectParts] =
          record.split('\x1f')
        if (!hash || !shortHash || !author || !authorEmail || !authoredAt || !committedAt) return null
        const inferredIdentity = inferredGitHubIdentity(authorEmail)
        return {
          hash,
          shortHash,
          author,
          authorEmail,
          authorLogin: inferredIdentity?.login ?? null,
          authorAvatarUrl: inferredIdentity?.avatarUrl ?? null,
          authorProfileUrl: inferredIdentity?.profileUrl ?? null,
          authoredAt,
          committedAt,
          subject: subjectParts.join('\x1f'),
          unpushed: unpushedHashes.has(hash),
          pushedAt: null,
        }
      })
      .filter((commit): commit is RepositoryCommit => commit !== null)
    const [repository, identities] = await Promise.all([
      repositoryRecordForPath(repositoryPath),
      githubCommitIdentities(repositoryPath),
    ])
    const commitsWithIdentities = enrichCommitIdentities(commits, identities)
    if (!repository) return commitsWithIdentities
    const pushedAt = getDatabase().prepare(`
      SELECT pushed_at FROM repository_commit_pushes
      WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
        AND commit_hash = ?
    `)
    return commitsWithIdentities.map((commit) => ({
      ...commit,
      pushedAt: (pushedAt.get(repository.accountId, repository.fullName, commit.hash) as
        { pushed_at: string } | undefined)?.pushed_at ?? null,
    }))
  })
  ipcMain.handle(
    'repositories:git-commit-diff',
    async (_event, path: unknown, commitHash: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      const hash = validatedCommitHash(commitHash)
      return await runGit(repositoryPath, [
        'show',
        '--format=',
        '--find-renames',
        '--find-copies',
        hash,
      ])
    },
  )
  ipcMain.handle(
    'repositories:git-commit-files',
    async (_event, path: unknown, commitHash: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      const hash = validatedCommitHash(commitHash)
      const output = await runGit(repositoryPath, [
        'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', hash,
      ])
      const tokens = output.split('\0').filter(Boolean)
      const files: RepositoryCommitFile[] = []
      for (let index = 0; index < tokens.length;) {
        const token = tokens[index++]
        const inline = token.match(/^([^\t]+)\t(.+)$/)
        const status = inline?.[1] ?? token
        let filePath = inline?.[2] ?? tokens[index++]
        if (!filePath) break
        if ((status.startsWith('R') || status.startsWith('C')) && index < tokens.length) {
          filePath = tokens[index++]
        }
        files.push({ path: filePath, status: status[0] })
      }
      return files
    },
  )
  ipcMain.handle(
    'repositories:git-commit-file-diff',
    async (_event, path: unknown, commitHash: unknown, file: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      const hash = validatedCommitHash(commitHash)
      const filePath = validatedFile(file)
      return await runGit(repositoryPath, [
        'show', '--format=', '--find-renames', hash, '--', filePath,
      ])
    },
  )
  ipcMain.handle(
    'repositories:git-working-tree',
    async (_event, path: unknown, includeIgnored: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      if (typeof includeIgnored !== 'boolean') throw new Error('Invalid ignored-file option.')
      const [trackedOutput, deletedOutput, untrackedOutput, ignoredOutput] = await Promise.all([
        runGit(repositoryPath, ['ls-files', '-z', '--cached'], { outputLimit: 20_000_000 }),
        runGit(repositoryPath, ['ls-files', '-z', '--deleted'], { outputLimit: 20_000_000 }),
        runGit(repositoryPath, ['ls-files', '-z', '--others', '--exclude-standard'], {
          outputLimit: 20_000_000,
        }),
        includeIgnored
          ? runGit(repositoryPath, [
              'ls-files', '-z', '--others', '--ignored', '--exclude-standard',
            ], { outputLimit: 20_000_000 })
          : Promise.resolve(''),
      ])
      const trackedPaths = new Set(trackedOutput.split('\0').filter(Boolean))
      for (const deletedPath of deletedOutput.split('\0').filter(Boolean)) trackedPaths.delete(deletedPath)
      const untrackedPaths = new Set(untrackedOutput.split('\0').filter(Boolean))
      const ignoredPaths = new Set(ignoredOutput.split('\0').filter(Boolean))
      const paths = new Set([...trackedPaths, ...untrackedPaths, ...ignoredPaths])
      return [...paths]
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        .map((filePath): RepositoryWorkingTreeFile => ({
          path: filePath,
          tracked: trackedPaths.has(filePath),
          ignored: ignoredPaths.has(filePath),
        }))
    },
  )
  ipcMain.handle(
    'repositories:git-working-file-content',
    async (_event, path: unknown, file: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      const target = await verifiedWorkingTreeFile(repositoryPath, file)
      const content = await readFile(target.path)
      if (content.subarray(0, Math.min(content.length, 8_192)).includes(0)) {
        throw new Error('Binary files cannot be displayed as text.')
      }
      return content.toString('utf8')
    },
  )
  ipcMain.handle(
    'repositories:git-working-file',
    async (_event, path: unknown, file: unknown): Promise<RepositoryWorkingFile> => {
      const repositoryPath = await verifiedClonePath(path)
      const target = await verifiedWorkingTreeFile(repositoryPath, file)
      return await workingFileResult(target.path)
    },
  )
  ipcMain.handle(
    'repositories:git-save-working-file',
    async (_event, value: unknown): Promise<RepositoryWorkingFile> => {
      if (!value || typeof value !== 'object') throw new Error('Invalid file update.')
      const input = value as Partial<RepositoryWorkingFileWriteInput>
      if (typeof input.path !== 'string' || typeof input.file !== 'string' ||
        typeof input.content !== 'string' || typeof input.expectedEtag !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(input.expectedEtag)) throw new Error('Invalid file update.')
      const bytes = Buffer.byteLength(input.content, 'utf8')
      if (bytes > 5_000_000) throw new Error('The edited file exceeds the 5 MB safety limit.')
      const repositoryPath = await verifiedClonePath(input.path)
      const target = await verifiedWorkingTreeFile(repositoryPath, input.file)
      const current = await workingFileResult(target.path)
      if (current.etag !== input.expectedEtag) {
        throw new Error('LOCAL_FILE_CHANGED: This file changed on disk. Reload it before saving.')
      }
      const details = await stat(target.path)
      const temporaryPath = resolve(dirname(target.path), `.${randomUUID()}.myrepos.tmp`)
      try {
        await writeFile(temporaryPath, input.content, { encoding: 'utf8', mode: details.mode & 0o7777 })
        const latest = await workingFileResult(target.path)
        if (latest.etag !== input.expectedEtag) {
          throw new Error('LOCAL_FILE_CHANGED: This file changed on disk. Reload it before saving.')
        }
        await rename(temporaryPath, target.path)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
      return await workingFileResult(target.path)
    },
  )
  ipcMain.handle(
    'repositories:git-working-file-preview',
    async (_event, path: unknown, file: unknown): Promise<RepositoryFilePreview> => {
      const repositoryPath = await verifiedClonePath(path)
      const filePath = validatedFile(file)
      const mimeType = previewMimeTypes[extname(filePath).toLowerCase()]
      if (!mimeType) throw new Error('This file type does not have a rendered preview.')
      const target = await verifiedWorkingTreeFile(repositoryPath, filePath, 25_000_000)
      const content = await readFile(target.path)
      return {
        mimeType,
        dataUrl: `data:${mimeType};base64,${content.toString('base64')}`,
        size: target.size,
      }
    },
  )
  ipcMain.handle(
    'repositories:git-change-analytics',
    async (_event, path: unknown, requestedRange: unknown): Promise<RepositoryChangeAnalytics> => {
      const repositoryPath = await verifiedClonePath(path)
      const range = validatedAnalyticsRange(requestedRange)
      const maxCommits = 3_000
      const since = range === '7d'
        ? '7 days ago'
        : range === '30d'
        ? '30 days ago'
        : range === '90d' ? '90 days ago' : range === '1y' ? '1 year ago' : null
      const args = [
        'log', '--date=iso-strict', '--find-renames', `-n${maxCommits + 1}`,
        '--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%cI%x1f%s', '--numstat',
      ]
      if (since) args.splice(1, 0, `--since=${since}`)
      const output = await runGit(repositoryPath, args, {
        successCodes: [0, 128],
        outputLimit: 50_000_000,
        timeoutMs: 90_000,
      })
      const parsed = output.split('\x1e').flatMap((block): RepositoryChangeCommit[] => {
        const lines = block.trim().split(/\r?\n/)
        const header = lines.shift()
        if (!header) return []
        const [hash, shortHash, author, authorEmail, committedAt, ...subjectParts] =
          header.split('\x1f')
        if (!hash || !shortHash || !committedAt) return []
        return [{
          hash,
          shortHash,
          author: author || 'Unknown',
          authorEmail: authorEmail || '',
          committedAt,
          subject: subjectParts.join('\x1f'),
          files: lines.flatMap((line) => {
            const parts = line.split('\t')
            if (parts.length < 3) return []
            const [added, deleted, ...pathParts] = parts
            const filePath = currentRenamePath(pathParts.join('\t').trim())
            if (!filePath) return []
            const binary = added === '-' || deleted === '-'
            return [{
              path: filePath,
              additions: binary ? 0 : Number.parseInt(added, 10) || 0,
              deletions: binary ? 0 : Number.parseInt(deleted, 10) || 0,
              binary,
            }]
          }),
        }]
      })
      return {
        range,
        commits: parsed.slice(0, maxCommits),
        truncated: parsed.length > maxCommits,
        maxCommits,
      }
    },
  )
  ipcMain.handle('repositories:git-file-history', async (_event, path: unknown, file: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    const filePath = validatedFile(file)
    const [output, unpushedOutput] = await Promise.all([
      runGit(repositoryPath, [
        'log', '--follow', '-n', '250', '--date=iso-strict',
        '--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%aE%x1f%aI%x1f%cI%x1f%s',
        '--name-status', '--', filePath,
      ], { successCodes: [0, 128], outputLimit: 4_000_000 }),
      (async (): Promise<string> => {
        try {
          await runGit(repositoryPath, ['rev-parse', '--verify', '@{upstream}'])
          return await runGit(repositoryPath, ['rev-list', '@{upstream}..HEAD'])
        } catch {
          return await runGit(repositoryPath, ['rev-list', 'HEAD'], { successCodes: [0, 128] })
        }
      })(),
    ])
    const unpushedHashes = new Set(unpushedOutput.split(/\r?\n/).filter(Boolean))
    const revisions = output.split('\x1e').flatMap((block): RepositoryFileRevision[] => {
      const lines = block.trim().split(/\r?\n/).filter(Boolean)
      const header = lines.shift()
      if (!header) return []
      const [hash, shortHash, author, authorEmail, authoredAt, committedAt, ...subjectParts] =
        header.split('\x1f')
      if (!hash || !shortHash || !author || !authorEmail || !authoredAt || !committedAt) return []
      const inferredIdentity = inferredGitHubIdentity(authorEmail)
      const change = lines.find((line) => /^[A-Z][0-9]*\t/.test(line))
      const parts = change?.split('\t') ?? []
      const status = parts[0]?.[0] ?? 'M'
      const renamed = status === 'R' || status === 'C'
      const revisionPath = (renamed ? parts[2] : parts[1]) || filePath
      return [{
        hash,
        shortHash,
        author,
        authorEmail,
        authorLogin: inferredIdentity?.login ?? null,
        authorAvatarUrl: inferredIdentity?.avatarUrl ?? null,
        authorProfileUrl: inferredIdentity?.profileUrl ?? null,
        authoredAt,
        committedAt,
        subject: subjectParts.join('\x1f'),
        unpushed: unpushedHashes.has(hash),
        pushedAt: null,
        path: revisionPath,
        previousPath: renamed ? parts[1] ?? null : null,
        status,
      }]
    })
    const [pushTimes, identities] = await Promise.all([
      pushTimesForCommits(repositoryPath, revisions.map((revision) => revision.hash)),
      githubCommitIdentities(repositoryPath),
    ])
    return enrichCommitIdentities(revisions, identities).map((revision) => ({
      ...revision,
      pushedAt: pushTimes.get(revision.hash) ?? null,
    }))
  })
  ipcMain.handle(
    'repositories:git-file-revision-diff',
    async (_event, path: unknown, commitHash: unknown, file: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      const hash = validatedCommitHash(commitHash)
      const filePath = validatedFile(file)
      return await runGit(repositoryPath, [
        'show', '--format=', '--find-renames', hash, '--', filePath,
      ])
    },
  )
  ipcMain.handle(
    'repositories:git-file-content',
    async (_event, path: unknown, commitHash: unknown, file: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      const hash = validatedCommitHash(commitHash)
      const filePath = validatedFile(file)
      const object = `${hash}:${filePath}`
      const size = Number((await runGit(repositoryPath, ['cat-file', '-s', object])).trim())
      if (!Number.isFinite(size) || size > 5_000_000) {
        throw new Error('This historical file is too large to display safely.')
      }
      const content = await runGit(repositoryPath, ['show', object], { outputLimit: 5_500_000 })
      if (content.includes('\0')) throw new Error('Binary historical files cannot be displayed as text.')
      return content
    },
  )
  ipcMain.handle(
    'repositories:git-compare-file-revisions',
    async (
      _event,
      path: unknown,
      fromCommit: unknown,
      fromFile: unknown,
      toCommit: unknown,
      toFile: unknown,
    ) => {
      const repositoryPath = await verifiedClonePath(path)
      const fromHash = validatedCommitHash(fromCommit)
      const toHash = validatedCommitHash(toCommit)
      const fromPath = validatedFile(fromFile)
      const toPath = validatedFile(toFile)
      return await runGit(repositoryPath, [
        'diff', '--no-ext-diff', `${fromHash}:${fromPath}`, `${toHash}:${toPath}`,
      ], { successCodes: [0, 1], outputLimit: 5_000_000 })
    },
  )
  ipcMain.handle(
    'repositories:git-restore-file',
    async (_event, path: unknown, commitHash: unknown, file: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      const hash = validatedCommitHash(commitHash)
      const filePath = validatedFile(file)
      await runGit(repositoryPath, ['restore', '--source', hash, '--worktree', '--', filePath])
      return await refreshedDetails(repositoryPath)
    },
  )
  ipcMain.handle('repositories:git-stage', async (_event, path: unknown, files: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    const selectedFiles = validatedFiles(files)
    await runGit(repositoryPath, selectedFiles.length > 0 ? ['add', '--', ...selectedFiles] : ['add', '-A'])
    return await refreshedDetails(repositoryPath)
  })
  ipcMain.handle('repositories:git-unstage', async (_event, path: unknown, files: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    const selectedFiles = validatedFiles(files)
    await unstageFiles(repositoryPath, selectedFiles)
    return await refreshedDetails(repositoryPath)
  })
  ipcMain.handle('repositories:git-commit', async (_event, path: unknown, message: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    if (typeof message !== 'string' || !message.trim() || message.length > 10_000) {
      throw new Error('Enter a commit message.')
    }
    await runGit(repositoryPath, ['commit', '-m', message.trim()], { timeoutMs: 120_000 })
    return await refreshedDetails(repositoryPath)
  })
  ipcMain.handle('repositories:git-fetch', async (_event, path: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    await runGit(repositoryPath, ['-c', 'credential.helper=', 'fetch', '--prune', 'origin'], {
      env: await authenticatedEnvironment(repositoryPath),
      timeoutMs: 120_000,
    })
    return await refreshedDetails(repositoryPath)
  })
  ipcMain.handle('repositories:git-pull', async (_event, path: unknown, options: unknown) =>
    pullRepository(await verifiedClonePath(path), options))
  ipcMain.handle('repositories:git-push', async (_event, path: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    await assertNoGitOperation(repositoryPath, 'push')
    const env = await authenticatedEnvironment(repositoryPath)
    let hasUpstream = true
    try {
      await runGit(repositoryPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    } catch {
      hasUpstream = false
    }
    const hashesToRecord = (await runGit(repositoryPath, hasUpstream
      ? ['rev-list', '--max-count=1000', '@{upstream}..HEAD']
      : ['rev-list', '--max-count=1000', 'HEAD'], {
      successCodes: [0, 128],
    })).split(/\r?\n/).filter((hash) => /^[a-f0-9]{40,64}$/i.test(hash))
    await runGit(repositoryPath, hasUpstream
      ? ['-c', 'credential.helper=', 'push']
      : ['-c', 'credential.helper=', 'push', '-u', 'origin', 'HEAD'], {
      env,
      timeoutMs: 120_000,
    })
    try {
      await recordPushedCommits(repositoryPath, hashesToRecord)
    } catch {
      // The remote push already succeeded. Timeline journaling must not report it as failed.
    }
    const details = await refreshedDetails(repositoryPath)
    if (
      details.status.clean &&
      details.status.upstream &&
      details.status.ahead === 0 &&
      details.status.behind === 0
    ) {
      await markRepositorySynced(repositoryPath)
    }
    return details
  })
  ipcMain.handle('repositories:git-branches', async (_event, path: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    return await repositoryBranchState(repositoryPath)
  })
  ipcMain.handle(
    'repositories:git-merge-preview',
    async (_event, path: unknown, targetRef: unknown) =>
      mergePreview(await verifiedClonePath(path), targetRef),
  )
  ipcMain.handle(
    'repositories:git-merge',
    async (_event, path: unknown, targetRef: unknown, mode: unknown) =>
      mergeBranch(await verifiedClonePath(path), targetRef, mode),
  )
  ipcMain.handle(
    'repositories:git-rebase',
    async (_event, path: unknown, targetRef: unknown, autoStash: unknown) =>
      rebaseBranch(await verifiedClonePath(path), targetRef, autoStash),
  )
  ipcMain.handle(
    'repositories:git-interactive-rebase-preview',
    async (_event, path: unknown, targetRef: unknown) =>
      interactiveRebasePreview(await verifiedClonePath(path), targetRef),
  )
  ipcMain.handle(
    'repositories:git-interactive-rebase',
    async (_event, path: unknown, targetRef: unknown, plan: unknown, autoStash: unknown) =>
      interactiveRebase(await verifiedClonePath(path), targetRef, plan, autoStash),
  )
  ipcMain.handle(
    'repositories:git-conflict-versions',
    async (_event, path: unknown, file: unknown) =>
      conflictVersions(await verifiedClonePath(path), file),
  )
  ipcMain.handle(
    'repositories:git-resolve-conflict',
    async (_event, input: unknown) => resolveConflict(input),
  )
  ipcMain.handle(
    'repositories:git-operation-action',
    async (_event, path: unknown, action: unknown) =>
      runOperationAction(await verifiedClonePath(path), action),
  )
  ipcMain.handle(
    'repositories:git-cherry-pick',
    async (_event, path: unknown, commits: unknown) =>
      historyOperation(await verifiedClonePath(path), 'cherry-pick', commits),
  )
  ipcMain.handle(
    'repositories:git-revert',
    async (_event, path: unknown, commits: unknown, mainline: unknown) =>
      historyOperation(await verifiedClonePath(path), 'revert', commits, mainline),
  )
  ipcMain.handle(
    'repositories:git-checkout',
    async (_event, path: unknown, target: unknown, strategy: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      return await checkoutTarget(repositoryPath, target, strategy)
    },
  )
  ipcMain.handle(
    'repositories:git-create-branch',
    async (_event, path: unknown, nameValue: unknown, startPointValue: unknown, checkoutValue: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      await assertNoGitOperation(repositoryPath, 'create a branch')
      const name = await validatedBranchName(repositoryPath, nameValue)
      const startPoint = await validatedStartPoint(repositoryPath, startPointValue)
      if (checkoutValue !== true && checkoutValue !== false) throw new Error('Invalid branch option.')
      const state = await repositoryBranchState(repositoryPath)
      if (state.branches.some((branch) => branch.kind === 'local' && branch.name === name)) {
        throw new Error(`Local branch “${name}” already exists.`)
      }
      await runGit(repositoryPath, checkoutValue
        ? ['switch', '-c', name, startPoint]
        : ['branch', name, startPoint])
      await refreshRepositoryStatus(repositoryPath)
      return await repositoryBranchState(repositoryPath)
    },
  )
  ipcMain.handle(
    'repositories:git-rename-branch',
    async (_event, path: unknown, oldNameValue: unknown, newNameValue: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      await assertNoGitOperation(repositoryPath, 'rename a branch')
      const oldName = await validatedBranchName(repositoryPath, oldNameValue)
      const newName = await validatedBranchName(repositoryPath, newNameValue)
      const state = await repositoryBranchState(repositoryPath)
      if (!state.branches.some((branch) => branch.kind === 'local' && branch.name === oldName)) {
        throw new Error(`Local branch “${oldName}” no longer exists.`)
      }
      if (state.branches.some((branch) => branch.kind === 'local' && branch.name === newName)) {
        throw new Error(`Local branch “${newName}” already exists.`)
      }
      await runGit(repositoryPath, ['branch', '-m', '--', oldName, newName])
      await refreshRepositoryStatus(repositoryPath)
      return await repositoryBranchState(repositoryPath)
    },
  )
  ipcMain.handle(
    'repositories:git-delete-branch',
    async (_event, path: unknown, nameValue: unknown, forceValue: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      await assertNoGitOperation(repositoryPath, 'delete a branch')
      const name = await validatedBranchName(repositoryPath, nameValue)
      if (forceValue !== true && forceValue !== false) throw new Error('Invalid branch deletion option.')
      const state = await repositoryBranchState(repositoryPath)
      const branch = state.branches.find((item) => item.kind === 'local' && item.name === name)
      if (!branch) throw new Error(`Local branch “${name}” no longer exists.`)
      if (branch.current) throw new Error('Switch to another branch before deleting the current branch.')
      if (branch.checkedOutPath) {
        throw new Error(`Branch “${name}” is checked out at ${branch.checkedOutPath}.`)
      }
      await runGit(repositoryPath, ['branch', forceValue ? '-D' : '-d', '--', name])
      return await repositoryBranchState(repositoryPath)
    },
  )
  ipcMain.handle(
    'repositories:git-delete-remote-branch',
    async (_event, path: unknown, remoteValue: unknown, nameValue: unknown) => {
      const repositoryPath = await verifiedClonePath(path)
      await assertNoGitOperation(repositoryPath, 'delete a remote branch')
      if (typeof remoteValue !== 'string' || !remoteValue || remoteValue.length > 240) {
        throw new Error('Choose a valid remote branch.')
      }
      const name = await validatedBranchName(repositoryPath, nameValue)
      const state = await repositoryBranchState(repositoryPath)
      const branch = state.branches.find((item) =>
        item.kind === 'remote' && item.remote === remoteValue && item.name === name)
      if (!branch) throw new Error(`Remote branch “${remoteValue}/${name}” no longer exists.`)
      await runGit(repositoryPath, [
        '-c', 'credential.helper=', 'push', remoteValue, '--delete', name,
      ], {
        env: await authenticatedEnvironment(repositoryPath),
        timeoutMs: 120_000,
      })
      await runGit(repositoryPath, ['fetch', '--prune', remoteValue], {
        env: await authenticatedEnvironment(repositoryPath),
        timeoutMs: 120_000,
      })
      await refreshRepositoryStatus(repositoryPath)
      return await repositoryBranchState(repositoryPath)
    },
  )
  ipcMain.handle('repositories:git-pop-stash', async (_event, path: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    await assertNoGitOperation(repositoryPath, 'restore a stash')
    const state = await repositoryBranchState(repositoryPath)
    if (state.stashCount === 0) throw new Error('There are no stashed changes to restore.')
    await runGit(repositoryPath, ['stash', 'pop'])
    await refreshRepositoryStatus(repositoryPath)
    return await repositoryBranchState(repositoryPath)
  })
}
