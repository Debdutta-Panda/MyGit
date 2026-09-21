import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, Text, Tooltip } from '@mantine/core'
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCircleCheck,
  IconFileCode,
  IconFolder,
  IconPlayerPlay,
  IconRefresh,
  IconServer2,
} from '@tabler/icons-react'
import type {
  SshApacheConfigEntry,
  SshApacheConfigFile,
  SshApacheConfiguration,
  SshApacheOverview,
  SshConnection,
} from '../../shared/desktop-api'
import { ApacheConfigurationEditor } from './ApacheConfigurationEditor'
import { ApacheSslManager } from './ApacheSslManager'

type ApacheTab = 'overview' | 'configurations' | 'sites'

const messageFor = (reason: unknown): string =>
  reason instanceof Error
    ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(reason)
const shown = (value: string | null): string => value || 'Not detected'
const formatBytes = (value: number | null): string => value === null ? 'Unknown size'
  : value < 1024 ? `${value} B` : `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} KB`

export function SshWeb({ connection }: { connection: SshConnection }) {
  const [server, setServer] = useState<'apache' | null>(null)
  const [tab, setTab] = useState<ApacheTab>('overview')
  const [overview, setOverview] = useState<SshApacheOverview | null>(null)
  const [configuration, setConfiguration] = useState<SshApacheConfiguration | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [file, setFile] = useState<SshApacheConfigFile | null>(null)
  const [draft, setDraft] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [reloadOpen, setReloadOpen] = useState(false)
  const [sitesSection, setSitesSection] = useState<'sites' | 'ssl'>('sites')

  useEffect(() => {
    setServer(null)
    setTab('overview')
    setOverview(null)
    setConfiguration(null)
    setError(null)
    setResult(null)
    setFile(null)
    setSitesSection('sites')
  }, [connection.id])

  const load = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true)
    setError(null)
    try {
      const [nextOverview, nextConfiguration] = await Promise.all([
        window.desktop.ssh.apacheOverview(connection.id),
        window.desktop.ssh.apacheConfiguration(connection.id),
      ])
      setOverview(nextOverview)
      setConfiguration(nextConfiguration)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setLoading(false)
    }
  }, [connection.id])

  const openApache = (): void => {
    setServer('apache')
    if (!overview || !configuration) void load()
  }

  const runAction = async (
    key: string,
    request: Parameters<NonNullable<typeof window.desktop>['ssh']['apacheAction']>[1],
  ): Promise<void> => {
    if (!window.desktop) return
    setAction(key)
    setError(null)
    setResult(null)
    try {
      const response = await window.desktop.ssh.apacheAction(connection.id, request)
      setConfiguration(response.configuration)
      setResult(response.output)
      if (request.kind === 'reload') {
        setReloadOpen(false)
        setOverview(await window.desktop.ssh.apacheOverview(connection.id))
      }
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setAction(null)
    }
  }

  const openFile = async (entry: SshApacheConfigEntry): Promise<void> => {
    if (!window.desktop) return
    setEditorLoading(true)
    setEditorError(null)
    setSaveMessage(null)
    try {
      const opened = await window.desktop.ssh.apacheReadConfig(connection.id, entry.linkTarget ?? entry.path)
      setFile(opened)
      setDraft(opened.content)
    } catch (reason) {
      setEditorError(messageFor(reason))
    } finally {
      setEditorLoading(false)
    }
  }

  const saveFile = async (): Promise<void> => {
    if (!window.desktop || !file) return
    setAction('save')
    setEditorError(null)
    setSaveMessage(null)
    try {
      const saved = await window.desktop.ssh.apacheSaveConfig(connection.id, {
        path: file.path,
        content: draft,
        expectedEtag: file.etag,
      })
      setFile(saved.file)
      setDraft(saved.file.content)
      setSaveMessage(`Saved and validated. Backup: ${saved.backupPath}`)
      setResult(saved.validationOutput)
      setConfiguration(await window.desktop.ssh.apacheConfiguration(connection.id))
    } catch (reason) {
      setEditorError(messageFor(reason))
    } finally {
      setAction(null)
    }
  }

  const configurationEntries = useMemo(() => configuration?.entries.filter((entry) =>
    entry.kind === 'main' || entry.kind === 'configuration-available' || entry.kind === 'conf.d'
      || (entry.kind === 'configuration-enabled' && !configuration.entries.some((candidate) =>
        candidate.kind === 'configuration-available' && candidate.name === entry.name))) ?? [], [configuration])
  const siteEntries = useMemo(() => configuration?.entries.filter((entry) =>
    entry.kind === 'site-available' || (entry.kind === 'site-enabled' && !configuration.entries.some((candidate) =>
      candidate.kind === 'site-available' && candidate.name === entry.name))) ?? [], [configuration])

  const entryList = (entries: SshApacheConfigEntry[], empty: string) => entries.length === 0
    ? <div className="ssh-web-empty"><Text size="sm" fw={650}>{empty}</Text><Text size="xs" c="dimmed">No matching files were detected in this Apache layout.</Text></div>
    : <div className="ssh-web-file-list">{entries.map((entry) => {
      const target = entry.kind.startsWith('site-') ? 'site' : 'configuration'
      const controllable = entry.kind === 'site-available' || entry.kind === 'configuration-available'
      return <div className="ssh-web-file-row" key={`${entry.kind}:${entry.path}`}>
        <button type="button" className="ssh-web-file-open" onClick={() => void openFile(entry)}>
          <IconFileCode size={16} /><span><strong>{entry.name}</strong><small>{entry.path}</small></span>
        </button>
        <Group gap={7} wrap="nowrap">
          <Badge size="xs" variant="outline" color="gray">{entry.kind}</Badge>
          {controllable && <Badge size="xs" color={entry.enabled ? 'teal' : 'gray'}>{entry.enabled ? 'Enabled' : 'Available'}</Badge>}
          <Text size="xs" c="dimmed">{formatBytes(entry.size)}</Text>
          {controllable && <Button size="compact-xs" variant="light" color={entry.enabled ? 'yellow' : 'teal'}
            loading={action === `${entry.enabled ? 'disable' : 'enable'}:${target}:${entry.name}`}
            disabled={Boolean(action) || !configuration?.canManage}
            onClick={() => void runAction(`${entry.enabled ? 'disable' : 'enable'}:${target}:${entry.name}`, {
              kind: entry.enabled ? 'disable' : 'enable', target, name: entry.name,
            })}>{entry.enabled ? 'Disable' : 'Enable'}</Button>}
        </Group>
      </div>
    })}</div>

  if (!server) return <section className="ssh-web-picker">
    <header><div><Text fw={740} fz={16}>Web</Text><Text size="xs" c="dimmed">Choose a web server to inspect and manage on {connection.name}.</Text></div></header>
    <div className="ssh-web-server-list">
      <button type="button" onClick={openApache}><span className="ssh-web-server-icon"><IconServer2 size={24} /></span>
        <span><strong>Apache</strong><small>Sites, configuration files, validation and service reload</small></span>
        <Badge size="xs" variant="light" color="teal">Available</Badge></button>
      <Text size="xs" c="dimmed" px={3} py={8}>Additional web servers will be added after the Apache workflow.</Text>
    </div>
  </section>

  return <section className="ssh-web-workspace">
    <header className="ssh-web-header">
      <Group gap="xs" wrap="nowrap"><Tooltip label="Choose another web server"><ActionIcon variant="subtle" color="gray" onClick={() => setServer(null)}><IconArrowLeft size={17} /></ActionIcon></Tooltip>
        <div><Group gap={7}><Text fw={740}>Apache</Text>{overview && <Badge size="xs" color={overview.installed ? 'teal' : 'gray'}>{overview.installed ? overview.serviceState : 'Not installed'}</Badge>}</Group>
          <Text size="xs" c="dimmed">{configuration?.flavor ?? 'Detecting'} layout · {configuration?.canManage ? 'management available' : 'read only'}</Text></div></Group>
      <Group gap={6} wrap="nowrap">
        <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconPlayerPlay size={14} />} loading={action === 'test'} disabled={Boolean(action) || !overview?.installed} onClick={() => void runAction('test', { kind: 'test' })}>Test config</Button>
        <Button size="compact-xs" variant="light" color="orange" disabled={Boolean(action) || !overview?.installed || !configuration?.canManage} onClick={() => setReloadOpen(true)}>Reload Apache</Button>
        <Tooltip label="Refresh everything"><ActionIcon variant="subtle" color="gray" loading={loading} onClick={() => void load()}><IconRefresh size={17} /></ActionIcon></Tooltip>
      </Group>
    </header>

    <nav className="ssh-web-tabs">{([['overview', 'Overview'], ['configurations', 'Configurations'], ['sites', 'Sites']] as Array<[ApacheTab, string]>).map(([value, label]) =>
      <button type="button" key={value} data-active={tab === value || undefined} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {error && <Alert m="md" color="red" icon={<IconAlertCircle size={17} />} withCloseButton onClose={() => setError(null)}>{error}</Alert>}
    {result && <Alert mx="md" mt="md" color="teal" icon={<IconCircleCheck size={17} />} withCloseButton onClose={() => setResult(null)}><pre className="ssh-web-output">{result}</pre></Alert>}
    {loading && !overview ? <div className="ssh-web-loading"><Loader size="sm" /><Text size="sm">Detecting Apache…</Text></div>
      : overview && !overview.installed ? <div className="ssh-web-loading"><IconServer2 size={34} /><Text fw={650}>Apache was not detected</Text><Text size="xs" c="dimmed">No Apache executable was found.</Text></div>
      : overview && tab === 'overview' ? <div className="ssh-web-content">
        <div className="ssh-web-summary">
          <article><IconCircleCheck size={18} /><span><small>Service</small><strong>{shown(overview.serviceName)}</strong><em>{overview.serviceState}{overview.serviceEnabled === null ? '' : overview.serviceEnabled ? ' · enabled' : ' · disabled'}</em></span></article>
          <article><IconServer2 size={18} /><span><small>Apache</small><strong>{shown(overview.version)}</strong><em>{shown(overview.executable)}</em></span></article>
          <article><IconFileCode size={18} /><span><small>Configuration root</small><strong>{shown(configuration?.configDirectory ?? overview.configDirectory)}</strong><em>{configuration?.entries.length ?? overview.configFiles.length} files detected</em></span></article>
          <article><IconFolder size={18} /><span><small>Web paths</small><strong>{overview.documentRoots.length}</strong><em>candidate document roots</em></span></article>
        </div>
        <div className="ssh-web-path-grid">{Object.entries(configuration?.directories ?? {}).map(([name, path]) => path && <section key={name}><small>{name.replace(/([A-Z])/g, ' $1')}</small><code>{path}</code></section>)}</div>
      </div>
      : tab === 'configurations' ? entryList(configurationEntries, 'No configuration files')
      : tab === 'sites' ? <>
        <nav className="ssh-web-site-tabs">
          <button type="button" data-active={sitesSection === 'sites' || undefined} onClick={() => setSitesSection('sites')}>Site files</button>
          <button type="button" data-active={sitesSection === 'ssl' || undefined} onClick={() => setSitesSection('ssl')}>SSL & certificates</button>
        </nav>
        {sitesSection === 'sites'
          ? entryList(siteEntries, 'No virtual-host sites')
          : <ApacheSslManager connection={connection} />}
      </> : null}

    <Modal opened={editorLoading || Boolean(file) || Boolean(editorError)} onClose={() => { if (action !== 'save') { setFile(null); setEditorError(null) } }} title={file ? `Apache configuration · ${file.path}` : 'Apache configuration'} size="90%" centered closeOnClickOutside={action !== 'save'} closeOnEscape={action !== 'save'}>
      {editorLoading ? <div className="ssh-web-editor-loading"><Loader size="sm" /><Text size="sm">Opening configuration…</Text></div> : <>
        {editorError && <Alert mb="sm" color="red" icon={<IconAlertCircle size={17} />}>{editorError}</Alert>}
        {saveMessage && <Alert mb="sm" color="teal" icon={<IconCircleCheck size={17} />}>{saveMessage}</Alert>}
        {file && <ApacheConfigurationEditor original={file.content} value={draft} onChange={setDraft} />}
        <Group justify="space-between" mt="sm"><Text size="xs" c="dimmed">Saving creates a timestamped backup and must pass Apache syntax validation.</Text><Group gap="xs"><Button variant="subtle" color="gray" onClick={() => setFile(null)} disabled={action === 'save'}>Close</Button><Button color="teal" loading={action === 'save'} disabled={!file || draft === file.content || !configuration?.canManage} onClick={() => void saveFile()}>Save and validate</Button></Group></Group>
      </>}
    </Modal>

    <Modal opened={reloadOpen} onClose={() => setReloadOpen(false)} title="Reload Apache" centered size="sm">
      <Text size="sm">Apache configuration will be tested first. If valid, the running service will reload without a full restart.</Text>
      <Group justify="flex-end" mt="lg"><Button variant="subtle" color="gray" onClick={() => setReloadOpen(false)}>Cancel</Button><Button color="orange" loading={action === 'reload'} onClick={() => void runAction('reload', { kind: 'reload', confirmation: 'reload' })}>Test and reload</Button></Group>
    </Modal>
  </section>
}
