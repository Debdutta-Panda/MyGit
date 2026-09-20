import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, PasswordInput, Select, Switch, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertCircle, IconDatabase, IconKey, IconPlus, IconRefresh, IconSearch, IconShieldLock, IconTrash } from '@tabler/icons-react'
import type { SshConnection, SshMySqlAccessMode, SshMySqlAccessProfile, SshMySqlDatabase, SshMySqlOverview } from '../../shared/desktop-api'

const messageFor = (reason: unknown): string =>
  reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)

const formatBytes = (value: number): string => {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1 }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}

const collations: Record<string, string[]> = {
  utf8mb4: ['utf8mb4_unicode_ci', 'utf8mb4_general_ci'],
  utf8: ['utf8_general_ci', 'utf8_unicode_ci'],
  latin1: ['latin1_swedish_ci'],
  ascii: ['ascii_general_ci'],
}

export function SshMySqlDatabases({ connection, overview }: { connection: SshConnection; overview: SshMySqlOverview }) {
  const [profile, setProfile] = useState<SshMySqlAccessProfile | null>(null)
  const [databases, setDatabases] = useState<SshMySqlDatabase[]>([])
  const [loading, setLoading] = useState(true)
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
  const nameRef = useRef<HTMLInputElement>(null)

  const loadDatabases = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true)
    setError(null)
    try {
      setDatabases(await window.desktop.ssh.mysqlDatabases(connection.id))
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  useEffect(() => {
    let current = true
    setLoading(true)
    setProfile(null)
    setDatabases([])
    setError(null)
    void window.desktop?.ssh.mysqlAccessProfile(connection.id).then((saved) => {
      if (!current) return
      setProfile(saved)
      setAccessMode(saved?.mode ?? 'system')
      setUsername(saved?.username ?? '')
      if (saved) return window.desktop?.ssh.mysqlDatabases(connection.id).then((items) => { if (current) setDatabases(items) })
    }).catch((reason) => { if (current) setError(messageFor(reason)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [connection.id])

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return databases.filter((database) => (showSystem || !database.system) && (!query || database.name.toLowerCase().includes(query)))
  }, [databases, filter, showSystem])

  const openAccess = (): void => {
    setAccessMode(profile?.mode ?? 'system')
    setUsername(profile?.username ?? '')
    setPassword('')
    setAccessOpen(true)
    setError(null)
  }

  const saveAccess = async (): Promise<void> => {
    if (!window.desktop) return
    setBusy(true)
    setError(null)
    try {
      const saved = await window.desktop.ssh.saveMysqlAccess(connection.id, { mode: accessMode, username, password })
      setProfile(saved)
      setPassword('')
      setAccessOpen(false)
      setDatabases(await window.desktop.ssh.mysqlDatabases(connection.id))
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
      setLoading(false)
    }
  }

  const clearAccess = async (): Promise<void> => {
    if (!window.desktop) return
    setBusy(true)
    try {
      await window.desktop.ssh.clearMysqlAccess(connection.id)
      setProfile(null)
      setDatabases([])
      setAccessOpen(false)
      setPassword('')
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  const createDatabase = async (): Promise<void> => {
    if (!window.desktop) return
    setBusy(true)
    setError(null)
    try {
      const items = await window.desktop.ssh.manageMysqlDatabase(connection.id, {
        kind: 'create', name: databaseName, characterSet, collation,
      })
      setDatabases(items)
      setCreateOpen(false)
      setDatabaseName('')
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  const dropDatabase = async (): Promise<void> => {
    if (!window.desktop || !dropTarget) return
    setBusy(true)
    setError(null)
    try {
      setDatabases(await window.desktop.ssh.manageMysqlDatabase(connection.id, {
        kind: 'drop', name: dropTarget.name, confirmation: dropConfirmation,
      }))
      setDropTarget(null)
      setDropConfirmation('')
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !profile) return <div className="ssh-mysql-access-empty"><Loader size="sm" /><Text size="sm">Loading database access...</Text></div>

  if (!profile) return <div className="ssh-mysql-access-empty">
    <IconShieldLock size={38} />
    <Text fw={730}>Connect database administration</Text>
    <Text size="sm" c="dimmed" ta="center" maw={590}>Choose local system-administrator access or a MySQL username and password. Password connections travel inside SSH and the password is encrypted in the OS-backed vault.</Text>
    {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
    <Button size="xs" leftSection={<IconKey size={14} />} onClick={openAccess}>Configure access</Button>
    <AccessModal opened={accessOpen} onClose={() => setAccessOpen(false)} mode={accessMode} setMode={setAccessMode}
      username={username} setUsername={setUsername} password={password} setPassword={setPassword}
      existing={profile} busy={busy} error={error} onSave={() => void saveAccess()} onClear={() => void clearAccess()} />
  </div>

  return <div className="ssh-mysql-databases">
    <header>
      <div>
        <Group gap={7}><Text fw={730}>Databases</Text><Badge size="xs" variant="light" color="teal">{databases.filter((item) => !item.system).length} managed</Badge></Group>
        <Text size="xs" c="dimmed">{profile.mode === 'system' ? 'Local system administrator' : profile.username} · {overview.engine === 'mariadb' ? 'MariaDB' : 'MySQL'} tunneled through {connection.name}</Text>
      </div>
      <Group gap={6} wrap="nowrap">
        <Tooltip label="Change database access"><ActionIcon variant="default" onClick={openAccess}><IconKey size={15} /></ActionIcon></Tooltip>
        <Tooltip label="Refresh databases"><ActionIcon variant="default" loading={loading} onClick={() => void loadDatabases()}><IconRefresh size={15} /></ActionIcon></Tooltip>
        <Button size="compact-xs" leftSection={<IconPlus size={14} />} onClick={() => { setError(null); setCreateOpen(true) }}>New database</Button>
      </Group>
    </header>
    <div className="ssh-mysql-database-tools">
      <TextInput size="xs" leftSection={<IconSearch size={13} />} placeholder="Filter databases" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />
      <Switch size="xs" label="Show system databases" checked={showSystem} onChange={(event) => setShowSystem(event.currentTarget.checked)} />
    </div>
    {error && <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>{error}</Alert>}
    <div className="ssh-mysql-database-table">
      <div className="ssh-mysql-database-row ssh-mysql-database-table-head"><span>Name</span><span>Tables</span><span>Size</span><span>Character set</span><span>Collation</span><span>Actions</span></div>
      {visible.map((database) => <div className="ssh-mysql-database-row" key={database.name}>
        <span><IconDatabase size={15} /><strong>{database.name}</strong>{database.system && <Badge size="xs" variant="outline" color="gray">System</Badge>}</span>
        <span>{database.tableCount}</span><span>{formatBytes(database.sizeBytes)}</span><span><code>{database.characterSet}</code></span><span><code>{database.collation}</code></span>
        <span>{!database.system && <Tooltip label={`Delete ${database.name}`}><ActionIcon size="sm" variant="subtle" color="red" onClick={() => { setError(null); setDropTarget(database); setDropConfirmation('') }}><IconTrash size={14} /></ActionIcon></Tooltip>}</span>
      </div>)}
      {!loading && !visible.length && <div className="ssh-mysql-database-empty">{filter ? 'No databases match this filter.' : 'No managed databases yet.'}</div>}
    </div>

    <AccessModal opened={accessOpen} onClose={() => setAccessOpen(false)} mode={accessMode} setMode={setAccessMode}
      username={username} setUsername={setUsername} password={password} setPassword={setPassword}
      existing={profile} busy={busy} error={error} onSave={() => void saveAccess()} onClear={() => void clearAccess()} />

    <Modal opened={createOpen} onClose={() => !busy && setCreateOpen(false)} title="Create database" centered size="md"
      onTransitionEnd={() => createOpen && nameRef.current?.focus()}>
      <div className="ssh-mysql-database-form">
        <TextInput ref={nameRef} label="Database name" description="Letters, numbers, _, $, and -; maximum 64 characters." value={databaseName} onChange={(event) => setDatabaseName(event.currentTarget.value)} />
        <div><Select label="Character set" data={Object.keys(collations)} value={characterSet} onChange={(value) => { const next = value ?? 'utf8mb4'; setCharacterSet(next); setCollation(collations[next][0]) }} />
          <Select label="Collation" data={collations[characterSet]} value={collation} onChange={(value) => setCollation(value ?? collations[characterSet][0])} /></div>
        <Alert color="blue" variant="light">This creates an empty database. No user permissions are granted automatically.</Alert>
        {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setCreateOpen(false)}>Cancel</Button><Button loading={busy} disabled={!databaseName.trim()} onClick={() => void createDatabase()}>Create database</Button></Group>
      </div>
    </Modal>

    <Modal opened={Boolean(dropTarget)} onClose={() => !busy && setDropTarget(null)} title="Delete database" centered size="md">
      <div className="ssh-mysql-database-form">
        <Alert color="red" icon={<IconAlertCircle size={16} />}>This permanently deletes <strong>{dropTarget?.name}</strong>, all its tables, and all contained data. This cannot be undone by the app.</Alert>
        <TextInput label={<>Type <strong>{dropTarget?.name}</strong> to confirm</>} value={dropConfirmation} onChange={(event) => setDropConfirmation(event.currentTarget.value)} autoFocus />
        {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setDropTarget(null)}>Cancel</Button><Button color="red" loading={busy} disabled={dropConfirmation !== dropTarget?.name} onClick={() => void dropDatabase()}>Permanently delete</Button></Group>
      </div>
    </Modal>
  </div>
}

function AccessModal({ opened, onClose, mode, setMode, username, setUsername, password, setPassword, existing, busy, error, onSave, onClear }: {
  opened: boolean; onClose: () => void; mode: SshMySqlAccessMode; setMode: (mode: SshMySqlAccessMode) => void
  username: string; setUsername: (value: string) => void; password: string; setPassword: (value: string) => void
  existing: SshMySqlAccessProfile | null; busy: boolean; error: string | null; onSave: () => void; onClear: () => void
}) {
  return <Modal opened={opened} onClose={() => !busy && onClose()} title="Database administration access" centered size="lg">
    <div className="ssh-mysql-access-form">
      <div className="ssh-mysql-access-modes">
        <button type="button" data-selected={mode === 'system' || undefined} onClick={() => setMode('system')}><IconShieldLock size={18} /><span><strong>System administrator</strong><small>Use local socket authentication through root or passwordless sudo. Recommended immediately after installation.</small></span></button>
        <button type="button" data-selected={mode === 'password' || undefined} onClick={() => setMode('password')}><IconKey size={18} /><span><strong>MySQL account</strong><small>Connect to localhost:3306 inside the SSH tunnel with a database username and password.</small></span></button>
      </div>
      {mode === 'password' && <div className="ssh-mysql-access-fields"><TextInput label="MySQL username" value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoFocus />
        <PasswordInput label="Password" description={existing?.mode === 'password' && existing.hasPassword ? 'Leave blank to keep the saved password.' : 'Stored encrypted using the operating-system credential vault.'} value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></div>}
      {mode === 'system' && <Alert color="blue" variant="light">The app verifies access with <code>sudo -n mysql</code> or the equivalent MariaDB client. No database password is needed or stored.</Alert>}
      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      <Group justify="space-between"><div>{existing && <Button size="xs" variant="subtle" color="red" disabled={busy} onClick={onClear}>Forget access</Button>}</div>
        <Group gap={7}><Button variant="default" disabled={busy} onClick={onClose}>Cancel</Button><Button loading={busy} disabled={mode === 'password' && (!username.trim() || (!password && !existing?.hasPassword))} onClick={onSave}>Test and save</Button></Group></Group>
    </div>
  </Modal>
}
