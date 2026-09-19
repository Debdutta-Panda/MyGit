import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type {
  SshDirectoryListing,
  SshRemoteEntry,
  SshRemoteFileContent,
  SshRemoteFileWriteInput,
  SshServerOverview,
} from '../shared/desktop-api'
import { getSshRuntimeConnection, type SshRuntimeConnection } from './ssh-connections'

const MAX_COMMAND_OUTPUT = 2 * 1024 * 1024
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024
const MAX_PREVIEW_FILE_BYTES = 15 * 1024 * 1024

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

const publicAddressCache = new Map<string, { value: string | null; expiresAt: number }>()

const publicAddress = async (client: Client, connectionId: string): Promise<string | null> => {
  const cached = publicAddressCache.get(connectionId)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  let value: string | null = null
  try {
    const result = await exec(client,
      "(command -v curl >/dev/null 2>&1 && curl -fsS --max-time 3 https://api.ipify.org) || " +
      "(command -v wget >/dev/null 2>&1 && wget -qO- -T 3 https://api.ipify.org) || true")
    value = /^(?:[0-9a-f:.]+)$/i.test(result) ? result : null
  } catch {
    value = null
  }
  publicAddressCache.set(connectionId, {
    value,
    expiresAt: Date.now() + (value ? 30 * 60_000 : 5 * 60_000),
  })
  return value
}

const cpuSnapshot = async (client: Client): Promise<{ idle: number; total: number } | null> => {
  try {
    const output = await exec(client,
      "awk '/^cpu / {idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print idle, total; exit}' /proc/stat 2>/dev/null || true")
    const [idle, total] = output.split(/\s+/).map(Number)
    return Number.isFinite(idle) && Number.isFinite(total) ? { idle, total } : null
  } catch {
    return null
  }
}

const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds))

const serverOverview = async (id: string): Promise<SshServerOverview> =>
  await withClient(id, async (client, connection) => {
    const firstCpu = await cpuSnapshot(client)
    const [output, externalAddress] = await Promise.all([
      exec(client, [
        "printf 'hostname|%s\\n' \"$(hostname 2>/dev/null || printf unknown)\"",
        "printf 'os|%s\\n' \"$(awk -F= '$1==\"PRETTY_NAME\" {gsub(/^\"|\"$/,\"\",$2); print $2; exit}' /etc/os-release 2>/dev/null || uname -s 2>/dev/null || printf unknown)\"",
        "printf 'kernel|%s\\n' \"$(uname -r 2>/dev/null || printf unknown)\"",
        "printf 'arch|%s\\n' \"$(uname -m 2>/dev/null || printf unknown)\"",
        "printf 'uptime|%s\\n' \"$(uptime -p 2>/dev/null || uptime 2>/dev/null || printf unknown)\"",
        "printf 'load|%s\\n' \"$(awk '{print $1\" \"$2\" \"$3}' /proc/loadavg 2>/dev/null || printf unknown)\"",
        "printf 'home|%s\\n' \"$HOME\"",
        "printf 'shell|%s\\n' \"${SHELL:-unknown}\"",
        "printf 'cpus|%s\\n' \"$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 0)\"",
        "printf 'time|%s\\n' \"$(date -Is 2>/dev/null || date 2>/dev/null || printf unknown)\"",
        "printf 'timezone|%s\\n' \"$(date +%Z 2>/dev/null || printf unknown)\"",
        "printf 'addresses|%s\\n' \"$(hostname -I 2>/dev/null | xargs || true)\"",
        "printf 'processes|%s\\n' \"$(ps -e --no-headers 2>/dev/null | wc -l | xargs)\"",
        "if [ -f /var/run/reboot-required ]; then printf 'reboot|1\\n'; else printf 'reboot|0\\n'; fi",
        "awk '/MemTotal:/{t=$2*1024}/MemAvailable:/{a=$2*1024}/SwapTotal:/{st=$2*1024}/SwapFree:/{sf=$2*1024}END{printf \"memory|%.0f|%.0f|%.0f|%.0f\\n\",t,a,st,sf}' /proc/meminfo 2>/dev/null || true",
        "awk -F'[: ]+' '$1!=\"lo\" && NF>10 {rx+=$3; tx+=$11}END{printf \"network|%.0f|%.0f\\n\",rx,tx}' /proc/net/dev 2>/dev/null || true",
        "df -PkP \"$HOME\" 2>/dev/null | awk 'NR==2 {printf \"home_disk|%.0f|%.0f|%.0f\\n\",$2*1024,$3*1024,$4*1024}'",
        "df -PkP -x tmpfs -x devtmpfs 2>/dev/null | awk 'NR>1 {gsub(/%/,\"\",$5); printf \"partition|%s|%s|%.0f|%.0f|%.0f|%s\\n\",$1,$6,$2*1024,$3*1024,$4*1024,$5}'",
      ].join('; ')),
      publicAddress(client, connection.id),
    ])
    await delay(250)
    const secondCpu = await cpuSnapshot(client)
    const fields = new Map<string, string[]>()
    const partitions: SshServerOverview['partitions'] = []
    for (const line of output.split(/\r?\n/)) {
      const [key, ...values] = line.split('|')
      if (key === 'partition' && values.length >= 6) {
        partitions.push({
          filesystem: values[0], mountPoint: values[1], totalBytes: Number(values[2]) || 0,
          usedBytes: Number(values[3]) || 0, availableBytes: Number(values[4]) || 0,
          usagePercent: Number(values[5]) || 0,
        })
      } else if (key) fields.set(key, values)
    }
    const value = (key: string): string | undefined => fields.get(key)?.[0]
    const memory = fields.get('memory') ?? []
    const network = fields.get('network') ?? []
    const homeDisk = fields.get('home_disk') ?? []
    const cpuDelta = firstCpu && secondCpu
      ? { idle: secondCpu.idle - firstCpu.idle, total: secondCpu.total - firstCpu.total }
      : null
    const cpuUsagePercent = cpuDelta && cpuDelta.total > 0
      ? Math.max(0, Math.min(100, (1 - cpuDelta.idle / cpuDelta.total) * 100))
      : null
    const swapTotal = numberOrNull(memory[2])
    const swapFree = numberOrNull(memory[3])
    return {
      connectionId: connection.id,
      hostname: value('hostname') || connection.host,
      operatingSystem: value('os') || 'Unknown',
      kernel: value('kernel') || 'Unknown',
      architecture: value('arch') || 'Unknown',
      uptime: value('uptime') || 'Unknown',
      loadAverage: value('load') || 'Unknown',
      homeDirectory: value('home') || '.',
      shell: value('shell') || 'Unknown',
      cpuCount: numberOrNull(value('cpus')),
      cpuUsagePercent,
      totalMemoryBytes: numberOrNull(memory[0]),
      freeMemoryBytes: numberOrNull(memory[1]),
      swapTotalBytes: swapTotal,
      swapUsedBytes: swapTotal !== null && swapFree !== null ? Math.max(0, swapTotal - swapFree) : null,
      diskTotalBytes: numberOrNull(homeDisk[0]),
      diskUsedBytes: numberOrNull(homeDisk[1]),
      diskAvailableBytes: numberOrNull(homeDisk[2]),
      processCount: numberOrNull(value('processes')),
      serverTime: value('time') || 'Unknown',
      timezone: value('timezone') || 'Unknown',
      privateAddresses: (value('addresses') ?? '').split(/\s+/).filter(Boolean),
      publicAddress: externalAddress,
      networkReceivedBytes: numberOrNull(network[0]),
      networkSentBytes: numberOrNull(network[1]),
      rebootRequired: value('reboot') === undefined ? null : value('reboot') === '1',
      partitions,
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

const mimeTypes: Record<string, string> = {
  bmp: 'image/bmp', css: 'text/css', csv: 'text/csv', gif: 'image/gif', htm: 'text/html',
  html: 'text/html', ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg', js: 'text/javascript',
  json: 'application/json', jsx: 'text/javascript', md: 'text/markdown', mjs: 'text/javascript',
  pdf: 'application/pdf', php: 'text/x-php', png: 'image/png', py: 'text/x-python', sh: 'text/x-shellscript',
  sql: 'application/sql', svg: 'image/svg+xml', toml: 'text/plain', ts: 'text/typescript',
  tsx: 'text/typescript', txt: 'text/plain', webp: 'image/webp', xml: 'application/xml',
  yaml: 'text/yaml', yml: 'text/yaml',
}

const textExtensions = new Set([
  'bash', 'c', 'cc', 'conf', 'cpp', 'cs', 'css', 'csv', 'dart', 'env', 'go', 'h', 'hpp',
  'htm', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'kt', 'kts', 'less', 'log', 'lua', 'md',
  'mjs', 'php', 'prisma', 'ps1', 'py', 'rb', 'rs', 'sass', 'scss', 'sh', 'sql', 'svelte',
  'swift', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
])

const extensionFor = (path: string): string => {
  const name = posix.basename(path)
  return name.includes('.') ? name.split('.').at(-1)?.toLowerCase() ?? '' : ''
}

const remoteStat = async (remote: SFTPWrapper, path: string) =>
  await new Promise<Parameters<Parameters<SFTPWrapper['stat']>[1]>[1]>((resolve, reject) =>
    remote.stat(path, (error, attributes) => error ? reject(error) : resolve(attributes)))

const remoteRead = async (remote: SFTPWrapper, path: string): Promise<Buffer> =>
  await new Promise<Buffer>((resolve, reject) =>
    remote.readFile(path, (error, data) => error ? reject(error) : resolve(data)))

const fileContent = (
  connectionId: string,
  path: string,
  attributes: Awaited<ReturnType<typeof remoteStat>>,
  data: Buffer,
): SshRemoteFileContent => {
  const extension = extensionFor(path)
  const mimeType = mimeTypes[extension] ?? 'application/octet-stream'
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  const appearsBinary = data.subarray(0, 8_192).includes(0)
  const isText = !isImage && !isPdf && (!appearsBinary || textExtensions.has(extension))
  return {
    connectionId,
    path,
    name: posix.basename(path),
    size: attributes.size,
    modifiedAt: new Date(attributes.mtime * 1000).toISOString(),
    etag: createHash('sha256').update(data).digest('hex'),
    permissions: (attributes.mode & 0o7777).toString(8).padStart(4, '0'),
    mimeType,
    presentation: isImage ? 'image' : isPdf ? 'pdf' : isText ? 'text' : 'binary',
    content: isText ? data.toString('utf8') : null,
    dataUrl: isImage || isPdf ? `data:${mimeType};base64,${data.toString('base64')}` : null,
    writable: isText,
  }
}

const readRemoteFile = async (id: string, requestedPath: string): Promise<SshRemoteFileContent> =>
  await withClient(id, async (client, connection) => {
    const remote = await sftp(client)
    try {
      const path = normalizeRemotePath(requestedPath)
      const attributes = await remoteStat(remote, path)
      if (!attributes.isFile()) throw new Error('The selected item is not a regular file.')
      const extension = extensionFor(path)
      const preview = mimeTypes[extension]?.startsWith('image/') || extension === 'pdf'
      const limit = preview ? MAX_PREVIEW_FILE_BYTES : MAX_TEXT_FILE_BYTES
      if (attributes.size > limit) {
        throw new Error(`This file is too large to open safely (${Math.ceil(attributes.size / 1024 / 1024)} MB).`)
      }
      return fileContent(connection.id, path, attributes, await remoteRead(remote, path))
    } finally {
      remote.end()
    }
  })

const writeRemoteFile = async (input: SshRemoteFileWriteInput): Promise<SshRemoteFileContent> => {
  if (!input || typeof input.connectionId !== 'string' || typeof input.path !== 'string'
    || typeof input.content !== 'string' || typeof input.expectedModifiedAt !== 'string'
    || typeof input.expectedEtag !== 'string') {
    throw new Error('Invalid remote file update.')
  }
  const content = Buffer.from(input.content, 'utf8')
  if (content.length > MAX_TEXT_FILE_BYTES) throw new Error('The edited file exceeds the 5 MB safety limit.')
  return await withClient(input.connectionId, async (client, connection) => {
    const remote = await sftp(client)
    const path = normalizeRemotePath(input.path)
    const temporaryPath = `${path}.myrepos-${randomUUID()}.tmp`
    try {
      const before = await remoteStat(remote, path)
      const expectedSeconds = Math.floor(new Date(input.expectedModifiedAt).getTime() / 1000)
      const currentEtag = before.size <= MAX_TEXT_FILE_BYTES
        ? createHash('sha256').update(await remoteRead(remote, path)).digest('hex')
        : ''
      if (!Number.isFinite(expectedSeconds) || before.mtime !== expectedSeconds
        || currentEtag !== input.expectedEtag) {
        throw new Error('REMOTE_FILE_CHANGED: The file changed on the server. Reload it before saving.')
      }
      await new Promise<void>((resolve, reject) =>
        remote.writeFile(temporaryPath, content, { mode: before.mode & 0o7777 }, (error) =>
          error ? reject(error) : resolve()))
      await new Promise<void>((resolve, reject) =>
        remote.ext_openssh_rename(temporaryPath, path, (error) => error ? reject(error) : resolve()))
      const after = await remoteStat(remote, path)
      return fileContent(connection.id, path, after, content)
    } catch (error) {
      await new Promise<void>((resolve) => remote.unlink(temporaryPath, () => resolve()))
      throw error
    } finally {
      remote.end()
    }
  })
}

export const registerSshWorkspaceHandlers = (): void => {
  ipcMain.handle('ssh:server-overview', (_event, id: string) => serverOverview(id))
  ipcMain.handle('ssh:list-directory', (_event, id: string, path?: string | null) =>
    listDirectory(id, path))
  ipcMain.handle('ssh:read-file', (_event, id: string, path: string) => readRemoteFile(id, path))
  ipcMain.handle('ssh:write-file', (_event, input: SshRemoteFileWriteInput) => writeRemoteFile(input))
}
