import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ActionIcon, Loader, Select, Text, TextInput, Tooltip } from '@mantine/core'
import {
  IconChevronDown,
  IconChevronUp,
  IconClipboard,
  IconColumns2,
  IconCopy,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServer2,
  IconTerminal2,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'
import type { TerminalProfile, TerminalSessionInfo } from '../../shared/desktop-api'

export type TerminalOpenRequest =
  | { id: number; kind: 'local'; cwd: string }
  | { id: number; kind: 'ssh'; sshConnectionId: string; initialInput?: string }

interface TerminalController {
  fit: () => void
  focus: () => void
  clear: () => void
  copy: () => Promise<void>
  paste: () => Promise<void>
  findNext: (query: string) => boolean
  findPrevious: (query: string) => boolean
}

interface TerminalViewportProps {
  session: TerminalSessionInfo
  active: boolean
  pane: 'primary' | 'secondary' | null
  onActivate: (id: string) => void
  onReady: (id: string, controller: TerminalController | null) => void
  onSearchRequest: () => void
}

function TerminalViewport({
  session,
  active,
  pane,
  onActivate,
  onReady,
  onSearchRequest,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !window.desktop) return
    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      drawBoldTextInBrightColors: true,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      fontWeight: '400',
      fontWeightBold: '650',
      letterSpacing: 0,
      lineHeight: 1.18,
      minimumContrastRatio: 4.5,
      overviewRulerWidth: 0,
      rightClickSelectsWord: true,
      scrollback: 10_000,
      smoothScrollDuration: 80,
      theme: {
        background: '#0c1117',
        foreground: '#d2dae4',
        cursor: '#63e6be',
        cursorAccent: '#0c1117',
        selectionBackground: '#245f82aa',
        selectionInactiveBackground: '#24465c77',
        black: '#151b22',
        red: '#ff6b6b',
        green: '#51cf66',
        yellow: '#ffd43b',
        blue: '#4dabf7',
        magenta: '#da77f2',
        cyan: '#38d9a9',
        white: '#d7dee8',
        brightBlack: '#687586',
        brightRed: '#ff8787',
        brightGreen: '#69db7c',
        brightYellow: '#ffe066',
        brightBlue: '#74c0fc',
        brightMagenta: '#e599f7',
        brightCyan: '#63e6be',
        brightWhite: '#f1f3f5',
      },
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(container)

    let resizeFrame: number | null = null
    let lastCols = 0
    let lastRows = 0
    const fit = (): void => {
      if (!container.isConnected || container.clientWidth === 0 || container.clientHeight === 0) return
      try {
        fitAddon.fit()
      } catch {
        return
      }
      if (terminal.cols !== lastCols || terminal.rows !== lastRows) {
        lastCols = terminal.cols
        lastRows = terminal.rows
        void window.desktop?.terminals.resize(session.id, terminal.cols, terminal.rows)
          .catch(() => undefined)
      }
    }
    const scheduleFit = (): void => {
      if (resizeFrame !== null) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        fit()
      })
    }
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(container)

    let hydrated = false
    const pendingData: string[] = []
    const unsubscribeData = window.desktop.terminals.onData((id, data) => {
      if (id !== session.id) return
      if (!hydrated) pendingData.push(data)
      else terminal.write(data)
    })
    void window.desktop.terminals.buffer(session.id).then((buffer) => {
      const pending = pendingData.join('')
      terminal.write(pending && buffer.endsWith(pending) ? buffer : buffer + pending)
      hydrated = true
      pendingData.length = 0
    }).catch(() => { hydrated = true })

    const input = terminal.onData((data) => {
      void window.desktop?.terminals.write(session.id, data).catch(() => undefined)
    })
    const handleFocus = (): void => onActivate(session.id)
    container.addEventListener('focusin', handleFocus)
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        onSearchRequest()
        return false
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        if (terminal.hasSelection()) void navigator.clipboard.writeText(terminal.getSelection())
        return false
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void navigator.clipboard.readText().then((text) =>
          window.desktop?.terminals.write(session.id, text)).catch(() => undefined)
        return false
      }
      return true
    })

    const controller: TerminalController = {
      fit: scheduleFit,
      focus: () => terminal.focus(),
      clear: () => terminal.clear(),
      copy: async () => {
        if (terminal.hasSelection()) await navigator.clipboard.writeText(terminal.getSelection())
      },
      paste: async () => {
        const text = await navigator.clipboard.readText()
        if (text) await window.desktop?.terminals.write(session.id, text).catch(() => undefined)
      },
      findNext: (query) => searchAddon.findNext(query, { incremental: true }),
      findPrevious: (query) => searchAddon.findPrevious(query, { incremental: true }),
    }
    onReady(session.id, controller)
    requestAnimationFrame(() => {
      fit()
      if (active) terminal.focus()
    })

    return () => {
      onReady(session.id, null)
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      unsubscribeData()
      input.dispose()
      container.removeEventListener('focusin', handleFocus)
      terminal.dispose()
    }
  }, [session.id])

  return (
    <div
      ref={containerRef}
      className="terminal-viewport"
      data-active={active || undefined}
      data-pane={pane ?? undefined}
    />
  )
}

export function TerminalPanel({
  visible,
  cwd,
  request,
  onRequestHandled,
  onClose,
}: {
  visible: boolean
  cwd: string | null
  request: TerminalOpenRequest | null
  onRequestHandled: () => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const controllersRef = useRef(new Map<string, TerminalController>())
  const creatingRef = useRef(false)
  const [height, setHeight] = useState(() => Number(localStorage.getItem('myrepos:terminal-height')) || 310)
  const [profiles, setProfiles] = useState<TerminalProfile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [splitPair, setSplitPair] = useState<[string, string] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchVisible, setSearchVisible] = useState(false)
  const [search, setSearch] = useState('')

  const activeSession = sessions.find((session) => session.id === activeId) ?? null
  const controllerForActive = (): TerminalController | undefined =>
    activeId ? controllersRef.current.get(activeId) : undefined

  useEffect(() => {
    if (!window.desktop) return
    void window.desktop.terminals.profiles().then((items) => {
      setProfiles(items)
      setSelectedProfile(items.find((item) => item.default)?.id ?? items[0]?.id ?? null)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    return window.desktop.terminals.onExit((exited) => {
      setSessions((current) => current.map((session) =>
        session.id === exited.id ? exited : session))
    })
  }, [])

  const createSession = async (
    profileId = selectedProfile,
    requestedCwd = cwd,
    sshConnectionId: string | null = null,
  ): Promise<TerminalSessionInfo | null> => {
    if (!window.desktop || creatingRef.current) return null
    creatingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const session = await window.desktop.terminals.create({
        profileId,
        cwd: requestedCwd,
        sshConnectionId,
        cols: 100,
        rows: 30,
      })
      setSessions((current) => [...current, session])
      setActiveId(session.id)
      return session
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      return null
    } finally {
      creatingRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    const handleNewTerminalShortcut = (event: KeyboardEvent): void => {
      if (!visible || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key !== '`') return
      event.preventDefault()
      void createSession()
    }
    window.addEventListener('keydown', handleNewTerminalShortcut)
    return () => window.removeEventListener('keydown', handleNewTerminalShortcut)
  }, [visible, selectedProfile, cwd])

  useEffect(() => {
    if (visible && !request && profiles.length > 0 && sessions.length === 0 && !creatingRef.current) {
      void createSession(profiles.find((profile) => profile.default)?.id ?? profiles[0].id)
    }
  }, [visible, profiles.length, request?.id])

  useEffect(() => {
    if (!visible || !request || creatingRef.current) return
    if (request.kind === 'ssh') {
      void createSession(null, null, request.sshConnectionId).then(async (session) => {
        if (session && request.initialInput) await window.desktop?.terminals.write(session.id, request.initialInput)
      }).finally(onRequestHandled)
      return
    }
    if (profiles.length === 0) return
    void createSession(
      profiles.find((profile) => profile.default)?.id ?? profiles[0].id,
      request.cwd,
    ).finally(onRequestHandled)
  }, [request?.id, profiles.length])

  useEffect(() => {
    if (!visible || !activeId) return
    const controller = controllerForActive()
    requestAnimationFrame(() => {
      controller?.fit()
      controller?.focus()
    })
  }, [visible, activeId, height])

  const closeSession = async (id: string): Promise<void> => {
    await window.desktop?.terminals.kill(id).catch(() => undefined)
    controllersRef.current.delete(id)
    if (splitPair?.includes(id)) setSplitPair(null)
    setSessions((current) => {
      const next = current.filter((session) => session.id !== id)
      if (activeId === id) setActiveId(next.at(-1)?.id ?? null)
      return next
    })
  }

  const toggleSplit = async (): Promise<void> => {
    if (splitPair) {
      setSplitPair(null)
      return
    }
    if (!activeSession) return
    const primaryId = activeSession.id
    const secondary = await createSession(
      activeSession.kind === 'ssh' ? null : activeSession.profileId,
      activeSession.kind === 'ssh' ? null : activeSession.cwd,
      activeSession.sshConnectionId,
    )
    if (secondary) setSplitPair([primaryId, secondary.id])
  }

  const restartSession = async (): Promise<void> => {
    if (!activeSession) return
    const { id, profileId, cwd: sessionCwd } = activeSession
    await closeSession(id)
    await createSession(
      activeSession.kind === 'ssh' ? null : profileId,
      activeSession.kind === 'ssh' ? null : sessionCwd,
      activeSession.sshConnectionId,
    )
  }

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !panelRef.current) return
    event.preventDefault()
    const handle = event.currentTarget
    const panel = panelRef.current
    const startY = event.clientY
    const startHeight = panel.getBoundingClientRect().height
    let nextHeight = startHeight
    let frame: number | null = null
    handle.setPointerCapture(event.pointerId)
    const preview = (): void => {
      frame = null
      panel.style.height = `${nextHeight}px`
    }
    const move = (pointerEvent: PointerEvent): void => {
      nextHeight = Math.max(150, Math.min(window.innerHeight - 150, startHeight + startY - pointerEvent.clientY))
      if (frame === null) frame = requestAnimationFrame(preview)
    }
    const finish = (): void => {
      if (frame !== null) cancelAnimationFrame(frame)
      panel.style.height = `${nextHeight}px`
      setHeight(Math.round(nextHeight))
      localStorage.setItem('myrepos:terminal-height', String(Math.round(nextHeight)))
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  return (
    <section
      ref={panelRef}
      className="terminal-panel"
      data-visible={visible || undefined}
      style={{ height: visible ? height : 0 }}
      aria-label="Integrated terminal"
    >
      <div className="terminal-resize-handle" onPointerDown={beginResize}><span /></div>
      <header className="terminal-toolbar">
        <div className="terminal-tabs" role="tablist" aria-label="Terminal sessions">
          {sessions.map((session, index) => (
            <button
              type="button"
              className="terminal-tab"
              data-active={session.id === activeId || undefined}
              data-exited={session.status === 'exited' || undefined}
              role="tab"
              aria-selected={session.id === activeId}
              title={session.cwd}
              key={session.id}
              onClick={() => setActiveId(session.id)}
            >
              {session.kind === 'ssh' ? <IconServer2 size={14} /> : <IconTerminal2 size={14} />}
              <span>{index + 1}: {session.title}</span>
              {session.status === 'exited' && <small>{session.exitCode ?? 'done'}</small>}
              <IconX
                className="terminal-tab-close"
                size={13}
                aria-label={`Close ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  void closeSession(session.id)
                }}
              />
            </button>
          ))}
        </div>
        <div className="terminal-actions">
          <Select
            className="terminal-profile-select"
            size="xs"
            value={selectedProfile}
            allowDeselect={false}
            aria-label="Terminal profile"
            data={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
            onChange={setSelectedProfile}
          />
          <Tooltip label="New terminal (Ctrl+Shift+`)">
            <ActionIcon size="sm" variant="subtle" color="gray" loading={loading}
              aria-label="New terminal" onClick={() => void createSession()}>
              <IconPlus size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Search terminal (Ctrl+Shift+F)">
            <ActionIcon size="sm" variant={searchVisible ? 'light' : 'subtle'} color="gray"
              aria-label="Search terminal" onClick={() => setSearchVisible((value) => !value)}>
              <IconSearch size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Copy selection">
            <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Copy terminal selection"
              disabled={!activeSession} onClick={() => void controllerForActive()?.copy()}>
              <IconCopy size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Paste">
            <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Paste into terminal"
              disabled={!activeSession} onClick={() => void controllerForActive()?.paste()}>
              <IconClipboard size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={splitPair ? 'Close split view' : 'Split terminal'}>
            <ActionIcon size="sm" variant={splitPair ? 'light' : 'subtle'} color="gray"
              aria-label={splitPair ? 'Close split terminal view' : 'Split terminal'}
              disabled={!activeSession} onClick={() => void toggleSplit()}>
              <IconColumns2 size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Restart terminal">
            <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Restart terminal"
              disabled={!activeSession} onClick={() => void restartSession()}>
              <IconRefresh size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Clear terminal">
            <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Clear terminal"
              disabled={!activeSession} onClick={() => controllerForActive()?.clear()}>
              <IconTrash size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Kill terminal">
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="Kill terminal"
              disabled={!activeSession} onClick={() => activeSession && void closeSession(activeSession.id)}>
              <IconPlayerStop size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Hide terminal (Ctrl+`)">
            <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Hide terminal" onClick={onClose}>
              <IconX size={15} />
            </ActionIcon>
          </Tooltip>
        </div>
      </header>
      {searchVisible && (
        <div className="terminal-search">
          <TextInput
            size="xs"
            value={search}
            autoFocus
            placeholder="Search terminal output"
            leftSection={<IconSearch size={14} />}
            onChange={(event) => {
              setSearch(event.currentTarget.value)
              if (event.currentTarget.value) controllerForActive()?.findNext(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && search) {
                if (event.shiftKey) controllerForActive()?.findPrevious(search)
                else controllerForActive()?.findNext(search)
              }
              if (event.key === 'Escape') {
                setSearchVisible(false)
                controllerForActive()?.focus()
              }
            }}
          />
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Previous match"
            onClick={() => search && controllerForActive()?.findPrevious(search)}><IconChevronUp size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Next match"
            onClick={() => search && controllerForActive()?.findNext(search)}><IconChevronDown size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Close search"
            onClick={() => setSearchVisible(false)}><IconX size={14} /></ActionIcon>
        </div>
      )}
      {error && <div className="terminal-error"><Text size="xs">{error}</Text></div>}
      {loading && sessions.length === 0 && <div className="terminal-empty"><Loader size="sm" /></div>}
      {!loading && sessions.length === 0 && !error && (
        <button className="terminal-empty terminal-empty-action" type="button" onClick={() => void createSession()}>
          <IconTerminal2 size={24} />
          <span>Create terminal</span>
        </button>
      )}
      <div className="terminal-viewports" data-split={splitPair || undefined}>
        {sessions.map((session) => (
          <TerminalViewport
            key={session.id}
            session={session}
            active={visible && (splitPair
              ? splitPair.includes(session.id)
              : session.id === activeId)}
            pane={splitPair?.[0] === session.id
              ? 'primary'
              : splitPair?.[1] === session.id ? 'secondary' : null}
            onActivate={setActiveId}
            onSearchRequest={() => setSearchVisible(true)}
            onReady={(id, controller) => {
              if (controller) controllersRef.current.set(id, controller)
              else controllersRef.current.delete(id)
            }}
          />
        ))}
      </div>
    </section>
  )
}
