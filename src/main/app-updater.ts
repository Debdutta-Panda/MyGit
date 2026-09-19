import { app, BrowserWindow, ipcMain } from 'electron'
import updaterPackage from 'electron-updater'
import type { AppUpdateState } from '../shared/desktop-api'
import { getAppSettings } from './settings-store'

const { autoUpdater } = updaterPackage

const automaticCheckIntervalMs = 6 * 60 * 60 * 1000
let initialized = false
let updateState: AppUpdateState = {
  phase: 'idle',
  channel: 'stable',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  transferred: null,
  total: null,
  checkedAt: null,
  message: null,
  packaged: app.isPackaged,
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
  if (!app.isPackaged) {
    return publishState({
      phase: 'unavailable',
      message: 'Update checks are available in installed builds.',
    })
  }

  if (updateState.phase === 'checking' || updateState.phase === 'downloading') {
    return snapshot()
  }

  publishState({
    phase: 'checking',
    progress: null,
    transferred: null,
    total: null,
    message: 'Checking GitHub Releases…',
  })

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    publishState({
      phase: 'error',
      message: error instanceof Error ? error.message : 'Could not check for updates.',
    })
  }
  return snapshot()
}

const downloadUpdate = async (): Promise<AppUpdateState> => {
  if (!app.isPackaged) return checkForUpdates()
  if (updateState.phase === 'downloading' || updateState.phase === 'downloaded') return snapshot()
  if (!updateState.availableVersion) {
    return publishState({ phase: 'error', message: 'Check for an update before downloading.' })
  }

  publishState({ phase: 'downloading', progress: 0, message: 'Starting download…' })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    publishState({
      phase: 'error',
      message: error instanceof Error ? error.message : 'Could not download the update.',
    })
  }
  return snapshot()
}

const installUpdate = (): void => {
  if (updateState.phase !== 'downloaded') {
    throw new Error('The update has not finished downloading.')
  }
  // Updates use NSIS silent mode: close MyRepos, replace the installed files without showing the
  // installer wizard, then launch the updated application again.
  autoUpdater.quitAndInstall(true, true)
}

const configureUpdater = (): void => {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.fullChangelog = true

  autoUpdater.on('checking-for-update', () => {
    publishState({ phase: 'checking', message: 'Checking GitHub Releases…' })
  })
  autoUpdater.on('update-not-available', () => {
    publishState({
      phase: 'up-to-date',
      availableVersion: null,
      progress: null,
      transferred: null,
      total: null,
      checkedAt: new Date().toISOString(),
      message: 'You have the latest stable version.',
    })
  })
  autoUpdater.on('update-available', (info) => {
    publishState({
      phase: 'available',
      availableVersion: info.version,
      checkedAt: new Date().toISOString(),
      message: `MyRepos ${info.version} is available.`,
    })
    void getAppSettings().then((settings) => {
      if (settings.automaticallyDownloadUpdates) void downloadUpdate()
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    publishState({
      phase: 'downloading',
      progress: Math.max(0, Math.min(100, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
      message: `Downloading ${progress.percent.toFixed(0)}%`,
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    publishState({
      phase: 'downloaded',
      availableVersion: info.version,
      progress: 100,
      message: 'Update ready. Restart MyRepos to install it.',
    })
  })
  autoUpdater.on('error', (error) => {
    publishState({ phase: 'error', message: error.message || 'The updater encountered an error.' })
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
  if (!app.isPackaged) return

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
