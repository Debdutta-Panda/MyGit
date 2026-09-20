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

export interface SshCommandOutput {
  id: string
  stream: 'stdout' | 'stderr'
  data: string
}

export interface SshCommandResult {
  id: string
  exitCode: number | null
  signal: string | null
  cancelled: boolean
  startedAt: string
  finishedAt: string
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

export interface SshMySqlOverview {
  connectionId: string
  installed: boolean
  engine: 'mysql' | 'mariadb' | 'unknown'
  serverInstalled: boolean
  clientInstalled: boolean
  version: string | null
  clientVersion: string | null
  serverExecutable: string | null
  clientExecutable: string | null
  serviceName: string | null
  serviceState: string
  serviceEnabled: boolean | null
  processId: number | null
  activeSince: string | null
  port: number | null
  socket: string | null
  bindAddress: string | null
  dataDirectory: string | null
  configFiles: string[]
  packageManager: string | null
  operatingSystem: string
  diskTotalBytes: number | null
  diskUsedBytes: number | null
  diskAvailableBytes: number | null
  clientTools: string[]
  administrativeAccess: 'not-configured'
  fetchedAt: string
}

export type SshMySqlAccessMode = 'system' | 'password'

export interface SshMySqlAccessProfile {
  connectionId: string
  mode: SshMySqlAccessMode
  username: string
  hasPassword: boolean
  updatedAt: string | null
}

export interface SshMySqlAccessInput {
  mode: SshMySqlAccessMode
  username: string
  password: string
}

export interface SshMySqlDatabase {
  name: string
  characterSet: string
  collation: string
  tableCount: number
  sizeBytes: number
  system: boolean
}

export type SshMySqlDatabaseOperation =
  | { kind: 'create'; name: string; characterSet: string; collation: string }
  | { kind: 'drop'; name: string; confirmation: string }

export interface SshMySqlDatabaseGrant {
  database: string
  privileges: string[]
  grantable: boolean
}

export interface SshMySqlUser {
  username: string
  host: string
  plugin: string
  system: boolean
  globalPrivileges: string[]
  databaseGrants: SshMySqlDatabaseGrant[]
}

export type SshMySqlUserOperation =
  | { kind: 'create'; username: string; host: string; password: string; database: string | null; privileges: string[] }
  | { kind: 'set-database-access'; username: string; host: string; database: string; privileges: string[] }
  | { kind: 'set-password'; username: string; host: string; password: string }
  | { kind: 'drop'; username: string; host: string; confirmation: string }

export interface SshMySqlSchemaColumn {
  database: string
  table: string
  name: string
  dataType: string
  nullable: boolean
  key: string
}

export interface SshMySqlQueryInput {
  database: string | null
  sql: string
  rowLimit: number
  readOnly: boolean
  destructiveConfirmation: string | null
}

export interface SshMySqlQueryResultSet {
  columns: string[]
  rows: Array<Array<string | number | boolean | null>>
  affectedRows: number | null
  insertId: string | number | null
  warningCount: number | null
  truncated: boolean
}

export interface SshMySqlQueryResult {
  runId: string
  durationMs: number
  resultSets: SshMySqlQueryResultSet[]
  executedAt: string
}

export interface SshMySqlTable {
  database: string
  name: string
  type: 'table' | 'view'
  engine: string | null
  rows: number | null
  dataBytes: number
  indexBytes: number
  collation: string | null
  createdAt: string | null
  updatedAt: string | null
  comment: string
}

export interface SshMySqlTableColumn {
  name: string
  ordinal: number
  dataType: string
  columnType: string
  nullable: boolean
  defaultValue: string | null
  key: string
  extra: string
  collation: string | null
  comment: string
}

export interface SshMySqlTableIndex {
  name: string
  unique: boolean
  type: string
  columns: string[]
}

export interface SshMySqlForeignKey {
  name: string
  column: string
  referencedDatabase: string
  referencedTable: string
  referencedColumn: string
  updateRule: string
  deleteRule: string
}

export interface SshMySqlTrigger {
  name: string
  timing: string
  event: string
  statement: string
  createdAt: string | null
}

export interface SshMySqlTableDetails {
  table: SshMySqlTable
  columns: SshMySqlTableColumn[]
  indexes: SshMySqlTableIndex[]
  foreignKeys: SshMySqlForeignKey[]
  triggers: SshMySqlTrigger[]
}

export type SshMySqlTableOperation =
  | { kind: 'add-column'; database: string; table: string; name: string; columnType: string; nullable: boolean; defaultMode: 'none' | 'null' | 'current-timestamp'; autoIncrement: boolean; after: string | null }
  | { kind: 'alter-column'; database: string; table: string; oldName: string; name: string; columnType: string; nullable: boolean; defaultMode: 'none' | 'null' | 'current-timestamp'; autoIncrement: boolean }
  | { kind: 'drop-column'; database: string; table: string; name: string; confirmation: string }
  | { kind: 'create-index'; database: string; table: string; name: string; columns: string[]; unique: boolean }
  | { kind: 'drop-index'; database: string; table: string; name: string; confirmation: string }

export interface SshServerUser {
  username: string
  uid: number
  gid: number
  displayName: string
  homeDirectory: string
  shell: string
  primaryGroup: string
  groups: string[]
  system: boolean
  locked: boolean | null
  administrator: boolean
}

export interface SshServerGroup {
  name: string
  gid: number
  members: string[]
  system: boolean
  administrator: boolean
}

export interface SshAccountCatalog {
  connectionId: string
  currentUser: string
  canManage: boolean
  privilegeMessage: string
  uidMinimum: number
  administratorGroups: string[]
  users: SshServerUser[]
  groups: SshServerGroup[]
  fetchedAt: string
}

export type SshAccountOperation =
  | { kind: 'create-user'; username: string; displayName: string; homeDirectory: string; shell: string; primaryGroup: string; groups: string[]; password: string }
  | { kind: 'update-user'; username: string; newUsername: string; displayName: string; homeDirectory: string; shell: string; primaryGroup: string; groups: string[]; moveHome: boolean }
  | { kind: 'set-password'; username: string; password: string }
  | { kind: 'set-locked'; username: string; locked: boolean }
  | { kind: 'set-administrator'; username: string; administrator: boolean }
  | { kind: 'set-authorized-keys'; username: string; content: string }
  | { kind: 'delete-user'; username: string; removeHome: boolean }
  | { kind: 'create-group'; group: string }
  | { kind: 'rename-group'; group: string; newGroup: string }
  | { kind: 'set-group-members'; group: string; members: string[] }
  | { kind: 'delete-group'; group: string }

export interface SshAccessAclEntry {
  kind: 'user' | 'group'
  name: string
  permissions: string | null
  default: boolean
}

export interface SshAccessChangeInput {
  path: string
  owner: string | null
  group: string | null
  permissions: string | null
  directoryPermissions: string | null
  filePermissions: string | null
  recursive: boolean
  crossFilesystem: boolean
  acl: SshAccessAclEntry[]
}

export interface SshAccessPreview {
  connectionId: string
  resolvedPath: string
  type: 'directory' | 'file' | 'link' | 'other'
  symlinkTarget: string | null
  owner: string
  group: string
  permissions: string
  aclSupported: boolean
  currentAcl: string[]
  affectedCount: number
  countTruncated: boolean
  risk: 'normal' | 'elevated' | 'dangerous' | 'blocked'
  warnings: string[]
  operations: string[]
  token: string
  confirmationPhrase: string | null
}

export interface SshAccessApplyResult {
  path: string
  affectedCount: number
  appliedAt: string
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

export interface SshRemoteEntryMutationResult {
  connectionId: string
  path: string
  parentPath: string
}

export interface SshTransferProgress {
  id: string
  direction: 'upload' | 'download'
  name: string
  transferredBytes: number
  totalBytes: number
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  error: string | null
}

export interface SshTransferResult {
  id: string
  paths: string[]
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
    mysqlOverview: (id: string) => Promise<SshMySqlOverview>
    mysqlAccessProfile: (id: string) => Promise<SshMySqlAccessProfile | null>
    saveMysqlAccess: (id: string, input: SshMySqlAccessInput) => Promise<SshMySqlAccessProfile>
    clearMysqlAccess: (id: string) => Promise<void>
    mysqlDatabases: (id: string) => Promise<SshMySqlDatabase[]>
    manageMysqlDatabase: (id: string, operation: SshMySqlDatabaseOperation) => Promise<SshMySqlDatabase[]>
    mysqlUsers: (id: string) => Promise<SshMySqlUser[]>
    manageMysqlUser: (id: string, operation: SshMySqlUserOperation) => Promise<SshMySqlUser[]>
    mysqlSchema: (id: string, database: string | null) => Promise<SshMySqlSchemaColumn[]>
    runMysqlQuery: (id: string, runId: string, input: SshMySqlQueryInput) => Promise<SshMySqlQueryResult>
    cancelMysqlQuery: (runId: string) => Promise<void>
    mysqlTables: (id: string, database: string) => Promise<SshMySqlTable[]>
    mysqlTableDetails: (id: string, database: string, table: string) => Promise<SshMySqlTableDetails>
    manageMysqlTable: (id: string, operation: SshMySqlTableOperation) => Promise<SshMySqlTableDetails>
    accountCatalog: (id: string) => Promise<SshAccountCatalog>
    authorizedKeys: (id: string, username: string) => Promise<string>
    manageAccounts: (id: string, operation: SshAccountOperation) => Promise<SshAccountCatalog>
    previewAccess: (id: string, input: SshAccessChangeInput) => Promise<SshAccessPreview>
    applyAccess: (id: string, input: SshAccessChangeInput, token: string, confirmation: string) => Promise<SshAccessApplyResult>
    listDirectory: (id: string, path?: string | null) => Promise<SshDirectoryListing>
    readFile: (id: string, path: string) => Promise<SshRemoteFileContent>
    writeFile: (input: SshRemoteFileWriteInput) => Promise<SshRemoteFileContent>
    createEntry: (
      id: string,
      parentPath: string,
      name: string,
      type: 'file' | 'directory',
    ) => Promise<SshRemoteEntryMutationResult>
    renameEntry: (id: string, path: string, name: string) => Promise<SshRemoteEntryMutationResult>
    deleteEntry: (id: string, path: string) => Promise<SshRemoteEntryMutationResult>
    chmodEntry: (id: string, path: string, permissions: string) => Promise<SshRemoteEntryMutationResult>
    copyEntry: (id: string, path: string, targetDirectory: string) => Promise<SshRemoteEntryMutationResult>
    moveEntry: (id: string, path: string, targetDirectory: string) => Promise<SshRemoteEntryMutationResult>
    uploadFiles: (id: string, targetDirectory: string) => Promise<SshTransferResult | null>
    downloadFile: (id: string, path: string) => Promise<SshTransferResult | null>
    cancelTransfer: (id: string) => Promise<void>
    onTransferProgress: (callback: (progress: SshTransferProgress) => void) => () => void
    runCommand: (connectionId: string, runId: string, command: string) => Promise<SshCommandResult>
    cancelCommand: (runId: string) => Promise<void>
    onCommandOutput: (callback: (output: SshCommandOutput) => void) => () => void
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
