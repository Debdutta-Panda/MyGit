import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerGitHubAccountHandlers } from './github-auth'
import { registerRepositoryHandlers } from './github-repositories'
import { registerSettingsHandlers } from './settings-store'
import { registerRepositoryActionHandlers } from './repository-actions'

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
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.setIcon(appIconPath)

  registerGitHubAccountHandlers()
  registerRepositoryHandlers()
  registerRepositoryActionHandlers()
  registerSettingsHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
