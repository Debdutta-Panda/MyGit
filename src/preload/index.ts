import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => {
        callback(maximized)
      }
      ipcRenderer.on('window:maximized-changed', listener)
      return () => ipcRenderer.removeListener('window:maximized-changed', listener)
    },
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    remove: (accountId) => ipcRenderer.invoke('accounts:remove', accountId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStateChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]): void => {
        callback(state)
      }
      ipcRenderer.on('updates:state-changed', listener)
      return () => ipcRenderer.removeListener('updates:state-changed', listener)
    },
  },
  terminals: {
    profiles: () => ipcRenderer.invoke('terminals:profiles'),
    create: (input) => ipcRenderer.invoke('terminals:create', input),
    buffer: (id) => ipcRenderer.invoke('terminals:buffer', id),
    write: (id, data) => ipcRenderer.invoke('terminals:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminals:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('terminals:kill', id),
    onData: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, id: string, data: string): void => {
        callback(id, data)
      }
      ipcRenderer.on('terminals:data', listener)
      return () => ipcRenderer.removeListener('terminals:data', listener)
    },
    onExit: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        session: Parameters<typeof callback>[0],
      ): void => callback(session)
      ipcRenderer.on('terminals:exit', listener)
      return () => ipcRenderer.removeListener('terminals:exit', listener)
    },
  },
  localFolders: {
    choose: () => ipcRenderer.invoke('local-folders:choose'),
    list: (rootPath, relativePath = '') =>
      ipcRenderer.invoke('local-folders:list', rootPath, relativePath),
    upload: (input) => ipcRenderer.invoke('local-folders:upload', input),
    onUploadProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]): void => {
        callback(progress)
      }
      ipcRenderer.on('local-folders:upload-progress', listener)
      return () => ipcRenderer.removeListener('local-folders:upload-progress', listener)
    },
  },
  remoteConnections: {
    list: () => ipcRenderer.invoke('remote-connections:list'),
    save: (input) => ipcRenderer.invoke('remote-connections:save', input),
    remove: (id) => ipcRenderer.invoke('remote-connections:remove', id),
    test: (id, trustHostKey = false) =>
      ipcRenderer.invoke('remote-connections:test', id, trustHostKey),
    choosePrivateKey: () => ipcRenderer.invoke('remote-connections:choose-private-key'),
  },
  ssh: {
    list: () => ipcRenderer.invoke('ssh:list'),
    save: (input) => ipcRenderer.invoke('ssh:save', input),
    remove: (id) => ipcRenderer.invoke('ssh:remove', id),
    test: (id, trustHostKey = false) => ipcRenderer.invoke('ssh:test', id, trustHostKey),
    choosePrivateKey: () => ipcRenderer.invoke('ssh:choose-private-key'),
    vaultStatus: () => ipcRenderer.invoke('ssh:vault-status'),
    commandTemplates: (id, kind) => ipcRenderer.invoke('ssh:command-templates', id, kind),
    saveCommandTemplates: (id, kind, templates) =>
      ipcRenderer.invoke('ssh:save-command-templates', id, kind, templates),
    serverOverview: (id) => ipcRenderer.invoke('ssh:server-overview', id),
    apacheOverview: (id) => ipcRenderer.invoke('ssh:apache-overview', id),
    apacheConfiguration: (id) => ipcRenderer.invoke('ssh:apache-configuration', id),
    apacheReadConfig: (id, path) => ipcRenderer.invoke('ssh:apache-read-config', id, path),
    apacheSaveConfig: (id, input) => ipcRenderer.invoke('ssh:apache-save-config', id, input),
    apacheAction: (id, action) => ipcRenderer.invoke('ssh:apache-action', id, action),
    apacheSslOverview: (id) => ipcRenderer.invoke('ssh:apache-ssl-overview', id),
    apacheSslAction: (id, runId, action) => ipcRenderer.invoke('ssh:apache-ssl-action', id, runId, action),
    mysqlOverview: (id) => ipcRenderer.invoke('ssh:mysql-overview', id),
    mysqlAccessProfile: (id) => ipcRenderer.invoke('ssh:mysql-access-profile', id),
    saveMysqlAccess: (id, input) => ipcRenderer.invoke('ssh:save-mysql-access', id, input),
    clearMysqlAccess: (id) => ipcRenderer.invoke('ssh:clear-mysql-access', id),
    mysqlDatabases: (id) => ipcRenderer.invoke('ssh:mysql-databases', id),
    manageMysqlDatabase: (id, operation) => ipcRenderer.invoke('ssh:manage-mysql-database', id, operation),
    mysqlDatabaseDetails: (id, database) => ipcRenderer.invoke('ssh:mysql-database-details', id, database),
    maintainMysqlDatabase: (id, operation) => ipcRenderer.invoke('ssh:maintain-mysql-database', id, operation),
    exportMysql: async (id, input) => {
      const result = await ipcRenderer.invoke('ssh:export-mysql', id, input) as
        { ok: true; value: Awaited<ReturnType<DesktopApi['ssh']['exportMysql']>> } | { ok: false; error: string }
      if (!result.ok) throw new Error(result.error)
      return result.value
    },
    inspectMysqlImport: () => ipcRenderer.invoke('ssh:inspect-mysql-import'),
    cancelMysqlExport: (runId) => ipcRenderer.invoke('ssh:cancel-mysql-export', runId),
    onMysqlExportProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]): void => callback(progress)
      ipcRenderer.on('ssh:mysql-export-progress', listener)
      return () => ipcRenderer.removeListener('ssh:mysql-export-progress', listener)
    },
    mysqlUsers: (id) => ipcRenderer.invoke('ssh:mysql-users', id),
    manageMysqlUser: (id, operation) => ipcRenderer.invoke('ssh:manage-mysql-user', id, operation),
    mysqlSchema: (id, database) => ipcRenderer.invoke('ssh:mysql-schema', id, database),
    runMysqlQuery: async (id, runId, input) => {
      const result = await ipcRenderer.invoke('ssh:run-mysql-query', id, runId, input) as
        { ok: true; value: Awaited<ReturnType<DesktopApi['ssh']['runMysqlQuery']>> } | { ok: false; error: string }
      if (!result.ok) throw new Error(result.error)
      return result.value
    },
    cancelMysqlQuery: (runId) => ipcRenderer.invoke('ssh:cancel-mysql-query', runId),
    mysqlTables: (id, database) => ipcRenderer.invoke('ssh:mysql-tables', id, database),
    mysqlTableDetails: (id, database, table) => ipcRenderer.invoke('ssh:mysql-table-details', id, database, table),
    manageMysqlTable: (id, operation) => ipcRenderer.invoke('ssh:manage-mysql-table', id, operation),
    accountCatalog: (id) => ipcRenderer.invoke('ssh:account-catalog', id),
    authorizedKeys: (id, username) => ipcRenderer.invoke('ssh:authorized-keys', id, username),
    manageAccounts: (id, operation) => ipcRenderer.invoke('ssh:manage-accounts', id, operation),
    previewAccess: (id, input) => ipcRenderer.invoke('ssh:preview-access', id, input),
    applyAccess: (id, input, token, confirmation) => ipcRenderer.invoke('ssh:apply-access', id, input, token, confirmation),
    listDirectory: (id, path = null) => ipcRenderer.invoke('ssh:list-directory', id, path),
    readFile: (id, path) => ipcRenderer.invoke('ssh:read-file', id, path),
    writeFile: (input) => ipcRenderer.invoke('ssh:write-file', input),
    createEntry: (id, parentPath, name, type) =>
      ipcRenderer.invoke('ssh:create-entry', id, parentPath, name, type),
    renameEntry: (id, path, name) => ipcRenderer.invoke('ssh:rename-entry', id, path, name),
    deleteEntry: (id, path) => ipcRenderer.invoke('ssh:delete-entry', id, path),
    chmodEntry: (id, path, permissions) => ipcRenderer.invoke('ssh:chmod-entry', id, path, permissions),
    copyEntry: (id, path, targetDirectory) => ipcRenderer.invoke('ssh:copy-entry', id, path, targetDirectory),
    moveEntry: (id, path, targetDirectory) => ipcRenderer.invoke('ssh:move-entry', id, path, targetDirectory),
    uploadFiles: (id, targetDirectory) => ipcRenderer.invoke('ssh:upload-files', id, targetDirectory),
    downloadFile: (id, path) => ipcRenderer.invoke('ssh:download-file', id, path),
    cancelTransfer: (id) => ipcRenderer.invoke('ssh:cancel-transfer', id),
    onTransferProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]): void => callback(progress)
      ipcRenderer.on('ssh:transfer-progress', listener)
      return () => ipcRenderer.removeListener('ssh:transfer-progress', listener)
    },
    runCommand: (connectionId, runId, command) => ipcRenderer.invoke('ssh:run-command', connectionId, runId, command),
    cancelCommand: (runId) => ipcRenderer.invoke('ssh:cancel-command', runId),
    onCommandOutput: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, output: Parameters<typeof callback>[0]): void => callback(output)
      ipcRenderer.on('ssh:command-output', listener)
      return () => ipcRenderer.removeListener('ssh:command-output', listener)
    },
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
    addLocal: (accountId, initializePlainFolder = false) =>
      ipcRenderer.invoke('repositories:add-local', accountId, initializePlainFolder),
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
    gitWorkingTree: (path, includeIgnored) =>
      ipcRenderer.invoke('repositories:git-working-tree', path, includeIgnored),
    gitWorkingFileContent: (path, file) =>
      ipcRenderer.invoke('repositories:git-working-file-content', path, file),
    gitWorkingFile: (path, file) =>
      ipcRenderer.invoke('repositories:git-working-file', path, file),
    gitSaveWorkingFile: (input) =>
      ipcRenderer.invoke('repositories:git-save-working-file', input),
    gitWorkingFilePreview: (path, file) =>
      ipcRenderer.invoke('repositories:git-working-file-preview', path, file),
    gitChangeAnalytics: (path, range) =>
      ipcRenderer.invoke('repositories:git-change-analytics', path, range),
    gitFileHistory: (path, file) => ipcRenderer.invoke('repositories:git-file-history', path, file),
    gitFileRevisionDiff: (path, commitHash, file) =>
      ipcRenderer.invoke('repositories:git-file-revision-diff', path, commitHash, file),
    gitFileContent: (path, commitHash, file) =>
      ipcRenderer.invoke('repositories:git-file-content', path, commitHash, file),
    gitCompareFileRevisions: (path, fromCommit, fromFile, toCommit, toFile) =>
      ipcRenderer.invoke(
        'repositories:git-compare-file-revisions',
        path,
        fromCommit,
        fromFile,
        toCommit,
        toFile,
      ),
    gitRestoreFile: (path, commitHash, file) =>
      ipcRenderer.invoke('repositories:git-restore-file', path, commitHash, file),
    scanInsights: (path) => ipcRenderer.invoke('repositories:scan-insights', path),
    gitStage: (path, files) => ipcRenderer.invoke('repositories:git-stage', path, files),
    gitUnstage: (path, files) => ipcRenderer.invoke('repositories:git-unstage', path, files),
    gitCommit: (path, message) => ipcRenderer.invoke('repositories:git-commit', path, message),
    gitFetch: (path) => ipcRenderer.invoke('repositories:git-fetch', path),
    gitPull: (path) => ipcRenderer.invoke('repositories:git-pull', path),
    gitPush: (path) => ipcRenderer.invoke('repositories:git-push', path),
    gitBranches: (path) => ipcRenderer.invoke('repositories:git-branches', path),
    gitCheckout: (path, target, strategy) =>
      ipcRenderer.invoke('repositories:git-checkout', path, target, strategy),
    gitCreateBranch: (path, name, startPoint, checkout) =>
      ipcRenderer.invoke('repositories:git-create-branch', path, name, startPoint, checkout),
    gitRenameBranch: (path, oldName, newName) =>
      ipcRenderer.invoke('repositories:git-rename-branch', path, oldName, newName),
    gitDeleteBranch: (path, name, force) =>
      ipcRenderer.invoke('repositories:git-delete-branch', path, name, force),
    gitDeleteRemoteBranch: (path, remote, name) =>
      ipcRenderer.invoke('repositories:git-delete-remote-branch', path, remote, name),
    gitPopStash: (path) => ipcRenderer.invoke('repositories:git-pop-stash', path),
  },
  workingCopies: {
    list: (accountId, fullName) => ipcRenderer.invoke('working-copies:list', accountId, fullName),
    clone: (accountId, fullName, options) =>
      ipcRenderer.invoke('working-copies:clone', accountId, fullName, options),
    locate: (accountId, fullName, label) =>
      ipcRenderer.invoke('working-copies:locate', accountId, fullName, label),
    updateLabel: (id, label) => ipcRenderer.invoke('working-copies:update-label', id, label),
    setAutoPush: (id, mode) => ipcRenderer.invoke('working-copies:set-auto-push', id, mode),
    cancelAutoPush: (id) => ipcRenderer.invoke('working-copies:cancel-auto-push', id),
    autoPushStates: () => ipcRenderer.invoke('working-copies:auto-push-states'),
    setPreferred: (id) => ipcRenderer.invoke('working-copies:set-preferred', id),
    relocate: (id) => ipcRenderer.invoke('working-copies:relocate', id),
    detach: (id) => ipcRenderer.invoke('working-copies:detach', id),
    trash: (id) => ipcRenderer.invoke('working-copies:trash', id),
    createWorktree: (sourceId, branch, createBranch, label) =>
      ipcRenderer.invoke('working-copies:create-worktree', sourceId, branch, createBranch, label),
    setForWorkspace: (workspaceId, workingCopyId) =>
      ipcRenderer.invoke('working-copies:set-for-workspace', workspaceId, workingCopyId),
    workspaceSelections: (workspaceId) =>
      ipcRenderer.invoke('working-copies:workspace-selections', workspaceId),
    provisionWorkspace: (workspaceId, repositoryKeys) =>
      ipcRenderer.invoke('working-copies:provision-workspace', workspaceId, repositoryKeys),
    cloneBatch: (repositoryKeys) =>
      ipcRenderer.invoke('working-copies:clone-batch', repositoryKeys),
    generateCodeWorkspace: (workspaceId) =>
      ipcRenderer.invoke('working-copies:generate-code-workspace', workspaceId),
    onAutoPushState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]): void => callback(state)
      ipcRenderer.on('working-copies:auto-push-state', listener)
      return () => ipcRenderer.removeListener('working-copies:auto-push-state', listener)
    },
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
    workspaceTarget: (workspaceId) =>
      ipcRenderer.invoke('organization:workspace-target', workspaceId),
    connectWorkspaceTarget: (workspaceId, type) =>
      ipcRenderer.invoke('organization:connect-workspace-target', workspaceId, type),
    openWorkspaceTarget: (workspaceId) =>
      ipcRenderer.invoke('organization:open-workspace-target', workspaceId),
    disconnectWorkspaceTarget: (workspaceId) =>
      ipcRenderer.invoke('organization:disconnect-workspace-target', workspaceId),
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
    preferences: () => ipcRenderer.invoke('configuration-sync:preferences'),
    savePreference: (key, value) => ipcRenderer.invoke('configuration-sync:save-preference', key, value),
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
