import { BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import type { RepositoryGitStatus } from '../shared/desktop-api'

const watchers = new Map<string, FSWatcher>()
const refreshTimers = new Map<string, NodeJS.Timeout>()

export const readRepositoryStatus = async (repositoryPath: string): Promise<RepositoryGitStatus> =>
  await new Promise((resolvePromise) => {
    const git = spawn(
      'git',
      ['-C', repositoryPath, 'status', '--porcelain=v2', '--branch', '--untracked-files=normal'],
      { shell: false, windowsHide: true },
    )
    let output = ''
    let errorOutput = ''

    git.stdout.on('data', (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-1_000_000)
    })
    git.stderr.on('data', (chunk: Buffer) => {
      errorOutput = `${errorOutput}${chunk.toString()}`.slice(-10_000)
    })
    git.once('error', () => {
      resolvePromise({
        path: repositoryPath,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicts: 0,
        clean: false,
        error: 'Git status is unavailable.',
      })
    })
    git.once('close', (code) => {
      if (code !== 0) {
        resolvePromise({
          path: repositoryPath,
          branch: null,
          upstream: null,
          ahead: 0,
          behind: 0,
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicts: 0,
          clean: false,
          error: errorOutput.trim() || 'Unable to read Git status.',
        })
        return
      }

      let branch: string | null = null
      let upstream: string | null = null
      let ahead = 0
      let behind = 0
      let staged = 0
      let unstaged = 0
      let untracked = 0
      let conflicts = 0

      for (const line of output.split('\n')) {
        if (line.startsWith('# branch.head ')) {
          const head = line.slice(14).trim()
          branch = head === '(detached)' ? null : head
        }
        else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18).trim()
        else if (line.startsWith('# branch.ab ')) {
          const match = line.match(/\+(\d+)\s+-(\d+)/)
          if (match) {
            ahead = Number(match[1])
            behind = Number(match[2])
          }
        } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
          const state = line.split(' ', 3)[1] ?? '..'
          if (state[0] !== '.') staged += 1
          if (state[1] !== '.') unstaged += 1
        } else if (line.startsWith('u ')) conflicts += 1
        else if (line.startsWith('? ')) untracked += 1
      }

      resolvePromise({
        path: repositoryPath,
        branch,
        upstream,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        conflicts,
        clean: staged + unstaged + untracked + conflicts === 0,
        error: null,
      })
    })
  })

export const refreshRepositoryStatus = async (repositoryPath: string): Promise<void> => {
  broadcastStatus(await readRepositoryStatus(repositoryPath))
}

const broadcastStatus = (status: RepositoryGitStatus): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('repositories:status-changed', status)
  }
}

const scheduleRefresh = (repositoryPath: string): void => {
  const existingTimer = refreshTimers.get(repositoryPath)
  if (existingTimer) clearTimeout(existingTimer)
  refreshTimers.set(repositoryPath, setTimeout(() => {
    refreshTimers.delete(repositoryPath)
    void readRepositoryStatus(repositoryPath).then(broadcastStatus)
  }, 350))
}

const createWatcher = (repositoryPath: string): FSWatcher => {
  try {
    return watch(repositoryPath, { recursive: true }, () => scheduleRefresh(repositoryPath))
  } catch {
    return watch(repositoryPath, () => scheduleRefresh(repositoryPath))
  }
}

export const monitorRepositories = async (
  repositoryPaths: string[],
): Promise<RepositoryGitStatus[]> => {
  const requestedPaths = new Set(repositoryPaths)

  for (const [path, watcher] of watchers) {
    if (requestedPaths.has(path)) continue
    watcher.close()
    watchers.delete(path)
    const timer = refreshTimers.get(path)
    if (timer) clearTimeout(timer)
    refreshTimers.delete(path)
  }

  for (const path of requestedPaths) {
    if (watchers.has(path)) continue
    const watcher = createWatcher(path)
    watcher.on('error', () => {
      watcher.close()
      watchers.delete(path)
    })
    watchers.set(path, watcher)
  }

  return await Promise.all([...requestedPaths].map(readRepositoryStatus))
}
