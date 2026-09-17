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
}
