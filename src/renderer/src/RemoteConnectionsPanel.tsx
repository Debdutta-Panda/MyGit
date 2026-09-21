import { useEffect, useState, type ReactNode } from 'react'
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Group, Menu, Modal, NumberInput, Paper,
  PasswordInput, Progress, Select, Stack, Text, TextInput, ThemeIcon,
} from '@mantine/core'
import {
  IconAlertCircle, IconCheck, IconDotsVertical, IconEdit, IconKey, IconPlugConnected, IconPlus,
  IconServer2, IconShieldCheck, IconTrash,
} from '@tabler/icons-react'
import type {
  RemoteAuthenticationType, RemoteConnection, RemoteConnectionInput,
  RemoteConnectionProtocol, RemoteConnectionTestResult, RemoteSftpSource, SshConnection,
} from '../../shared/desktop-api'

interface Draft {
  id?: string
  name: string
  protocol: RemoteConnectionProtocol
  host: string
  port: number | string
  username: string
  sftpSource: RemoteSftpSource
  sshConnectionId: string | null
  parentSshConnectionId: string | null
  authenticationType: RemoteAuthenticationType
  privateKeyPath: string
  agentSocket: string
  password: string
  passphrase: string
  hasPassword: boolean
  hasPassphrase: boolean
  tlsMode: 'explicit' | 'implicit'
  rejectUnauthorized: boolean
}

const blank = (): Draft => ({
  name: '', protocol: 'sftp', host: '', port: 22, username: '', sftpSource: 'ssh',
  sshConnectionId: null, authenticationType: 'password', privateKeyPath: '', agentSocket: '',
  parentSshConnectionId: null,
  password: '', passphrase: '', hasPassword: false, hasPassphrase: false,
  tlsMode: 'explicit', rejectUnauthorized: true,
})
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
const connectionTestMessage = (error: unknown, connection: RemoteConnection): string => {
  const value = message(error)
  if (/timeout.*control socket|control socket.*timeout/i.test(value)) {
    const port = connection.port ?? (connection.protocol === 'ftps' && connection.tlsMode === 'implicit' ? 990 : 21)
    return `Timed out connecting to ${connection.host}:${port}. Check that the ${connection.protocol.toUpperCase()} service is running and the port is allowed by the firewall.`
  }
  return value
}
const protocolLabel = (item: RemoteConnection): string => item.protocol === 'ftp' ? 'FTP'
  : item.protocol === 'ftps' ? `FTPS ${item.tlsMode ?? 'explicit'}` : 'SFTP'

export function RemoteConnectionsPanel({
  sshConnections,
  onAddSsh,
  children,
  serverConnection,
}: {
  sshConnections: SshConnection[]
  onAddSsh?: () => void
  children?: ReactNode
  serverConnection?: SshConnection
}) {
  const [connections, setConnections] = useState<RemoteConnection[]>([])
  const [draft, setDraft] = useState<Draft>(blank)
  const [opened, setOpened] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testSeconds, setTestSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { color: 'teal' | 'red'; text: string }>>({})
  const [trust, setTrust] = useState<{ connection: RemoteConnection; result: RemoteConnectionTestResult } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RemoteConnection | null>(null)

  const load = async (): Promise<void> => {
    try { setConnections(await window.desktop.remoteConnections.list()) }
    catch (reason) { setError(message(reason)) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!testing) return
    setTestSeconds(0)
    const timer = window.setInterval(() => setTestSeconds((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [testing])

  const visibleConnections = serverConnection
    ? connections.filter((item) => item.parentSshConnectionId === serverConnection.id ||
      (item.protocol === 'sftp' && item.sftpSource === 'ssh' && item.sshConnectionId === serverConnection.id))
    : connections

  const open = (connection?: RemoteConnection, protocol?: RemoteConnectionProtocol): void => {
    setError(null)
    setDraft(connection ? {
      id: connection.id, name: connection.name, protocol: connection.protocol,
      host: connection.host ?? '', port: connection.port ?? (connection.protocol === 'sftp' ? 22 : 21),
      username: connection.username ?? '', sftpSource: connection.sftpSource ?? 'ssh',
      sshConnectionId: connection.sshConnectionId,
      parentSshConnectionId: connection.parentSshConnectionId,
      authenticationType: connection.authenticationType ?? 'password',
      privateKeyPath: connection.privateKeyPath ?? '', agentSocket: connection.agentSocket ?? '',
      password: '', passphrase: '', hasPassword: connection.hasPassword,
      hasPassphrase: connection.hasPassphrase, tlsMode: connection.tlsMode ?? 'explicit',
      rejectUnauthorized: connection.rejectUnauthorized,
    } : {
      ...blank(),
      name: serverConnection && protocol ? `${serverConnection.name} ${protocol.toUpperCase()}` : '',
      protocol: protocol ?? 'sftp',
      port: protocol === 'ftp' || protocol === 'ftps' ? 21 : 22,
      sftpSource: protocol === 'sftp' ? 'ssh' : 'standalone',
      host: serverConnection?.host ?? '',
      username: serverConnection?.username ?? '',
      sshConnectionId: serverConnection?.id ?? sshConnections[0]?.id ?? null,
      parentSshConnectionId: serverConnection?.id ?? null,
    })
    setOpened(true)
  }
  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }))

  const save = async (): Promise<void> => {
    setSaving(true); setError(null)
    try {
      const input: RemoteConnectionInput = {
        ...draft,
        id: draft.id,
        parentSshConnectionId: serverConnection?.id ?? draft.parentSshConnectionId,
      }
      setConnections(await window.desktop.remoteConnections.save(input))
      setOpened(false)
    } catch (reason) { setError(message(reason)) }
    finally { setSaving(false) }
  }

  const test = async (connection: RemoteConnection, trustHostKey = false): Promise<void> => {
    setTesting(connection.id); setError(null)
    setResults((current) => {
      const next = { ...current }
      delete next[connection.id]
      return next
    })
    try {
      const result = await window.desktop.remoteConnections.test(connection.id, trustHostKey)
      if (result.status === 'untrusted') setTrust({ connection, result })
      else {
        setTrust(null)
        setResults((current) => ({ ...current, [connection.id]: {
          color: 'teal', text: `${result.message}${result.rootPath ? ` Root: ${result.rootPath}` : ''}`,
        } }))
        await load()
      }
    } catch (reason) {
      setTrust(null)
      setResults((current) => ({
        ...current,
        [connection.id]: { color: 'red', text: connectionTestMessage(reason, connection) },
      }))
    } finally { setTesting(null) }
  }

  const chooseKey = async (): Promise<void> => {
    const path = await window.desktop.remoteConnections.choosePrivateKey()
    if (path) update('privateKeyPath', path)
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <div>
          <Text fz={serverConnection ? 17 : 22} fw={720} className="page-title">
            {serverConnection ? 'File transfer connections' : 'Connections'}
          </Text>
          <Text size="xs" c="dimmed">
            {serverConnection ? `Managed for ${serverConnection.host}` : 'SSH, FTP, FTPS and SFTP'}
          </Text>
        </div>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button size="sm" leftSection={<IconPlus size={16} />}>Add connection</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {!serverConnection && onAddSsh && <Menu.Item onClick={onAddSsh}>SSH</Menu.Item>}
            <Menu.Item onClick={() => open(undefined, 'ftp')}>FTP</Menu.Item>
            <Menu.Item onClick={() => open(undefined, 'ftps')}>FTPS</Menu.Item>
            <Menu.Item onClick={() => open(undefined, 'sftp')}>SFTP</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      {error && <Alert color="red" withCloseButton onClose={() => setError(null)}>{error}</Alert>}
      {(serverConnection ? visibleConnections.length === 0
        : visibleConnections.length === 0 && sshConnections.length === 0) ? (
        <Paper className="empty-state connections-empty" radius="lg">
          <IconServer2 size={30} />
          <Text fw={680}>No connections yet</Text>
          <Text size="sm" c="dimmed">Add SSH, FTP, FTPS, or SFTP.</Text>
        </Paper>
      ) : (
        <div className="ssh-grid">
          {children}
          {visibleConnections.map((connection) => (
            <Paper className="ssh-card" radius="lg" key={connection.id}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon variant="light" color={connection.protocol === 'ftp' ? 'orange' : 'teal'} size={40}>
                    <IconServer2 size={21} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700}>{connection.name}</Text>
                    <Text size="xs" c="dimmed">
                      {connection.sftpSource === 'ssh' ? 'Linked to SSH profile'
                        : `${connection.username}@${connection.host}:${connection.port}`}
                    </Text>
                  </div>
                </Group>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${connection.name}`}>
                    <IconDotsVertical size={17} /></ActionIcon></Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconPlugConnected size={15} />} disabled={testing === connection.id}
                      onClick={() => void test(connection)}>Test</Menu.Item>
                    <Menu.Item leftSection={<IconEdit size={15} />} onClick={() => open(connection)}>Edit</Menu.Item>
                    <Menu.Divider />
                    <Menu.Item color="red" leftSection={<IconTrash size={15} />}
                      onClick={() => setRemoveTarget(connection)}>Delete</Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
              <Group gap={7} mt="md">
                <Badge variant="light">{protocolLabel(connection)}</Badge>
                {testing === connection.id && <Badge color="yellow" variant="light">
                  Testing{testSeconds ? ` · ${testSeconds}s` : '…'}
                </Badge>}
                {connection.protocol === 'sftp' && <Badge variant="outline" color="teal">
                  {connection.sftpSource === 'ssh' ? 'Uses SSH profile' : 'Standalone'}
                </Badge>}
              </Group>
              {testing === connection.id && (
                <Progress mt="sm" size="xs" value={100} striped animated color="yellow" />
              )}
              {results[connection.id] && <Alert mt="sm" color={results[connection.id].color}
                icon={results[connection.id].color === 'teal' ? <IconCheck size={15} /> : <IconAlertCircle size={15} />}>
                <Text size="xs">{results[connection.id].text}</Text>
              </Alert>}
            </Paper>
          ))}
        </div>
      )}

      <Modal opened={opened} onClose={() => !saving && setOpened(false)}
        title={draft.id ? 'Edit file-transfer connection' : 'Add file-transfer connection'} size="lg" centered>
        <Stack>
          <TextInput label="Connection name" required value={draft.name}
            onChange={(event) => update('name', event.currentTarget.value)} />
          <Select label="Protocol" allowDeselect={false} value={draft.protocol}
            data={[{ value: 'ftp', label: 'FTP (unencrypted)' }, { value: 'ftps', label: 'FTPS (TLS)' },
              { value: 'sftp', label: 'SFTP (over SSH)' }]}
            onChange={(value) => {
              const protocol = (value ?? 'sftp') as RemoteConnectionProtocol
              setDraft((current) => ({ ...current, protocol,
                port: protocol === 'sftp' ? 22 : protocol === 'ftps' && current.tlsMode === 'implicit' ? 990 : 21 }))
            }} />
          {draft.protocol === 'sftp' && <Select label="SFTP connection source" allowDeselect={false}
            value={draft.sftpSource} data={[{ value: 'ssh', label: 'Use an existing SSH connection' },
              { value: 'standalone', label: 'Standalone SFTP credentials' }]}
            onChange={(value) => update('sftpSource', (value ?? 'ssh') as RemoteSftpSource)} />}
          {draft.protocol === 'sftp' && draft.sftpSource === 'ssh' ? (
            <Select label="SSH connection" required searchable value={draft.sshConnectionId}
              data={sshConnections.map((item) => ({ value: item.id, label: `${item.name} — ${item.username}@${item.host}` }))}
              onChange={(value) => update('sshConnectionId', value)}
              description="The SSH profile supplies its host, authentication, and verified fingerprint." />
          ) : <>
            <div className="ssh-form-grid">
              <TextInput label="Host" required value={draft.host}
                onChange={(event) => update('host', event.currentTarget.value)} />
              <NumberInput label="Port" min={1} max={65535} required value={draft.port}
                onChange={(value) => update('port', value)} />
              <TextInput label="Username" required value={draft.username}
                onChange={(event) => update('username', event.currentTarget.value)} />
            </div>
            {draft.protocol === 'ftps' && <>
              <Select label="TLS mode" value={draft.tlsMode} allowDeselect={false}
                data={[{ value: 'explicit', label: 'Explicit TLS (usually port 21)' },
                  { value: 'implicit', label: 'Implicit TLS (usually port 990)' }]}
                onChange={(value) => update('tlsMode', (value ?? 'explicit') as 'explicit' | 'implicit')} />
              <Checkbox label="Verify the server TLS certificate" checked={draft.rejectUnauthorized}
                onChange={(event) => update('rejectUnauthorized', event.currentTarget.checked)} />
            </>}
            {draft.protocol === 'sftp' && <Select label="Authentication" allowDeselect={false}
              value={draft.authenticationType} data={[{ value: 'password', label: 'Password' },
                { value: 'private-key', label: 'Private key' }, { value: 'agent', label: 'SSH agent' }]}
              onChange={(value) => update('authenticationType', (value ?? 'password') as RemoteAuthenticationType)} />}
            {(draft.protocol !== 'sftp' || draft.authenticationType === 'password') &&
              <PasswordInput label="Password" required={!draft.hasPassword}
                placeholder={draft.hasPassword ? 'Stored securely — leave blank to keep' : 'Password'}
                value={draft.password} onChange={(event) => update('password', event.currentTarget.value)} />}
            {draft.protocol === 'sftp' && draft.authenticationType === 'private-key' && <>
              <TextInput label="Private key file" required value={draft.privateKeyPath}
                onChange={(event) => update('privateKeyPath', event.currentTarget.value)}
                rightSection={<ActionIcon variant="subtle" onClick={() => void chooseKey()}><IconKey size={17} /></ActionIcon>} />
              <PasswordInput label="Key passphrase" value={draft.passphrase}
                placeholder={draft.hasPassphrase ? 'Stored securely — leave blank to keep' : 'Optional'}
                onChange={(event) => update('passphrase', event.currentTarget.value)} />
            </>}
            {draft.protocol === 'sftp' && draft.authenticationType === 'agent' &&
              <TextInput label="Agent socket" value={draft.agentSocket} placeholder="Automatic"
                onChange={(event) => update('agentSocket', event.currentTarget.value)} />}
          </>}
          <Alert color="teal" icon={<IconShieldCheck size={16} />}>
            Passwords and passphrases stay encrypted on this device and are never included in config sync.
          </Alert>
          <Group justify="flex-end"><Button variant="subtle" color="gray" onClick={() => setOpened(false)}>Cancel</Button>
            <Button loading={saving} onClick={() => void save()}>Save securely</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(trust)} onClose={() => setTrust(null)} title="Verify SFTP server identity" centered>
        <Stack><Text size="sm">Confirm this fingerprint through a trusted source before continuing.</Text>
          <Paper p="sm"><code>{trust?.result.fingerprint}</code></Paper>
          <Group justify="flex-end"><Button variant="subtle" onClick={() => setTrust(null)}>Cancel</Button>
            <Button loading={testing === trust?.connection.id} onClick={() => trust && void test(trust.connection, true)}>
              Trust and test</Button></Group></Stack>
      </Modal>
      <Modal opened={Boolean(removeTarget)} onClose={() => setRemoveTarget(null)} title="Delete connection?" centered>
        <Stack><Text size="sm">Remove <strong>{removeTarget?.name}</strong> and its locally stored credentials?</Text>
          <Group justify="flex-end"><Button variant="subtle" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button color="red" onClick={() => void (async () => {
              if (!removeTarget) return
              setConnections(await window.desktop.remoteConnections.remove(removeTarget.id)); setRemoveTarget(null)
            })()}>Delete</Button></Group></Stack>
      </Modal>
    </Stack>
  )
}
