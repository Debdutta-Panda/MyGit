import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, Progress, Text, Tooltip } from '@mantine/core'
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCircleCheck,
  IconDatabase,
  IconDownload,
  IconLock,
  IconPlayerPlay,
  IconRefresh,
  IconServer,
} from '@tabler/icons-react'
import type { SshAccountCatalog, SshConnection, SshMySqlOverview } from '../../shared/desktop-api'
import { SshSnippetRunner } from './SshSnippetRunner'
import { SshMySqlDatabases } from './SshMySqlDatabases'
import { SshMySqlUsers } from './SshMySqlUsers'
import { SshMySqlQuery } from './SshMySqlQuery'
import { SshMySqlTables } from './SshMySqlTables'
import type { SshSavedSnippet } from './ssh-snippets-store'

type DatabaseTab = 'overview' | 'install' | 'databases' | 'tables' | 'users' | 'sql'
type InstallFlavor = 'recommended' | 'mysql' | 'mariadb'

interface InstallPlan {
  command: string
  packageLabel: string
  serviceLabel: string
  supported: boolean
  reason?: string
}

const installPlanFor = (packageManager: string | null, flavor: InstallFlavor, root: boolean): InstallPlan => {
  const elevate = root ? '' : 'sudo -n '
  const systemdFinish = [
    "service_name=''",
    "for candidate in mysql mariadb mysqld; do systemctl list-unit-files \"$candidate.service\" --no-legend 2>/dev/null | grep -q \"^$candidate.service\" && { service_name=$candidate; break; }; done",
    "[ -n \"$service_name\" ] || { echo 'Installed, but no MySQL-compatible systemd service was found.' >&2; exit 1; }",
    "echo \"Starting $service_name.service and enabling it at boot...\"",
    `${elevate}systemctl enable --now \"$service_name.service\"`,
    "systemctl --no-pager --full status \"$service_name.service\" | sed -n '1,8p'",
  ]
  let install = ''
  let packageLabel = ''
  let serviceLabel = 'Automatically detected after installation'
  if (packageManager === 'apt-get') {
    packageLabel = flavor === 'recommended' ? 'default-mysql-server' : flavor === 'mysql' ? 'mysql-server' : 'mariadb-server + mariadb-client'
    const packages = flavor === 'recommended' ? 'default-mysql-server' : flavor === 'mysql' ? 'mysql-server' : 'mariadb-server mariadb-client'
    install = [`${elevate}apt-get update`, `${elevate}env DEBIAN_FRONTEND=noninteractive apt-get install -y ${packages}`, ...systemdFinish].join('\n')
  } else if (packageManager === 'dnf' || packageManager === 'yum') {
    const packages = flavor === 'mysql' ? 'mysql-server' : 'mariadb-server'
    packageLabel = packages
    install = [`${elevate}${packageManager} install -y ${packages}`, ...systemdFinish].join('\n')
  } else if (packageManager === 'zypper' && flavor !== 'mysql') {
    packageLabel = 'mariadb + mariadb-tools'
    install = [`${elevate}zypper --non-interactive install mariadb mariadb-tools`, ...systemdFinish].join('\n')
  } else if (packageManager === 'pacman' && flavor !== 'mysql') {
    packageLabel = 'mariadb'
    install = [
      `${elevate}pacman -Sy --noconfirm mariadb`,
      `if [ ! -d /var/lib/mysql/mysql ]; then ${elevate}mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql; fi`,
      ...systemdFinish,
    ].join('\n')
  } else if (packageManager === 'apk' && flavor !== 'mysql') {
    packageLabel = 'mariadb + mariadb-client'
    serviceLabel = 'mariadb (OpenRC)'
    install = [
      `${elevate}apk add --no-cache mariadb mariadb-client`,
      `if [ ! -d /var/lib/mysql/mysql ]; then ${elevate}mariadb-install-db --user=mysql --datadir=/var/lib/mysql; fi`,
      `${elevate}rc-update add mariadb default`,
      `${elevate}service mariadb start`,
      `${elevate}service mariadb status`,
    ].join('\n')
  } else {
    const reason = !packageManager
      ? 'No supported package manager was detected.'
      : flavor === 'mysql'
        ? `Direct MySQL package installation is not mapped safely for ${packageManager}. Choose the recommended compatible server or MariaDB.`
        : `${packageManager} is not supported by this installer yet.`
    return { command: '', packageLabel: 'Unavailable', serviceLabel: 'Unavailable', supported: false, reason }
  }
  return {
    command: ['set -eu', "echo 'Installing MySQL-compatible database server...'", install, "echo 'Database server installation completed.'"].join('\n'),
    packageLabel,
    serviceLabel,
    supported: true,
  }
}

const messageFor = (reason: unknown): string =>
  reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)
const formatBytes = (value: number | null): string => {
  if (value === null) return 'Not detected'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}
const shown = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === '' ? 'Not detected' : String(value)

export function SshDatabases({ connection }: { connection: SshConnection }) {
  const [engine, setEngine] = useState<'mysql' | null>(null)
  const [activeTab, setActiveTab] = useState<DatabaseTab>('overview')
  const [overview, setOverview] = useState<SshMySqlOverview | null>(null)
  const [catalog, setCatalog] = useState<SshAccountCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [installFlavor, setInstallFlavor] = useState<InstallFlavor>('recommended')
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [installerSnippet, setInstallerSnippet] = useState<SshSavedSnippet | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEngine(null)
    setActiveTab('overview')
    setOverview(null)
    setCatalog(null)
    setConfirmInstall(false)
    setInstallerSnippet(null)
    setError(null)
  }, [connection.id])

  const load = useCallback(async (refresh = false): Promise<void> => {
    if (!window.desktop) return
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      setOverview(await window.desktop.ssh.mysqlOverview(connection.id))
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [connection.id])

  const openMySql = (): void => {
    setEngine('mysql')
    if (!overview) void load()
  }

  const openInstall = (): void => {
    setActiveTab('install')
    if (catalog || catalogLoading || !window.desktop) return
    setCatalogLoading(true)
    void window.desktop.ssh.accountCatalog(connection.id)
      .then(setCatalog)
      .catch((reason) => setError(messageFor(reason)))
      .finally(() => setCatalogLoading(false))
  }

  if (!engine) {
    return <section className="ssh-database-picker">
      <header>
        <div>
          <Text fw={740} fz={16}>Databases</Text>
          <Text size="xs" c="dimmed">Choose a database engine to inspect and manage on {connection.name}.</Text>
        </div>
      </header>
      <div className="ssh-database-engine-list">
        <button type="button" onClick={openMySql}>
          <span className="ssh-database-engine-icon"><IconDatabase size={24} /></span>
          <span><strong>MySQL</strong><small>MySQL and compatible MariaDB servers</small></span>
          <Badge size="xs" variant="light" color="teal">Available</Badge>
        </button>
        <div className="ssh-database-future">
          <Text size="xs" c="dimmed">Additional database engines will be added after the MySQL workflow is complete.</Text>
        </div>
      </div>
    </section>
  }

  const diskPercent = overview?.diskTotalBytes && overview.diskUsedBytes !== null
    ? Math.min(100, overview.diskUsedBytes / overview.diskTotalBytes * 100) : 0
  const active = overview?.serviceState === 'active'
  const engineName = overview?.engine === 'mariadb' ? 'MariaDB'
    : overview?.engine === 'mysql' ? 'MySQL' : 'MySQL'
  const installPlan = installPlanFor(overview?.packageManager ?? null, installFlavor, catalog?.currentUser === 'root')
  const canInstall = Boolean(overview && !overview.installed && catalog?.canManage && installPlan.supported)
  const beginInstall = (): void => {
    if (!canInstall) return
    setConfirmInstall(false)
    setInstallerSnippet({
      id: `mysql-install-${Date.now()}`,
      name: `Install ${installFlavor === 'mysql' ? 'MySQL' : installFlavor === 'mariadb' ? 'MariaDB' : 'recommended MySQL-compatible server'}`,
      template: installPlan.command,
      updatedAt: new Date().toISOString(),
    })
  }

  return <section className="ssh-database-workspace">
    <header className="ssh-database-header">
      <Group gap={8} wrap="nowrap">
        <Tooltip label="Choose another database engine">
          <ActionIcon variant="subtle" color="gray" onClick={() => setEngine(null)}><IconArrowLeft size={17} /></ActionIcon>
        </Tooltip>
        <span className="ssh-database-engine-icon"><IconDatabase size={20} /></span>
        <div>
          <Group gap={7}><Text fw={740}>{engineName}</Text>
            {overview && <Badge size="xs" variant="light" color={!overview.installed ? 'gray' : active ? 'teal' : 'yellow'}>
              {!overview.installed ? 'Not installed' : active ? 'Running' : overview.serviceState}
            </Badge>}
          </Group>
          <Text size="xs" c="dimmed">{connection.username}@{connection.host}</Text>
        </div>
      </Group>
      <Tooltip label="Refresh MySQL discovery">
        <ActionIcon variant="subtle" color="gray" loading={refreshing} onClick={() => void load(true)}>
          <IconRefresh size={16} />
        </ActionIcon>
      </Tooltip>
    </header>

    <nav className="ssh-database-tabs" aria-label="MySQL management sections">
      <button type="button" data-active={activeTab === 'overview' || undefined} onClick={() => setActiveTab('overview')}>Overview</button>
      <button type="button" data-active={activeTab === 'install' || undefined} onClick={openInstall}>Install</button>
      <button type="button" data-active={activeTab === 'databases' || undefined} disabled={!overview?.installed} onClick={() => setActiveTab('databases')}>Databases</button>
      <button type="button" data-active={activeTab === 'tables' || undefined} disabled={!overview?.installed} onClick={() => setActiveTab('tables')}>Tables</button>
      <button type="button" data-active={activeTab === 'users' || undefined} disabled={!overview?.installed} onClick={() => setActiveTab('users')}>Users & Access</button>
      <button type="button" data-active={activeTab === 'sql' || undefined} disabled={!overview?.installed} onClick={() => setActiveTab('sql')}>SQL</button>
      {['Backup & Restore', 'Administration', 'Logs'].map((label) =>
        <Tooltip label="Available in a later implementation step" key={label}>
          <button type="button" disabled>{label}</button>
        </Tooltip>)}
    </nav>

    {error && <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>
      {error}
    </Alert>}

    {activeTab === 'install' && <div className="ssh-database-install">
      <header>
        <div>
          <Text fw={720}>Install a database server</Text>
          <Text size="xs" c="dimmed">Choose an engine, inspect the exact plan, then confirm. Nothing runs when changing these options.</Text>
        </div>
        <Badge size="sm" variant="light" color="gray">{overview?.operatingSystem ?? 'Server not inspected'}</Badge>
      </header>

      {loading || catalogLoading ? <div className="ssh-database-loading"><Loader size="sm" /><Text size="sm">Checking server and privileges...</Text></div>
        : overview?.installed ? <div className="ssh-database-not-installed">
          <IconCircleCheck size={34} />
          <Text fw={720}>{engineName} is already installed</Text>
          <Text size="sm" c="dimmed">Package installation is disabled to avoid replacing or changing the existing database server.</Text>
          <Button size="xs" variant="light" onClick={() => setActiveTab('overview')}>View overview</Button>
        </div> : overview ? <>
          <section className="ssh-database-install-section">
            <div className="ssh-database-section-title"><span>1</span><div><strong>Choose the server package</strong><small>The recommended option follows this operating system's supported MySQL-compatible package.</small></div></div>
            <div className="ssh-database-flavors">
              <button type="button" data-selected={installFlavor === 'recommended' || undefined} onClick={() => setInstallFlavor('recommended')}>
                <Badge size="xs" color="teal">Recommended</Badge><strong>System default</strong><small>Best compatibility and security updates from the OS vendor.</small>
              </button>
              <button type="button" data-selected={installFlavor === 'mysql' || undefined} onClick={() => setInstallFlavor('mysql')}>
                <strong>MySQL package</strong><small>Requests the distribution's <code>mysql-server</code> package.</small>
              </button>
              <button type="button" data-selected={installFlavor === 'mariadb' || undefined} onClick={() => setInstallFlavor('mariadb')}>
                <strong>MariaDB</strong><small>Open-source, MySQL-compatible server and client tools.</small>
              </button>
            </div>
          </section>

          <section className="ssh-database-install-section">
            <div className="ssh-database-section-title"><span>2</span><div><strong>Review the detected plan</strong><small>The app only uses this fixed plan after your confirmation.</small></div></div>
            <div className="ssh-database-install-facts">
              <div><small>Package manager</small><strong>{shown(overview.packageManager)}</strong></div>
              <div><small>Package</small><strong>{installPlan.packageLabel}</strong></div>
              <div><small>Service</small><strong>{installPlan.serviceLabel}</strong></div>
              <div><small>Privilege</small><strong>{catalog?.currentUser === 'root' ? 'Connected as root' : catalog?.canManage ? 'Passwordless sudo available' : 'Administrator access required'}</strong></div>
            </div>
            {!catalog?.canManage && <Alert color="yellow" icon={<IconLock size={16} />}>
              {catalog?.privilegeMessage ?? 'This SSH account cannot perform administrator operations. Connect as root or configure passwordless sudo.'}
            </Alert>}
            {!installPlan.supported && <Alert color="yellow" icon={<IconAlertCircle size={16} />}>{installPlan.reason}</Alert>}
            {installPlan.command && <div className="ssh-database-command-preview">
              <header><span>Exact terminal-compatible plan</span><Badge size="xs" variant="light" color="gray">Not running</Badge></header>
              <pre>{installPlan.command}</pre>
            </div>}
          </section>

          <footer className="ssh-database-install-footer">
            <div><strong>What this changes</strong><small>Refreshes package metadata when required, installs the selected packages, starts the database service, and enables it at boot. It does not create databases, users, or change network access.</small></div>
            <Button leftSection={<IconDownload size={15} />} disabled={!canInstall} onClick={() => setConfirmInstall(true)}>Review and install</Button>
          </footer>
        </> : <div className="ssh-database-loading"><IconDatabase size={30} /><Text size="sm">Inspect the server before installing.</Text><Button size="xs" onClick={() => void load()}>Inspect server</Button></div>}
    </div>}

    {activeTab === 'databases' && overview?.installed && <SshMySqlDatabases connection={connection} overview={overview} />}
    {activeTab === 'tables' && overview?.installed && <SshMySqlTables connection={connection} onNeedAccess={() => setActiveTab('databases')} />}
    {activeTab === 'users' && overview?.installed && <SshMySqlUsers connection={connection} onNeedAccess={() => setActiveTab('databases')} />}
    {activeTab === 'sql' && overview?.installed && <SshMySqlQuery connection={connection} onNeedAccess={() => setActiveTab('databases')} />}

    {activeTab === 'overview' && (loading ? <div className="ssh-database-loading"><Loader size="sm" /><Text size="sm">Inspecting MySQL on the server...</Text></div>
      : overview && !overview.installed ? <div className="ssh-database-not-installed">
        <IconDatabase size={34} />
        <Text fw={720}>MySQL server is not installed</Text>
        <Text size="sm" c="dimmed" ta="center" maw={520}>
          {overview.clientInstalled
            ? 'MySQL client tools are available, but no local MySQL or MariaDB server executable was detected.'
            : 'No local MySQL or MariaDB server or client executable was detected.'}
        </Text>
        <div className="ssh-database-readonly-note">Use the Install tab to preview and install a supported package safely.</div>
        <Button size="xs" leftSection={<IconDownload size={14} />} onClick={openInstall}>Open installer</Button>
        <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void load(true)}>Detect again</Button>
      </div> : overview ? <>
        <div className="ssh-database-summary">
          <article>
            <IconCircleCheck size={18} />
            <span><small>Engine</small><strong>{engineName}</strong><em>{overview.version ?? 'Version unavailable'}</em></span>
          </article>
          <article data-warning={!active || undefined}>
            <IconServer size={18} />
            <span><small>Service</small><strong>{overview.serviceState}</strong><em>{overview.serviceName ? `${overview.serviceName}.service` : 'Unit not detected'}</em></span>
          </article>
          <article>
            <IconDatabase size={18} />
            <span><small>Endpoint</small><strong>{overview.port ? `Port ${overview.port}` : overview.socket ?? 'Not detected'}</strong>
              <em>{overview.bindAddress ?? overview.socket ?? 'No bind or socket reported'}</em></span>
          </article>
          <article>
            <IconDatabase size={18} />
            <span><small>Data storage</small><strong>{formatBytes(overview.diskUsedBytes)} used</strong>
              <em>{overview.dataDirectory ?? 'Data directory not detected'}</em></span>
          </article>
        </div>

        {overview.diskTotalBytes !== null && <section className="ssh-database-disk">
          <Group justify="space-between"><Text size="xs" fw={650}>Filesystem containing database data</Text>
            <Text size="xs" c="dimmed">{formatBytes(overview.diskUsedBytes)} / {formatBytes(overview.diskTotalBytes)}</Text></Group>
          <Progress size={6} mt={6} value={diskPercent} color={diskPercent >= 90 ? 'red' : diskPercent >= 80 ? 'yellow' : 'teal'} />
        </section>}

        <div className="ssh-database-details">
          <section>
            <header>Server</header>
            <dl>
              <dt>Engine</dt><dd>{engineName}</dd>
              <dt>Server executable</dt><dd>{shown(overview.serverExecutable)}</dd>
              <dt>Process ID</dt><dd>{shown(overview.processId)}</dd>
              <dt>Active since</dt><dd>{shown(overview.activeSince)}</dd>
              <dt>Starts automatically</dt><dd>{overview.serviceEnabled === null ? 'Not detected' : overview.serviceEnabled ? 'Yes' : 'No'}</dd>
              <dt>Administrative access</dt><dd>Not configured</dd>
            </dl>
          </section>
          <section>
            <header>Connection and storage</header>
            <dl>
              <dt>Port</dt><dd>{shown(overview.port)}</dd>
              <dt>Unix socket</dt><dd>{shown(overview.socket)}</dd>
              <dt>Bind address</dt><dd>{shown(overview.bindAddress)}</dd>
              <dt>Data directory</dt><dd>{shown(overview.dataDirectory)}</dd>
              <dt>Disk available</dt><dd>{formatBytes(overview.diskAvailableBytes)}</dd>
              <dt>Package manager</dt><dd>{shown(overview.packageManager)}</dd>
            </dl>
          </section>
          <section>
            <header>Client tools</header>
            <dl>
              <dt>Client installed</dt><dd>{overview.clientInstalled ? 'Yes' : 'No'}</dd>
              <dt>Client executable</dt><dd>{shown(overview.clientExecutable)}</dd>
              <dt>Client version</dt><dd>{shown(overview.clientVersion)}</dd>
              <dt>Detected tools</dt><dd>{overview.clientTools.length ? overview.clientTools.join(', ') : 'None detected'}</dd>
              <dt>Operating system</dt><dd>{overview.operatingSystem}</dd>
              <dt>Last inspected</dt><dd>{new Date(overview.fetchedAt).toLocaleString()}</dd>
            </dl>
          </section>
          <section>
            <header>Configuration files</header>
            {overview.configFiles.length
              ? <ul>{overview.configFiles.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
              : <Text size="xs" c="dimmed">No standard MySQL configuration file was found.</Text>}
          </section>
        </div>
      </> : <div className="ssh-database-loading">
        <IconDatabase size={30} /><Text size="sm">MySQL has not been inspected yet.</Text>
        <Button size="xs" onClick={() => void load()}>Inspect MySQL</Button>
      </div>)}

    <Modal opened={confirmInstall} onClose={() => setConfirmInstall(false)} title="Confirm database server installation" size="lg" centered>
      <div className="ssh-database-confirm">
        <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
          This changes packages and services on <strong>{connection.name}</strong>. Existing database software was not detected, but you should still have a server backup or snapshot.
        </Alert>
        <div><small>Target server</small><strong>{connection.username}@{connection.host}:{connection.port}</strong></div>
        <div><small>Selected package</small><strong>{installPlan.packageLabel}</strong></div>
        <pre>{installPlan.command}</pre>
        <Group justify="flex-end" gap={7}>
          <Button variant="default" onClick={() => setConfirmInstall(false)}>Cancel</Button>
          <Button color="teal" leftSection={<IconPlayerPlay size={14} />} onClick={beginInstall}>Install and start</Button>
        </Group>
      </div>
    </Modal>

    <SshSnippetRunner connection={connection} snippet={installerSnippet}
      onOpenTerminal={() => undefined}
      onClose={() => {
        setInstallerSnippet(null)
        setActiveTab('overview')
        void load(true)
      }} />
  </section>
}
