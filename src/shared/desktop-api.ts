export interface GitHubAccount {
  id: number
  login: string
  name: string | null
  avatarUrl: string
  profileUrl: string
  scopes: string[]
  addedAt: string
}

export interface GitHubDeviceAuthorization {
  requestId: string
  userCode: string
  verificationUri: string
  expiresAt: string
}

export interface GitHubRepository {
  id: number
  accountId: number
  accountLogin: string
  name: string
  fullName: string
  description: string | null
  private: boolean
  fork: boolean
  archived: boolean
  language: string | null
  stars: number
  defaultBranch: string
  updatedAt: string
  profileUrl: string
  localPath: string | null
  lastSyncedAt: string | null
  metadataLoaded: boolean
  workingCopies: RepositoryWorkingCopy[]
  preferredWorkingCopyId: string | null
}

export interface CloneResult {
  path: string
  workingCopy?: RepositoryWorkingCopy
}

export type RepositoryWorkingCopyType = 'clone' | 'worktree' | 'local'

export interface RepositoryWorkingCopy {
  id: string
  provider: 'github'
  accountId: number
  fullName: string
  path: string
  label: string
  type: RepositoryWorkingCopyType
  preferred: boolean
  available: boolean
  createdAt: string
  lastSyncedAt: string | null
  lastOpenedAt: string | null
  lastSeenAt: string | null
}

export interface WorkspaceProvisionResult {
  workspaceId: string
  rootPath: string
  results: Array<{
    repositoryKey: string
    fullName: string
    status: 'cloned' | 'registered' | 'skipped' | 'error'
    workingCopy: RepositoryWorkingCopy | null
    message: string | null
  }>
}

export interface PublishRepositoryInput {
  path: string
  accountId: number
  owner: string
  name: string
  description: string
  private: boolean
}

export interface PublishRepositoryResult {
  repository: GitHubRepository
  status: RepositoryGitStatus
}

export interface ConfigurationSyncState {
  connected: boolean
  localPath: string | null
  accountId: number | null
  fullName: string | null
  autoSync: boolean
  lastSyncedAt: string | null
  lastError: string | null
  hasRemote: boolean
}

export type ConfigurationSyncAction = 'sync' | 'pull' | 'push'

export interface AppSettings {
  vscodeApplicationName: string
  automaticallyCheckForUpdates: boolean
  automaticallyDownloadUpdates: boolean
}

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unavailable'

export interface AppUpdateState {
  phase: AppUpdatePhase
  channel: 'stable'
  currentVersion: string
  availableVersion: string | null
  progress: number | null
  transferred: number | null
  total: number | null
  bytesPerSecond: number | null
  checkedAt: string | null
  message: string | null
  packaged: boolean
}

export interface TerminalProfile {
  id: string
  name: string
  executable: string
  args: string[]
  default: boolean
}

export interface TerminalCreateInput {
  profileId?: string | null
  cwd?: string | null
  sshConnectionId?: string | null
  cols: number
  rows: number
}

export interface TerminalSessionInfo {
  id: string
  title: string
  cwd: string
  profileId: string
  kind: 'local' | 'ssh'
  sshConnectionId: string | null
  status: 'running' | 'exited'
  exitCode: number | null
}

export type SshAuthenticationType = 'password' | 'private-key' | 'agent'

export interface SshConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  authenticationType: SshAuthenticationType
  privateKeyPath: string | null
  agentSocket: string | null
  hasPassword: boolean
  hasPassphrase: boolean
  hostFingerprint: string | null
  createdAt: string
  updatedAt: string
  lastConnectedAt: string | null
}

export interface SshConnectionInput {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authenticationType: SshAuthenticationType
  privateKeyPath?: string | null
  agentSocket?: string | null
  password?: string
  passphrase?: string
}

export interface SshConnectionTestResult {
  status: 'connected' | 'untrusted'
  fingerprint: string
  latencyMs: number | null
  message: string
}

export interface SshVaultStatus {
  available: boolean
  backend: string
  label: string
}

export interface SshServerOverview {
  connectionId: string
  hostname: string
  operatingSystem: string
  kernel: string
  architecture: string
  uptime: string
  loadAverage: string
  homeDirectory: string
  shell: string
  cpuCount: number | null
  cpuUsagePercent: number | null
  totalMemoryBytes: number | null
  freeMemoryBytes: number | null
  swapTotalBytes: number | null
  swapUsedBytes: number | null
  diskTotalBytes: number | null
  diskUsedBytes: number | null
  diskAvailableBytes: number | null
  processCount: number | null
  serverTime: string
  timezone: string
  privateAddresses: string[]
  publicAddress: string | null
  networkReceivedBytes: number | null
  networkSentBytes: number | null
  rebootRequired: boolean | null
  partitions: SshDiskPartition[]
  fetchedAt: string
}

export interface SshDiskPartition {
  filesystem: string
  mountPoint: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usagePercent: number
}

export interface SshRemoteEntry {
  name: string
  path: string
  type: 'directory' | 'file' | 'link' | 'other'
  size: number
  modifiedAt: string | null
  permissions: string
}

export interface SshDirectoryListing {
  connectionId: string
  path: string
  parentPath: string | null
  entries: SshRemoteEntry[]
}

export interface SshRemoteFileContent {
  connectionId: string
  path: string
  name: string
  size: number
  modifiedAt: string
  etag: string
  permissions: string
  mimeType: string
  presentation: 'text' | 'image' | 'pdf' | 'binary'
  content: string | null
  dataUrl: string | null
  writable: boolean
}

export interface SshRemoteFileWriteInput {
  connectionId: string
  path: string
  content: string
  expectedModifiedAt: string
  expectedEtag: string
}

export interface RepositoryGitStatus {
  path: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicts: number
  clean: boolean
  error: string | null
}

export interface RepositoryChangedFile {
  path: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
}

export interface RepositoryGitDetails {
  status: RepositoryGitStatus
  files: RepositoryChangedFile[]
}

export interface RepositoryCommit {
  hash: string
  shortHash: string
  author: string
  authorEmail: string
  authorLogin: string | null
  authorAvatarUrl: string | null
  authorProfileUrl: string | null
  authoredAt: string
  committedAt: string
  subject: string
  unpushed: boolean
  pushedAt: string | null
}

export interface RepositoryCommitFile {
  path: string
  status: string
}

export interface RepositoryWorkingTreeFile {
  path: string
  tracked: boolean
  ignored: boolean
}

export interface RepositoryFilePreview {
  mimeType: string
  dataUrl: string
  size: number
}

export type RepositoryAnalyticsRange = '7d' | '30d' | '90d' | '1y' | 'all'

export interface RepositoryChangeFileStat {
  path: string
  additions: number
  deletions: number
  binary: boolean
}

export interface RepositoryChangeCommit {
  hash: string
  shortHash: string
  author: string
  authorEmail: string
  committedAt: string
  subject: string
  files: RepositoryChangeFileStat[]
}

export interface RepositoryChangeAnalytics {
  range: RepositoryAnalyticsRange
  commits: RepositoryChangeCommit[]
  truncated: boolean
  maxCommits: number
}

export interface RepositoryFileRevision extends RepositoryCommit {
  path: string
  previousPath: string | null
  status: string
}

export type RepositoryBranchKind = 'local' | 'remote'
export type RepositoryCheckoutStrategy = 'require-clean' | 'carry' | 'stash'

export interface RepositoryBranch {
  name: string
  ref: string
  kind: RepositoryBranchKind
  remote: string | null
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  commitHash: string
  committedAt: string | null
  checkedOutPath: string | null
}

export interface RepositoryBranchState {
  currentBranch: string | null
  currentCommit: string
  detached: boolean
  stashCount: number
  branches: RepositoryBranch[]
}

export interface RepositoryCheckoutTarget {
  kind: RepositoryBranchKind | 'commit'
  ref: string
  name: string
}

export type ProjectInsightFileCategory =
  | 'source'
  | 'text'
  | 'config'
  | 'asset'
  | 'archive'
  | 'binary'

export interface ProjectInsightFile {
  path: string
  extension: string
  category: ProjectInsightFileCategory
  language: string | null
  size: number
  lines: number
  codeLines: number
  commentLines: number
  blankLines: number
  projectPath: string
}

export interface ProjectInsightLanguage {
  name: string
  files: number
  lines: number
  codeLines: number
  commentLines: number
  blankLines: number
}

export interface ProjectInsightTechnology {
  name: string
  category: 'framework' | 'library' | 'runtime' | 'tool'
  version: string | null
  confidence: 'confirmed' | 'likely'
  evidence: string[]
}

export interface ProjectInsightProject {
  path: string
  name: string
  markers: string[]
  files: number
  lines: number
}

export interface ProjectInsightsResult {
  rootPath: string
  scannedAt: string
  durationMs: number
  files: ProjectInsightFile[]
  languages: ProjectInsightLanguage[]
  technologies: ProjectInsightTechnology[]
  projects: ProjectInsightProject[]
  totals: {
    files: number
    textFiles: number
    binaryFiles: number
    assets: number
    bytes: number
    lines: number
    codeLines: number
    commentLines: number
    blankLines: number
  }
  warnings: string[]
}

export type OrganizationKind = 'workspace' | 'group' | 'tag'

export interface OrganizationItem {
  id: string
  kind: OrganizationKind
  name: string
  color: string
  description: string | null
  repositoryCount: number
}

export interface OrganizationCatalog {
  workspaces: OrganizationItem[]
  groups: OrganizationItem[]
  tags: OrganizationItem[]
}

export interface WorkspaceLaunchTarget {
  workspaceId: string
  type: 'folder' | 'code-workspace'
  path: string
}

export interface RepositoryOrganization {
  workspaceIds: string[]
  groupIds: string[]
  tagIds: string[]
}

export interface RepositoryOrganizationEntry extends RepositoryOrganization {
  repositoryKey: string
}

export interface RepositoryAppearanceEntry {
  repositoryKey: string
  color: string | null
}

export interface DesktopApi {
  platform: NodeJS.Platform
  versions: {
    electron: string
    chrome: string
    node: string
  }
  windowControls: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void
  }
  accounts: {
    list: () => Promise<GitHubAccount[]>
    remove: (accountId: number) => Promise<GitHubAccount[]>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (settings: AppSettings) => Promise<AppSettings>
  }
  updates: {
    getState: () => Promise<AppUpdateState>
    check: () => Promise<AppUpdateState>
    download: () => Promise<AppUpdateState>
    install: () => Promise<void>
    onStateChanged: (callback: (state: AppUpdateState) => void) => () => void
  }
  terminals: {
    profiles: () => Promise<TerminalProfile[]>
    create: (input: TerminalCreateInput) => Promise<TerminalSessionInfo>
    buffer: (id: string) => Promise<string>
    write: (id: string, data: string) => Promise<void>
    resize: (id: string, cols: number, rows: number) => Promise<void>
    kill: (id: string) => Promise<void>
    onData: (callback: (id: string, data: string) => void) => () => void
    onExit: (callback: (session: TerminalSessionInfo) => void) => () => void
  }
  ssh: {
    list: () => Promise<SshConnection[]>
    save: (input: SshConnectionInput) => Promise<SshConnection[]>
    remove: (id: string) => Promise<SshConnection[]>
    test: (id: string, trustHostKey?: boolean) => Promise<SshConnectionTestResult>
    choosePrivateKey: () => Promise<string | null>
    vaultStatus: () => Promise<SshVaultStatus>
    serverOverview: (id: string) => Promise<SshServerOverview>
    listDirectory: (id: string, path?: string | null) => Promise<SshDirectoryListing>
    readFile: (id: string, path: string) => Promise<SshRemoteFileContent>
    writeFile: (input: SshRemoteFileWriteInput) => Promise<SshRemoteFileContent>
  }
  github: {
    start: () => Promise<GitHubDeviceAuthorization>
    launch: (requestId: string) => Promise<void>
    waitForAuthorization: (requestId: string) => Promise<GitHubAccount>
    cancel: (requestId: string) => Promise<void>
  }
  repositories: {
    listCloned: (accountId: number | null) => Promise<GitHubRepository[]>
    list: (accountId: number | null) => Promise<GitHubRepository[]>
    clone: (accountId: number, fullName: string) => Promise<CloneResult | null>
    locate: (accountId: number, fullName: string) => Promise<CloneResult | null>
    addLocal: (
      accountId: number | null,
      initializePlainFolder?: boolean,
    ) => Promise<GitHubRepository | null>
    publish: (input: PublishRepositoryInput) => Promise<PublishRepositoryResult>
    openFolder: (path: string) => Promise<void>
    openInVSCode: (path: string) => Promise<void>
    monitor: (paths: string[]) => Promise<RepositoryGitStatus[]>
    onStatusChanged: (callback: (status: RepositoryGitStatus) => void) => () => void
    gitDetails: (path: string) => Promise<RepositoryGitDetails>
    gitDiff: (path: string, file: string, staged: boolean) => Promise<string>
    gitHistory: (path: string) => Promise<RepositoryCommit[]>
    gitCommitDiff: (path: string, commitHash: string) => Promise<string>
    gitCommitFiles: (path: string, commitHash: string) => Promise<RepositoryCommitFile[]>
    gitCommitFileDiff: (path: string, commitHash: string, file: string) => Promise<string>
    gitWorkingTree: (path: string, includeIgnored: boolean) => Promise<RepositoryWorkingTreeFile[]>
    gitWorkingFileContent: (path: string, file: string) => Promise<string>
    gitWorkingFilePreview: (path: string, file: string) => Promise<RepositoryFilePreview>
    gitChangeAnalytics: (
      path: string,
      range: RepositoryAnalyticsRange,
    ) => Promise<RepositoryChangeAnalytics>
    gitFileHistory: (path: string, file: string) => Promise<RepositoryFileRevision[]>
    gitFileRevisionDiff: (path: string, commitHash: string, file: string) => Promise<string>
    gitFileContent: (path: string, commitHash: string, file: string) => Promise<string>
    gitCompareFileRevisions: (
      path: string,
      fromCommit: string,
      fromFile: string,
      toCommit: string,
      toFile: string,
    ) => Promise<string>
    gitRestoreFile: (path: string, commitHash: string, file: string) => Promise<RepositoryGitDetails>
    scanInsights: (path: string) => Promise<ProjectInsightsResult>
    gitStage: (path: string, files: string[]) => Promise<RepositoryGitDetails>
    gitUnstage: (path: string, files: string[]) => Promise<RepositoryGitDetails>
    gitCommit: (path: string, message: string) => Promise<RepositoryGitDetails>
    gitFetch: (path: string) => Promise<RepositoryGitDetails>
    gitPull: (path: string) => Promise<RepositoryGitDetails>
    gitPush: (path: string) => Promise<RepositoryGitDetails>
    gitBranches: (path: string) => Promise<RepositoryBranchState>
    gitCheckout: (
      path: string,
      target: RepositoryCheckoutTarget,
      strategy: RepositoryCheckoutStrategy,
    ) => Promise<RepositoryBranchState>
    gitCreateBranch: (
      path: string,
      name: string,
      startPoint: string,
      checkout: boolean,
    ) => Promise<RepositoryBranchState>
    gitRenameBranch: (path: string, oldName: string, newName: string) => Promise<RepositoryBranchState>
    gitDeleteBranch: (path: string, name: string, force: boolean) => Promise<RepositoryBranchState>
    gitDeleteRemoteBranch: (path: string, remote: string, name: string) => Promise<RepositoryBranchState>
    gitPopStash: (path: string) => Promise<RepositoryBranchState>
  }
  workingCopies: {
    list: (accountId: number, fullName: string) => Promise<RepositoryWorkingCopy[]>
    clone: (
      accountId: number,
      fullName: string,
      options?: { folderName?: string; label?: string },
    ) => Promise<CloneResult | null>
    locate: (
      accountId: number,
      fullName: string,
      label?: string,
    ) => Promise<RepositoryWorkingCopy | null>
    updateLabel: (id: string, label: string) => Promise<RepositoryWorkingCopy>
    setPreferred: (id: string) => Promise<RepositoryWorkingCopy[]>
    relocate: (id: string) => Promise<RepositoryWorkingCopy | null>
    detach: (id: string) => Promise<void>
    trash: (id: string) => Promise<void>
    createWorktree: (
      sourceId: string,
      branch: string,
      createBranch: boolean,
      label?: string,
    ) => Promise<RepositoryWorkingCopy | null>
    setForWorkspace: (workspaceId: string, workingCopyId: string) => Promise<void>
    workspaceSelections: (workspaceId: string) => Promise<Record<string, string>>
    provisionWorkspace: (
      workspaceId: string,
      repositoryKeys: string[],
    ) => Promise<WorkspaceProvisionResult | null>
    cloneBatch: (repositoryKeys: string[]) => Promise<WorkspaceProvisionResult | null>
    generateCodeWorkspace: (workspaceId: string) => Promise<WorkspaceLaunchTarget>
  }
  organization: {
    list: () => Promise<OrganizationCatalog>
    create: (
      kind: OrganizationKind,
      input: { name: string; color: string; description?: string },
    ) => Promise<OrganizationItem>
    update: (
      kind: OrganizationKind,
      id: string,
      input: { name: string; color: string; description?: string },
    ) => Promise<OrganizationItem>
    remove: (kind: OrganizationKind, id: string) => Promise<void>
    assignments: () => Promise<RepositoryOrganizationEntry[]>
    appearances: () => Promise<RepositoryAppearanceEntry[]>
    saveRepositoryColor: (
      accountId: number,
      fullName: string,
      color: string | null,
    ) => Promise<RepositoryAppearanceEntry>
    workspaceOrder: (workspaceId: string) => Promise<string[]>
    reorderWorkspace: (workspaceId: string, repositoryKeys: string[]) => Promise<string[]>
    workspaceTarget: (workspaceId: string) => Promise<WorkspaceLaunchTarget | null>
    connectWorkspaceTarget: (
      workspaceId: string,
      type: WorkspaceLaunchTarget['type'],
    ) => Promise<WorkspaceLaunchTarget | null>
    openWorkspaceTarget: (workspaceId: string) => Promise<void>
    disconnectWorkspaceTarget: (workspaceId: string) => Promise<void>
    saveRepository: (
      accountId: number,
      fullName: string,
      organization: RepositoryOrganization,
    ) => Promise<RepositoryOrganizationEntry>
  }
  configurationSync: {
    get: () => Promise<ConfigurationSyncState>
    create: (input: {
      accountId: number
      owner: string
      name: string
      private: boolean
    }) => Promise<ConfigurationSyncState>
    connectRemote: (accountId: number, fullName: string) => Promise<ConfigurationSyncState>
    connectLocal: (accountId: number) => Promise<ConfigurationSyncState | null>
    run: (action: ConfigurationSyncAction) => Promise<ConfigurationSyncState>
    setAutoSync: (enabled: boolean) => Promise<ConfigurationSyncState>
    openFolder: () => Promise<void>
    disconnect: () => Promise<ConfigurationSyncState>
    onChanged: (callback: (state: ConfigurationSyncState) => void) => () => void
  }
}
