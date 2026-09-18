import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type {
  OrganizationCatalog,
  OrganizationItem,
  OrganizationKind,
  RepositoryAppearanceEntry,
  RepositoryOrganization,
  RepositoryOrganizationEntry,
  WorkspaceLaunchTarget,
} from '../shared/desktop-api'
import { getDatabase } from './database'
import { scheduleConfigurationSync } from './configuration-sync'
import { launchVSCodeInNewWindow } from './github-repositories'

const tableForKind: Record<OrganizationKind, 'workspaces' | 'groups' | 'tags'> = {
  workspace: 'workspaces',
  group: 'groups',
  tag: 'tags',
}

interface OrganizationRow {
  id: string
  name: string
  color: string
  description: string | null
  repository_count: number
}

const validateKind = (value: unknown): OrganizationKind => {
  if (value === 'workspace' || value === 'group' || value === 'tag') return value
  throw new Error('Invalid organization type.')
}

const validateId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) {
    throw new Error('Invalid organization selection.')
  }
  return value
}

const validateInput = (value: unknown): { name: string; color: string; description: string | null } => {
  if (!value || typeof value !== 'object') throw new Error('Invalid organization details.')
  const input = value as { name?: unknown; color?: unknown; description?: unknown }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const color = typeof input.color === 'string' ? input.color.trim().toLowerCase() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!name || name.length > 80) throw new Error('Enter a name up to 80 characters.')
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error('Choose a valid color.')
  if (description.length > 500) throw new Error('Description must be 500 characters or fewer.')
  return { name, color, description: description || null }
}

const itemFromRow = (kind: OrganizationKind, row: OrganizationRow): OrganizationItem => ({
  id: row.id,
  kind,
  name: row.name,
  color: row.color,
  description: row.description,
  repositoryCount: row.repository_count,
})

const listKind = (kind: OrganizationKind): OrganizationItem[] => {
  const table = tableForKind[kind]
  const relation = kind === 'workspace'
    ? { table: 'repository_workspaces', column: 'workspace_id' }
    : kind === 'group'
      ? { table: 'repository_groups', column: 'group_id' }
      : { table: 'repository_tags', column: 'tag_id' }
  const rows = getDatabase().prepare(`
    SELECT item.id, item.name, item.color, item.description,
           COUNT(link.repository_id) AS repository_count
    FROM ${table} item
    LEFT JOIN ${relation.table} link ON link.${relation.column} = item.id
    GROUP BY item.id
    ORDER BY item.name COLLATE NOCASE
  `).all() as unknown as OrganizationRow[]
  return rows.map((row) => itemFromRow(kind, row))
}

const listCatalog = async (): Promise<OrganizationCatalog> => ({
  workspaces: listKind('workspace'),
  groups: listKind('group'),
  tags: listKind('tag'),
})

const createItem = async (kindValue: unknown, inputValue: unknown): Promise<OrganizationItem> => {
  const kind = validateKind(kindValue)
  const input = validateInput(inputValue)
  const id = randomUUID()
  const now = new Date().toISOString()
  try {
    getDatabase().prepare(`
      INSERT INTO ${tableForKind[kind]} (id, name, color, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.color, input.description, now, now)
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error(`A ${kind} with this name already exists.`)
    throw error
  }
  scheduleConfigurationSync()
  return { id, kind, ...input, repositoryCount: 0 }
}

const updateItem = async (
  kindValue: unknown,
  idValue: unknown,
  inputValue: unknown,
): Promise<OrganizationItem> => {
  const kind = validateKind(kindValue)
  const id = validateId(idValue)
  const input = validateInput(inputValue)
  try {
    const result = getDatabase().prepare(`
      UPDATE ${tableForKind[kind]}
      SET name = ?, color = ?, description = ?, updated_at = ?
      WHERE id = ?
    `).run(input.name, input.color, input.description, new Date().toISOString(), id)
    if (result.changes === 0) throw new Error(`The selected ${kind} no longer exists.`)
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error(`A ${kind} with this name already exists.`)
    throw error
  }
  scheduleConfigurationSync()
  return listKind(kind).find((item) => item.id === id)!
}

const removeItem = async (kindValue: unknown, idValue: unknown): Promise<void> => {
  const kind = validateKind(kindValue)
  const id = validateId(idValue)
  getDatabase().prepare(`DELETE FROM ${tableForKind[kind]} WHERE id = ?`).run(id)
  scheduleConfigurationSync()
}

const repositoryKey = (accountId: number, fullName: string): string =>
  `github:${accountId}:${fullName.toLowerCase()}`

const listRepositoryAppearances = async (): Promise<RepositoryAppearanceEntry[]> => {
  const rows = getDatabase().prepare(`
    SELECT account_id, full_name, color FROM organization_repositories
    WHERE color IS NOT NULL
  `).all() as unknown as Array<{ account_id: number; full_name: string; color: string | null }>
  return rows.map((row) => ({
    repositoryKey: repositoryKey(row.account_id, row.full_name),
    color: row.color,
  }))
}

const saveRepositoryColor = async (
  accountIdValue: unknown,
  fullNameValue: unknown,
  colorValue: unknown,
): Promise<RepositoryAppearanceEntry> => {
  if (!Number.isInteger(accountIdValue)) throw new Error('Invalid repository account.')
  if (typeof fullNameValue !== 'string' || !/^[^/]+\/.+$/.test(fullNameValue) || fullNameValue.length > 300) {
    throw new Error('Invalid repository name.')
  }
  if (colorValue !== null &&
    (typeof colorValue !== 'string' || !/^#[0-9a-f]{6}$/i.test(colorValue))) {
    throw new Error('Choose a valid repository color.')
  }
  const accountId = accountIdValue as number
  const fullName = fullNameValue.trim()
  const color = typeof colorValue === 'string' ? colorValue.toLowerCase() : null
  getDatabase().prepare(`
    INSERT INTO organization_repositories (id, provider, account_id, full_name, color)
    VALUES (?, 'github', ?, ?, ?)
    ON CONFLICT(provider, account_id, full_name) DO UPDATE SET
      full_name = excluded.full_name,
      color = excluded.color
  `).run(randomUUID(), accountId, fullName, color)
  scheduleConfigurationSync()
  return { repositoryKey: repositoryKey(accountId, fullName), color }
}

const listAssignments = async (): Promise<RepositoryOrganizationEntry[]> => {
  const db = getDatabase()
  const repositories = db.prepare(`
    SELECT id, account_id, full_name FROM organization_repositories
    ORDER BY full_name COLLATE NOCASE
  `).all() as unknown as Array<{ id: string; account_id: number; full_name: string }>
  const workspaceRows = db.prepare(
    'SELECT repository_id, workspace_id FROM repository_workspaces ORDER BY position',
  ).all() as unknown as Array<{ repository_id: string; workspace_id: string }>
  const groupRows = db.prepare(
    'SELECT repository_id, group_id FROM repository_groups ORDER BY position',
  ).all() as unknown as Array<{ repository_id: string; group_id: string }>
  const tagRows = db.prepare(
    'SELECT repository_id, tag_id FROM repository_tags',
  ).all() as unknown as Array<{ repository_id: string; tag_id: string }>

  return repositories.map((repository) => ({
    repositoryKey: repositoryKey(repository.account_id, repository.full_name),
    workspaceIds: workspaceRows.filter((row) => row.repository_id === repository.id).map((row) => row.workspace_id),
    groupIds: groupRows.filter((row) => row.repository_id === repository.id).map((row) => row.group_id),
    tagIds: tagRows.filter((row) => row.repository_id === repository.id).map((row) => row.tag_id),
  }))
}

interface WorkspaceRepositoryRow {
  repository_id: string
  account_id: number
  full_name: string
}

const workspaceRepositoryRows = (workspaceId: string): WorkspaceRepositoryRow[] =>
  getDatabase().prepare(`
    SELECT repository.id AS repository_id, repository.account_id, repository.full_name
    FROM repository_workspaces link
    JOIN organization_repositories repository ON repository.id = link.repository_id
    WHERE link.workspace_id = ?
    ORDER BY link.repository_position, repository.full_name COLLATE NOCASE
  `).all(workspaceId) as unknown as WorkspaceRepositoryRow[]

const listWorkspaceOrder = async (workspaceIdValue: unknown): Promise<string[]> => {
  const workspaceId = validateId(workspaceIdValue)
  return workspaceRepositoryRows(workspaceId).map((row) =>
    repositoryKey(row.account_id, row.full_name))
}

const workspaceTarget = async (workspaceIdValue: unknown): Promise<WorkspaceLaunchTarget | null> => {
  const workspaceId = validateId(workspaceIdValue)
  const row = getDatabase().prepare(`
    SELECT target_type, target_path FROM workspace_local_targets WHERE workspace_id = ?
  `).get(workspaceId) as { target_type: WorkspaceLaunchTarget['type']; target_path: string } | undefined
  return row ? { workspaceId, type: row.target_type, path: row.target_path } : null
}

const connectWorkspaceTarget = async (
  event: Electron.IpcMainInvokeEvent,
  workspaceIdValue: unknown,
  typeValue: unknown,
): Promise<WorkspaceLaunchTarget | null> => {
  const workspaceId = validateId(workspaceIdValue)
  if (typeValue !== 'folder' && typeValue !== 'code-workspace') {
    throw new Error('Invalid workspace launch target.')
  }
  const type = typeValue as WorkspaceLaunchTarget['type']
  const options: Electron.OpenDialogOptions = type === 'folder'
    ? {
        title: 'Connect workspace folder',
        buttonLabel: 'Connect folder',
        properties: ['openDirectory'],
      }
    : {
        title: 'Connect VS Code workspace',
        buttonLabel: 'Connect workspace',
        properties: ['openFile'],
        filters: [{ name: 'VS Code Workspace', extensions: ['code-workspace'] }],
      }
  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  const selection = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null

  const path = resolve(selection.filePaths[0])
  const details = await stat(path)
  if (type === 'folder' && !details.isDirectory()) throw new Error('Select a folder.')
  if (type === 'code-workspace' &&
    (!details.isFile() || extname(path).toLowerCase() !== '.code-workspace')) {
    throw new Error('Select a .code-workspace file.')
  }

  getDatabase().prepare(`
    INSERT INTO workspace_local_targets (workspace_id, target_type, target_path)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      target_type = excluded.target_type,
      target_path = excluded.target_path
  `).run(workspaceId, type, path)
  return { workspaceId, type, path }
}

const openWorkspaceTarget = async (workspaceIdValue: unknown): Promise<void> => {
  const target = await workspaceTarget(workspaceIdValue)
  if (!target) throw new Error('Connect a folder or VS Code workspace first.')
  try {
    const details = await stat(target.path)
    if (target.type === 'folder' ? !details.isDirectory() : !details.isFile()) {
      throw new Error('wrong type')
    }
  } catch {
    throw new Error('The connected workspace target is no longer available.')
  }
  await launchVSCodeInNewWindow(target.path)
}

const disconnectWorkspaceTarget = async (workspaceIdValue: unknown): Promise<void> => {
  const workspaceId = validateId(workspaceIdValue)
  getDatabase().prepare('DELETE FROM workspace_local_targets WHERE workspace_id = ?').run(workspaceId)
}

const reorderWorkspace = async (
  workspaceIdValue: unknown,
  repositoryKeysValue: unknown,
): Promise<string[]> => {
  const workspaceId = validateId(workspaceIdValue)
  if (!Array.isArray(repositoryKeysValue) || repositoryKeysValue.length > 10_000 ||
    repositoryKeysValue.some((key) => typeof key !== 'string' || key.length > 400)) {
    throw new Error('Invalid workspace repository order.')
  }
  const repositoryKeys = repositoryKeysValue as string[]
  if (new Set(repositoryKeys).size !== repositoryKeys.length) {
    throw new Error('Workspace repository order contains duplicates.')
  }
  const rows = workspaceRepositoryRows(workspaceId)
  const rowByKey = new Map(rows.map((row) => [repositoryKey(row.account_id, row.full_name), row]))
  if (rowByKey.size !== repositoryKeys.length ||
    repositoryKeys.some((key) => !rowByKey.has(key))) {
    throw new Error('Workspace repositories changed. Refresh and try reordering again.')
  }

  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const updatePosition = db.prepare(`
      UPDATE repository_workspaces SET repository_position = ?
      WHERE workspace_id = ? AND repository_id = ?
    `)
    repositoryKeys.forEach((key, position) => {
      updatePosition.run(position, workspaceId, rowByKey.get(key)!.repository_id)
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  scheduleConfigurationSync()
  return repositoryKeys
}

const validateOrganization = (value: unknown): RepositoryOrganization => {
  if (!value || typeof value !== 'object') throw new Error('Invalid repository organization.')
  const candidate = value as Partial<RepositoryOrganization>
  const validateIds = (ids: unknown): string[] => {
    if (!Array.isArray(ids) || ids.length > 500) throw new Error('Invalid organization selection.')
    return [...new Set(ids.map(validateId))]
  }
  return {
    workspaceIds: validateIds(candidate.workspaceIds),
    groupIds: validateIds(candidate.groupIds),
    tagIds: validateIds(candidate.tagIds),
  }
}

const saveRepository = async (
  accountIdValue: unknown,
  fullNameValue: unknown,
  organizationValue: unknown,
): Promise<RepositoryOrganizationEntry> => {
  if (!Number.isInteger(accountIdValue)) throw new Error('Invalid repository account.')
  if (typeof fullNameValue !== 'string' || !/^[^/]+\/.+$/.test(fullNameValue) || fullNameValue.length > 300) {
    throw new Error('Invalid repository name.')
  }
  const accountId = accountIdValue as number
  const fullName = fullNameValue.trim()
  const organization = validateOrganization(organizationValue)
  const db = getDatabase()

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      INSERT INTO organization_repositories (id, provider, account_id, full_name)
      VALUES (?, 'github', ?, ?)
      ON CONFLICT(provider, account_id, full_name) DO UPDATE SET full_name = excluded.full_name
    `).run(randomUUID(), accountId, fullName)
    const row = db.prepare(`
      SELECT id FROM organization_repositories
      WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
    `).get(accountId, fullName) as { id: string } | undefined
    if (!row) throw new Error('Could not organize the repository.')

    const existingWorkspacePositions = new Map(
      (db.prepare(`
        SELECT workspace_id, repository_position FROM repository_workspaces
        WHERE repository_id = ?
      `).all(row.id) as unknown as Array<{
        workspace_id: string
        repository_position: number
      }>).map((item) => [item.workspace_id, item.repository_position]),
    )

    db.prepare('DELETE FROM repository_workspaces WHERE repository_id = ?').run(row.id)
    db.prepare('DELETE FROM repository_groups WHERE repository_id = ?').run(row.id)
    db.prepare('DELETE FROM repository_tags WHERE repository_id = ?').run(row.id)
    const addWorkspace = db.prepare(`
      INSERT INTO repository_workspaces (
        repository_id, workspace_id, position, repository_position
      ) VALUES (?, ?, ?, ?)
    `)
    const addGroup = db.prepare(`
      INSERT INTO repository_groups (repository_id, group_id, position) VALUES (?, ?, ?)
    `)
    const addTag = db.prepare('INSERT INTO repository_tags (repository_id, tag_id) VALUES (?, ?)')
    organization.workspaceIds.forEach((id, position) => {
      const repositoryPosition = existingWorkspacePositions.get(id) ??
        ((db.prepare(`
          SELECT COALESCE(MAX(repository_position), -1) + 1 AS next_position
          FROM repository_workspaces WHERE workspace_id = ?
        `).get(id) as { next_position: number }).next_position)
      addWorkspace.run(row.id, id, position, repositoryPosition)
    })
    organization.groupIds.forEach((id, position) => addGroup.run(row.id, id, position))
    organization.tagIds.forEach((id) => addTag.run(row.id, id))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  scheduleConfigurationSync()
  return { repositoryKey: repositoryKey(accountId, fullName), ...organization }
}

export const registerOrganizationHandlers = (): void => {
  ipcMain.handle('organization:list', () => listCatalog())
  ipcMain.handle('organization:create', (_event, kind, input) => createItem(kind, input))
  ipcMain.handle('organization:update', (_event, kind, id, input) => updateItem(kind, id, input))
  ipcMain.handle('organization:remove', (_event, kind, id) => removeItem(kind, id))
  ipcMain.handle('organization:assignments', () => listAssignments())
  ipcMain.handle('organization:appearances', () => listRepositoryAppearances())
  ipcMain.handle('organization:save-repository-color', (_event, accountId, fullName, color) =>
    saveRepositoryColor(accountId, fullName, color))
  ipcMain.handle('organization:workspace-order', (_event, workspaceId) =>
    listWorkspaceOrder(workspaceId))
  ipcMain.handle('organization:reorder-workspace', (_event, workspaceId, repositoryKeys) =>
    reorderWorkspace(workspaceId, repositoryKeys))
  ipcMain.handle('organization:workspace-target', (_event, workspaceId) =>
    workspaceTarget(workspaceId))
  ipcMain.handle('organization:connect-workspace-target', (event, workspaceId, type) =>
    connectWorkspaceTarget(event, workspaceId, type))
  ipcMain.handle('organization:open-workspace-target', (_event, workspaceId) =>
    openWorkspaceTarget(workspaceId))
  ipcMain.handle('organization:disconnect-workspace-target', (_event, workspaceId) =>
    disconnectWorkspaceTarget(workspaceId))
  ipcMain.handle('organization:save-repository', (_event, accountId, fullName, organization) =>
    saveRepository(accountId, fullName, organization))
}
