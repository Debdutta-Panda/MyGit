import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Drawer, Group, Loader, Modal, Select, Switch, Text, Tooltip } from '@mantine/core'
import { IconAlertCircle, IconBraces, IconClock, IconCopy, IconDatabase, IconDownload, IconHistory, IconPlayerPlay, IconPlus, IconRefresh, IconShieldLock, IconSquare, IconX } from '@tabler/icons-react'
import type { SshConnection, SshMySqlAccessProfile, SshMySqlDatabase, SshMySqlQueryResult, SshMySqlQueryResultSet, SshMySqlSchemaColumn } from '../../shared/desktop-api'
import type { SqlMonacoHandle } from './SqlMonaco'

const SqlEditor = lazy(async () => ({ default: (await import('./SqlMonaco')).SqlMonaco }))
const messageFor = (reason: unknown): string => reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)
const destructivePattern = /\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER|RENAME|GRANT|REVOKE|SET\s+PASSWORD)\b/i

interface QueryTab { id: string; name: string; sql: string; database: string | null }
interface QueryHistory { id: string; sql: string; database: string | null; durationMs: number | null; success: boolean; error: string | null; executedAt: string }
const tabsKey = (id: string): string => `myrepos:mysql-query-tabs:${id}`
const historyKey = (id: string): string => `myrepos:mysql-query-history:${id}`
const newTab = (index: number): QueryTab => ({ id: crypto.randomUUID(), name: `Query ${index}`, sql: '', database: null })
const readJson = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) ?? '') as T } catch { return fallback } }

const cellText = (value: string | number | boolean | null): string => value === null ? 'NULL' : String(value)
const csvCell = (value: string | number | boolean | null): string => `"${cellText(value).replace(/"/g, '""')}"`
const resultCsv = (set: SshMySqlQueryResultSet): string => [set.columns.map(csvCell).join(','), ...set.rows.map((row) => row.map(csvCell).join(','))].join('\r\n')
const saveText = (name: string, content: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SshMySqlQuery({ connection, onNeedAccess }: { connection: SshConnection; onNeedAccess: () => void }) {
  const initialTabs = readJson<QueryTab[]>(tabsKey(connection.id), [])
  const [tabs, setTabs] = useState<QueryTab[]>(initialTabs.length ? initialTabs : [newTab(1)])
  const [activeId, setActiveId] = useState((initialTabs[0] ?? tabs[0]).id)
  const [profile, setProfile] = useState<SshMySqlAccessProfile | null>(null)
  const [databases, setDatabases] = useState<SshMySqlDatabase[]>([])
  const [schema, setSchema] = useState<SshMySqlSchemaColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [readOnly, setReadOnly] = useState(true)
  const [rowLimit, setRowLimit] = useState('500')
  const [result, setResult] = useState<SshMySqlQueryResult | null>(null)
  const [resultIndex, setResultIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<QueryHistory[]>(readJson<QueryHistory[]>(historyKey(connection.id), []))
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pendingSql, setPendingSql] = useState<string | null>(null)
  const [sort, setSort] = useState<{ column: number; direction: 'asc' | 'desc' } | null>(null)
  const editorRef = useRef<SqlMonacoHandle>(null)
  const runIdRef = useRef<string | null>(null)
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  const loadBase = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true); setError(null)
    try {
      const access = await window.desktop.ssh.mysqlAccessProfile(connection.id)
      setProfile(access)
      if (!access) { setDatabases([]); return }
      setDatabases((await window.desktop.ssh.mysqlDatabases(connection.id)).filter((item) => !item.system))
    } catch (reason) { setError(messageFor(reason)) } finally { setLoading(false) }
  }, [connection.id])
  useEffect(() => { void loadBase() }, [loadBase])
  useEffect(() => { localStorage.setItem(tabsKey(connection.id), JSON.stringify(tabs)) }, [connection.id, tabs])
  useEffect(() => { localStorage.setItem(historyKey(connection.id), JSON.stringify(history.slice(0, 100))) }, [connection.id, history])
  useEffect(() => {
    if (!profile || !active) return
    let current = true; setSchemaLoading(true)
    void window.desktop?.ssh.mysqlSchema(connection.id, active.database).then((items) => { if (current) setSchema(items) })
      .catch(() => { if (current) setSchema([]) }).finally(() => { if (current) setSchemaLoading(false) })
    return () => { current = false }
  }, [active?.database, connection.id, profile])

  const updateActive = (change: Partial<QueryTab>): void => setTabs((current) => current.map((tab) => tab.id === activeId ? { ...tab, ...change } : tab))
  const addTab = (): void => { const tab = newTab(tabs.length + 1); setTabs((current) => [...current, tab]); setActiveId(tab.id) }
  const closeTab = (id: string): void => setTabs((current) => {
    if (current.length === 1) return [{ ...current[0], sql: '', name: 'Query 1' }]
    const index = current.findIndex((tab) => tab.id === id); const next = current.filter((tab) => tab.id !== id)
    if (id === activeId) setActiveId(next[Math.max(0, index - 1)].id)
    return next
  })
  const addHistory = (entry: Omit<QueryHistory, 'id' | 'executedAt'>): void => setHistory((current) => [{ ...entry, id: crypto.randomUUID(), executedAt: new Date().toISOString() }, ...current].slice(0, 100))

  const execute = async (sql: string, confirmed = false): Promise<void> => {
    if (!window.desktop || !active || !sql.trim()) return
    if (!readOnly && destructivePattern.test(sql) && !confirmed) { setPendingSql(sql); return }
    const runId = crypto.randomUUID(); runIdRef.current = runId
    setRunning(true); setError(null); setResult(null); setResultIndex(0); setSort(null); editorRef.current?.clearErrors()
    const started = performance.now()
    try {
      const completed = await window.desktop.ssh.runMysqlQuery(connection.id, runId, {
        database: active.database, sql, rowLimit: Number(rowLimit), readOnly,
        destructiveConfirmation: confirmed ? 'RUN DESTRUCTIVE QUERY' : null,
      })
      setResult(completed)
      addHistory({ sql, database: active.database, durationMs: completed.durationMs, success: true, error: null })
    } catch (reason) {
      const message = messageFor(reason); setError(message); editorRef.current?.markError(message)
      addHistory({ sql, database: active.database, durationMs: Math.round(performance.now() - started), success: false, error: message })
    } finally { if (runIdRef.current === runId) runIdRef.current = null; setRunning(false) }
  }
  const runCurrent = (): void => { const sql = editorRef.current?.selectionOrStatement() ?? ''; if (sql) void execute(sql) }
  const runAll = (): void => { const sql = editorRef.current?.all() ?? active?.sql ?? ''; if (sql) void execute(sql) }
  const cancel = async (): Promise<void> => { if (runIdRef.current) await window.desktop?.ssh.cancelMysqlQuery(runIdRef.current) }
  const selectedSet = result?.resultSets[resultIndex] ?? null
  const sortedRows = useMemo(() => {
    if (!selectedSet || !sort) return selectedSet?.rows ?? []
    return [...selectedSet.rows].sort((left, right) => {
      const a = left[sort.column]; const b = right[sort.column]
      const compared = a === b ? 0 : a === null ? -1 : b === null ? 1 : String(a).localeCompare(String(b), undefined, { numeric: true })
      return sort.direction === 'asc' ? compared : -compared
    })
  }, [selectedSet, sort])

  if (loading && !profile) return <div className="ssh-mysql-access-empty"><Loader size="sm" /><Text size="sm">Preparing SQL workspace...</Text></div>
  if (!profile) return <div className="ssh-mysql-access-empty"><IconShieldLock size={38} /><Text fw={730}>Database access is not configured</Text><Text size="sm" c="dimmed">Configure administration access before opening the SQL workspace.</Text>
    {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}<Button size="xs" onClick={onNeedAccess}>Configure access</Button></div>

  return <div className="ssh-sql-workspace">
    <header className="ssh-sql-toolbar">
      <Group gap={6} wrap="nowrap"><Select size="xs" w={210} placeholder="No default database" clearable searchable leftSection={<IconDatabase size={13} />}
        data={databases.map((item) => item.name)} value={active?.database} onChange={(value) => updateActive({ database: value })} />
        <Tooltip label="Refresh databases and schema"><ActionIcon variant="default" loading={loading || schemaLoading} onClick={() => void loadBase()}><IconRefresh size={15} /></ActionIcon></Tooltip>
        <Select size="xs" w={105} data={['100', '500', '1000', '5000', '10000'].map((value) => ({ value, label: `${value} rows` }))} value={rowLimit} onChange={(value) => setRowLimit(value ?? '500')} /></Group>
      <Group gap={8} wrap="nowrap"><Switch size="xs" label="Read only" checked={readOnly} onChange={(event) => setReadOnly(event.currentTarget.checked)} />
        <Tooltip label="Query history"><ActionIcon variant="default" onClick={() => setHistoryOpen(true)}><IconHistory size={15} /></ActionIcon></Tooltip>
        {running ? <Button size="compact-xs" color="red" variant="light" leftSection={<IconSquare size={12} />} onClick={() => void cancel()}>Cancel</Button>
          : <><Tooltip label="Run selection or current statement (Ctrl+Enter)"><Button size="compact-xs" leftSection={<IconPlayerPlay size={13} />} onClick={runCurrent}>Run</Button></Tooltip>
            <Tooltip label="Run entire editor (Ctrl+Shift+Enter)"><ActionIcon color="teal" variant="light" onClick={runAll}><IconBraces size={15} /></ActionIcon></Tooltip></>}
      </Group>
    </header>
    <div className="ssh-sql-tabs">{tabs.map((tab) => <button type="button" key={tab.id} data-active={tab.id === activeId || undefined} onClick={() => setActiveId(tab.id)}><span>{tab.name}</span><IconX size={12} onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }} /></button>)}
      <Tooltip label="New query"><ActionIcon size="sm" variant="subtle" onClick={addTab}><IconPlus size={14} /></ActionIcon></Tooltip></div>
    <div className="ssh-sql-editor-pane"><Suspense fallback={<div className="ssh-database-loading"><Loader size="sm" /> Loading SQL editor...</div>}>
      <SqlEditor ref={editorRef} tabId={active.id} value={active.sql} schema={schema} databases={databases.map((item) => item.name)} onChange={(sql) => updateActive({ sql })} onRunCurrent={runCurrent} onRunAll={runAll} />
    </Suspense></div>
    <section className="ssh-sql-results">
      <header><Group gap={7}><Text size="xs" fw={700}>Results</Text>{result && <Badge size="xs" variant="light" color="teal">{result.durationMs} ms</Badge>}{running && <><Loader size={13} /><Text size="xs" c="dimmed">Executing query...</Text></>}</Group>
        {selectedSet?.columns.length ? <Group gap={4}><Tooltip label="Copy as CSV"><ActionIcon size="sm" variant="subtle" onClick={() => void navigator.clipboard.writeText(resultCsv(selectedSet))}><IconCopy size={13} /></ActionIcon></Tooltip>
          <Tooltip label="Export CSV"><ActionIcon size="sm" variant="subtle" onClick={() => saveText('query-result.csv', resultCsv(selectedSet), 'text/csv')}><IconDownload size={13} /></ActionIcon></Tooltip>
          <Tooltip label="Export JSON"><ActionIcon size="sm" variant="subtle" onClick={() => saveText('query-result.json', JSON.stringify(sortedRows.map((row) => Object.fromEntries(selectedSet.columns.map((column, index) => [column, row[index]]))), null, 2), 'application/json')}><IconBraces size={13} /></ActionIcon></Tooltip></Group> : null}</header>
      {error ? <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert> : result ? <>
        {result.resultSets.length > 1 && <div className="ssh-sql-result-tabs">{result.resultSets.map((set, index) => <button type="button" data-active={index === resultIndex || undefined} key={index} onClick={() => { setResultIndex(index); setSort(null) }}>Result {index + 1}<small>{set.rows.length ? `${set.rows.length} rows` : `${set.affectedRows ?? 0} affected`}</small></button>)}</div>}
        {selectedSet ? selectedSet.columns.length ? <div className="ssh-sql-grid"><table><thead><tr>{selectedSet.columns.map((column, index) => <th key={`${column}-${index}`} onClick={() => setSort((current) => current?.column === index ? { column: index, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { column: index, direction: 'asc' })}>{column}{sort?.column === index ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</th>)}</tr></thead>
          <tbody>{sortedRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, index) => <td key={index} data-null={value === null || undefined}>{cellText(value)}</td>)}</tr>)}</tbody></table>{selectedSet.truncated && <div className="ssh-sql-truncated">Result truncated to {rowLimit} rows.</div>}</div>
          : <div className="ssh-sql-query-summary"><strong>Query completed</strong><span>{selectedSet.affectedRows ?? 0} affected rows{selectedSet.insertId !== null ? ` · Insert ID ${selectedSet.insertId}` : ''}{selectedSet.warningCount ? ` · ${selectedSet.warningCount} warnings` : ''}</span></div> : null}
      </> : <div className="ssh-sql-empty"><IconPlayerPlay size={25} /><span>Run a statement to see its results.</span><small>Ctrl+Enter runs the selection or current statement.</small></div>}
    </section>

    <Modal opened={Boolean(pendingSql)} onClose={() => setPendingSql(null)} title="Confirm destructive query" centered size="lg"><div className="ssh-sql-confirm"><Alert color="red" icon={<IconAlertCircle size={16} />}>This query may permanently change data, privileges, or schema. Review the exact SQL before running it.</Alert><pre>{pendingSql}</pre><Group justify="flex-end"><Button variant="default" onClick={() => setPendingSql(null)}>Cancel</Button><Button color="red" onClick={() => { const sql = pendingSql; setPendingSql(null); if (sql) void execute(sql, true) }}>Run destructive query</Button></Group></div></Modal>
    <Drawer opened={historyOpen} onClose={() => setHistoryOpen(false)} title="Query history" position="right" size="md"><div className="ssh-sql-history">{history.map((item) => <button type="button" key={item.id} onClick={() => { updateActive({ sql: item.sql, database: item.database }); setHistoryOpen(false) }}><span><Badge size="xs" color={item.success ? 'teal' : 'red'} variant="light">{item.success ? 'Success' : 'Failed'}</Badge><small><IconClock size={11} /> {new Date(item.executedAt).toLocaleString()} · {item.durationMs ?? '-'} ms</small></span><code>{item.sql}</code>{item.error && <em>{item.error}</em>}</button>)}{!history.length && <Text size="sm" c="dimmed">No queries have been run yet.</Text>}</div></Drawer>
  </div>
}
