import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, MultiSelect, Select, Switch, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertCircle, IconBraces, IconColumns, IconCopy, IconDatabase, IconEye, IconKey, IconPlus, IconRefresh, IconSearch, IconTable, IconTrash } from '@tabler/icons-react'
import type { SshConnection, SshMySqlAccessProfile, SshMySqlDatabase, SshMySqlQueryResultSet, SshMySqlTable, SshMySqlTableColumn, SshMySqlTableDetails, SshMySqlTableIndex, SshMySqlTableOperation } from '../../shared/desktop-api'

type DetailTab = 'overview' | 'columns' | 'indexes' | 'relations' | 'triggers' | 'data' | 'ddl'
const columnTypes = ['INT', 'BIGINT', 'BOOLEAN', 'VARCHAR(255)', 'VARCHAR(100)', 'VARCHAR(50)', 'DECIMAL(10,2)', 'TEXT', 'LONGTEXT', 'DATE', 'DATETIME', 'TIMESTAMP', 'JSON']
const messageFor = (reason: unknown): string => reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)
const formatBytes = (value: number): string => { const units = ['B', 'KB', 'MB', 'GB', 'TB']; let amount = value; let index = 0; while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1 } return `${amount >= 10 || !index ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}` }

interface ColumnDraft { oldName: string | null; name: string; columnType: string; nullable: boolean; defaultMode: 'none' | 'null' | 'current-timestamp'; autoIncrement: boolean; after: string | null }
const emptyColumn = (): ColumnDraft => ({ oldName: null, name: '', columnType: 'VARCHAR(255)', nullable: true, defaultMode: 'null', autoIncrement: false, after: null })

export function SshMySqlTables({ connection, onNeedAccess }: { connection: SshConnection; onNeedAccess: () => void }) {
  const [profile, setProfile] = useState<SshMySqlAccessProfile | null>(null)
  const [databases, setDatabases] = useState<SshMySqlDatabase[]>([])
  const [database, setDatabase] = useState<string | null>(null)
  const [tables, setTables] = useState<SshMySqlTable[]>([])
  const [selected, setSelected] = useState<SshMySqlTable | null>(null)
  const [details, setDetails] = useState<SshMySqlTableDetails | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [columnDraft, setColumnDraft] = useState<ColumnDraft | null>(null)
  const [indexDraft, setIndexDraft] = useState<{ name: string; columns: string[]; unique: boolean } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ kind: 'column' | 'index'; name: string } | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [dataResult, setDataResult] = useState<SshMySqlQueryResultSet | null>(null)
  const [dataOffset, setDataOffset] = useState(0)
  const [ddl, setDdl] = useState('')

  const loadBase = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true); setError(null)
    try {
      const access = await window.desktop.ssh.mysqlAccessProfile(connection.id); setProfile(access)
      if (!access) { setDatabases([]); setDatabase(null); return }
      const items = (await window.desktop.ssh.mysqlDatabases(connection.id)).filter((item) => !item.system)
      setDatabases(items); setDatabase((current) => current && items.some((item) => item.name === current) ? current : items[0]?.name ?? null)
    } catch (reason) { setError(messageFor(reason)) } finally { setLoading(false) }
  }, [connection.id])
  useEffect(() => { void loadBase() }, [loadBase])

  const loadTables = useCallback(async (name: string): Promise<void> => {
    if (!window.desktop) return
    setLoading(true); setError(null); setSelected(null); setDetails(null); setDataResult(null); setDdl('')
    try { setTables(await window.desktop.ssh.mysqlTables(connection.id, name)) }
    catch (reason) { setError(messageFor(reason)); setTables([]) } finally { setLoading(false) }
  }, [connection.id])
  useEffect(() => { if (database && profile) void loadTables(database); else setTables([]) }, [database, profile, loadTables])

  const openTable = async (table: SshMySqlTable): Promise<void> => {
    if (!window.desktop) return
    setSelected(table); setDetails(null); setActiveTab('overview'); setDetailLoading(true); setError(null); setDataResult(null); setDdl(''); setDataOffset(0)
    try { setDetails(await window.desktop.ssh.mysqlTableDetails(connection.id, table.database, table.name)) }
    catch (reason) { setError(messageFor(reason)) } finally { setDetailLoading(false) }
  }
  const refreshDetails = async (): Promise<void> => { if (selected) await openTable(selected) }
  const visible = useMemo(() => { const query = filter.trim().toLowerCase(); return tables.filter((table) => !query || table.name.toLowerCase().includes(query)) }, [filter, tables])

  const applyOperation = async (operation: SshMySqlTableOperation): Promise<void> => {
    if (!window.desktop || !selected) return
    setBusy(true); setError(null)
    try {
      const next = await window.desktop.ssh.manageMysqlTable(connection.id, operation); setDetails(next); setSelected(next.table)
      setColumnDraft(null); setIndexDraft(null); setDropTarget(null); setConfirmation('')
      if (database) setTables(await window.desktop.ssh.mysqlTables(connection.id, database))
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }
  const saveColumn = (): void => {
    if (!selected || !columnDraft) return
    const common = { database: selected.database, table: selected.name, name: columnDraft.name, columnType: columnDraft.columnType, nullable: columnDraft.nullable, defaultMode: columnDraft.defaultMode, autoIncrement: columnDraft.autoIncrement }
    void applyOperation(columnDraft.oldName ? { kind: 'alter-column', ...common, oldName: columnDraft.oldName } : { kind: 'add-column', ...common, after: columnDraft.after })
  }
  const editColumn = (column: SshMySqlTableColumn): void => setColumnDraft({ oldName: column.name, name: column.name, columnType: column.columnType.toUpperCase(), nullable: column.nullable, defaultMode: column.defaultValue?.toUpperCase().includes('CURRENT_TIMESTAMP') ? 'current-timestamp' : column.defaultValue === null ? 'none' : column.defaultValue.toUpperCase() === 'NULL' ? 'null' : 'none', autoIncrement: column.extra.toLowerCase().includes('auto_increment'), after: null })
  const loadData = useCallback(async (offset: number): Promise<void> => {
    if (!window.desktop || !selected) return
    setDetailLoading(true); setError(null)
    const runId = crypto.randomUUID()
    try {
      const result = await window.desktop.ssh.runMysqlQuery(connection.id, runId, { database: selected.database, sql: `SELECT * FROM \`${selected.name.replace(/`/g, '``')}\` LIMIT 100 OFFSET ${offset}`, rowLimit: 100, readOnly: true, destructiveConfirmation: null })
      setDataResult(result.resultSets[0] ?? null); setDataOffset(offset)
    } catch (reason) { setError(messageFor(reason)) } finally { setDetailLoading(false) }
  }, [connection.id, selected])
  const loadDdl = useCallback(async (): Promise<void> => {
    if (!window.desktop || !selected) return
    setDetailLoading(true); setError(null)
    try {
      const result = await window.desktop.ssh.runMysqlQuery(connection.id, crypto.randomUUID(), { database: selected.database, sql: `SHOW CREATE ${selected.type === 'view' ? 'VIEW' : 'TABLE'} \`${selected.name.replace(/`/g, '``')}\``, rowLimit: 10, readOnly: true, destructiveConfirmation: null })
      const set = result.resultSets[0]; setDdl(set?.rows[0]?.[1] === undefined ? '' : String(set.rows[0][1]))
    } catch (reason) { setError(messageFor(reason)) } finally { setDetailLoading(false) }
  }, [connection.id, selected])
  useEffect(() => { if (activeTab === 'data' && selected && !dataResult) void loadData(0); if (activeTab === 'ddl' && selected && !ddl) void loadDdl() }, [activeTab, dataResult, ddl, loadData, loadDdl, selected])

  if (loading && !profile) return <div className="ssh-mysql-access-empty"><Loader size="sm" /><Text size="sm">Loading tables...</Text></div>
  if (!profile) return <div className="ssh-mysql-access-empty"><IconDatabase size={38} /><Text fw={730}>Database access is not configured</Text><Text size="sm" c="dimmed">Configure administration access before exploring tables.</Text><Button size="xs" onClick={onNeedAccess}>Configure access</Button></div>

  return <div className="ssh-table-workspace">
    <aside className="ssh-table-sidebar">
      <header><Select size="xs" searchable placeholder="Choose database" data={databases.map((item) => item.name)} value={database} onChange={setDatabase} /><Tooltip label="Refresh tables"><ActionIcon variant="subtle" loading={loading} onClick={() => database && void loadTables(database)}><IconRefresh size={14} /></ActionIcon></Tooltip></header>
      <TextInput size="xs" leftSection={<IconSearch size={13} />} placeholder="Filter tables and views" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />
      <div className="ssh-table-list">{visible.map((table) => <button type="button" key={table.name} data-selected={selected?.name === table.name || undefined} onClick={() => void openTable(table)}>{table.type === 'view' ? <IconEye size={14} /> : <IconTable size={14} />}<span><strong>{table.name}</strong><small>{table.type === 'view' ? 'View' : `${table.rows ?? 0} rows · ${formatBytes(table.dataBytes + table.indexBytes)}`}</small></span></button>)}
        {!loading && !visible.length && <div className="ssh-table-list-empty">{database ? 'No matching tables or views.' : 'Choose a database.'}</div>}</div>
      <footer>{tables.filter((item) => item.type === 'table').length} tables · {tables.filter((item) => item.type === 'view').length} views</footer>
    </aside>
    <main className="ssh-table-detail">
      {error && <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>{error}</Alert>}
      {!selected ? <div className="ssh-table-welcome"><IconTable size={34} /><Text fw={700}>Select a table or view</Text><Text size="xs" c="dimmed">Its structure, data, relations, triggers, and DDL will open here.</Text></div>
        : <><header className="ssh-table-detail-header"><div><Group gap={7}><Text fw={740}>{selected.name}</Text><Badge size="xs" variant="light" color={selected.type === 'view' ? 'blue' : 'teal'}>{selected.type}</Badge></Group><Text size="xs" c="dimmed">{selected.database} · {selected.engine ?? 'View'}</Text></div><Tooltip label="Refresh selected table"><ActionIcon variant="default" loading={detailLoading} onClick={() => void refreshDetails()}><IconRefresh size={15} /></ActionIcon></Tooltip></header>
          <nav className="ssh-table-detail-tabs">{(['overview', 'columns', 'indexes', 'relations', 'triggers', 'data', 'ddl'] as DetailTab[]).map((tab) => <button type="button" key={tab} data-active={activeTab === tab || undefined} onClick={() => setActiveTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav>
          {detailLoading && !details ? <div className="ssh-database-loading"><Loader size="sm" /> Loading table metadata...</div> : details && <div className="ssh-table-detail-body">
            {activeTab === 'overview' && <TableOverview details={details} />}
            {activeTab === 'columns' && <ColumnsPanel details={details} onAdd={() => { setError(null); setColumnDraft(emptyColumn()) }} onEdit={editColumn} onDrop={(name) => { setError(null); setDropTarget({ kind: 'column', name }); setConfirmation('') }} />}
            {activeTab === 'indexes' && <IndexesPanel details={details} onAdd={() => { setError(null); setIndexDraft({ name: '', columns: [], unique: false }) }} onDrop={(index) => { setError(null); setDropTarget({ kind: 'index', name: index.name }); setConfirmation('') }} />}
            {activeTab === 'relations' && <RelationsPanel details={details} />}
            {activeTab === 'triggers' && <TriggersPanel details={details} />}
            {activeTab === 'data' && <DataPanel result={dataResult} offset={dataOffset} loading={detailLoading} onPage={(offset) => void loadData(offset)} />}
            {activeTab === 'ddl' && <DdlPanel ddl={ddl} loading={detailLoading} />}
          </div>}</>}
    </main>

    <Modal opened={Boolean(columnDraft)} onClose={() => !busy && setColumnDraft(null)} title={columnDraft?.oldName ? 'Edit column' : 'Add column'} centered size="lg">
      {columnDraft && <div className="ssh-table-form"><div className="ssh-table-form-grid"><TextInput label="Column name" autoFocus value={columnDraft.name} onChange={(event) => setColumnDraft({ ...columnDraft, name: event.currentTarget.value })} /><Select label="Type" searchable data={Array.from(new Set([...columnTypes, columnDraft.columnType]))} value={columnDraft.columnType} onChange={(value) => setColumnDraft({ ...columnDraft, columnType: value ?? 'VARCHAR(255)' })} />
        <Select label="Default" data={[{ value: 'none', label: 'No explicit default' }, { value: 'null', label: 'NULL' }, { value: 'current-timestamp', label: 'CURRENT_TIMESTAMP' }]} value={columnDraft.defaultMode} onChange={(value) => setColumnDraft({ ...columnDraft, defaultMode: (value ?? 'none') as ColumnDraft['defaultMode'] })} />
        {!columnDraft.oldName && <Select label="Position after" clearable placeholder="At end" data={details?.columns.map((column) => column.name) ?? []} value={columnDraft.after} onChange={(value) => setColumnDraft({ ...columnDraft, after: value })} />}</div>
        <Group gap="lg"><Switch label="Allow NULL" checked={columnDraft.nullable} onChange={(event) => setColumnDraft({ ...columnDraft, nullable: event.currentTarget.checked })} /><Switch label="Auto increment" checked={columnDraft.autoIncrement} onChange={(event) => setColumnDraft({ ...columnDraft, autoIncrement: event.currentTarget.checked })} /></Group>
        <Alert color="yellow" variant="light">Changing a column may rebuild the table or reject incompatible existing data. Review the definition carefully.</Alert>{error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setColumnDraft(null)}>Cancel</Button><Button loading={busy} disabled={!columnDraft.name.trim()} onClick={saveColumn}>{columnDraft.oldName ? 'Apply change' : 'Add column'}</Button></Group></div>}
    </Modal>

    <Modal opened={Boolean(indexDraft)} onClose={() => !busy && setIndexDraft(null)} title="Create index" centered size="lg">{indexDraft && <div className="ssh-table-form"><TextInput label="Index name" autoFocus value={indexDraft.name} onChange={(event) => setIndexDraft({ ...indexDraft, name: event.currentTarget.value })} /><MultiSelect label="Columns in index order" searchable data={details?.columns.map((column) => column.name) ?? []} value={indexDraft.columns} onChange={(columns) => setIndexDraft({ ...indexDraft, columns })} /><Switch label="Unique index" checked={indexDraft.unique} onChange={(event) => setIndexDraft({ ...indexDraft, unique: event.currentTarget.checked })} />{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" onClick={() => setIndexDraft(null)}>Cancel</Button><Button loading={busy} disabled={!indexDraft.name.trim() || !indexDraft.columns.length} onClick={() => selected && void applyOperation({ kind: 'create-index', database: selected.database, table: selected.name, ...indexDraft })}>Create index</Button></Group></div>}</Modal>

    <Modal opened={Boolean(dropTarget)} onClose={() => !busy && setDropTarget(null)} title={`Delete ${dropTarget?.kind ?? ''}`} centered size="md">{dropTarget && selected && <div className="ssh-table-form"><Alert color="red" icon={<IconAlertCircle size={16} />}>Deleting this {dropTarget.kind} can permanently break queries or remove stored data.</Alert><TextInput autoFocus label={<>Type <strong>{selected.name}.{dropTarget.name}</strong> to confirm</>} value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} />{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setDropTarget(null)}>Cancel</Button><Button color="red" loading={busy} disabled={confirmation !== `${selected.name}.${dropTarget.name}`} onClick={() => void applyOperation(dropTarget.kind === 'column' ? { kind: 'drop-column', database: selected.database, table: selected.name, name: dropTarget.name, confirmation } : { kind: 'drop-index', database: selected.database, table: selected.name, name: dropTarget.name, confirmation })}>Permanently delete</Button></Group></div>}</Modal>
  </div>
}

function TableOverview({ details }: { details: SshMySqlTableDetails }) { const table = details.table; return <div className="ssh-table-overview"><article><small>Rows</small><strong>{table.rows?.toLocaleString() ?? 'Unknown'}</strong></article><article><small>Data size</small><strong>{formatBytes(table.dataBytes)}</strong></article><article><small>Index size</small><strong>{formatBytes(table.indexBytes)}</strong></article><article><small>Engine</small><strong>{table.engine ?? 'View'}</strong></article><article><small>Collation</small><strong>{table.collation ?? '—'}</strong></article><article><small>Columns</small><strong>{details.columns.length}</strong></article><article><small>Indexes</small><strong>{details.indexes.length}</strong></article><article><small>Relations</small><strong>{details.foreignKeys.length}</strong></article>{table.comment && <section><strong>Comment</strong><p>{table.comment}</p></section>}</div> }
function ColumnsPanel({ details, onAdd, onEdit, onDrop }: { details: SshMySqlTableDetails; onAdd: () => void; onEdit: (column: SshMySqlTableColumn) => void; onDrop: (name: string) => void }) { return <section className="ssh-table-panel"><header><Text size="xs" fw={700}>{details.columns.length} columns</Text>{details.table.type === 'table' && <Button size="compact-xs" leftSection={<IconPlus size={13} />} onClick={onAdd}>Add column</Button>}</header><div className="ssh-table-metadata"><div className="head"><span>Name</span><span>Type</span><span>Null</span><span>Default</span><span>Key / Extra</span><span /></div>{details.columns.map((column) => <div key={column.name}><span><IconColumns size={13} /><strong>{column.name}</strong></span><span><code>{column.columnType}</code></span><span>{column.nullable ? 'Yes' : 'No'}</span><span>{column.defaultValue ?? '—'}</span><span>{[column.key, column.extra].filter(Boolean).join(' · ') || '—'}</span><span>{details.table.type === 'table' && <><ActionIcon size="sm" variant="subtle" onClick={() => onEdit(column)}><IconBraces size={13} /></ActionIcon><ActionIcon size="sm" variant="subtle" color="red" onClick={() => onDrop(column.name)}><IconTrash size={13} /></ActionIcon></>}</span></div>)}</div></section> }
function IndexesPanel({ details, onAdd, onDrop }: { details: SshMySqlTableDetails; onAdd: () => void; onDrop: (index: SshMySqlTableIndex) => void }) { return <section className="ssh-table-panel"><header><Text size="xs" fw={700}>{details.indexes.length} indexes</Text>{details.table.type === 'table' && <Button size="compact-xs" leftSection={<IconPlus size={13} />} onClick={onAdd}>Create index</Button>}</header><div className="ssh-table-card-list">{details.indexes.map((index) => <article key={index.name}><IconKey size={16} /><div><strong>{index.name}</strong><small>{index.columns.join(' → ')}</small></div><Badge size="xs" variant="light" color={index.name === 'PRIMARY' ? 'yellow' : index.unique ? 'teal' : 'gray'}>{index.name === 'PRIMARY' ? 'Primary' : index.unique ? 'Unique' : index.type}</Badge>{index.name !== 'PRIMARY' && <ActionIcon size="sm" variant="subtle" color="red" onClick={() => onDrop(index)}><IconTrash size={13} /></ActionIcon>}</article>)}</div></section> }
function RelationsPanel({ details }: { details: SshMySqlTableDetails }) { return <section className="ssh-table-panel"><header><Text size="xs" fw={700}>{details.foreignKeys.length} foreign-key relations</Text></header><div className="ssh-table-card-list">{details.foreignKeys.map((key) => <article key={`${key.name}-${key.column}`}><IconKey size={16} /><div><strong>{key.name}</strong><small>{key.column} → {key.referencedDatabase}.{key.referencedTable}.{key.referencedColumn}</small></div><Badge size="xs" variant="outline">Update {key.updateRule} · Delete {key.deleteRule}</Badge></article>)}{!details.foreignKeys.length && <div className="ssh-table-list-empty">No foreign keys.</div>}</div></section> }
function TriggersPanel({ details }: { details: SshMySqlTableDetails }) { return <section className="ssh-table-panel"><header><Text size="xs" fw={700}>{details.triggers.length} triggers</Text></header><div className="ssh-table-card-list">{details.triggers.map((trigger) => <article key={trigger.name}><IconBraces size={16} /><div><strong>{trigger.name}</strong><small>{trigger.timing} {trigger.event}</small><code>{trigger.statement}</code></div></article>)}{!details.triggers.length && <div className="ssh-table-list-empty">No triggers.</div>}</div></section> }
function DataPanel({ result, offset, loading, onPage }: { result: SshMySqlQueryResultSet | null; offset: number; loading: boolean; onPage: (offset: number) => void }) { return <section className="ssh-table-panel ssh-table-data"><header><Text size="xs" fw={700}>Rows {offset + 1}–{offset + (result?.rows.length ?? 0)}</Text><Group gap={5}><Button size="compact-xs" variant="default" disabled={loading || offset === 0} onClick={() => onPage(Math.max(0, offset - 100))}>Previous</Button><Button size="compact-xs" variant="default" disabled={loading || !result || result.rows.length < 100} onClick={() => onPage(offset + 100)}>Next</Button></Group></header>{loading && !result ? <div className="ssh-database-loading"><Loader size="sm" /></div> : result ? <div className="ssh-sql-grid"><table><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell} data-null={value === null || undefined}>{value === null ? 'NULL' : String(value)}</td>)}</tr>)}</tbody></table></div> : null}</section> }
function DdlPanel({ ddl, loading }: { ddl: string; loading: boolean }) { return <section className="ssh-table-panel ssh-table-ddl"><header><Text size="xs" fw={700}>Create statement</Text><Button size="compact-xs" variant="default" leftSection={<IconCopy size={12} />} disabled={!ddl} onClick={() => void navigator.clipboard.writeText(ddl)}>Copy DDL</Button></header>{loading && !ddl ? <div className="ssh-database-loading"><Loader size="sm" /></div> : <pre>{ddl || 'DDL is unavailable.'}</pre>}</section> }
