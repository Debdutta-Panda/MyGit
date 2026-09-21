import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon, Alert, Badge, Button, Checkbox, CopyButton, Group, Loader, Modal, NumberInput,
  Select, Stack, Switch, Text, TextInput, Textarea, Tooltip,
} from '@mantine/core'
import {
  IconAlertCircle, IconCertificate, IconCircleCheck, IconClockShield, IconCopy,
  IconRefresh, IconShieldCheck, IconTrash,
} from '@tabler/icons-react'
import type {
  SshApacheSslAction, SshApacheSslCertificate, SshApacheSslOverview,
  SshApacheSslSite, SshConnection,
} from '../../shared/desktop-api'

const errorMessage = (reason: unknown): string => reason instanceof Error
  ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(reason)
const domainList = (value: string): string[] => value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
const certificateColor = (status: SshApacheSslCertificate['status']): string =>
  status === 'valid' ? 'teal' : status === 'expiring' ? 'yellow' : 'red'
const sslErrorSummary = (value: string): string => {
  if (/unable to find a virtual host listening on port 80/i.test(value)) {
    return "Apache has no enabled HTTP virtual host for Let's Encrypt validation."
  }
  if (/could not bind (?:tcp )?port 80/i.test(value)) {
    return 'This certificate uses standalone renewal, but Apache is already using port 80.'
  }
  const line = value.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? value
  return line.length > 220 ? `${line.slice(0, 217)}...` : line
}

export function ApacheSslManager({ connection }: { connection: SshConnection }) {
  const [overview, setOverview] = useState<SshApacheSslOverview | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorDetailsOpened, setErrorDetailsOpened] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'issue' | 'self-signed' | 'import' | 'revoke' | null>(null)
  const [certificateToRevoke, setCertificateToRevoke] = useState<SshApacheSslCertificate | null>(null)
  const [domains, setDomains] = useState('')
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState<'apache' | 'webroot'>('apache')
  const [webroot, setWebroot] = useState('')
  const [redirect, setRedirect] = useState(true)
  const [staging, setStaging] = useState(false)
  const [days, setDays] = useState<number | string>(365)
  const [certificatePem, setCertificatePem] = useState('')
  const [privateKeyPem, setPrivateKeyPem] = useState('')
  const [chainPem, setChainPem] = useState('')
  const [deleteRevoked, setDeleteRevoked] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!window.desktop) return
    setLoading(true); setError(null)
    try {
      const next = await window.desktop.ssh.apacheSslOverview(connection.id)
      setOverview(next)
      setSelectedPath((current) => current && next.sites.some((site) => site.path === current)
        ? current : next.sites[0]?.path ?? null)
    } catch (reason) {
      setError(errorMessage(reason))
      setErrorDetailsOpened(true)
    }
    finally { setLoading(false) }
  }, [connection.id])

  useEffect(() => { setOverview(null); setSelectedPath(null); void load() }, [load])

  const selectedSite = useMemo(() => overview?.sites.find((site) => site.path === selectedPath) ?? null,
    [overview, selectedPath])
  const selectedCertificate = useMemo(() => selectedSite?.certificatePath
    ? overview?.certificates.find((certificate) => certificate.certificatePath === selectedSite.certificatePath) ?? null
    : null, [overview, selectedSite])
  const selectedHttpDomains = selectedSite?.serverNames.length
    ? selectedSite.serverNames
    : selectedCertificate?.domains ?? []
  const hasHttpValidationHost = overview?.sites.some((site) => site.enabled && site.httpEnabled) ?? false
  const selectedHttpReady = Boolean(selectedSite?.enabled && selectedSite.httpEnabled)

  const run = async (key: string, request: SshApacheSslAction): Promise<void> => {
    if (!window.desktop) return
    setAction(key); setError(null); setResult(null)
    try {
      const response = await window.desktop.ssh.apacheSslAction(connection.id, request)
      setOverview(response.overview); setResult(response.output); setDialog(null)
    } catch (reason) {
      setError(errorMessage(reason))
      setErrorDetailsOpened(true)
    }
    finally { setAction(null) }
  }

  const prepareDialog = (kind: 'issue' | 'self-signed' | 'import'): void => {
    if (!selectedSite) return
    const initialDomains = selectedSite.serverNames.join(', ')
    setDomains(initialDomains); setWebroot(selectedSite.documentRoot ?? ''); setDialog(kind)
  }

  if (loading && !overview) return <div className="apache-ssl-loading"><Loader size="sm" /><Text size="sm">Detecting certificates and renewal automation…</Text></div>

  return <div className="apache-ssl-manager">
    <header className="apache-ssl-toolbar">
      <div><Group gap={7}><IconShieldCheck size={18} /><Text fw={750}>SSL management</Text></Group>
        <Text size="xs" c="dimmed">Certificates, HTTPS activation, renewal and diagnostics for Apache sites.</Text></div>
      <Group gap={6} wrap="nowrap">
        {overview && (!overview.certbotInstalled || !overview.apachePluginInstalled) && <Button size="compact-xs" color="teal" loading={action === 'install'}
          disabled={!overview.canManage} onClick={() => void run('install', { kind: 'install-certbot', confirmation: 'install-certbot' })}>
          {overview.certbotInstalled ? 'Install Apache plugin' : 'Install Certbot'}
        </Button>}
        <Tooltip label="Detect SSL state again"><ActionIcon variant="subtle" color="gray" loading={loading} onClick={() => void load()}><IconRefresh size={16} /></ActionIcon></Tooltip>
      </Group>
    </header>

    {error && <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Text size="sm" fw={650} lineClamp={2}>{sslErrorSummary(error)}</Text>
        <Button size="compact-xs" variant="light" color="red" onClick={() => setErrorDetailsOpened(true)}>
          View full error
        </Button>
      </Group>
    </Alert>}
    {result && <Alert color="teal" icon={<IconCircleCheck size={16} />} withCloseButton onClose={() => setResult(null)}><pre className="ssh-web-output">{result}</pre></Alert>}

    <div className="apache-ssl-health">
      <article data-ok={overview?.certbotInstalled && overview?.apachePluginInstalled || undefined}><IconCertificate size={18} /><span><small>Certbot</small><strong>{overview?.certbotInstalled ? overview.certbotVersion : 'Not installed'}</strong><em>{overview?.certbotInstalled ? overview.apachePluginInstalled ? 'Apache plugin ready' : 'Apache plugin missing' : "Required for Let's Encrypt"}</em></span></article>
      <article data-ok={overview?.renewalEnabled && overview?.renewalActive && hasHttpValidationHost || undefined}><IconClockShield size={18} /><span><small>Automatic renewal</small><strong>{overview?.renewalTimer ? overview.renewalEnabled && overview.renewalActive ? hasHttpValidationHost ? 'Active' : 'Needs HTTP setup' : 'Inactive' : 'Not detected'}</strong><em>{overview?.nextRenewalAt || 'No next run available'}</em></span></article>
      <article data-ok={overview?.opensslInstalled || undefined}><IconShieldCheck size={18} /><span><small>Inventory</small><strong>{overview?.certificates.length ?? 0} certificates</strong><em>{overview?.sites.filter((site) => site.httpsEnabled).length ?? 0} HTTPS sites</em></span></article>
      <section className="apache-ssl-renew-controls">
        <Switch size="sm" label="Automatic renewal" checked={overview?.renewalEnabled === true}
          disabled={!overview?.certbotInstalled || !overview?.apachePluginInstalled || !overview?.canManage || Boolean(action) || (!hasHttpValidationHost && overview?.renewalEnabled !== true)}
          onChange={(event) => void run('auto-renew', { kind: 'set-auto-renew', enabled: event.currentTarget.checked, confirmation: 'auto-renew' })} />
        {hasHttpValidationHost ? <>
          <Button size="compact-xs" variant="subtle" color="gray" loading={action === 'dry-run'} disabled={!overview?.certbotInstalled || !overview?.apachePluginInstalled}
            onClick={() => void run('dry-run', { kind: 'test-renewal' })}>Test renewal</Button>
          <Button size="compact-xs" variant="light" color="teal" loading={action === 'renew-all'} disabled={!overview?.certbotInstalled || !overview?.apachePluginInstalled || !overview?.canManage}
            onClick={() => void run('renew-all', { kind: 'renew', force: false, confirmation: 'renew' })}>Renew due certificates</Button>
        </> : <Badge size="sm" color="yellow" variant="light">Complete HTTP setup below</Badge>}
      </section>
    </div>

    <div className="apache-ssl-site-layout">
      <aside className="apache-ssl-sites">
        <header><Text size="xs" fw={800}>SITES</Text><Badge size="xs" variant="outline">{overview?.sites.length ?? 0}</Badge></header>
        <div className="apache-ssl-site-list">
          {overview?.sites.map((site) => <button type="button" key={site.path} data-active={site.path === selectedPath || undefined} onClick={() => setSelectedPath(site.path)}>
            <span><strong>{site.serverNames[0] || site.name}</strong><small>{site.path}</small></span>
            <Group gap={4} wrap="nowrap">
              {site.httpEnabled && <Badge size="xs" color={site.enabled ? 'blue' : 'gray'}>{site.enabled ? 'HTTP' : 'HTTP off'}</Badge>}
              {site.httpsEnabled && <Badge size="xs" color="teal">HTTPS</Badge>}
            </Group>
          </button>)}
          {overview?.sites.length === 0 && <Text size="xs" c="dimmed" p="sm">No Apache site files were detected.</Text>}
        </div>
      </aside>

      <main className="apache-ssl-site-detail">
        {!selectedSite ? <div className="ssh-web-empty"><Text size="sm">Select a site</Text></div> : <>
          <header><div><Group gap={7}><Text fw={750}>{selectedSite.serverNames[0] || selectedSite.name}</Text>{selectedSite.httpsEnabled && <Badge size="xs" color="teal">HTTPS</Badge>}{selectedHttpReady && <Badge size="xs" color="blue">HTTP validation ready</Badge>}{selectedSite.redirectsToHttps && <Badge size="xs" color="blue">Redirects to HTTPS</Badge>}</Group><Text size="xs" c="dimmed">{selectedSite.path}</Text></div>
            <Group gap={6}>
              <Button size="compact-xs" variant="light" disabled={!overview?.canManage || !selectedHttpReady} onClick={() => prepareDialog('issue')}>Issue certificate</Button><Button size="compact-xs" variant="subtle" color="gray" disabled={!overview?.opensslInstalled || !overview?.canManage} onClick={() => prepareDialog('self-signed')}>Self-signed</Button><Button size="compact-xs" variant="subtle" color="gray" disabled={!overview?.canManage} onClick={() => prepareDialog('import')}>Import PEM</Button>
            </Group></header>
          {!selectedHttpReady && <section className="apache-ssl-setup-step">
            <Badge size="sm" color="blue" variant="filled">REQUIRED</Badge>
            <div>
              <Text size="sm" fw={750}>Enable HTTP validation for this site</Text>
              <Text size="xs" c="dimmed">Let&apos;s Encrypt needs an enabled port 80 virtual host. MyRepos will back up this file, add the host, validate Apache, reload it, and roll back on failure.</Text>
            </div>
            <Button size="compact-sm" color="blue" loading={action === 'enable-http-site'} disabled={!overview?.canManage || !selectedSite.documentRoot || selectedHttpDomains.length === 0} onClick={() => selectedSite.documentRoot && void run('enable-http-site', { kind: 'enable-http-site', sitePath: selectedSite.path, domains: selectedHttpDomains, documentRoot: selectedSite.documentRoot, confirmation: 'http-site' })}>
              {selectedSite.httpEnabled ? 'Enable this site' : 'Enable HTTP validation'}
            </Button>
          </section>}
          <div className="apache-ssl-site-facts">
            <section><small>Domains</small><strong>{selectedSite.serverNames.join(', ') || 'Not declared'}</strong></section>
            <section><small>Document root</small><code>{selectedSite.documentRoot || 'Not declared'}</code></section>
            <section><small>Certificate</small><code>{selectedSite.certificatePath || 'Not configured'}</code></section>
            <section><small>Private key</small><code>{selectedSite.privateKeyPath || 'Not configured'}</code></section>
          </div>
          {selectedCertificate ? <div className="apache-ssl-certificate-card">
            <Group justify="space-between" align="flex-start"><div><Group gap={7}><IconCertificate size={18} /><Text fw={720}>{selectedCertificate.name}</Text><Badge size="xs" color={certificateColor(selectedCertificate.status)}>{selectedCertificate.status}</Badge><Badge size="xs" variant="outline">{selectedCertificate.managedBy}</Badge></Group><Text size="xs" c="dimmed" mt={4}>{selectedCertificate.domains.join(', ') || 'No SAN domains reported'}</Text></div><Group gap={6}><Button size="compact-xs" variant="light" loading={action === `renew:${selectedCertificate.name}`} disabled={selectedCertificate.managedBy !== 'certbot' || !overview.apachePluginInstalled || !selectedSite.httpEnabled || !selectedSite.enabled || !overview.canManage} onClick={() => void run(`renew:${selectedCertificate.name}`, { kind: 'renew', certificateName: selectedCertificate.name, force: true, confirmation: 'renew' })}>Renew now</Button><Tooltip label="Revoke certificate"><ActionIcon color="red" variant="subtle" disabled={selectedCertificate.managedBy !== 'certbot' || !overview.canManage} onClick={() => { setCertificateToRevoke(selectedCertificate); setDialog('revoke') }}><IconTrash size={16} /></ActionIcon></Tooltip></Group></Group>
            <div className="apache-ssl-certificate-meta"><span><small>Expires</small><strong>{selectedCertificate.expiresAt || 'Unknown'}</strong></span><span><small>Remaining</small><strong>{selectedCertificate.daysRemaining === null ? 'Unknown' : `${selectedCertificate.daysRemaining} days`}</strong></span><span><small>Issuer</small><strong>{selectedCertificate.issuer || 'Unknown'}</strong></span><span><small>Serial</small><code>{selectedCertificate.serialNumber || 'Unknown'}</code></span></div>
          </div> : <div className="apache-ssl-certificate-empty"><IconCertificate size={18} /><span><strong>No readable certificate linked</strong><small>Issue a new certificate, import PEM material, or verify the configured certificate path and permissions.</small></span></div>}
        </>}
      </main>
    </div>

    {overview?.renewalLog && <details className="apache-ssl-renew-log"><summary>Recent renewal activity</summary><pre>{overview.renewalLog}</pre></details>}

    <Modal opened={dialog === 'issue'} onClose={() => setDialog(null)} title="Issue Let’s Encrypt certificate" size="lg" centered>
      <Stack gap="sm"><Alert color="blue">DNS must already point to this server. Apache configuration is tested before and after Certbot runs.</Alert><TextInput label="Domains" description="Comma or space separated" value={domains} onChange={(event) => setDomains(event.currentTarget.value)} autoFocus /><TextInput label="Renewal email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} /><Select label="Challenge" value={challenge} onChange={(value) => setChallenge(value === 'webroot' ? 'webroot' : 'apache')} data={[{ value: 'apache', label: 'Apache plugin (configure HTTPS)' }, { value: 'webroot', label: 'Webroot (certificate only)' }]} />{challenge === 'webroot' && <TextInput label="Webroot" value={webroot} onChange={(event) => setWebroot(event.currentTarget.value)} />}<Checkbox label="Redirect HTTP to HTTPS" checked={redirect} onChange={(event) => setRedirect(event.currentTarget.checked)} /><Checkbox label="Use Let’s Encrypt staging environment" checked={staging} onChange={(event) => setStaging(event.currentTarget.checked)} /><Group justify="flex-end"><Button variant="subtle" color="gray" onClick={() => setDialog(null)}>Cancel</Button><Button loading={action === 'issue'} onClick={() => selectedSite && void run('issue', { kind: 'issue', sitePath: selectedSite.path, domains: domainList(domains), email, challenge, webroot, redirect, staging, confirmation: 'issue' })}>Issue and validate</Button></Group></Stack>
    </Modal>

    <Modal opened={dialog === 'self-signed'} onClose={() => setDialog(null)} title="Generate self-signed certificate" size="lg" centered>
      <Stack gap="sm"><Alert color="yellow">Browsers will not trust a self-signed certificate. Use it for internal or development services.</Alert><TextInput label="Domains" value={domains} onChange={(event) => setDomains(event.currentTarget.value)} autoFocus /><NumberInput label="Validity in days" value={days} min={1} max={3650} onChange={setDays} /><Group justify="flex-end"><Button variant="subtle" color="gray" onClick={() => setDialog(null)}>Cancel</Button><Button loading={action === 'self-signed'} onClick={() => selectedSite && void run('self-signed', { kind: 'self-signed', sitePath: selectedSite.path, commonName: domainList(domains)[0] ?? '', domains: domainList(domains), documentRoot: selectedSite.documentRoot ?? '', days: Number(days), confirmation: 'self-signed' })}>Generate and configure</Button></Group></Stack>
    </Modal>

    <Modal opened={dialog === 'import'} onClose={() => setDialog(null)} title="Import PEM certificate" size="90%" centered>
      <Stack gap="sm"><Alert color="yellow">The private key is transmitted only for this operation, written with mode 0600, and never saved by MyRepos.</Alert><TextInput label="Primary domain" value={domains} onChange={(event) => setDomains(event.currentTarget.value)} autoFocus /><div className="apache-ssl-pem-grid"><Textarea label="Certificate" minRows={12} value={certificatePem} onChange={(event) => setCertificatePem(event.currentTarget.value)} /><Textarea label="Private key" minRows={12} value={privateKeyPem} onChange={(event) => setPrivateKeyPem(event.currentTarget.value)} /><Textarea label="Chain (optional)" minRows={12} value={chainPem} onChange={(event) => setChainPem(event.currentTarget.value)} /></div><Group justify="flex-end"><Button variant="subtle" color="gray" onClick={() => setDialog(null)}>Cancel</Button><Button loading={action === 'import'} onClick={() => selectedSite && void run('import', { kind: 'import', sitePath: selectedSite.path, commonName: domainList(domains)[0] ?? '', documentRoot: selectedSite.documentRoot ?? '', certificate: certificatePem, privateKey: privateKeyPem, chain: chainPem, confirmation: 'import' })}>Verify, import and configure</Button></Group></Stack>
    </Modal>

    <Modal opened={dialog === 'revoke'} onClose={() => setDialog(null)} title="Revoke certificate" size="sm" centered>
      <Stack gap="sm"><Alert color="red">Revocation cannot be undone. Existing clients will reject this certificate.</Alert><Text size="sm">Revoke <strong>{certificateToRevoke?.name}</strong>?</Text><Checkbox label="Also delete Certbot’s local certificate files" checked={deleteRevoked} onChange={(event) => setDeleteRevoked(event.currentTarget.checked)} /><Group justify="flex-end"><Button variant="subtle" color="gray" onClick={() => setDialog(null)}>Cancel</Button><Button color="red" loading={action === 'revoke'} onClick={() => certificateToRevoke && void run('revoke', { kind: 'revoke', certificateName: certificateToRevoke.name, deleteCertificate: deleteRevoked, confirmation: 'revoke' })}>Revoke certificate</Button></Group></Stack>
    </Modal>

    <Modal
      opened={errorDetailsOpened && Boolean(error)}
      onClose={() => setErrorDetailsOpened(false)}
      title="SSL operation failed"
      size="80%"
      centered
    >
      <Stack gap="sm">
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error ? sslErrorSummary(error) : 'The SSL operation failed.'}
        </Alert>
        <pre className="apache-ssl-error-modal-output">{error}</pre>
        <Group justify="flex-end">
          <CopyButton value={error ?? ''}>
            {({ copied, copy }) => <Button variant="light" color={copied ? 'teal' : 'gray'} leftSection={<IconCopy size={15} />} onClick={copy}>
              {copied ? 'Copied' : 'Copy error'}
            </Button>}
          </CopyButton>
          <Button onClick={() => setErrorDetailsOpened(false)}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  </div>
}
