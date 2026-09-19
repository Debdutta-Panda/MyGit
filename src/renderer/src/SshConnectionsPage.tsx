import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconCheck,
  IconEdit,
  IconFingerprint,
  IconLayoutDashboard,
  IconKey,
  IconLock,
  IconPlugConnected,
  IconPlus,
  IconServer2,
  IconShieldCheck,
  IconTerminal2,
  IconTrash,
} from '@tabler/icons-react'
import type {
  SshAuthenticationType,
  SshConnection,
  SshConnectionInput,
  SshConnectionTestResult,
  SshVaultStatus,
} from '../../shared/desktop-api'
import './ssh-connections.css'
import { SshServerWorkspace } from './SshServerWorkspace'

interface ConnectionDraft {
  id: string | null
  name: string
  host: string
  port: number | string
  username: string
  authenticationType: SshAuthenticationType
  privateKeyPath: string
  agentSocket: string
  password: string
  passphrase: string
  hasPassword: boolean
  hasPassphrase: boolean
}

const emptyDraft = (): ConnectionDraft => ({
  id: null,
  name: '',
  host: '',
  port: 22,
  username: '',
  authenticationType: 'password',
  privateKeyPath: '',
  agentSocket: '',
  password: '',
  passphrase: '',
  hasPassword: false,
  hasPassphrase: false,
})

const errorMessage = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason)

const authenticationLabel: Record<SshAuthenticationType, string> = {
  password: 'Password',
  'private-key': 'Private key',
  agent: 'SSH agent',
}

export function SshConnectionsPage({
  onOpenTerminal,
}: {
  onOpenTerminal: (connection: SshConnection) => void
}) {
  const [connections, setConnections] = useState<SshConnection[]>([])
  const [vault, setVault] = useState<SshVaultStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, {
    color: 'teal' | 'red'
    message: string
  }>>({})
  const [pendingTrust, setPendingTrust] = useState<{
    connection: SshConnection
    result: SshConnectionTestResult
  } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<SshConnection | null>(null)
  const [workspaceConnection, setWorkspaceConnection] = useState<SshConnection | null>(null)

  const updateDraft = <Key extends keyof ConnectionDraft>(
    key: Key,
    value: ConnectionDraft[Key],
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const load = async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true)
    setError(null)
    try {
      const [items, status] = await Promise.all([
        window.desktop.ssh.list(),
        window.desktop.ssh.vaultStatus(),
      ])
      setConnections(items)
      setVault(status)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const openEditor = (connection?: SshConnection): void => {
    setError(null)
    setDraft(connection
      ? {
          id: connection.id,
          name: connection.name,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          authenticationType: connection.authenticationType,
          privateKeyPath: connection.privateKeyPath ?? '',
          agentSocket: connection.agentSocket ?? '',
          password: '',
          passphrase: '',
          hasPassword: connection.hasPassword,
          hasPassphrase: connection.hasPassphrase,
        }
      : emptyDraft())
    setEditorOpen(true)
  }

  const save = async (): Promise<void> => {
    if (!window.desktop) return
    setSaving(true)
    setError(null)
    try {
      const input: SshConnectionInput = {
        id: draft.id ?? undefined,
        name: draft.name,
        host: draft.host,
        port: Number(draft.port),
        username: draft.username,
        authenticationType: draft.authenticationType,
        privateKeyPath: draft.privateKeyPath || null,
        agentSocket: draft.agentSocket || null,
        password: draft.password || undefined,
        passphrase: draft.passphrase || undefined,
      }
      setConnections(await window.desktop.ssh.save(input))
      setEditorOpen(false)
      setDraft(emptyDraft())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async (
    connection: SshConnection,
    trustHostKey = false,
  ): Promise<void> => {
    if (!window.desktop) return
    setTestingId(connection.id)
    setError(null)
    setTestResults((current) => {
      const next = { ...current }
      delete next[connection.id]
      return next
    })
    try {
      const result = await window.desktop.ssh.test(connection.id, trustHostKey)
      if (result.status === 'untrusted') {
        setPendingTrust({ connection, result })
      } else {
        setPendingTrust(null)
        setTestResults((current) => ({
          ...current,
          [connection.id]: {
            color: 'teal',
            message: `Connected in ${result.latencyMs ?? 0} ms - ${result.fingerprint}`,
          },
        }))
        setConnections(await window.desktop.ssh.list())
      }
    } catch (reason) {
      setPendingTrust(null)
      setTestResults((current) => ({
        ...current,
        [connection.id]: { color: 'red', message: errorMessage(reason) },
      }))
    } finally {
      setTestingId(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (!window.desktop || !removeTarget) return
    try {
      setConnections(await window.desktop.ssh.remove(removeTarget.id))
      setRemoveTarget(null)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const choosePrivateKey = async (): Promise<void> => {
    const path = await window.desktop?.ssh.choosePrivateKey()
    if (path) setDraft((current) => ({ ...current, privateKeyPath: path }))
  }

  if (workspaceConnection) {
    return (
      <SshServerWorkspace
        connection={workspaceConnection}
        onBack={() => setWorkspaceConnection(null)}
        onOpenTerminal={() => onOpenTerminal(workspaceConnection)}
      />
    )
  }

  return (
    <div className="ssh-content">
      <section className="intro-row">
        <div>
          <Text fz={24} fw={720} className="page-title">SSH connections</Text>
          <Text c="dimmed" mt={5} maw={680}>
            Save multiple servers securely. Open shells, files, and visual server tools from one connection profile.
          </Text>
        </div>
        <Group gap="sm" wrap="nowrap">
          <Badge variant="outline" color="gray" size="lg">
            {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
          </Badge>
          <Button leftSection={<IconPlus size={16} />} onClick={() => openEditor()}>
            Add connection
          </Button>
        </Group>
      </section>

      {error && (
        <Alert mt="lg" color="red" icon={<IconAlertCircle size={17} />} withCloseButton
          onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper className="ssh-vault-card" radius="lg">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon
            variant="light"
            color={vault?.available ? 'teal' : 'red'}
            size={38}
            radius="md"
          >
            {vault?.available ? <IconShieldCheck size={20} /> : <IconLock size={20} />}
          </ThemeIcon>
          <div>
            <Text size="sm" fw={680}>OS-protected credentials</Text>
            <Text size="xs" c="dimmed">
              {vault?.available
                ? `Passwords and passphrases are encrypted with ${vault.label} and never returned to the UI.`
                : 'Secure password storage is unavailable. Agent and unencrypted-key profiles remain usable.'}
            </Text>
          </div>
        </Group>
        <Badge variant="light" color={vault?.available ? 'teal' : 'red'}>
          {vault?.label ?? 'Checking...'}
        </Badge>
      </Paper>

      {loading ? (
        <Paper className="empty-state ssh-empty" radius="lg">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading SSH connections...</Text>
        </Paper>
      ) : connections.length === 0 ? (
        <Paper className="empty-state ssh-empty" radius="lg">
          <div className="empty-icon-wrap"><IconServer2 size={35} stroke={1.55} /></div>
          <Text fz={19} fw={680}>Add your first server</Text>
          <Text c="dimmed" size="sm" maw={500} ta="center" lh={1.6}>
            Use a password, private key, or your SSH agent. Host fingerprints are verified before credentials are sent.
          </Text>
          <Button mt="xs" leftSection={<IconPlus size={17} />} onClick={() => openEditor()}>
            Add SSH connection
          </Button>
        </Paper>
      ) : (
        <div className="ssh-grid">
          {connections.map((connection) => {
            const result = testResults[connection.id]
            return (
              <Paper className="ssh-card" radius="lg" key={connection.id}>
                <div className="ssh-card-accent" aria-hidden="true" />
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap" className="ssh-card-main">
                    <ThemeIcon variant="light" color="teal" size={42} radius="md">
                      <IconServer2 size={22} />
                    </ThemeIcon>
                    <div className="ssh-card-identity">
                      <Text fw={720} truncate>{connection.name}</Text>
                      <Text size="sm" c="dimmed" truncate>
                        {connection.username}@{connection.host}:{connection.port}
                      </Text>
                    </div>
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label={connection.hostFingerprint
                      ? 'Open server control center'
                      : 'Test and verify this host before opening its control center'}>
                      <ActionIcon
                        variant="subtle"
                        color="teal"
                        disabled={!connection.hostFingerprint}
                        aria-label={`Manage ${connection.name}`}
                        onClick={() => setWorkspaceConnection(connection)}
                      >
                        <IconLayoutDashboard size={17} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={connection.hostFingerprint
                      ? 'Open SSH terminal'
                      : 'Test and verify this host before opening a terminal'}>
                      <ActionIcon
                        variant="subtle"
                        color="teal"
                        disabled={!connection.hostFingerprint}
                        aria-label={`Open terminal for ${connection.name}`}
                        onClick={() => onOpenTerminal(connection)}
                      >
                        <IconTerminal2 size={17} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Test connection">
                      <ActionIcon
                        variant="subtle"
                        color="teal"
                        loading={testingId === connection.id}
                        aria-label={`Test ${connection.name}`}
                        onClick={() => void testConnection(connection)}
                      >
                        <IconPlugConnected size={17} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Edit connection">
                      <ActionIcon variant="subtle" color="gray" aria-label={`Edit ${connection.name}`}
                        onClick={() => openEditor(connection)}>
                        <IconEdit size={17} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete connection">
                      <ActionIcon variant="subtle" color="red" aria-label={`Delete ${connection.name}`}
                        onClick={() => setRemoveTarget(connection)}>
                        <IconTrash size={17} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>

                <Group gap={7} mt="md">
                  <Badge size="sm" variant="light" color="blue"
                    leftSection={connection.authenticationType === 'private-key'
                      ? <IconKey size={11} />
                      : <IconKey size={11} />}>
                    {authenticationLabel[connection.authenticationType]}
                  </Badge>
                  <Badge
                    size="sm"
                    variant="outline"
                    color={connection.hostFingerprint ? 'teal' : 'yellow'}
                    leftSection={<IconFingerprint size={11} />}
                  >
                    {connection.hostFingerprint ? 'Host verified' : 'Fingerprint pending'}
                  </Badge>
                </Group>

                <div className="ssh-card-meta">
                  <Text size="xs" c="dimmed" truncate>
                    {connection.hostFingerprint ?? 'Test once to verify the server identity'}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {connection.lastConnectedAt
                      ? `Last connected ${new Date(connection.lastConnectedAt).toLocaleString()}`
                      : 'Not connected yet'}
                  </Text>
                </div>

                {result && (
                  <Alert mt="sm" color={result.color} variant="light"
                    icon={result.color === 'teal'
                      ? <IconCheck size={15} />
                      : <IconAlertCircle size={15} />}>
                    <Text size="xs">{result.message}</Text>
                  </Alert>
                )}
              </Paper>
            )
          })}
        </div>
      )}

      <Modal
        opened={editorOpen}
        onClose={() => !saving && setEditorOpen(false)}
        title={draft.id ? 'Edit SSH connection' : 'Add SSH connection'}
        centered
        size="lg"
        closeOnClickOutside={!saving}
      >
        <Stack gap="md">
          <div className="ssh-form-grid">
            <TextInput label="Connection name" placeholder="Production server" required
              value={draft.name}
              onChange={(event) => updateDraft('name', event.currentTarget.value)} />
            <TextInput label="Host" placeholder="server.example.com" required
              value={draft.host}
              onChange={(event) => updateDraft('host', event.currentTarget.value)} />
            <TextInput label="Username" placeholder="deploy" required
              value={draft.username}
              onChange={(event) => updateDraft('username', event.currentTarget.value)} />
            <NumberInput label="Port" min={1} max={65535} required
              value={draft.port}
              onChange={(value) => setDraft((current) => ({ ...current, port: value }))} />
          </div>

          <Select
            label="Authentication"
            allowDeselect={false}
            value={draft.authenticationType}
            data={[
              { value: 'password', label: 'Username + password' },
              { value: 'private-key', label: 'Username + private key' },
              { value: 'agent', label: 'SSH agent' },
            ]}
            onChange={(value) => setDraft((current) => ({
              ...current,
              authenticationType: (value ?? 'password') as SshAuthenticationType,
            }))}
          />

          {draft.authenticationType === 'password' && (
            <PasswordInput
              label="Password"
              required={!draft.hasPassword}
              placeholder={draft.hasPassword ? 'Stored securely - leave blank to keep' : 'SSH password'}
              value={draft.password}
              onChange={(event) => updateDraft('password', event.currentTarget.value)}
            />
          )}

          {draft.authenticationType === 'private-key' && (
            <>
              <TextInput
                label="Private key file"
                required
                placeholder="C:\Users\you\.ssh\id_ed25519"
                value={draft.privateKeyPath}
                onChange={(event) => updateDraft('privateKeyPath', event.currentTarget.value)}
                rightSection={
                  <Tooltip label="Choose key file">
                    <ActionIcon variant="subtle" color="gray" aria-label="Choose private key"
                      onClick={() => void choosePrivateKey()}>
                      <IconKey size={17} />
                    </ActionIcon>
                  </Tooltip>
                }
              />
              <PasswordInput
                label="Key passphrase"
                description="Optional for unencrypted private keys"
                placeholder={draft.hasPassphrase ? 'Stored securely - leave blank to keep' : 'Optional passphrase'}
                value={draft.passphrase}
                onChange={(event) => updateDraft('passphrase', event.currentTarget.value)}
              />
            </>
          )}

          {draft.authenticationType === 'agent' && (
            <TextInput
              label="Agent socket"
              description="Leave blank to use SSH_AUTH_SOCK or the Windows OpenSSH agent"
              placeholder="Automatic"
              value={draft.agentSocket}
              onChange={(event) => updateDraft('agentSocket', event.currentTarget.value)}
            />
          )}

          <Alert color={vault?.available ? 'teal' : 'yellow'} variant="light"
            icon={<IconShieldCheck size={17} />}>
            <Text size="xs">
              {vault?.available
                ? `Secrets are encrypted by ${vault.label}. Private-key contents remain in their original file.`
                : 'Password and passphrase profiles require an available OS credential backend.'}
            </Text>
          </Alert>

          <Group justify="flex-end">
            <Button variant="subtle" color="gray" disabled={saving}
              onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} leftSection={<IconLock size={16} />} onClick={() => void save()}>
              Save securely
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(pendingTrust)}
        onClose={() => !testingId && setPendingTrust(null)}
        title="Verify server identity"
        centered
        size="md"
      >
        {pendingTrust && (
          <Stack gap="md">
            <Text size="sm">
              Confirm this fingerprint against a trusted source for{' '}
              <strong>{pendingTrust.connection.host}</strong> before continuing.
            </Text>
            <Paper className="ssh-fingerprint" radius="md">
              <IconFingerprint size={19} />
              <code>{pendingTrust.result.fingerprint}</code>
            </Paper>
            <Alert color="yellow" icon={<IconAlertCircle size={17} />}>
              The password or private key will not be used until you explicitly trust this host key.
            </Alert>
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" disabled={Boolean(testingId)}
                onClick={() => setPendingTrust(null)}>
                Cancel
              </Button>
              <Button loading={testingId === pendingTrust.connection.id}
                leftSection={<IconShieldCheck size={16} />}
                onClick={() => void testConnection(pendingTrust.connection, true)}>
                Trust and test
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title="Delete SSH connection?"
        centered
        size="sm"
      >
        <Stack>
          <Text size="sm">
            Remove <strong>{removeTarget?.name}</strong> and its encrypted credentials from MyRepos?
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button color="red" leftSection={<IconTrash size={16} />} onClick={() => void remove()}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
