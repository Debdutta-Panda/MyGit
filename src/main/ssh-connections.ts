import { BrowserWindow, dialog, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client, type ConnectConfig } from 'ssh2'
import type {
  SshCommandTemplate,
  SshCommandTemplateKind,
  SshAuthenticationType,
  SshConnection,
  SshConnectionInput,
  SshConnectionTestResult,
  SshVaultStatus,
} from '../shared/desktop-api'
import { getDatabase } from './database'

interface SshConnectionRow {
  id: string
  name: string
  host: string
  port: number
  username: string
  authentication_type: SshAuthenticationType
  private_key_path: string | null
  agent_socket: string | null
  encrypted_password: string | null
  encrypted_passphrase: string | null
  host_fingerprint: string | null
  created_at: string
  updated_at: string
  last_connected_at: string | null
}

export interface SshRuntimeConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  authenticationType: SshAuthenticationType
  password: string | null
  privateKeyPath: string | null
  passphrase: string | null
  agentSocket: string | null
  hostFingerprint: string
}

const assertSecureStorage = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this system.')
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('A Linux Secret Service or KWallet is required to store SSH secrets securely.')
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

const vaultStatus = (): SshVaultStatus => {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const backend = !encryptionAvailable
    ? 'unavailable'
    : process.platform === 'win32'
      ? 'windows_dpapi'
      : process.platform === 'darwin'
        ? 'macos_keychain'
        : safeStorage.getSelectedStorageBackend()
  const insecureLinux = process.platform === 'linux' && backend === 'basic_text'
  const available = encryptionAvailable && !insecureLinux
  const label = process.platform === 'win32'
    ? 'Windows DPAPI'
    : process.platform === 'darwin'
      ? 'macOS Keychain'
      : backend === 'kwallet'
        ? 'KWallet'
        : backend === 'gnome_libsecret'
          ? 'Linux Secret Service'
          : available ? backend : 'Secure storage unavailable'
  return { available, backend, label }
}

const publicConnection = (row: SshConnectionRow): SshConnection => ({
  id: row.id,
  name: row.name,
  host: row.host,
  port: row.port,
  username: row.username,
  authenticationType: row.authentication_type,
  privateKeyPath: row.private_key_path,
  agentSocket: row.agent_socket,
  hasPassword: Boolean(row.encrypted_password),
  hasPassphrase: Boolean(row.encrypted_passphrase),
  hostFingerprint: row.host_fingerprint,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastConnectedAt: row.last_connected_at,
})

const connectionRows = (): SshConnectionRow[] => getDatabase().prepare(`
  SELECT id, name, host, port, username, authentication_type, private_key_path,
         agent_socket, encrypted_password, encrypted_passphrase, host_fingerprint,
         created_at, updated_at, last_connected_at
  FROM ssh_connections
  ORDER BY name COLLATE NOCASE, host COLLATE NOCASE, port
`).all() as unknown as SshConnectionRow[]

const listConnections = (): SshConnection[] => connectionRows().map(publicConnection)

const connectionRow = (id: string): SshConnectionRow => {
  const row = getDatabase().prepare(`
    SELECT id, name, host, port, username, authentication_type, private_key_path,
           agent_socket, encrypted_password, encrypted_passphrase, host_fingerprint,
           created_at, updated_at, last_connected_at
    FROM ssh_connections WHERE id = ?
  `).get(id) as unknown as SshConnectionRow | undefined
  if (!row) throw new Error('The selected SSH connection no longer exists.')
  return row
}

export const getSshRuntimeConnection = (id: string): SshRuntimeConnection => {
  const row = connectionRow(id)
  if (!row.host_fingerprint) {
    throw new Error('Test and verify this SSH connection before opening a terminal.')
  }
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authenticationType: row.authentication_type,
    password: row.encrypted_password ? decrypt(row.encrypted_password) : null,
    privateKeyPath: row.private_key_path,
    passphrase: row.encrypted_passphrase ? decrypt(row.encrypted_passphrase) : null,
    agentSocket: row.agent_socket,
    hostFingerprint: row.host_fingerprint,
  }
}

const cleanText = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f]/.test(cleaned)) {
    throw new Error(`Enter a valid ${label.toLowerCase()}.`)
  }
  return cleaned
}

const saveConnection = (input: SshConnectionInput): SshConnection[] => {
  if (!input || typeof input !== 'object') throw new Error('Invalid SSH connection.')
  const id = typeof input.id === 'string' && input.id ? input.id : randomUUID()
  const existing = typeof input.id === 'string'
    ? connectionRows().find((connection) => connection.id === input.id)
    : undefined
  const name = cleanText(input.name, 'Connection name', 100)
  const host = cleanText(input.host, 'Host', 255)
  const username = cleanText(input.username, 'Username', 128)
  const port = Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid SSH port.')
  const authenticationType = input.authenticationType
  if (!(['password', 'private-key', 'agent'] as const).includes(authenticationType)) {
    throw new Error('Choose a supported SSH authentication method.')
  }
  const privateKeyPath = authenticationType === 'private-key'
    ? cleanText(input.privateKeyPath, 'Private key path', 2_048)
    : null
  const agentSocket = authenticationType === 'agent'
    ? (typeof input.agentSocket === 'string' && input.agentSocket.trim()
        ? input.agentSocket.trim()
        : process.env.SSH_AUTH_SOCK ?? (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : null))
    : null
  let encryptedPassword = authenticationType === 'password'
    ? existing?.encrypted_password ?? null
    : null
  let encryptedPassphrase = authenticationType === 'private-key'
    ? existing?.encrypted_passphrase ?? null
    : null
  if (authenticationType === 'password' && input.password) encryptedPassword = encrypt(input.password)
  if (authenticationType === 'private-key' && input.passphrase) encryptedPassphrase = encrypt(input.passphrase)
  if (authenticationType === 'password' && !encryptedPassword) throw new Error('Enter the SSH password.')
  if (!vaultStatus().available && (encryptedPassword || encryptedPassphrase)) assertSecureStorage()

  const now = new Date().toISOString()
  getDatabase().prepare(`
    INSERT INTO ssh_connections (
      id, name, host, port, username, authentication_type, private_key_path,
      agent_socket, encrypted_password, encrypted_passphrase, host_fingerprint,
      created_at, updated_at, last_connected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      host = excluded.host,
      port = excluded.port,
      username = excluded.username,
      authentication_type = excluded.authentication_type,
      private_key_path = excluded.private_key_path,
      agent_socket = excluded.agent_socket,
      encrypted_password = excluded.encrypted_password,
      encrypted_passphrase = excluded.encrypted_passphrase,
      host_fingerprint = CASE
        WHEN ssh_connections.host = excluded.host AND ssh_connections.port = excluded.port
          THEN ssh_connections.host_fingerprint
        ELSE NULL
      END,
      updated_at = excluded.updated_at
  `).run(
    id, name, host, port, username, authenticationType, privateKeyPath,
    agentSocket, encryptedPassword, encryptedPassphrase, existing?.host_fingerprint ?? null,
    existing?.created_at ?? now, now, existing?.last_connected_at ?? null,
  )
  return listConnections()
}

const removeConnection = (id: string): SshConnection[] => {
  getDatabase().prepare('DELETE FROM ssh_connections WHERE id = ?').run(id)
  return listConnections()
}

const templateKind = (value: unknown): SshCommandTemplateKind => {
  if (value !== 'snippets' && value !== 'scripts') throw new Error('Invalid command template kind.')
  return value
}

const commandTemplates = (connectionId: string, inputKind: unknown): SshCommandTemplate[] => {
  const kind = templateKind(inputKind)
  connectionRow(connectionId)
  const rows = getDatabase().prepare(`
    SELECT id, name, template, variable_types_json, updated_at
    FROM ssh_command_templates WHERE connection_id = ? AND kind = ?
    ORDER BY updated_at DESC, name COLLATE NOCASE
  `).all(connectionId, kind) as unknown as Array<{
    id: string; name: string; template: string; variable_types_json: string; updated_at: string
  }>
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    template: row.template,
    updatedAt: row.updated_at,
    variableTypes: JSON.parse(row.variable_types_json) as SshCommandTemplate['variableTypes'],
  }))
}

const saveCommandTemplates = (
  connectionId: string,
  inputKind: unknown,
  input: unknown,
): SshCommandTemplate[] => {
  const kind = templateKind(inputKind)
  connectionRow(connectionId)
  if (!Array.isArray(input) || input.length > 1_000) throw new Error('Invalid command templates.')
  const allowedTypes = new Set(['path', 'user', 'group', 'mode', 'text'])
  const templates = input.map((value): SshCommandTemplate => {
    if (!value || typeof value !== 'object') throw new Error('Invalid command template.')
    const item = value as Partial<SshCommandTemplate>
    if (typeof item.id !== 'string' || !item.id || item.id.length > 100 ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 ||
      typeof item.template !== 'string' || item.template.length > 200_000 ||
      typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) {
      throw new Error('Invalid command template.')
    }
    const variableTypes = item.variableTypes ?? {}
    if (!variableTypes || typeof variableTypes !== 'object' || Array.isArray(variableTypes) ||
      Object.keys(variableTypes).length > 200 ||
      Object.entries(variableTypes).some(([name, type]) => !name || name.length > 100 || !allowedTypes.has(type))) {
      throw new Error('Invalid command template variable types.')
    }
    return { id: item.id, name: item.name.trim(), template: item.template, updatedAt: item.updatedAt, variableTypes }
  })
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM ssh_command_templates WHERE connection_id = ? AND kind = ?')
      .run(connectionId, kind)
    const insert = db.prepare(`
      INSERT INTO ssh_command_templates
        (connection_id, kind, id, name, template, variable_types_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of templates) insert.run(
      connectionId, kind, item.id, item.name, item.template,
      JSON.stringify(item.variableTypes ?? {}), item.updatedAt,
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return commandTemplates(connectionId, kind)
}

const fingerprintForKey = (key: Buffer): string =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`

const testConnection = async (
  id: string,
  trustHostKey: boolean,
): Promise<SshConnectionTestResult> => {
  const row = connectionRow(id)
  const startedAt = Date.now()
  let observedFingerprint = ''
  const config: ConnectConfig = {
    host: row.host,
    port: row.port,
    username: row.username,
    readyTimeout: 12_000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 2,
    hostVerifier: (key) => {
      observedFingerprint = fingerprintForKey(key)
      if (row.host_fingerprint) return observedFingerprint === row.host_fingerprint
      return trustHostKey
    },
  }
  let keyboardPassword: string | null = null
  if (row.authentication_type === 'password') {
    if (!row.encrypted_password) throw new Error('No password is stored for this connection.')
    keyboardPassword = decrypt(row.encrypted_password)
    config.password = keyboardPassword
    config.tryKeyboard = true
  } else if (row.authentication_type === 'private-key') {
    if (!row.private_key_path) throw new Error('No private key is configured.')
    config.privateKey = await readFile(row.private_key_path)
    if (row.encrypted_passphrase) config.passphrase = decrypt(row.encrypted_passphrase)
  } else {
    const agent = row.agent_socket || process.env.SSH_AUTH_SOCK
    if (!agent) throw new Error('No SSH agent socket is available.')
    config.agent = agent
  }

  return await new Promise<SshConnectionTestResult>((resolve, reject) => {
    const client = new Client()
    let settled = false
    const finish = (
      error: Error | null,
      result?: SshConnectionTestResult,
    ): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      client.end()
      if (error) reject(error)
      else resolve(result!)
    }
    const timeout = setTimeout(() => {
      client.destroy()
      finish(new Error('SSH connection timed out.'))
    }, 15_000)
    client.on('keyboard-interactive', (_name, _instructions, _language, prompts, complete) => {
      complete(prompts.map(() => keyboardPassword ?? ''))
    })
    client.once('ready', () => {
      if (!observedFingerprint) {
        finish(new Error('The server did not provide a host fingerprint.'))
        return
      }
      const now = new Date().toISOString()
      getDatabase().prepare(`
        UPDATE ssh_connections
        SET host_fingerprint = ?, last_connected_at = ?, updated_at = ?
        WHERE id = ?
      `).run(observedFingerprint, now, now, id)
      finish(null, {
        status: 'connected',
        fingerprint: observedFingerprint,
        latencyMs: Date.now() - startedAt,
        message: 'Authentication succeeded.',
      })
    })
    client.once('error', (error) => {
      if (!row.host_fingerprint && !trustHostKey && observedFingerprint) {
        finish(null, {
          status: 'untrusted',
          fingerprint: observedFingerprint,
          latencyMs: null,
          message: 'Confirm this server fingerprint before credentials are sent.',
        })
        return
      }
      if (row.host_fingerprint && observedFingerprint &&
        observedFingerprint !== row.host_fingerprint) {
        finish(new Error('The server host key has changed. Connection blocked.'))
        return
      }
      finish(error)
    })
    client.connect(config)
  })
}

const choosePrivateKey = async (event: IpcMainInvokeEvent): Promise<string | null> => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(owner ?? undefined, {
    title: 'Choose SSH private key',
    properties: ['openFile'],
    filters: [
      { name: 'SSH private keys', extensions: ['pem', 'key', 'ppk'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  return result.canceled ? null : result.filePaths[0] ?? null
}

export const registerSshConnectionHandlers = (): void => {
  ipcMain.handle('ssh:list', () => listConnections())
  ipcMain.handle('ssh:save', (_event, input: SshConnectionInput) => saveConnection(input))
  ipcMain.handle('ssh:remove', (_event, id: string) => removeConnection(id))
  ipcMain.handle('ssh:test', (_event, id: string, trustHostKey = false) =>
    testConnection(id, Boolean(trustHostKey)))
  ipcMain.handle('ssh:choose-private-key', (event) => choosePrivateKey(event))
  ipcMain.handle('ssh:vault-status', () => vaultStatus())
  ipcMain.handle('ssh:command-templates', (_event, id: string, kind: unknown) =>
    commandTemplates(id, kind))
  ipcMain.handle('ssh:save-command-templates', (_event, id: string, kind: unknown, templates: unknown) =>
    saveCommandTemplates(id, kind, templates))
}
