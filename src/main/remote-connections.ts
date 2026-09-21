import { BrowserWindow, dialog, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client, type ConnectConfig } from 'ssh2'
import type {
  RemoteAuthenticationType,
  RemoteConnection,
  RemoteConnectionInput,
  RemoteConnectionTestResult,
} from '../shared/desktop-api'
import { getDatabase } from './database'
import { scheduleConfigurationSync } from './configuration-sync'
import { testRemoteFileConnection, type RemoteFileConnection } from './remote-filesystem'
import type { SshRuntimeConnection } from './ssh-connections'

interface RemoteConnectionRow {
  id: string
  name: string
  protocol: 'ftp' | 'ftps' | 'sftp'
  host: string | null
  port: number | null
  username: string | null
  sftp_source: 'ssh' | 'standalone' | null
  ssh_connection_id: string | null
  parent_ssh_connection_id: string | null
  authentication_type: RemoteAuthenticationType | null
  private_key_path: string | null
  agent_socket: string | null
  encrypted_password: string | null
  encrypted_passphrase: string | null
  tls_mode: 'explicit' | 'implicit' | null
  reject_unauthorized: number
  host_fingerprint: string | null
  created_at: string
  updated_at: string
  last_connected_at: string | null
}

const columns = `id, name, protocol, host, port, username, sftp_source, ssh_connection_id, parent_ssh_connection_id,
  authentication_type, private_key_path, agent_socket, encrypted_password, encrypted_passphrase,
  tls_mode, reject_unauthorized, host_fingerprint, created_at, updated_at, last_connected_at`

const rows = (): RemoteConnectionRow[] => getDatabase().prepare(`
  SELECT ${columns} FROM remote_connections ORDER BY name COLLATE NOCASE
`).all() as unknown as RemoteConnectionRow[]

const row = (id: string): RemoteConnectionRow => {
  const value = getDatabase().prepare(`SELECT ${columns} FROM remote_connections WHERE id = ?`)
    .get(id) as unknown as RemoteConnectionRow | undefined
  if (!value) throw new Error('The selected file-transfer connection no longer exists.')
  return value
}

const publicConnection = (value: RemoteConnectionRow): RemoteConnection => ({
  id: value.id,
  name: value.name,
  protocol: value.protocol,
  host: value.host,
  port: value.port,
  username: value.username,
  sftpSource: value.sftp_source,
  sshConnectionId: value.ssh_connection_id,
  parentSshConnectionId: value.parent_ssh_connection_id,
  authenticationType: value.authentication_type,
  privateKeyPath: value.private_key_path,
  agentSocket: value.agent_socket,
  hasPassword: Boolean(value.encrypted_password),
  hasPassphrase: Boolean(value.encrypted_passphrase),
  tlsMode: value.tls_mode,
  rejectUnauthorized: value.reject_unauthorized !== 0,
  hostFingerprint: value.host_fingerprint,
  createdAt: value.created_at,
  updatedAt: value.updated_at,
  lastConnectedAt: value.last_connected_at,
})

const list = (): RemoteConnection[] => rows().map(publicConnection)

const assertVault = (): void => {
  if (!safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('Secure OS credential storage is required to save file-transfer secrets.')
  }
}
const encrypt = (value: string): string => {
  assertVault()
  return safeStorage.encryptString(value).toString('base64')
}
const decrypt = (value: string): string => {
  assertVault()
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}
const text = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value.trim())) throw new Error(`Enter a valid ${label.toLowerCase()}.`)
  return value.trim()
}
const validPort = (value: unknown, fallback: number): number => {
  const port = value === null || value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Enter a valid port.')
  return port
}

const save = (input: RemoteConnectionInput): RemoteConnection[] => {
  if (!input || typeof input !== 'object') throw new Error('Invalid file-transfer connection.')
  if (!['ftp', 'ftps', 'sftp'].includes(input.protocol)) throw new Error('Choose a supported protocol.')
  const existing = input.id ? rows().find((item) => item.id === input.id) : undefined
  const id = existing?.id ?? randomUUID()
  const name = text(input.name, 'Connection name', 100)
  const sftpSource = input.protocol === 'sftp' ? input.sftpSource ?? 'standalone' : null
  if (sftpSource !== null && !['ssh', 'standalone'].includes(sftpSource)) {
    throw new Error('Choose a valid SFTP connection source.')
  }
  const linked = input.protocol === 'sftp' && sftpSource === 'ssh'
  const sshConnectionId = linked ? text(input.sshConnectionId, 'SSH connection', 100) : null
  if (sshConnectionId) {
    const match = getDatabase().prepare('SELECT id FROM ssh_connections WHERE id = ?').get(sshConnectionId)
    if (!match) throw new Error('The selected SSH connection no longer exists.')
  }
  const parentSshConnectionId = typeof input.parentSshConnectionId === 'string' && input.parentSshConnectionId
    ? input.parentSshConnectionId : linked ? sshConnectionId : null
  if (parentSshConnectionId &&
    !getDatabase().prepare('SELECT id FROM ssh_connections WHERE id = ?').get(parentSshConnectionId)) {
    throw new Error('The parent SSH connection no longer exists.')
  }
  const host = linked ? null : text(input.host, 'Host', 255)
  const username = linked ? null : text(input.username, 'Username', 128)
  const defaultPort = input.protocol === 'sftp' ? 22 : input.protocol === 'ftps' && input.tlsMode === 'implicit' ? 990 : 21
  const port = linked ? null : validPort(input.port, defaultPort)
  const authenticationType = input.protocol === 'sftp' && !linked
    ? input.authenticationType ?? 'password'
    : input.protocol === 'sftp' ? null : 'password'
  if (authenticationType && !['password', 'private-key', 'agent'].includes(authenticationType)) {
    throw new Error('Choose a supported authentication method.')
  }
  const privateKeyPath = authenticationType === 'private-key'
    ? text(input.privateKeyPath, 'Private key path', 2_048) : null
  const agentSocket = authenticationType === 'agent'
    ? (typeof input.agentSocket === 'string' && input.agentSocket.trim()
        ? input.agentSocket.trim() : process.env.SSH_AUTH_SOCK ?? null)
    : null
  let encryptedPassword = authenticationType === 'password' ? existing?.encrypted_password ?? null : null
  let encryptedPassphrase = authenticationType === 'private-key' ? existing?.encrypted_passphrase ?? null : null
  if (input.password) encryptedPassword = encrypt(input.password)
  if (input.passphrase && authenticationType === 'private-key') encryptedPassphrase = encrypt(input.passphrase)
  if (authenticationType === 'password' && !encryptedPassword) throw new Error('Enter the connection password.')
  const tlsMode = input.protocol === 'ftps' ? input.tlsMode ?? 'explicit' : null
  const now = new Date().toISOString()
  const endpointChanged = existing && (existing.host !== host || existing.port !== port || existing.username !== username)
  getDatabase().prepare(`
    INSERT INTO remote_connections (${columns})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, protocol=excluded.protocol, host=excluded.host, port=excluded.port,
      username=excluded.username, sftp_source=excluded.sftp_source,
      ssh_connection_id=excluded.ssh_connection_id,
      parent_ssh_connection_id=excluded.parent_ssh_connection_id,
      authentication_type=excluded.authentication_type,
      private_key_path=excluded.private_key_path, agent_socket=excluded.agent_socket,
      encrypted_password=excluded.encrypted_password, encrypted_passphrase=excluded.encrypted_passphrase,
      tls_mode=excluded.tls_mode, reject_unauthorized=excluded.reject_unauthorized,
      host_fingerprint=excluded.host_fingerprint, updated_at=excluded.updated_at
  `).run(
    id, name, input.protocol, host, port, username, sftpSource, sshConnectionId, parentSshConnectionId,
    authenticationType, privateKeyPath, agentSocket, encryptedPassword, encryptedPassphrase,
    tlsMode, input.rejectUnauthorized === false ? 0 : 1,
    endpointChanged ? null : existing?.host_fingerprint ?? null,
    existing?.created_at ?? now, now, existing?.last_connected_at ?? null,
  )
  scheduleConfigurationSync()
  return list()
}

const runtime = (value: RemoteConnectionRow): RemoteFileConnection => {
  if (value.protocol === 'sftp' && value.sftp_source === 'ssh') {
    if (!value.ssh_connection_id) throw new Error('Choose an SSH connection for this SFTP profile.')
    return { protocol: 'sftp', sshConnectionId: value.ssh_connection_id }
  }
  if (!value.host || !value.port || !value.username) throw new Error('Connection details are incomplete.')
  if (value.protocol !== 'sftp') {
    if (!value.encrypted_password) throw new Error('No password is stored for this connection.')
    return {
      protocol: 'ftp', host: value.host, port: value.port, username: value.username,
      password: decrypt(value.encrypted_password),
      security: value.protocol === 'ftp' ? 'none'
        : value.tls_mode === 'implicit' ? 'implicit-tls' : 'explicit-tls',
      rejectUnauthorized: value.reject_unauthorized !== 0,
    }
  }
  if (!value.host_fingerprint) throw new Error('Test and verify this SFTP host before using it.')
  const connection: SshRuntimeConnection = {
    id: value.id, name: value.name, host: value.host, port: value.port, username: value.username,
    authenticationType: value.authentication_type ?? 'password',
    password: value.encrypted_password ? decrypt(value.encrypted_password) : null,
    privateKeyPath: value.private_key_path,
    passphrase: value.encrypted_passphrase ? decrypt(value.encrypted_passphrase) : null,
    agentSocket: value.agent_socket,
    hostFingerprint: value.host_fingerprint,
  }
  return { protocol: 'sftp', connection }
}

export const getRemoteFileConnection = (id: string): RemoteFileConnection => runtime(row(id))

const fingerprint = (key: Buffer): string =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`

const testStandaloneSftp = async (
  value: RemoteConnectionRow,
  trustHostKey: boolean,
): Promise<RemoteConnectionTestResult> => {
  if (!value.host || !value.port || !value.username) throw new Error('Connection details are incomplete.')
  const startedAt = Date.now()
  let observed = ''
  const config: ConnectConfig = {
    host: value.host, port: value.port, username: value.username, readyTimeout: 15_000,
    hostVerifier: (key) => {
      observed = fingerprint(key)
      return value.host_fingerprint ? observed === value.host_fingerprint : trustHostKey
    },
  }
  let keyboardPassword: string | null = null
  if (value.authentication_type === 'password') {
    if (!value.encrypted_password) throw new Error('No password is stored for this connection.')
    keyboardPassword = decrypt(value.encrypted_password)
    config.password = keyboardPassword
    config.tryKeyboard = true
  } else if (value.authentication_type === 'private-key') {
    if (!value.private_key_path) throw new Error('No private key is configured.')
    config.privateKey = await readFile(value.private_key_path)
    if (value.encrypted_passphrase) config.passphrase = decrypt(value.encrypted_passphrase)
  } else {
    if (!value.agent_socket) throw new Error('No SSH agent socket is available.')
    config.agent = value.agent_socket
  }
  return await new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    const finish = (error?: Error, result?: RemoteConnectionTestResult): void => {
      if (settled) return
      settled = true
      client.end()
      if (error) reject(error)
      else resolve(result!)
    }
    client.on('keyboard-interactive', (_name, _instructions, _language, prompts, complete) =>
      complete(prompts.map(() => keyboardPassword ?? '')))
    client.once('ready', () => finish(undefined, {
      status: 'connected', fingerprint: observed, latencyMs: Date.now() - startedAt,
      rootPath: null, message: 'SFTP authentication succeeded.',
    }))
    client.once('error', (error) => {
      if (!value.host_fingerprint && !trustHostKey && observed) {
        finish(undefined, { status: 'untrusted', fingerprint: observed, latencyMs: null,
          rootPath: null, message: 'Confirm this server fingerprint before credentials are sent.' })
      } else if (value.host_fingerprint && observed !== value.host_fingerprint) {
        finish(new Error('The SFTP server host key has changed. Connection blocked.'))
      } else finish(error)
    })
    client.connect(config)
  })
}

const test = async (id: string, trustHostKey: boolean): Promise<RemoteConnectionTestResult> => {
  const value = row(id)
  const result = value.protocol === 'sftp' && value.sftp_source === 'standalone'
    ? await testStandaloneSftp(value, trustHostKey)
    : await (async () => {
        const tested = await testRemoteFileConnection(runtime(value))
        return { status: 'connected' as const, fingerprint: null, latencyMs: null,
          rootPath: tested.rootPath, message: 'Connection succeeded.' }
      })()
  if (result.status === 'connected') {
    const now = new Date().toISOString()
    getDatabase().prepare(`UPDATE remote_connections SET host_fingerprint = COALESCE(?, host_fingerprint),
      last_connected_at = ?, updated_at = ? WHERE id = ?`)
      .run(result.fingerprint, now, now, id)
    scheduleConfigurationSync()
  }
  return result
}

const choosePrivateKey = async (event: IpcMainInvokeEvent): Promise<string | null> => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(owner ?? undefined, {
    title: 'Choose SFTP private key', properties: ['openFile'],
    filters: [{ name: 'SSH private keys', extensions: ['pem', 'key', 'ppk'] },
      { name: 'All files', extensions: ['*'] }],
  })
  return result.canceled ? null : result.filePaths[0] ?? null
}

export const registerRemoteConnectionHandlers = (): void => {
  ipcMain.handle('remote-connections:list', () => list())
  ipcMain.handle('remote-connections:save', (_event, input: RemoteConnectionInput) => save(input))
  ipcMain.handle('remote-connections:remove', (_event, id: string) => {
    getDatabase().prepare('DELETE FROM remote_connections WHERE id = ?').run(id)
    scheduleConfigurationSync()
    return list()
  })
  ipcMain.handle('remote-connections:test', (_event, id: string, trust = false) => test(id, Boolean(trust)))
  ipcMain.handle('remote-connections:choose-private-key', (event) => choosePrivateKey(event))
}
