import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
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
  RepositoryBranch,
  RepositoryBranchState,
  RepositoryCheckoutStrategy,
  RepositoryCheckoutTarget,
  RepositoryGitDetails,
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

const repositoryDetails = async (path: unknown): Promise<RepositoryGitDetails> => {
  const repositoryPath = await verifiedClonePath(path)
  const [status, files] = await Promise.all([
    readRepositoryStatus(repositoryPath),
    changedFiles(repositoryPath),
  ])
  return { status, files }
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
  if (range === '30d' || range === '90d' || range === '1y' || range === 'all') return range
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
      const since = range === '30d'
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
  ipcMain.handle('repositories:git-pull', async (_event, path: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
    await runGit(repositoryPath, ['-c', 'credential.helper=', 'pull', '--ff-only'], {
      env: await authenticatedEnvironment(repositoryPath),
      timeoutMs: 120_000,
    })
    return await refreshedDetails(repositoryPath)
  })
  ipcMain.handle('repositories:git-push', async (_event, path: unknown) => {
    const repositoryPath = await verifiedClonePath(path)
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
    const state = await repositoryBranchState(repositoryPath)
    if (state.stashCount === 0) throw new Error('There are no stashed changes to restore.')
    await runGit(repositoryPath, ['stash', 'pop'])
    await refreshRepositoryStatus(repositoryPath)
    return await repositoryBranchState(repositoryPath)
  })
}
