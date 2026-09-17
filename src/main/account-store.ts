import { safeStorage } from 'electron'
import type { GitHubAccount } from '../shared/desktop-api'
import { getDatabase } from './database'

interface StoredGitHubAccount extends GitHubAccount {
  encryptedAccessToken: string
  encryptedRefreshToken: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  tokenType: string
}

interface AccountRow {
  id: number
  login: string
  name: string | null
  avatar_url: string
  profile_url: string
  scopes_json: string
  added_at: string
  encrypted_access_token: string
  encrypted_refresh_token: string | null
  access_token_expires_at: string | null
  refresh_token_expires_at: string | null
  token_type: string
}

export interface GitHubCredentials {
  accessToken: string
  refreshToken: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  tokenType: string
}

const assertSecureStorage = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this system.')
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('A Linux Secret Service or KWallet is required to store GitHub credentials securely.')
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

const parseScopes = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every((scope) => typeof scope === 'string') ? parsed : []
  } catch {
    return []
  }
}

const storedAccount = (row: AccountRow): StoredGitHubAccount => ({
  id: row.id,
  login: row.login,
  name: row.name,
  avatarUrl: row.avatar_url,
  profileUrl: row.profile_url,
  scopes: parseScopes(row.scopes_json),
  addedAt: row.added_at,
  encryptedAccessToken: row.encrypted_access_token,
  encryptedRefreshToken: row.encrypted_refresh_token,
  accessTokenExpiresAt: row.access_token_expires_at,
  refreshTokenExpiresAt: row.refresh_token_expires_at,
  tokenType: row.token_type,
})

const publicAccount = ({
  encryptedAccessToken: _accessToken,
  encryptedRefreshToken: _refreshToken,
  accessTokenExpiresAt: _accessTokenExpiresAt,
  refreshTokenExpiresAt: _refreshTokenExpiresAt,
  tokenType: _tokenType,
  ...account
}: StoredGitHubAccount): GitHubAccount => account

const accountRows = (): AccountRow[] => getDatabase().prepare(`
  SELECT id, login, name, avatar_url, profile_url, scopes_json, added_at,
         encrypted_access_token, encrypted_refresh_token, access_token_expires_at,
         refresh_token_expires_at, token_type
  FROM accounts
  ORDER BY added_at, id
`).all() as unknown as AccountRow[]

export const listAccounts = async (): Promise<GitHubAccount[]> =>
  accountRows().map(storedAccount).map(publicAccount)

export const getAccountCredentials = async (
  accountId: number,
): Promise<{ account: GitHubAccount; credentials: GitHubCredentials }> => {
  const row = getDatabase().prepare(`
    SELECT id, login, name, avatar_url, profile_url, scopes_json, added_at,
           encrypted_access_token, encrypted_refresh_token, access_token_expires_at,
           refresh_token_expires_at, token_type
    FROM accounts WHERE id = ?
  `).get(accountId) as unknown as AccountRow | undefined
  if (!row) throw new Error('The selected GitHub account is no longer connected.')
  const account = storedAccount(row)
  return {
    account: publicAccount(account),
    credentials: {
      accessToken: decrypt(account.encryptedAccessToken),
      refreshToken: account.encryptedRefreshToken ? decrypt(account.encryptedRefreshToken) : null,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt,
      tokenType: account.tokenType,
    },
  }
}

export const saveAccount = async (
  account: GitHubAccount,
  credentials: GitHubCredentials,
): Promise<GitHubAccount> => {
  getDatabase().prepare(`
    INSERT INTO accounts (
      id, login, name, avatar_url, profile_url, scopes_json, added_at,
      encrypted_access_token, encrypted_refresh_token, access_token_expires_at,
      refresh_token_expires_at, token_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      login = excluded.login,
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      profile_url = excluded.profile_url,
      scopes_json = excluded.scopes_json,
      added_at = excluded.added_at,
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      access_token_expires_at = excluded.access_token_expires_at,
      refresh_token_expires_at = excluded.refresh_token_expires_at,
      token_type = excluded.token_type
  `).run(
    account.id, account.login, account.name, account.avatarUrl, account.profileUrl,
    JSON.stringify(account.scopes), account.addedAt, encrypt(credentials.accessToken),
    credentials.refreshToken ? encrypt(credentials.refreshToken) : null,
    credentials.accessTokenExpiresAt, credentials.refreshTokenExpiresAt, credentials.tokenType,
  )
  return account
}

export const removeAccount = async (accountId: number): Promise<GitHubAccount[]> => {
  getDatabase().prepare('DELETE FROM accounts WHERE id = ?').run(accountId)
  return await listAccounts()
}
