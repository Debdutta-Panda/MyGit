import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionIcon, Badge, Button, Checkbox, Group, Loader, Modal, MultiSelect, PasswordInput, SegmentedControl, Select, Switch, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import {
  IconHome,
  IconFolderCog,
  IconRefresh,
  IconSearch,
  IconShield,
  IconKey,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconTrash,
  IconTerminal2,
  IconUser,
  IconUserPlus,
  IconUsersGroup,
} from '@tabler/icons-react'
import type { SshAccountCatalog, SshAccountOperation, SshConnection, SshServerGroup, SshServerUser } from '../../shared/desktop-api'
import { SshAccessManager } from './SshAccessManager'

const messageFor = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)
type AccountDialog = 'create-user' | 'edit-user' | 'password' | 'keys' | 'delete-user'
  | 'toggle-lock' | 'toggle-admin' | 'create-group' | 'rename-group' | 'group-members' | 'delete-group'
interface AccountForm {
  username: string
  newUsername: string
  displayName: string
  homeDirectory: string
  shell: string
  primaryGroup: string
  groups: string[]
  password: string
  confirmPassword: string
  moveHome: boolean
  removeHome: boolean
  authorizedKeys: string
  confirmation: string
  group: string
  newGroup: string
  members: string[]
}
const emptyForm = (): AccountForm => ({
  username: '', newUsername: '', displayName: '', homeDirectory: '', shell: '/bin/bash', primaryGroup: '', groups: [],
  password: '', confirmPassword: '', moveHome: false, removeHome: false, authorizedKeys: '',
  confirmation: '', group: '', newGroup: '', members: [],
})

export function SshUsersGroupsManager({ connection }: { connection: SshConnection }) {
  const [catalog, setCatalog] = useState<SshAccountCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'users' | 'groups'>('users')
  const [query, setQuery] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [dialog, setDialog] = useState<AccountDialog | null>(null)
  const [form, setForm] = useState<AccountForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [accessUser, setAccessUser] = useState<SshServerUser | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true)
    setError(null)
    try {
      const next = await window.desktop.ssh.accountCatalog(connection.id)
      setCatalog(next)
      setSelectedUser((current) => current && next.users.some((user) => user.username === current) ? current : null)
      setSelectedGroup((current) => current && next.groups.some((group) => group.name === current) ? current : null)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  useEffect(() => { void load() }, [load])

  const users = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (catalog?.users ?? []).filter((user) => (showSystem || !user.system)
      && (!needle || [user.username, user.displayName, user.homeDirectory, user.shell, ...user.groups]
        .some((value) => value.toLocaleLowerCase().includes(needle))))
  }, [catalog, query, showSystem])
  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (catalog?.groups ?? []).filter((group) => (showSystem || !group.system)
      && (!needle || [group.name, ...group.members].some((value) => value.toLocaleLowerCase().includes(needle))))
  }, [catalog, query, showSystem])
  const activeUser: SshServerUser | null = catalog?.users.find((user) => user.username === selectedUser) ?? null
  const activeGroup: SshServerGroup | null = catalog?.groups.find((group) => group.name === selectedGroup) ?? null

  const closeDialog = (): void => {
    if (saving) return
    setDialog(null)
    setDialogError(null)
    setForm(emptyForm())
  }
  const openUserDialog = async (kind: AccountDialog, user: SshServerUser): Promise<void> => {
    setDialogError(null)
    setForm({ ...emptyForm(), username: user.username, newUsername: user.username,
      displayName: user.displayName, homeDirectory: user.homeDirectory, shell: user.shell,
      primaryGroup: user.primaryGroup, groups: user.groups.filter((group) => group !== user.primaryGroup) })
    setDialog(kind)
    if (kind === 'keys' && window.desktop) {
      setSaving(true)
      try {
        const authorizedKeys = await window.desktop.ssh.authorizedKeys(connection.id, user.username)
        setForm((current) => ({ ...current, authorizedKeys }))
      } catch (reason) {
        setDialogError(messageFor(reason))
      } finally {
        setSaving(false)
      }
    }
  }
  const openGroupDialog = (kind: AccountDialog, group?: SshServerGroup): void => {
    setForm({ ...emptyForm(), group: group?.name ?? '', newGroup: group?.name ?? '', members: group?.members ?? [] })
    setDialogError(null)
    setDialog(kind)
  }

  const submit = async (): Promise<void> => {
    if (!window.desktop || !dialog || !catalog?.canManage) return
    setSaving(true)
    setDialogError(null)
    try {
      let operation: SshAccountOperation
      if (dialog === 'create-user') {
        if (form.password !== form.confirmPassword) throw new Error('The passwords do not match.')
        operation = { kind: 'create-user', username: form.username, displayName: form.displayName,
          homeDirectory: form.homeDirectory || `/home/${form.username}`, shell: form.shell,
          primaryGroup: form.primaryGroup, groups: form.groups, password: form.password }
      } else if (dialog === 'edit-user') {
        operation = { kind: 'update-user', username: form.username, newUsername: form.newUsername,
          displayName: form.displayName, homeDirectory: form.homeDirectory, shell: form.shell,
          primaryGroup: form.primaryGroup, groups: form.groups, moveHome: form.moveHome }
      } else if (dialog === 'password') {
        if (!form.password || form.password !== form.confirmPassword) throw new Error('Enter matching passwords.')
        operation = { kind: 'set-password', username: form.username, password: form.password }
      } else if (dialog === 'keys') {
        operation = { kind: 'set-authorized-keys', username: form.username, content: form.authorizedKeys }
      } else if (dialog === 'toggle-lock') {
        const user = catalog.users.find((item) => item.username === form.username)
        operation = { kind: 'set-locked', username: form.username, locked: !(user?.locked ?? false) }
      } else if (dialog === 'toggle-admin') {
        const user = catalog.users.find((item) => item.username === form.username)
        operation = { kind: 'set-administrator', username: form.username, administrator: !(user?.administrator ?? false) }
      } else if (dialog === 'delete-user') {
        if (form.confirmation !== form.username) throw new Error('Type the username exactly to confirm deletion.')
        operation = { kind: 'delete-user', username: form.username, removeHome: form.removeHome }
      } else if (dialog === 'create-group') {
        operation = { kind: 'create-group', group: form.group }
      } else if (dialog === 'rename-group') {
        operation = { kind: 'rename-group', group: form.group, newGroup: form.newGroup }
      } else if (dialog === 'group-members') {
        operation = { kind: 'set-group-members', group: form.group, members: form.members }
      } else {
        if (form.confirmation !== form.group) throw new Error('Type the group name exactly to confirm deletion.')
        operation = { kind: 'delete-group', group: form.group }
      }
      const next = await window.desktop.ssh.manageAccounts(connection.id, operation)
      setCatalog(next)
      if (dialog === 'edit-user') setSelectedUser(form.newUsername)
      if (dialog === 'create-user') setSelectedUser(form.username)
      if (dialog === 'rename-group') setSelectedGroup(form.newGroup)
      if (dialog === 'create-group') setSelectedGroup(form.group)
      if (dialog === 'delete-user') setSelectedUser(null)
      if (dialog === 'delete-group') setSelectedGroup(null)
      setDialog(null)
      setForm(emptyForm())
    } catch (reason) {
      setDialogError(messageFor(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ssh-accounts-manager">
      <header className="ssh-accounts-toolbar">
        <SegmentedControl size="xs" value={view} onChange={(value) => setView(value as 'users' | 'groups')}
          data={[{ value: 'users', label: `Users ${catalog?.users.length ?? 0}` }, { value: 'groups', label: `Groups ${catalog?.groups.length ?? 0}` }]} />
        <TextInput size="xs" value={query} placeholder={`Search ${view}`} leftSection={<IconSearch size={13} />}
          onChange={(event) => setQuery(event.currentTarget.value)} />
        <Switch size="xs" checked={showSystem} label="System accounts" onChange={(event) => setShowSystem(event.currentTarget.checked)} />
        <Tooltip label="Refresh accounts"><ActionIcon variant="subtle" color="gray" loading={loading}
          onClick={() => void load()}><IconRefresh size={16} /></ActionIcon></Tooltip>
        <Tooltip label={catalog?.canManage ? `Create a server ${view === 'users' ? 'user' : 'group'}` : catalog?.privilegeMessage}>
          <Button size="compact-xs" leftSection={<IconUserPlus size={14} />} disabled={!catalog?.canManage}
            onClick={() => view === 'users' ? (setForm(emptyForm()), setDialog('create-user')) : openGroupDialog('create-group')}>
            Add {view === 'users' ? 'user' : 'group'}
          </Button>
        </Tooltip>
      </header>

      {catalog && (
        <div className="ssh-accounts-privilege" data-manage={catalog.canManage || undefined}>
          <IconShield size={15} />
          <span><strong>{catalog.currentUser}</strong> · {catalog.privilegeMessage}</span>
          <Badge size="xs" variant="light" color={catalog.canManage ? 'teal' : 'gray'}>{catalog.canManage ? 'ADMIN READY' : 'READ ONLY'}</Badge>
        </div>
      )}
      {error && <div className="ssh-accounts-error">{error}</div>}

      {loading && !catalog ? (
        <div className="ssh-accounts-loading"><Loader size="sm" /><Text size="sm">Reading server accounts...</Text></div>
      ) : (
        <div className="ssh-accounts-layout">
          <div className="ssh-accounts-list">
            {view === 'users' ? users.map((user) => (
              <button type="button" key={user.username} data-active={selectedUser === user.username || undefined}
                onClick={() => setSelectedUser(user.username)}>
                <span className="ssh-account-avatar"><IconUser size={15} /></span>
                <span className="ssh-account-main"><strong>{user.username}</strong><small>{user.displayName || user.homeDirectory}</small></span>
                <span className="ssh-account-badges">
                  {user.username === catalog?.currentUser && <Badge size="xs" color="teal">YOU</Badge>}
                  {user.administrator && <Badge size="xs" color="yellow" variant="light">ADMIN</Badge>}
                  {user.locked && <Badge size="xs" color="red" variant="light">LOCKED</Badge>}
                  {user.system && <Badge size="xs" color="gray" variant="outline">SYSTEM</Badge>}
                </span>
                <span className="ssh-account-id">UID {user.uid}</span>
              </button>
            )) : groups.map((group) => (
              <button type="button" key={group.name} data-active={selectedGroup === group.name || undefined}
                onClick={() => setSelectedGroup(group.name)}>
                <span className="ssh-account-avatar"><IconUsersGroup size={15} /></span>
                <span className="ssh-account-main"><strong>{group.name}</strong><small>{group.members.length} explicit member{group.members.length === 1 ? '' : 's'}</small></span>
                <span className="ssh-account-badges">
                  {group.administrator && <Badge size="xs" color="yellow" variant="light">ADMIN</Badge>}
                  {group.system && <Badge size="xs" color="gray" variant="outline">SYSTEM</Badge>}
                </span>
                <span className="ssh-account-id">GID {group.gid}</span>
              </button>
            ))}
            {(view === 'users' ? users.length : groups.length) === 0 && (
              <div className="ssh-accounts-empty">No matching {view}.</div>
            )}
          </div>

          <aside className="ssh-account-detail">
            {view === 'users' && activeUser ? (
              <>
                <div className="ssh-account-detail-title"><IconUser size={20} /><div><strong>{activeUser.username}</strong><span>{activeUser.displayName || 'No display name'}</span></div></div>
                <div className="ssh-account-actions">
                  <Tooltip label="Edit identity, shell, home and groups"><ActionIcon variant="subtle" color="gray"
                    disabled={!catalog?.canManage || activeUser.username === 'root' || activeUser.username === catalog.currentUser}
                    onClick={() => void openUserDialog('edit-user', activeUser)}><IconPencil size={15} /></ActionIcon></Tooltip>
                  <Tooltip label="Reset password"><ActionIcon variant="subtle" color="gray"
                    disabled={!catalog?.canManage || activeUser.username === 'root'}
                    onClick={() => void openUserDialog('password', activeUser)}><IconKey size={15} /></ActionIcon></Tooltip>
                  <Tooltip label="Manage authorized SSH keys"><ActionIcon variant="subtle" color="gray"
                    disabled={!catalog?.canManage || activeUser.username === 'root'}
                    onClick={() => void openUserDialog('keys', activeUser)}><IconTerminal2 size={15} /></ActionIcon></Tooltip>
                  <Tooltip label="Manage filesystem ownership, permissions and ACLs"><ActionIcon variant="subtle" color="gray"
                    disabled={!catalog?.canManage}
                    onClick={() => setAccessUser(activeUser)}><IconFolderCog size={15} /></ActionIcon></Tooltip>
                  <Tooltip label={activeUser.locked ? 'Unlock account' : 'Lock account'}><ActionIcon variant="subtle" color={activeUser.locked ? 'teal' : 'gray'}
                    disabled={!catalog?.canManage || activeUser.username === 'root' || activeUser.username === catalog.currentUser}
                    onClick={() => void openUserDialog('toggle-lock', activeUser)}>{activeUser.locked ? <IconLockOpen size={15} /> : <IconLock size={15} />}</ActionIcon></Tooltip>
                  <Tooltip label={activeUser.administrator ? 'Remove administrator access' : 'Grant administrator access'}><ActionIcon variant="subtle" color={activeUser.administrator ? 'yellow' : 'gray'}
                    disabled={!catalog?.canManage || activeUser.username === 'root' || (activeUser.username === catalog.currentUser && activeUser.administrator)}
                    onClick={() => void openUserDialog('toggle-admin', activeUser)}><IconShield size={15} /></ActionIcon></Tooltip>
                  <Tooltip label="Delete user"><ActionIcon variant="subtle" color="red"
                    disabled={!catalog?.canManage || activeUser.username === 'root' || activeUser.username === catalog.currentUser}
                    onClick={() => void openUserDialog('delete-user', activeUser)}><IconTrash size={15} /></ActionIcon></Tooltip>
                </div>
                <dl>
                  <div><dt>Identity</dt><dd>UID {activeUser.uid} · GID {activeUser.gid}</dd></div>
                  <div><dt>Primary group</dt><dd>{activeUser.primaryGroup}</dd></div>
                  <div><dt><IconHome size={13} /> Home</dt><dd>{activeUser.homeDirectory}</dd></div>
                  <div><dt><IconTerminal2 size={13} /> Shell</dt><dd>{activeUser.shell}</dd></div>
                </dl>
                <div className="ssh-account-groups"><Text size="xs" fw={700}>Group membership</Text><Group gap={5}>
                  {activeUser.groups.map((group) => <Badge key={group} size="sm" variant="outline" color="gray">{group}</Badge>)}
                </Group></div>
              </>
            ) : view === 'groups' && activeGroup ? (
              <>
                <div className="ssh-account-detail-title"><IconUsersGroup size={20} /><div><strong>{activeGroup.name}</strong><span>GID {activeGroup.gid}</span></div></div>
                <div className="ssh-account-actions">
                  <Tooltip label="Rename group"><ActionIcon variant="subtle" color="gray"
                    disabled={!catalog?.canManage || ['root', 'sudo', 'wheel'].includes(activeGroup.name)}
                    onClick={() => openGroupDialog('rename-group', activeGroup)}><IconPencil size={15} /></ActionIcon></Tooltip>
                  <Tooltip label="Edit explicit members"><ActionIcon variant="subtle" color="gray"
                    disabled={!catalog?.canManage || ['root', 'sudo', 'wheel'].includes(activeGroup.name)}
                    onClick={() => openGroupDialog('group-members', activeGroup)}><IconUsersGroup size={15} /></ActionIcon></Tooltip>
                  <Tooltip label="Delete group"><ActionIcon variant="subtle" color="red"
                    disabled={!catalog?.canManage || ['root', 'sudo', 'wheel'].includes(activeGroup.name)}
                    onClick={() => openGroupDialog('delete-group', activeGroup)}><IconTrash size={15} /></ActionIcon></Tooltip>
                </div>
                <div className="ssh-account-groups"><Text size="xs" fw={700}>Explicit members</Text><Group gap={5}>
                  {activeGroup.members.map((member) => <Badge key={member} size="sm" variant="outline" color="gray">{member}</Badge>)}
                  {!activeGroup.members.length && <Text size="xs" c="dimmed">No explicitly assigned members.</Text>}
                </Group></div>
              </>
            ) : (
              <div className="ssh-account-detail-empty"><IconUsersGroup size={28} /><Text size="sm">Select a {view === 'users' ? 'user' : 'group'} to inspect</Text></div>
            )}
          </aside>
        </div>
      )}

      <Modal opened={dialog !== null} onClose={closeDialog} size={dialog === 'keys' || dialog === 'create-user' || dialog === 'edit-user' ? 'lg' : 'sm'}
        title={dialog === 'create-user' ? 'Create server user'
          : dialog === 'edit-user' ? `Edit ${form.username}`
            : dialog === 'password' ? `Reset password for ${form.username}`
              : dialog === 'keys' ? `Authorized keys for ${form.username}`
                : dialog === 'delete-user' ? `Delete ${form.username}?`
                  : dialog === 'toggle-lock' ? `${activeUser?.locked ? 'Unlock' : 'Lock'} ${form.username}?`
                    : dialog === 'toggle-admin' ? `${activeUser?.administrator ? 'Remove administrator access from' : 'Grant administrator access to'} ${form.username}?`
                      : dialog === 'create-group' ? 'Create server group'
                        : dialog === 'rename-group' ? `Rename ${form.group}`
                          : dialog === 'group-members' ? `Members of ${form.group}` : `Delete ${form.group}?`}>
        <div className="ssh-account-dialog">
          {(dialog === 'create-user' || dialog === 'edit-user') && (
            <>
              <div className="ssh-account-form-grid">
                <TextInput autoFocus label="Username" value={dialog === 'create-user' ? form.username : form.newUsername}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setForm((current) => ({ ...current, [dialog === 'create-user' ? 'username' : 'newUsername']: value }))
                  }} />
                <TextInput label="Display name" value={form.displayName}
                  onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, displayName: value })) }} />
                <TextInput label="Home directory" placeholder={form.username ? `/home/${form.username}` : '/home/username'} value={form.homeDirectory}
                  onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, homeDirectory: value })) }} />
                <TextInput label="Login shell" value={form.shell}
                  onChange={(event) => { const value = event.currentTarget.value; setForm((current) => ({ ...current, shell: value })) }} />
              </div>
              <MultiSelect label="Supplementary groups" searchable clearable value={form.groups}
                data={(catalog?.groups ?? []).map((group) => group.name).filter((group) => group !== form.primaryGroup)}
                onChange={(groups) => setForm((current) => ({ ...current, groups }))} />
              <Select label="Primary group" searchable clearable value={form.primaryGroup || null}
                placeholder={dialog === 'create-user' ? 'Create private same-name group' : 'Select primary group'}
                data={(catalog?.groups ?? []).map((group) => group.name)}
                onChange={(primaryGroup) => setForm((current) => ({ ...current,
                  primaryGroup: primaryGroup ?? '', groups: current.groups.filter((group) => group !== primaryGroup) }))} />
              {dialog === 'edit-user' && <Checkbox checked={form.moveHome} label="Move existing home contents when changing the home path"
                onChange={(event) => { const moveHome = event.currentTarget.checked; setForm((current) => ({ ...current, moveHome })) }} />}
              {dialog === 'create-user' && <div className="ssh-account-form-grid">
                <PasswordInput label="Initial password (optional)" value={form.password}
                  onChange={(event) => { const password = event.currentTarget.value; setForm((current) => ({ ...current, password })) }} />
                <PasswordInput label="Confirm password" value={form.confirmPassword}
                  onChange={(event) => { const confirmPassword = event.currentTarget.value; setForm((current) => ({ ...current, confirmPassword })) }} />
              </div>}
            </>
          )}
          {dialog === 'password' && <>
            <PasswordInput autoFocus label="New password" value={form.password}
              onChange={(event) => { const password = event.currentTarget.value; setForm((current) => ({ ...current, password })) }} />
            <PasswordInput label="Confirm new password" value={form.confirmPassword}
              onChange={(event) => { const confirmPassword = event.currentTarget.value; setForm((current) => ({ ...current, confirmPassword })) }} />
            <Text size="xs" c="dimmed">The password is sent directly to the server and is never saved by MyRepos.</Text>
          </>}
          {dialog === 'keys' && <Textarea autoFocus autosize minRows={10} maxRows={18} label="authorized_keys"
            description="One OpenSSH public key per line. Saving replaces this user's authorized_keys file."
            value={form.authorizedKeys} disabled={saving}
            onChange={(event) => { const authorizedKeys = event.currentTarget.value; setForm((current) => ({ ...current, authorizedKeys })) }} />}
          {dialog === 'delete-user' && <>
            <Text size="sm">This permanently deletes the account. Running processes and owned files outside the home directory are not removed.</Text>
            <Checkbox color="red" checked={form.removeHome} label="Also delete the user's home directory and mail spool"
              onChange={(event) => { const removeHome = event.currentTarget.checked; setForm((current) => ({ ...current, removeHome })) }} />
            <TextInput autoFocus label={`Type ${form.username} to confirm`} value={form.confirmation}
              onChange={(event) => { const confirmation = event.currentTarget.value; setForm((current) => ({ ...current, confirmation })) }} />
          </>}
          {dialog === 'toggle-lock' && <Text size="sm">{activeUser?.locked
            ? 'Unlocking permits password-based account authentication again.'
            : 'Locking disables the password without deleting the account or its files.'}</Text>}
          {dialog === 'toggle-admin' && <Text size="sm">{activeUser?.administrator
            ? 'This removes the user from detected sudo/wheel administrator groups.'
            : 'This grants administrator access through the detected sudo/wheel group.'}</Text>}
          {dialog === 'create-group' && <TextInput autoFocus label="Group name" value={form.group}
            onChange={(event) => { const group = event.currentTarget.value; setForm((current) => ({ ...current, group })) }} />}
          {dialog === 'rename-group' && <TextInput autoFocus label="New group name" value={form.newGroup}
            onChange={(event) => { const newGroup = event.currentTarget.value; setForm((current) => ({ ...current, newGroup })) }} />}
          {dialog === 'group-members' && <MultiSelect autoFocus searchable clearable label="Explicit group members"
            description="Primary-group membership is managed through each user's primary group."
            data={(catalog?.users ?? []).map((user) => user.username)} value={form.members}
            onChange={(members) => setForm((current) => ({ ...current, members }))} />}
          {dialog === 'delete-group' && <>
            <Text size="sm">The group will be permanently removed. Users and files are not deleted.</Text>
            <TextInput autoFocus label={`Type ${form.group} to confirm`} value={form.confirmation}
              onChange={(event) => { const confirmation = event.currentTarget.value; setForm((current) => ({ ...current, confirmation })) }} />
          </>}
          {dialogError && <div className="ssh-accounts-error">{dialogError}</div>}
          <Group justify="flex-end">
            <Button size="xs" variant="subtle" color="gray" disabled={saving} onClick={closeDialog}>Cancel</Button>
            <Button size="xs" loading={saving} color={dialog === 'delete-user' || dialog === 'delete-group' ? 'red' : 'teal'}
              disabled={(dialog === 'delete-user' && form.confirmation !== form.username)
                || (dialog === 'delete-group' && form.confirmation !== form.group)} onClick={() => void submit()}>
              {dialog === 'delete-user' || dialog === 'delete-group' ? 'Delete permanently' : 'Apply'}
            </Button>
          </Group>
        </div>
      </Modal>
      {catalog && accessUser && <SshAccessManager opened={Boolean(accessUser)} onClose={() => setAccessUser(null)}
        connection={connection} catalog={catalog} defaultUser={accessUser.username} defaultPath={accessUser.homeDirectory} />}
    </section>
  )
}
