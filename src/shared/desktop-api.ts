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
}

export interface CloneResult {
  path: string
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
  authoredAt: string
  subject: string
}

export interface RepositoryCommitFile {
  path: string
  status: string
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
  accounts: {
    list: () => Promise<GitHubAccount[]>
    remove: (accountId: number) => Promise<GitHubAccount[]>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (settings: AppSettings) => Promise<AppSettings>
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
    addLocal: (accountId: number | null) => Promise<GitHubRepository | null>
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
    gitStage: (path: string, files: string[]) => Promise<RepositoryGitDetails>
    gitUnstage: (path: string, files: string[]) => Promise<RepositoryGitDetails>
    gitCommit: (path: string, message: string) => Promise<RepositoryGitDetails>
    gitFetch: (path: string) => Promise<RepositoryGitDetails>
    gitPull: (path: string) => Promise<RepositoryGitDetails>
    gitPush: (path: string) => Promise<RepositoryGitDetails>
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
