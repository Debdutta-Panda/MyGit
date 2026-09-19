import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { registerGitHubAccountHandlers } from './github-auth'
import { registerRepositoryHandlers } from './github-repositories'
import { registerSettingsHandlers } from './settings-store'
import { registerRepositoryActionHandlers } from './repository-actions'
import { closeDatabase, initializeDatabase } from './database'
import { registerOrganizationHandlers } from './organization-store'
import { registerConfigurationSyncHandlers } from './configuration-sync'
import { registerWorkingCopyHandlers } from './working-copies'
import { registerProjectInsightHandlers } from './project-insights'
import { registerUpdateHandlers, startAutomaticUpdateChecks } from './app-updater'
import { closeAllTerminals, registerTerminalHandlers } from './terminal-service'
import { registerSshConnectionHandlers } from './ssh-connections'
import { registerSshWorkspaceHandlers } from './ssh-workspace'

// Squirrel invokes the application briefly while installing, updating, and uninstalling. Its
// startup helper creates/removes shortcuts and exits before normal application initialization.
const squirrelStartup = createRequire(import.meta.url)('electron-squirrel-startup') as boolean
if (squirrelStartup) app.quit()

const appIconPath = join(process.cwd(), 'build', 'icon.png')

app.setName('MyRepos')

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#0d1117',
    title: 'MyRepos',
    icon: appIconPath,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : process.platform === 'win32'
        ? {
            frame: false,
          }
        : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-changed', false)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer-gone]', details.reason, details.exitCode)
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const windowFromEvent = (event: Electron.IpcMainInvokeEvent): BrowserWindow => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw new Error('The application window is unavailable.')
  return window
}

const registerWindowHandlers = (): void => {
  ipcMain.handle('window:minimize', (event) => { windowFromEvent(event).minimize() })
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = windowFromEvent(event)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle('window:close', (event) => { windowFromEvent(event).close() })
  ipcMain.handle('window:is-maximized', (event) => windowFromEvent(event).isMaximized())
}

app.whenReady().then(async () => {
  await initializeDatabase()
  Menu.setApplicationMenu(null)
  if (process.platform === 'darwin') app.dock.setIcon(appIconPath)

  registerGitHubAccountHandlers()
  registerRepositoryHandlers()
  registerRepositoryActionHandlers()
  registerProjectInsightHandlers()
  registerSettingsHandlers()
  registerUpdateHandlers()
  registerTerminalHandlers()
  registerSshConnectionHandlers()
  registerSshWorkspaceHandlers()
  registerOrganizationHandlers()
  registerConfigurationSyncHandlers()
  registerWorkingCopyHandlers()
  registerWindowHandlers()
  createWindow()
  startAutomaticUpdateChecks()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  console.error('MyRepos failed to start:', error)
  app.quit()
})

app.on('before-quit', () => {
  closeAllTerminals()
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
