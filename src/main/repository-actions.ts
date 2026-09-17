import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import {
  askPassPath,
  markRepositorySynced,
  readCloneRecords,
  refreshedCredentials,
  verifiedClonePath,
} from './github-repositories'
import { readRepositoryStatus, refreshRepositoryStatus } from './repository-monitor'
import type {
  RepositoryChangedFile,
  RepositoryCommit,
  RepositoryCommitFile,
  RepositoryGitDetails,
} from '../shared/desktop-api'

interface GitRunOptions {
  env?: NodeJS.ProcessEnv
  outputLimit?: number
  timeoutMs?: number
  successCodes?: number[]
}

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
    const output = await runGit(repositoryPath, [
      'log',
      '-n',
      '100',
      '--date=iso-strict',
      '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e',
    ], { successCodes: [0, 128] })

    return output
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record): RepositoryCommit | null => {
        const [hash, shortHash, author, authoredAt, ...subjectParts] = record.split('\x1f')
        if (!hash || !shortHash || !author || !authoredAt) return null
        return { hash, shortHash, author, authoredAt, subject: subjectParts.join('\x1f') }
      })
      .filter((commit): commit is RepositoryCommit => commit !== null)
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
    await runGit(repositoryPath, hasUpstream
      ? ['-c', 'credential.helper=', 'push']
      : ['-c', 'credential.helper=', 'push', '-u', 'origin', 'HEAD'], {
      env,
      timeoutMs: 120_000,
    })
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
}
