import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button, Group, Loader, Text, TextInput, Tooltip } from '@mantine/core'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconDeviceFloppy,
  IconEye,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconFolderUp,
  IconHome,
  IconRefresh,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import { marked } from 'marked'
import type {
  SshConnection,
  SshDirectoryListing,
  SshRemoteEntry,
  SshRemoteFileContent,
} from '../../shared/desktop-api'

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
}: {
  entry: SshRemoteEntry
  depth: number
  currentPath: string | null
  listings: Map<string, SshDirectoryListing>
  expanded: Set<string>
  loadingPaths: Set<string>
  onOpenDirectory: (path: string, toggle: boolean) => void
  onOpenFile: (entry: SshRemoteEntry) => void
}) {
  const directory = entry.type === 'directory'
  const open = directory && expanded.has(entry.path)
  const children = listings.get(entry.path)?.entries ?? []
  return (
    <>
      <button
        type="button"
        className="ssh-tree-row"
        data-selected={currentPath === entry.path || undefined}
        style={{ paddingLeft: 7 + depth * 13 }}
        title={entry.path}
        onClick={() => directory ? onOpenDirectory(entry.path, true) : onOpenFile(entry)}
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
          onOpenDirectory={onOpenDirectory} onOpenFile={onOpenFile} />
      ))}
    </>
  )
}

export function SshRemoteFileManager({ connection }: { connection: SshConnection }) {
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
    void navigate(null)
  }, [connection.id])

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

  const currentListing = currentPath ? listings.get(currentPath) : null
  const visibleEntries = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase()
    return (currentListing?.entries ?? []).filter((entry) => !needle || entry.name.toLocaleLowerCase().includes(needle))
  }, [currentListing, filter])
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
        <TextInput size="xs" value={pathInput} aria-label="Remote path" placeholder="Go to remote path"
          onChange={(event) => setPathInput(event.currentTarget.value)}
          onKeyDown={(event) => event.key === 'Enter' && void navigate(pathInput)} />
        <TextInput size="xs" value={filter} aria-label="Filter visible files" placeholder="Filter visible"
          leftSection={<IconSearch size={13} />} onChange={(event) => setFilter(event.currentTarget.value)} />
        <Tooltip label="Refresh current folder"><ActionIcon variant="subtle" color="gray"
          loading={Boolean(currentPath && loadingPaths.has(currentPath))}
          onClick={() => currentPath && void loadListing(currentPath, true)}><IconRefresh size={16} /></ActionIcon></Tooltip>
      </div>

      {error && <div className="remote-explorer-error"><Text size="xs">{error}</Text><ActionIcon size="xs" variant="subtle" onClick={() => setError(null)}><IconX size={12} /></ActionIcon></div>}

      <div className="remote-explorer-body">
        <aside className="remote-tree-pane">
          <div className="remote-pane-title"><span>REMOTE EXPLORER</span><Badge size="xs" variant="transparent" color="gray">SFTP</Badge></div>
          <div className="remote-tree-scroll">
            {rootEntry ? <TreeNode entry={rootEntry} depth={0} currentPath={currentPath} listings={listings}
              expanded={expanded} loadingPaths={loadingPaths} onOpenDirectory={openDirectory} onOpenFile={(entry) => void openFile(entry)} />
              : <div className="remote-loading"><Loader size="xs" /></div>}
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
          ) : (
            <div className="remote-directory-view">
              <div className="remote-directory-heading"><div><Text fw={680}>{currentPath?.split('/').at(-1) || '/'}</Text>
                <Text size="xs" c="dimmed">{currentPath}</Text></div><Badge variant="outline" color="gray">{visibleEntries.length} items</Badge></div>
              <div className="remote-directory-list">
                {visibleEntries.map((entry) => (
                  <button type="button" key={entry.path} onDoubleClick={() => entry.type === 'directory'
                    ? void navigate(entry.path) : void openFile(entry)}>
                    {entry.type === 'directory' ? <IconFolder size={17} /> : <IconFile size={16} />}
                    <span>{entry.name}</span><span>{entry.permissions}</span><span>{entry.type === 'directory' ? '-' : formatBytes(entry.size)}</span>
                    <span>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '-'}</span>
                  </button>
                ))}
                {openingPath && <div className="remote-opening"><Loader size="xs" /><Text size="xs">Opening {openingPath.split('/').at(-1)}...</Text></div>}
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}
