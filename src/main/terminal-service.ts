import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { access, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { homedir, platform } from 'node:os'
import * as pty from 'node-pty'
import type {
  TerminalCreateInput,
  TerminalProfile,
  TerminalSessionInfo,
} from '../shared/desktop-api'

interface ManagedTerminal {
  info: TerminalSessionInfo
  ownerId: number
  process: pty.IPty
  buffer: string
  pendingOutput: string
  flushTimer: ReturnType<typeof setTimeout> | null
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
      const candidate = join(directory, name.endsWith(extension.toLowerCase()) ||
        name.endsWith(extension.toUpperCase()) ? name : `${name}${extension.toLowerCase()}`)
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
  const unique = [...new Set(candidates)]
  const profiles: TerminalProfile[] = []
  for (const executable of unique) {
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

const ownedSession = (event: IpcMainInvokeEvent, id: string): ManagedTerminal => {
  const session = sessions.get(id)
  if (!session || session.ownerId !== event.sender.id) throw new Error('Terminal session is unavailable.')
  return session
}

const publishOutput = (session: ManagedTerminal): void => {
  session.flushTimer = null
  if (!session.pendingOutput) return
  const owner = BrowserWindow.getAllWindows()
    .map((window) => window.webContents)
    .find((contents) => contents.id === session.ownerId && !contents.isDestroyed())
  const data = session.pendingOutput
  session.pendingOutput = ''
  owner?.send('terminals:data', session.info.id, data)
}

const queueOutput = (session: ManagedTerminal, data: string): void => {
  session.buffer = `${session.buffer}${data}`.slice(-maximumBufferLength)
  session.pendingOutput += data
  if (!session.flushTimer) session.flushTimer = setTimeout(() => publishOutput(session), 12)
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
  const profile = profiles.find((candidate) => candidate.id === input.profileId) ??
    profiles.find((candidate) => candidate.default) ?? profiles[0]
  if (!profile) throw new Error('No supported command shell was found.')
  const cwd = await normalizeCwd(input.cwd)
  const id = `terminal-${Date.now()}-${++sessionSequence}`
  const info: TerminalSessionInfo = {
    id,
    title: profile.name,
    cwd,
    profileId: profile.id,
    status: 'running',
    exitCode: null,
  }
  const terminalProcess = pty.spawn(profile.executable, profile.args, {
    name: 'xterm-256color',
    cols: Math.max(2, Math.min(500, Math.round(input.cols || 100))),
    rows: Math.max(1, Math.min(200, Math.round(input.rows || 30))),
    cwd,
    env: {
      ...Object.fromEntries(Object.entries(process.env).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, value]])),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
    handleFlowControl: true,
    // node-pty's native Windows ConPTY path forks a console-list helper while
    // closing a session. That helper can fail to attach inside Electron and
    // terminate the application. The bundled ConPTY backend owns cleanup
    // directly and avoids that fragile helper process.
    ...(platform() === 'win32' ? { useConpty: true, useConptyDll: true } : {}),
  })
  const session: ManagedTerminal = {
    info,
    ownerId: event.sender.id,
    process: terminalProcess,
    buffer: '',
    pendingOutput: '',
    flushTimer: null,
  }
  sessions.set(id, session)
  terminalProcess.onData((data) => queueOutput(session, data))
  terminalProcess.onExit(({ exitCode }) => {
    session.info = { ...session.info, status: 'exited', exitCode }
    publishOutput(session)
    if (!event.sender.isDestroyed()) event.sender.send('terminals:exit', session.info)
  })
  return { ...info }
}

const disposeSession = (session: ManagedTerminal): void => {
  if (session.flushTimer) clearTimeout(session.flushTimer)
  session.flushTimer = null
  if (session.info.status === 'running') {
    try {
      session.process.kill()
    } catch {
      // The process may have exited between the status check and cleanup.
    }
  }
  sessions.delete(session.info.id)
}

export const registerTerminalHandlers = (): void => {
  ipcMain.handle('terminals:profiles', () => terminalProfiles())
  ipcMain.handle('terminals:create', (event, input: TerminalCreateInput) => createTerminal(event, input))
  ipcMain.handle('terminals:buffer', (event, id: string) => ownedSession(event, id).buffer)
  ipcMain.handle('terminals:write', (event, id: string, data: string) => {
    if (typeof data !== 'string' || data.length > 65_536) throw new Error('Invalid terminal input.')
    ownedSession(event, id).process.write(data)
  })
  ipcMain.handle('terminals:resize', (event, id: string, cols: number, rows: number) => {
    ownedSession(event, id).process.resize(
      Math.max(2, Math.min(500, Math.round(cols))),
      Math.max(1, Math.min(200, Math.round(rows))),
    )
  })
  ipcMain.handle('terminals:kill', (event, id: string) => disposeSession(ownedSession(event, id)))
}

export const closeAllTerminals = (): void => {
  for (const session of [...sessions.values()]) disposeSession(session)
}
