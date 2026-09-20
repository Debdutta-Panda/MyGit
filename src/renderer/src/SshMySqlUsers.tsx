import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Modal, PasswordInput, Select, Switch, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertCircle, IconKey, IconPlus, IconRefresh, IconSearch, IconShieldLock, IconTrash, IconUserCog, IconUsers } from '@tabler/icons-react'
import type { SshConnection, SshMySqlAccessProfile, SshMySqlDatabase, SshMySqlUser } from '../../shared/desktop-api'

const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'INDEX', 'DROP', 'EXECUTE', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER', 'REFERENCES']
const presets: Record<string, string[]> = {
  'Read only': ['SELECT', 'SHOW VIEW'],
  'Read/write': ['SELECT', 'SHOW VIEW', 'INSERT', 'UPDATE', 'DELETE'],
  Developer: ['SELECT', 'SHOW VIEW', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'INDEX', 'DROP', 'CREATE VIEW', 'TRIGGER'],
  None: [],
}
const messageFor = (reason: unknown): string =>
  reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)

function PrivilegePicker({ value, onChange, disabled = false }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  return <div className="ssh-mysql-privileges">
    <div className="ssh-mysql-privilege-presets">{Object.entries(presets).map(([name, selected]) => <button type="button" key={name} disabled={disabled} onClick={() => onChange(selected)}>{name}</button>)}</div>
    <div className="ssh-mysql-privilege-grid">{privileges.map((privilege) => <Checkbox size="xs" key={privilege} label={privilege} disabled={disabled}
      checked={value.includes(privilege)} onChange={(event) => onChange(event.currentTarget.checked ? [...value, privilege] : value.filter((item) => item !== privilege))} />)}</div>
  </div>
}

export function SshMySqlUsers({ connection, onNeedAccess }: { connection: SshConnection; onNeedAccess: () => void }) {
  const [profile, setProfile] = useState<SshMySqlAccessProfile | null>(null)
  const [users, setUsers] = useState<SshMySqlUser[]>([])
  const [databases, setDatabases] = useState<SshMySqlDatabase[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [host, setHost] = useState('localhost')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [database, setDatabase] = useState<string | null>(null)
  const [selectedPrivileges, setSelectedPrivileges] = useState<string[]>(presets['Read/write'])
  const [selectedUser, setSelectedUser] = useState<SshMySqlUser | null>(null)
  const [editDatabase, setEditDatabase] = useState<string | null>(null)
  const [editPrivileges, setEditPrivileges] = useState<string[]>([])
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [dropOpen, setDropOpen] = useState(false)
  const [dropConfirmation, setDropConfirmation] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true)
    setError(null)
    try {
      const access = await window.desktop.ssh.mysqlAccessProfile(connection.id)
      setProfile(access)
      if (!access) { setUsers([]); setDatabases([]); return }
      const [nextUsers, nextDatabases] = await Promise.all([
        window.desktop.ssh.mysqlUsers(connection.id), window.desktop.ssh.mysqlDatabases(connection.id),
      ])
      setUsers(nextUsers)
      setDatabases(nextDatabases.filter((item) => !item.system))
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return users.filter((user) => (showSystem || !user.system) && (!query || `${user.username}@${user.host}`.toLowerCase().includes(query)))
  }, [filter, showSystem, users])
  const selectedIsActiveCredential = Boolean(selectedUser && profile.mode === 'password' && profile.username === selectedUser.username)

  const resetCreate = (): void => {
    setUsername(''); setHost('localhost'); setPassword(''); setConfirmPassword(''); setDatabase(null); setSelectedPrivileges(presets['Read/write']); setError(null)
  }
  const createUser = async (): Promise<void> => {
    if (!window.desktop || password !== confirmPassword) return
    setBusy(true); setError(null)
    try {
      setUsers(await window.desktop.ssh.manageMysqlUser(connection.id, {
        kind: 'create', username, host, password, database, privileges: database ? selectedPrivileges : [],
      }))
      setCreateOpen(false); resetCreate()
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }
  const openUser = (user: SshMySqlUser): void => {
    setSelectedUser(user); setEditDatabase(user.databaseGrants[0]?.database ?? databases[0]?.name ?? null)
    const firstDatabase = user.databaseGrants[0]?.database ?? databases[0]?.name
    setEditPrivileges(user.databaseGrants.find((grant) => grant.database === firstDatabase)?.privileges.filter((item) => privileges.includes(item)) ?? [])
    setNewPassword(''); setNewPasswordConfirm(''); setDropOpen(false); setDropConfirmation(''); setError(null)
  }
  const chooseEditDatabase = (value: string | null): void => {
    setEditDatabase(value)
    setEditPrivileges(selectedUser?.databaseGrants.find((grant) => grant.database === value)?.privileges.filter((item) => privileges.includes(item)) ?? [])
  }
  const saveDatabaseAccess = async (): Promise<void> => {
    if (!window.desktop || !selectedUser || !editDatabase) return
    setBusy(true); setError(null)
    try {
      const next = await window.desktop.ssh.manageMysqlUser(connection.id, {
        kind: 'set-database-access', username: selectedUser.username, host: selectedUser.host, database: editDatabase, privileges: editPrivileges,
      })
      setUsers(next); setSelectedUser(next.find((user) => user.username === selectedUser.username && user.host === selectedUser.host) ?? null)
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }
  const changePassword = async (): Promise<void> => {
    if (!window.desktop || !selectedUser || newPassword !== newPasswordConfirm) return
    setBusy(true); setError(null)
    try {
      const next = await window.desktop.ssh.manageMysqlUser(connection.id, { kind: 'set-password', username: selectedUser.username, host: selectedUser.host, password: newPassword })
      setUsers(next); setNewPassword(''); setNewPasswordConfirm('')
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }
  const deleteUser = async (): Promise<void> => {
    if (!window.desktop || !selectedUser) return
    setBusy(true); setError(null)
    try {
      setUsers(await window.desktop.ssh.manageMysqlUser(connection.id, {
        kind: 'drop', username: selectedUser.username, host: selectedUser.host, confirmation: dropConfirmation,
      }))
      setSelectedUser(null); setDropOpen(false)
    } catch (reason) { setError(messageFor(reason)) } finally { setBusy(false) }
  }

  if (loading && !profile) return <div className="ssh-mysql-access-empty"><Loader size="sm" /><Text size="sm">Loading database users...</Text></div>
  if (!profile) return <div className="ssh-mysql-access-empty"><IconShieldLock size={38} /><Text fw={730}>Database access is not configured</Text>
    <Text size="sm" c="dimmed" ta="center">Configure and verify administration access in the Databases tab before managing users.</Text>
    {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
    <Button size="xs" leftSection={<IconKey size={14} />} onClick={onNeedAccess}>Configure access</Button></div>

  return <div className="ssh-mysql-users">
    <header><div><Group gap={7}><Text fw={730}>Users & Access</Text><Badge size="xs" variant="light" color="teal">{users.filter((user) => !user.system).length} managed</Badge></Group>
      <Text size="xs" c="dimmed">Per-database privileges for MySQL accounts</Text></div>
      <Group gap={6}><Tooltip label="Refresh users"><ActionIcon variant="default" loading={loading} onClick={() => void load()}><IconRefresh size={15} /></ActionIcon></Tooltip>
        <Button size="compact-xs" leftSection={<IconPlus size={14} />} onClick={() => { resetCreate(); setCreateOpen(true) }}>New user</Button></Group></header>
    <div className="ssh-mysql-database-tools"><TextInput size="xs" leftSection={<IconSearch size={13} />} placeholder="Filter users or hosts" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />
      <Switch size="xs" label="Show system users" checked={showSystem} onChange={(event) => setShowSystem(event.currentTarget.checked)} /></div>
    {error && !createOpen && !selectedUser && <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>{error}</Alert>}
    <div className="ssh-mysql-user-grid">{visible.map((user) => <button type="button" key={`${user.username}@${user.host}`} onClick={() => openUser(user)}>
      <span className="ssh-mysql-user-icon"><IconUsers size={17} /></span><span><strong>{user.username}<em>@{user.host}</em></strong><small>{user.plugin || 'Default authentication'} · {user.databaseGrants.length} database{user.databaseGrants.length === 1 ? '' : 's'}</small></span>
      {user.system ? <Badge size="xs" variant="outline" color="gray">System</Badge> : <IconUserCog size={16} />}
    </button>)}</div>
    {!loading && !visible.length && <div className="ssh-mysql-database-empty">No users match the current view.</div>}

    <Modal opened={createOpen} onClose={() => !busy && setCreateOpen(false)} title="Create MySQL user" centered size="xl">
      <div className="ssh-mysql-user-form"><div className="ssh-mysql-user-fields"><TextInput label="Username" value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoFocus />
        <TextInput label="Allowed host" description="Usually localhost; use % only when intentionally required." value={host} onChange={(event) => setHost(event.currentTarget.value)} />
        <PasswordInput label="Initial password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
        <PasswordInput label="Confirm password" error={confirmPassword && password !== confirmPassword ? 'Passwords do not match.' : undefined} value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} /></div>
        <Select label="Initial database access (optional)" placeholder="Create account without database access" clearable data={databases.map((item) => item.name)} value={database} onChange={setDatabase} />
        <PrivilegePicker value={selectedPrivileges} onChange={setSelectedPrivileges} disabled={!database} />
        <Text size="xs" c="dimmed">Global administrative privileges are intentionally not granted here.</Text>
        {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setCreateOpen(false)}>Cancel</Button><Button loading={busy} disabled={!username.trim() || !host.trim() || !password || password !== confirmPassword} onClick={() => void createUser()}>Create user</Button></Group></div>
    </Modal>

    <Modal opened={Boolean(selectedUser)} onClose={() => !busy && setSelectedUser(null)} title={selectedUser ? `${selectedUser.username}@${selectedUser.host}` : 'Manage user'} centered size="xl">
      {selectedUser && <div className="ssh-mysql-user-form">
        <div className="ssh-mysql-user-summary"><div><small>Authentication</small><strong>{selectedUser.plugin || 'Default'}</strong></div><div><small>Global privileges</small><strong>{selectedUser.globalPrivileges.length ? selectedUser.globalPrivileges.join(', ') : 'None'}</strong></div></div>
        {selectedUser.system ? <Alert color="yellow" icon={<IconShieldLock size={16} />}>This protected system account is read-only in MyRepos.</Alert> : <>
          <section><header><strong>Database access</strong><small>Choose a database, then grant or revoke the supported privileges.</small></header>
            <Select label="Database" data={databases.map((item) => item.name)} value={editDatabase} onChange={chooseEditDatabase} />
            <PrivilegePicker value={editPrivileges} onChange={setEditPrivileges} disabled={!editDatabase} />
            <Group justify="flex-end"><Button size="xs" loading={busy} disabled={!editDatabase} onClick={() => void saveDatabaseAccess()}>Save database access</Button></Group></section>
          <section><header><strong>Change password</strong><small>The password is streamed securely and is not saved by MyRepos.</small></header>
            {selectedIsActiveCredential && <Alert color="yellow" variant="light">This account currently authenticates MyRepos. Change its saved credential from Database administration access instead.</Alert>}
            <div className="ssh-mysql-user-fields"><PasswordInput label="New password" disabled={selectedIsActiveCredential} value={newPassword} onChange={(event) => setNewPassword(event.currentTarget.value)} /><PasswordInput label="Confirm password" disabled={selectedIsActiveCredential} error={newPasswordConfirm && newPassword !== newPasswordConfirm ? 'Passwords do not match.' : undefined} value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.currentTarget.value)} /></div>
            <Group justify="flex-end"><Button size="xs" variant="light" loading={busy} disabled={selectedIsActiveCredential || !newPassword || newPassword !== newPasswordConfirm} onClick={() => void changePassword()}>Change password</Button></Group></section>
          <section className="ssh-mysql-user-danger"><header><strong>Delete account</strong><small>Existing databases remain, but this account and its grants are removed.</small></header>
            {selectedIsActiveCredential && <Text size="xs" c="yellow">This active administration account cannot be deleted while it is in use.</Text>}
            {!dropOpen ? <Button size="xs" variant="light" color="red" disabled={selectedIsActiveCredential} leftSection={<IconTrash size={13} />} onClick={() => { setDropOpen(true); setDropConfirmation('') }}>Delete user</Button>
              : <><TextInput label={<>Type <strong>{selectedUser.username}@{selectedUser.host}</strong> to confirm</>} value={dropConfirmation} onChange={(event) => setDropConfirmation(event.currentTarget.value)} autoFocus />
                <Group justify="flex-end"><Button size="xs" variant="default" disabled={busy} onClick={() => setDropOpen(false)}>Cancel</Button><Button size="xs" color="red" loading={busy} disabled={dropConfirmation !== `${selectedUser.username}@${selectedUser.host}`} onClick={() => void deleteUser()}>Permanently delete</Button></Group></>}
          </section></>}
        {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      </div>}
    </Modal>
  </div>
}
