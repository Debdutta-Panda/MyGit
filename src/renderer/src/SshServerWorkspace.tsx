import { useCallback, useEffect, useRef, useState } from 'react'
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
  IconAlertTriangle,
  IconActivity,
  IconArrowsDownUp,
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconCpu,
  IconCircleCheck,
  IconDatabase,
  IconGauge,
  IconListDetails,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconServer2,
  IconTerminal2,
} from '@tabler/icons-react'
import type {
  SshConnection,
  SshServerOverview,
} from '../../shared/desktop-api'
import { SshRemoteFileManager } from './SshRemoteFileManager'
import { SshUsersGroupsManager } from './SshUsersGroupsManager'
import { SshCommandSnippets } from './SshCommandSnippets'

type WorkspaceTab = 'overview' | 'files' | 'accounts' | 'snippets' | 'services' | 'databases' | 'logs'

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

interface MetricSample {
  timestamp: number
  cpu: number | null
  memory: number | null
  disk: number | null
  networkRate: number | null
}

function MiniChart({ values, color = '#20c997', maximum = 100 }: {
  values: Array<number | null>
  color?: string
  maximum?: number
}) {
  const points = values
    .map((value, index) => value === null ? null : `${values.length <= 1 ? 100 : index / (values.length - 1) * 100},${34 - Math.min(34, value / Math.max(maximum, 1) * 34)}`)
    .filter((value): value is string => Boolean(value))
    .join(' ')
  return (
    <svg className="ssh-mini-chart" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 34 H100" />
      {points && <polyline points={points} style={{ stroke: color }} />}
    </svg>
  )
}

export function SshServerWorkspace({
  connection,
  onBack,
  onOpenTerminal,
}: {
  connection: SshConnection
  onBack: () => void
  onOpenTerminal: (command?: string) => void
}) {
  const [tab, setTab] = useState<WorkspaceTab>('overview')
  const [overview, setOverview] = useState<SshServerOverview | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [refreshingOverview, setRefreshingOverview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [history, setHistory] = useState<MetricSample[]>([])
  const tabsRef = useRef<HTMLElement>(null)
  const [tabEdges, setTabEdges] = useState({ left: true, right: true })
  const overviewRequestRef = useRef(false)
  const hasOverviewRef = useRef(false)

  const loadOverview = useCallback(async (): Promise<void> => {
    if (!window.desktop || overviewRequestRef.current) return
    overviewRequestRef.current = true
    if (hasOverviewRef.current) setRefreshingOverview(true)
    else setLoadingOverview(true)
    setError(null)
    try {
      const next = await window.desktop.ssh.serverOverview(connection.id)
      setOverview((previous) => {
        const memoryUsed = next.totalMemoryBytes !== null && next.freeMemoryBytes !== null
          ? next.totalMemoryBytes - next.freeMemoryBytes : null
        const elapsedSeconds = previous
          ? (new Date(next.fetchedAt).getTime() - new Date(previous.fetchedAt).getTime()) / 1000
          : 0
        const networkDelta = previous && elapsedSeconds > 0
          && next.networkReceivedBytes !== null && next.networkSentBytes !== null
          && previous.networkReceivedBytes !== null && previous.networkSentBytes !== null
          ? Math.max(0, next.networkReceivedBytes + next.networkSentBytes
            - previous.networkReceivedBytes - previous.networkSentBytes) / elapsedSeconds
          : null
        setHistory((current) => [...current, {
          timestamp: Date.now(),
          cpu: next.cpuUsagePercent,
          memory: usagePercent(memoryUsed, next.totalMemoryBytes),
          disk: usagePercent(next.diskUsedBytes, next.diskTotalBytes),
          networkRate: networkDelta,
        }].slice(-60))
        return next
      })
      hasOverviewRef.current = true
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoadingOverview(false)
      setRefreshingOverview(false)
      overviewRequestRef.current = false
    }
  }, [connection.id])

  useEffect(() => {
    hasOverviewRef.current = false
    setOverview(null)
    setHistory([])
    void loadOverview()
  }, [connection.id, loadOverview])

  useEffect(() => {
    if (!autoRefresh || tab !== 'overview') return
    const timer = window.setInterval(() => void loadOverview(), 10_000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, tab, loadOverview])

  const memoryUsed = overview?.totalMemoryBytes !== null && overview?.freeMemoryBytes !== null
    && overview?.totalMemoryBytes !== undefined && overview?.freeMemoryBytes !== undefined
    ? overview.totalMemoryBytes - overview.freeMemoryBytes
    : null
  const memoryPercent = usagePercent(memoryUsed, overview?.totalMemoryBytes ?? null)
  const diskPercent = usagePercent(overview?.diskUsedBytes ?? null, overview?.diskTotalBytes ?? null)
  const swapPercent = usagePercent(overview?.swapUsedBytes ?? null, overview?.swapTotalBytes ?? null)
  const latestNetworkRate = history.at(-1)?.networkRate ?? null
  const maxNetworkRate = Math.max(1, ...history.map((sample) => sample.networkRate ?? 0))
  const healthWarnings = overview ? [
    overview.rebootRequired ? { level: 'warning' as const, text: 'A server reboot is required.' } : null,
    diskPercent >= 90 ? { level: 'critical' as const, text: `Home disk is ${diskPercent.toFixed(0)}% full.` }
      : diskPercent >= 80 ? { level: 'warning' as const, text: `Home disk usage is ${diskPercent.toFixed(0)}%.` } : null,
    memoryPercent >= 95 ? { level: 'critical' as const, text: `Memory usage is ${memoryPercent.toFixed(0)}%.` }
      : memoryPercent >= 85 ? { level: 'warning' as const, text: `Memory usage is ${memoryPercent.toFixed(0)}%.` } : null,
    overview.cpuUsagePercent !== null && overview.cpuUsagePercent >= 95
      ? { level: 'critical' as const, text: `CPU usage is ${overview.cpuUsagePercent.toFixed(0)}%.` }
      : overview.cpuUsagePercent !== null && overview.cpuUsagePercent >= 85
        ? { level: 'warning' as const, text: `CPU usage is ${overview.cpuUsagePercent.toFixed(0)}%.` } : null,
    overview.partitions.some((partition) => partition.usagePercent >= 90)
      ? { level: 'critical' as const, text: 'One or more filesystems are over 90% full.' } : null,
  ].filter((warning): warning is { level: 'warning' | 'critical'; text: string } => Boolean(warning)) : []
  const healthLevel = healthWarnings.some((warning) => warning.level === 'critical')
    ? 'critical' : healthWarnings.length ? 'warning' : 'healthy'

  const updateTabEdges = useCallback((): void => {
    const tabs = tabsRef.current
    if (!tabs) return
    setTabEdges({
      left: tabs.scrollLeft <= 1,
      right: tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 1,
    })
  }, [])

  useEffect(() => {
    const tabs = tabsRef.current
    if (!tabs) return
    const observer = new ResizeObserver(updateTabEdges)
    observer.observe(tabs)
    updateTabEdges()
    return () => observer.disconnect()
  }, [updateTabEdges])

  const scrollTabs = (direction: -1 | 1): void => {
    tabsRef.current?.scrollBy({ left: direction * 240, behavior: 'smooth' })
    window.setTimeout(updateTabEdges, 280)
  }

  return (
    <div className="ssh-workspace" data-tab={tab}>
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
        <div className="ssh-workspace-tab-strip">
          <Tooltip label="Earlier sections">
            <ActionIcon size="sm" variant="subtle" color="gray" disabled={tabEdges.left}
              onClick={() => scrollTabs(-1)} aria-label="Scroll server tabs left">
              <IconChevronLeft size={15} />
            </ActionIcon>
          </Tooltip>
          <nav ref={tabsRef} className="ssh-workspace-tabs" aria-label="Server tools" onScroll={updateTabEdges}>
            {([
              ['overview', 'Overview'],
              ['files', 'Files'],
              ['accounts', 'Users & Groups'],
              ['snippets', 'Snippets'],
              ['services', 'Services'],
              ['databases', 'Databases'],
              ['logs', 'Logs'],
            ] as Array<[WorkspaceTab, string]>).map(([value, label]) => (
              <button type="button" key={value} data-active={tab === value || undefined} onClick={() => setTab(value)}>
                {label}
              </button>
            ))}
          </nav>
          <Tooltip label="Later sections">
            <ActionIcon size="sm" variant="subtle" color="gray" disabled={tabEdges.right}
              onClick={() => scrollTabs(1)} aria-label="Scroll server tabs right">
              <IconChevronRight size={15} />
            </ActionIcon>
          </Tooltip>
        </div>
        <Group gap={6} wrap="nowrap">
          {overview && (
            <Text size="xs" c="dimmed" className="ssh-dashboard-updated">
              Updated {new Date(overview.fetchedAt).toLocaleTimeString()}
            </Text>
          )}
          <Tooltip label={autoRefresh ? 'Pause 10-second refresh' : 'Resume 10-second refresh'}>
            <ActionIcon variant={autoRefresh ? 'light' : 'subtle'} color="teal"
              onClick={() => setAutoRefresh((value) => !value)} aria-label="Toggle dashboard auto refresh">
              {autoRefresh ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Refresh current view">
            <ActionIcon variant="subtle" color="gray" aria-label="Refresh server workspace"
              loading={refreshingOverview}
              disabled={tab !== 'overview'}
              onClick={() => void loadOverview()}>
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
          <Button size="xs" variant="light" leftSection={<IconTerminal2 size={15} />} onClick={() => onOpenTerminal()}>
            Terminal
          </Button>
        </Group>
      </header>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={17} />} withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {tab === 'overview' && (
        loadingOverview ? <div className="ssh-workspace-loading"><Loader size="sm" /><Text size="sm">Reading server...</Text></div> : (
          <>
            <Paper className="ssh-health-strip" data-level={healthLevel}>
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon variant="light" color={healthLevel === 'healthy' ? 'teal' : healthLevel === 'warning' ? 'yellow' : 'red'}>
                  {healthLevel === 'healthy' ? <IconCircleCheck size={18} /> : <IconAlertTriangle size={18} />}
                </ThemeIcon>
                <div>
                  <Text fw={700}>{healthLevel === 'healthy' ? 'Server healthy' : healthLevel === 'warning' ? 'Attention recommended' : 'Immediate attention required'}</Text>
                  <Text size="xs" c="dimmed">
                    {healthWarnings.length ? healthWarnings.map((warning) => warning.text).join(' ') : 'All monitored resources are within their configured thresholds.'}
                  </Text>
                </div>
              </Group>
              <Badge color={overview?.rebootRequired ? 'yellow' : 'teal'} variant="light">
                {overview?.rebootRequired === null ? 'Reboot state unavailable' : overview?.rebootRequired ? 'Reboot required' : 'No reboot required'}
              </Badge>
            </Paper>

            <section className="ssh-metric-grid">
              <Paper className="ssh-metric-card">
                <ThemeIcon variant="light" color="teal"><IconCpu size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">CPU</Text><Text fw={680}>{overview?.cpuUsagePercent === null ? 'Unavailable' : `${overview?.cpuUsagePercent.toFixed(1)}%`}</Text>
                  <Text size="xs" c="dimmed">{overview?.cpuCount ?? '-'} cores / load {overview?.loadAverage}</Text></div>
              </Paper>
              <Paper className="ssh-metric-card ssh-metric-progress">
                <ThemeIcon variant="light" color="violet"><IconGauge size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">Memory</Text><Text fw={680}>{formatBytes(memoryUsed)} / {formatBytes(overview?.totalMemoryBytes ?? null)}</Text>
                  <Progress mt={5} size={5} value={memoryPercent} /></div>
              </Paper>
              <Paper className="ssh-metric-card ssh-metric-progress">
                <ThemeIcon variant="light" color="orange"><IconDatabase size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">Home disk</Text><Text fw={680}>{formatBytes(overview?.diskUsedBytes ?? null)} / {formatBytes(overview?.diskTotalBytes ?? null)}</Text>
                  <Progress mt={5} size={5} color="orange" value={diskPercent} /></div>
              </Paper>
              <Paper className="ssh-metric-card ssh-metric-progress">
                <ThemeIcon variant="light" color="grape"><IconActivity size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">Swap</Text><Text fw={680}>{overview?.swapTotalBytes ? `${formatBytes(overview.swapUsedBytes)} / ${formatBytes(overview.swapTotalBytes)}` : 'Not configured'}</Text>
                  <Progress mt={5} size={5} color="grape" value={swapPercent} /></div>
              </Paper>
              <Paper className="ssh-metric-card">
                <ThemeIcon variant="light" color="cyan"><IconArrowsDownUp size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">Network throughput</Text><Text fw={680}>{latestNetworkRate === null ? 'Collecting...' : `${formatBytes(latestNetworkRate)}/s`}</Text>
                  <Text size="xs" c="dimmed">RX {formatBytes(overview?.networkReceivedBytes ?? null)} / TX {formatBytes(overview?.networkSentBytes ?? null)}</Text></div>
              </Paper>
              <Paper className="ssh-metric-card">
                <ThemeIcon variant="light" color="blue"><IconActivity size={17} /></ThemeIcon>
                <div><Text size="xs" c="dimmed">Processes</Text><Text fw={680}>{overview?.processCount ?? 'Unavailable'}</Text>
                  <Text size="xs" c="dimmed">Uptime {overview?.uptime}</Text></div>
              </Paper>
            </section>

            <section className="ssh-chart-grid">
              <Paper className="ssh-chart-card"><Group justify="space-between"><Text size="sm" fw={680}>CPU history</Text><Text size="xs" c="dimmed">{overview?.cpuUsagePercent?.toFixed(1) ?? '-'}%</Text></Group>
                <MiniChart values={history.map((sample) => sample.cpu)} color="#20c997" /></Paper>
              <Paper className="ssh-chart-card"><Group justify="space-between"><Text size="sm" fw={680}>Memory history</Text><Text size="xs" c="dimmed">{memoryPercent.toFixed(1)}%</Text></Group>
                <MiniChart values={history.map((sample) => sample.memory)} color="#9775fa" /></Paper>
              <Paper className="ssh-chart-card"><Group justify="space-between"><Text size="sm" fw={680}>Disk history</Text><Text size="xs" c="dimmed">{diskPercent.toFixed(1)}%</Text></Group>
                <MiniChart values={history.map((sample) => sample.disk)} color="#ffa94d" /></Paper>
              <Paper className="ssh-chart-card"><Group justify="space-between"><Text size="sm" fw={680}>Network history</Text><Text size="xs" c="dimmed">{latestNetworkRate === null ? '-' : `${formatBytes(latestNetworkRate)}/s`}</Text></Group>
                <MiniChart values={history.map((sample) => sample.networkRate)} color="#22b8cf" maximum={maxNetworkRate} /></Paper>
            </section>

            <section className="ssh-overview-details">
              <Paper className="ssh-detail-card">
                <Text fw={680}>Server identity</Text>
                <dl><dt>Hostname</dt><dd>{overview?.hostname}</dd><dt>Operating system</dt><dd>{overview?.operatingSystem}</dd>
                  <dt>Kernel</dt><dd>{overview?.kernel} / {overview?.architecture}</dd><dt>Shell</dt><dd>{overview?.shell}</dd>
                  <dt>Home</dt><dd>{overview?.homeDirectory}</dd></dl>
              </Paper>
              <Paper className="ssh-detail-card">
                <Text fw={680}>Network</Text>
                <dl><dt>Public address</dt><dd>{overview?.publicAddress ?? 'Unavailable'}</dd>
                  <dt>Server addresses</dt><dd>{overview?.privateAddresses.length ? overview.privateAddresses.join(', ') : 'Unavailable'}</dd>
                  <dt>Received</dt><dd>{formatBytes(overview?.networkReceivedBytes ?? null)}</dd>
                  <dt>Sent</dt><dd>{formatBytes(overview?.networkSentBytes ?? null)}</dd></dl>
              </Paper>
              <Paper className="ssh-detail-card">
                <Text fw={680}>Server clock</Text>
                <dl><dt>Server time</dt><dd>{overview?.serverTime}</dd><dt>Timezone</dt><dd>{overview?.timezone}</dd>
                  <dt>Client time</dt><dd>{new Date().toLocaleString()}</dd><dt>Monitoring</dt><dd>{autoRefresh ? 'Every 10 seconds' : 'Paused'}</dd></dl>
              </Paper>
              <Paper className="ssh-detail-card">
                <Text fw={680}>Resource availability</Text>
                <dl><dt>Memory available</dt><dd>{formatBytes(overview?.freeMemoryBytes ?? null)}</dd>
                  <dt>Swap used</dt><dd>{formatBytes(overview?.swapUsedBytes ?? null)}</dd>
                  <dt>Disk available</dt><dd>{formatBytes(overview?.diskAvailableBytes ?? null)}</dd>
                  <dt>Process count</dt><dd>{overview?.processCount ?? 'Unavailable'}</dd></dl>
              </Paper>
            </section>

            <section className="ssh-dashboard-section">
              <Group justify="space-between" mb="sm"><Text fw={700}>Filesystems</Text><Badge variant="outline" color="gray">{overview?.partitions.length ?? 0}</Badge></Group>
              <div className="ssh-partition-list">
                {overview?.partitions.map((partition) => (
                  <div className="ssh-partition-row" key={`${partition.filesystem}:${partition.mountPoint}`}>
                    <div><Text size="sm" fw={650}>{partition.mountPoint}</Text><Text size="xs" c="dimmed" truncate>{partition.filesystem}</Text></div>
                    <Text size="xs">{formatBytes(partition.usedBytes)} / {formatBytes(partition.totalBytes)}</Text>
                    <Progress size={6} color={partition.usagePercent >= 90 ? 'red' : partition.usagePercent >= 80 ? 'yellow' : 'teal'} value={partition.usagePercent} />
                    <Text size="xs" ta="right">{partition.usagePercent}%</Text>
                  </div>
                ))}
                {!overview?.partitions.length && <Text size="sm" c="dimmed">Partition information is unavailable.</Text>}
              </div>
            </section>

          </>
        )
      )}

      {tab === 'files' && (
        <SshRemoteFileManager connection={connection} />
      )}

      {tab === 'accounts' && (
        <SshUsersGroupsManager connection={connection} />
      )}

      {tab === 'snippets' && (
        <SshCommandSnippets connection={connection} onOpenTerminal={onOpenTerminal} />
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
