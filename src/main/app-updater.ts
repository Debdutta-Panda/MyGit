import { app, autoUpdater, BrowserWindow, ipcMain } from 'electron'
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
  checkedAt: null,
  message: null,
  packaged: app.isPackaged && process.platform === 'win32',
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
      checkedAt: new Date().toISOString(),
      message: availableVersion
        ? `Downloading MyRepos ${availableVersion}…`
        : 'Downloading the latest MyRepos update…',
    })
  })
  autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
    updateCheckRunning = false
    const availableVersion = releaseName?.match(/\d+\.\d+\.\d+/)?.[0]
    publishState({
      phase: 'downloaded',
      availableVersion: availableVersion ?? updateState.availableVersion,
      progress: 100,
      message: 'Update ready. Restart MyRepos to install it.',
    })
  })
  autoUpdater.on('error', (error) => {
    updateCheckRunning = false
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
