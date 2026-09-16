import { clipboard, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { listAccounts, removeAccount, saveAccount } from './account-store'
import type { GitHubAccount, GitHubDeviceAuthorization } from '../shared/desktop-api'

const GITHUB_API_VERSION = '2022-11-28'
const REQUESTED_SCOPES = 'repo read:user user:email'

declare const __MYREPOS_GITHUB_CLIENT_ID__: string

interface DeviceCodeResponse {
  device_code?: string
  user_code?: string
  verification_uri?: string
  expires_in?: number
  interval?: number
  error?: string
  error_description?: string
}

interface AccessTokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
  interval?: number
}

interface GitHubUserResponse {
  id: number
  login: string
  name: string | null
  avatar_url: string
  html_url: string
}

interface PendingAuthorization {
  requestId: string
  clientId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalSeconds: number
  cancelled: boolean
}

const pendingAuthorizations = new Map<string, PendingAuthorization>()

export const githubClientId = (): string => {
  const clientId = (
    process.env.MYREPOS_GITHUB_CLIENT_ID || __MYREPOS_GITHUB_CLIENT_ID__
  ).trim()
  if (!clientId) {
    throw new Error(
      'GitHub login is not configured. Set MYREPOS_GITHUB_CLIENT_ID to an OAuth App client ID with Device Flow enabled.',
    )
  }
  return clientId
}

const postGitHubForm = async <T>(url: string, values: Record<string, string>): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'MyRepos',
    },
    body: new URLSearchParams(values),
  })

  const body = (await response.json()) as T
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`)
  return body
}

const startAuthorization = async (): Promise<GitHubDeviceAuthorization> => {
  const clientId = githubClientId()
  const response = await postGitHubForm<DeviceCodeResponse>('https://github.com/login/device/code', {
    client_id: clientId,
    scope: REQUESTED_SCOPES,
  })

  if (response.error) throw new Error(response.error_description ?? response.error)
  if (
    !response.device_code ||
    !response.user_code ||
    !response.verification_uri ||
    !response.expires_in
  ) {
    throw new Error('GitHub returned an incomplete device authorization response.')
  }

  const requestId = randomUUID()
  const expiresAt = Date.now() + response.expires_in * 1000
  pendingAuthorizations.set(requestId, {
    requestId,
    clientId,
    deviceCode: response.device_code,
    userCode: response.user_code,
    verificationUri: response.verification_uri,
    expiresAt,
    intervalSeconds: Math.max(response.interval ?? 5, 5),
    cancelled: false,
  })

  return {
    requestId,
    userCode: response.user_code,
    verificationUri: response.verification_uri,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

const getPendingAuthorization = (requestId: string): PendingAuthorization => {
  const pending = pendingAuthorizations.get(requestId)
  if (!pending) throw new Error('This GitHub authorization request is no longer active.')
  return pending
}

const launchAuthorization = async (requestId: string): Promise<void> => {
  const pending = getPendingAuthorization(requestId)
  clipboard.writeText(pending.userCode)
  await shell.openExternal(pending.verificationUri)
}

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const githubAccountFromToken = async (
  token: string,
  scopes: string[],
): Promise<GitHubAccount> => {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'MyRepos',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
  })

  if (!response.ok) throw new Error(`Unable to read the GitHub account (HTTP ${response.status}).`)
  const user = (await response.json()) as GitHubUserResponse

  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
    scopes,
    addedAt: new Date().toISOString(),
  }
}

const authorizationError = (response: AccessTokenResponse): Error => {
  switch (response.error) {
    case 'access_denied':
      return new Error('GitHub authorization was cancelled.')
    case 'expired_token':
      return new Error('The GitHub authorization code expired. Please try again.')
    case 'device_flow_disabled':
      return new Error('Device Flow is not enabled for this GitHub OAuth App.')
    case 'incorrect_client_credentials':
      return new Error('The configured GitHub OAuth client ID is invalid.')
    default:
      return new Error(response.error_description ?? response.error ?? 'GitHub authorization failed.')
  }
}

const waitForAuthorization = async (requestId: string): Promise<GitHubAccount> => {
  const pending = getPendingAuthorization(requestId)

  try {
    while (Date.now() < pending.expiresAt) {
      if (pending.cancelled) throw new Error('GitHub authorization was cancelled.')
      await delay(pending.intervalSeconds * 1000)
      if (pending.cancelled) throw new Error('GitHub authorization was cancelled.')

      const response = await postGitHubForm<AccessTokenResponse>(
        'https://github.com/login/oauth/access_token',
        {
          client_id: pending.clientId,
          device_code: pending.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
      )

      if (response.error === 'authorization_pending') continue
      if (response.error === 'slow_down') {
        pending.intervalSeconds = Math.max(
          response.interval ?? pending.intervalSeconds + 5,
          pending.intervalSeconds + 5,
        )
        continue
      }
      if (response.error) throw authorizationError(response)
      if (!response.access_token) throw new Error('GitHub did not return an access token.')

      const now = Date.now()
      const scopes = (response.scope ?? '')
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean)
      const account = await githubAccountFromToken(response.access_token, scopes)

      return await saveAccount(account, {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? null,
        accessTokenExpiresAt: response.expires_in
          ? new Date(now + response.expires_in * 1000).toISOString()
          : null,
        refreshTokenExpiresAt: response.refresh_token_expires_in
          ? new Date(now + response.refresh_token_expires_in * 1000).toISOString()
          : null,
        tokenType: response.token_type ?? 'bearer',
      })
    }

    throw new Error('The GitHub authorization code expired. Please try again.')
  } finally {
    pendingAuthorizations.delete(requestId)
  }
}

export const registerGitHubAccountHandlers = (): void => {
  ipcMain.handle('accounts:list', () => listAccounts())
  ipcMain.handle('accounts:remove', (_event, accountId: number) => removeAccount(accountId))
  ipcMain.handle('github:start', () => startAuthorization())
  ipcMain.handle('github:launch', (_event, requestId: string) => launchAuthorization(requestId))
  ipcMain.handle('github:wait', (_event, requestId: string) => waitForAuthorization(requestId))
  ipcMain.handle('github:cancel', (_event, requestId: string) => {
    const pending = pendingAuthorizations.get(requestId)
    if (pending) pending.cancelled = true
  })
}
