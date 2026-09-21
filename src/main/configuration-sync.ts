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
  PortablePreferenceKey,
  PortablePreferences,
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

interface PortableSshConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  authenticationType: 'password' | 'private-key' | 'agent'
  hostFingerprint: string | null
  createdAt: string
  updatedAt: string
}

interface PortableSshMysqlProfile {
  connectionId: string
  mode: 'system' | 'password'
  username: string
  updatedAt: string
}

interface PortableRemoteConnection {
  id: string
  name: string
  protocol: 'ftp' | 'ftps' | 'sftp'
  host: string | null
  port: number | null
  username: string | null
  sftpSource: 'ssh' | 'standalone' | null
  sshConnectionId: string | null
  authenticationType: 'password' | 'private-key' | 'agent' | null
  tlsMode: 'explicit' | 'implicit' | null
  rejectUnauthorized: boolean
  hostFingerprint: string | null
  createdAt: string
  updatedAt: string
}

interface PortableConfiguration {
  format: 'myrepos-configuration'
  version: 3
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
  sshConnections: PortableSshConnection[]
  sshMysqlProfiles: PortableSshMysqlProfile[]
  remoteConnections: PortableRemoteConnection[]
  preferences: Array<{ key: PortablePreferenceKey; value: unknown; updatedAt: string }>
}

const portablePreferenceKeys = new Set<PortablePreferenceKey>([
  'app.updatePreferences',
  'repository.sort',
  'repository.paneLayout',
  'ssh.explorerSort',
  'ssh.explorerSortDirection',
])

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
  const portablePreferences = db.prepare(`
    SELECT key, value_json, updated_at FROM portable_preferences ORDER BY key
  `).all() as unknown as Array<{
    key: PortablePreferenceKey
    value_json: string
    updated_at: string
  }>
  const sshConnections = db.prepare(`
    SELECT id, name, host, port, username, authentication_type, host_fingerprint,
           created_at, updated_at
    FROM ssh_connections ORDER BY name COLLATE NOCASE, host COLLATE NOCASE, port
  `).all() as unknown as Array<{
    id: string
    name: string
    host: string
    port: number
    username: string
    authentication_type: PortableSshConnection['authenticationType']
    host_fingerprint: string | null
    created_at: string
    updated_at: string
  }>
  const sshMysqlProfiles = db.prepare(`
    SELECT connection_id, access_mode, username, updated_at
    FROM ssh_mysql_profiles ORDER BY connection_id
  `).all() as unknown as Array<{
    connection_id: string
    access_mode: PortableSshMysqlProfile['mode']
    username: string
    updated_at: string
  }>
  const remoteConnections = db.prepare(`
    SELECT id, name, protocol, host, port, username, sftp_source, ssh_connection_id,
           authentication_type, tls_mode, reject_unauthorized, host_fingerprint, created_at, updated_at
    FROM remote_connections ORDER BY name COLLATE NOCASE
  `).all() as unknown as Array<{
    id: string; name: string; protocol: PortableRemoteConnection['protocol']; host: string | null
    port: number | null; username: string | null; sftp_source: PortableRemoteConnection['sftpSource']
    ssh_connection_id: string | null; authentication_type: PortableRemoteConnection['authenticationType']
    tls_mode: PortableRemoteConnection['tlsMode']; reject_unauthorized: number
    host_fingerprint: string | null; created_at: string; updated_at: string
  }>

  return {
    format: 'myrepos-configuration',
    version: 3,
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
    sshConnections: sshConnections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authenticationType: connection.authentication_type,
      hostFingerprint: connection.host_fingerprint,
      createdAt: connection.created_at,
      updatedAt: connection.updated_at,
    })),
    sshMysqlProfiles: sshMysqlProfiles.map((profile) => ({
      connectionId: profile.connection_id,
      mode: profile.access_mode,
      username: profile.username,
      updatedAt: profile.updated_at,
    })),
    remoteConnections: remoteConnections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      protocol: connection.protocol,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      sftpSource: connection.sftp_source,
      sshConnectionId: connection.ssh_connection_id,
      authenticationType: connection.authentication_type,
      tlsMode: connection.tls_mode,
      rejectUnauthorized: connection.reject_unauthorized !== 0,
      hostFingerprint: connection.host_fingerprint,
      createdAt: connection.created_at,
      updatedAt: connection.updated_at,
    })),
    preferences: portablePreferences.flatMap((row) => {
      if (!portablePreferenceKeys.has(row.key)) return []
      try {
        return [{ key: row.key, value: JSON.parse(row.value_json) as unknown, updatedAt: row.updated_at }]
      } catch {
        return []
      }
    }),
  }
}

const validatePortableConfiguration = (value: unknown): PortableConfiguration => {
  if (!value || typeof value !== 'object') throw new Error('The configuration file is invalid.')
  const config = value as Partial<PortableConfiguration> & { version?: number }
  if (config.format !== 'myrepos-configuration' ||
    (config.version !== 1 && config.version !== 2 && config.version !== 3) ||
    !Array.isArray(config.workspaces) || !Array.isArray(config.groups) ||
    !Array.isArray(config.tags) || !Array.isArray(config.repositories) ||
    config.workspaces.length > 10_000 || config.groups.length > 10_000 ||
    config.tags.length > 10_000 || config.repositories.length > 100_000) {
    throw new Error('This is not a supported MyRepos configuration file.')
  }
  if (config.preferences !== undefined && (!Array.isArray(config.preferences) || config.preferences.length > 100)) {
    throw new Error('This configuration contains invalid preferences.')
  }
  if (config.sshConnections !== undefined &&
    (!Array.isArray(config.sshConnections) || config.sshConnections.length > 10_000)) {
    throw new Error('This configuration contains invalid SSH connections.')
  }
  if (config.sshMysqlProfiles !== undefined &&
    (!Array.isArray(config.sshMysqlProfiles) || config.sshMysqlProfiles.length > 10_000)) {
    throw new Error('This configuration contains invalid SSH database profiles.')
  }
  if (config.remoteConnections !== undefined &&
    (!Array.isArray(config.remoteConnections) || config.remoteConnections.length > 10_000)) {
    throw new Error('This configuration contains invalid file-transfer connections.')
  }
  return {
    ...(config as Omit<PortableConfiguration,
      'version' | 'preferences' | 'sshConnections' | 'sshMysqlProfiles' | 'remoteConnections'>),
    version: 3,
    sshConnections: Array.isArray(config.sshConnections) ? config.sshConnections : [],
    sshMysqlProfiles: Array.isArray(config.sshMysqlProfiles) ? config.sshMysqlProfiles : [],
    remoteConnections: Array.isArray(config.remoteConnections) ? config.remoteConnections : [],
    preferences: Array.isArray(config.preferences) ? config.preferences : [],
  }
}

const mergeNewest = <T extends { updatedAt: string }>(
  local: T[],
  remote: T[],
  keyFor: (item: T) => string,
): T[] => {
  const merged = new Map(local.map((item) => [keyFor(item), item]))
  for (const item of remote) {
    const current = merged.get(keyFor(item))
    if (!current || Date.parse(item.updatedAt) >= Date.parse(current.updatedAt)) merged.set(keyFor(item), item)
  }
  return [...merged.values()].sort((left, right) => keyFor(left).localeCompare(keyFor(right)))
}

const mergePortableConfigurations = (
  local: PortableConfiguration,
  remote: PortableConfiguration,
): PortableConfiguration => {
  const mergeItems = (localItems: PortableItem[], remoteItems: PortableItem[]): PortableItem[] =>
    [...new Map([...localItems, ...remoteItems].map((item) => [item.id, item])).values()]
      .sort((left, right) => left.name.localeCompare(right.name))
  const repositoryKey = (repository: Pick<PortableRepository, 'provider' | 'accountId' | 'fullName'>): string =>
    `${repository.provider}:${repository.accountId}:${repository.fullName.toLowerCase()}`
  const repositories = new Map(local.repositories.map((repository) => [
    repositoryKey(repository),
    repository,
  ]))
  for (const remoteRepository of remote.repositories) {
    const key = repositoryKey(remoteRepository)
    const localRepository = repositories.get(key)
    repositories.set(key, localRepository ? {
      ...localRepository,
      ...remoteRepository,
      workspaceIds: [...new Set([...remoteRepository.workspaceIds, ...localRepository.workspaceIds])],
      workspacePositions: {
        ...localRepository.workspacePositions,
        ...remoteRepository.workspacePositions,
      },
      groupIds: [...new Set([...remoteRepository.groupIds, ...localRepository.groupIds])],
      tagIds: [...new Set([...remoteRepository.tagIds, ...localRepository.tagIds])],
    } : remoteRepository)
  }
  const preferenceKey = (preference: NonNullable<PortableConfiguration['workingCopyPreferences']>[number]): string =>
    `${preference.accountId}:${preference.fullName.toLowerCase()}`
  const preferences = new Map((local.workingCopyPreferences ?? []).map((preference) => [
    preferenceKey(preference),
    preference,
  ]))
  for (const remotePreference of remote.workingCopyPreferences ?? []) {
    const key = preferenceKey(remotePreference)
    const localPreference = preferences.get(key)
    preferences.set(key, localPreference ? {
      ...localPreference,
      ...remotePreference,
      workspaceLabels: {
        ...localPreference.workspaceLabels,
        ...remotePreference.workspaceLabels,
      },
    } : remotePreference)
  }

  return {
    format: 'myrepos-configuration',
    version: 3,
    workspaces: mergeItems(local.workspaces, remote.workspaces),
    groups: mergeItems(local.groups, remote.groups),
    tags: mergeItems(local.tags, remote.tags),
    repositories: [...repositories.values()]
      .sort((left, right) => left.fullName.localeCompare(right.fullName)),
    workingCopyPreferences: [...preferences.values()]
      .sort((left, right) => left.fullName.localeCompare(right.fullName)),
    sshConnections: mergeNewest(
      local.sshConnections,
      remote.sshConnections,
      (connection) => connection.id,
    ),
    sshMysqlProfiles: mergeNewest(
      local.sshMysqlProfiles,
      remote.sshMysqlProfiles,
      (profile) => profile.connectionId,
    ),
    remoteConnections: mergeNewest(
      local.remoteConnections,
      remote.remoteConnections,
      (connection) => connection.id,
    ),
    preferences: mergeNewest(local.preferences, remote.preferences, (item) => item.key),
  }
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

    const authenticationTypes = new Set(['password', 'private-key', 'agent'])
    for (const connection of config.sshConnections) {
      if (typeof connection.id !== 'string' || !connection.id || connection.id.length > 100 ||
        typeof connection.name !== 'string' || !connection.name.trim() || connection.name.length > 100 ||
        typeof connection.host !== 'string' || !connection.host.trim() || connection.host.length > 255 ||
        typeof connection.username !== 'string' || !connection.username.trim() || connection.username.length > 128 ||
        !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65_535 ||
        !authenticationTypes.has(connection.authenticationType) ||
        (connection.hostFingerprint !== null &&
          (typeof connection.hostFingerprint !== 'string' || connection.hostFingerprint.length > 256)) ||
        typeof connection.createdAt !== 'string' || !Number.isFinite(Date.parse(connection.createdAt)) ||
        typeof connection.updatedAt !== 'string' || !Number.isFinite(Date.parse(connection.updatedAt))) continue
      db.prepare(`
        INSERT INTO ssh_connections (
          id, name, host, port, username, authentication_type, private_key_path,
          agent_socket, encrypted_password, encrypted_passphrase, host_fingerprint,
          created_at, updated_at, last_connected_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          host = excluded.host,
          port = excluded.port,
          username = excluded.username,
          authentication_type = excluded.authentication_type,
          private_key_path = CASE
            WHEN excluded.authentication_type = 'private-key' AND
              ssh_connections.authentication_type = 'private-key'
              THEN ssh_connections.private_key_path ELSE NULL END,
          agent_socket = CASE
            WHEN excluded.authentication_type = 'agent' AND ssh_connections.authentication_type = 'agent'
              THEN ssh_connections.agent_socket ELSE NULL END,
          encrypted_password = CASE
            WHEN excluded.authentication_type = 'password' AND
              ssh_connections.authentication_type = 'password' AND
              ssh_connections.host = excluded.host AND
              ssh_connections.port = excluded.port AND
              ssh_connections.username = excluded.username
              THEN ssh_connections.encrypted_password ELSE NULL END,
          encrypted_passphrase = CASE
            WHEN excluded.authentication_type = 'private-key' AND
              ssh_connections.authentication_type = 'private-key'
              THEN ssh_connections.encrypted_passphrase ELSE NULL END,
          host_fingerprint = excluded.host_fingerprint,
          created_at = ssh_connections.created_at,
          updated_at = excluded.updated_at
      `).run(
        connection.id, connection.name.trim(), connection.host.trim(), connection.port,
        connection.username.trim(), connection.authenticationType, connection.hostFingerprint,
        connection.createdAt, connection.updatedAt,
      )
    }

    for (const profile of config.sshMysqlProfiles) {
      if (typeof profile.connectionId !== 'string' || !profile.connectionId ||
        (profile.mode !== 'system' && profile.mode !== 'password') ||
        typeof profile.username !== 'string' || profile.username.length > 128 ||
        typeof profile.updatedAt !== 'string' || !Number.isFinite(Date.parse(profile.updatedAt))) continue
      const connection = db.prepare('SELECT 1 FROM ssh_connections WHERE id = ?')
        .get(profile.connectionId)
      if (!connection) continue
      db.prepare(`
        INSERT INTO ssh_mysql_profiles (
          connection_id, access_mode, username, encrypted_password, updated_at
        ) VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
          access_mode = excluded.access_mode,
          username = excluded.username,
          encrypted_password = CASE
            WHEN excluded.access_mode = 'password' AND ssh_mysql_profiles.access_mode = 'password' AND
              ssh_mysql_profiles.username = excluded.username
              THEN ssh_mysql_profiles.encrypted_password ELSE NULL END,
          updated_at = excluded.updated_at
      `).run(profile.connectionId, profile.mode, profile.username, profile.updatedAt)
    }

    const remoteProtocols = new Set(['ftp', 'ftps', 'sftp'])
    const remoteAuthenticationTypes = new Set(['password', 'private-key', 'agent'])
    for (const connection of config.remoteConnections) {
      if (typeof connection.id !== 'string' || !connection.id || connection.id.length > 100 ||
        typeof connection.name !== 'string' || !connection.name.trim() || connection.name.length > 100 ||
        !remoteProtocols.has(connection.protocol) ||
        (connection.host !== null && (typeof connection.host !== 'string' || !connection.host.trim() || connection.host.length > 255)) ||
        (connection.port !== null && (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65_535)) ||
        (connection.username !== null && (typeof connection.username !== 'string' || connection.username.length > 128)) ||
        (connection.authenticationType !== null && !remoteAuthenticationTypes.has(connection.authenticationType)) ||
        typeof connection.updatedAt !== 'string' || !Number.isFinite(Date.parse(connection.updatedAt))) continue
      const linkedSftp = connection.protocol === 'sftp' && connection.sftpSource === 'ssh'
      if (linkedSftp && (!connection.sshConnectionId ||
        !db.prepare('SELECT 1 FROM ssh_connections WHERE id = ?').get(connection.sshConnectionId))) continue
      db.prepare(`
        INSERT INTO remote_connections (
          id, name, protocol, host, port, username, sftp_source, ssh_connection_id,
          authentication_type, private_key_path, agent_socket, encrypted_password,
          encrypted_passphrase, tls_mode, reject_unauthorized, host_fingerprint,
          created_at, updated_at, last_connected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, protocol=excluded.protocol, host=excluded.host, port=excluded.port,
          username=excluded.username, sftp_source=excluded.sftp_source,
          ssh_connection_id=excluded.ssh_connection_id, authentication_type=excluded.authentication_type,
          private_key_path=CASE WHEN excluded.authentication_type='private-key' AND
            remote_connections.authentication_type='private-key' THEN remote_connections.private_key_path ELSE NULL END,
          agent_socket=CASE WHEN excluded.authentication_type='agent' AND
            remote_connections.authentication_type='agent' THEN remote_connections.agent_socket ELSE NULL END,
          encrypted_password=CASE WHEN excluded.authentication_type='password' AND
            remote_connections.authentication_type='password' AND remote_connections.host=excluded.host AND
            remote_connections.port=excluded.port AND remote_connections.username=excluded.username
            THEN remote_connections.encrypted_password ELSE NULL END,
          encrypted_passphrase=CASE WHEN excluded.authentication_type='private-key' AND
            remote_connections.authentication_type='private-key' THEN remote_connections.encrypted_passphrase ELSE NULL END,
          tls_mode=excluded.tls_mode, reject_unauthorized=excluded.reject_unauthorized,
          host_fingerprint=excluded.host_fingerprint, updated_at=excluded.updated_at
      `).run(
        connection.id, connection.name.trim(), connection.protocol, connection.host, connection.port,
        connection.username, connection.sftpSource, connection.sshConnectionId,
        connection.authenticationType, connection.tlsMode, connection.rejectUnauthorized ? 1 : 0,
        connection.hostFingerprint, connection.createdAt, connection.updatedAt,
      )
    }

    for (const preference of config.preferences) {
      if (!portablePreferenceKeys.has(preference.key) ||
        typeof preference.updatedAt !== 'string' || !Number.isFinite(Date.parse(preference.updatedAt))) continue
      const serialized = JSON.stringify(preference.value)
      if (!serialized || serialized.length > 50_000) continue
      db.prepare(`
        INSERT INTO portable_preferences (key, value_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(preference.key, serialized, preference.updatedAt)
      if (preference.key === 'app.updatePreferences' && preference.value &&
        typeof preference.value === 'object') {
        const value = preference.value as Record<string, unknown>
        if (typeof value.automaticallyCheckForUpdates === 'boolean' &&
          typeof value.automaticallyDownloadUpdates === 'boolean') {
          db.prepare(`UPDATE app_settings SET automatically_check_for_updates = ?,
            automatically_download_updates = ? WHERE id = 1`).run(
            value.automaticallyCheckForUpdates ? 1 : 0,
            value.automaticallyDownloadUpdates ? 1 : 0,
          )
        }
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

const readConfigurationRevision = async (
  repositoryPath: string,
  revision: string,
): Promise<PortableConfiguration | null> => {
  try {
    const contents = await runGit(repositoryPath, ['show', `${revision}:${CONFIGURATION_PATH}`])
    return validatePortableConfiguration(JSON.parse(contents) as unknown)
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('does not exist') || message.includes('exists on disk, but not in')) return null
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

const mergeRemoteConfiguration = async (
  repositoryPath: string,
  env: NodeJS.ProcessEnv,
): Promise<void> => {
  await runGit(repositoryPath, ['-c', 'credential.helper=', 'fetch', 'origin'], { env })
  const upstream = await runGit(repositoryPath, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ])
  const remoteConfiguration = await readConfigurationRevision(repositoryPath, upstream)
  const localConfiguration = exportConfiguration()
  const reconciledConfiguration = remoteConfiguration
    ? mergePortableConfigurations(localConfiguration, remoteConfiguration)
    : localConfiguration

  try {
    await runGit(repositoryPath, ['merge', '--no-edit', upstream])
  } catch (mergeError) {
    const conflicts = (await runGit(
      repositoryPath,
      ['diff', '--name-only', '--diff-filter=U'],
      { successCodes: [0, 1] },
    )).split(/\r?\n/).filter(Boolean)
    const onlyConfigurationConflict = conflicts.length === 1 &&
      conflicts[0].replaceAll('\\', '/') === CONFIGURATION_PATH

    if (!onlyConfigurationConflict || !remoteConfiguration) {
      try {
        await runGit(repositoryPath, ['merge', '--abort'])
      } catch {
        // A merge may fail before Git creates merge state.
      }
      const details = conflicts.length > 0
        ? `Conflicting files: ${conflicts.join(', ')}`
        : mergeError instanceof Error ? mergeError.message : 'Git could not merge the repositories.'
      throw new Error(`Configuration sync needs manual conflict resolution. ${details}`)
    }

    // The database already contains this machine's configuration. Importing the remote snapshot
    // adds remote-only records and applies remote values for the same stable IDs, after which the
    // exported file becomes a valid deterministic snapshot containing both sides.
    importConfiguration(reconciledConfiguration)
    await writeConfiguration(repositoryPath)
    await runGit(repositoryPath, ['add', '--', CONFIGURATION_PATH])
    await runGit(repositoryPath, [
      '-c', 'user.name=MyRepos',
      '-c', 'user.email=myrepos@users.noreply.github.com',
      'commit', '--no-edit',
    ])
  }

  const mergedConfiguration = await readConfiguration(repositoryPath)
  const finalConfiguration = mergedConfiguration
    ? mergePortableConfigurations(reconciledConfiguration, mergedConfiguration)
    : reconciledConfiguration
  importConfiguration(finalConfiguration)
  await writeConfiguration(repositoryPath)
  await commitConfiguration(repositoryPath)
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
      // Snapshot local database changes, then merge the remote branch. Configuration-only conflicts
      // are reconciled structurally; unrelated repository conflicts remain a manual operation.
      await writeConfiguration(row.local_path)
      await commitConfiguration(row.local_path)
      await mergeRemoteConfiguration(row.local_path, env!)
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

export const getPortablePreferences = (): PortablePreferences => {
  const rows = getDatabase().prepare(`
    SELECT key, value_json FROM portable_preferences ORDER BY key
  `).all() as unknown as Array<{ key: PortablePreferenceKey; value_json: string }>
  return Object.fromEntries(rows.flatMap((row) => {
    if (!portablePreferenceKeys.has(row.key)) return []
    try { return [[row.key, JSON.parse(row.value_json) as unknown]] }
    catch { return [] }
  })) as PortablePreferences
}

export const savePortablePreference = (
  inputKey: unknown,
  value: unknown,
): PortablePreferences => {
  if (typeof inputKey !== 'string' || !portablePreferenceKeys.has(inputKey as PortablePreferenceKey)) {
    throw new Error('This preference cannot be synchronized.')
  }
  const serialized = JSON.stringify(value)
  if (!serialized || serialized.length > 50_000) throw new Error('The preference value is invalid or too large.')
  getDatabase().prepare(`
    INSERT INTO portable_preferences (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(inputKey, serialized, new Date().toISOString())
  scheduleConfigurationSync()
  return getPortablePreferences()
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
  ipcMain.handle('configuration-sync:preferences', () => getPortablePreferences())
  ipcMain.handle('configuration-sync:save-preference', (_event, key, value) =>
    savePortablePreference(key, value))

  const row = syncRow()
  if (row.local_path && row.auto_sync === 1) {
    setTimeout(() => { void runConnectedSync('sync').catch(() => undefined) }, 2_000)
  }
}
