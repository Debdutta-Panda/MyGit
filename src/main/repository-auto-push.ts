import { BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { RepositoryAutoPushState, RepositoryGitStatus } from '../shared/desktop-api'
import { getDatabase } from './database'
import { askPassPath, refreshedCredentials } from './github-repositories'
import { markWorkingCopySynced } from './working-copy-store'

interface AutoPushRow {
  id: string
  account_id: number
  full_name: string
  local_path: string
  auto_push_mode: 'off' | 'idle'
}

const timers = new Map<string, NodeJS.Timeout>()
const scheduledAhead = new Map<string, number>()
const cancelledAhead = new Map<string, number>()
const retryAfter = new Map<string, number>()
const pushing = new Set<string>()
const idleDelayMs = 15_000

const rowForPath = (path: string): AutoPushRow | undefined => getDatabase().prepare(`
  SELECT id, account_id, full_name, local_path, auto_push_mode
  FROM working_copies WHERE local_path = ?
`).get(resolve(path)) as unknown as AutoPushRow | undefined

const emit = (row: AutoPushRow, phase: RepositoryAutoPushState['phase'], message: string, dueAt: string | null = null): void => {
  const state: RepositoryAutoPushState = {
    workingCopyId: row.id,
    path: row.local_path,
    mode: row.auto_push_mode,
    phase,
    dueAt,
    message,
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('working-copies:auto-push-state', state)
  }
}

const stopTimer = (path: string): void => {
  const timer = timers.get(path)
  if (timer) clearTimeout(timer)
  timers.delete(path)
  scheduledAhead.delete(path)
}

const pauseReason = (status: RepositoryGitStatus): string | null => {
  if (status.error) return status.error
  if (!status.branch) return 'Paused: detached HEAD cannot be auto-pushed.'
  if (!status.upstream) return 'Paused: the branch has no tracked upstream.'
  if (status.behind > 0) return 'Paused: pull or reconcile remote commits first.'
  if (status.conflicts > 0) return 'Paused: resolve repository conflicts first.'
  if (!status.clean) return 'Paused until the working tree is clean.'
  return null
}

const gitOutput = async (row: AutoPushRow, args: string[]): Promise<string> => await new Promise((resolvePromise, reject) => {
  const git = spawn('git', ['-C', row.local_path, ...args], {
    shell: false,
    windowsHide: true,
    env: process.env,
  })
  let stdout = ''
  let stderr = ''
  const timeout = setTimeout(() => {
    git.kill()
    reject(new Error('Git command timed out.'))
  }, 30_000)
  git.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  git.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-20_000) })
  git.once('error', (error) => { clearTimeout(timeout); reject(error) })
  git.once('close', (code) => {
    clearTimeout(timeout)
    if (code === 0) resolvePromise(stdout)
    else reject(new Error(stderr.trim() || `Git exited with code ${code ?? 'unknown'}.`))
  })
})

const runTrackedPush = async (row: AutoPushRow): Promise<void> => {
  const credentials = await refreshedCredentials(row.account_id)
  const askPass = await askPassPath()
  await new Promise<void>((resolvePromise, reject) => {
    const git = spawn('git', ['-C', row.local_path, '-c', 'credential.helper=', 'push', '--porcelain'], {
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_ASKPASS: askPass,
        GIT_TERMINAL_PROMPT: '0',
        MYREPOS_GIT_USERNAME: credentials.accountLogin,
        MYREPOS_GIT_TOKEN: credentials.token,
      },
    })
    let stderr = ''
    const timeout = setTimeout(() => {
      git.kill()
      reject(new Error('Safe auto-push timed out.'))
    }, 120_000)
    git.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-20_000) })
    git.once('error', (error) => { clearTimeout(timeout); reject(error) })
    git.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new Error(stderr.trim() || `Git push exited with code ${code ?? 'unknown'}.`))
    })
  })
}

const recordPushedCommits = (row: AutoPushRow, hashes: string[]): void => {
  if (hashes.length === 0) return
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
    for (const hash of hashes) statement.run(row.account_id, row.full_name, hash, pushedAt)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const reconsiderAutoPush = (
  status: RepositoryGitStatus,
  readStatus: (path: string) => Promise<RepositoryGitStatus>,
  publishStatus: (status: RepositoryGitStatus) => void,
): void => {
  const row = rowForPath(status.path)
  if (!row || row.auto_push_mode === 'off') {
    stopTimer(status.path)
    if (row) emit(row, 'off', 'Safe auto-push is off.')
    return
  }
  if (pushing.has(status.path)) return
  if (status.ahead <= 0) {
    stopTimer(status.path)
    cancelledAhead.delete(status.path)
    emit(row, 'watching', 'Watching for unpushed commits.')
    return
  }
  const cancelledForAhead = cancelledAhead.get(status.path)
  if (cancelledForAhead !== undefined) {
    if (cancelledForAhead === status.ahead) {
      stopTimer(status.path)
      emit(row, 'paused', 'This scheduled push was cancelled. A repository change will allow a new countdown.')
      return
    }
    cancelledAhead.delete(status.path)
  }
  const blocked = pauseReason(status)
  if (blocked) {
    stopTimer(status.path)
    emit(row, 'paused', blocked)
    return
  }
  if (timers.has(status.path)) {
    if (scheduledAhead.get(status.path) === status.ahead) return
    stopTimer(status.path)
  }
  const delay = Math.max(idleDelayMs, (retryAfter.get(status.path) ?? 0) - Date.now())
  const dueAt = new Date(Date.now() + delay).toISOString()
  emit(row, 'countdown', `Safe auto-push in ${Math.ceil(delay / 1000)} seconds.`, dueAt)
  scheduledAhead.set(status.path, status.ahead)
  timers.set(status.path, setTimeout(() => {
    timers.delete(status.path)
    scheduledAhead.delete(status.path)
    void (async () => {
      const currentRow = rowForPath(status.path)
      if (!currentRow || currentRow.auto_push_mode !== 'idle') return
      const current = await readStatus(status.path)
      const currentBlock = pauseReason(current)
      if (current.ahead <= 0) {
        emit(currentRow, 'watching', 'Nothing is waiting to be pushed.')
        publishStatus(current)
        return
      }
      if (currentBlock) {
        emit(currentRow, 'paused', currentBlock)
        publishStatus(current)
        return
      }
      pushing.add(status.path)
      emit(currentRow, 'pushing', `Pushing ${current.ahead} commit${current.ahead === 1 ? '' : 's'} to ${current.upstream}…`)
      try {
        const hashesToRecord = (await gitOutput(currentRow, [
          'rev-list', '--max-count=1000', '@{upstream}..HEAD',
        ])).split(/\r?\n/).filter((hash) => /^[a-f0-9]{40,64}$/i.test(hash))
        await runTrackedPush(currentRow)
        retryAfter.delete(status.path)
        const after = await readStatus(status.path)
        try {
          recordPushedCommits(currentRow, hashesToRecord)
          if (after.clean && after.upstream && after.ahead === 0 && after.behind === 0) {
            await markWorkingCopySynced(status.path)
          }
        } catch {
          // The remote push succeeded. Local bookkeeping must never report the push as failed.
        }
        publishStatus(after)
        emit(currentRow, 'pushed', 'Pushed successfully.')
      } catch (error) {
        retryAfter.set(status.path, Date.now() + 60_000)
        emit(currentRow, 'paused', `Paused after push failure: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        pushing.delete(status.path)
      }
    })()
  }, delay))
}

export const autoPushPolicyChanged = (row: AutoPushRow): void => {
  stopTimer(row.local_path)
  cancelledAhead.delete(row.local_path)
  retryAfter.delete(row.local_path)
  emit(row, row.auto_push_mode === 'off' ? 'off' : 'watching',
    row.auto_push_mode === 'off' ? 'Safe auto-push is off.' : 'Watching for unpushed commits.')
}

export const cancelScheduledAutoPush = (workingCopyId: string): boolean => {
  const row = getDatabase().prepare(`
    SELECT id, account_id, full_name, local_path, auto_push_mode
    FROM working_copies WHERE id = ?
  `).get(workingCopyId) as unknown as AutoPushRow | undefined
  if (!row || !timers.has(row.local_path)) return false
  const ahead = scheduledAhead.get(row.local_path)
  if (ahead === undefined) return false
  stopTimer(row.local_path)
  cancelledAhead.set(row.local_path, ahead)
  emit(row, 'paused', 'Scheduled auto-push cancelled. It will remain pending until the repository changes.')
  return true
}

export const stopAllAutoPush = (): void => {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  scheduledAhead.clear()
  cancelledAhead.clear()
}
