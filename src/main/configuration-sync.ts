import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { getDatabase } from './database'
import {
  askPassPath,
  publishRepository,
  recordClone,
  refreshedCredentials,
  runGitClone,
} from './github-repositories'
import { refreshLegacyWorkingCopyProjections } from './working-copy-store'
import type {
  ConfigurationSyncAction,
  ConfigurationSyncState,
  OrganizationKind,
} from '../shared/desktop-api'

const CONFIGURATION_PATH = '.myrepos/config.json'

interface SyncRow {
  local_path: string | null
  account_id: number | null
  full_name: string | null
  auto_sync: number
  last_synced_at: string | null
  last_error: string | null
}

interface PortableItem {
  id: string
  name: string
  color: string
  description: string | null
}

interface PortableRepository {
  provider: 'github'
  accountId: number
  fullName: string
  color: string | null
  workspaceIds: string[]
  workspacePositions: Record<string, number>
  groupIds: string[]
  tagIds: string[]
}

interface PortableConfiguration {
  format: 'myrepos-configuration'
  version: 1
  workspaces: PortableItem[]
  groups: PortableItem[]
  tags: PortableItem[]
  repositories: PortableRepository[]
  workingCopyPreferences?: Array<{
    accountId: number
    fullName: string
    preferredLabel: string | null
    workspaceLabels: Record<string, string>
  }>
}

interface GitOptions {
  env?: NodeJS.ProcessEnv
  successCodes?: number[]
  timeoutMs?: number
}

let automaticTimer: NodeJS.Timeout | null = null
let syncInProgress = false

const runGit = async (
  repositoryPath: string,
  args: string[],
  options: GitOptions = {},
): Promise<string> => await new Promise((resolvePromise, reject) => {
  const git = spawn('git', ['-C', repositoryPath, ...args], {
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...options.env },
  })
  let stdout = ''
  let stderr = ''
  const timer = setTimeout(() => {
    git.kill()
    reject(new Error('Configuration Git operation timed out.'))
  }, options.timeoutMs ?? 120_000)
  git.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString()}`.slice(-100_000) })
  git.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-20_000) })
  git.once('error', (error) => {
    clearTimeout(timer)
    reject((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? new Error('Git is not installed or is not available in PATH.')
      : error)
  })
  git.once('close', (code) => {
    clearTimeout(timer)
    if ((options.successCodes ?? [0]).includes(code ?? -1)) resolvePromise(stdout.trim())
    else reject(new Error(stderr.trim() || stdout.trim() || `Git exited with code ${code ?? 'unknown'}.`))
  })
})

const syncRow = (): SyncRow => getDatabase().prepare(`
  SELECT local_path, account_id, full_name, auto_sync, last_synced_at, last_error
  FROM configuration_sync_settings WHERE id = 1
`).get() as unknown as SyncRow

const hasOrigin = async (path: string): Promise<boolean> => {
  try {
    await runGit(path, ['remote', 'get-url', 'origin'])
    return true
  } catch {
    return false
  }
}

const stateFromRow = async (row: SyncRow = syncRow()): Promise<ConfigurationSyncState> => ({
  connected: Boolean(row.local_path),
  localPath: row.local_path,
  accountId: row.account_id,
  fullName: row.full_name,
  autoSync: row.auto_sync === 1,
  lastSyncedAt: row.last_synced_at,
  lastError: row.last_error,
  hasRemote: row.local_path ? await hasOrigin(row.local_path) : false,
})

const broadcastState = async (): Promise<ConfigurationSyncState> => {
  const state = await stateFromRow()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('configuration-sync:changed', state)
  }
  return state
}

const saveConnection = (
  path: string,
  accountId: number,
  fullName: string | null,
): void => {
  getDatabase().prepare(`
    UPDATE configuration_sync_settings
    SET local_path = ?, account_id = ?, full_name = ?, last_error = NULL
    WHERE id = 1
  `).run(path, accountId, fullName)
}

const setResult = (error: string | null): void => {
  getDatabase().prepare(`
    UPDATE configuration_sync_settings
    SET last_synced_at = CASE WHEN ? IS NULL THEN ? ELSE last_synced_at END,
        last_error = ?
    WHERE id = 1
  `).run(error, new Date().toISOString(), error)
}

const portableItems = (table: 'workspaces' | 'groups' | 'tags'): PortableItem[] =>
  getDatabase().prepare(`
    SELECT id, name, color, description FROM ${table} ORDER BY name COLLATE NOCASE
  `).all() as unknown as PortableItem[]

const exportConfiguration = (): PortableConfiguration => {
  const db = getDatabase()
  const repositories = db.prepare(`
    SELECT id, provider, account_id, full_name, color
    FROM organization_repositories ORDER BY full_name COLLATE NOCASE
  `).all() as unknown as Array<{
    id: string
    provider: 'github'
    account_id: number
    full_name: string
    color: string | null
  }>
  const workspaces = db.prepare(`
    SELECT repository_id, workspace_id, repository_position FROM repository_workspaces
    ORDER BY repository_position, position
  `).all() as unknown as Array<{
    repository_id: string
    workspace_id: string
    repository_position: number
  }>
  const groups = db.prepare(`
    SELECT repository_id, group_id FROM repository_groups ORDER BY position
  `).all() as unknown as Array<{ repository_id: string; group_id: string }>
  const tags = db.prepare(`
    SELECT repository_id, tag_id FROM repository_tags
  `).all() as unknown as Array<{ repository_id: string; tag_id: string }>
  const preferredCopies = db.prepare(`
    SELECT account_id, full_name, label FROM working_copies WHERE is_preferred = 1
  `).all() as unknown as Array<{ account_id: number; full_name: string; label: string }>
  const workspaceCopies = db.prepare(`
    SELECT selection.account_id, selection.full_name, selection.workspace_id, copy.label
    FROM workspace_working_copies selection
    JOIN working_copies copy ON copy.id = selection.working_copy_id
  `).all() as unknown as Array<{
    account_id: number
    full_name: string
    workspace_id: string
    label: string
  }>

  return {
    format: 'myrepos-configuration',
    version: 1,
    workspaces: portableItems('workspaces'),
    groups: portableItems('groups'),
    tags: portableItems('tags'),
    repositories: repositories.map((repository) => ({
      provider: repository.provider,
      accountId: repository.account_id,
      fullName: repository.full_name,
      color: repository.color,
      workspaceIds: workspaces.filter((row) => row.repository_id === repository.id)
        .map((row) => row.workspace_id),
      workspacePositions: Object.fromEntries(workspaces
        .filter((row) => row.repository_id === repository.id)
        .map((row) => [row.workspace_id, row.repository_position])),
      groupIds: groups.filter((row) => row.repository_id === repository.id)
        .map((row) => row.group_id),
      tagIds: tags.filter((row) => row.repository_id === repository.id)
        .map((row) => row.tag_id),
    })),
    workingCopyPreferences: [...new Map([
      ...preferredCopies.map((copy) => [
        `${copy.account_id}:${copy.full_name.toLowerCase()}`,
        { accountId: copy.account_id, fullName: copy.full_name },
      ] as const),
      ...workspaceCopies.map((copy) => [
        `${copy.account_id}:${copy.full_name.toLowerCase()}`,
        { accountId: copy.account_id, fullName: copy.full_name },
      ] as const),
    ]).values()].map((repository) => ({
      ...repository,
      preferredLabel: preferredCopies.find((copy) =>
        copy.account_id === repository.accountId &&
        copy.full_name.toLowerCase() === repository.fullName.toLowerCase())?.label ?? null,
      workspaceLabels: Object.fromEntries(workspaceCopies
        .filter((copy) => copy.account_id === repository.accountId &&
          copy.full_name.toLowerCase() === repository.fullName.toLowerCase())
        .map((copy) => [copy.workspace_id, copy.label])),
    })),
  }
}

const validatePortableConfiguration = (value: unknown): PortableConfiguration => {
  if (!value || typeof value !== 'object') throw new Error('The configuration file is invalid.')
  const config = value as Partial<PortableConfiguration>
  if (config.format !== 'myrepos-configuration' || config.version !== 1 ||
    !Array.isArray(config.workspaces) || !Array.isArray(config.groups) ||
    !Array.isArray(config.tags) || !Array.isArray(config.repositories) ||
    config.workspaces.length > 10_000 || config.groups.length > 10_000 ||
    config.tags.length > 10_000 || config.repositories.length > 100_000) {
    throw new Error('This is not a supported MyRepos configuration file.')
  }
  return config as PortableConfiguration
}

const importConfiguration = (config: PortableConfiguration): void => {
  const db = getDatabase()
  const tables: Array<[OrganizationKind, 'workspaces' | 'groups' | 'tags', PortableItem[]]> = [
    ['workspace', 'workspaces', config.workspaces],
    ['group', 'groups', config.groups],
    ['tag', 'tags', config.tags],
  ]
  const mappings: Record<OrganizationKind, Map<string, string>> = {
    workspace: new Map(),
    group: new Map(),
    tag: new Map(),
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const [kind, table, items] of tables) {
      for (const item of items) {
        if (!item.id || !item.name || !/^#[0-9a-f]{6}$/i.test(item.color)) continue
        const existing = db.prepare(`
          SELECT id FROM ${table} WHERE id = ? OR name = ? COLLATE NOCASE LIMIT 1
        `).get(item.id, item.name) as { id: string } | undefined
        const localId = existing?.id ?? item.id
        if (existing) {
          db.prepare(`
            UPDATE ${table}
            SET name = ?, color = ?, description = ?, updated_at = ? WHERE id = ?
          `).run(item.name.slice(0, 80), item.color, item.description ?? null,
            new Date().toISOString(), localId)
        } else {
          const now = new Date().toISOString()
          db.prepare(`
            INSERT INTO ${table} (id, name, color, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(localId, item.name.slice(0, 80), item.color.toLowerCase(), item.description ?? null, now, now)
        }
        mappings[kind].set(item.id, localId)
      }
    }

    for (const repository of config.repositories) {
      if (!Number.isInteger(repository.accountId) || !repository.fullName?.includes('/')) continue
      db.prepare(`
        INSERT INTO organization_repositories (id, provider, account_id, full_name, color)
        VALUES (?, 'github', ?, ?, ?)
        ON CONFLICT(provider, account_id, full_name) DO UPDATE SET color = excluded.color
      `).run(randomUUID(), repository.accountId, repository.fullName, repository.color ?? null)
      const row = db.prepare(`
        SELECT id FROM organization_repositories
        WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
      `).get(repository.accountId, repository.fullName) as { id: string }
      db.prepare('DELETE FROM repository_workspaces WHERE repository_id = ?').run(row.id)
      db.prepare('DELETE FROM repository_groups WHERE repository_id = ?').run(row.id)
      db.prepare('DELETE FROM repository_tags WHERE repository_id = ?').run(row.id)
      repository.workspaceIds.forEach((remoteId, position) => {
        const id = mappings.workspace.get(remoteId)
        if (id) db.prepare(`
          INSERT INTO repository_workspaces
            (repository_id, workspace_id, position, repository_position)
          VALUES (?, ?, ?, ?)
        `).run(row.id, id, position, repository.workspacePositions?.[remoteId] ?? position)
      })
      repository.groupIds.forEach((remoteId, position) => {
        const id = mappings.group.get(remoteId)
        if (id) db.prepare(`
          INSERT INTO repository_groups (repository_id, group_id, position) VALUES (?, ?, ?)
        `).run(row.id, id, position)
      })
      repository.tagIds.forEach((remoteId) => {
        const id = mappings.tag.get(remoteId)
        if (id) db.prepare(`
          INSERT INTO repository_tags (repository_id, tag_id) VALUES (?, ?)
        `).run(row.id, id)
      })
    }

    for (const preference of config.workingCopyPreferences ?? []) {
      if (!Number.isInteger(preference.accountId) || !preference.fullName?.includes('/')) continue
      if (preference.preferredLabel) {
        const copy = db.prepare(`
          SELECT id FROM working_copies
          WHERE account_id = ? AND full_name = ? COLLATE NOCASE AND label = ? COLLATE NOCASE
          LIMIT 1
        `).get(preference.accountId, preference.fullName, preference.preferredLabel) as
          { id: string } | undefined
        if (copy) {
          db.prepare(`
            UPDATE working_copies SET is_preferred = 0
            WHERE account_id = ? AND full_name = ? COLLATE NOCASE
          `).run(preference.accountId, preference.fullName)
          db.prepare('UPDATE working_copies SET is_preferred = 1 WHERE id = ?').run(copy.id)
        }
      }
      for (const [remoteWorkspaceId, label] of Object.entries(preference.workspaceLabels ?? {})) {
        const workspaceId = mappings.workspace.get(remoteWorkspaceId)
        if (!workspaceId || typeof label !== 'string') continue
        const copy = db.prepare(`
          SELECT id FROM working_copies
          WHERE account_id = ? AND full_name = ? COLLATE NOCASE AND label = ? COLLATE NOCASE
          LIMIT 1
        `).get(preference.accountId, preference.fullName, label) as { id: string } | undefined
        if (copy) db.prepare(`
          INSERT INTO workspace_working_copies (
            workspace_id, provider, account_id, full_name, working_copy_id
          ) VALUES (?, 'github', ?, ?, ?)
          ON CONFLICT(workspace_id, provider, account_id, full_name) DO UPDATE SET
            working_copy_id = excluded.working_copy_id
        `).run(workspaceId, preference.accountId, preference.fullName, copy.id)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  refreshLegacyWorkingCopyProjections()
}

const configurationFile = (repositoryPath: string): string => join(repositoryPath, CONFIGURATION_PATH)

const writeConfiguration = async (repositoryPath: string): Promise<void> => {
  const path = configurationFile(repositoryPath)
  await mkdir(join(repositoryPath, '.myrepos'), { recursive: true })
  await writeFile(path, `${JSON.stringify(exportConfiguration(), null, 2)}\n`, 'utf8')
}

const readConfiguration = async (repositoryPath: string): Promise<PortableConfiguration | null> => {
  try {
    return validatePortableConfiguration(JSON.parse(
      await readFile(configurationFile(repositoryPath), 'utf8'),
    ) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const authenticatedEnvironment = async (accountId: number): Promise<NodeJS.ProcessEnv> => {
  const auth = await refreshedCredentials(accountId)
  return {
    GIT_ASKPASS: await askPassPath(),
    GIT_TERMINAL_PROMPT: '0',
    MYREPOS_GIT_USERNAME: auth.accountLogin,
    MYREPOS_GIT_TOKEN: auth.token,
  }
}

const commitConfiguration = async (path: string): Promise<void> => {
  await runGit(path, ['add', '--', CONFIGURATION_PATH])
  const changes = await runGit(path, ['status', '--porcelain', '--', CONFIGURATION_PATH])
  if (!changes) return
  await runGit(path, [
    '-c', 'user.name=MyRepos',
    '-c', 'user.email=myrepos@users.noreply.github.com',
    'commit', '-m', 'chore: sync MyRepos configuration', '--', CONFIGURATION_PATH,
  ])
}

const runConnectedSync = async (action: ConfigurationSyncAction): Promise<ConfigurationSyncState> => {
  if (syncInProgress) throw new Error('Configuration sync is already running.')
  const row = syncRow()
  if (!row.local_path || row.account_id === null) throw new Error('Connect a configuration repository first.')
  try {
    await stat(join(row.local_path, '.git'))
  } catch {
    throw new Error('The connected configuration repository is no longer available.')
  }
  syncInProgress = true
  try {
    const remote = await hasOrigin(row.local_path)
    const env = remote ? await authenticatedEnvironment(row.account_id) : undefined
    if ((action === 'pull' || action === 'sync') && remote) {
      // Snapshot local database changes before reading remote state. A divergent remote then makes
      // the fast-forward-only pull fail instead of silently replacing local configuration.
      await writeConfiguration(row.local_path)
      await commitConfiguration(row.local_path)
      await runGit(row.local_path, ['-c', 'credential.helper=', 'pull', '--ff-only'], { env })
      const pulled = await readConfiguration(row.local_path)
      if (pulled) importConfiguration(pulled)
    } else if (action === 'pull') {
      throw new Error('This configuration repository has no origin remote.')
    }

    if (action === 'push' || action === 'sync') {
      await writeConfiguration(row.local_path)
      await commitConfiguration(row.local_path)
      if (remote) {
        await runGit(row.local_path, ['-c', 'credential.helper=', 'push'], { env })
      }
    }
    setResult(null)
    return await broadcastState()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Configuration sync failed.'
    setResult(message)
    await broadcastState()
    throw error
  } finally {
    syncInProgress = false
  }
}

const managedDirectory = (accountId: number, fullName: string): string =>
  join(app.getPath('userData'), 'configuration-repositories',
    `${accountId}-${fullName.replace(/[^A-Za-z0-9_.-]/g, '-')}`)

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const createManaged = async (value: unknown): Promise<ConfigurationSyncState> => {
  if (!value || typeof value !== 'object') throw new Error('Invalid repository details.')
  const input = value as { accountId?: unknown; owner?: unknown; name?: unknown; private?: unknown }
  if (!Number.isInteger(input.accountId) || typeof input.owner !== 'string' ||
    typeof input.name !== 'string' || typeof input.private !== 'boolean') {
    throw new Error('Complete the configuration repository details.')
  }
  const accountId = input.accountId as number
  const owner = input.owner.trim()
  const name = input.name.trim()
  const path = managedDirectory(accountId, `${owner}-${name}`)
  if (!(await pathExists(path))) {
    await mkdir(path, { recursive: true })
    await runGit(path, ['init'])
  } else {
    await runGit(path, ['rev-parse', '--git-dir'])
  }
  await writeConfiguration(path)
  await commitConfiguration(path)
  await recordClone(accountId, `${owner}/${name}`, path)
  const result = await publishRepository({
    path,
    accountId,
    owner,
    name,
    description: 'Portable MyRepos workspace, group, tag, color, and ordering configuration.',
    private: input.private,
  })
  saveConnection(path, accountId, result.repository.fullName)
  setResult(null)
  return await broadcastState()
}

const connectRemote = async (
  accountIdValue: unknown,
  fullNameValue: unknown,
): Promise<ConfigurationSyncState> => {
  if (!Number.isInteger(accountIdValue) || typeof fullNameValue !== 'string' ||
    !/^[^/]+\/[A-Za-z0-9_.-]+$/.test(fullNameValue)) {
    throw new Error('Choose a valid GitHub repository.')
  }
  const accountId = accountIdValue as number
  const fullName = fullNameValue.trim()
  const path = managedDirectory(accountId, fullName)
  const auth = await refreshedCredentials(accountId)
  if (!(await pathExists(path))) {
    await mkdir(join(path, '..'), { recursive: true })
    await runGitClone(`https://github.com/${fullName}.git`, path, auth.accountLogin, auth.token)
  } else {
    const origin = await runGit(path, ['remote', 'get-url', 'origin'])
    const normalized = origin.toLowerCase().replace(/\.git$/, '')
    if (!normalized.endsWith(`github.com/${fullName.toLowerCase()}`) &&
      !normalized.endsWith(`github.com:${fullName.toLowerCase()}`)) {
      throw new Error('The existing managed folder belongs to a different repository.')
    }
  }
  await recordClone(accountId, fullName, path)
  const config = await readConfiguration(path)
  if (config) importConfiguration(config)
  else {
    await writeConfiguration(path)
    await commitConfiguration(path)
    await runGit(path, ['-c', 'credential.helper=', 'push', '-u', 'origin', 'HEAD'], {
      env: await authenticatedEnvironment(accountId),
    })
  }
  saveConnection(path, accountId, fullName)
  setResult(null)
  return await broadcastState()
}

const connectLocal = async (
  event: Electron.IpcMainInvokeEvent,
  accountIdValue: unknown,
): Promise<ConfigurationSyncState | null> => {
  if (!Number.isInteger(accountIdValue)) throw new Error('Choose a GitHub account.')
  const accountId = accountIdValue as number
  const owner = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    title: 'Choose configuration repository',
    buttonLabel: 'Use repository',
    properties: ['openDirectory'],
  }
  const selection = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null
  const path = resolve(selection.filePaths[0])
  await runGit(path, ['rev-parse', '--git-dir'])
  let fullName: string | null = null
  try {
    const origin = await runGit(path, ['remote', 'get-url', 'origin'])
    const match = origin.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i)
    if (match) fullName = `${match[1]}/${match[2]}`
  } catch {
    // Local-only repositories are supported and can be published later.
  }
  const config = await readConfiguration(path)
  if (config) importConfiguration(config)
  else {
    await writeConfiguration(path)
    await commitConfiguration(path)
  }
  saveConnection(path, accountId, fullName ?? basename(path))
  setResult(null)
  return await broadcastState()
}

export const scheduleConfigurationSync = (): void => {
  const row = syncRow()
  if (!row.local_path || row.auto_sync !== 1) return
  if (automaticTimer) clearTimeout(automaticTimer)
  automaticTimer = setTimeout(() => {
    automaticTimer = null
    void runConnectedSync('push').catch(() => undefined)
  }, 1_500)
}

const setAutoSync = async (enabled: unknown): Promise<ConfigurationSyncState> => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid automatic sync setting.')
  getDatabase().prepare(`
    UPDATE configuration_sync_settings SET auto_sync = ? WHERE id = 1
  `).run(enabled ? 1 : 0)
  if (enabled) scheduleConfigurationSync()
  return await broadcastState()
}

const disconnect = async (): Promise<ConfigurationSyncState> => {
  if (automaticTimer) clearTimeout(automaticTimer)
  automaticTimer = null
  getDatabase().prepare(`
    UPDATE configuration_sync_settings
    SET local_path = NULL, account_id = NULL, full_name = NULL,
        auto_sync = 0, last_synced_at = NULL, last_error = NULL
    WHERE id = 1
  `).run()
  return await broadcastState()
}

const validateAction = (value: unknown): ConfigurationSyncAction => {
  if (value === 'sync' || value === 'pull' || value === 'push') return value
  throw new Error('Invalid configuration sync action.')
}

export const registerConfigurationSyncHandlers = (): void => {
  ipcMain.handle('configuration-sync:get', () => stateFromRow())
  ipcMain.handle('configuration-sync:create', (_event, input) => createManaged(input))
  ipcMain.handle('configuration-sync:connect-remote', (_event, accountId, fullName) =>
    connectRemote(accountId, fullName))
  ipcMain.handle('configuration-sync:connect-local', (event, accountId) =>
    connectLocal(event, accountId))
  ipcMain.handle('configuration-sync:run', (_event, action) =>
    runConnectedSync(validateAction(action)))
  ipcMain.handle('configuration-sync:set-auto', (_event, enabled) => setAutoSync(enabled))
  ipcMain.handle('configuration-sync:open-folder', async () => {
    const path = syncRow().local_path
    if (!path) throw new Error('Connect a configuration repository first.')
    const result = await shell.openPath(path)
    if (result) throw new Error(result)
  })
  ipcMain.handle('configuration-sync:disconnect', () => disconnect())

  const row = syncRow()
  if (row.local_path && row.auto_sync === 1) {
    setTimeout(() => { void runConnectedSync('sync').catch(() => undefined) }, 2_000)
  }
}
