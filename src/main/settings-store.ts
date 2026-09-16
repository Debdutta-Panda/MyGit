import { app, ipcMain } from 'electron'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppSettings } from '../shared/desktop-api'

interface SettingsFile {
  version: 1
  settings: AppSettings
}

const defaultSettings = (): AppSettings => ({
  vscodeApplicationName: '',
})

const settingsFilePath = (): string => join(app.getPath('userData'), 'settings.json')

export const getAppSettings = async (): Promise<AppSettings> => {
  try {
    const parsed = JSON.parse(await readFile(settingsFilePath(), 'utf8')) as Partial<SettingsFile>
    if (parsed.version !== 1 || !parsed.settings) {
      throw new Error('The settings file has an unsupported format.')
    }

    return {
      vscodeApplicationName:
        typeof parsed.settings.vscodeApplicationName === 'string'
          ? parsed.settings.vscodeApplicationName
          : '',
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings()
    throw error
  }
}

const saveAppSettings = async (settings: unknown): Promise<AppSettings> => {
  if (!settings || typeof settings !== 'object') throw new Error('Invalid settings.')
  const candidate = settings as Partial<AppSettings>
  if (typeof candidate.vscodeApplicationName !== 'string') throw new Error('Invalid settings.')

  const vscodeApplicationName = candidate.vscodeApplicationName.trim()
  if (vscodeApplicationName.length > 200) {
    throw new Error('The VS Code application name is too long.')
  }

  const nextSettings: AppSettings = { vscodeApplicationName }
  const destination = settingsFilePath()
  const temporary = `${destination}.tmp`
  const contents: SettingsFile = { version: 1, settings: nextSettings }

  await mkdir(dirname(destination), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, destination)
  await chmod(destination, 0o600)
  return nextSettings
}

export const registerSettingsHandlers = (): void => {
  ipcMain.handle('settings:get', () => getAppSettings())
  ipcMain.handle('settings:save', (_event, settings: unknown) => saveAppSettings(settings))
}
