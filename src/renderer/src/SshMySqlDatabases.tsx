import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Modal, PasswordInput, Select, Switch, Text, TextInput, Tooltip } from '@mantine/core'
import { IconActivity, IconAlertCircle, IconAlertTriangle, IconCalendarEvent, IconCheck, IconCode, IconCopy, IconDatabase, IconEye, IconKey, IconListDetails, IconPlus, IconRefresh, IconSearch, IconSettings, IconShieldLock, IconTable, IconTools, IconTrash, IconUsers } from '@tabler/icons-react'
import type { SshConnection, SshMySqlAccessMode, SshMySqlAccessProfile, SshMySqlDatabase, SshMySqlDatabaseDetails, SshMySqlDatabaseMaintenanceMessage, SshMySqlOverview } from '../../shared/desktop-api'

const messageFor = (reason: unknown): string => reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)
const formatBytes = (value: number): string => {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let amount = value; let unit = 0
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1 }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}
const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
const collations: Record<string, string[]> = {
  utf8mb4: ['utf8mb4_unicode_ci', 'utf8mb4_general_ci'], utf8: ['utf8_general_ci', 'utf8_unicode_ci'],
  latin1: ['latin1_swedish_ci'], ascii: ['ascii_general_ci'],
}
type DetailTab = 'overview' | 'objects' | 'access' | 'routines' | 'health' | 'settings' | 'maintenance'
type MaintenanceKind = 'check' | 'analyze' | 'optimize'

export function SshMySqlDatabases({ connection, overview }: { connection: SshConnection; overview: SshMySqlOverview }) {
  const [profile, setProfile] = useState<SshMySqlAccessProfile | null>(null)
  const [databases, setDatabases] = useState<SshMySqlDatabase[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [details, setDetails] = useState<SshMySqlDatabaseDetails | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [accessMode, setAccessMode] = useState<SshMySqlAccessMode>('system')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [databaseName, setDatabaseName] = useState('')
  const [characterSet, setCharacterSet] = useState('utf8mb4')
  const [collation, setCollation] = useState('utf8mb4_unicode_ci')
  const [dropTarget, setDropTarget] = useState<SshMySqlDatabase | null>(null)
  const [dropConfirmation, setDropConfirmation] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsCharacterSet, setSettingsCharacterSet] = useState('utf8mb4')
  const [settingsCollation, setSettingsCollation] = useState('utf8mb4_unicode_ci')
  const [settingsConfirmation, setSettingsConfirmation] = useState('')
  const [maintenanceKind, setMaintenanceKind] = useState<MaintenanceKind>('check')
  const [maintenanceTables, setMaintenanceTables] = useState<string[]>([])
  const [maintenanceConfirmation, setMaintenanceConfirmation] = useState('')
  const [maintenanceResult, setMaintenanceResult] = useState<SshMySqlDatabaseMaintenanceMessage[]>([])
  const nameRef = useRef<HTMLInputElement>(null)

  const loadDatabases = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true); setError(null)
    try {
      const items = await window.desktop.ssh.mysqlDatabases(connection.id)
      setDatabases(items)
      setSelected((current) => current && items.some((item) => item.name === current) ? current : (items.find((item) => !item.system)?.name ?? items[0]?.name ?? null))
    } catch (reason) { setError(messageFor(reason)) } finally { setLoading(false) }
  }, [connection.id])

  const loadDetails = useCallback(async (database: string): Promise<void> => {
    if (!window.desktop) return
    setDetailLoading(true); setError(null)
    try { setDetails(await window.desktop.ssh.mysqlDatabaseDetails(connection.id, database)) }
    catch (reason) { setError(messageFor(reason)); setDetails(null) }
    finally { setDetailLoading(false) }
  }, [connection.id])

  useEffect(() => {
    let current = true
    setLoading(true); setProfile(null); setDatabases([]); setDetails(null); setSelected(null); setError(null)
    void window.desktop?.ssh.mysqlAccessProfile(connection.id).then(async (saved) => {
      if (!current) return
      setProfile(saved); setAccessMode(saved?.mode ?? 'system'); setUsername(saved?.username ?? '')
      if (saved) {
        const items = await window.desktop!.ssh.mysqlDatabases(connection.id)
        if (!current) return
        setDatabases(items); setSelected(items.find((item) => !item.system)?.name ?? items[0]?.name ?? null)
      }
    }).catch((reason) => { if (current) setError(messageFor(reason)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [connection.id])

  useEffect(() => { if (selected) void loadDetails(selected); else setDetails(null) }, [selected, loadDetails])
  useEffect(() => { setMaintenanceTables([]); setMaintenanceConfirmation(''); setMaintenanceResult([]) }, [selected])

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return databases.filter((database) => (showSystem || !database.system) && (!query || database.name.toLowerCase().includes(query)))
  }, [databases, filter, showSystem])

  const openAccess = (): void => { setAccessMode(profile?.mode ?? 'system'); setUsername(profile?.username ?? ''); setPassword(''); setAccessOpen(true); setError(null) }
  const saveAccess = async (): Promise<void> => {
    if (!window.desktop) return
    setBusy(true); setError(null)
    try {
      const saved = await window.desktop.ssh.saveMysqlAccess(connection.id, { mode: accessMode, username, password })
      setProfile(saved); setPassword(''); setAccessOpen(false); await loadDatabases()
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false); setLoading(false) }
  }
  const clearAccess = async (): Promise<void> => {
    if (!window.desktop) return
    setBusy(true)
    try { await window.desktop.ssh.clearMysqlAccess(connection.id); setProfile(null); setDatabases([]); setDetails(null); setSelected(null); setAccessOpen(false); setPassword('') }
    catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }
  const createDatabase = async (): Promise<void> => {
    if (!window.desktop) return
    setBusy(true); setError(null)
    try {
      const items = await window.desktop.ssh.manageMysqlDatabase(connection.id, { kind: 'create', name: databaseName, characterSet, collation })
      const created = databaseName.trim(); setDatabases(items); setCreateOpen(false); setDatabaseName(''); setSelected(created)
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }
  const dropDatabase = async (): Promise<void> => {
    if (!window.desktop || !dropTarget) return
    setBusy(true); setError(null)
    try {
      const removed = dropTarget.name
      const items = await window.desktop.ssh.manageMysqlDatabase(connection.id, { kind: 'drop', name: removed, confirmation: dropConfirmation })
      setDatabases(items); setDropTarget(null); setDropConfirmation('')
      if (selected === removed) { setDetails(null); setSelected(items.find((item) => !item.system)?.name ?? items[0]?.name ?? null) }
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }
  const openSettings = (): void => {
    if (!details) return
    setSettingsCharacterSet(details.database.characterSet); setSettingsCollation(details.database.collation)
    setSettingsConfirmation(''); setSettingsOpen(true); setError(null)
  }
  const saveSettings = async (): Promise<void> => {
    if (!window.desktop || !details) return
    setBusy(true); setError(null)
    try {
      const items = await window.desktop.ssh.manageMysqlDatabase(connection.id, { kind: 'alter-defaults', name: details.database.name, characterSet: settingsCharacterSet, collation: settingsCollation, confirmation: settingsConfirmation })
      setDatabases(items); setSettingsOpen(false); await loadDetails(details.database.name)
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }
  const runMaintenance = async (): Promise<void> => {
    if (!window.desktop || !details) return
    setBusy(true); setError(null); setMaintenanceResult([])
    try {
      const result = await window.desktop.ssh.maintainMysqlDatabase(connection.id, { database: details.database.name, kind: maintenanceKind, tables: maintenanceTables, confirmation: maintenanceConfirmation })
      setMaintenanceResult(result); setMaintenanceConfirmation(''); await loadDetails(details.database.name)
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }

  if (loading && !profile) return <div className="ssh-mysql-access-empty"><Loader size="sm" /><Text size="sm">Loading database access...</Text></div>
  if (!profile) return <div className="ssh-mysql-access-empty">
    <IconShieldLock size={38} /><Text fw={730}>Connect database administration</Text>
    <Text size="sm" c="dimmed" ta="center" maw={590}>Choose system-administrator access or a MySQL username and password. Password connections travel inside SSH and are encrypted in the OS-backed vault.</Text>
    {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
    <Button size="xs" leftSection={<IconKey size={14} />} onClick={openAccess}>Configure access</Button>
    <AccessModal opened={accessOpen} onClose={() => setAccessOpen(false)} mode={accessMode} setMode={setAccessMode} username={username} setUsername={setUsername} password={password} setPassword={setPassword} existing={profile} busy={busy} error={error} onSave={() => void saveAccess()} onClear={() => void clearAccess()} />
  </div>

  return <div className="ssh-mysql-databases">
    <header><div><Group gap={7}><Text fw={730}>Databases</Text><Badge size="xs" variant="light" color="teal">{databases.filter((item) => !item.system).length} managed</Badge></Group><Text size="xs" c="dimmed">{profile.mode === 'system' ? 'Local system administrator' : profile.username} · {overview.engine === 'mariadb' ? 'MariaDB' : 'MySQL'} through {connection.name}</Text></div>
      <Group gap={6} wrap="nowrap"><Tooltip label="Change database access"><ActionIcon variant="default" onClick={openAccess}><IconKey size={15} /></ActionIcon></Tooltip><Tooltip label="Refresh catalog"><ActionIcon variant="default" loading={loading || detailLoading} onClick={() => void loadDatabases()}><IconRefresh size={15} /></ActionIcon></Tooltip><Button size="compact-xs" leftSection={<IconPlus size={14} />} onClick={() => { setError(null); setCreateOpen(true) }}>New database</Button></Group></header>
    {error && <Alert className="ssh-db-global-error" color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>{error}</Alert>}
    <div className="ssh-db-workspace">
      <aside className="ssh-db-sidebar"><div className="ssh-db-sidebar-tools"><TextInput size="xs" leftSection={<IconSearch size={13} />} placeholder="Filter databases" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} /><Switch size="xs" label="System" checked={showSystem} onChange={(event) => setShowSystem(event.currentTarget.checked)} /></div>
        <div className="ssh-db-list">{visible.map((database) => <button type="button" key={database.name} data-selected={selected === database.name || undefined} onClick={() => { setSelected(database.name); setDetailTab('overview') }}><IconDatabase size={16} /><span><strong>{database.name}</strong><small>{database.tableCount} objects · {formatBytes(database.sizeBytes)}</small></span>{database.system && <Badge size="xs" variant="outline" color="gray">System</Badge>}</button>)}{!loading && !visible.length && <div className="ssh-mysql-database-empty">{filter ? 'No databases match this filter.' : 'No managed databases yet.'}</div>}</div>
        <footer>{visible.length} shown · select a database for complete details</footer></aside>
      <main className="ssh-db-detail">
        {!selected && <div className="ssh-table-welcome"><IconDatabase size={36} /><strong>Select a database</strong><small>Overview, objects, access, health, settings, and maintenance appear here.</small></div>}
        {selected && detailLoading && !details && <div className="ssh-table-welcome"><Loader size="sm" /><small>Inspecting {selected}...</small></div>}
        {details && <><div className="ssh-db-detail-header"><div><Group gap={6}><Text fw={730}>{details.database.name}</Text>{details.database.system && <Badge size="xs" color="gray" variant="outline">System</Badge>}</Group><small>{details.database.characterSet} · {details.database.collation} · inspected {new Date(details.fetchedAt).toLocaleTimeString()}</small></div><Group gap={5}><Badge size="xs" variant="outline">{details.tableCount} tables</Badge><Badge size="xs" variant="outline">{details.viewCount} views</Badge><Tooltip label="Refresh details"><ActionIcon size="sm" variant="default" loading={detailLoading} onClick={() => void loadDetails(details.database.name)}><IconRefresh size={14} /></ActionIcon></Tooltip></Group></div>
          <nav className="ssh-db-detail-tabs">{([
            ['overview', 'Overview', <IconListDetails size={13} />], ['objects', 'Objects & storage', <IconTable size={13} />], ['access', 'Access', <IconUsers size={13} />], ['routines', 'Routines & events', <IconCalendarEvent size={13} />], ['health', 'Health', <IconActivity size={13} />], ['settings', 'Settings & DDL', <IconSettings size={13} />], ['maintenance', 'Maintenance', <IconTools size={13} />],
          ] as const).map(([value, label, icon]) => <button type="button" key={value} data-active={detailTab === value || undefined} onClick={() => setDetailTab(value)}>{icon}{label}</button>)}</nav>
          <div className="ssh-db-detail-body">{detailTab === 'overview' && <DatabaseOverview details={details} />}{detailTab === 'objects' && <ObjectsPanel details={details} />}{detailTab === 'access' && <AccessPanel details={details} />}{detailTab === 'routines' && <RoutinesPanel details={details} />}{detailTab === 'health' && <HealthPanel details={details} />}{detailTab === 'settings' && <SettingsPanel details={details} onEdit={openSettings} onDelete={() => { setDropTarget(details.database); setDropConfirmation('') }} />}{detailTab === 'maintenance' && <MaintenancePanel details={details} kind={maintenanceKind} setKind={setMaintenanceKind} selected={maintenanceTables} setSelected={setMaintenanceTables} confirmation={maintenanceConfirmation} setConfirmation={setMaintenanceConfirmation} busy={busy} result={maintenanceResult} onRun={() => void runMaintenance()} />}</div>
        </>}
      </main>
    </div>

    <AccessModal opened={accessOpen} onClose={() => setAccessOpen(false)} mode={accessMode} setMode={setAccessMode} username={username} setUsername={setUsername} password={password} setPassword={setPassword} existing={profile} busy={busy} error={error} onSave={() => void saveAccess()} onClear={() => void clearAccess()} />
    <Modal opened={createOpen} onClose={() => !busy && setCreateOpen(false)} title="Create database" centered size="md" onTransitionEnd={() => createOpen && nameRef.current?.focus()}><div className="ssh-mysql-database-form"><TextInput ref={nameRef} label="Database name" description="Letters, numbers, _, $, and -; maximum 64 characters." value={databaseName} onChange={(event) => setDatabaseName(event.currentTarget.value)} /><div><Select label="Character set" data={Object.keys(collations)} value={characterSet} onChange={(value) => { const next = value ?? 'utf8mb4'; setCharacterSet(next); setCollation(collations[next][0]) }} /><Select label="Collation" data={collations[characterSet]} value={collation} onChange={(value) => setCollation(value ?? collations[characterSet][0])} /></div><Alert color="blue" variant="light">Creates an empty database. User permissions are not granted automatically.</Alert>{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setCreateOpen(false)}>Cancel</Button><Button loading={busy} disabled={!databaseName.trim()} onClick={() => void createDatabase()}>Create database</Button></Group></div></Modal>
    <Modal opened={settingsOpen} onClose={() => !busy && setSettingsOpen(false)} title={`Database defaults · ${details?.database.name ?? ''}`} centered size="md"><div className="ssh-mysql-database-form"><Alert color="yellow" icon={<IconAlertTriangle size={16} />}>This changes defaults for newly created objects. It does not convert existing tables or columns.</Alert><div><Select label="Default character set" data={Object.keys(collations)} value={settingsCharacterSet} onChange={(value) => { const next = value ?? 'utf8mb4'; setSettingsCharacterSet(next); setSettingsCollation(collations[next][0]) }} /><Select label="Default collation" data={collations[settingsCharacterSet]} value={settingsCollation} onChange={(value) => setSettingsCollation(value ?? collations[settingsCharacterSet][0])} /></div><TextInput label={<>Type <strong>{details?.database.name}</strong> to confirm</>} value={settingsConfirmation} onChange={(event) => setSettingsConfirmation(event.currentTarget.value)} autoFocus />{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" onClick={() => setSettingsOpen(false)}>Cancel</Button><Button loading={busy} disabled={settingsConfirmation !== details?.database.name} onClick={() => void saveSettings()}>Change defaults</Button></Group></div></Modal>
    <Modal opened={Boolean(dropTarget)} onClose={() => !busy && setDropTarget(null)} title="Delete database" centered size="md"><div className="ssh-mysql-database-form"><Alert color="red" icon={<IconAlertCircle size={16} />}>This permanently deletes <strong>{dropTarget?.name}</strong>, all its tables, and all contained data.</Alert><TextInput label={<>Type <strong>{dropTarget?.name}</strong> to confirm</>} value={dropConfirmation} onChange={(event) => setDropConfirmation(event.currentTarget.value)} autoFocus />{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setDropTarget(null)}>Cancel</Button><Button color="red" loading={busy} disabled={dropConfirmation !== dropTarget?.name} onClick={() => void dropDatabase()}>Permanently delete</Button></Group></div></Modal>
  </div>
}

function DatabaseOverview({ details }: { details: SshMySqlDatabaseDetails }) {
  return <div className="ssh-db-overview"><div className="ssh-db-metrics">
    <Metric label="Tables" value={formatNumber(details.tableCount)} note={`${details.viewCount} views`} icon={<IconTable size={16} />} />
    <Metric label="Estimated rows" value={formatNumber(details.estimatedRows)} note="Engine-reported estimate" icon={<IconListDetails size={16} />} />
    <Metric label="Total size" value={formatBytes(details.dataBytes + details.indexBytes)} note={`${formatBytes(details.indexBytes)} indexes`} icon={<IconDatabase size={16} />} />
    <Metric label="Reusable space" value={formatBytes(details.freeBytes)} note="Reported DATA_FREE" icon={<IconActivity size={16} />} />
  </div><section><header><strong>Storage engines</strong><small>Composition of base tables</small></header><div className="ssh-db-engine-grid">{details.engines.map((engine) => <article key={engine.name}><strong>{engine.name}</strong><span>{engine.tableCount} tables</span><span>{formatNumber(engine.rows)} rows</span><span>{formatBytes(engine.sizeBytes)}</span></article>)}{!details.engines.length && <div className="ssh-db-empty-inline">No base tables.</div>}</div></section>
    <section><header><strong>Largest objects</strong><small>Data + indexes</small></header><ObjectRows tables={details.largestTables.slice(0, 6)} /></section>
  </div>
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) {
  return <article>{icon}<div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></article>
}

function ObjectRows({ tables }: { tables: SshMySqlDatabaseDetails['largestTables'] }) {
  return <div className="ssh-db-object-rows">{tables.map((table) => <div key={table.name}><span>{table.type === 'view' ? <IconEye size={14} /> : <IconTable size={14} />}<strong>{table.name}</strong><Badge size="xs" variant="outline">{table.type}</Badge></span><span>{table.engine ?? '—'}</span><span>{formatNumber(table.rows ?? 0)} rows</span><span>{formatBytes(table.dataBytes)}</span><span>{formatBytes(table.indexBytes)}</span><span>{formatBytes(table.dataBytes + table.indexBytes)}</span></div>)}{!tables.length && <div className="ssh-db-empty-inline">No tables or views.</div>}</div>
}

function ObjectsPanel({ details }: { details: SshMySqlDatabaseDetails }) {
  return <div className="ssh-db-panel"><header><div><strong>Objects & storage</strong><small>All objects; columns, indexes, relations, triggers, and data remain in the Tables tab.</small></div><Badge variant="outline">{details.tableCount + details.viewCount} objects</Badge></header><div className="ssh-db-object-head"><span>Name</span><span>Engine</span><span>Rows</span><span>Data</span><span>Indexes</span><span>Total</span></div><ObjectRows tables={details.tables} /></div>
}

function AccessPanel({ details }: { details: SshMySqlDatabaseDetails }) {
  return <div className="ssh-db-panel"><header><div><strong>Database access</strong><small>Schema-level grants. Edit accounts and privileges in Users & Access.</small></div><Badge variant="outline">{details.accounts.length} accounts</Badge></header><div className="ssh-db-card-list">{details.accounts.map((account) => <article key={`${account.username}@${account.host}`}><IconUsers size={17} /><div><strong>{account.username}@{account.host}</strong><small>{account.privileges.join(', ') || 'No schema privileges'}</small></div>{account.grantable && <Badge size="xs" color="yellow" variant="outline">Grant option</Badge>}</article>)}{!details.accounts.length && <div className="ssh-db-empty-inline">No direct schema grants found. Global privileges may still provide access.</div>}</div></div>
}

function RoutinesPanel({ details }: { details: SshMySqlDatabaseDetails }) {
  return <div className="ssh-db-panel"><header><div><strong>Routines & events</strong><small>Stored procedures, functions, and scheduled events.</small></div><Badge variant="outline">{details.routines.length + details.events.length} objects</Badge></header><div className="ssh-db-section-label">Routines</div><div className="ssh-db-card-list">{details.routines.map((routine) => <article key={`${routine.type}:${routine.name}`}><IconCode size={17} /><div><strong>{routine.name}</strong><small>{routine.type} · {routine.securityType} security · {routine.definer}</small></div><Badge size="xs" variant="outline">{routine.type}</Badge></article>)}{!details.routines.length && <div className="ssh-db-empty-inline">No stored routines.</div>}</div><div className="ssh-db-section-label">Scheduled events</div><div className="ssh-db-card-list">{details.events.map((event) => <article key={event.name}><IconCalendarEvent size={17} /><div><strong>{event.name}</strong><small>{event.schedule} · {event.definer}</small></div><Badge size="xs" color={event.status === 'ENABLED' ? 'teal' : 'gray'} variant="outline">{event.status}</Badge></article>)}{!details.events.length && <div className="ssh-db-empty-inline">No scheduled events.</div>}</div></div>
}

function HealthPanel({ details }: { details: SshMySqlDatabaseDetails }) {
  return <div className="ssh-db-panel"><header><div><strong>Health findings</strong><small>Metadata-based guidance, not a substitute for workload monitoring.</small></div><Badge color={details.health.some((item) => item.severity === 'warning') ? 'yellow' : 'teal'} variant="light">{details.health.length || 'Clear'}</Badge></header><div className="ssh-db-health">{!details.health.length && <article data-level="ok"><IconCheck size={18} /><div><strong>No catalog warnings</strong><p>No obvious metadata issues were detected.</p></div></article>}{details.health.map((finding) => <article key={finding.code} data-level={finding.severity}><IconAlertTriangle size={18} /><div><strong>{finding.title}</strong><p>{finding.detail}</p>{Boolean(finding.tables.length) && <code>{finding.tables.join(', ')}</code>}</div></article>)}</div></div>
}

function SettingsPanel({ details, onEdit, onDelete }: { details: SshMySqlDatabaseDetails; onEdit: () => void; onDelete: () => void }) {
  return <div className="ssh-db-panel"><header><div><strong>Settings & DDL</strong><small>Database defaults affect newly created objects.</small></div>{!details.database.system && <Button size="compact-xs" variant="default" leftSection={<IconSettings size={13} />} onClick={onEdit}>Change defaults</Button>}</header><div className="ssh-db-settings-grid"><article><small>Character set</small><code>{details.database.characterSet}</code></article><article><small>Collation</small><code>{details.database.collation}</code></article><article><small>Last table update</small><strong>{details.lastUpdatedAt ? new Date(details.lastUpdatedAt).toLocaleString() : 'Not reported'}</strong></article><article><small>Catalog size</small><strong>{formatBytes(details.database.sizeBytes)}</strong></article></div><div className="ssh-db-ddl"><header><strong>CREATE DATABASE</strong><Button size="compact-xs" variant="subtle" leftSection={<IconCopy size={13} />} onClick={() => void navigator.clipboard.writeText(details.ddl)}>Copy</Button></header><pre>{details.ddl}</pre></div>{!details.database.system && <div className="ssh-db-danger"><div><strong>Danger zone</strong><small>Deleting a database permanently removes every contained object and row.</small></div><Button size="compact-xs" color="red" variant="light" leftSection={<IconTrash size={13} />} onClick={onDelete}>Delete database</Button></div>}</div>
}

function MaintenancePanel({ details, kind, setKind, selected, setSelected, confirmation, setConfirmation, busy, result, onRun }: { details: SshMySqlDatabaseDetails; kind: MaintenanceKind; setKind: (value: MaintenanceKind) => void; selected: string[]; setSelected: (value: string[]) => void; confirmation: string; setConfirmation: (value: string) => void; busy: boolean; result: SshMySqlDatabaseMaintenanceMessage[]; onRun: () => void }) {
  const tables = details.tables.filter((table) => table.type === 'table').map((table) => table.name)
  const toggle = (name: string): void => setSelected(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name])
  return <div className="ssh-db-panel"><header><div><strong>Table maintenance</strong><small>Choose an operation and exact tables. Changing options never runs anything.</small></div><Badge color="yellow" variant="outline">Confirmation required</Badge></header><div className="ssh-db-maintenance"><div className="ssh-db-maintenance-kinds">{(['check', 'analyze', 'optimize'] as const).map((value) => <button type="button" key={value} data-selected={kind === value || undefined} onClick={() => { setKind(value); setConfirmation('') }}><strong>{value[0].toUpperCase() + value.slice(1)}</strong><small>{value === 'check' ? 'Verify table consistency' : value === 'analyze' ? 'Refresh optimizer statistics' : 'Reorganize storage and reclaim space'}</small></button>)}</div>
    <Alert color={kind === 'optimize' ? 'yellow' : 'blue'} icon={<IconAlertTriangle size={16} />}>{kind === 'optimize' ? 'Optimize may lock or rebuild tables and can be expensive on production databases.' : 'Run during an appropriate operational window. Large tables can take time.'}</Alert>
    <div className="ssh-db-maintenance-select"><header><strong>Tables</strong><Group gap={5}><Button size="compact-xs" variant="subtle" onClick={() => setSelected(tables)}>All</Button><Button size="compact-xs" variant="subtle" onClick={() => setSelected([])}>None</Button></Group></header><div>{tables.map((table) => <Checkbox key={table} size="xs" label={table} checked={selected.includes(table)} onChange={() => toggle(table)} />)}{!tables.length && <small>No base tables available.</small>}</div></div>
    <TextInput label={<>Type <strong>{details.database.name}</strong> to confirm</>} description={`${kind.toUpperCase()} will run on ${selected.length} selected table${selected.length === 1 ? '' : 's'}.`} value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} /><Group justify="flex-end"><Button loading={busy} disabled={!selected.length || confirmation !== details.database.name} leftSection={<IconTools size={14} />} onClick={onRun}>Run {kind}</Button></Group>
    {Boolean(result.length) && <div className="ssh-db-maintenance-result"><header><strong>Last result</strong><Badge color={result.some((item) => !['status', 'note', 'info'].includes(item.messageType.toLowerCase())) ? 'yellow' : 'teal'}>{result.length} messages</Badge></header>{result.map((item, index) => <div key={`${item.table}:${index}`}><code>{item.table}</code><span>{item.operation}</span><Badge size="xs" variant="outline">{item.messageType}</Badge><p>{item.message}</p></div>)}</div>}
  </div></div>
}

function AccessModal({ opened, onClose, mode, setMode, username, setUsername, password, setPassword, existing, busy, error, onSave, onClear }: { opened: boolean; onClose: () => void; mode: SshMySqlAccessMode; setMode: (mode: SshMySqlAccessMode) => void; username: string; setUsername: (value: string) => void; password: string; setPassword: (value: string) => void; existing: SshMySqlAccessProfile | null; busy: boolean; error: string | null; onSave: () => void; onClear: () => void }) {
  return <Modal opened={opened} onClose={() => !busy && onClose()} title="Database administration access" centered size="lg"><div className="ssh-mysql-access-form"><div className="ssh-mysql-access-modes"><button type="button" data-selected={mode === 'system' || undefined} onClick={() => setMode('system')}><IconShieldLock size={18} /><span><strong>System administrator</strong><small>Use local socket authentication through root or passwordless sudo.</small></span></button><button type="button" data-selected={mode === 'password' || undefined} onClick={() => setMode('password')}><IconKey size={18} /><span><strong>MySQL account</strong><small>Connect inside the SSH tunnel with a username and password.</small></span></button></div>{mode === 'password' && <div className="ssh-mysql-access-fields"><TextInput label="MySQL username" value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoFocus /><PasswordInput label="Password" description={existing?.mode === 'password' && existing.hasPassword ? 'Leave blank to keep the saved password.' : 'Stored encrypted in the operating-system vault.'} value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></div>}{mode === 'system' && <Alert color="blue">The app verifies access with <code>sudo -n mysql</code> or the MariaDB equivalent. No database password is stored.</Alert>}{error && <Alert color="red">{error}</Alert>}<Group justify="space-between"><div>{existing && <Button size="xs" variant="subtle" color="red" disabled={busy} onClick={onClear}>Forget access</Button>}</div><Group gap={7}><Button variant="default" disabled={busy} onClick={onClose}>Cancel</Button><Button loading={busy} disabled={mode === 'password' && (!username.trim() || (!password && !existing?.hasPassword))} onClick={onSave}>Test and save</Button></Group></Group></div></Modal>
}
