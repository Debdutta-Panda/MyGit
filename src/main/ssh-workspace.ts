import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile as localCopyFile, readFile, stat as localStat, unlink as localUnlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename as localBasename, posix } from 'node:path'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type {
  SshDirectoryListing,
  SshRemoteEntry,
  SshRemoteEntryMutationResult,
  SshRemoteFileContent,
  SshRemoteFileWriteInput,
  SshServerOverview,
  SshAccountCatalog,
  SshAccountOperation,
  SshAccessApplyResult,
  SshAccessChangeInput,
  SshAccessPreview,
  SshTransferProgress,
  SshTransferResult,
  SshCommandResult,
} from '../shared/desktop-api'
import { getSshRuntimeConnection, type SshRuntimeConnection } from './ssh-connections'

const MAX_COMMAND_OUTPUT = 2 * 1024 * 1024
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024
const MAX_PREVIEW_FILE_BYTES = 15 * 1024 * 1024
const transferCancellers = new Map<string, () => void>()
const commandRuns = new Map<string, { connectionId: string; cancelled: boolean; cancel: () => void }>()
const accessPreviewTokens = new Map<string, { connectionId: string; inputHash: string; signature: string; expiresAt: number }>()

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

const accountCatalog = async (id: string): Promise<SshAccountCatalog> =>
  await withClient(id, async (client, connection) => {
    const output = await exec(client, [
      "printf '%s\\n' '__MYREPOS_IDENTITY__'",
      "printf '%s|%s|' \"$(id -un)\" \"$(id -u)\"",
      "if sudo -n true >/dev/null 2>&1; then printf 1; else printf 0; fi",
      "printf '\\n%s\\n' '__MYREPOS_PASSWD__'",
      'getent passwd',
      "printf '%s\\n' '__MYREPOS_GROUP__'",
      'getent group',
      "printf '%s\\n' '__MYREPOS_STATUS__'",
      "if [ \"$(id -u)\" = 0 ]; then passwd -S -a 2>/dev/null || true; elif sudo -n true >/dev/null 2>&1; then sudo -n passwd -S -a 2>/dev/null || true; fi",
      "printf '%s\\n' '__MYREPOS_UIDMIN__'",
      "awk '$1==\"UID_MIN\" {print $2; exit}' /etc/login.defs 2>/dev/null || printf 1000",
    ].join('; '))
    const sections = output.split(/^__MYREPOS_(IDENTITY|PASSWD|GROUP|STATUS|UIDMIN)__\s*$/m)
    const section = (name: string): string => {
      const index = sections.indexOf(name)
      return index >= 0 ? sections[index + 1]?.trim() ?? '' : ''
    }
    const [currentUser = '', uid = '', sudo = '0'] = section('IDENTITY').split('|')
    const canManage = uid === '0' || sudo === '1'
    const uidMinimum = Number(section('UIDMIN').split(/\s+/)[0]) || 1000
    const groupRows = section('GROUP').split(/\r?\n/).filter(Boolean).map((line) => line.split(':'))
    const administratorGroups = groupRows.filter(([name]) => name === 'sudo' || name === 'wheel').map(([name]) => name)
    const groups = groupRows.map(([name, , gidValue, members = '']) => ({
      name,
      gid: Number(gidValue) || 0,
      members: members.split(',').filter(Boolean),
      system: (Number(gidValue) || 0) < uidMinimum,
      administrator: administratorGroups.includes(name),
    }))
    const groupByGid = new Map(groups.map((group) => [group.gid, group.name]))
    const status = new Map(section('STATUS').split(/\r?\n/).filter(Boolean).map((line) => {
      const [username, state = ''] = line.split(/\s+/)
      return [username, state === 'L' || state === 'LK'] as const
    }))
    const users = section('PASSWD').split(/\r?\n/).filter(Boolean).map((line) => {
      const [username, , uidValue, gidValue, displayName = '', homeDirectory = '', shell = ''] = line.split(':')
      const uidNumber = Number(uidValue) || 0
      const gidNumber = Number(gidValue) || 0
      const supplementary = groups.filter((group) => group.members.includes(username)).map((group) => group.name)
      const primaryGroup = groupByGid.get(gidNumber) ?? String(gidNumber)
      const userGroups = Array.from(new Set([primaryGroup, ...supplementary]))
      return {
        username, uid: uidNumber, gid: gidNumber, displayName: displayName.split(',')[0],
        homeDirectory, shell, primaryGroup, groups: userGroups, system: uidNumber < uidMinimum,
        locked: status.has(username) ? status.get(username)! : null,
        administrator: userGroups.some((group) => administratorGroups.includes(group)),
      }
    })
    return {
      connectionId: connection.id, currentUser, canManage,
      privilegeMessage: canManage ? (uid === '0' ? 'Connected as root.' : 'Passwordless sudo is available.')
        : 'Read-only: root or passwordless sudo is required for account changes.',
      uidMinimum, administratorGroups, users, groups, fetchedAt: new Date().toISOString(),
    }
  })

const accountNamePattern = /^[a-z_][a-z0-9_-]{0,30}\$?$/i
const safeAccountName = (value: string, label: string): string => {
  const name = value.trim()
  if (!accountNamePattern.test(name)) throw new Error(`${label} is not a valid Linux account name.`)
  return name
}
const safeAccountPath = (value: string, label: string): string => {
  const path = value.trim()
  if (!/^\/[a-z0-9_./+@-]+$/i.test(path) || posix.normalize(path) !== path) throw new Error(`${label} is not a valid absolute path.`)
  return path
}
const safeAccountComment = (value: string): string => {
  const comment = value.trim()
  if (/[:\r\n\0]/.test(comment) || comment.length > 256) throw new Error('Display name contains invalid characters or is too long.')
  return comment
}
const safePassword = (value: string): string => {
  if (!value || value.length > 1024 || /[\r\n\0]/.test(value)) throw new Error('Password is empty, too long, or contains an unsupported line break.')
  return value
}
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`
const accountPrivilege = async (client: Client): Promise<{ currentUser: string; root: boolean; canManage: boolean }> => {
  const output = await exec(client, "printf '%s|%s|' \"$(id -un)\" \"$(id -u)\"; if sudo -n true >/dev/null 2>&1; then printf 1; else printf 0; fi")
  const [currentUser = '', uid = '', sudo = '0'] = output.split('|')
  return { currentUser, root: uid === '0', canManage: uid === '0' || sudo === '1' }
}
const privilegedAccountCommand = async (client: Client, command: string): Promise<void> => {
  const privilege = await accountPrivilege(client)
  if (!privilege.canManage) throw new Error('Root or passwordless sudo is required for account changes.')
  await exec(client, privilege.root ? command : `sudo -n sh -c ${shellQuote(command)}`)
}

const authorizedKeys = async (id: string, requestedUsername: string): Promise<string> =>
  await withClient(id, async (client) => {
    const username = safeAccountName(requestedUsername, 'Username')
    const privilege = await accountPrivilege(client)
    const command = `home=$(getent passwd ${shellQuote(username)} | cut -d: -f6); [ -n \"$home\" ] && [ -f \"$home/.ssh/authorized_keys\" ] && cat \"$home/.ssh/authorized_keys\" || true`
    return await exec(client, privilege.root ? command
      : privilege.canManage ? `sudo -n sh -c ${shellQuote(command)}` : command)
  })

const manageAccounts = async (id: string, operation: SshAccountOperation): Promise<SshAccountCatalog> => {
  await withClient(id, async (client) => {
    const privilege = await accountPrivilege(client)
    if (!privilege.canManage) throw new Error('Root or passwordless sudo is required for account changes.')
    const run = async (command: string): Promise<void> => privilegedAccountCommand(client, command)
    if (operation.kind === 'create-user') {
      const username = safeAccountName(operation.username, 'Username')
      if (username === 'root') throw new Error('The root account cannot be created or replaced here.')
      const shell = safeAccountPath(operation.shell || '/bin/bash', 'Shell')
      const home = safeAccountPath(operation.homeDirectory || `/home/${username}`, 'Home directory')
      const primaryGroup = operation.primaryGroup ? safeAccountName(operation.primaryGroup, 'Primary group') : ''
      const groups = operation.groups.map((group) => safeAccountName(group, 'Group')).join(',')
      const command = `useradd -m ${primaryGroup ? `-g ${shellQuote(primaryGroup)}` : '-U'} -c ${shellQuote(safeAccountComment(operation.displayName))} -d ${shellQuote(home)} -s ${shellQuote(shell)}${groups ? ` -G ${shellQuote(groups)}` : ''} -- ${shellQuote(username)}`
      await run(command)
      if (operation.password) {
        await run(`printf '%s:%s\\n' ${shellQuote(username)} ${shellQuote(safePassword(operation.password))} | chpasswd`)
      }
    } else if (operation.kind === 'update-user') {
      const username = safeAccountName(operation.username, 'Username')
      const newUsername = safeAccountName(operation.newUsername, 'New username')
      if (username === 'root' || username === privilege.currentUser) throw new Error('The root or active SSH identity cannot be renamed or structurally modified here.')
      const shell = safeAccountPath(operation.shell, 'Shell')
      const home = safeAccountPath(operation.homeDirectory, 'Home directory')
      const primaryGroup = safeAccountName(operation.primaryGroup, 'Primary group')
      const groups = operation.groups.map((group) => safeAccountName(group, 'Group')).join(',')
      await run(`usermod${username !== newUsername ? ` -l ${shellQuote(newUsername)}` : ''} -c ${shellQuote(safeAccountComment(operation.displayName))} -d ${shellQuote(home)}${operation.moveHome ? ' -m' : ''} -s ${shellQuote(shell)} -g ${shellQuote(primaryGroup)} -G ${shellQuote(groups)} -- ${shellQuote(username)}`)
    } else if (operation.kind === 'set-password') {
      const username = safeAccountName(operation.username, 'Username')
      if (username === 'root') throw new Error('The root password cannot be changed here.')
      await run(`printf '%s:%s\\n' ${shellQuote(username)} ${shellQuote(safePassword(operation.password))} | chpasswd`)
    } else if (operation.kind === 'set-locked') {
      const username = safeAccountName(operation.username, 'Username')
      if (username === 'root' || username === privilege.currentUser) throw new Error('The root or active SSH identity cannot be locked here.')
      await run(`usermod ${operation.locked ? '-L' : '-U'} -- ${shellQuote(username)}`)
    } else if (operation.kind === 'set-administrator') {
      const username = safeAccountName(operation.username, 'Username')
      if (username === 'root') throw new Error('The root account is already privileged.')
      if (username === privilege.currentUser && !operation.administrator) throw new Error('The active SSH identity cannot remove its own administrator access here.')
      const catalog = await accountCatalog(id)
      const administratorGroup = catalog.administratorGroups[0]
      if (!administratorGroup) throw new Error('No supported sudo or wheel administrator group was detected.')
      if (operation.administrator) await run(`usermod -aG ${shellQuote(administratorGroup)} -- ${shellQuote(username)}`)
      else {
        const user = catalog.users.find((item) => item.username === username)
        for (const group of catalog.administratorGroups.filter((item) => user?.groups.includes(item))) {
          await run(`gpasswd -d ${shellQuote(username)} ${shellQuote(group)}`)
        }
      }
    } else if (operation.kind === 'set-authorized-keys') {
      const username = safeAccountName(operation.username, 'Username')
      if (username === 'root') throw new Error('Root authorized keys cannot be modified here.')
      if (operation.content.length > 1_000_000 || operation.content.includes('\0')) throw new Error('Authorized keys content is invalid or too large.')
      const payload = Buffer.from(operation.content.replace(/\r\n/g, '\n'), 'utf8').toString('base64')
      const command = `home=$(getent passwd ${shellQuote(username)} | cut -d: -f6); group=$(id -gn ${shellQuote(username)}); [ -n \"$home\" ] || exit 1; install -d -m 700 -o ${shellQuote(username)} -g \"$group\" \"$home/.ssh\"; printf %s ${shellQuote(payload)} | base64 -d > \"$home/.ssh/authorized_keys\"; chown ${shellQuote(username)}:\"$group\" \"$home/.ssh/authorized_keys\"; chmod 600 \"$home/.ssh/authorized_keys\"`
      await run(command)
    } else if (operation.kind === 'delete-user') {
      const username = safeAccountName(operation.username, 'Username')
      if (username === 'root' || username === privilege.currentUser) throw new Error('The root or active SSH identity cannot be deleted.')
      await run(`userdel ${operation.removeHome ? '-r ' : ''}-- ${shellQuote(username)}`)
    } else if (operation.kind === 'create-group') {
      await run(`groupadd -- ${shellQuote(safeAccountName(operation.group, 'Group name'))}`)
    } else if (operation.kind === 'rename-group') {
      const group = safeAccountName(operation.group, 'Group name')
      const newGroup = safeAccountName(operation.newGroup, 'New group name')
      if (group === 'root' || group === 'sudo' || group === 'wheel') throw new Error('Critical administrator groups cannot be renamed here.')
      await run(`groupmod -n ${shellQuote(newGroup)} -- ${shellQuote(group)}`)
    } else if (operation.kind === 'set-group-members') {
      const group = safeAccountName(operation.group, 'Group name')
      if (group === 'root' || group === 'sudo' || group === 'wheel') throw new Error('Critical administrator group membership must be changed through individual user controls.')
      const members = operation.members.map((member) => safeAccountName(member, 'Username')).join(',')
      await run(`gpasswd -M ${shellQuote(members)} ${shellQuote(group)}`)
    } else if (operation.kind === 'delete-group') {
      const group = safeAccountName(operation.group, 'Group name')
      if (group === 'root' || group === 'sudo' || group === 'wheel') throw new Error('Critical administrator groups cannot be deleted here.')
      await run(`groupdel -- ${shellQuote(group)}`)
    }
  })
  return await accountCatalog(id)
}

const safeAccessPath = (value: string): string => {
  const path = value.trim()
  if (!path.startsWith('/') || path.length > 4_096 || /[\r\n\0]/.test(path) || posix.normalize(path) !== path) {
    throw new Error('Enter a normalized absolute server path.')
  }
  return path
}
const safeAccessMode = (value: string | null): string | null => {
  if (value === null || value.trim() === '') return null
  const mode = value.trim().padStart(4, '0')
  if (!/^[0-7]{4}$/.test(mode)) throw new Error('Permissions must be a three or four digit octal value.')
  return mode
}
const normalizedAccessInput = (input: SshAccessChangeInput): SshAccessChangeInput => {
  const acl = input.acl.map((entry) => ({
    kind: entry.kind,
    name: safeAccountName(entry.name, entry.kind === 'user' ? 'ACL user' : 'ACL group'),
    permissions: entry.permissions === null ? null : /^[r-][w-][x-]$/.test(entry.permissions)
      ? entry.permissions : (() => { throw new Error('ACL permissions must contain read, write and execute positions.') })(),
    default: Boolean(entry.default),
  }))
  const keys = new Set<string>()
  for (const entry of acl) {
    const key = `${entry.default}:${entry.kind}:${entry.name}`
    if (keys.has(key)) throw new Error('The same ACL subject cannot appear more than once.')
    keys.add(key)
  }
  const permissions = safeAccessMode(input.permissions)
  const directoryPermissions = safeAccessMode(input.directoryPermissions)
  const filePermissions = safeAccessMode(input.filePermissions)
  if (permissions && (directoryPermissions || filePermissions)) throw new Error('Choose either one shared mode or separate folder/file modes.')
  if ((directoryPermissions || filePermissions) && !input.recursive) throw new Error('Separate folder/file modes require descendant scope.')
  return {
    path: safeAccessPath(input.path),
    owner: input.owner ? safeAccountName(input.owner, 'Owner') : null,
    group: input.group ? safeAccountName(input.group, 'Group') : null,
    permissions,
    directoryPermissions,
    filePermissions,
    recursive: Boolean(input.recursive),
    crossFilesystem: Boolean(input.crossFilesystem),
    acl,
  }
}
interface AccessSnapshot {
  resolvedPath: string
  type: SshAccessPreview['type']
  symlinkTarget: string | null
  owner: string
  group: string
  permissions: string
  aclSupported: boolean
  currentAcl: string[]
  affectedCount: number
  countTruncated: boolean
  signature: string
}
const inspectAccess = async (client: Client, input: SshAccessChangeInput): Promise<AccessSnapshot> => {
  const path = shellQuote(input.path)
  const findFlags = input.crossFilesystem ? '' : ' -xdev'
  const command = [
    "printf '%s\\n' '__MYREPOS_STAT__'",
    `stat -c '%F|%U|%G|%a|%d|%i|%Y' -- ${path}`,
    "printf '%s\\n' '__MYREPOS_LINK__'",
    `readlink -- ${path} 2>/dev/null || true`,
    "printf '%s\\n' '__MYREPOS_ACL__'",
    `if command -v getfacl >/dev/null 2>&1 && command -v setfacl >/dev/null 2>&1; then getfacl -cp -- ${path} 2>/dev/null | base64 | tr -d '\\n'; fi`,
    "printf '\\n%s\\n' '__MYREPOS_COUNT__'",
    input.recursive
      ? `find ${path}${findFlags} -print 2>/dev/null | head -n 10001 | wc -l`
      : 'printf 1',
  ].join('; ')
  const output = await exec(client, command)
  const sections = output.split(/^__MYREPOS_(STAT|LINK|ACL|COUNT)__\s*$/m)
  const section = (name: string): string => {
    const index = sections.indexOf(name)
    return index >= 0 ? sections[index + 1]?.trim() ?? '' : ''
  }
  const [rawType = '', owner = '', group = '', rawMode = '', device = '', inode = '', modified = ''] = section('STAT').split('|')
  if (!owner || !group || !rawMode) throw new Error('The target path could not be inspected.')
  const type: SshAccessPreview['type'] = rawType.includes('directory') ? 'directory'
    : rawType.includes('regular file') ? 'file' : rawType.includes('symbolic link') ? 'link' : 'other'
  const aclPayload = section('ACL')
  const currentAcl = aclPayload ? Buffer.from(aclPayload, 'base64').toString('utf8').split(/\r?\n/).filter(Boolean) : []
  const rawCount = Math.max(1, Number(section('COUNT')) || 1)
  return {
    resolvedPath: input.path, type, symlinkTarget: section('LINK') || null, owner, group,
    permissions: rawMode.padStart(4, '0'), aclSupported: Boolean(aclPayload), currentAcl,
    affectedCount: Math.min(rawCount, 10_000), countTruncated: rawCount > 10_000,
    signature: [device, inode, modified, owner, group, rawMode, aclPayload].join('|'),
  }
}
const accessRisk = (input: SshAccessChangeInput, snapshot: AccessSnapshot): Pick<SshAccessPreview, 'risk' | 'warnings' | 'confirmationPhrase'> => {
  const blocked = ['/proc', '/sys', '/dev'].some((root) => input.path === root || input.path.startsWith(`${root}/`))
  const critical = input.path === '/' || ['/boot', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/var'].includes(input.path)
  const dangerous = critical || (input.recursive && (snapshot.countTruncated || snapshot.affectedCount > 1_000)) || input.crossFilesystem
  const warnings: string[] = []
  if (blocked) warnings.push('Changes under virtual kernel/device filesystems are blocked.')
  if (input.path === '/') warnings.push('Changing the server root can make the server unbootable or inaccessible.')
  if (critical && input.path !== '/') warnings.push('This is a critical system path; incorrect access can break services or login.')
  if (input.recursive) warnings.push(`${snapshot.countTruncated ? 'More than ' : ''}${snapshot.affectedCount.toLocaleString()} items are in scope.`)
  if (input.crossFilesystem) warnings.push('Traversal may cross mounted filesystems.')
  if (snapshot.type === 'link') warnings.push('The target is a symbolic link. Ownership applies to the link; chmod is unavailable.')
  if (input.acl.length && !snapshot.aclSupported) warnings.push('POSIX ACL tools are not installed on this server.')
  if (!input.owner && !input.group && !input.permissions && !input.directoryPermissions && !input.filePermissions && !input.acl.length) warnings.push('No changes have been selected.')
  return {
    risk: blocked ? 'blocked' : dangerous ? 'dangerous' : input.recursive || input.acl.length ? 'elevated' : 'normal',
    warnings,
    confirmationPhrase: blocked ? null : dangerous ? `APPLY ${input.path}` : null,
  }
}
const accessOperations = (input: SshAccessChangeInput): string[] => {
  const scope = input.recursive ? `recursively${input.crossFilesystem ? ' across mounts' : ' on this filesystem'}` : 'on this item'
  const operations: string[] = []
  if (input.owner || input.group) operations.push(`Change ownership ${scope} to ${input.owner ?? '(keep owner)'}:${input.group ?? '(keep group)'}`)
  if (input.permissions) operations.push(`Set mode ${input.permissions} ${scope}`)
  if (input.directoryPermissions) operations.push(`Set directory mode ${input.directoryPermissions} recursively`)
  if (input.filePermissions) operations.push(`Set file mode ${input.filePermissions} recursively`)
  for (const entry of input.acl) operations.push(`${entry.permissions === null ? 'Remove' : 'Set'} ${entry.default ? 'default ' : ''}${entry.kind} ACL for ${entry.name}${entry.permissions ? ` to ${entry.permissions}` : ''}`)
  return operations
}
const previewAccess = async (id: string, rawInput: SshAccessChangeInput): Promise<SshAccessPreview> =>
  await withClient(id, async (client) => {
    const input = normalizedAccessInput(rawInput)
    const snapshot = await inspectAccess(client, input)
    const risk = accessRisk(input, snapshot)
    const token = randomUUID()
    const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    accessPreviewTokens.set(token, { connectionId: id, inputHash, signature: snapshot.signature, expiresAt: Date.now() + 60_000 })
    for (const [key, value] of accessPreviewTokens) if (value.expiresAt < Date.now()) accessPreviewTokens.delete(key)
    return { connectionId: id, ...snapshot, ...risk, operations: accessOperations(input), token }
  })
const applyAccess = async (
  id: string,
  rawInput: SshAccessChangeInput,
  token: string,
  confirmation: string,
): Promise<SshAccessApplyResult> => await withClient(id, async (client) => {
  const input = normalizedAccessInput(rawInput)
  const preview = accessPreviewTokens.get(token)
  accessPreviewTokens.delete(token)
  const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  if (!preview || preview.connectionId !== id || preview.inputHash !== inputHash || preview.expiresAt < Date.now()) {
    throw new Error('The preview expired or the requested changes were edited. Preview again.')
  }
  const snapshot = await inspectAccess(client, input)
  if (snapshot.signature !== preview.signature) throw new Error('The target changed after preview. Inspect it again before applying.')
  const risk = accessRisk(input, snapshot)
  if (risk.risk === 'blocked') throw new Error(risk.warnings[0] || 'This path is protected.')
  if (risk.confirmationPhrase && confirmation !== risk.confirmationPhrase) throw new Error('The confirmation phrase does not match.')
  if (!input.owner && !input.group && !input.permissions && !input.directoryPermissions && !input.filePermissions && !input.acl.length) throw new Error('No access changes were selected.')
  const privilege = await accountPrivilege(client)
  if (!privilege.canManage) throw new Error('Root or passwordless sudo is required for access changes.')
  const path = shellQuote(input.path)
  const findFlags = input.crossFilesystem ? '' : ' -xdev'
  const commands: string[] = []
  const each = (command: string, targetType: 'directory' | 'file' | null = null): string => input.recursive
    ? `find ${path}${findFlags}${targetType ? ` -type ${targetType === 'directory' ? 'd' : 'f'}` : ''} -exec ${command} -- {} +`
    : `${command} -- ${path}`
  if (input.owner || input.group) commands.push(each(`chown -h ${shellQuote(`${input.owner ?? ''}:${input.group ?? ''}`)}`))
  if (input.permissions) {
    if (snapshot.type === 'link') throw new Error('Symbolic-link permissions cannot be changed safely.')
    commands.push(each(`chmod ${input.permissions}`))
  }
  if (input.directoryPermissions) commands.push(each(`chmod ${input.directoryPermissions}`, 'directory'))
  if (input.filePermissions) commands.push(each(`chmod ${input.filePermissions}`, 'file'))
  for (const entry of input.acl) {
    if (!snapshot.aclSupported) throw new Error('POSIX ACL tools are not installed on this server.')
    if (entry.default && snapshot.type !== 'directory') throw new Error('Default ACLs can only be applied to directories.')
    const subject = `${entry.kind === 'user' ? 'u' : 'g'}:${entry.name}`
    const command = entry.permissions === null
      ? `setfacl -x ${shellQuote(`${entry.default ? 'd:' : ''}${subject}`)}`
      : `setfacl -m ${shellQuote(`${entry.default ? 'd:' : ''}${subject}:${entry.permissions}`)}`
    commands.push(each(command, entry.default ? 'directory' : null))
  }
  await privilegedAccountCommand(client, commands.join(' && '))
  return { path: input.path, affectedCount: snapshot.affectedCount, appliedAt: new Date().toISOString() }
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

const safeEntryName = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('A valid name is required.')
  const name = value.trim()
  if (!name || name === '.' || name === '..' || name.length > 255
    || name.includes('/') || name.includes('\\') || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Enter a valid file or folder name.')
  }
  return name
}

const mutationResult = (
  connectionId: string,
  path: string,
): SshRemoteEntryMutationResult => ({
  connectionId,
  path,
  parentPath: posix.dirname(path),
})

const createRemoteEntry = async (
  id: string,
  requestedParentPath: string,
  requestedName: string,
  type: 'file' | 'directory',
): Promise<SshRemoteEntryMutationResult> => {
  if (type !== 'file' && type !== 'directory') throw new Error('Unsupported entry type.')
  const parentPath = normalizeRemotePath(requestedParentPath)
  return await withClient(id, async (client, connection) => {
    const remote = await sftp(client)
    try {
      const resolvedParentPath = await new Promise<string>((resolve, reject) =>
        remote.realpath(parentPath, (error, absolutePath) => error ? reject(error) : resolve(absolutePath)))
      const path = posix.join(resolvedParentPath, safeEntryName(requestedName))
      await new Promise<void>((resolve, reject) => {
        const callback = (error?: Error | null): void => error ? reject(error) : resolve()
        if (type === 'directory') remote.mkdir(path, { mode: 0o755 }, callback)
        else remote.writeFile(path, Buffer.alloc(0), { flag: 'wx', mode: 0o644 }, callback)
      })
      return mutationResult(connection.id, path)
    } finally {
      remote.end()
    }
  })
}

const renameRemoteEntry = async (
  id: string,
  requestedPath: string,
  requestedName: string,
): Promise<SshRemoteEntryMutationResult> => {
  const path = normalizeRemotePath(requestedPath)
  const target = posix.join(posix.dirname(path), safeEntryName(requestedName))
  if (target === path) return mutationResult(id, path)
  return await withClient(id, async (client, connection) => {
    const remote = await sftp(client)
    try {
      await new Promise<void>((resolve, reject) =>
        remote.rename(path, target, (error) => error ? reject(error) : resolve()))
      return mutationResult(connection.id, target)
    } finally {
      remote.end()
    }
  })
}

const deleteRemoteEntry = async (
  id: string,
  requestedPath: string,
): Promise<SshRemoteEntryMutationResult> => {
  const path = normalizeRemotePath(requestedPath)
  if (path === '/' || path === '.' || path === '~') throw new Error('Deleting this protected path is not allowed.')
  return await withClient(id, async (client, connection) => {
    const remote = await sftp(client)
    let visited = 0
    const remove = async (target: string): Promise<void> => {
      visited += 1
      if (visited > 10_000) throw new Error('Delete stopped after 10,000 entries. Narrow the operation first.')
      const attributes = await new Promise<Awaited<ReturnType<typeof remoteStat>>>((resolve, reject) =>
        remote.lstat(target, (error, result) => error ? reject(error) : resolve(result)))
      if (attributes.isDirectory() && !attributes.isSymbolicLink()) {
        const children = await new Promise<Parameters<Parameters<SFTPWrapper['readdir']>[1]>[1]>((resolve, reject) =>
          remote.readdir(target, (error, entries) => error ? reject(error) : resolve(entries)))
        for (const child of children) {
          if (child.filename !== '.' && child.filename !== '..') await remove(posix.join(target, child.filename))
        }
        await new Promise<void>((resolve, reject) =>
          remote.rmdir(target, (error) => error ? reject(error) : resolve()))
      } else {
        await new Promise<void>((resolve, reject) =>
          remote.unlink(target, (error) => error ? reject(error) : resolve()))
      }
    }
    try {
      await remove(path)
      return mutationResult(connection.id, path)
    } finally {
      remote.end()
    }
  })
}

const chmodRemoteEntry = async (
  id: string,
  requestedPath: string,
  requestedPermissions: string,
): Promise<SshRemoteEntryMutationResult> => {
  const path = normalizeRemotePath(requestedPath)
  if (!/^[0-7]{3,4}$/.test(requestedPermissions)) {
    throw new Error('Permissions must be a three or four digit octal value, such as 0644.')
  }
  const mode = Number.parseInt(requestedPermissions, 8)
  return await withClient(id, async (client, connection) => {
    const remote = await sftp(client)
    try {
      await new Promise<void>((resolve, reject) =>
        remote.chmod(path, mode, (error) => error ? reject(error) : resolve()))
      return mutationResult(connection.id, path)
    } finally {
      remote.end()
    }
  })
}

const copyRemoteEntry = async (
  id: string,
  requestedPath: string,
  requestedTargetDirectory: string,
): Promise<SshRemoteEntryMutationResult> => {
  const source = normalizeRemotePath(requestedPath)
  const targetDirectory = normalizeRemotePath(requestedTargetDirectory)
  const target = posix.join(targetDirectory, posix.basename(source))
  if (target === source || target.startsWith(`${source}/`)) {
    throw new Error('An entry cannot be copied into itself.')
  }
  return await withClient(id, async (client, connection) => {
    const remote = await sftp(client)
    let visited = 0
    const copy = async (from: string, to: string): Promise<void> => {
      visited += 1
      if (visited > 10_000) throw new Error('Copy stopped after 10,000 entries. Narrow the operation first.')
      const attributes = await new Promise<Awaited<ReturnType<typeof remoteStat>>>((resolve, reject) =>
        remote.lstat(from, (error, result) => error ? reject(error) : resolve(result)))
      if (attributes.isDirectory() && !attributes.isSymbolicLink()) {
        await new Promise<void>((resolve, reject) =>
          remote.mkdir(to, { mode: attributes.mode & 0o7777 }, (error) => error ? reject(error) : resolve()))
        const children = await new Promise<Parameters<Parameters<SFTPWrapper['readdir']>[1]>[1]>((resolve, reject) =>
          remote.readdir(from, (error, entries) => error ? reject(error) : resolve(entries)))
        for (const child of children) {
          if (child.filename !== '.' && child.filename !== '..') {
            await copy(posix.join(from, child.filename), posix.join(to, child.filename))
          }
        }
      } else if (attributes.isSymbolicLink()) {
        const link = await new Promise<string>((resolve, reject) =>
          remote.readlink(from, (error, value) => error ? reject(error) : resolve(value)))
        await new Promise<void>((resolve, reject) =>
          remote.symlink(link, to, (error) => error ? reject(error) : resolve()))
      } else {
        await new Promise<void>((resolve, reject) => {
          const input = remote.createReadStream(from)
          const output = remote.createWriteStream(to, { mode: attributes.mode & 0o7777, flags: 'wx' })
          let settled = false
          const finish = (error?: Error): void => {
            if (settled) return
            settled = true
            if (error) reject(error)
            else resolve()
          }
          input.once('error', finish)
          output.once('error', finish)
          output.once('close', () => finish())
          input.pipe(output)
        })
      }
    }
    try {
      await copy(source, target)
      return mutationResult(connection.id, target)
    } catch (error) {
      try {
        const attributes = await new Promise<Awaited<ReturnType<typeof remoteStat>>>((resolve, reject) =>
          remote.lstat(target, (statError, result) => statError ? reject(statError) : resolve(result)))
        if (!attributes.isDirectory()) await new Promise<void>((resolve) => remote.unlink(target, () => resolve()))
      } catch {
        // Nothing partial to clean up at the root level.
      }
      throw error
    } finally {
      remote.end()
    }
  })
}

const moveRemoteEntry = async (
  id: string,
  requestedPath: string,
  requestedTargetDirectory: string,
): Promise<SshRemoteEntryMutationResult> => {
  const source = normalizeRemotePath(requestedPath)
  const targetDirectory = normalizeRemotePath(requestedTargetDirectory)
  const target = posix.join(targetDirectory, posix.basename(source))
  if (target === source || target.startsWith(`${source}/`)) {
    throw new Error('An entry cannot be moved into itself.')
  }
  return await withClient(id, async (client, connection) => {
    const remote = await sftp(client)
    try {
      await new Promise<void>((resolve, reject) =>
        remote.rename(source, target, (error) => error ? reject(error) : resolve()))
      return mutationResult(connection.id, target)
    } finally {
      remote.end()
    }
  })
}

const emitTransfer = (
  event: IpcMainInvokeEvent,
  progress: SshTransferProgress,
): void => {
  if (!event.sender.isDestroyed()) event.sender.send('ssh:transfer-progress', progress)
}

const runCommand = async (
  event: IpcMainInvokeEvent,
  connectionId: string,
  runId: string,
  command: string,
): Promise<SshCommandResult> => {
  if (!/^[a-z0-9-]{12,80}$/i.test(runId)) throw new Error('Invalid command run identifier.')
  if (!command.trim()) throw new Error('The command is empty.')
  if (command.includes('\0')) throw new Error('Commands cannot contain null bytes.')
  if (Buffer.byteLength(command, 'utf8') > 64 * 1024) throw new Error('The command is too large to run.')
  if (commandRuns.has(runId)) throw new Error('This command run already exists.')

  const startedAt = new Date().toISOString()
  const run = { connectionId, cancelled: false, cancel: (): void => undefined }
  commandRuns.set(runId, run)
  let client: Client | null = null
  try {
    client = await connect(getSshRuntimeConnection(connectionId))
    if (run.cancelled) {
      return { id: runId, exitCode: null, signal: null, cancelled: true, startedAt, finishedAt: new Date().toISOString() }
    }
    return await new Promise<SshCommandResult>((resolve, reject) => {
      client!.exec(command, (error, stream) => {
        if (error) {
          reject(error)
          return
        }
        let settled = false
        let receivedBytes = 0
        const finish = (exitCode: number | null, signal: string | null, failure?: Error): void => {
          if (settled) return
          settled = true
          if (failure && !run.cancelled) reject(failure)
          else resolve({
            id: runId,
            exitCode,
            signal,
            cancelled: run.cancelled,
            startedAt,
            finishedAt: new Date().toISOString(),
          })
        }
        run.cancel = () => {
          run.cancelled = true
          stream.close()
        }
        const emit = (channel: 'stdout' | 'stderr', chunk: Buffer): void => {
          receivedBytes += chunk.length
          if (receivedBytes > 5 * 1024 * 1024) {
            finish(null, null, new Error('Command output exceeded the 5 MB display limit.'))
            stream.close()
            return
          }
          if (!event.sender.isDestroyed()) {
            event.sender.send('ssh:command-output', { id: runId, stream: channel, data: chunk.toString('utf8') })
          }
        }
        stream.on('data', (chunk: Buffer) => emit('stdout', chunk))
        stream.stderr.on('data', (chunk: Buffer) => emit('stderr', chunk))
        stream.once('close', (code: number | null, signal: string | null) => finish(code, signal))
        stream.once('error', (streamError: Error) => finish(null, null, streamError))
        if (run.cancelled) run.cancel()
      })
    })
  } finally {
    commandRuns.delete(runId)
    client?.end()
  }
}

const cancelCommand = (runId: string): void => {
  const run = commandRuns.get(runId)
  if (!run) return
  run.cancelled = true
  run.cancel()
}

const uploadFiles = async (
  event: IpcMainInvokeEvent,
  id: string,
  requestedTargetDirectory: string,
): Promise<SshTransferResult | null> => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const selection = await dialog.showOpenDialog(owner ?? undefined, {
    title: 'Upload files to server',
    properties: ['openFile', 'multiSelections'],
  })
  if (selection.canceled || selection.filePaths.length === 0) return null
  const targetDirectory = normalizeRemotePath(requestedTargetDirectory)
  const sizes = await Promise.all(selection.filePaths.map(async (path) => (await localStat(path)).size))
  const totalBytes = sizes.reduce((total, size) => total + size, 0)
  const transferId = randomUUID()
  const uploaded: string[] = []
  let completedBytes = 0
  let activeRemotePath: string | null = null
  return await withClient(id, async (client) => {
    const remote = await sftp(client)
    try {
      for (let index = 0; index < selection.filePaths.length; index += 1) {
        const localPath = selection.filePaths[index]
        const remotePath = posix.join(targetDirectory, localBasename(localPath))
        activeRemotePath = remotePath
        const fileSize = sizes[index]
        await new Promise<void>((resolve, reject) => {
          const input = createReadStream(localPath)
          const output = remote.createWriteStream(remotePath, { flags: 'wx', mode: 0o644 })
          let fileBytes = 0
          let settled = false
          const cancel = (): void => {
            input.destroy(new Error('Transfer cancelled.'))
            output.destroy()
          }
          transferCancellers.set(transferId, cancel)
          const finish = (error?: Error): void => {
            if (settled) return
            settled = true
            transferCancellers.delete(transferId)
            if (error) reject(error)
            else resolve()
          }
          input.on('data', (chunk: Buffer) => {
            fileBytes += chunk.length
            emitTransfer(event, {
              id: transferId, direction: 'upload', name: localBasename(localPath),
              transferredBytes: completedBytes + fileBytes, totalBytes, status: 'running', error: null,
            })
          })
          input.once('error', finish)
          output.once('error', finish)
          output.once('close', () => finish())
          input.pipe(output)
        })
        completedBytes += fileSize
        uploaded.push(remotePath)
        activeRemotePath = null
      }
      emitTransfer(event, {
        id: transferId, direction: 'upload', name: `${uploaded.length} file${uploaded.length === 1 ? '' : 's'}`,
        transferredBytes: totalBytes, totalBytes, status: 'completed', error: null,
      })
      return { id: transferId, paths: uploaded }
    } catch (error) {
      if (activeRemotePath) {
        await new Promise<void>((resolve) => remote.unlink(activeRemotePath!, () => resolve()))
      }
      const message = error instanceof Error ? error.message : String(error)
      emitTransfer(event, {
        id: transferId, direction: 'upload', name: 'Upload', transferredBytes: completedBytes,
        totalBytes, status: message.includes('cancelled') ? 'cancelled' : 'failed', error: message,
      })
      throw error
    } finally {
      transferCancellers.delete(transferId)
      remote.end()
    }
  })
}

const downloadFile = async (
  event: IpcMainInvokeEvent,
  id: string,
  requestedPath: string,
): Promise<SshTransferResult | null> => {
  const remotePath = normalizeRemotePath(requestedPath)
  const owner = BrowserWindow.fromWebContents(event.sender)
  const destination = await dialog.showSaveDialog(owner ?? undefined, {
    title: 'Download remote file',
    defaultPath: posix.basename(remotePath),
  })
  if (destination.canceled || !destination.filePath) return null
  const transferId = randomUUID()
  const temporaryPath = `${destination.filePath}.myrepos-${transferId}.part`
  return await withClient(id, async (client) => {
    const remote = await sftp(client)
    const attributes = await remoteStat(remote, remotePath)
    let transferredBytes = 0
    try {
      await new Promise<void>((resolve, reject) => {
        const input = remote.createReadStream(remotePath)
        const output = createWriteStream(temporaryPath, { flags: 'wx' })
        let settled = false
        const cancel = (): void => {
          input.destroy(new Error('Transfer cancelled.'))
          output.destroy()
        }
        transferCancellers.set(transferId, cancel)
        const finish = (error?: Error): void => {
          if (settled) return
          settled = true
          transferCancellers.delete(transferId)
          if (error) reject(error)
          else resolve()
        }
        input.on('data', (chunk: Buffer) => {
          transferredBytes += chunk.length
          emitTransfer(event, {
            id: transferId, direction: 'download', name: posix.basename(remotePath), transferredBytes,
            totalBytes: attributes.size, status: 'running', error: null,
          })
        })
        input.once('error', finish)
        output.once('error', finish)
        output.once('close', () => finish())
        input.pipe(output)
      })
      await localCopyFile(temporaryPath, destination.filePath)
      await localUnlink(temporaryPath)
      emitTransfer(event, {
        id: transferId, direction: 'download', name: posix.basename(remotePath),
        transferredBytes: attributes.size, totalBytes: attributes.size, status: 'completed', error: null,
      })
      return { id: transferId, paths: [destination.filePath] }
    } catch (error) {
      await localUnlink(temporaryPath).catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      emitTransfer(event, {
        id: transferId, direction: 'download', name: posix.basename(remotePath), transferredBytes,
        totalBytes: attributes.size, status: message.includes('cancelled') ? 'cancelled' : 'failed', error: message,
      })
      throw error
    } finally {
      transferCancellers.delete(transferId)
      remote.end()
    }
  })
}

export const registerSshWorkspaceHandlers = (): void => {
  ipcMain.handle('ssh:server-overview', (_event, id: string) => serverOverview(id))
  ipcMain.handle('ssh:account-catalog', (_event, id: string) => accountCatalog(id))
  ipcMain.handle('ssh:authorized-keys', (_event, id: string, username: string) => authorizedKeys(id, username))
  ipcMain.handle('ssh:manage-accounts', (_event, id: string, operation: SshAccountOperation) =>
    manageAccounts(id, operation))
  ipcMain.handle('ssh:preview-access', (_event, id: string, input: SshAccessChangeInput) =>
    previewAccess(id, input))
  ipcMain.handle('ssh:apply-access', (_event, id: string, input: SshAccessChangeInput, token: string, confirmation: string) =>
    applyAccess(id, input, token, confirmation))
  ipcMain.handle('ssh:list-directory', (_event, id: string, path?: string | null) =>
    listDirectory(id, path))
  ipcMain.handle('ssh:read-file', (_event, id: string, path: string) => readRemoteFile(id, path))
  ipcMain.handle('ssh:write-file', (_event, input: SshRemoteFileWriteInput) => writeRemoteFile(input))
  ipcMain.handle('ssh:create-entry', (_event, id: string, parentPath: string, name: string, type: 'file' | 'directory') =>
    createRemoteEntry(id, parentPath, name, type))
  ipcMain.handle('ssh:rename-entry', (_event, id: string, path: string, name: string) =>
    renameRemoteEntry(id, path, name))
  ipcMain.handle('ssh:delete-entry', (_event, id: string, path: string) => deleteRemoteEntry(id, path))
  ipcMain.handle('ssh:chmod-entry', (_event, id: string, path: string, permissions: string) =>
    chmodRemoteEntry(id, path, permissions))
  ipcMain.handle('ssh:copy-entry', (_event, id: string, path: string, targetDirectory: string) =>
    copyRemoteEntry(id, path, targetDirectory))
  ipcMain.handle('ssh:move-entry', (_event, id: string, path: string, targetDirectory: string) =>
    moveRemoteEntry(id, path, targetDirectory))
  ipcMain.handle('ssh:upload-files', (event, id: string, targetDirectory: string) =>
    uploadFiles(event, id, targetDirectory))
  ipcMain.handle('ssh:download-file', (event, id: string, path: string) => downloadFile(event, id, path))
  ipcMain.handle('ssh:cancel-transfer', (_event, id: string) => { transferCancellers.get(id)?.() })
  ipcMain.handle('ssh:run-command', (event, connectionId: string, runId: string, command: string) =>
    runCommand(event, connectionId, runId, command))
  ipcMain.handle('ssh:cancel-command', (_event, runId: string) => cancelCommand(runId))
}
