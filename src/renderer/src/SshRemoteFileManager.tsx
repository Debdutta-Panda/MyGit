import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { ActionIcon, Badge, Button, Group, Loader, Menu, Modal, Progress, Text, TextInput, Tooltip } from '@mantine/core'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconCopy,
  IconClipboard,
  IconCut,
  IconDeviceFloppy,
  IconDownload,
  IconEye,
  IconFile,
  IconFilePlus,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFolderUp,
  IconHome,
  IconLock,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconArrowsSort,
  IconSortAscending,
  IconSortDescending,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { marked } from 'marked'
import type {
  SshConnection,
  SshDirectoryListing,
  SshRemoteEntry,
  SshRemoteFileContent,
  SshTransferProgress,
} from '../../shared/desktop-api'
import { SshSnippetRunner } from './SshSnippetRunner'
import { readSshScripts, readSshSnippets, type SshSavedCommandTemplate } from './ssh-snippets-store'

const RemoteMonaco = lazy(async () => ({
  default: (await import('./ReadOnlyMonaco')).ReadOnlyMonaco,
}))

interface OpenRemoteFile {
  remote: SshRemoteFileContent
  draft: string
  dirty: boolean
  saving: boolean
  error: string | null
}

type MutationKind = 'create-file' | 'create-folder' | 'rename' | 'permissions' | 'delete'

interface MutationDialog {
  kind: MutationKind
  target: SshRemoteEntry | null
  parentPath: string
  value: string
}

type RemoteSortKey = 'server' | 'name' | 'type' | 'size' | 'modified' | 'permissions'
type RemoteSortDirection = 'asc' | 'desc'

const sortRemoteEntries = (
  entries: SshRemoteEntry[],
  key: RemoteSortKey,
  direction: RemoteSortDirection,
): SshRemoteEntry[] => {
  if (key === 'server') return entries
  const factor = direction === 'asc' ? 1 : -1
  return [...entries].sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
    let result = 0
    if (key === 'size') result = left.size - right.size
    else if (key === 'modified') result = (left.modifiedAt ?? 0) - (right.modifiedAt ?? 0)
    else if (key === 'type') result = left.type.localeCompare(right.type)
    else if (key === 'permissions') result = left.permissions.localeCompare(right.permissions)
    else result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    return (result || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })) * factor
  })
}

const messageFor = (reason: unknown): string =>
  reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)

const formatBytes = (value: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}

const parentPath = (path: string): string | null => {
  if (path === '/') return null
  const normalized = path.replace(/\/$/, '')
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

const normalizedPermissions = (value: string): string | null => {
  const trimmed = value.trim()
  if (!/^[0-7]{3,4}$/.test(trimmed)) return null
  return trimmed.length === 3 ? `0${trimmed}` : trimmed
}

const permissionWords = (digit: number): string => {
  const words: string[] = []
  if (digit & 4) words.push('read')
  if (digit & 2) words.push('write')
  if (digit & 1) words.push('execute')
  return words.length ? words.join(', ') : 'no access'
}

function PermissionEditor({
  value,
  onChange,
  inputRef,
  onSubmit,
}: {
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  onSubmit: () => void
}) {
  const normalized = normalizedPermissions(value)
  const digits = normalized?.slice(-3).split('').map(Number) ?? [0, 0, 0]
  const subjects = [
    { key: 'owner', label: 'Owner', hint: 'you' },
    { key: 'group', label: 'Group', hint: '' },
    { key: 'others', label: 'Others', hint: 'everyone' },
  ] as const
  const permissions = [
    { label: 'Read', bit: 4 },
    { label: 'Write', bit: 2 },
    { label: 'Execute', bit: 1 },
  ] as const
  const presets = [
    ['0644', 'Regular file'],
    ['0755', 'Public folder'],
    ['0600', 'Private file'],
    ['0700', 'Private folder'],
  ] as const

  const toggle = (subjectIndex: number, bit: number, checked: boolean): void => {
    const next = [...digits]
    next[subjectIndex] = checked ? next[subjectIndex] | bit : next[subjectIndex] & ~bit
    onChange(`${normalized?.[0] ?? '0'}${next.join('')}`)
  }
  const groupWritable = Boolean(digits[1] & 2)
  const worldWritable = Boolean(digits[2] & 2)

  return (
    <div className="remote-permission-editor">
      <div className="remote-permission-label">Quick presets</div>
      <div className="remote-permission-presets">
        {presets.map(([mode, label]) => (
          <button type="button" key={mode} data-active={normalized === mode || undefined}
            onClick={() => onChange(mode)}>{label} <strong>{mode}</strong></button>
        ))}
      </div>

      <div className="remote-permission-label">Access matrix</div>
      <div className="remote-permission-matrix">
        <span className="head" />
        {permissions.map((permission) => <span className="head" key={permission.bit}>{permission.label}</span>)}
        <span className="head total">Sum</span>
        {subjects.map((subject, subjectIndex) => (
          <div className="remote-permission-row" key={subject.key}>
            <span className="subject">{subject.label}{subject.hint && <small>{subject.hint}</small>}</span>
            {permissions.map((permission) => (
              <label key={permission.bit}
                title={`${subject.label}: ${permission.label.toLowerCase()} contributes ${permission.bit}`}>
                <input type="checkbox" checked={Boolean(digits[subjectIndex] & permission.bit)}
                  aria-label={`${subject.label} ${permission.label}; value ${permission.bit}`}
                  onChange={(event) => toggle(subjectIndex, permission.bit, event.currentTarget.checked)} />
                <span>{permission.bit}</span>
              </label>
            ))}
            <output className="remote-permission-sum"
              title={`${permissions.filter(({ bit }) => Boolean(digits[subjectIndex] & bit)).map(({ bit }) => bit).join(' + ') || '0'} = ${digits[subjectIndex]}`}>
              <span>{digits[subjectIndex]}</span>
            </output>
          </div>
        ))}
      </div>

      <div className="remote-permission-bottom">
        <div className="remote-permission-summary">
          {subjects.map((subject, index) => (
            <span key={subject.key}><strong>{subject.label}:</strong> {permissionWords(digits[index])}</span>
          ))}
        </div>
        <label className="remote-permission-raw">Octal value
          <input ref={inputRef} autoFocus value={value} maxLength={4} inputMode="numeric"
            aria-invalid={!normalized || undefined} onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDown={(event) => event.key === 'Enter' && normalized && onSubmit()} />
        </label>
      </div>
      {!normalized && <div className="remote-permission-invalid">Use three or four digits from 0 to 7.</div>}
      {(groupWritable || worldWritable) && (
        <div className="remote-permission-warning">&#9888; <span>{worldWritable
          ? 'Everyone can modify this item. Use world-write only when absolutely required.'
          : 'Members of the file group can modify this item.'}</span></div>
      )}
    </div>
  )
}

const safePreviewDocument = (body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>html{color-scheme:dark}body{margin:24px;background:#0e141a;color:#d8e1eb;font:14px/1.65 system-ui,sans-serif}pre,code{font-family:Consolas,monospace}pre{white-space:pre-wrap;background:#151e27;padding:12px;border-radius:6px}a{color:#63e6be}table{border-collapse:collapse}td,th{border:1px solid #34414e;padding:6px 9px}img{max-width:100%}</style></head><body>${body}</body></html>`

function TreeNode({
  entry,
  depth,
  currentPath,
  listings,
  expanded,
  loadingPaths,
  onOpenDirectory,
  onOpenFile,
  onContextMenu,
  sortEntries,
  draggedPath,
  dropTargetPath,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  entry: SshRemoteEntry
  depth: number
  currentPath: string | null
  listings: Map<string, SshDirectoryListing>
  expanded: Set<string>
  loadingPaths: Set<string>
  onOpenDirectory: (path: string, toggle: boolean) => void
  onOpenFile: (entry: SshRemoteEntry) => void
  onContextMenu: (event: ReactMouseEvent, entry: SshRemoteEntry) => void
  sortEntries: (entries: SshRemoteEntry[]) => SshRemoteEntry[]
  draggedPath: string | null
  dropTargetPath: string | null
  onDragStart: (event: ReactDragEvent, entry: SshRemoteEntry) => void
  onDragEnd: () => void
  onDragOver: (event: ReactDragEvent, entry: SshRemoteEntry) => void
  onDrop: (event: ReactDragEvent, entry: SshRemoteEntry) => void
}) {
  const directory = entry.type === 'directory'
  const open = directory && expanded.has(entry.path)
  const children = sortEntries(listings.get(entry.path)?.entries ?? [])
  return (
    <>
      <button
        type="button"
        className="ssh-tree-row"
        data-selected={currentPath === entry.path || undefined}
        data-dragging={draggedPath === entry.path || undefined}
        data-drop-target={dropTargetPath === entry.path || undefined}
        draggable={depth > 0}
        style={{ paddingLeft: 7 + depth * 13 }}
        title={entry.path}
        onClick={() => directory ? onOpenDirectory(entry.path, true) : onOpenFile(entry)}
        onContextMenu={(event) => onContextMenu(event, entry)}
        onDragStart={(event) => onDragStart(event, entry)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => directory && onDragOver(event, entry)}
        onDrop={(event) => directory && onDrop(event, entry)}
      >
        <span className="ssh-tree-chevron">
          {loadingPaths.has(entry.path) ? <Loader size={11} /> : directory
            ? open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} /> : null}
        </span>
        {directory ? open ? <IconFolderOpen size={15} /> : <IconFolder size={15} /> : <IconFile size={14} />}
        <span>{entry.name}</span>
      </button>
      {open && children.map((child) => (
        <TreeNode key={child.path} entry={child} depth={depth + 1} currentPath={currentPath}
          listings={listings} expanded={expanded} loadingPaths={loadingPaths}
          onOpenDirectory={onOpenDirectory} onOpenFile={onOpenFile} onContextMenu={onContextMenu}
          sortEntries={sortEntries} draggedPath={draggedPath} dropTargetPath={dropTargetPath}
          onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop} />
      ))}
    </>
  )
}

export function SshRemoteFileManager({ connection, onOpenTerminal }: {
  connection: SshConnection
  onOpenTerminal: (command?: string) => void
}) {
  const [listings, setListings] = useState(new Map<string, SshDirectoryListing>())
  const [rootPath, setRootPath] = useState<string | null>(null)
  const homePathRef = useRef<string | null>(null)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(new Set<string>())
  const [loadingPaths, setLoadingPaths] = useState(new Set<string>())
  const [pathInput, setPathInput] = useState('')
  const [filter, setFilter] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [files, setFiles] = useState<OpenRemoteFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'editor' | 'preview'>('editor')
  const [error, setError] = useState<string | null>(null)
  const [pickerMode, setPickerMode] = useState<'file' | 'folder' | null>(null)
  const [pickerListing, setPickerListing] = useState<SshDirectoryListing | null>(null)
  const [pickerPath, setPickerPath] = useState('~')
  const [pickerFilter, setPickerFilter] = useState('')
  const [pickerPrefix, setPickerPrefix] = useState('')
  const [pickerSelection, setPickerSelection] = useState<SshRemoteEntry | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)
  const pickerRequestRef = useRef(0)
  const pickerCommittedPathRef = useRef<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: SshRemoteEntry } | null>(null)
  const [snippets, setSnippets] = useState<SshSavedCommandTemplate[]>(() => readSshSnippets(connection.id))
  const [scripts, setScripts] = useState<SshSavedCommandTemplate[]>(() => readSshScripts(connection.id))
  const [snippetRun, setSnippetRun] = useState<{ snippet: SshSavedCommandTemplate; path: string } | null>(null)
  const [mutation, setMutation] = useState<MutationDialog | null>(null)
  const [mutating, setMutating] = useState(false)
  const [clipboard, setClipboard] = useState<{ entry: SshRemoteEntry; mode: 'copy' | 'move' } | null>(null)
  const [transfer, setTransfer] = useState<SshTransferProgress | null>(null)
  const mutationInputRef = useRef<HTMLInputElement>(null)
  const [sortKey, setSortKey] = useState<RemoteSortKey>(() =>
    (window.localStorage.getItem('myrepos:ssh-explorer-sort') as RemoteSortKey | null) ?? 'server')
  const [sortDirection, setSortDirection] = useState<RemoteSortDirection>(() =>
    window.localStorage.getItem('myrepos:ssh-explorer-sort-direction') === 'desc' ? 'desc' : 'asc')
  const [draggedEntry, setDraggedEntry] = useState<SshRemoteEntry | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

  useEffect(() => {
    window.localStorage.setItem('myrepos:ssh-explorer-sort', sortKey)
    window.localStorage.setItem('myrepos:ssh-explorer-sort-direction', sortDirection)
  }, [sortKey, sortDirection])

  const loadListing = async (path?: string | null, force = false): Promise<SshDirectoryListing | null> => {
    if (!window.desktop) return null
    const key = path ?? '.'
    if (!force && path && listings.has(path)) return listings.get(path) ?? null
    setLoadingPaths((current) => new Set(current).add(key))
    try {
      const listing = await window.desktop.ssh.listDirectory(connection.id, path)
      setListings((current) => {
        const next = new Map(current)
        next.set(listing.path, listing)
        return next
      })
      return listing
    } catch (reason) {
      setError(messageFor(reason))
      return null
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current)
        next.delete(key)
        if (path) next.delete(path)
        return next
      })
    }
  }

  const navigate = async (path?: string | null, record = true): Promise<void> => {
    const listing = await loadListing(path)
    if (!listing) return
    setCurrentPath(listing.path)
    setPathInput(listing.path)
    setFilter('')
    setExpanded((current) => new Set(current).add(listing.path))
    if (!rootPath) setRootPath(listing.path)
    if (!homePathRef.current) homePathRef.current = listing.path
    if (record) {
      setHistory((current) => {
        const truncated = current.slice(0, historyIndex + 1)
        if (truncated.at(-1) === listing.path) return truncated
        const next = [...truncated, listing.path]
        setHistoryIndex(next.length - 1)
        return next
      })
    }
  }

  useEffect(() => {
    setListings(new Map())
    setRootPath(null)
    homePathRef.current = null
    setFiles([])
    setActiveFilePath(null)
    setHistory([])
    setHistoryIndex(-1)
  }, [connection.id])

  useEffect(() => {
    setSnippets(readSshSnippets(connection.id))
    setScripts(readSshScripts(connection.id))
  }, [connection.id])

  useEffect(() => {
    if (!window.desktop) return
    return window.desktop.ssh.onTransferProgress((progress) => {
      setTransfer(progress)
      if (progress.status === 'completed' || progress.status === 'cancelled') {
        window.setTimeout(() => setTransfer((current) => current?.id === progress.id ? null : current), 2_500)
      }
    })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [contextMenu])

  const openWorkspaceFolder = async (path: string): Promise<void> => {
    const listing = await loadListing(path, true)
    if (!listing) return
    setRootPath(listing.path)
    homePathRef.current = listing.path
    setCurrentPath(listing.path)
    setPathInput(listing.path)
    setFilter('')
    setExpanded(new Set([listing.path]))
    setHistory([listing.path])
    setHistoryIndex(0)
    setPickerMode(null)
  }

  const loadPicker = async (path?: string | null): Promise<void> => {
    if (!window.desktop) return
    const request = ++pickerRequestRef.current
    setPickerLoading(true)
    setPickerSelection(null)
    try {
      const listing = await window.desktop.ssh.listDirectory(connection.id, path)
      if (request !== pickerRequestRef.current) return
      setPickerListing(listing)
      pickerCommittedPathRef.current = listing.path
      setPickerPath(listing.path)
      setPickerPrefix('')
      setPickerFilter('')
    } catch (reason) {
      if (request === pickerRequestRef.current) setError(messageFor(reason))
    } finally {
      if (request === pickerRequestRef.current) setPickerLoading(false)
    }
  }

  const showPicker = (mode: 'file' | 'folder'): void => {
    setPickerMode(mode)
    setPickerListing(null)
    setPickerSelection(null)
    setPickerPath(homePathRef.current ?? '~')
  }

  useEffect(() => {
    if (!pickerMode || !window.desktop) return
    const typedPath = pickerPath.trim()
    if (!typedPath) return
    if (pickerCommittedPathRef.current === typedPath) {
      pickerCommittedPathRef.current = null
      return
    }
    const timer = window.setTimeout(() => {
      const normalized = typedPath.replace(/\\/g, '/')
      let directoryPath: string
      let prefix: string
      if (normalized === '~' || normalized === '/') {
        directoryPath = normalized
        prefix = ''
      } else if (normalized.endsWith('/')) {
        directoryPath = normalized
        prefix = ''
      } else {
        const separator = normalized.lastIndexOf('/')
        if (separator < 0) {
          directoryPath = '.'
          prefix = normalized
        } else if (separator === 0) {
          directoryPath = '/'
          prefix = normalized.slice(1)
        } else {
          directoryPath = normalized.slice(0, separator)
          prefix = normalized.slice(separator + 1)
        }
      }
      const request = ++pickerRequestRef.current
      setPickerLoading(true)
      setPickerSelection(null)
      void window.desktop!.ssh.listDirectory(connection.id, directoryPath).then((listing) => {
        if (request !== pickerRequestRef.current) return
        setPickerListing(listing)
        setPickerPrefix(prefix)
      }).catch(() => {
        if (request !== pickerRequestRef.current) return
        setPickerListing(null)
        setPickerPrefix(prefix)
      }).finally(() => {
        if (request === pickerRequestRef.current) setPickerLoading(false)
      })
    }, 220)
    return () => window.clearTimeout(timer)
  }, [pickerMode, pickerPath, connection.id])

  const openDirectory = (path: string, toggle: boolean): void => {
    const currentlyOpen = expanded.has(path)
    if (toggle && currentlyOpen) {
      setExpanded((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
      setCurrentPath(path)
      setPathInput(path)
      return
    }
    void navigate(path)
  }

  const openFile = async (entry: SshRemoteEntry): Promise<void> => {
    const existing = files.find((file) => file.remote.path === entry.path)
    if (existing) {
      setActiveFilePath(entry.path)
      return
    }
    if (!window.desktop || openingPath) return
    setOpeningPath(entry.path)
    setError(null)
    try {
      const remote = await window.desktop.ssh.readFile(connection.id, entry.path)
      setFiles((current) => [...current, {
        remote,
        draft: remote.content ?? '',
        dirty: false,
        saving: false,
        error: null,
      }])
      setActiveFilePath(entry.path)
      setViewMode(remote.presentation === 'text' ? 'editor' : 'preview')
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setOpeningPath(null)
    }
  }

  const acceptPicker = (): void => {
    if (pickerMode === 'folder' && pickerListing) {
      const selectedPath = pickerSelection?.type === 'directory'
        ? pickerSelection.path
        : pickerListing.path
      void openWorkspaceFolder(selectedPath)
      return
    }
    if (pickerMode === 'file' && pickerSelection?.type !== 'directory') {
      setPickerMode(null)
      void openFile(pickerSelection)
    }
  }

  const activeFile = files.find((file) => file.remote.path === activeFilePath) ?? null

  const updateActive = (update: (file: OpenRemoteFile) => OpenRemoteFile): void => {
    if (!activeFilePath) return
    setFiles((current) => current.map((file) => file.remote.path === activeFilePath ? update(file) : file))
  }

  const saveActive = async (): Promise<void> => {
    if (!window.desktop || !activeFile || !activeFile.dirty || activeFile.saving) return
    updateActive((file) => ({ ...file, saving: true, error: null }))
    try {
      const remote = await window.desktop.ssh.writeFile({
        connectionId: connection.id,
        path: activeFile.remote.path,
        content: activeFile.draft,
        expectedModifiedAt: activeFile.remote.modifiedAt,
        expectedEtag: activeFile.remote.etag,
      })
      updateActive((file) => ({ ...file, remote, draft: remote.content ?? file.draft, dirty: false, saving: false, error: null }))
      if (currentPath) void loadListing(currentPath, true)
    } catch (reason) {
      updateActive((file) => ({ ...file, saving: false, error: messageFor(reason) }))
    }
  }

  const reloadActive = async (): Promise<void> => {
    if (!window.desktop || !activeFile) return
    try {
      const remote = await window.desktop.ssh.readFile(connection.id, activeFile.remote.path)
      updateActive((file) => ({ ...file, remote, draft: remote.content ?? '', dirty: false, error: null }))
    } catch (reason) {
      updateActive((file) => ({ ...file, error: messageFor(reason) }))
    }
  }

  const closeFile = (path: string): void => {
    const target = files.find((file) => file.remote.path === path)
    if (target?.dirty && !window.confirm(`Discard unsaved changes to ${target.remote.name}?`)) return
    setFiles((current) => {
      const index = current.findIndex((file) => file.remote.path === path)
      const next = current.filter((file) => file.remote.path !== path)
      if (activeFilePath === path) setActiveFilePath(next[Math.max(0, index - 1)]?.remote.path ?? null)
      return next
    })
  }

  const showContextMenu = (event: ReactMouseEvent, entry: SshRemoteEntry): void => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 390),
      y: Math.min(event.clientY, window.innerHeight - 225),
      entry,
    })
  }

  const startMutation = (
    kind: MutationKind,
    target: SshRemoteEntry | null = null,
    parent = currentPath,
  ): void => {
    const resolvedParent = target?.type === 'directory' && kind.startsWith('create-')
      ? target.path
      : parent ?? (target ? parentPath(target.path) ?? '/' : homePathRef.current ?? '~')
    setContextMenu(null)
    setMutation({
      kind,
      target,
      parentPath: resolvedParent,
      value: kind === 'rename'
        ? target?.name ?? ''
        : kind === 'permissions'
          ? target?.permissions ?? '0644'
          : '',
    })
  }

  const replacePathPrefix = (path: string | null, before: string, after: string): string | null => {
    if (!path || (path !== before && !path.startsWith(`${before}/`))) return path
    return after + path.slice(before.length)
  }

  const refreshAfterMutation = async (path: string): Promise<void> => {
    await loadListing(path, true)
  }

  const runMutation = async (): Promise<void> => {
    if (!window.desktop || !mutation) return
    setMutating(true)
    setError(null)
    try {
      if (mutation.kind === 'create-file' || mutation.kind === 'create-folder') {
        const type = mutation.kind === 'create-file' ? 'file' : 'directory'
        const result = await window.desktop.ssh.createEntry(
          connection.id, mutation.parentPath, mutation.value, type,
        )
        await refreshAfterMutation(result.parentPath)
        if (type === 'file') {
          await openFile({
            name: result.path.split('/').at(-1) ?? result.path,
            path: result.path,
            type: 'file',
            size: 0,
            modifiedAt: null,
            permissions: '0644',
          })
        } else {
          setExpanded((current) => new Set(current).add(mutation.parentPath))
        }
      } else if (mutation.kind === 'rename' && mutation.target) {
        const before = mutation.target.path
        const result = await window.desktop.ssh.renameEntry(connection.id, before, mutation.value)
        const after = result.path
        setFiles((current) => current.map((file) => {
          const path = replacePathPrefix(file.remote.path, before, after)!
          return path === file.remote.path ? file : {
            ...file,
            remote: { ...file.remote, path, name: path.split('/').at(-1) ?? path },
          }
        }))
        setActiveFilePath((current) => replacePathPrefix(current, before, after))
        setCurrentPath((current) => replacePathPrefix(current, before, after))
        setRootPath((current) => replacePathPrefix(current, before, after))
        setPathInput((current) => replacePathPrefix(current, before, after) ?? '')
        setExpanded((current) => new Set(Array.from(current, (path) =>
          replacePathPrefix(path, before, after) ?? path)))
        setListings((current) => {
          const next = new Map(current)
          for (const key of next.keys()) {
            if (key === before || key.startsWith(`${before}/`)) next.delete(key)
          }
          return next
        })
        await refreshAfterMutation(result.parentPath)
        if (mutation.target.type === 'directory') await loadListing(after, true)
      } else if (mutation.kind === 'permissions' && mutation.target) {
        const permissions = normalizedPermissions(mutation.value)
        if (!permissions) throw new Error('Permissions must contain three or four octal digits.')
        const result = await window.desktop.ssh.chmodEntry(
          connection.id, mutation.target.path, permissions,
        )
        await refreshAfterMutation(result.parentPath)
      } else if (mutation.kind === 'delete' && mutation.target) {
        const target = mutation.target.path
        const result = await window.desktop.ssh.deleteEntry(connection.id, target)
        setFiles((current) => current.filter((file) =>
          file.remote.path !== target && !file.remote.path.startsWith(`${target}/`)))
        setActiveFilePath((current) => current === target || current?.startsWith(`${target}/`) ? null : current)
        setListings((current) => {
          const next = new Map(current)
          for (const key of next.keys()) {
            if (key === target || key.startsWith(`${target}/`)) next.delete(key)
          }
          return next
        })
        if (rootPath === target) {
          setRootPath(null)
          setCurrentPath(null)
          setPathInput('')
        } else if (currentPath === target || currentPath?.startsWith(`${target}/`)) {
          await navigate(result.parentPath)
        }
        await refreshAfterMutation(result.parentPath)
      }
      setMutation(null)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setMutating(false)
    }
  }

  const pasteInto = async (targetDirectory: string): Promise<void> => {
    if (!window.desktop || !clipboard || mutating) return
    setMutating(true)
    setError(null)
    const source = clipboard.entry.path
    const sourceParent = parentPath(source) ?? '/'
    try {
      const result = clipboard.mode === 'copy'
        ? await window.desktop.ssh.copyEntry(connection.id, source, targetDirectory)
        : await window.desktop.ssh.moveEntry(connection.id, source, targetDirectory)
      await refreshAfterMutation(result.parentPath)
      if (sourceParent !== result.parentPath) await refreshAfterMutation(sourceParent)
      if (clipboard.mode === 'move') {
        const target = result.path
        setFiles((current) => current.map((file) => {
          const path = replacePathPrefix(file.remote.path, source, target)!
          return path === file.remote.path ? file : {
            ...file,
            remote: { ...file.remote, path, name: path.split('/').at(-1) ?? path },
          }
        }))
        setActiveFilePath((current) => replacePathPrefix(current, source, target))
        setCurrentPath((current) => replacePathPrefix(current, source, target))
        setRootPath((current) => replacePathPrefix(current, source, target))
        setPathInput((current) => replacePathPrefix(current, source, target) ?? '')
        setExpanded((current) => new Set(Array.from(current, (path) =>
          replacePathPrefix(path, source, target) ?? path)))
        setListings((current) => {
          const next = new Map(current)
          for (const key of next.keys()) {
            if (key === source || key.startsWith(`${source}/`)) next.delete(key)
          }
          return next
        })
        if (clipboard.entry.type === 'directory') await loadListing(target, true)
        setClipboard(null)
      }
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setMutating(false)
    }
  }

  const dragStart = (event: ReactDragEvent, entry: SshRemoteEntry): void => {
    if (entry.path === rootPath) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-myrepos-remote-path', entry.path)
    setDraggedEntry(entry)
  }

  const canDropInto = (entry: SshRemoteEntry, targetDirectory: string): boolean =>
    entry.path !== targetDirectory
    && parentPath(entry.path) !== targetDirectory
    && !targetDirectory.startsWith(`${entry.path}/`)

  const dragOver = (event: ReactDragEvent, target: SshRemoteEntry): void => {
    if (!draggedEntry || target.type !== 'directory' || !canDropInto(draggedEntry, target.path)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetPath(target.path)
  }

  const dragEnd = (): void => {
    setDraggedEntry(null)
    setDropTargetPath(null)
  }

  const dropInto = async (event: ReactDragEvent, target: SshRemoteEntry): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    const sourceEntry = draggedEntry
    dragEnd()
    if (!window.desktop || !sourceEntry || !canDropInto(sourceEntry, target.path) || mutating) return
    setMutating(true)
    setError(null)
    const source = sourceEntry.path
    const sourceParent = parentPath(source) ?? '/'
    try {
      const result = await window.desktop.ssh.moveEntry(connection.id, source, target.path)
      const movedPath = result.path
      await refreshAfterMutation(result.parentPath)
      if (sourceParent !== result.parentPath) await refreshAfterMutation(sourceParent)
      setFiles((current) => current.map((file) => {
        const path = replacePathPrefix(file.remote.path, source, movedPath)!
        return path === file.remote.path ? file : {
          ...file,
          remote: { ...file.remote, path, name: path.split('/').at(-1) ?? path },
        }
      }))
      setActiveFilePath((current) => replacePathPrefix(current, source, movedPath))
      setCurrentPath((current) => replacePathPrefix(current, source, movedPath))
      setRootPath((current) => replacePathPrefix(current, source, movedPath))
      setPathInput((current) => replacePathPrefix(current, source, movedPath) ?? '')
      setExpanded((current) => new Set(Array.from(current, (path) =>
        replacePathPrefix(path, source, movedPath) ?? path)))
      setListings((current) => {
        const next = new Map(current)
        for (const key of next.keys()) {
          if (key === source || key.startsWith(`${source}/`)) next.delete(key)
        }
        return next
      })
      if (sourceEntry.type === 'directory') await loadListing(movedPath, true)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setMutating(false)
    }
  }

  const uploadInto = async (targetDirectory: string): Promise<void> => {
    if (!window.desktop) return
    setError(null)
    try {
      const result = await window.desktop.ssh.uploadFiles(connection.id, targetDirectory)
      if (result) await refreshAfterMutation(targetDirectory)
    } catch (reason) {
      const message = messageFor(reason)
      if (!message.toLocaleLowerCase().includes('cancelled')) setError(message)
    }
  }

  const downloadEntry = async (entry: SshRemoteEntry): Promise<void> => {
    if (!window.desktop || entry.type === 'directory') return
    setError(null)
    try {
      await window.desktop.ssh.downloadFile(connection.id, entry.path)
    } catch (reason) {
      const message = messageFor(reason)
      if (!message.toLocaleLowerCase().includes('cancelled')) setError(message)
    }
  }

  const currentListing = currentPath ? listings.get(currentPath) : null
  const visibleEntries = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase()
    const filtered = (currentListing?.entries ?? []).filter((entry) =>
      !needle || entry.name.toLocaleLowerCase().includes(needle))
    return sortRemoteEntries(filtered, sortKey, sortDirection)
  }, [currentListing, filter, sortKey, sortDirection])
  const orderedEntries = (entries: SshRemoteEntry[]): SshRemoteEntry[] =>
    sortRemoteEntries(entries, sortKey, sortDirection)
  const rootEntry: SshRemoteEntry | null = rootPath ? {
    name: rootPath === '/' ? '/' : rootPath.split('/').at(-1) || rootPath,
    path: rootPath,
    type: 'directory',
    size: 0,
    modifiedAt: null,
    permissions: '',
  } : null

  const moveHistory = (offset: number): void => {
    const nextIndex = historyIndex + offset
    const path = history[nextIndex]
    if (!path) return
    setHistoryIndex(nextIndex)
    void navigate(path, false)
  }

  const previewDocument = activeFile?.remote.presentation === 'text'
    ? safePreviewDocument(activeFile.remote.name.toLowerCase().endsWith('.md')
      ? marked.parse(activeFile.draft) as string
      : `<pre>${activeFile.draft.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`)
    : null
  const pickerEntries = (pickerListing?.entries ?? []).filter((entry) => {
    if (pickerMode === 'folder' && entry.type !== 'directory') return false
    const name = entry.name.toLocaleLowerCase()
    return (!pickerPrefix || name.startsWith(pickerPrefix.toLocaleLowerCase()))
      && (!pickerFilter || name.includes(pickerFilter.toLocaleLowerCase()))
  })

  return (
    <section className="remote-explorer">
      <div className="remote-explorer-toolbar">
        <Group gap={2} wrap="nowrap">
          <Tooltip label="Back"><ActionIcon variant="subtle" color="gray" disabled={historyIndex <= 0}
            onClick={() => moveHistory(-1)}><IconArrowBackUp size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Forward"><ActionIcon variant="subtle" color="gray" disabled={historyIndex >= history.length - 1}
            onClick={() => moveHistory(1)}><IconArrowForwardUp size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Parent"><ActionIcon variant="subtle" color="gray" disabled={!currentPath || currentPath === '/'}
            onClick={() => void navigate(currentPath ? parentPath(currentPath) : null)}><IconFolderUp size={16} /></ActionIcon></Tooltip>
          <Tooltip label="Home"><ActionIcon variant="subtle" color="gray"
            onClick={() => void navigate(homePathRef.current)}><IconHome size={16} /></ActionIcon></Tooltip>
        </Group>
        <Group gap={4} wrap="nowrap" className="remote-open-actions">
          <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconFolderPlus size={14} />}
            onClick={() => showPicker('folder')}>Open folder</Button>
          <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconFilePlus size={14} />}
            onClick={() => showPicker('file')}>Open file</Button>
          <Tooltip label="New file">
            <ActionIcon size="sm" variant="subtle" color="gray"
              onClick={() => startMutation('create-file')} aria-label="Create remote file">
              <IconFilePlus size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="New folder">
            <ActionIcon size="sm" variant="subtle" color="gray"
              onClick={() => startMutation('create-folder')} aria-label="Create remote folder">
              <IconFolderPlus size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={clipboard ? `Paste ${clipboard.entry.name}` : 'Clipboard is empty'}>
            <ActionIcon size="sm" variant="subtle" color="gray" disabled={!currentPath || !clipboard}
              loading={mutating && Boolean(clipboard)} onClick={() => currentPath && void pasteInto(currentPath)}
              aria-label="Paste remote entry">
              <IconClipboard size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Upload files">
            <ActionIcon size="sm" variant="subtle" color="gray" disabled={!currentPath}
              onClick={() => currentPath && void uploadInto(currentPath)} aria-label="Upload remote files">
              <IconUpload size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <TextInput size="xs" value={pathInput} aria-label="Remote path" placeholder="Go to remote path"
          onChange={(event) => setPathInput(event.currentTarget.value)}
          onKeyDown={(event) => event.key === 'Enter' && void navigate(pathInput)} />
        <TextInput size="xs" value={filter} aria-label="Filter visible files" placeholder="Filter visible"
          leftSection={<IconSearch size={13} />} onChange={(event) => setFilter(event.currentTarget.value)} />
        <Menu position="bottom-end" shadow="md" width={170}>
          <Menu.Target>
            <ActionIcon variant="subtle" color={sortKey === 'server' ? 'gray' : 'teal'}
              title={`Sort: ${sortKey === 'server' ? 'server order' : sortKey}`} aria-label="Sort remote files">
              <IconArrowsSort size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Sort by</Menu.Label>
            {([['server', 'Server order'], ['name', 'Name'], ['type', 'Type'], ['modified', 'Modified'], ['size', 'Size'], ['permissions', 'Permissions']] as const).map(([value, label]) => (
              <Menu.Item key={value} color={sortKey === value ? 'teal' : undefined}
                onClick={() => setSortKey(value)}>{label}</Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <Tooltip label={sortDirection === 'asc' ? 'Ascending' : 'Descending'}>
          <ActionIcon variant="subtle" color="gray" disabled={sortKey === 'server'}
            onClick={() => setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')}
            aria-label="Reverse remote file sort">
            {sortDirection === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Refresh current folder"><ActionIcon variant="subtle" color="gray"
          loading={Boolean(currentPath && loadingPaths.has(currentPath))}
          onClick={() => currentPath && void loadListing(currentPath, true)}><IconRefresh size={16} /></ActionIcon></Tooltip>
      </div>

      {error && <div className="remote-explorer-error"><Text size="xs">{error}</Text><ActionIcon size="xs" variant="subtle" onClick={() => setError(null)}><IconX size={12} /></ActionIcon></div>}
      {transfer && (
        <div className="remote-transfer-bar" data-status={transfer.status}>
          <div>{transfer.direction === 'upload' ? <IconUpload size={15} /> : <IconDownload size={15} />}
            <Text size="xs" truncate>{transfer.name}</Text></div>
          <Progress size={5} value={transfer.totalBytes > 0 ? transfer.transferredBytes / transfer.totalBytes * 100 : 0} />
          <Text size="xs" c="dimmed">{formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.totalBytes)}</Text>
          <Text size="xs" fw={650}>{transfer.totalBytes > 0 ? `${Math.min(100, transfer.transferredBytes / transfer.totalBytes * 100).toFixed(0)}%` : '-'}</Text>
          {transfer.status === 'running' ? (
            <Button size="compact-xs" variant="subtle" color="red" onClick={() => void window.desktop?.ssh.cancelTransfer(transfer.id)}>Cancel</Button>
          ) : <Badge size="xs" color={transfer.status === 'completed' ? 'teal' : transfer.status === 'failed' ? 'red' : 'gray'}>{transfer.status}</Badge>}
        </div>
      )}

      <div className="remote-explorer-body">
        <aside className="remote-tree-pane">
          <div className="remote-pane-title"><span>REMOTE EXPLORER</span><Badge size="xs" variant="transparent" color="gray">SFTP</Badge></div>
          <div className="remote-tree-scroll">
            {rootEntry ? <TreeNode entry={rootEntry} depth={0} currentPath={currentPath} listings={listings}
              expanded={expanded} loadingPaths={loadingPaths} onOpenDirectory={openDirectory}
              onOpenFile={(entry) => void openFile(entry)} onContextMenu={showContextMenu}
              sortEntries={orderedEntries} draggedPath={draggedEntry?.path ?? null} dropTargetPath={dropTargetPath}
              onDragStart={dragStart} onDragEnd={dragEnd} onDragOver={dragOver}
              onDrop={(event, entry) => void dropInto(event, entry)} />
              : <div className="remote-tree-empty">No folder open</div>}
          </div>
        </aside>

        <main className="remote-content-pane">
          {files.length > 0 && (
            <div className="remote-file-tabs">
              {files.map((file) => (
                <button type="button" key={file.remote.path} data-active={activeFilePath === file.remote.path || undefined}
                  title={file.remote.path} onClick={() => setActiveFilePath(file.remote.path)}>
                  <IconFile size={13} /><span>{file.remote.name}{file.dirty ? ' *' : ''}</span>
                  <IconX size={12} onClick={(event) => { event.stopPropagation(); closeFile(file.remote.path) }} />
                </button>
              ))}
            </div>
          )}

          {activeFile ? (
            <div className="remote-file-workspace">
              <div className="remote-file-actions">
                <Text size="xs" c="dimmed" truncate>{activeFile.remote.path}</Text>
                <Group gap={4} wrap="nowrap">
                  {activeFile.remote.presentation === 'text' && (
                    <>
                      <Tooltip label="Editor"><ActionIcon size="sm" variant={viewMode === 'editor' ? 'light' : 'subtle'} color="gray"
                        onClick={() => setViewMode('editor')}><IconCode size={15} /></ActionIcon></Tooltip>
                      <Tooltip label="Preview"><ActionIcon size="sm" variant={viewMode === 'preview' ? 'light' : 'subtle'} color="gray"
                        onClick={() => setViewMode('preview')}><IconEye size={15} /></ActionIcon></Tooltip>
                    </>
                  )}
                  <Button size="compact-xs" leftSection={<IconDeviceFloppy size={14} />} loading={activeFile.saving}
                    disabled={!activeFile.dirty || !activeFile.remote.writable} onClick={() => void saveActive()}>Save</Button>
                </Group>
              </div>
              {activeFile.error && <div className="remote-file-error"><Text size="xs">{activeFile.error}</Text>
                <Button size="compact-xs" variant="light" color="yellow" onClick={() => void reloadActive()}>Reload server copy</Button></div>}
              <div className="remote-editor-area">
                {activeFile.remote.presentation === 'text' && viewMode === 'editor' ? (
                  <Suspense fallback={<div className="remote-loading"><Loader size="sm" /></div>}>
                    <RemoteMonaco path={activeFile.remote.path} value={activeFile.draft} readOnly={!activeFile.remote.writable}
                      onChange={(draft) => updateActive((file) => ({ ...file, draft, dirty: draft !== (file.remote.content ?? '') }))}
                      onSave={() => void saveActive()} />
                  </Suspense>
                ) : activeFile.remote.presentation === 'image' && activeFile.remote.dataUrl ? (
                  <div className="remote-image-preview"><img src={activeFile.remote.dataUrl} alt={activeFile.remote.name} /></div>
                ) : activeFile.remote.presentation === 'pdf' && activeFile.remote.dataUrl ? (
                  <iframe className="remote-document-preview" src={activeFile.remote.dataUrl} title={activeFile.remote.name} />
                ) : previewDocument ? (
                  <iframe className="remote-document-preview" sandbox="" srcDoc={previewDocument} title={`${activeFile.remote.name} preview`} />
                ) : (
                  <div className="remote-unsupported"><IconFile size={36} /><Text fw={650}>Preview unavailable</Text>
                    <Text size="sm" c="dimmed">Binary file / {formatBytes(activeFile.remote.size)}</Text></div>
                )}
              </div>
              <footer className="remote-file-status"><span>{activeFile.remote.permissions}</span><span>{formatBytes(activeFile.remote.size)}</span>
                <span>{activeFile.remote.mimeType}</span><span>UTF-8</span>{activeFile.dirty && <span className="remote-dirty">Modified</span>}</footer>
            </div>
          ) : currentPath ? (
            <div className="remote-directory-view">
              <div className="remote-directory-heading"><div><Text fw={680}>{currentPath?.split('/').at(-1) || '/'}</Text>
                <Text size="xs" c="dimmed">{currentPath}</Text></div><Badge variant="outline" color="gray">{visibleEntries.length} items</Badge></div>
              <div className="remote-directory-list" data-drop-target={dropTargetPath === currentPath || undefined}
                onDragOver={(event) => {
                  if (!draggedEntry || !currentPath || !canDropInto(draggedEntry, currentPath)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTargetPath(currentPath)
                }}
                onDrop={(event) => currentPath && void dropInto(event, {
                  name: currentPath.split('/').at(-1) || '/', path: currentPath, type: 'directory',
                  size: 0, modifiedAt: null, permissions: '',
                })}>
                {visibleEntries.map((entry) => (
                  <button type="button" key={entry.path} draggable data-dragging={draggedEntry?.path === entry.path || undefined}
                    data-drop-target={dropTargetPath === entry.path || undefined}
                    onDragStart={(event) => dragStart(event, entry)} onDragEnd={dragEnd}
                    onDragOver={(event) => entry.type === 'directory' && dragOver(event, entry)}
                    onDrop={(event) => entry.type === 'directory' && void dropInto(event, entry)}
                    onDoubleClick={() => entry.type === 'directory'
                      ? void navigate(entry.path) : void openFile(entry)} onContextMenu={(event) => showContextMenu(event, entry)}>
                    {entry.type === 'directory' ? <IconFolder size={17} /> : <IconFile size={16} />}
                    <span>{entry.name}</span><span>{entry.permissions}</span><span>{entry.type === 'directory' ? '-' : formatBytes(entry.size)}</span>
                    <span>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '-'}</span>
                  </button>
                ))}
                {openingPath && <div className="remote-opening"><Loader size="xs" /><Text size="xs">Opening {openingPath.split('/').at(-1)}...</Text></div>}
              </div>
            </div>
          ) : mutation?.kind === 'create-file' || mutation?.kind === 'create-folder' ? (
            <>
              <TextInput label="Destination folder" description="Absolute server path or ~ for the SSH user's home"
                value={mutation.parentPath} placeholder="/var/www/app"
                onChange={(event) => {
                  const parentPath = event.currentTarget.value
                  setMutation((current) => current ? { ...current, parentPath } : current)
                }} />
              <TextInput ref={mutationInputRef} autoFocus
                label={mutation.kind === 'create-folder' ? 'Folder name' : 'File name'}
                placeholder={mutation.kind === 'create-folder' ? 'new-folder' : 'new-file.txt'}
                value={mutation.value}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setMutation((current) => current ? { ...current, value } : current)
                }}
                onKeyDown={(event) => event.key === 'Enter' && mutation.value.trim()
                  && mutation.parentPath.trim() && void runMutation()} />
            </>
          ) : (
            <div className="remote-workspace-empty">
              <div className="empty-icon-wrap"><IconFolderOpen size={34} stroke={1.5} /></div>
              <Text fw={700} fz={18}>Open a remote file or folder</Text>
              <Text size="sm" c="dimmed" maw={460} ta="center">
                The Explorer stays focused on only what you choose. Files from this folder or any other server path can remain open together in tabs.
              </Text>
              <Group gap="sm" mt={4}>
                <Button leftSection={<IconFolderPlus size={16} />} onClick={() => showPicker('folder')}>Open folder</Button>
                <Button variant="light" leftSection={<IconFilePlus size={16} />} onClick={() => showPicker('file')}>Open file</Button>
              </Group>
            </div>
          )}
        </main>
      </div>

      {contextMenu && (
        <div className="remote-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => {
            setContextMenu(null)
            if (contextMenu.entry.type === 'directory') void navigate(contextMenu.entry.path)
            else void openFile(contextMenu.entry)
          }}>
            {contextMenu.entry.type === 'directory' ? <IconFolderOpen size={15} /> : <IconFile size={15} />}
            Open
          </button>
          <div className="remote-context-submenu">
            <button type="button" className="remote-context-submenu-trigger">
              <IconPlayerPlay size={15} />Run<IconChevronRight size={14} />
            </button>
            <div className="remote-context-submenu-panel">
              {snippets.length > 0 && <div className="remote-context-submenu-label">Snippets</div>}
              {snippets.map((snippet) => <button type="button" key={snippet.id} onClick={() => {
                const path = contextMenu.entry.path
                setContextMenu(null)
                setSnippetRun({ snippet, path })
              }}><IconPlayerPlay size={14} /><span>{snippet.name}</span></button>)}
              {scripts.length > 0 && <div className="remote-context-submenu-label">Scripts</div>}
              {scripts.map((script) => <button type="button" key={script.id} onClick={() => {
                const path = contextMenu.entry.path
                setContextMenu(null)
                setSnippetRun({ snippet: script, path })
              }}><IconCode size={14} /><span>{script.name}</span></button>)}
              {!snippets.length && !scripts.length && <div className="remote-context-submenu-empty">No snippets or scripts for this server</div>}
            </div>
          </div>
          {contextMenu.entry.type === 'directory' && (
            <>
              <button type="button" onClick={() => startMutation('create-file', contextMenu.entry)}><IconFilePlus size={15} />New file</button>
              <button type="button" onClick={() => startMutation('create-folder', contextMenu.entry)}><IconFolderPlus size={15} />New folder</button>
              <span className="remote-context-separator" />
            </>
          )}
          <button type="button" onClick={() => {
            setClipboard({ entry: contextMenu.entry, mode: 'copy' })
            setContextMenu(null)
          }}><IconCopy size={15} />Copy</button>
          <button type="button" onClick={() => {
            setClipboard({ entry: contextMenu.entry, mode: 'move' })
            setContextMenu(null)
          }}><IconCut size={15} />Cut</button>
          {contextMenu.entry.type !== 'directory' && (
            <button type="button" onClick={() => {
              const entry = contextMenu.entry
              setContextMenu(null)
              void downloadEntry(entry)
            }}><IconDownload size={15} />Download</button>
          )}
          {contextMenu.entry.type === 'directory' && (
            <button type="button" onClick={() => {
              const path = contextMenu.entry.path
              setContextMenu(null)
              void uploadInto(path)
            }}><IconUpload size={15} />Upload here</button>
          )}
          {contextMenu.entry.type === 'directory' && clipboard && clipboard.entry.path !== contextMenu.entry.path && (
            <button type="button" onClick={() => {
              const target = contextMenu.entry.path
              setContextMenu(null)
              void pasteInto(target)
            }}><IconClipboard size={15} />Paste into folder</button>
          )}
          <span className="remote-context-separator" />
          <button type="button" onClick={() => startMutation('rename', contextMenu.entry)}><IconPencil size={15} />Rename</button>
          <button type="button" onClick={() => startMutation('permissions', contextMenu.entry)}><IconLock size={15} />Permissions</button>
          <span className="remote-context-separator" />
          <button type="button" className="danger" onClick={() => startMutation('delete', contextMenu.entry)}><IconTrash size={15} />Delete</button>
        </div>
      )}

      <SshSnippetRunner connection={connection} snippet={snippetRun?.snippet ?? null}
        contextValues={{ path: snippetRun?.path ?? '' }}
        onClose={() => setSnippetRun(null)}
        onOpenTerminal={(command) => onOpenTerminal(command)} />

      <Modal opened={pickerMode !== null} onClose={() => setPickerMode(null)}
        title={pickerMode === 'folder' ? 'Open remote folder' : 'Open remote file'} size="lg" centered>
        <div className="remote-picker">
          <div className="remote-picker-toolbar">
            <Tooltip label="Parent folder"><ActionIcon variant="subtle" color="gray"
              disabled={!pickerListing?.parentPath || pickerLoading}
              onClick={() => void loadPicker(pickerListing?.parentPath)}><IconFolderUp size={16} /></ActionIcon></Tooltip>
            <TextInput size="xs" value={pickerPath} placeholder="Remote path" aria-label="Picker remote path"
              onChange={(event) => setPickerPath(event.currentTarget.value)}
              onKeyDown={(event) => event.key === 'Enter' && void loadPicker(pickerPath)} />
            <TextInput size="xs" value={pickerFilter} placeholder="Filter visible" leftSection={<IconSearch size={13} />}
              onChange={(event) => setPickerFilter(event.currentTarget.value)} />
            <ActionIcon variant="subtle" color="gray" loading={pickerLoading}
              onClick={() => void loadPicker(pickerListing?.path ?? pickerPath)}><IconRefresh size={16} /></ActionIcon>
          </div>
          <div className="remote-picker-list">
            {pickerEntries.map((entry) => (
              <button type="button" key={entry.path} data-selected={pickerSelection?.path === entry.path || undefined}
                onClick={() => {
                  setPickerSelection(entry)
                }}
                onDoubleClick={() => entry.type === 'directory'
                  ? void loadPicker(entry.path)
                  : pickerMode === 'file' && (setPickerMode(null), void openFile(entry))}>
                {entry.type === 'directory' ? <IconFolder size={17} /> : <IconFile size={16} />}
                <span>{entry.name}</span><span>{entry.type === 'directory' ? 'Folder' : formatBytes(entry.size)}</span>
              </button>
            ))}
            {pickerLoading && <div className="remote-loading"><Loader size="sm" /></div>}
            {!pickerLoading && pickerEntries.length === 0 && <Text size="sm" c="dimmed" p="md">No matching items.</Text>}
          </div>
          <div className="remote-picker-footer">
            <Text size="xs" c="dimmed" truncate>{pickerMode === 'folder'
              ? pickerSelection?.type === 'directory'
                ? pickerSelection.path
                : pickerListing?.path ?? 'Choose a folder'
              : pickerSelection?.path ?? 'Choose a file'}</Text>
            <Group gap="xs"><Button size="xs" variant="subtle" color="gray" onClick={() => setPickerMode(null)}>Cancel</Button>
              <Button size="xs" disabled={pickerMode === 'folder' ? !pickerListing : pickerSelection?.type === 'directory' || !pickerSelection}
                onClick={acceptPicker}>Open</Button></Group>
          </div>
        </div>
      </Modal>

      <Modal opened={mutation !== null} onClose={() => !mutating && setMutation(null)}
        onEnterTransitionEnd={() => {
          if (mutation?.kind !== 'delete') {
            mutationInputRef.current?.focus()
            if (mutation?.kind === 'rename') mutationInputRef.current?.select()
          }
        }}
        title={mutation?.kind === 'create-file' ? 'Create remote file'
          : mutation?.kind === 'create-folder' ? 'Create remote folder'
            : mutation?.kind === 'rename' ? `Rename ${mutation.target?.name ?? 'entry'}`
              : mutation?.kind === 'permissions' ? `Permissions for ${mutation.target?.name ?? 'entry'}`
                : `Delete ${mutation?.target?.name ?? 'entry'}?`}
        size="sm" centered={mutation?.kind !== 'permissions'}>
        <div className="remote-mutation-dialog">
          {mutation?.kind === 'delete' ? (
            <>
              <Text size="sm">Permanently delete <strong>{mutation.target?.path}</strong>?</Text>
              {mutation.target?.type === 'directory' && (
                <Text size="xs" c="red">The folder and all of its contents will be deleted recursively. This cannot be undone.</Text>
              )}
              {files.some((file) => mutation.target && (file.remote.path === mutation.target.path
                || file.remote.path.startsWith(`${mutation.target.path}/`)) && file.dirty) && (
                <Text size="xs" c="yellow">Unsaved editor changes inside this path will also be discarded.</Text>
              )}
            </>
          ) : mutation?.kind === 'permissions' ? (
            <PermissionEditor value={mutation.value} inputRef={mutationInputRef}
              onChange={(value) => setMutation((current) => current ? { ...current, value } : current)}
              onSubmit={() => void runMutation()} />
          ) : (
            <TextInput
              ref={mutationInputRef}
              autoFocus
              label={mutation?.kind === 'permissions' ? 'Octal permissions' : 'Name'}
              description={mutation?.kind === 'permissions' ? 'For example: 0644 for files or 0755 for folders' : mutation?.parentPath}
              value={mutation?.value ?? ''}
              onChange={(event) => {
                const value = event.currentTarget.value
                setMutation((current) => current ? { ...current, value } : current)
              }}
              onKeyDown={(event) => event.key === 'Enter' && mutation?.value.trim() && void runMutation()}
            />
          )}
          <Group justify="flex-end" mt="md">
            <Button size="xs" variant="subtle" color="gray" disabled={mutating} onClick={() => setMutation(null)}>Cancel</Button>
            <Button size="xs" color={mutation?.kind === 'delete' ? 'red' : 'teal'} loading={mutating}
              disabled={mutation?.kind !== 'delete' && (mutation?.kind === 'permissions'
                ? !normalizedPermissions(mutation.value)
                : !mutation?.value.trim() || ((mutation?.kind === 'create-file' || mutation?.kind === 'create-folder')
                  && !mutation.parentPath.trim()))} onClick={() => void runMutation()}>
              {mutation?.kind === 'delete' ? 'Delete permanently' : mutation?.kind === 'permissions' ? 'Apply' : 'Confirm'}
            </Button>
          </Group>
        </div>
      </Modal>
    </section>
  )
}
