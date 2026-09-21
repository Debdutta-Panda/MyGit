import { Client as FtpClient, FileType, type FileInfo } from 'basic-ftp'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { PassThrough, Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { readFile } from 'node:fs/promises'
import { Client as SshClient, type ConnectConfig, type SFTPWrapper, type Stats } from 'ssh2'
import { getSshRuntimeConnection, type SshRuntimeConnection } from './ssh-connections'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_READ_BYTES = 32 * 1024 * 1024

export type RemoteFileProtocol = 'ftp' | 'sftp'
export type RemoteEntryType = 'file' | 'directory' | 'link' | 'other'

export interface FtpRemoteConnection {
  protocol: 'ftp'
  host: string
  port?: number
  username: string
  password: string
  security?: 'none' | 'explicit-tls' | 'implicit-tls'
  rejectUnauthorized?: boolean
  timeoutMs?: number
}

export interface SftpRemoteConnection {
  protocol: 'sftp'
  sshConnectionId?: string
  connection?: SshRuntimeConnection
  timeoutMs?: number
}

export type RemoteFileConnection = FtpRemoteConnection | SftpRemoteConnection

export interface RemoteFileEntry {
  name: string
  path: string
  type: RemoteEntryType
  size: number
  modifiedAt: string | null
  permissions: string | null
}

export interface RemoteFileStat extends RemoteFileEntry {
  accessedAt: string | null
}

export interface RemoteFileSystemCapabilities {
  encrypted: boolean
  permissions: boolean
  symbolicLinks: boolean
}

export interface RemoteTransferProgress {
  bytes: number
}

export interface RemoteFileSystem {
  readonly protocol: RemoteFileProtocol
  readonly capabilities: RemoteFileSystemCapabilities
  pwd(): Promise<string>
  realpath(path: string): Promise<string>
  list(path?: string): Promise<RemoteFileEntry[]>
  stat(path: string): Promise<RemoteFileStat>
  readFile(path: string, maximumBytes?: number): Promise<Buffer>
  writeFile(path: string, data: Buffer | string): Promise<void>
  upload(source: Readable, path: string, onProgress?: (progress: RemoteTransferProgress) => void): Promise<void>
  download(path: string, destination: Writable, onProgress?: (progress: RemoteTransferProgress) => void): Promise<void>
  mkdir(path: string, recursive?: boolean): Promise<void>
  rename(path: string, targetPath: string): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  close(): Promise<void>
}

const remotePath = (value: unknown, fallback = '.'): string => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || value.length > 4_096 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Invalid remote path.')
  }
  return posix.normalize(value.replace(/\\/g, '/'))
}

const timeout = (value: number | undefined): number => {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error('The connection timeout must be between 1 and 300 seconds.')
  }
  return value
}

const maximumReadSize = (value: number | undefined): number => {
  const maximum = value ?? DEFAULT_MAX_READ_BYTES
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 512 * 1024 * 1024) {
    throw new Error('The maximum read size is invalid.')
  }
  return maximum
}

const octalPermissions = (mode: number | undefined): string | null =>
  typeof mode === 'number' ? (mode & 0o7777).toString(8).padStart(4, '0') : null

const progressTransform = (
  onProgress?: (progress: RemoteTransferProgress) => void,
): Transform => {
  let bytes = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      onProgress?.({ bytes })
      callback(null, chunk)
    },
  })
}

const collectWritable = (maximumBytes: number): { stream: Writable; result: () => Buffer } => {
  const chunks: Buffer[] = []
  let bytes = 0
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > maximumBytes) {
        callback(new Error(`The remote file exceeds the ${Math.ceil(maximumBytes / 1024 / 1024)} MB read limit.`))
        return
      }
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  return { stream, result: () => Buffer.concat(chunks, bytes) }
}

const sftpCall = async <Result>(
  operation: (callback: (error: Error | undefined, result: Result) => void) => void,
): Promise<Result> => await new Promise((resolve, reject) => operation((error, result) =>
  error ? reject(error) : resolve(result)))

const connectSsh = async (
  connection: SshRuntimeConnection,
  timeoutMs: number,
): Promise<SshClient> => {
  const config: ConnectConfig = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    readyTimeout: timeoutMs,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    hostVerifier: (key) => {
      const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
      return fingerprint === connection.hostFingerprint
    },
  }
  let keyboardPassword: string | null = null
  if (connection.authenticationType === 'password') {
    if (!connection.password) throw new Error('No password is stored for this SSH connection.')
    keyboardPassword = connection.password
    config.password = connection.password
    config.tryKeyboard = true
  } else if (connection.authenticationType === 'private-key') {
    if (!connection.privateKeyPath) throw new Error('No private key is configured for this SSH connection.')
    config.privateKey = await readFile(connection.privateKeyPath)
    if (connection.passphrase) config.passphrase = connection.passphrase
  } else {
    if (!connection.agentSocket) throw new Error('No SSH agent socket is available.')
    config.agent = connection.agentSocket
  }

  return await new Promise((resolve, reject) => {
    const client = new SshClient()
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (error) {
        client.destroy()
        reject(error)
      } else resolve(client)
    }
    client.on('keyboard-interactive', (_name, _instructions, _language, prompts, complete) => {
      complete(prompts.map(() => keyboardPassword ?? ''))
    })
    client.once('ready', () => finish())
    client.once('error', finish)
    client.connect(config)
  })
}

const openSftp = async (client: SshClient): Promise<SFTPWrapper> =>
  await new Promise((resolve, reject) => client.sftp((error, wrapper) =>
    error ? reject(error) : resolve(wrapper)))

const statsEntry = (path: string, stats: Stats): RemoteFileStat => ({
  name: posix.basename(path),
  path,
  type: stats.isDirectory() ? 'directory'
    : stats.isFile() ? 'file'
      : stats.isSymbolicLink() ? 'link' : 'other',
  size: stats.size,
  modifiedAt: stats.mtime ? new Date(stats.mtime * 1_000).toISOString() : null,
  accessedAt: stats.atime ? new Date(stats.atime * 1_000).toISOString() : null,
  permissions: octalPermissions(stats.mode),
})

const createSftpFileSystem = async (
  options: SftpRemoteConnection,
): Promise<RemoteFileSystem> => {
  const connection = options.connection ?? (typeof options.sshConnectionId === 'string' && options.sshConnectionId
    ? getSshRuntimeConnection(options.sshConnectionId)
    : null)
  if (!connection) throw new Error('An SSH or standalone SFTP connection is required for SFTP.')
  const client = await connectSsh(connection, timeout(options.timeoutMs))
  let remote: SFTPWrapper
  try {
    remote = await openSftp(client)
  } catch (error) {
    client.end()
    throw error
  }
  let closed = false
  const ensureOpen = (): void => {
    if (closed) throw new Error('The SFTP connection is closed.')
  }
  const resolvePath = async (path: string): Promise<string> => {
    ensureOpen()
    return await sftpCall<string>((callback) => remote.realpath(remotePath(path), callback))
  }

  return {
    protocol: 'sftp',
    capabilities: { encrypted: true, permissions: true, symbolicLinks: true },
    pwd: async () => await resolvePath('.'),
    realpath: resolvePath,
    list: async (path = '.') => {
      const directory = await resolvePath(path)
      const entries = await sftpCall<Parameters<Parameters<SFTPWrapper['readdir']>[1]>[1]>(
        (callback) => remote.readdir(directory, callback),
      )
      return entries
        .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
        .map((entry) => statsEntry(posix.join(directory, entry.filename), entry.attrs))
        .map(({ accessedAt: _accessedAt, ...entry }) => entry)
    },
    stat: async (path) => {
      ensureOpen()
      const target = remotePath(path)
      const stats = await sftpCall<Stats>((callback) => remote.lstat(target, callback))
      return statsEntry(target, stats)
    },
    readFile: async (path, maximumBytes) => {
      ensureOpen()
      const target = remotePath(path)
      const maximum = maximumReadSize(maximumBytes)
      const stats = await sftpCall<Stats>((callback) => remote.stat(target, callback))
      if (!stats.isFile()) throw new Error('The remote path is not a regular file.')
      if (stats.size > maximum) throw new Error('The remote file exceeds the configured read limit.')
      return await sftpCall<Buffer>((callback) => remote.readFile(target, callback))
    },
    writeFile: async (path, data) => {
      ensureOpen()
      await sftpCall<void>((callback) => remote.writeFile(remotePath(path), data, callback))
    },
    upload: async (source, path, onProgress) => {
      ensureOpen()
      await pipeline(source, progressTransform(onProgress), remote.createWriteStream(remotePath(path)))
    },
    download: async (path, destination, onProgress) => {
      ensureOpen()
      await pipeline(remote.createReadStream(remotePath(path)), progressTransform(onProgress), destination)
    },
    mkdir: async (path, recursive = false) => {
      ensureOpen()
      const target = remotePath(path)
      if (!recursive) {
        await sftpCall<void>((callback) => remote.mkdir(target, callback))
        return
      }
      const absolute = target.startsWith('/')
      let current = absolute ? '/' : ''
      for (const segment of target.split('/').filter(Boolean)) {
        current = current === '/' ? `/${segment}` : current ? `${current}/${segment}` : segment
        try {
          await sftpCall<void>((callback) => remote.mkdir(current, callback))
        } catch {
          const stats = await sftpCall<Stats>((callback) => remote.stat(current, callback))
          if (!stats.isDirectory()) throw new Error(`Remote path is not a directory: ${current}`)
        }
      }
    },
    rename: async (path, targetPath) => {
      ensureOpen()
      await sftpCall<void>((callback) => remote.rename(remotePath(path), remotePath(targetPath), callback))
    },
    remove: async (path, recursive = false) => {
      ensureOpen()
      const target = remotePath(path)
      if (target === '/' || target === '.') throw new Error('Removing this protected path is not allowed.')
      const removeTarget = async (current: string): Promise<void> => {
        const stats = await sftpCall<Stats>((callback) => remote.lstat(current, callback))
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          await sftpCall<void>((callback) => remote.unlink(current, callback))
          return
        }
        if (recursive) {
          const entries = await sftpCall<Parameters<Parameters<SFTPWrapper['readdir']>[1]>[1]>(
            (callback) => remote.readdir(current, callback),
          )
          for (const entry of entries) {
            if (entry.filename !== '.' && entry.filename !== '..') {
              await removeTarget(posix.join(current, entry.filename))
            }
          }
        }
        await sftpCall<void>((callback) => remote.rmdir(current, callback))
      }
      await removeTarget(target)
    },
    chmod: async (path, mode) => {
      ensureOpen()
      if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new Error('Invalid file mode.')
      await sftpCall<void>((callback) => remote.chmod(remotePath(path), mode, callback))
    },
    close: async () => {
      if (closed) return
      closed = true
      remote.end()
      client.end()
    },
  }
}

const ftpPermissions = (entry: FileInfo): string | null => {
  if (!entry.permissions) return null
  const mode = (entry.permissions.user << 6) | (entry.permissions.group << 3) | entry.permissions.world
  return mode.toString(8).padStart(4, '0')
}

const ftpEntry = (directory: string, entry: FileInfo): RemoteFileEntry => ({
  name: entry.name,
  path: directory === '/' ? `/${entry.name}` : posix.join(directory, entry.name),
  type: entry.type === FileType.Directory ? 'directory'
    : entry.type === FileType.File ? 'file'
      : entry.type === FileType.SymbolicLink ? 'link' : 'other',
  size: entry.size,
  modifiedAt: entry.modifiedAt?.toISOString() ?? null,
  permissions: ftpPermissions(entry),
})

const createFtpFileSystem = async (
  options: FtpRemoteConnection,
): Promise<RemoteFileSystem> => {
  if (typeof options.host !== 'string' || !options.host.trim() || options.host.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(options.host) ||
    typeof options.username !== 'string' || !options.username || options.username.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(options.username) ||
    typeof options.password !== 'string' || /[\r\n\0]/.test(options.password)) {
    throw new Error('Invalid FTP connection details.')
  }
  const port = options.port ?? (options.security === 'implicit-tls' ? 990 : 21)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid FTP port.')
  const security = options.security ?? 'none'
  if (!['none', 'explicit-tls', 'implicit-tls'].includes(security)) throw new Error('Invalid FTP security mode.')
  const client = new FtpClient(timeout(options.timeoutMs))
  try {
    await client.access({
      host: options.host.trim(),
      port,
      user: options.username,
      password: options.password,
      secure: security === 'implicit-tls' ? 'implicit' : security === 'explicit-tls',
      secureOptions: security === 'none' ? undefined : {
        rejectUnauthorized: options.rejectUnauthorized !== false,
        servername: options.host.trim(),
      },
    })
  } catch (error) {
    client.close()
    throw error
  }
  let closed = false
  const ensureOpen = (): void => {
    if (closed || client.closed) throw new Error('The FTP connection is closed.')
  }
  const resolveDirectory = async (path: string): Promise<string> => {
    ensureOpen()
    const original = await client.pwd()
    try {
      await client.cd(remotePath(path))
      return await client.pwd()
    } finally {
      await client.cd(original)
    }
  }
  const list = async (path = '.'): Promise<RemoteFileEntry[]> => {
    ensureOpen()
    const directory = await resolveDirectory(path)
    return (await client.list(directory))
      .filter((entry) => entry.name !== '.' && entry.name !== '..')
      .map((entry) => ftpEntry(directory, entry))
  }

  return {
    protocol: 'ftp',
    capabilities: {
      encrypted: security !== 'none',
      permissions: false,
      symbolicLinks: false,
    },
    pwd: async () => {
      ensureOpen()
      return await client.pwd()
    },
    realpath: resolveDirectory,
    list,
    stat: async (path) => {
      const target = remotePath(path)
      if (target === '/') {
        return {
          name: '/', path: '/', type: 'directory', size: 0,
          modifiedAt: null, accessedAt: null, permissions: null,
        }
      }
      const directory = posix.dirname(target)
      const name = posix.basename(target)
      const entry = (await list(directory)).find((candidate) => candidate.name === name)
      if (!entry) throw new Error(`Remote path does not exist: ${target}`)
      return { ...entry, accessedAt: null }
    },
    readFile: async (path, maximumBytes) => {
      ensureOpen()
      const maximum = maximumReadSize(maximumBytes)
      const target = remotePath(path)
      const size = await client.size(target)
      if (size > maximum) throw new Error('The remote file exceeds the configured read limit.')
      const collected = collectWritable(maximum)
      await client.downloadTo(collected.stream, target)
      return collected.result()
    },
    writeFile: async (path, data) => {
      ensureOpen()
      await client.uploadFrom(Readable.from([data]), remotePath(path))
    },
    upload: async (source, path, onProgress) => {
      ensureOpen()
      const transfer = new PassThrough()
      const sourcePipeline = pipeline(source, progressTransform(onProgress), transfer)
      try {
        await Promise.all([sourcePipeline, client.uploadFrom(transfer, remotePath(path))])
      } catch (error) {
        transfer.destroy()
        throw error
      }
    },
    download: async (path, destination, onProgress) => {
      ensureOpen()
      const transfer = new PassThrough()
      const destinationPipeline = pipeline(transfer, progressTransform(onProgress), destination)
      try {
        await Promise.all([client.downloadTo(transfer, remotePath(path)), destinationPipeline])
      } catch (error) {
        transfer.destroy()
        throw error
      }
    },
    mkdir: async (path, recursive = false) => {
      ensureOpen()
      const target = remotePath(path)
      if (recursive) {
        const original = await client.pwd()
        try {
          await client.ensureDir(target)
        } finally {
          await client.cd(original)
        }
        return
      }
      const original = await client.pwd()
      try {
        await client.cd(posix.dirname(target))
        await client.send(`MKD ${await client.protectWhitespace(posix.basename(target))}`)
      } finally {
        await client.cd(original)
      }
    },
    rename: async (path, targetPath) => {
      ensureOpen()
      await client.rename(remotePath(path), remotePath(targetPath))
    },
    remove: async (path, recursive = false) => {
      ensureOpen()
      const target = remotePath(path)
      if (target === '/' || target === '.') throw new Error('Removing this protected path is not allowed.')
      const entry = await (async () => {
        const directory = posix.dirname(target)
        const name = posix.basename(target)
        return (await list(directory)).find((candidate) => candidate.name === name)
      })()
      if (!entry) throw new Error(`Remote path does not exist: ${target}`)
      if (entry.type === 'directory') {
        if (recursive) await client.removeDir(target)
        else await client.removeEmptyDir(target)
      } else await client.remove(target)
    },
    chmod: async () => {
      throw new Error('Changing permissions is not portable across FTP servers.')
    },
    close: async () => {
      if (closed) return
      closed = true
      client.close()
    },
  }
}

export const connectRemoteFileSystem = async (
  options: RemoteFileConnection,
): Promise<RemoteFileSystem> => {
  if (!options || typeof options !== 'object') throw new Error('Invalid remote filesystem connection.')
  if (options.protocol === 'sftp') return await createSftpFileSystem(options)
  if (options.protocol === 'ftp') return await createFtpFileSystem(options)
  throw new Error('Unsupported remote filesystem protocol.')
}

export const withRemoteFileSystem = async <Result>(
  options: RemoteFileConnection,
  operation: (filesystem: RemoteFileSystem) => Promise<Result>,
): Promise<Result> => {
  const filesystem = await connectRemoteFileSystem(options)
  try {
    return await operation(filesystem)
  } finally {
    await filesystem.close()
  }
}

export const testRemoteFileConnection = async (
  options: RemoteFileConnection,
): Promise<{ protocol: RemoteFileProtocol; encrypted: boolean; rootPath: string }> =>
  await withRemoteFileSystem(options, async (filesystem) => ({
    protocol: filesystem.protocol,
    encrypted: filesystem.capabilities.encrypted,
    rootPath: await filesystem.pwd(),
  }))
