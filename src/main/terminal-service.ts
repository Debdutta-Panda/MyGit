import {
  app,
  BrowserWindow,
  ipcMain,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from 'electron'
import { access, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { homedir, platform } from 'node:os'
import type {
  TerminalCreateInput,
  TerminalProfile,
  TerminalSessionInfo,
} from '../shared/desktop-api'
import { getSshRuntimeConnection } from './ssh-connections'

interface HostMessage {
  type: 'ready' | 'data' | 'exit' | 'error'
  chunk?: string
  exitCode?: number
  message?: string
}

interface ManagedTerminal {
  info: TerminalSessionInfo
  ownerId: number
  host: UtilityProcess
  buffer: string
  pendingOutput: string
  flushTimer: ReturnType<typeof setTimeout> | null
  forceKillTimer: ReturnType<typeof setTimeout> | null
  disposed: boolean
}

const sessions = new Map<string, ManagedTerminal>()
const ownersWithCleanup = new Set<number>()
let sessionSequence = 0
const maximumBufferLength = 1_000_000

const executableOnPath = async (name: string): Promise<string | null> => {
  const extensions = platform() === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : ['']
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(
        directory,
        name.endsWith(extension.toLowerCase()) || name.endsWith(extension.toUpperCase())
          ? name
          : `${name}${extension.toLowerCase()}`,
      )
      try {
        await access(candidate)
        return candidate
      } catch {
        // Try the next PATH entry.
      }
    }
  }
  return null
}

const terminalProfiles = async (): Promise<TerminalProfile[]> => {
  if (platform() === 'win32') {
    const candidates: Array<[string, string, string, string[]]> = [
      ['pwsh', 'PowerShell', 'pwsh.exe', ['-NoLogo']],
      ['powershell', 'Windows PowerShell', 'powershell.exe', ['-NoLogo']],
      ['cmd', 'Command Prompt', 'cmd.exe', []],
      ['git-bash', 'Git Bash', 'bash.exe', ['--login', '-i']],
      ['wsl', 'WSL', 'wsl.exe', []],
    ]
    const commonLocations: Record<string, string[]> = {
      'pwsh.exe': [
        join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
      ],
      'bash.exe': [
        join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
        join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
      ],
    }
    const profiles: TerminalProfile[] = []
    for (const [id, name, command, args] of candidates) {
      let executable = await executableOnPath(command)
      if (!executable) {
        for (const candidate of commonLocations[command] ?? []) {
          try {
            await access(candidate)
            executable = candidate
            break
          } catch {
            // Try the next well-known installation location.
          }
        }
      }
      if (executable) profiles.push({ id, name, executable, args, default: profiles.length === 0 })
    }
    return profiles
  }

  const configuredShell = process.env.SHELL || (platform() === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const candidates = [configuredShell, '/bin/zsh', '/bin/bash', '/bin/sh']
  const profiles: TerminalProfile[] = []
  for (const executable of [...new Set(candidates)]) {
    try {
      await access(executable)
      profiles.push({
        id: executable,
        name: executable.split('/').at(-1) ?? executable,
        executable,
        args: ['-l'],
        default: profiles.length === 0,
      })
    } catch {
      // Ignore unavailable shells.
    }
  }
  return profiles
}

const normalizeCwd = async (requested: string | null | undefined): Promise<string> => {
  if (!requested || !isAbsolute(requested)) return homedir()
  try {
    const details = await stat(requested)
    if (details.isDirectory()) return requested
    if (details.isFile()) return dirname(requested)
  } catch {
    // A missing repository/workspace falls back to the user's home directory.
  }
  return homedir()
}

const ownerContents = (session: ManagedTerminal): Electron.WebContents | undefined =>
  BrowserWindow.getAllWindows()
    .map((window) => window.webContents)
    .find((contents) => contents.id === session.ownerId && !contents.isDestroyed())

const ownedSession = (event: IpcMainInvokeEvent, id: string): ManagedTerminal => {
  const session = sessions.get(id)
  if (!session || session.ownerId !== event.sender.id || session.disposed) {
    throw new Error('Terminal session is unavailable.')
  }
  return session
}

const publishOutput = (session: ManagedTerminal): void => {
  session.flushTimer = null
  if (!session.pendingOutput) return
  const data = session.pendingOutput
  session.pendingOutput = ''
  ownerContents(session)?.send('terminals:data', session.info.id, data)
}

const queueOutput = (session: ManagedTerminal, data: string): void => {
  session.buffer = `${session.buffer}${data}`.slice(-maximumBufferLength)
  session.pendingOutput += data
  if (!session.flushTimer) session.flushTimer = setTimeout(() => publishOutput(session), 12)
}

const markExited = (session: ManagedTerminal, exitCode: number | null): void => {
  if (session.info.status === 'exited') return
  session.info = { ...session.info, status: 'exited', exitCode }
  publishOutput(session)
  ownerContents(session)?.send('terminals:exit', session.info)
}

const disposeSession = (session: ManagedTerminal): void => {
  if (session.disposed) return
  session.disposed = true
  sessions.delete(session.info.id)
  if (session.flushTimer) clearTimeout(session.flushTimer)
  session.flushTimer = null
  if (session.info.status === 'running') {
    const hostPid = session.host.pid
    session.host.postMessage({ type: 'kill' })
    session.forceKillTimer = setTimeout(() => {
      session.forceKillTimer = null
      if (hostPid) {
        try {
          process.kill(hostPid, 'SIGKILL')
        } catch {
          // The utility process already exited normally.
        }
      } else {
        session.host.kill()
      }
    }, 350)
  } else {
    session.host.kill()
  }
}

const createTerminal = async (
  event: IpcMainInvokeEvent,
  input: TerminalCreateInput,
): Promise<TerminalSessionInfo> => {
  if (!ownersWithCleanup.has(event.sender.id)) {
    const ownerId = event.sender.id
    ownersWithCleanup.add(ownerId)
    event.sender.once('destroyed', () => {
      ownersWithCleanup.delete(ownerId)
      for (const session of [...sessions.values()]) {
        if (session.ownerId === ownerId) disposeSession(session)
      }
    })
  }

  const profiles = await terminalProfiles()
  const sshConnection = input.sshConnectionId
    ? getSshRuntimeConnection(input.sshConnectionId)
    : null
  const profile = sshConnection
    ? null
    : profiles.find((candidate) => candidate.id === input.profileId)
      ?? profiles.find((candidate) => candidate.default)
      ?? profiles[0]
  if (!sshConnection && !profile) throw new Error('No supported command shell was found.')

  const cwd = sshConnection
    ? `${sshConnection.username}@${sshConnection.host}`
    : await normalizeCwd(input.cwd)
  const hostCwd = sshConnection ? app.getPath('home') : cwd
  const id = `terminal-${Date.now()}-${++sessionSequence}`
  const info: TerminalSessionInfo = {
    id,
    title: sshConnection
      ? `SSH - ${sshConnection.username}@${sshConnection.host}`
      : profile!.name,
    cwd,
    profileId: sshConnection ? `ssh:${sshConnection.id}` : profile!.id,
    kind: sshConnection ? 'ssh' : 'local',
    sshConnectionId: sshConnection?.id ?? null,
    status: 'running',
    exitCode: null,
  }
  const host = utilityProcess.fork(join(app.getAppPath(), 'terminal-host.cjs'), [], {
    cwd: hostCwd,
    env: { ...process.env },
    stdio: 'pipe',
    serviceName: 'MyRepos Terminal',
  })
  const session: ManagedTerminal = {
    info,
    ownerId: event.sender.id,
    host,
    buffer: '',
    pendingOutput: '',
    flushTimer: null,
    forceKillTimer: null,
    disposed: false,
  }
  sessions.set(id, session)

  await new Promise<void>((resolve, reject) => {
    let ready = false
    const startupTimer = setTimeout(() => {
      if (ready) return
      session.disposed = true
      sessions.delete(id)
      host.kill()
      reject(new Error('The terminal process did not start in time.'))
    }, 10_000)
    const failStartup = (message: string): void => {
      if (ready) {
        queueOutput(session, `\r\n[Terminal host error: ${message}]\r\n`)
        markExited(session, 1)
        return
      }
      clearTimeout(startupTimer)
      session.disposed = true
      sessions.delete(id)
      host.kill()
      reject(new Error(message))
    }

    host.on('message', (message: HostMessage) => {
      if (message.type === 'ready') {
        if (ready) return
        ready = true
        clearTimeout(startupTimer)
        resolve()
      } else if (message.type === 'data' && typeof message.chunk === 'string') {
        queueOutput(session, message.chunk)
      } else if (message.type === 'exit') {
        markExited(session, message.exitCode ?? null)
      } else if (message.type === 'error') {
        failStartup(message.message ?? 'The terminal host failed.')
      }
    })
    host.on('error', (type, location) => {
      failStartup(`Terminal host failed (${type} at ${location}).`)
    })
    host.on('exit', (code) => {
      if (!ready) {
        failStartup(`The terminal host exited during startup (code ${code}).`)
      } else if (!session.disposed) {
        markExited(session, code)
      }
    })
    host.stderr?.on('data', (chunk) => {
      const message = String(chunk).trim()
      if (message) queueOutput(session, `\r\n[${message}]\r\n`)
    })
    host.postMessage({
      type: 'start',
      kind: sshConnection ? 'ssh' : 'local',
      executable: profile?.executable,
      args: profile?.args,
      connection: sshConnection,
      cwd,
      cols: Math.max(2, Math.min(500, Math.round(input.cols || 100))),
      rows: Math.max(1, Math.min(200, Math.round(input.rows || 30))),
      env: {
        ...Object.fromEntries(Object.entries(process.env).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, value]])),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    })
  })

  return { ...info }
}

export const registerTerminalHandlers = (): void => {
  ipcMain.handle('terminals:profiles', () => terminalProfiles())
  ipcMain.handle('terminals:create', (event, input: TerminalCreateInput) => createTerminal(event, input))
  ipcMain.handle('terminals:buffer', (event, id: string) => ownedSession(event, id).buffer)
  ipcMain.handle('terminals:write', (event, id: string, data: string) => {
    if (typeof data !== 'string' || data.length > 65_536) throw new Error('Invalid terminal input.')
    ownedSession(event, id).host.postMessage({ type: 'write', data })
  })
  ipcMain.handle('terminals:resize', (event, id: string, cols: number, rows: number) => {
    ownedSession(event, id).host.postMessage({
      type: 'resize',
      cols: Math.max(2, Math.min(500, Math.round(cols))),
      rows: Math.max(1, Math.min(200, Math.round(rows))),
    })
  })
  ipcMain.handle('terminals:kill', (event, id: string) => disposeSession(ownedSession(event, id)))
}

export const closeAllTerminals = (): void => {
  for (const session of [...sessions.values()]) disposeSession(session)
}
