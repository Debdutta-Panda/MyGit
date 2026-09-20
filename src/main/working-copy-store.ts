import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getDatabase } from './database'
import type { RepositoryAutoPushMode, RepositoryWorkingCopy, RepositoryWorkingCopyType } from '../shared/desktop-api'

interface WorkingCopyRow {
  id: string
  provider: 'github'
  account_id: number
  full_name: string
  local_path: string
  label: string
  copy_type: RepositoryWorkingCopyType
  is_preferred: number
  created_at: string
  last_synced_at: string | null
  last_opened_at: string | null
  last_seen_at: string | null
  auto_push_mode: RepositoryAutoPushMode
}

const rowToWorkingCopy = async (row: WorkingCopyRow): Promise<RepositoryWorkingCopy> => {
  let available = false
  try {
    const folder = await stat(row.local_path)
    await stat(join(row.local_path, '.git'))
    if (!folder.isDirectory()) throw new Error('not a directory')
    available = true
  } catch {
    available = false
  }
  return {
    id: row.id,
    provider: row.provider,
    accountId: row.account_id,
    fullName: row.full_name,
    path: row.local_path,
    label: row.label,
    type: row.copy_type,
    preferred: row.is_preferred === 1,
    available,
    createdAt: row.created_at,
    lastSyncedAt: row.last_synced_at,
    lastOpenedAt: row.last_opened_at,
    lastSeenAt: row.last_seen_at,
    autoPushMode: row.auto_push_mode,
  }
}

const workingCopyRow = (id: string): WorkingCopyRow | undefined =>
  getDatabase().prepare(`
    SELECT id, provider, account_id, full_name, local_path, label, copy_type,
           is_preferred, created_at, last_synced_at, last_opened_at, last_seen_at,
           auto_push_mode
    FROM working_copies WHERE id = ?
  `).get(id) as unknown as WorkingCopyRow | undefined

export const canonicalWorkingCopyPath = async (path: string): Promise<string> => {
  const resolved = resolve(path)
  try {
    return await realpath(resolved)
  } catch {
    return resolved
  }
}

export const listWorkingCopies = async (
  accountId?: number,
  fullName?: string,
): Promise<RepositoryWorkingCopy[]> => {
  const clauses: string[] = []
  const parameters: Array<number | string> = []
  if (accountId !== undefined) {
    clauses.push('account_id = ?')
    parameters.push(accountId)
  }
  if (fullName !== undefined) {
    clauses.push('full_name = ? COLLATE NOCASE')
    parameters.push(fullName)
  }
  const rows = getDatabase().prepare(`
    SELECT id, provider, account_id, full_name, local_path, label, copy_type,
           is_preferred, created_at, last_synced_at, last_opened_at, last_seen_at,
           auto_push_mode
    FROM working_copies
    ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY is_preferred DESC, label COLLATE NOCASE, created_at
  `).all(...parameters) as unknown as WorkingCopyRow[]
  return await Promise.all(rows.map(rowToWorkingCopy))
}

export const getWorkingCopy = async (id: string): Promise<RepositoryWorkingCopy> => {
  const row = workingCopyRow(id)
  if (!row) throw new Error('The selected working copy no longer exists.')
  return await rowToWorkingCopy(row)
}

const syncLegacyProjection = (accountId: number, fullName: string): void => {
  const db = getDatabase()
  const preferred = db.prepare(`
    SELECT id, local_path, created_at, last_synced_at, is_preferred FROM working_copies
    WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
    ORDER BY is_preferred DESC, created_at LIMIT 1
  `).get(accountId, fullName) as {
    id: string
    local_path: string
    created_at: string
    last_synced_at: string | null
    is_preferred: number
  } | undefined
  if (!preferred) {
    db.prepare(`
      DELETE FROM repositories
      WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
    `).run(accountId, fullName)
    return
  }
  if (preferred.is_preferred !== 1) {
    db.prepare('UPDATE working_copies SET is_preferred = 1 WHERE id = ?').run(preferred.id)
  }
  db.prepare(`
    INSERT INTO repositories (
      id, provider, account_id, full_name, local_path, cloned_at, last_synced_at
    ) VALUES (?, 'github', ?, ?, ?, ?, ?)
    ON CONFLICT(provider, account_id, full_name) DO UPDATE SET
      local_path = excluded.local_path,
      cloned_at = excluded.cloned_at,
      last_synced_at = excluded.last_synced_at
  `).run(randomUUID(), accountId, fullName, preferred.local_path,
    preferred.created_at, preferred.last_synced_at)
}

export const refreshLegacyWorkingCopyProjections = (): void => {
  const repositories = getDatabase().prepare(`
    SELECT DISTINCT account_id, full_name FROM working_copies
  `).all() as unknown as Array<{ account_id: number; full_name: string }>
  for (const repository of repositories) {
    syncLegacyProjection(repository.account_id, repository.full_name)
  }
}

export const registerWorkingCopy = async (
  accountId: number,
  fullName: string,
  path: string,
  input: {
    label?: string
    type?: RepositoryWorkingCopyType
    preferred?: boolean
    lastSyncedAt?: string | null
  } = {},
): Promise<RepositoryWorkingCopy> => {
  const canonicalPath = await canonicalWorkingCopyPath(path)
  const db = getDatabase()
  const existingByPath = db.prepare(`
    SELECT id, account_id, full_name FROM working_copies WHERE local_path = ?
  `).get(canonicalPath) as { id: string; account_id: number; full_name: string } | undefined
  if (existingByPath && (existingByPath.account_id !== accountId ||
    existingByPath.full_name.toLowerCase() !== fullName.toLowerCase())) {
    throw new Error('This folder is already registered to a different repository.')
  }
  const count = (db.prepare(`
    SELECT COUNT(*) AS count FROM working_copies
    WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
  `).get(accountId, fullName) as { count: number }).count
  const id = existingByPath?.id ?? randomUUID()
  const label = (input.label?.trim() || (count === 0 ? 'Primary' : `Copy ${count + 1}`)).slice(0, 80)
  const preferred = input.preferred === true || count === 0
  const now = new Date().toISOString()

  db.exec('BEGIN IMMEDIATE')
  try {
    if (preferred) db.prepare(`
      UPDATE working_copies SET is_preferred = 0
      WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
    `).run(accountId, fullName)
    db.prepare(`
      INSERT INTO working_copies (
        id, provider, account_id, full_name, local_path, label, copy_type,
        is_preferred, created_at, last_synced_at, last_seen_at
      ) VALUES (?, 'github', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(local_path) DO UPDATE SET
        label = CASE WHEN working_copies.label = '' THEN excluded.label ELSE working_copies.label END,
        last_seen_at = excluded.last_seen_at
    `).run(id, accountId, fullName, canonicalPath, label, input.type ?? 'clone',
      preferred ? 1 : 0, now, input.lastSyncedAt ?? null, now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  syncLegacyProjection(accountId, fullName)
  return await getWorkingCopy(id)
}

export const updateWorkingCopyLabel = async (id: string, value: string): Promise<RepositoryWorkingCopy> => {
  const label = value.trim()
  if (!label || label.length > 80) throw new Error('Enter a label up to 80 characters.')
  if (getDatabase().prepare('UPDATE working_copies SET label = ? WHERE id = ?').run(label, id).changes === 0) {
    throw new Error('The selected working copy no longer exists.')
  }
  return await getWorkingCopy(id)
}

export const updateWorkingCopyAutoPush = async (
  id: string,
  mode: RepositoryAutoPushMode,
): Promise<RepositoryWorkingCopy> => {
  if (mode !== 'off' && mode !== 'idle') throw new Error('Choose a supported auto-push mode.')
  if (getDatabase().prepare(`
    UPDATE working_copies SET auto_push_mode = ?, auto_push_updated_at = ? WHERE id = ?
  `).run(mode, new Date().toISOString(), id).changes === 0) {
    throw new Error('The selected working copy no longer exists.')
  }
  return await getWorkingCopy(id)
}

export const setPreferredWorkingCopy = async (id: string): Promise<RepositoryWorkingCopy[]> => {
  const row = workingCopyRow(id)
  if (!row) throw new Error('The selected working copy no longer exists.')
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      UPDATE working_copies SET is_preferred = 0
      WHERE provider = ? AND account_id = ? AND full_name = ? COLLATE NOCASE
    `).run(row.provider, row.account_id, row.full_name)
    db.prepare('UPDATE working_copies SET is_preferred = 1 WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  syncLegacyProjection(row.account_id, row.full_name)
  return await listWorkingCopies(row.account_id, row.full_name)
}

export const updateWorkingCopyPath = async (id: string, path: string): Promise<RepositoryWorkingCopy> => {
  const row = workingCopyRow(id)
  if (!row) throw new Error('The selected working copy no longer exists.')
  const canonicalPath = await canonicalWorkingCopyPath(path)
  try {
    getDatabase().prepare(`
      UPDATE working_copies SET local_path = ?, last_seen_at = ? WHERE id = ?
    `).run(canonicalPath, new Date().toISOString(), id)
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('That folder is already registered as a working copy.')
    throw error
  }
  syncLegacyProjection(row.account_id, row.full_name)
  return await getWorkingCopy(id)
}

export const detachWorkingCopy = async (id: string): Promise<void> => {
  const row = workingCopyRow(id)
  if (!row) return
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM workspace_working_copies WHERE working_copy_id = ?').run(id)
    db.prepare('DELETE FROM working_copies WHERE id = ?').run(id)
    const replacement = db.prepare(`
      SELECT id FROM working_copies
      WHERE provider = ? AND account_id = ? AND full_name = ? COLLATE NOCASE
      ORDER BY created_at LIMIT 1
    `).get(row.provider, row.account_id, row.full_name) as { id: string } | undefined
    if (row.is_preferred === 1 && replacement) {
      db.prepare('UPDATE working_copies SET is_preferred = 1 WHERE id = ?').run(replacement.id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  syncLegacyProjection(row.account_id, row.full_name)
}

export const markWorkingCopySynced = async (path: string): Promise<string> => {
  const canonicalPath = await canonicalWorkingCopyPath(path)
  const syncedAt = new Date().toISOString()
  const row = getDatabase().prepare(`
    SELECT id, account_id, full_name FROM working_copies WHERE local_path = ?
  `).get(canonicalPath) as { id: string; account_id: number; full_name: string } | undefined
  if (!row) throw new Error('The repository is not registered as a working copy.')
  getDatabase().prepare(`
    UPDATE working_copies SET last_synced_at = ?, last_seen_at = ? WHERE local_path = ?
  `).run(syncedAt, syncedAt, canonicalPath)
  syncLegacyProjection(row.account_id, row.full_name)
  return syncedAt
}

export const markWorkingCopyOpened = async (path: string): Promise<void> => {
  const canonicalPath = await canonicalWorkingCopyPath(path)
  getDatabase().prepare(`
    UPDATE working_copies SET last_opened_at = ?, last_seen_at = ? WHERE local_path = ?
  `).run(new Date().toISOString(), new Date().toISOString(), canonicalPath)
}

export const replaceWorkingCopyIdentity = async (
  path: string,
  accountId: number,
  fullName: string,
): Promise<void> => {
  const canonicalPath = await canonicalWorkingCopyPath(path)
  const row = getDatabase().prepare(`
    SELECT id, account_id, full_name FROM working_copies WHERE local_path = ?
  `).get(canonicalPath) as {
    id: string
    account_id: number
    full_name: string
  } | undefined
  if (!row) throw new Error('The repository is not registered as a working copy.')
  const db = getDatabase()
  const targetPreferred = db.prepare(`
    SELECT id FROM working_copies
    WHERE provider = 'github' AND account_id = ? AND full_name = ? COLLATE NOCASE
      AND is_preferred = 1
  `).get(accountId, fullName) as { id: string } | undefined
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      DELETE FROM workspace_working_copies
      WHERE working_copy_id = ? AND EXISTS (
        SELECT 1 FROM workspace_working_copies target
        WHERE target.workspace_id = workspace_working_copies.workspace_id
          AND target.provider = 'github' AND target.account_id = ?
          AND target.full_name = ? COLLATE NOCASE
      )
    `).run(row.id, accountId, fullName)
    db.prepare(`
      UPDATE workspace_working_copies
      SET account_id = ?, full_name = ? WHERE working_copy_id = ?
    `).run(accountId, fullName, row.id)
    db.prepare(`
      UPDATE working_copies
      SET account_id = ?, full_name = ?,
          is_preferred = CASE WHEN ? IS NULL THEN is_preferred ELSE 0 END
      WHERE local_path = ?
    `).run(accountId, fullName, targetPreferred?.id ?? null, canonicalPath)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  syncLegacyProjection(row.account_id, row.full_name)
  syncLegacyProjection(accountId, fullName)
}

export const workingCopyPathIsRegistered = async (path: string): Promise<boolean> => {
  const canonicalPath = await canonicalWorkingCopyPath(path)
  return Boolean(getDatabase().prepare('SELECT 1 FROM working_copies WHERE local_path = ?')
    .get(canonicalPath))
}
