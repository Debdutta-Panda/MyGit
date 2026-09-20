import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Checkbox, Group, Loader, MultiSelect, Progress, SegmentedControl, Switch, Text } from '@mantine/core'
import { IconAlertCircle, IconArchive, IconCheck, IconDatabaseExport, IconDatabaseImport, IconDownload, IconFileSearch, IconHistory, IconRestore, IconShieldLock, IconSquare, IconUpload } from '@tabler/icons-react'
import type { SshConnection, SshMySqlAccessProfile, SshMySqlDatabase, SshMySqlExportProgress, SshMySqlExportResult, SshMySqlImportInspection } from '../../shared/desktop-api'

type TransferTab = 'export' | 'backup' | 'import' | 'restore' | 'history' | 'schedules'
const messageFor = (reason: unknown): string => reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)
const formatBytes = (value: number): string => {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let amount = value; let index = 0
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1 }
  return `${amount >= 10 || !index ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

export function SshMySqlTransfer({ connection, onNeedAccess }: { connection: SshConnection; onNeedAccess: () => void }) {
  const [tab, setTab] = useState<TransferTab>('export')
  const [profile, setProfile] = useState<SshMySqlAccessProfile | null>(null)
  const [databases, setDatabases] = useState<SshMySqlDatabase[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [content, setContent] = useState<'structure' | 'data' | 'structure-and-data'>('structure-and-data')
  const [triggers, setTriggers] = useState(true)
  const [routines, setRoutines] = useState(false)
  const [events, setEvents] = useState(false)
  const [singleTransaction, setSingleTransaction] = useState(true)
  const [compression, setCompression] = useState<'none' | 'gzip'>('gzip')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<SshMySqlExportProgress | null>(null)
  const [history, setHistory] = useState<SshMySqlExportResult[]>([])
  const [inspection, setInspection] = useState<SshMySqlImportInspection | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const runIdRef = useRef<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true); setError(null)
    try {
      const access = await window.desktop.ssh.mysqlAccessProfile(connection.id); setProfile(access)
      if (!access) { setDatabases([]); setSelected([]); return }
      const items = (await window.desktop.ssh.mysqlDatabases(connection.id)).filter((item) => !item.system)
      setDatabases(items); setSelected((current) => current.filter((name) => items.some((item) => item.name === name)))
    } catch (reason) { setError(messageFor(reason)) } finally { setLoading(false) }
  }, [connection.id])

  useEffect(() => { void load() }, [load])
  useEffect(() => window.desktop?.ssh.onMysqlExportProgress((next) => {
    if (next.runId === runIdRef.current) setProgress(next)
  }), [])

  const estimatedBytes = useMemo(() => databases.filter((item) => selected.includes(item.name)).reduce((sum, item) => sum + item.sizeBytes, 0), [databases, selected])
  const percent = progress?.phase === 'completed' ? 100 : progress?.estimatedTotalBytes
    ? Math.min(99, progress.processedBytes / progress.estimatedTotalBytes * 100) : 0

  const prepareBackup = (): void => {
    setTab('backup'); setContent('structure-and-data'); setTriggers(true); setRoutines(true); setEvents(true); setSingleTransaction(true); setCompression('gzip')
  }
  const start = async (): Promise<void> => {
    if (!window.desktop || !selected.length || running) return
    const runId = crypto.randomUUID(); runIdRef.current = runId
    setRunning(true); setError(null); setProgress({ runId, phase: 'starting', databaseCount: selected.length, processedBytes: 0, estimatedTotalBytes: estimatedBytes, outputBytes: 0, message: 'Waiting for destination…' })
    try {
      const result = await window.desktop.ssh.exportMysql(connection.id, { runId, databases: selected, content, includeTriggers: triggers, includeRoutines: routines, includeEvents: events, singleTransaction, compression })
      if (!result) { setProgress(null); return }
      if (!result.cancelled) setHistory((current) => [result, ...current])
    } catch (reason) { setError(messageFor(reason)) } finally { setRunning(false); runIdRef.current = null }
  }
  const cancel = async (): Promise<void> => { if (runIdRef.current) await window.desktop?.ssh.cancelMysqlExport(runIdRef.current) }
  const inspectImport = async (): Promise<void> => {
    if (!window.desktop || inspecting) return
    setInspecting(true); setError(null)
    try {
      const result = await window.desktop.ssh.inspectMysqlImport()
      if (result) setInspection(result)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setInspecting(false)
    }
  }

  if (loading && !profile) return <div className="ssh-mysql-access-empty"><Loader size="sm" /><Text size="sm">Preparing transfer workspace…</Text></div>
  if (!profile) return <div className="ssh-mysql-access-empty"><IconShieldLock size={38} /><Text fw={730}>Database access is not configured</Text><Text size="sm" c="dimmed">Configure administration access before exporting databases.</Text>{error && <Alert color="red">{error}</Alert>}<Button size="xs" onClick={onNeedAccess}>Configure access</Button></div>

  return <div className="ssh-db-transfer">
    <header><div><Text fw={730}>Backup / Import / Export</Text><Text size="xs" c="dimmed">Portable data movement and recoverable database copies</Text></div><Badge size="xs" variant="light" color="teal">Export ready</Badge></header>
    <nav>{([
      ['export', 'Export', <IconDatabaseExport size={14} />], ['backup', 'Backup', <IconArchive size={14} />], ['import', 'Import', <IconDatabaseImport size={14} />], ['restore', 'Restore', <IconRestore size={14} />], ['history', 'History', <IconHistory size={14} />], ['schedules', 'Schedules', <IconUpload size={14} />],
    ] as const).map(([value, label, icon]) => <button type="button" key={value} data-active={tab === value || undefined} onClick={() => value === 'backup' ? prepareBackup() : setTab(value)}>{icon}{label}</button>)}</nav>
    {error && <Alert className="ssh-transfer-error" color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>{error}</Alert>}

    {(tab === 'export' || tab === 'backup') && <div className="ssh-transfer-config">
      <section><header><span>1</span><div><strong>{tab === 'backup' ? 'Choose databases to back up' : 'Choose databases to export'}</strong><small>System schemas are excluded. Selection only prepares the job.</small></div></header><MultiSelect searchable clearable label="Databases" placeholder="Select one or more databases" data={databases.map((item) => ({ value: item.name, label: `${item.name} · ${formatBytes(item.sizeBytes)}` }))} value={selected} onChange={setSelected} /><Group gap={5}><Button size="compact-xs" variant="subtle" onClick={() => setSelected(databases.map((item) => item.name))}>Select all</Button><Button size="compact-xs" variant="subtle" onClick={() => setSelected([])}>Clear</Button></Group></section>
      <section><header><span>2</span><div><strong>Choose content</strong><small>Backup mode starts with the recovery-safe full preset; every option remains visible.</small></div></header><SegmentedControl fullWidth value={content} onChange={(value) => setContent(value as typeof content)} data={[{ value: 'structure-and-data', label: 'Structure + data' }, { value: 'structure', label: 'Structure only' }, { value: 'data', label: 'Data only' }]} /><div className="ssh-transfer-switches"><Switch size="sm" label="Triggers" checked={triggers} onChange={(event) => setTriggers(event.currentTarget.checked)} /><Switch size="sm" label="Stored routines" checked={routines} onChange={(event) => setRoutines(event.currentTarget.checked)} /><Switch size="sm" label="Scheduled events" checked={events} onChange={(event) => setEvents(event.currentTarget.checked)} /><Switch size="sm" label="Single transaction" description="Consistent InnoDB snapshot without locking tables" checked={singleTransaction} onChange={(event) => setSingleTransaction(event.currentTarget.checked)} /></div></section>
      <section><header><span>3</span><div><strong>Output</strong><small>The app asks for a local destination only after Run is clicked.</small></div></header><SegmentedControl value={compression} onChange={(value) => setCompression(value as typeof compression)} data={[{ value: 'gzip', label: 'Compressed .sql.gz' }, { value: 'none', label: 'Plain .sql' }]} /><div className="ssh-transfer-summary"><div><small>Databases</small><strong>{selected.length}</strong></div><div><small>Catalog size</small><strong>{formatBytes(estimatedBytes)}</strong></div><div><small>Authentication</small><strong>{profile.mode === 'system' ? 'System administrator' : profile.username}</strong></div><div><small>Destination</small><strong>Choose on run</strong></div></div><Alert color="blue" variant="light">Export reads schema and rows through <code>mysqldump</code>. It does not alter the selected databases. Passwords are never placed in command arguments or output.</Alert></section>
      <footer><div><strong>Nothing has run yet</strong><small>Review selections, choose Run, then approve the local save destination.</small></div>{running ? <Button color="red" variant="light" leftSection={<IconSquare size={13} />} onClick={() => void cancel()}>Cancel export</Button> : <Button disabled={!selected.length} leftSection={<IconDownload size={14} />} onClick={() => void start()}>{tab === 'backup' ? 'Create backup' : 'Run export'}</Button>}</footer>
    </div>}

    {tab === 'import' && <div className="ssh-import-inspector">
      <header><div><Text fw={720}>Inspect an import safely</Text><Text size="xs" c="dimmed">Reads a bounded local sample only. Nothing is uploaded or executed.</Text></div><Button size="xs" loading={inspecting} leftSection={<IconFileSearch size={14} />} onClick={() => void inspectImport()}>{inspection ? 'Choose another file' : 'Choose SQL dump'}</Button></header>
      {!inspection ? <div className="ssh-transfer-coming"><IconDatabaseImport size={36} /><Text fw={720}>Choose a .sql or .sql.gz dump</Text><Text size="sm" c="dimmed" ta="center" maw={580}>MyRepos will inspect its structure, identify databases and tables, count recognized operations, and highlight statements that could remove data or change server accounts.</Text><Badge variant="outline" color="teal">Read-only local inspection</Badge></div> : <div className="ssh-import-results">
        <section className="ssh-import-file"><IconDatabaseImport size={25} /><div><strong>{inspection.name}</strong><small title={inspection.path}>{inspection.path}</small></div><Badge size="sm" variant="light">{inspection.compression === 'gzip' ? 'GZIP' : 'SQL'}</Badge><span>{formatBytes(inspection.fileBytes)}</span></section>
        {inspection.sampleTruncated && <Alert color="blue" variant="light" icon={<IconAlertCircle size={15} />}>Analysis uses the first {formatBytes(inspection.sampledBytes)} of decompressed SQL. Counts and detected objects are sample-based; execution remains disabled.</Alert>}
        <div className="ssh-import-summary"><article><small>Databases detected</small><strong>{inspection.databases.length}</strong></article><article><small>Tables detected</small><strong>{inspection.tables.length}</strong></article><article><small>Recognized operations</small><strong>{inspection.statementCounts.reduce((sum, item) => sum + item.count, 0)}</strong></article><article data-danger={inspection.warnings.some((item) => item.severity === 'danger') || undefined}><small>Safety findings</small><strong>{inspection.warnings.length}</strong></article></div>
        {inspection.warnings.length > 0 ? <section className="ssh-import-findings"><header><strong>Safety findings</strong><small>These must be resolved or explicitly accepted in a later execution step.</small></header>{inspection.warnings.map((warning) => <div key={warning.operation} data-severity={warning.severity}><IconAlertCircle size={15} /><span><strong>{warning.operation} · {warning.count}</strong><small>{warning.message}</small></span></div>)}</section> : <Alert color="teal" variant="light" icon={<IconCheck size={15} />}>No destructive or server-account statements were found in the inspected sample.</Alert>}
        <div className="ssh-import-detail-grid"><section><header><strong>Detected databases</strong><Badge size="xs" variant="outline">{inspection.databases.length}</Badge></header><div>{inspection.databases.length ? inspection.databases.map((name) => <code key={name}>{name}</code>) : <small>No CREATE DATABASE or USE statement detected.</small>}</div></section><section><header><strong>Detected tables</strong><Badge size="xs" variant="outline">{inspection.tables.length}</Badge></header><div>{inspection.tables.length ? inspection.tables.map((name) => <code key={name}>{name}</code>) : <small>No table declarations detected in the sample.</small>}</div></section></div>
        <section className="ssh-import-operations"><header><strong>Statement profile</strong><small>Recognized statement families in the inspected sample</small></header><div>{inspection.statementCounts.map((item) => <span key={item.operation}><code>{item.operation}</code><strong>{item.count}</strong></span>)}{!inspection.statementCounts.length && <small>No supported SQL statements detected.</small>}</div></section>
        <details className="ssh-import-preview"><summary>SQL sample preview</summary><pre>{inspection.preview}</pre></details>
        <footer><div><strong>Inspection complete</strong><small>Target mapping, conflict policy and dry-run preview are the next stage. Import execution is still unavailable.</small></div><Button size="xs" variant="default" onClick={() => setInspection(null)}>Clear inspection</Button></footer>
      </div>}
    </div>}
    {tab === 'restore' && <div className="ssh-transfer-coming"><IconRestore size={34} /><Text fw={720}>Guarded restore is not enabled yet</Text><Text size="sm" c="dimmed" ta="center" maw={560}>Restore requires target verification, overwrite detection, an exact confirmation, and a complete streamed result.</Text><Badge variant="outline" color="yellow">No database action available</Badge></div>}
    {tab === 'history' && <div className="ssh-transfer-history">{history.map((item) => <article key={item.runId}><IconCheck size={17} /><div><strong>{item.path.split(/[\\/]/).at(-1)}</strong><small>{item.path}</small></div><span>{formatBytes(item.bytes)}</span><time>{new Date(item.finishedAt).toLocaleString()}</time></article>)}{!history.length && <div className="ssh-transfer-coming"><IconHistory size={34} /><Text fw={700}>No exports in this session</Text><Text size="sm" c="dimmed">Completed exports will appear here. Persistent history arrives with backup profiles.</Text></div>}</div>}
    {tab === 'schedules' && <div className="ssh-transfer-coming"><IconArchive size={34} /><Text fw={720}>Schedules follow persistent backup profiles</Text><Text size="sm" c="dimmed" ta="center" maw={560}>Retention, rotation, cron/systemd integration, and failure reporting will be added after restore validation.</Text><Badge variant="outline" color="gray">Not active</Badge></div>}

    {progress && <div className="ssh-transfer-progress" data-terminal={['completed', 'cancelled', 'failed'].includes(progress.phase) || undefined}><header><Group gap={7}>{running && <Loader size={13} />}<strong>{progress.message}</strong></Group><Badge size="xs" color={progress.phase === 'completed' ? 'teal' : progress.phase === 'failed' ? 'red' : progress.phase === 'cancelled' ? 'gray' : 'blue'}>{progress.phase}</Badge></header><Progress className="ssh-transfer-progress-bar" value={percent} size={7} animated={progress.phase === 'starting' || progress.phase === 'exporting'} color={progress.phase === 'failed' ? 'red' : 'teal'} /><div className="ssh-transfer-progress-stats"><span><small>Progress</small><strong>{percent.toFixed(1)}%</strong></span><span><small>Read from dump</small><strong>{formatBytes(progress.processedBytes)} / ~{formatBytes(progress.estimatedTotalBytes)}</strong></span><span><small>Local output</small><strong>{formatBytes(progress.outputBytes)}</strong></span></div>{!running && <Button size="compact-xs" variant="default" onClick={() => setProgress(null)}>Dismiss</Button>}</div>}
  </div>
}
