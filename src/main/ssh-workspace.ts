import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type {
  SshDirectoryListing,
  SshRemoteEntry,
  SshServerOverview,
} from '../shared/desktop-api'
import { getSshRuntimeConnection, type SshRuntimeConnection } from './ssh-connections'

const MAX_COMMAND_OUTPUT = 2 * 1024 * 1024

const connect = async (connection: SshRuntimeConnection): Promise<Client> => {
  const config: ConnectConfig = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    readyTimeout: 15_000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    hostVerifier: (key) => {
      const { createHash } = require('node:crypto') as typeof import('node:crypto')
      const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
      return fingerprint === connection.hostFingerprint
    },
  }
  let keyboardPassword: string | null = null
  if (connection.authenticationType === 'password') {
    if (!connection.password) throw new Error('No password is stored for this connection.')
    keyboardPassword = connection.password
    config.password = connection.password
    config.tryKeyboard = true
  } else if (connection.authenticationType === 'private-key') {
    if (!connection.privateKeyPath) throw new Error('No private key is configured.')
    config.privateKey = await readFile(connection.privateKeyPath)
    if (connection.passphrase) config.passphrase = connection.passphrase
  } else {
    if (!connection.agentSocket) throw new Error('No SSH agent socket is available.')
    config.agent = connection.agentSocket
  }

  return await new Promise<Client>((resolve, reject) => {
    const client = new Client()
    const timeout = setTimeout(() => {
      client.destroy()
      reject(new Error('SSH connection timed out.'))
    }, 18_000)
    client.on('keyboard-interactive', (_name, _instructions, _language, prompts, complete) => {
      complete(prompts.map(() => keyboardPassword ?? ''))
    })
    client.once('ready', () => {
      clearTimeout(timeout)
      resolve(client)
    })
    client.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    client.connect(config)
  })
}

const withClient = async <Result>(
  id: string,
  operation: (client: Client, connection: SshRuntimeConnection) => Promise<Result>,
): Promise<Result> => {
  const connection = getSshRuntimeConnection(id)
  const client = await connect(connection)
  try {
    return await operation(client, connection)
  } finally {
    client.end()
  }
}

const exec = async (client: Client, command: string): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error)
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (failure?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (failure) reject(failure)
        else resolve(stdout.trim())
      }
      const append = (current: string, chunk: Buffer): string => {
        if (current.length + chunk.length > MAX_COMMAND_OUTPUT) {
          finish(new Error('The server returned too much data.'))
          stream.close()
          return current
        }
        return current + chunk.toString('utf8')
      }
      const timeout = setTimeout(() => {
        stream.close()
        finish(new Error('The server operation timed out.'))
      }, 20_000)
      stream.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
      stream.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
      stream.once('close', (code: number | null) => {
        if (code && code !== 0) finish(new Error(stderr.trim() || `Remote command failed (${code}).`))
        else finish()
      })
      stream.once('error', (streamError: Error) => finish(streamError))
    })
  })

const numberOrNull = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const serverOverview = async (id: string): Promise<SshServerOverview> =>
  await withClient(id, async (client, connection) => {
    const output = await exec(client, [
      "printf '%s\\n' \"$(hostname 2>/dev/null || printf unknown)\"",
      "printf '%s\\n' \"$(uname -s 2>/dev/null || printf unknown)\"",
      "printf '%s\\n' \"$(uname -r 2>/dev/null || printf unknown)\"",
      "printf '%s\\n' \"$(uname -m 2>/dev/null || printf unknown)\"",
      "printf '%s\\n' \"$(uptime -p 2>/dev/null || uptime 2>/dev/null || printf unknown)\"",
      "printf '%s\\n' \"$(cat /proc/loadavg 2>/dev/null | cut -d' ' -f1-3 || printf unknown)\"",
      "printf '%s\\n' \"$HOME\"",
      "printf '%s\\n' \"${SHELL:-unknown}\"",
      "printf '%s\\n' \"$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 0)\"",
      "awk '/MemTotal:/{print $2*1024}' /proc/meminfo 2>/dev/null || printf '0\\n'",
      "awk '/MemAvailable:/{print $2*1024}' /proc/meminfo 2>/dev/null || printf '0\\n'",
      "df -Pk \"$HOME\" 2>/dev/null | awk 'NR==2 {printf \"%s\\n%s\\n%s\\n\", $2*1024, $3*1024, $4*1024}'",
    ].join('; '))
    const values = output.split(/\r?\n/)
    return {
      connectionId: connection.id,
      hostname: values[0] || connection.host,
      operatingSystem: values[1] || 'Unknown',
      kernel: values[2] || 'Unknown',
      architecture: values[3] || 'Unknown',
      uptime: values[4] || 'Unknown',
      loadAverage: values[5] || 'Unknown',
      homeDirectory: values[6] || '.',
      shell: values[7] || 'Unknown',
      cpuCount: numberOrNull(values[8]),
      totalMemoryBytes: numberOrNull(values[9]),
      freeMemoryBytes: numberOrNull(values[10]),
      diskTotalBytes: numberOrNull(values[11]),
      diskUsedBytes: numberOrNull(values[12]),
      diskAvailableBytes: numberOrNull(values[13]),
      fetchedAt: new Date().toISOString(),
    }
  })

const sftp = async (client: Client): Promise<SFTPWrapper> =>
  await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, wrapper) => {
    if (error) reject(error)
    else resolve(wrapper)
  }))

const normalizeRemotePath = (path: string | null | undefined): string => {
  if (!path || path === '~') return '.'
  if (path.length > 4_096 || path.includes('\0')) throw new Error('Invalid remote path.')
  return posix.normalize(path.replace(/\\/g, '/'))
}

const listDirectory = async (id: string, requestedPath?: string | null): Promise<SshDirectoryListing> =>
  await withClient(id, async (client, connection) => {
    const remote = await sftp(client)
    const target = normalizeRemotePath(requestedPath)
    const resolvedPath = await new Promise<string>((resolve, reject) =>
      remote.realpath(target, (error, absolutePath) => error ? reject(error) : resolve(absolutePath)))
    const rows = await new Promise<Parameters<Parameters<SFTPWrapper['readdir']>[1]>[1]>((resolve, reject) =>
      remote.readdir(resolvedPath, (error, entries) => error ? reject(error) : resolve(entries)))
    const entries: SshRemoteEntry[] = rows
      .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
      .map((entry) => ({
        name: entry.filename,
        path: posix.join(resolvedPath, entry.filename),
        type: entry.attrs.isDirectory()
          ? 'directory'
          : entry.attrs.isFile()
            ? 'file'
            : entry.attrs.isSymbolicLink() ? 'link' : 'other',
        size: entry.attrs.size,
        modifiedAt: entry.attrs.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : null,
        permissions: (entry.attrs.mode & 0o7777).toString(8).padStart(4, '0'),
      }))
      .sort((left, right) => left.type === right.type
        ? left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        : left.type === 'directory' ? -1 : 1)
    const parentPath = resolvedPath === '/' ? null : posix.dirname(resolvedPath)
    remote.end()
    return { connectionId: connection.id, path: resolvedPath, parentPath, entries }
  })

export const registerSshWorkspaceHandlers = (): void => {
  ipcMain.handle('ssh:server-overview', (_event, id: string) => serverOverview(id))
  ipcMain.handle('ssh:list-directory', (_event, id: string, path?: string | null) =>
    listDirectory(id, path))
}
