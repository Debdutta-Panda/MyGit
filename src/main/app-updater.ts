import { app, autoUpdater, BrowserWindow, ipcMain, net } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AppUpdateState } from '../shared/desktop-api'
import { getAppSettings } from './settings-store'

const automaticCheckIntervalMs = 6 * 60 * 60 * 1000
const updateFeedUrl = 'https://github.com/Debdutta-Panda/MyGit/releases/latest/download'
let initialized = false
let updateCheckRunning = false
let updateState: AppUpdateState = {
  phase: 'idle',
  channel: 'stable',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  transferred: null,
  total: null,
  bytesPerSecond: null,
  checkedAt: null,
  message: null,
  packaged: app.isPackaged && process.platform === 'win32',
}

interface UpdatePackageMetadata {
  fileName: string
  total: number
  version: string | null
}

let progressTimer: ReturnType<typeof setInterval> | null = null
let progressMetadata: UpdatePackageMetadata | null = null

const stopProgressTracking = (): void => {
  if (progressTimer) clearInterval(progressTimer)
  progressTimer = null
}

const squirrelRoot = (): string => {
  const executableDirectory = dirname(process.execPath)
  return /^app-/i.test(basename(executableDirectory))
    ? dirname(executableDirectory)
    : executableDirectory
}

const largestMatchingDownload = async (
  directory: string,
  metadata: UpdatePackageMetadata,
  depth = 0,
): Promise<number> => {
  if (depth > 2) return 0
  let largest = 0
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        largest = Math.max(largest, await largestMatchingDownload(entryPath, metadata, depth + 1))
        continue
      }
      const normalized = entry.name.toLowerCase()
      const matchesName = normalized === metadata.fileName.toLowerCase() ||
        normalized.startsWith(`${metadata.fileName.toLowerCase()}.`)
      const matchesVersion = Boolean(metadata.version && normalized.includes(metadata.version) &&
        (normalized.includes('.nupkg') || normalized.endsWith('.partial')))
      if (matchesName || matchesVersion) largest = Math.max(largest, (await stat(entryPath)).size)
    }
  } catch {
    return largest
  }
  return largest
}

const readReleaseMetadata = async (version: string | null): Promise<UpdatePackageMetadata | null> => {
  const response = await net.fetch(`${updateFeedUrl}/RELEASES`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Update manifest returned ${response.status}.`)
  const entries = (await response.text()).split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^[a-f\d]{40}\s+(\S+)\s+(\d+)$/i)
    if (!match) return []
    const fileName = decodeURIComponent(match[1].split('/').at(-1) ?? match[1])
    return [{ fileName, total: Number(match[2]), version }]
  }).filter((entry) => entry.fileName.toLowerCase().includes('full.nupkg'))
  return entries.find((entry) => !version || entry.fileName.includes(version)) ?? entries.at(-1) ?? null
}

const startProgressTracking = async (version: string | null): Promise<void> => {
  stopProgressTracking()
  progressMetadata = null
  try {
    progressMetadata = await readReleaseMetadata(version)
  } catch {
    // Native Squirrel still owns the update; the UI remains honestly indeterminate.
  }
  if (updateState.phase !== 'downloading') return

  let previousBytes = 0
  let previousTime = Date.now()
  let sampling = false
  const sample = async (): Promise<void> => {
    if (sampling) return
    if (updateState.phase !== 'downloading') {
      stopProgressTracking()
      return
    }
    const metadata = progressMetadata
    if (!metadata) return
    sampling = true
    const candidates = await Promise.all([
      largestMatchingDownload(join(squirrelRoot(), 'packages'), metadata),
      largestMatchingDownload(join(app.getPath('temp'), 'SquirrelTemp'), metadata),
    ])
    sampling = false
    if (updateState.phase !== 'downloading') return
    const transferred = Math.min(metadata.total, Math.max(...candidates))
    const now = Date.now()
    const elapsedSeconds = Math.max(0.001, (now - previousTime) / 1_000)
    const instantaneousSpeed = transferred > previousBytes
      ? (transferred - previousBytes) / elapsedSeconds
      : 0
    const previousSpeed = updateState.bytesPerSecond ?? instantaneousSpeed
    const bytesPerSecond = instantaneousSpeed > 0
      ? Math.round(previousSpeed * 0.55 + instantaneousSpeed * 0.45)
      : previousSpeed > 0 ? previousSpeed : null
    previousBytes = transferred
    previousTime = now
    publishState({
      total: metadata.total,
      transferred,
      progress: metadata.total > 0
        ? Math.min(99.9, transferred / metadata.total * 100)
        : null,
      bytesPerSecond,
    })
  }
  void sample()
  progressTimer = setInterval(() => void sample(), 500)
  progressTimer.unref()
}

const snapshot = (): AppUpdateState => ({ ...updateState })

const publishState = (patch: Partial<AppUpdateState>): AppUpdateState => {
  updateState = { ...updateState, ...patch }
  const nextState = snapshot()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updates:state-changed', nextState)
  }
  return nextState
}

const checkForUpdates = async (): Promise<AppUpdateState> => {
  if (!app.isPackaged || process.platform !== 'win32') {
    return publishState({
      phase: 'unavailable',
      message: 'Squirrel updates are available in the installed Windows build.',
    })
  }

  if (updateCheckRunning || updateState.phase === 'checking' || updateState.phase === 'downloading') {
    return snapshot()
  }

  updateCheckRunning = true
  publishState({
    phase: 'checking',
    progress: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    message: 'Checking GitHub Releases…',
  })

  try {
    autoUpdater.checkForUpdates()
  } catch (error) {
    updateCheckRunning = false
    publishState({
      phase: 'error',
      message: error instanceof Error ? error.message : 'Could not check for updates.',
    })
  }
  return snapshot()
}

const downloadUpdate = async (): Promise<AppUpdateState> => {
  // Squirrel downloads an available update as part of checkForUpdates. Keep this action for
  // compatibility with existing renderers and turn it into an on-demand check/download.
  return checkForUpdates()
}

const installUpdate = (): void => {
  if (updateState.phase !== 'downloaded') {
    throw new Error('The update has not finished downloading.')
  }
  autoUpdater.quitAndInstall()
}

const configureUpdater = (): void => {
  if (app.isPackaged && process.platform === 'win32') {
    autoUpdater.setFeedURL({ url: updateFeedUrl })
  }

  autoUpdater.on('checking-for-update', () => {
    updateCheckRunning = true
    publishState({ phase: 'checking', message: 'Checking GitHub Releases…' })
  })
  autoUpdater.on('update-not-available', () => {
    updateCheckRunning = false
    publishState({
      phase: 'up-to-date',
      availableVersion: null,
      progress: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      checkedAt: new Date().toISOString(),
      message: 'You have the latest stable version.',
    })
  })
  autoUpdater.on('update-available', (_event, _releaseNotes, releaseName) => {
    updateCheckRunning = false
    const availableVersion = releaseName?.match(/\d+\.\d+\.\d+/)?.[0] ?? null
    publishState({
      phase: 'downloading',
      availableVersion,
      progress: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      checkedAt: new Date().toISOString(),
      message: availableVersion
        ? `Downloading MyRepos ${availableVersion}…`
        : 'Downloading the latest MyRepos update…',
    })
    void startProgressTracking(availableVersion)
  })
  autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
    updateCheckRunning = false
    stopProgressTracking()
    const availableVersion = releaseName?.match(/\d+\.\d+\.\d+/)?.[0]
    const total = progressMetadata?.total ?? updateState.total
    publishState({
      phase: 'downloaded',
      availableVersion: availableVersion ?? updateState.availableVersion,
      progress: 100,
      transferred: total ?? updateState.transferred,
      total,
      bytesPerSecond: null,
      message: 'Update ready. Restart MyRepos to install it.',
    })
  })
  autoUpdater.on('error', (error) => {
    updateCheckRunning = false
    stopProgressTracking()
    publishState({
      phase: 'error',
      bytesPerSecond: null,
      message: error.message || 'The updater encountered an error.',
    })
  })
}

export const registerUpdateHandlers = (): void => {
  if (!initialized) {
    initialized = true
    configureUpdater()
  }

  ipcMain.handle('updates:get-state', () => snapshot())
  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:download', () => downloadUpdate())
  ipcMain.handle('updates:install', () => installUpdate())
}

export const startAutomaticUpdateChecks = (): void => {
  if (!app.isPackaged || process.platform !== 'win32') return

  const runAutomaticCheck = (): void => {
    void getAppSettings().then((settings) => {
      if (settings.automaticallyCheckForUpdates) void checkForUpdates()
    })
  }

  const initialTimer = setTimeout(runAutomaticCheck, 10_000)
  initialTimer.unref()
  const interval = setInterval(runAutomaticCheck, automaticCheckIntervalMs)
  interval.unref()
}
