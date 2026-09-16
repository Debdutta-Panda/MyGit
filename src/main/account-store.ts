import { app, safeStorage } from 'electron'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GitHubAccount } from '../shared/desktop-api'

interface StoredGitHubAccount extends GitHubAccount {
  encryptedAccessToken: string
  encryptedRefreshToken: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  tokenType: string
}

interface AccountFile {
  version: 1
  accounts: StoredGitHubAccount[]
}

export interface GitHubCredentials {
  accessToken: string
  refreshToken: string | null
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  tokenType: string
}

const emptyFile = (): AccountFile => ({ version: 1, accounts: [] })
const accountFilePath = (): string => join(app.getPath('userData'), 'accounts.json')

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

const publicAccount = ({
  encryptedAccessToken: _accessToken,
  encryptedRefreshToken: _refreshToken,
  accessTokenExpiresAt: _accessTokenExpiresAt,
  refreshTokenExpiresAt: _refreshTokenExpiresAt,
  tokenType: _tokenType,
  ...account
}: StoredGitHubAccount): GitHubAccount => account

const readAccountFile = async (): Promise<AccountFile> => {
  try {
    const contents = await readFile(accountFilePath(), 'utf8')
    const parsed = JSON.parse(contents) as Partial<AccountFile>

    if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      throw new Error('The account store has an unsupported format.')
    }

    return parsed as AccountFile
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile()
    throw error
  }
}

const writeAccountFile = async (contents: AccountFile): Promise<void> => {
  const destination = accountFilePath()
  const temporary = `${destination}.tmp`

  await mkdir(dirname(destination), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, destination)
  await chmod(destination, 0o600)
}

export const listAccounts = async (): Promise<GitHubAccount[]> => {
  const store = await readAccountFile()
  return store.accounts.map(publicAccount)
}

export const getAccountCredentials = async (
  accountId: number,
): Promise<{ account: GitHubAccount; credentials: GitHubCredentials }> => {
  const store = await readAccountFile()
  const storedAccount = store.accounts.find((account) => account.id === accountId)
  if (!storedAccount) throw new Error('The selected GitHub account is no longer connected.')

  return {
    account: publicAccount(storedAccount),
    credentials: {
      accessToken: decrypt(storedAccount.encryptedAccessToken),
      refreshToken: storedAccount.encryptedRefreshToken
        ? decrypt(storedAccount.encryptedRefreshToken)
        : null,
      accessTokenExpiresAt: storedAccount.accessTokenExpiresAt,
      refreshTokenExpiresAt: storedAccount.refreshTokenExpiresAt,
      tokenType: storedAccount.tokenType,
    },
  }
}

export const saveAccount = async (
  account: GitHubAccount,
  credentials: GitHubCredentials,
): Promise<GitHubAccount> => {
  const store = await readAccountFile()
  const storedAccount: StoredGitHubAccount = {
    ...account,
    encryptedAccessToken: encrypt(credentials.accessToken),
    encryptedRefreshToken: credentials.refreshToken ? encrypt(credentials.refreshToken) : null,
    accessTokenExpiresAt: credentials.accessTokenExpiresAt,
    refreshTokenExpiresAt: credentials.refreshTokenExpiresAt,
    tokenType: credentials.tokenType,
  }

  const existingIndex = store.accounts.findIndex((item) => item.id === account.id)
  if (existingIndex >= 0) store.accounts[existingIndex] = storedAccount
  else store.accounts.push(storedAccount)

  await writeAccountFile(store)
  return publicAccount(storedAccount)
}

export const removeAccount = async (accountId: number): Promise<GitHubAccount[]> => {
  const store = await readAccountFile()
  store.accounts = store.accounts.filter((account) => account.id !== accountId)
  await writeAccountFile(store)
  return store.accounts.map(publicAccount)
}
