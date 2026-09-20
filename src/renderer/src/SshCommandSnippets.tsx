import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button, Group, Loader, Modal, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { IconCheck, IconCode, IconCopy, IconPlayerPlay, IconPlus, IconSquare, IconTerminal2, IconTrash } from '@tabler/icons-react'
import type { SshAccountCatalog, SshCommandResult, SshConnection } from '../../shared/desktop-api'
import { CommandSnippetTemplate, type CommandSnippetRenderResult } from './CommandSnippetTemplate'

interface SavedSnippet {
  id: string
  name: string
  template: string
  updatedAt: string
}
const storageKey = (connectionId: string): string => `myrepos:ssh-snippets:${connectionId}`
const readSnippets = (connectionId: string): SavedSnippet[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(connectionId)) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is SavedSnippet =>
      Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item && 'template' in item)) : []
  } catch {
    return []
  }
}
const newSnippet = (): SavedSnippet => ({
  id: crypto.randomUUID(),
  name: 'New snippet',
  template: "find '{{path:path}}' -maxdepth 1 -print",
  updatedAt: new Date().toISOString(),
})
const messageFor = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)
type RunState = 'idle' | 'running' | 'success' | 'failed' | 'cancelled'

export function SshCommandSnippets({ connection, onOpenTerminal }: {
  connection: SshConnection
  onOpenTerminal: (command: string) => void
}) {
  const [snippets, setSnippets] = useState<SavedSnippet[]>(() => readSnippets(connection.id))
  const [selectedId, setSelectedId] = useState<string | null>(() => readSnippets(connection.id)[0]?.id ?? null)
  const [catalog, setCatalog] = useState<SshAccountCatalog | null>(null)
  const [result, setResult] = useState<CommandSnippetRenderResult>({ rendered: null, missing: [], error: null })
  const [copied, setCopied] = useState(false)
  const [runOpened, setRunOpened] = useState(false)
  const [runState, setRunState] = useState<RunState>('idle')
  const [runOutput, setRunOutput] = useState('')
  const [runError, setRunError] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<SshCommandResult | null>(null)
  const [executedCommand, setExecutedCommand] = useState('')
  const runIdRef = useRef<string | null>(null)
  const outputRef = useRef<HTMLPreElement>(null)
  const selected = snippets.find((snippet) => snippet.id === selectedId) ?? null

  useEffect(() => {
    const next = readSnippets(connection.id)
    setSnippets(next)
    setSelectedId(next[0]?.id ?? null)
    setCatalog(null)
    void window.desktop?.ssh.accountCatalog(connection.id).then(setCatalog).catch(() => undefined)
  }, [connection.id])
  useEffect(() => {
    localStorage.setItem(storageKey(connection.id), JSON.stringify(snippets))
  }, [connection.id, snippets])
  useEffect(() => window.desktop?.ssh.onCommandOutput((event) => {
    if (event.id !== runIdRef.current) return
    setRunOutput((current) => current + event.data)
  }), [])
  useEffect(() => {
    if (runState === 'running') outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [runOutput, runState])

  const updateSelected = (change: Partial<Pick<SavedSnippet, 'name' | 'template'>>): void => {
    if (!selectedId) return
    setSnippets((current) => current.map((snippet) => snippet.id === selectedId
      ? { ...snippet, ...change, updatedAt: new Date().toISOString() } : snippet))
  }
  const add = (): void => {
    const snippet = newSnippet()
    setSnippets((current) => [snippet, ...current])
    setSelectedId(snippet.id)
  }
  const remove = (): void => {
    if (!selectedId) return
    setSnippets((current) => {
      const next = current.filter((snippet) => snippet.id !== selectedId)
      setSelectedId(next[0]?.id ?? null)
      return next
    })
  }
  const sorted = useMemo(() => [...snippets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [snippets])
  const run = async (): Promise<void> => {
    if (!result.rendered || !window.desktop) return
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    setExecutedCommand(result.rendered)
    setRunOutput('')
    setRunError(null)
    setRunResult(null)
    setRunState('running')
    setRunOpened(true)
    try {
      const completed = await window.desktop.ssh.runCommand(connection.id, runId, result.rendered)
      if (runIdRef.current !== runId) return
      setRunResult(completed)
      setRunState(completed.cancelled ? 'cancelled' : completed.exitCode === 0 ? 'success' : 'failed')
    } catch (reason) {
      if (runIdRef.current !== runId) return
      setRunError(messageFor(reason))
      setRunState('failed')
    }
  }
  const cancelRun = async (): Promise<void> => {
    if (!runIdRef.current) return
    await window.desktop?.ssh.cancelCommand(runIdRef.current)
  }
  const closeRun = (): void => {
    if (runState === 'running') return
    setRunOpened(false)
    runIdRef.current = null
  }

  return <section className="ssh-snippets">
    <aside className="ssh-snippets-list">
      <header><div><IconCode size={16} /><strong>Command snippets</strong></div>
        <Tooltip label="New snippet"><ActionIcon size="sm" variant="light" onClick={add}><IconPlus size={14} /></ActionIcon></Tooltip></header>
      <div>
        {sorted.map((snippet) => <button type="button" key={snippet.id}
          data-active={selectedId === snippet.id || undefined} onClick={() => setSelectedId(snippet.id)}>
          <strong>{snippet.name || 'Untitled snippet'}</strong>
          <small>{snippet.template.split(/\r?\n/)[0] || 'Empty template'}</small>
        </button>)}
        {!sorted.length && <div className="ssh-snippets-empty"><IconCode size={24} /><span>No snippets yet</span>
          <Button size="compact-xs" leftSection={<IconPlus size={13} />} onClick={add}>Create snippet</Button></div>}
      </div>
    </aside>

    <div className="ssh-snippets-editor">
      {selected ? <>
        <header>
          <TextInput size="xs" value={selected.name} aria-label="Snippet name" placeholder="Snippet name"
            onChange={(event) => updateSelected({ name: event.currentTarget.value })} />
          <Group gap={5}>
            <Text size="xs" c="dimmed">Saved automatically</Text>
            <Tooltip label="Delete snippet"><ActionIcon size="sm" variant="subtle" color="red" onClick={remove}><IconTrash size={14} /></ActionIcon></Tooltip>
          </Group>
        </header>
        <Textarea autosize minRows={5} maxRows={14} value={selected.template}
          label="Template" description="Variables: {{name}}. Optional tags: {{name:path}}, user, group, mode, or text."
          classNames={{ input: 'ssh-snippets-template-input' }}
          onChange={(event) => updateSelected({ template: event.currentTarget.value })} />
        <CommandSnippetTemplate template={selected.template}
          users={catalog?.users.map((user) => user.username) ?? []}
          groups={catalog?.groups.map((group) => group.name) ?? []}
          onResult={setResult} />
        <footer>
          <Text size="xs" c="dimmed">Run here and see live output. Terminal is available for interactive work.</Text>
          <Group gap={6}>
            <Button size="compact-xs" variant="default" leftSection={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
              disabled={!result.rendered} onClick={() => {
                if (!result.rendered) return
                void navigator.clipboard.writeText(result.rendered)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1_500)
              }}>{copied ? 'Copied' : 'Copy command'}</Button>
            <Button size="compact-xs" variant="default" leftSection={<IconTerminal2 size={13} />} disabled={!result.rendered}
              onClick={() => result.rendered && onOpenTerminal(result.rendered)}>Open in Terminal</Button>
            <Button size="compact-xs" leftSection={<IconPlayerPlay size={13} />} disabled={!result.rendered}
              onClick={() => void run()}>Run</Button>
          </Group>
        </footer>
      </> : <div className="ssh-snippets-editor-empty"><IconCode size={32} /><Text size="sm">Create or select a snippet</Text></div>}
    </div>

    <Modal opened={runOpened} onClose={closeRun} title={<Group gap={7} wrap="nowrap">
      {runState === 'running' && <Loader size={15} />}
      <Text fw={700} size="sm">{selected?.name || 'Run snippet'}</Text>
      <Badge size="xs" variant="light" color={runState === 'success' ? 'teal' : runState === 'failed' ? 'red' : runState === 'cancelled' ? 'gray' : 'blue'}>
        {runState === 'running' ? 'Running' : runState === 'success' ? 'Completed' : runState === 'failed' ? 'Failed' : runState === 'cancelled' ? 'Cancelled' : 'Ready'}
      </Badge>
    </Group>} size="lg" centered closeOnClickOutside={runState !== 'running'} closeOnEscape={runState !== 'running'} withCloseButton={runState !== 'running'}
      classNames={{ content: 'ssh-snippet-run-modal', body: 'ssh-snippet-run-body' }}>
      <div className="ssh-snippet-run-command"><span>$</span><code>{executedCommand}</code></div>
      <pre ref={outputRef} className="ssh-snippet-run-output" aria-live="polite">
        {runOutput || (runState === 'running' ? 'Connecting to server…' : runError || '(Command produced no output)')}
      </pre>
      {runError && runOutput && <Text size="xs" c="red">{runError}</Text>}
      <footer className="ssh-snippet-run-footer">
        <Text size="xs" c="dimmed">
          {runResult ? `Exit ${runResult.exitCode ?? '—'}${runResult.signal ? ` · ${runResult.signal}` : ''}` : runState === 'running' ? 'Output is streaming live.' : ''}
        </Text>
        <Group gap={6}>
          <Button size="compact-xs" variant="default" leftSection={<IconCopy size={13} />} disabled={!runOutput && !runError}
            onClick={() => void navigator.clipboard.writeText(runOutput || runError || '')}>Copy output</Button>
          {runState === 'running'
            ? <Button size="compact-xs" color="red" variant="light" leftSection={<IconSquare size={12} />} onClick={() => void cancelRun()}>Cancel</Button>
            : <Button size="compact-xs" onClick={closeRun}>Close</Button>}
        </Group>
      </footer>
    </Modal>
  </section>
}
