import { safeStorage } from 'electron'
import type { SshMySqlAccessInput, SshMySqlAccessMode, SshMySqlAccessProfile } from '../shared/desktop-api'
import { getDatabase } from './database'

interface MySqlProfileRow {
  connection_id: string
  access_mode: SshMySqlAccessMode
  username: string
  encrypted_password: string | null
  updated_at: string
}

export interface MySqlRuntimeProfile extends SshMySqlAccessProfile {
  password: string | null
}

const assertSecureStorage = (): void => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this system.')
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('A Linux Secret Service or KWallet is required to store database credentials securely.')
  }
}

const encrypt = (value: string): string => {
  assertSecureStorage()
  return safeStorage.encryptString(value).toString('base64')
}

const decrypt = (value: string): string => {
  assertSecureStorage()
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

const rowFor = (connectionId: string): MySqlProfileRow | undefined =>
  getDatabase().prepare(`
    SELECT connection_id, access_mode, username, encrypted_password, updated_at
    FROM ssh_mysql_profiles WHERE connection_id = ?
  `).get(connectionId) as unknown as MySqlProfileRow | undefined

const publicProfile = (row: MySqlProfileRow): SshMySqlAccessProfile => ({
  connectionId: row.connection_id,
  mode: row.access_mode,
  username: row.username,
  hasPassword: Boolean(row.encrypted_password),
  updatedAt: row.updated_at,
})

export const getMysqlAccessProfile = (connectionId: string): SshMySqlAccessProfile | null => {
  const row = rowFor(connectionId)
  return row ? publicProfile(row) : null
}

export const getMysqlRuntimeProfile = (connectionId: string): MySqlRuntimeProfile | null => {
  const row = rowFor(connectionId)
  return row ? { ...publicProfile(row), password: row.encrypted_password ? decrypt(row.encrypted_password) : null } : null
}

export const saveMysqlAccessProfile = (connectionId: string, input: SshMySqlAccessInput): SshMySqlAccessProfile => {
  const username = input.mode === 'system' ? '' : input.username.trim()
  if (input.mode === 'password' && (!username || /[\r\n\0]/.test(username) || username.length > 128)) {
    throw new Error('Enter a valid MySQL username.')
  }
  const existing = rowFor(connectionId)
  let encryptedPassword: string | null = null
  if (input.mode === 'password') {
    encryptedPassword = input.password ? encrypt(input.password) : existing?.access_mode === 'password' ? existing.encrypted_password : null
    if (!encryptedPassword) throw new Error('Enter the MySQL password.')
  }
  const updatedAt = new Date().toISOString()
  getDatabase().prepare(`
    INSERT INTO ssh_mysql_profiles (connection_id, access_mode, username, encrypted_password, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(connection_id) DO UPDATE SET
      access_mode = excluded.access_mode,
      username = excluded.username,
      encrypted_password = excluded.encrypted_password,
      updated_at = excluded.updated_at
  `).run(connectionId, input.mode, username, encryptedPassword, updatedAt)
  return getMysqlAccessProfile(connectionId)!
}

export const clearMysqlAccessProfile = (connectionId: string): void => {
  getDatabase().prepare('DELETE FROM ssh_mysql_profiles WHERE connection_id = ?').run(connectionId)
}
