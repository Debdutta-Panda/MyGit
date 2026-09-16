import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    remove: (accountId) => ipcRenderer.invoke('accounts:remove', accountId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
  },
  github: {
    start: () => ipcRenderer.invoke('github:start'),
    launch: (requestId) => ipcRenderer.invoke('github:launch', requestId),
    waitForAuthorization: (requestId) => ipcRenderer.invoke('github:wait', requestId),
    cancel: (requestId) => ipcRenderer.invoke('github:cancel', requestId),
  },
  repositories: {
    listCloned: (accountId) => ipcRenderer.invoke('repositories:list-cloned', accountId),
    list: (accountId) => ipcRenderer.invoke('repositories:list', accountId),
    clone: (accountId, fullName) => ipcRenderer.invoke('repositories:clone', accountId, fullName),
    locate: (accountId, fullName) => ipcRenderer.invoke('repositories:locate', accountId, fullName),
    openFolder: (path) => ipcRenderer.invoke('repositories:open-folder', path),
    openInVSCode: (path) => ipcRenderer.invoke('repositories:open-vscode', path),
    monitor: (paths) => ipcRenderer.invoke('repositories:monitor', paths),
    onStatusChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]): void => {
        callback(status)
      }
      ipcRenderer.on('repositories:status-changed', listener)
      return () => ipcRenderer.removeListener('repositories:status-changed', listener)
    },
    gitDetails: (path) => ipcRenderer.invoke('repositories:git-details', path),
    gitDiff: (path, file, staged) => ipcRenderer.invoke('repositories:git-diff', path, file, staged),
    gitStage: (path, files) => ipcRenderer.invoke('repositories:git-stage', path, files),
    gitUnstage: (path, files) => ipcRenderer.invoke('repositories:git-unstage', path, files),
    gitCommit: (path, message) => ipcRenderer.invoke('repositories:git-commit', path, message),
    gitFetch: (path) => ipcRenderer.invoke('repositories:git-fetch', path),
    gitPull: (path) => ipcRenderer.invoke('repositories:git-pull', path),
    gitPush: (path) => ipcRenderer.invoke('repositories:git-push', path),
  },
}

contextBridge.exposeInMainWorld('desktop', desktopApi)

export type { DesktopApi } from '../shared/desktop-api'
