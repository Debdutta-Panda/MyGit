import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconArrowLeft,
  IconChevronRight,
  IconCpu,
  IconDatabase,
  IconFile,
  IconFolder,
  IconFolderUp,
  IconGauge,
  IconListDetails,
  IconRefresh,
  IconServer2,
  IconTerminal2,
} from '@tabler/icons-react'
import type {
  SshConnection,
  SshDirectoryListing,
  SshServerOverview,
} from '../../shared/desktop-api'

type WorkspaceTab = 'overview' | 'files' | 'services' | 'databases' | 'logs'

const formatBytes = (value: number | null): string => {
  if (value === null) return 'Unavailable'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}

const usagePercent = (used: number | null, total: number | null): number =>
  used !== null && total && total > 0 ? Math.min(100, Math.max(0, used / total * 100)) : 0

const errorMessage = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason)

export function SshServerWorkspace({
  connection,
  onBack,
  onOpenTerminal,
}: {
  connection: SshConnection
  onBack: () => void
  onOpenTerminal: () => void
}) {
  const [tab, setTab] = useState<WorkspaceTab>('overview')
  const [overview, setOverview] = useState<SshServerOverview | null>(null)
  const [directory, setDirectory] = useState<SshDirectoryListing | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingDirectory, setLoadingDirectory] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadOverview = async (): Promise<void> => {
    if (!window.desktop) return
    setLoadingOverview(true)
    setError(null)
    try {
      setOverview(await window.desktop.ssh.serverOverview(connection.id))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoadingOverview(false)
    }
  }

  const loadDirectory = async (path?: string | null): Promise<void> => {
    if (!window.desktop) return
    setLoadingDirectory(true)
    setError(null)
    try {
      setDirectory(await window.desktop.ssh.listDirectory(connection.id, path))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoadingDirectory(false)
    }
  }

  useEffect(() => {
    void Promise.all([loadOverview(), loadDirectory()])
  }, [connection.id])

  const memoryUsed = overview?.totalMemoryBytes !== null && overview?.freeMemoryBytes !== null
    && overview?.totalMemoryBytes !== undefined && overview?.freeMemoryBytes !== undefined
    ? overview.totalMemoryBytes - overview.freeMemoryBytes
    : null

  return (
    <div className="ssh-workspace">
      <header className="ssh-workspace-header">
        <Group gap="sm" wrap="nowrap">
          <Tooltip label="Back to connections">
            <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label="Back to SSH connections">
              <IconArrowLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <ThemeIcon variant="light" color="teal" size={40} radius="md"><IconServer2 size={21} /></ThemeIcon>
          <div className="ssh-workspace-title">
            <Group gap={8} wrap="nowrap">
              <Text fw={740} truncate>{connection.name}</Text>
              <Badge size="xs" variant="light" color="teal">Connected GUI</Badge>
            </Group>
            <Text size="xs" c="dimmed" truncate>{connection.username}@{connection.host}:{connection.port}</Text>
          </div>
        </Group>
        <Group gap={6} wrap="nowrap">
          <Tooltip label="Refresh current view">
            <ActionIcon variant="subtle" color="gray" aria-label="Refresh server workspace"
              onClick={() => tab === 'files' ? void loadDirectory(directory?.path) : void loadOverview()}>
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
          <Button size="xs" variant="light" leftSection={<IconTerminal2 size={15} />} onClick={onOpenTerminal}>
            Terminal
          </Button>
        </Group>
      </header>

      <nav className="ssh-workspace-tabs" aria-label="Server tools">
        {([
          ['overview', 'Overview'],
          ['files', 'Files'],
          ['services', 'Services'],
          ['databases', 'Databases'],
          ['logs', 'Logs'],
        ] as Array<[WorkspaceTab, string]>).map(([value, label]) => (
          <button type="button" key={value} data-active={tab === value || undefined} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={17} />} withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {tab === 'overview' && (
        loadingOverview ? <div className="ssh-workspace-loading"><Loader size="sm" /><Text size="sm">Reading server...</Text></div> : (
          <>
            <section className="ssh-metric-grid">
              <Paper className="ssh-metric-card">
                <ThemeIcon variant="light" color="blue"><IconServer2 size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">System</Text><Text fw={680}>{overview?.operatingSystem}</Text>
                  <Text size="xs" c="dimmed">{overview?.kernel} / {overview?.architecture}</Text></div>
              </Paper>
              <Paper className="ssh-metric-card">
                <ThemeIcon variant="light" color="teal"><IconCpu size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">CPU and load</Text><Text fw={680}>{overview?.cpuCount ?? '-'} cores</Text>
                  <Text size="xs" c="dimmed">Load {overview?.loadAverage}</Text></div>
              </Paper>
              <Paper className="ssh-metric-card ssh-metric-progress">
                <ThemeIcon variant="light" color="violet"><IconGauge size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">Memory</Text><Text fw={680}>{formatBytes(memoryUsed)} / {formatBytes(overview?.totalMemoryBytes ?? null)}</Text>
                  <Progress mt={5} size={5} value={usagePercent(memoryUsed, overview?.totalMemoryBytes ?? null)} /></div>
              </Paper>
              <Paper className="ssh-metric-card ssh-metric-progress">
                <ThemeIcon variant="light" color="orange"><IconDatabase size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">Home disk</Text><Text fw={680}>{formatBytes(overview?.diskUsedBytes ?? null)} / {formatBytes(overview?.diskTotalBytes ?? null)}</Text>
                  <Progress mt={5} size={5} color="orange" value={usagePercent(overview?.diskUsedBytes ?? null, overview?.diskTotalBytes ?? null)} /></div>
              </Paper>
            </section>
            <section className="ssh-overview-details">
              <Paper className="ssh-detail-card">
                <Text fw={680}>Server identity</Text>
                <dl><dt>Hostname</dt><dd>{overview?.hostname}</dd><dt>Uptime</dt><dd>{overview?.uptime}</dd>
                  <dt>Shell</dt><dd>{overview?.shell}</dd><dt>Home</dt><dd>{overview?.homeDirectory}</dd></dl>
              </Paper>
              <Paper className="ssh-detail-card">
                <Text fw={680}>Control center foundation</Text>
                <Text size="sm" c="dimmed" mt={8} lh={1.6}>
                  Secure typed operations are active. Files is live now; services, databases, and logs can be added independently without changing the connection mechanism.
                </Text>
              </Paper>
            </section>
          </>
        )
      )}

      {tab === 'files' && (
        <section className="ssh-files-panel">
          <div className="ssh-pathbar">
            <Tooltip label="Parent directory">
              <ActionIcon variant="subtle" color="gray" disabled={!directory?.parentPath || loadingDirectory}
                onClick={() => void loadDirectory(directory?.parentPath)} aria-label="Open parent directory">
                <IconFolderUp size={17} />
              </ActionIcon>
            </Tooltip>
            <Text size="sm" ff="monospace" truncate>{directory?.path ?? 'Resolving home directory...'}</Text>
            {loadingDirectory && <Loader size={14} />}
          </div>
          <div className="ssh-file-list">
            {directory?.entries.map((entry) => (
              <button type="button" className="ssh-file-row" key={entry.path}
                disabled={entry.type !== 'directory'}
                onDoubleClick={() => entry.type === 'directory' && void loadDirectory(entry.path)}>
                {entry.type === 'directory' ? <IconFolder size={17} /> : <IconFile size={17} />}
                <span className="ssh-file-name">{entry.name}</span>
                <span>{entry.permissions}</span>
                <span>{entry.type === 'directory' ? '-' : formatBytes(entry.size)}</span>
                <span>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '-'}</span>
                {entry.type === 'directory' && <IconChevronRight size={14} />}
              </button>
            ))}
            {!loadingDirectory && directory?.entries.length === 0 && <Text size="sm" c="dimmed" p="md">This directory is empty.</Text>}
          </div>
        </section>
      )}

      {(tab === 'services' || tab === 'databases' || tab === 'logs') && (
        <section className="ssh-module-skeleton">
          <ThemeIcon size={52} radius="xl" variant="light" color="teal"><IconListDetails size={25} /></ThemeIcon>
          <Text fw={720} fz={18}>{tab[0].toUpperCase() + tab.slice(1)}</Text>
          <Text size="sm" c="dimmed" maw={520} ta="center">
            The interaction channel is ready. This module will be connected gradually with explicit, typed server operations.
          </Text>
          <Badge variant="outline" color="gray">UI foundation ready</Badge>
        </section>
      )}
    </div>
  )
}
