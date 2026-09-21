import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import {
  IconArrowLeft,
  IconFolderOpen,
  IconRefresh,
  IconServer2,
  IconUpload,
} from '@tabler/icons-react'
import { FileIcon, FolderIcon } from '@react-symbols/icons/utils'
import type {
  LocalFolderEntry,
  LocalFolderListing,
  LocalFolderUploadProgress,
  RemoteConnection,
} from '../../shared/desktop-api'
import './local-folders.css'

const LAST_LOCAL_FOLDER_KEY = 'myrepos.localFolders.lastPath'

const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

const bytes = (value: number): string => {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`
  return `${(value / 1_073_741_824).toFixed(1)} GB`
}

export function LocalFoldersPage() {
  const [listing, setListing] = useState<LocalFolderListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connections, setConnections] = useState<RemoteConnection[]>([])
  const [context, setContext] = useState<{ entry: LocalFolderEntry; x: number; y: number } | null>(null)
  const [uploadEntry, setUploadEntry] = useState<LocalFolderEntry | null>(null)
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [remoteDirectory, setRemoteDirectory] = useState('/')
  const [overwrite, setOverwrite] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<LocalFolderUploadProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    void window.desktop?.remoteConnections.list().then((items) => {
      setConnections(items)
      setConnectionId((current) => current ?? items[0]?.id ?? null)
    }).catch((reason) => setError(message(reason)))
    const unsubscribe = window.desktop?.localFolders.onUploadProgress(setProgress)
    return () => unsubscribe?.()
  }, [])

  useEffect(() => {
    if (!context) return
    const close = (): void => setContext(null)
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', key)
    }
  }, [context])

  const load = async (rootPath: string, relativePath = ''): Promise<void> => {
    if (!window.desktop) return
    setLoading(true)
    setError(null)
    try {
      setListing(await window.desktop.localFolders.list(rootPath, relativePath))
    } catch (reason) {
      setError(message(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const previous = window.localStorage.getItem(LAST_LOCAL_FOLDER_KEY)
    if (previous) void load(previous)
  }, [])

  const choose = async (): Promise<void> => {
    if (!window.desktop) return
    setError(null)
    try {
      const selected = await window.desktop.localFolders.choose()
      if (selected) {
        window.localStorage.setItem(LAST_LOCAL_FOLDER_KEY, selected.path)
        await load(selected.path)
      }
    } catch (reason) {
      setError(message(reason))
    }
  }

  const startUpload = (entry: LocalFolderEntry): void => {
    setContext(null)
    setUploadEntry(entry)
    setProgress(null)
    setResult(null)
    setError(null)
  }

  const upload = async (): Promise<void> => {
    if (!window.desktop || !listing || !uploadEntry || !connectionId) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      const uploaded = await window.desktop.localFolders.upload({
        rootPath: listing.path,
        relativePath: uploadEntry.relativePath,
        remoteConnectionId: connectionId,
        remoteDirectory,
        overwrite,
      })
      setResult(`Uploaded ${uploaded.uploadedFiles} ${uploaded.uploadedFiles === 1 ? 'file' : 'files'} (${bytes(uploaded.uploadedBytes)}) to ${uploaded.remotePath}${uploaded.skippedLinks ? `; skipped ${uploaded.skippedLinks} symbolic links` : ''}.`)
    } catch (reason) {
      setError(message(reason))
    } finally {
      setUploading(false)
    }
  }

  const connectionOptions = useMemo(() => connections.map((connection) => ({
    value: connection.id,
    label: `${connection.name} — ${connection.protocol.toUpperCase()}${connection.host ? ` — ${connection.username}@${connection.host}` : ' — linked SSH'}`,
  })), [connections])
  const percent = progress?.totalBytes
    ? Math.min(100, progress.transferredBytes / progress.totalBytes * 100)
    : progress && progress.totalFiles > 0
      ? progress.completedFiles / progress.totalFiles * 100
      : 0

  return (
    <div className="local-folders-page">
      <section className="intro-row">
        <div>
          <Text fz={24} fw={720} className="page-title">Local folders</Text>
          <Text c="dimmed" mt={5} maw={680}>
            Open any folder or repository and transfer its contents to remote servers.
          </Text>
        </div>
        <Button leftSection={<IconFolderOpen size={17} />} onClick={() => void choose()}>
          Open folder
        </Button>
      </section>

      {error && !uploadEntry && <Alert color="red">{error}</Alert>}
      {!listing ? (
        <Paper className="local-folder-empty" radius="lg">
          <IconFolderOpen size={38} stroke={1.4} />
          <Text fw={700} fz="lg">Open a local workspace</Text>
          <Text size="sm" c="dimmed" ta="center" maw={470}>
            Git repositories and ordinary folders are both supported. Right-click an entry to upload it through FTP, FTPS, or SFTP.
          </Text>
          <Button leftSection={<IconFolderOpen size={16} />} onClick={() => void choose()}>Choose folder</Button>
        </Paper>
      ) : (
        <Paper className="local-folder-browser" radius="lg">
          <div className="local-folder-toolbar">
            <Group gap="xs" wrap="nowrap">
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                leftSection={<IconArrowLeft size={15} />}
                disabled={listing.parentPath === null || loading}
                onClick={() => void load(listing.path, listing.parentPath ?? '')}
              >
                Back
              </Button>
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                leftSection={<IconRefresh size={14} />}
                disabled={loading}
                onClick={() => void load(listing.path, listing.relativePath)}
              >
                Refresh
              </Button>
            </Group>
            <div className="local-folder-location">
              <Text size="sm" fw={650} truncate title={listing.path}>{listing.name}</Text>
              <Text size="xs" c="dimmed" truncate title={listing.relativePath || listing.path}>
                {listing.relativePath || listing.path}
              </Text>
            </div>
            <Badge color={listing.gitRepository ? 'teal' : 'gray'} variant="light">
              {listing.gitRepository ? 'Git repository' : 'Folder'}
            </Badge>
          </div>
          {loading ? (
            <div className="local-folder-loading"><Loader size="sm" /> Loading folder…</div>
          ) : listing.entries.length === 0 ? (
            <div className="local-folder-loading">This folder is empty.</div>
          ) : (
            <div className="local-folder-list">
              {listing.entries.map((entry) => (
                <button
                  type="button"
                  className="local-folder-row"
                  key={entry.relativePath}
                  onDoubleClick={() => entry.type === 'directory' && void load(listing.path, entry.relativePath)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setContext({ entry, x: event.clientX, y: event.clientY })
                  }}
                >
                  <span className="local-folder-entry-icon">
                    {entry.type === 'directory'
                      ? <FolderIcon folderName={entry.name} width={21} height={21} />
                      : <FileIcon fileName={entry.name} autoAssign width={20} height={20} />}
                  </span>
                  <span className="local-folder-entry-name">{entry.name}</span>
                  <span>{entry.type}</span>
                  <span>{entry.type === 'file' ? bytes(entry.size) : '—'}</span>
                  <span>{new Date(entry.modifiedAt).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </Paper>
      )}

      {context && (
        <div
          className="local-folder-context"
          style={{ left: Math.min(context.x, window.innerWidth - 230), top: Math.min(context.y, window.innerHeight - 90) }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={context.entry.type !== 'file' && context.entry.type !== 'directory'}
            onClick={() => startUpload(context.entry)}
          >
            <IconUpload size={15} /> Upload to remote…
          </button>
        </div>
      )}

      <Modal
        opened={Boolean(uploadEntry)}
        onClose={() => { if (!uploading) setUploadEntry(null) }}
        title={`Upload ${uploadEntry?.name ?? ''}`}
        centered
        closeOnClickOutside={!uploading}
        closeOnEscape={!uploading}
      >
        <Stack gap="md">
          {connections.length === 0 ? (
            <Alert color="yellow" icon={<IconServer2 size={16} />}>
              Add and test an FTP, FTPS, or SFTP connection before uploading.
            </Alert>
          ) : (
            <>
              <Select label="Remote connection" data={connectionOptions} value={connectionId} onChange={setConnectionId} searchable />
              <TextInput label="Remote directory" value={remoteDirectory} onChange={(event) => setRemoteDirectory(event.currentTarget.value)} placeholder="/var/www" />
              <Checkbox checked={overwrite} onChange={(event) => setOverwrite(event.currentTarget.checked)} label="Overwrite existing remote files" />
            </>
          )}
          {uploading && (
            <div>
              <Group justify="space-between"><Text size="xs">{progress?.relativePath ?? 'Preparing upload…'}</Text><Text size="xs">{Math.round(percent)}%</Text></Group>
              <Progress value={percent} animated mt={6} />
            </div>
          )}
          {error && <Alert color="red">{error}</Alert>}
          {result && <Alert color="teal">{result}</Alert>}
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" disabled={uploading} onClick={() => setUploadEntry(null)}>Close</Button>
            <Button leftSection={<IconUpload size={15} />} loading={uploading} disabled={!connectionId || !remoteDirectory.trim() || Boolean(result)} onClick={() => void upload()}>Upload</Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
