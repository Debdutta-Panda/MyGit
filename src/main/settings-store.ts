import { ipcMain } from 'electron'
import type { AppSettings } from '../shared/desktop-api'
import { getDatabase } from './database'

interface SettingsRow {
  vscode_application_name: string
  automatically_check_for_updates: number
  automatically_download_updates: number
}

export const getAppSettings = async (): Promise<AppSettings> => {
  const row = getDatabase().prepare(`
    SELECT vscode_application_name, automatically_check_for_updates,
      automatically_download_updates FROM app_settings WHERE id = 1
  `).get() as unknown as SettingsRow | undefined
  return {
    vscodeApplicationName: row?.vscode_application_name ?? '',
    automaticallyCheckForUpdates: row?.automatically_check_for_updates !== 0,
    automaticallyDownloadUpdates: row?.automatically_download_updates !== 0,
  }
}

const saveAppSettings = async (settings: unknown): Promise<AppSettings> => {
  if (!settings || typeof settings !== 'object') throw new Error('Invalid settings.')
  const candidate = settings as Partial<AppSettings>
  if (
    typeof candidate.vscodeApplicationName !== 'string' ||
    typeof candidate.automaticallyCheckForUpdates !== 'boolean' ||
    typeof candidate.automaticallyDownloadUpdates !== 'boolean'
  ) throw new Error('Invalid settings.')

  const vscodeApplicationName = candidate.vscodeApplicationName.trim()
  if (vscodeApplicationName.length > 200) {
    throw new Error('The VS Code application name is too long.')
  }
  getDatabase().prepare(`
    UPDATE app_settings SET vscode_application_name = ?,
      automatically_check_for_updates = ?, automatically_download_updates = ? WHERE id = 1
  `).run(
    vscodeApplicationName,
    candidate.automaticallyCheckForUpdates ? 1 : 0,
    candidate.automaticallyDownloadUpdates ? 1 : 0,
  )
  return {
    vscodeApplicationName,
    automaticallyCheckForUpdates: candidate.automaticallyCheckForUpdates,
    automaticallyDownloadUpdates: candidate.automaticallyDownloadUpdates,
  }
}

export const registerSettingsHandlers = (): void => {
  ipcMain.handle('settings:get', () => getAppSettings())
  ipcMain.handle('settings:save', (_event, settings: unknown) => saveAppSettings(settings))
}
