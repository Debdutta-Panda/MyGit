import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Alert, Badge, Group, Loader, Text, Tooltip } from '@mantine/core'
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCircleCheck,
  IconFileCode,
  IconFolder,
  IconRefresh,
  IconServer2,
} from '@tabler/icons-react'
import type { SshApacheOverview, SshConnection } from '../../shared/desktop-api'

const messageFor = (reason: unknown): string =>
  reason instanceof Error
    ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(reason)

const shown = (value: string | null): string => value || 'Not detected'

export function SshWeb({ connection }: { connection: SshConnection }) {
  const [server, setServer] = useState<'apache' | null>(null)
  const [overview, setOverview] = useState<SshApacheOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setServer(null)
    setOverview(null)
    setError(null)
  }, [connection.id])

  const load = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true)
    setError(null)
    try {
      setOverview(await window.desktop.ssh.apacheOverview(connection.id))
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  const openApache = (): void => {
    setServer('apache')
    if (!overview) void load()
  }

  if (!server) {
    return <section className="ssh-web-picker">
      <header>
        <div>
          <Text fw={740} fz={16}>Web</Text>
          <Text size="xs" c="dimmed">Choose a web server to inspect and manage on {connection.name}.</Text>
        </div>
      </header>
      <div className="ssh-web-server-list">
        <button type="button" onClick={openApache}>
          <span className="ssh-web-server-icon"><IconServer2 size={24} /></span>
          <span><strong>Apache</strong><small>Detect the service, configuration and web roots</small></span>
          <Badge size="xs" variant="light" color="teal">Available</Badge>
        </button>
        <Text size="xs" c="dimmed" px={3} py={8}>Additional web servers will be added after the Apache workflow.</Text>
      </div>
    </section>
  }

  return <section className="ssh-web-workspace">
    <header className="ssh-web-header">
      <Group gap="xs" wrap="nowrap">
        <Tooltip label="Choose another web server">
          <ActionIcon variant="subtle" color="gray" onClick={() => setServer(null)} aria-label="Back to web servers">
            <IconArrowLeft size={17} />
          </ActionIcon>
        </Tooltip>
        <div>
          <Group gap={7}><Text fw={740}>Apache</Text>
            {overview && <Badge size="xs" color={overview.installed ? 'teal' : 'gray'}>
              {overview.installed ? overview.serviceState : 'Not installed'}
            </Badge>}
          </Group>
          <Text size="xs" c="dimmed">Read-only server overview</Text>
        </div>
      </Group>
      <Tooltip label="Refresh Apache detection">
        <ActionIcon variant="subtle" color="gray" loading={loading} onClick={() => void load()} aria-label="Refresh Apache overview">
          <IconRefresh size={17} />
        </ActionIcon>
      </Tooltip>
    </header>

    {error && <Alert m="md" color="red" icon={<IconAlertCircle size={17} />}>{error}</Alert>}
    {loading && !overview ? (
      <div className="ssh-web-loading"><Loader size="sm" /><Text size="sm">Detecting Apache…</Text></div>
    ) : overview && !overview.installed ? (
      <div className="ssh-web-loading"><IconServer2 size={34} /><Text fw={650}>Apache was not detected</Text>
        <Text size="xs" c="dimmed">No apache2, httpd, apachectl or apache2ctl executable was found.</Text></div>
    ) : overview ? (
      <div className="ssh-web-content">
        <div className="ssh-web-summary">
          <article><IconCircleCheck size={18} /><span><small>Service</small><strong>{shown(overview.serviceName)}</strong><em>{overview.serviceState}{overview.serviceEnabled === null ? '' : overview.serviceEnabled ? ' · enabled' : ' · disabled'}</em></span></article>
          <article><IconServer2 size={18} /><span><small>Apache</small><strong>{shown(overview.version)}</strong><em>{shown(overview.executable)}</em></span></article>
          <article><IconFileCode size={18} /><span><small>Configuration</small><strong>{shown(overview.configDirectory)}</strong><em>{overview.configFiles.length} main file{overview.configFiles.length === 1 ? '' : 's'} detected</em></span></article>
          <article><IconFolder size={18} /><span><small>Web paths</small><strong>{overview.documentRoots.length}</strong><em>candidate document root{overview.documentRoots.length === 1 ? '' : 's'}</em></span></article>
        </div>
        <div className="ssh-web-details">
          <section><Text size="xs" fw={700}>Configuration files</Text>
            {overview.configFiles.length ? overview.configFiles.map((path) => <code key={path}>{path}</code>) : <Text size="xs" c="dimmed">None detected.</Text>}
          </section>
          <section><Text size="xs" fw={700}>Web paths</Text>
            {overview.documentRoots.length ? overview.documentRoots.map((path) => <code key={path}>{path}</code>) : <Text size="xs" c="dimmed">None detected.</Text>}
          </section>
        </div>
      </div>
    ) : null}
  </section>
}
