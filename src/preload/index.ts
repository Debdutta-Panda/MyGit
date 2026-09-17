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
    addLocal: (accountId) => ipcRenderer.invoke('repositories:add-local', accountId),
    publish: (input) => ipcRenderer.invoke('repositories:publish', input),
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
    gitHistory: (path) => ipcRenderer.invoke('repositories:git-history', path),
    gitCommitDiff: (path, commitHash) => ipcRenderer.invoke('repositories:git-commit-diff', path, commitHash),
    gitCommitFiles: (path, commitHash) => ipcRenderer.invoke('repositories:git-commit-files', path, commitHash),
    gitCommitFileDiff: (path, commitHash, file) =>
      ipcRenderer.invoke('repositories:git-commit-file-diff', path, commitHash, file),
    gitStage: (path, files) => ipcRenderer.invoke('repositories:git-stage', path, files),
    gitUnstage: (path, files) => ipcRenderer.invoke('repositories:git-unstage', path, files),
    gitCommit: (path, message) => ipcRenderer.invoke('repositories:git-commit', path, message),
    gitFetch: (path) => ipcRenderer.invoke('repositories:git-fetch', path),
    gitPull: (path) => ipcRenderer.invoke('repositories:git-pull', path),
    gitPush: (path) => ipcRenderer.invoke('repositories:git-push', path),
  },
  organization: {
    list: () => ipcRenderer.invoke('organization:list'),
    create: (kind, input) => ipcRenderer.invoke('organization:create', kind, input),
    update: (kind, id, input) => ipcRenderer.invoke('organization:update', kind, id, input),
    remove: (kind, id) => ipcRenderer.invoke('organization:remove', kind, id),
    assignments: () => ipcRenderer.invoke('organization:assignments'),
    appearances: () => ipcRenderer.invoke('organization:appearances'),
    saveRepositoryColor: (accountId, fullName, color) =>
      ipcRenderer.invoke('organization:save-repository-color', accountId, fullName, color),
    workspaceOrder: (workspaceId) => ipcRenderer.invoke('organization:workspace-order', workspaceId),
    reorderWorkspace: (workspaceId, repositoryKeys) =>
      ipcRenderer.invoke('organization:reorder-workspace', workspaceId, repositoryKeys),
    saveRepository: (accountId, fullName, organization) =>
      ipcRenderer.invoke('organization:save-repository', accountId, fullName, organization),
  },
  configurationSync: {
    get: () => ipcRenderer.invoke('configuration-sync:get'),
    create: (input) => ipcRenderer.invoke('configuration-sync:create', input),
    connectRemote: (accountId, fullName) =>
      ipcRenderer.invoke('configuration-sync:connect-remote', accountId, fullName),
    connectLocal: (accountId) => ipcRenderer.invoke('configuration-sync:connect-local', accountId),
    run: (action) => ipcRenderer.invoke('configuration-sync:run', action),
    setAutoSync: (enabled) => ipcRenderer.invoke('configuration-sync:set-auto', enabled),
    openFolder: () => ipcRenderer.invoke('configuration-sync:open-folder'),
    disconnect: () => ipcRenderer.invoke('configuration-sync:disconnect'),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]): void => {
        callback(state)
      }
      ipcRenderer.on('configuration-sync:changed', listener)
      return () => ipcRenderer.removeListener('configuration-sync:changed', listener)
    },
  },
}

contextBridge.exposeInMainWorld('desktop', desktopApi)

export type { DesktopApi } from '../shared/desktop-api'
