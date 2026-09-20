import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Group, Loader, Modal, Text } from '@mantine/core'
import { IconCopy, IconPlayerPlay, IconSquare, IconTerminal2 } from '@tabler/icons-react'
import type { SshAccountCatalog, SshCommandResult, SshConnection } from '../../shared/desktop-api'
import { CommandSnippetTemplate, commandSnippetVariableTags, hasCommandSnippetVariables, type CommandSnippetRenderResult } from './CommandSnippetTemplate'
import type { SshSavedSnippet } from './ssh-snippets-store'

const messageFor = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)
type RunState = 'prepare' | 'running' | 'success' | 'failed' | 'cancelled'

export function SshSnippetRunner({
  connection,
  snippet,
  contextValues = {},
  onClose,
  onOpenTerminal,
}: {
  connection: SshConnection
  snippet: SshSavedSnippet | null
  contextValues?: Partial<Record<'path' | 'user' | 'group' | 'mode' | 'text', string>>
  onClose: () => void
  onOpenTerminal: (command: string) => void
}) {
  const [catalog, setCatalog] = useState<SshAccountCatalog | null>(null)
  const [runState, setRunState] = useState<RunState>('prepare')
  const [prepared, setPrepared] = useState<CommandSnippetRenderResult>({ rendered: null, missing: [], error: null })
  const [runOutput, setRunOutput] = useState('')
  const [runError, setRunError] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<SshCommandResult | null>(null)
  const [executedCommand, setExecutedCommand] = useState('')
  const runIdRef = useRef<string | null>(null)
  const autoRunRef = useRef<string | null>(null)
  const outputRef = useRef<HTMLPreElement>(null)
  const contextTypes = Object.entries(contextValues).filter((entry): entry is [keyof typeof contextValues, string] => Boolean(entry[1]))
  const variableTags = snippet ? commandSnippetVariableTags(snippet.template, snippet.variableTypes) : []
  const unusedContext = contextTypes.length > 0 && !variableTags.some((tag) => Boolean(contextValues[tag]))

  useEffect(() => {
    setCatalog(null)
    if (!snippet || !hasCommandSnippetVariables(snippet.template)) return
    void window.desktop?.ssh.accountCatalog(connection.id).then(setCatalog).catch(() => undefined)
  }, [connection.id, snippet?.id, snippet?.updatedAt])
  useEffect(() => window.desktop?.ssh.onCommandOutput((event) => {
    if (event.id !== runIdRef.current) return
    setRunOutput((current) => current + event.data)
  }), [])
  useEffect(() => {
    if (runState === 'running') outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [runOutput, runState])

  const execute = async (command: string): Promise<void> => {
    if (!window.desktop || !snippet) return
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    setExecutedCommand(command)
    setRunOutput('')
    setRunError(null)
    setRunResult(null)
    setRunState('running')
    try {
      const completed = await window.desktop.ssh.runCommand(connection.id, runId, command)
      if (runIdRef.current !== runId) return
      setRunResult(completed)
      setRunState(completed.cancelled ? 'cancelled' : completed.exitCode === 0 ? 'success' : 'failed')
    } catch (reason) {
      if (runIdRef.current !== runId) return
      setRunError(messageFor(reason))
      setRunState('failed')
    }
  }

  useEffect(() => {
    if (!snippet) {
      autoRunRef.current = null
      return
    }
    setRunOutput('')
    setRunError(null)
    setRunResult(null)
    runIdRef.current = null
    if (hasCommandSnippetVariables(snippet.template) || unusedContext) {
      setPrepared({ rendered: null, missing: [], error: null })
      if (unusedContext) setPrepared({ rendered: snippet.template, missing: [], error: null })
      setRunState('prepare')
      autoRunRef.current = null
      return
    }
    const key = `${connection.id}:${snippet.id}:${snippet.updatedAt}`
    if (autoRunRef.current === key) return
    autoRunRef.current = key
    setPrepared({ rendered: snippet.template, missing: [], error: null })
    void execute(snippet.template)
  }, [connection.id, snippet?.id, snippet?.updatedAt])

  const cancelRun = async (): Promise<void> => {
    if (runIdRef.current) await window.desktop?.ssh.cancelCommand(runIdRef.current)
  }
  const close = (): void => {
    if (runState === 'running') return
    runIdRef.current = null
    onClose()
  }
  const color = runState === 'success' ? 'teal'
    : runState === 'failed' ? 'red'
      : runState === 'cancelled' ? 'gray' : 'blue'
  const label = runState === 'prepare' ? 'Ready'
    : runState === 'running' ? 'Running'
      : runState === 'success' ? 'Completed'
        : runState === 'failed' ? 'Failed' : 'Cancelled'

  return <Modal opened={Boolean(snippet)} onClose={close} title={<Group gap={7} wrap="nowrap">
    {runState === 'running' && <Loader size={15} />}
    <Text fw={700} size="sm">{snippet?.name || 'Run snippet'}</Text>
    <Badge size="xs" variant="light" color={color}>{label}</Badge>
  </Group>} size="lg" centered closeOnClickOutside={runState !== 'running'} closeOnEscape={runState !== 'running'}
    withCloseButton={runState !== 'running'} classNames={{ content: 'ssh-snippet-run-modal', body: 'ssh-snippet-run-body' }}>
    {runState === 'prepare' && snippet ? <>
      <CommandSnippetTemplate key={`${snippet.id}:${JSON.stringify(contextValues)}`} template={snippet.template}
        users={catalog?.users.map((user) => user.username) ?? []}
        groups={catalog?.groups.map((group) => group.name) ?? []}
        contextValues={contextValues}
        variableTypes={snippet.variableTypes}
        onResult={setPrepared} />
      {unusedContext && <div className="command-snippet-pending">
        This snippet does not consume the selected item. Add a typed variable such as <code>{'{{target:path}}'}</code> to the template.
      </div>}
      <footer className="ssh-snippet-run-footer">
        <Text size="xs" c="dimmed">Review the generated command before running it.</Text>
        <Group gap={6}>
          <Button size="compact-xs" variant="default" leftSection={<IconTerminal2 size={13} />}
            disabled={!prepared.rendered || unusedContext} onClick={() => {
              if (!prepared.rendered) return
              onOpenTerminal(prepared.rendered)
              close()
            }}>Open in Terminal</Button>
          <Button size="compact-xs" leftSection={<IconPlayerPlay size={13} />}
            disabled={!prepared.rendered || unusedContext} onClick={() => prepared.rendered && void execute(prepared.rendered)}>
            Run now
          </Button>
        </Group>
      </footer>
    </> : <>
      <div className="ssh-snippet-run-command"><span>$</span><code>{executedCommand}</code></div>
      <pre ref={outputRef} className="ssh-snippet-run-output" aria-live="polite">
        {runOutput || (runState === 'running' ? 'Connecting to server...' : runError || '(Command produced no output)')}
      </pre>
      {runError && runOutput && <Text size="xs" c="red">{runError}</Text>}
      <footer className="ssh-snippet-run-footer">
        <Text size="xs" c="dimmed">
          {runResult ? `Exit ${runResult.exitCode ?? '-'}${runResult.signal ? ` / ${runResult.signal}` : ''}`
            : runState === 'running' ? 'Output is streaming live.' : ''}
        </Text>
        <Group gap={6}>
          <Button size="compact-xs" variant="default" leftSection={<IconCopy size={13} />}
            disabled={!runOutput && !runError}
            onClick={() => void navigator.clipboard.writeText(runOutput || runError || '')}>Copy output</Button>
          {runState === 'running'
            ? <Button size="compact-xs" color="red" variant="light" leftSection={<IconSquare size={12} />}
                onClick={() => void cancelRun()}>Cancel</Button>
            : <Button size="compact-xs" onClick={close}>Close</Button>}
        </Group>
      </footer>
    </>}
  </Modal>
}
