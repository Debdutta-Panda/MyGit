import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  getAccountCredentials,
  listAccounts,
  saveAccount,
  type GitHubCredentials,
} from './account-store'
import { githubClientId } from './github-auth'
import { getAppSettings } from './settings-store'
import { monitorRepositories } from './repository-monitor'
import type { CloneResult, GitHubRepository } from '../shared/desktop-api'

const GITHUB_API_VERSION = '2022-11-28'
const repositoryNamePattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

interface CloneRecord {
  accountId: number
  fullName: string
  path: string
  clonedAt: string
  lastSyncedAt?: string | null
}

interface RefreshTokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

interface GitHubRepositoryResponse {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  fork: boolean
  archived: boolean
  language: string | null
  stargazers_count: number
  default_branch: string
  updated_at: string
  html_url: string
}

const cloneRecordsPath = (): string => join(app.getPath('userData'), 'clones.json')

export const readCloneRecords = async (): Promise<CloneRecord[]> => {
  try {
    const parsed = JSON.parse(await readFile(cloneRecordsPath(), 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed as CloneRecord[] : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const writeCloneRecords = async (records: CloneRecord[]): Promise<void> => {
  const destination = cloneRecordsPath()
  const temporary = `${destination}.tmp`
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, destination)
  await chmod(destination, 0o600)
}

const isGitRepository = async (path: string): Promise<boolean> => {
  try {
    await stat(join(path, '.git'))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export const verifiedClonePath = async (path: unknown): Promise<string> => {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Invalid cloned repository path.')
  }

  const resolvedPath = resolve(path)
  const records = await readCloneRecords()
  const knownClone = records.some((record) => resolve(record.path) === resolvedPath)
  if (!knownClone || !(await isGitRepository(resolvedPath))) {
    throw new Error('The cloned repository folder is no longer available.')
  }

  return resolvedPath
}

const hasMatchingGitHubOrigin = async (path: string, fullName: string): Promise<boolean> => {
  try {
    const config = await readFile(join(path, '.git', 'config'), 'utf8')
    const expectedPath = `${fullName}.git`.toLowerCase()
    const originUrls = [...config.matchAll(/^\s*url\s*=\s*(.+)\s*$/gm)]
      .map((match) => match[1]?.trim().toLowerCase())
      .filter((url): url is string => Boolean(url))

    return originUrls.some((url) =>
      url.endsWith(`github.com/${expectedPath}`) || url.endsWith(`github.com:${expectedPath}`),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const recordClone = async (accountId: number, fullName: string, path: string): Promise<void> => {
  const records = await readCloneRecords()
  const existing = records.find(
    (record) => record.accountId === accountId && record.fullName === fullName,
  )
  const remaining = records.filter(
    (record) => !(record.accountId === accountId && record.fullName === fullName),
  )
  remaining.push({
    accountId,
    fullName,
    path,
    clonedAt: existing?.clonedAt ?? new Date().toISOString(),
    lastSyncedAt: existing?.lastSyncedAt ?? null,
  })
  await writeCloneRecords(remaining)
}

export const markRepositorySynced = async (path: string): Promise<string> => {
  const records = await readCloneRecords()
  const record = records.find((item) => resolve(item.path) === resolve(path))
  if (!record) throw new Error('The repository is not registered as a local clone.')
  const syncedAt = new Date().toISOString()
  record.lastSyncedAt = syncedAt
  await writeCloneRecords(records)
  return syncedAt
}

const clonePathsForAccount = async (
  accountId: number,
): Promise<Map<string, { path: string; lastSyncedAt: string | null }>> => {
  const records = await readCloneRecords()
  const paths = new Map<string, { path: string; lastSyncedAt: string | null }>()

  await Promise.all(
    records
      .filter((record) => record.accountId === accountId)
      .map(async (record) => {
        if (await isGitRepository(record.path)) {
          paths.set(record.fullName, {
            path: record.path,
            lastSyncedAt: record.lastSyncedAt ?? null,
          })
        }
      }),
  )
  return paths
}

export const refreshedCredentials = async (
  accountId: number,
  force = false,
): Promise<{ accountLogin: string; token: string }> => {
  const { account, credentials } = await getAccountCredentials(accountId)
  const expiresAt = credentials.accessTokenExpiresAt
    ? new Date(credentials.accessTokenExpiresAt).getTime()
    : null

  if (!force && (!expiresAt || expiresAt > Date.now() + 60_000)) {
    return { accountLogin: account.login, token: credentials.accessToken }
  }

  if (!credentials.refreshToken) {
    throw new Error(`Reconnect @${account.login} to renew its GitHub access.`)
  }

  if (
    credentials.refreshTokenExpiresAt &&
    new Date(credentials.refreshTokenExpiresAt).getTime() <= Date.now()
  ) {
    throw new Error(`Reconnect @${account.login}; its GitHub authorization has expired.`)
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'MyRepos',
    },
    body: new URLSearchParams({
      client_id: githubClientId(),
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    }),
  })
  const body = (await response.json()) as RefreshTokenResponse

  if (!response.ok || body.error || !body.access_token) {
    throw new Error(body.error_description ?? `Reconnect @${account.login} to GitHub.`)
  }

  const now = Date.now()
  const nextCredentials: GitHubCredentials = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    accessTokenExpiresAt: body.expires_in
      ? new Date(now + body.expires_in * 1000).toISOString()
      : null,
    refreshTokenExpiresAt: body.refresh_token_expires_in
      ? new Date(now + body.refresh_token_expires_in * 1000).toISOString()
      : null,
    tokenType: body.token_type ?? credentials.tokenType,
  }
  const scopes = (body.scope ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)

  await saveAccount(
    { ...account, scopes: scopes.length > 0 ? scopes : account.scopes },
    nextCredentials,
  )
  return { accountLogin: account.login, token: nextCredentials.accessToken }
}

const fetchRepositories = async (
  token: string,
): Promise<Array<Omit<GitHubRepository, 'accountId' | 'accountLogin'>>> => {
  const repositories: Array<Omit<GitHubRepository, 'accountId' | 'accountLogin'>> = []

  for (let page = 1; page <= 100; page += 1) {
    const url = new URL('https://api.github.com/user/repos')
    url.searchParams.set('affiliation', 'owner,collaborator,organization_member')
    url.searchParams.set('visibility', 'all')
    url.searchParams.set('sort', 'updated')
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'MyRepos',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    })

    if (!response.ok) {
      const error = new Error(`GitHub repository request failed (HTTP ${response.status}).`)
      Object.assign(error, { status: response.status })
      throw error
    }

    const pageItems = (await response.json()) as GitHubRepositoryResponse[]
    repositories.push(
      ...pageItems.map((repository) => ({
        id: repository.id,
        name: repository.name,
        fullName: repository.full_name,
        description: repository.description,
        private: repository.private,
        fork: repository.fork,
        archived: repository.archived,
        language: repository.language,
        stars: repository.stargazers_count,
        defaultBranch: repository.default_branch,
        updatedAt: repository.updated_at,
        profileUrl: repository.html_url,
        localPath: null,
        lastSyncedAt: null,
        metadataLoaded: true,
      })),
    )

    if (pageItems.length < 100) break
  }

  return repositories
}

const listRepositories = async (accountId: number): Promise<GitHubRepository[]> => {
  let auth = await refreshedCredentials(accountId)
  let repositories: Array<Omit<GitHubRepository, 'accountId' | 'accountLogin'>>

  try {
    repositories = await fetchRepositories(auth.token)
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 401) throw error
    auth = await refreshedCredentials(accountId, true)
    repositories = await fetchRepositories(auth.token)
  }

  const clonePaths = await clonePathsForAccount(accountId)
  return repositories.map((repository) => ({
    ...repository,
    accountId,
    accountLogin: auth.accountLogin,
    localPath: clonePaths.get(repository.fullName)?.path ?? null,
    lastSyncedAt: clonePaths.get(repository.fullName)?.lastSyncedAt ?? null,
  }))
}

const listRepositoriesForSelection = async (
  accountId: number | null,
): Promise<GitHubRepository[]> => {
  if (accountId !== null) return listRepositories(accountId)

  const accounts = await listAccounts()
  const repositories = (await Promise.all(
    accounts.map((account) => listRepositories(account.id)),
  )).flat()
  const uniqueRepositories = new Map<string, GitHubRepository>()

  for (const repository of repositories) {
    const key = repository.fullName.toLowerCase()
    const existing = uniqueRepositories.get(key)
    if (!existing || (!existing.localPath && repository.localPath)) {
      uniqueRepositories.set(key, repository)
    }
  }

  return [...uniqueRepositories.values()].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )
}

const listClonedRepositoriesForSelection = async (
  accountId: number | null,
): Promise<GitHubRepository[]> => {
  const [records, accounts] = await Promise.all([readCloneRecords(), listAccounts()])
  const accountLogins = new Map(accounts.map((account) => [account.id, account.login]))
  const selectedRecords = records.filter(
    (record) => accountId === null || record.accountId === accountId,
  )
  const availableRecords = (await Promise.all(
    selectedRecords.map(async (record) => await isGitRepository(record.path) ? record : null),
  )).filter((record): record is CloneRecord => record !== null)

  return availableRecords
    .map((record) => {
      const [owner, name] = record.fullName.split('/', 2)
      return {
        id: 0,
        accountId: record.accountId,
        accountLogin: accountLogins.get(record.accountId) ?? owner,
        name,
        fullName: record.fullName,
        description: null,
        private: false,
        fork: false,
        archived: false,
        language: null,
        stars: 0,
        defaultBranch: '',
        updatedAt: record.clonedAt,
        profileUrl: `https://github.com/${record.fullName}`,
        localPath: record.path,
        lastSyncedAt: record.lastSyncedAt ?? null,
        metadataLoaded: false,
      }
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export const askPassPath = async (): Promise<string> => {
  const directory = join(app.getPath('userData'), 'git-helpers')
  await mkdir(directory, { recursive: true })

  if (process.platform === 'win32') {
    const path = join(directory, 'askpass.cmd')
    await writeFile(
      path,
      '@echo off\necho %1 | findstr /I "Username" >nul\nif %errorlevel%==0 (echo %MYREPOS_GIT_USERNAME%) else (echo %MYREPOS_GIT_TOKEN%)\n',
      { mode: 0o700 },
    )
    return path
  }

  const path = join(directory, 'askpass.sh')
  await writeFile(
    path,
    '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "$MYREPOS_GIT_USERNAME" ;;\n  *) printf "%s\\n" "$MYREPOS_GIT_TOKEN" ;;\nesac\n',
    { mode: 0o700 },
  )
  await chmod(path, 0o700)
  return path
}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const gitOrigin = async (repositoryPath: string): Promise<string> =>
  await new Promise((resolvePromise, reject) => {
    const git = spawn('git', ['-C', repositoryPath, 'remote', 'get-url', 'origin'], {
      shell: false,
      windowsHide: true,
    })
    let output = ''
    let errorOutput = ''
    git.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    git.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString() })
    git.once('error', () => reject(new Error('Git is not installed or is not available in PATH.')))
    git.once('close', (code) => {
      if (code === 0) resolvePromise(output.trim())
      else reject(new Error(errorOutput.trim() || 'The repository does not have an origin remote.'))
    })
  })

const githubFullNameFromRemote = (remote: string): string | null => {
  const match = remote.match(/^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}` : null
}

const addLocalRepository = async (
  event: Electron.IpcMainInvokeEvent,
  requestedAccountId: number | null,
): Promise<GitHubRepository | null> => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    title: 'Add local repository',
    buttonLabel: 'Add repository',
    defaultPath: app.getPath('documents'),
    message: 'Select a local GitHub repository folder.',
    properties: ['openDirectory'],
  }
  const selection = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null

  const path = resolve(selection.filePaths[0])
  if (!(await isGitRepository(path))) throw new Error('The selected folder is not a Git repository.')

  const fullName = githubFullNameFromRemote(await gitOrigin(path))
  if (!fullName || !repositoryNamePattern.test(fullName)) {
    throw new Error('The origin remote is not a supported GitHub repository URL.')
  }

  const accounts = await listAccounts()
  let account = requestedAccountId === null
    ? accounts.find((item) => item.login.toLowerCase() === fullName.split('/')[0].toLowerCase())
    : accounts.find((item) => item.id === requestedAccountId)
  if (!account && accounts.length === 1) account = accounts[0]
  if (!account) {
    throw new Error('Choose the repository account from the account filter, then add it again.')
  }

  await recordClone(account.id, fullName, path)
  return {
    id: 0,
    accountId: account.id,
    accountLogin: account.login,
    name: fullName.split('/')[1],
    fullName,
    description: null,
    private: false,
    fork: false,
    archived: false,
    language: null,
    stars: 0,
    defaultBranch: '',
    updatedAt: new Date().toISOString(),
    profileUrl: `https://github.com/${fullName}`,
    localPath: path,
    lastSyncedAt: null,
    metadataLoaded: false,
  }
}

const launchVSCodeInNewWindow = async (repositoryPath: string): Promise<void> => {
  let command = 'code'
  let args = ['--new-window', repositoryPath]

  if (process.platform === 'darwin') {
    const { vscodeApplicationName } = await getAppSettings()
    command = 'open'
    args = vscodeApplicationName
      ? ['-n', '-a', vscodeApplicationName, '--args', '--new-window', repositoryPath]
      : ['-n', '-b', 'com.microsoft.VSCode', '--args', '--new-window', repositoryPath]
  } else if (process.platform === 'win32') {
    const executableCandidates = [
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
        : null,
      process.env.ProgramFiles
        ? join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe')
        : null,
      process.env['ProgramFiles(x86)']
        ? join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe')
        : null,
    ].filter((candidate): candidate is string => Boolean(candidate))
    const installedExecutable = executableCandidates
      .find((candidate) => existsSync(candidate))

    if (installedExecutable) command = installedExecutable
  }

  await new Promise<void>((resolvePromise, reject) => {
    const vscode = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })

    vscode.once('error', () => {
      reject(new Error('Unable to open Visual Studio Code. Make sure VS Code is installed.'))
    })
    vscode.once('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error('Unable to open Visual Studio Code in a new window.'))
    })
  })
}

const runGitClone = async (
  repositoryUrl: string,
  destination: string,
  username: string,
  token: string,
): Promise<void> => {
  const helper = await askPassPath()

  await new Promise<void>((resolvePromise, reject) => {
    const git = spawn(
      'git',
      ['-c', 'credential.helper=', 'clone', '--progress', repositoryUrl, destination],
      {
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_ASKPASS: helper,
          GIT_TERMINAL_PROMPT: '0',
          MYREPOS_GIT_USERNAME: username,
          MYREPOS_GIT_TOKEN: token,
        },
      },
    )

    let output = ''
    const collect = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-20_000)
    }
    git.stdout.on('data', collect)
    git.stderr.on('data', collect)
    git.once('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('Git is not installed or is not available in PATH.'))
      } else reject(error)
    })
    git.once('close', (code) => {
      if (code === 0) resolvePromise()
      else {
        const detail = output.trim().split('\n').slice(-4).join('\n')
        reject(new Error(detail || `Git clone failed with exit code ${code ?? 'unknown'}.`))
      }
    })
  })
}

const cloneRepository = async (
  event: Electron.IpcMainInvokeEvent,
  accountId: number,
  fullName: string,
): Promise<CloneResult | null> => {
  if (!repositoryNamePattern.test(fullName)) throw new Error('Invalid GitHub repository name.')

  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    title: `Clone ${fullName}`,
    buttonLabel: 'Choose folder',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  }
  const selection = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null

  const parent = resolve(selection.filePaths[0])
  const repositoryName = basename(fullName)
  const destination = resolve(parent, repositoryName)
  if (dirname(destination) !== parent) throw new Error('Invalid clone destination.')
  if (await pathExists(destination)) {
    if (
      await isGitRepository(destination) &&
      await hasMatchingGitHubOrigin(destination, fullName)
    ) {
      await recordClone(accountId, fullName, destination)
      return { path: destination }
    }
    throw new Error(`A folder named “${repositoryName}” already exists in that location.`)
  }

  const temporary = resolve(parent, `.myrepos-clone-${randomUUID()}`)
  const auth = await refreshedCredentials(accountId)

  try {
    await runGitClone(`https://github.com/${fullName}.git`, temporary, auth.accountLogin, auth.token)
    await recordClone(accountId, fullName, destination)
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }

  return { path: destination }
}

const locateRepository = async (
  event: Electron.IpcMainInvokeEvent,
  accountId: number,
  fullName: string,
): Promise<CloneResult | null> => {
  if (!repositoryNamePattern.test(fullName)) throw new Error('Invalid GitHub repository name.')

  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    title: `Locate ${fullName}`,
    buttonLabel: 'Use repository',
    defaultPath: app.getPath('documents'),
    message: 'Select the cloned repository folder itself.',
    properties: ['openDirectory'],
  }
  const selection = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null

  const path = resolve(selection.filePaths[0])
  if (!(await isGitRepository(path))) {
    throw new Error('The selected folder is not a Git repository.')
  }
  if (!(await hasMatchingGitHubOrigin(path, fullName))) {
    throw new Error(`The selected folder is not a clone of ${fullName}.`)
  }

  await recordClone(accountId, fullName, path)
  return { path }
}

export const registerRepositoryHandlers = (): void => {
  ipcMain.handle('repositories:list-cloned', (_event, accountId: number | null) =>
    listClonedRepositoriesForSelection(accountId),
  )
  ipcMain.handle('repositories:list', (_event, accountId: number | null) =>
    listRepositoriesForSelection(accountId),
  )
  ipcMain.handle('repositories:clone', (event, accountId: number, fullName: string) =>
    cloneRepository(event, accountId, fullName),
  )
  ipcMain.handle('repositories:locate', (event, accountId: number, fullName: string) =>
    locateRepository(event, accountId, fullName),
  )
  ipcMain.handle('repositories:add-local', (event, accountId: number | null) =>
    addLocalRepository(event, accountId),
  )
  ipcMain.handle('repositories:open-folder', async (_event, path: unknown) => {
    const resolvedPath = await verifiedClonePath(path)
    const result = await shell.openPath(resolvedPath)
    if (result) throw new Error(result)
  })
  ipcMain.handle('repositories:open-vscode', async (_event, path: unknown) => {
    const resolvedPath = await verifiedClonePath(path)
    await launchVSCodeInNewWindow(resolvedPath)
  })
  ipcMain.handle('repositories:monitor', async (_event, paths: unknown) => {
    if (!Array.isArray(paths) || paths.length > 100 || paths.some((path) => typeof path !== 'string')) {
      throw new Error('Invalid repository monitoring request.')
    }

    const records = await readCloneRecords()
    const knownPaths = new Set(records.map((record) => resolve(record.path)))
    const requestedPaths = [...new Set(paths.map((path) => resolve(path as string)))]
    if (requestedPaths.some((path) => !knownPaths.has(path))) {
      throw new Error('A repository is not registered as a local clone.')
    }

    return await monitorRepositories(requestedPaths)
  })
}
