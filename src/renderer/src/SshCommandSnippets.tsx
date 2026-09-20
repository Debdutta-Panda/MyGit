import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button, Group, Modal, Select, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { IconCheck, IconCode, IconCopy, IconEdit, IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react'
import type { SshConnection } from '../../shared/desktop-api'
import { commandSnippetVariables, type CommandSnippetTag, type CommandSnippetVariable } from './CommandSnippetTemplate'
import { SshSnippetRunner } from './SshSnippetRunner'
import { loadSshCommandTemplates, readSshSnippets, writeSshSnippets, type SshSavedSnippet } from './ssh-snippets-store'

export function SshCommandSnippets({ connection, onOpenTerminal }: {
  connection: SshConnection
  onOpenTerminal: (command: string) => void
}) {
  const [snippets, setSnippets] = useState<SshSavedSnippet[]>(() => readSshSnippets(connection.id))
  const [editorOpened, setEditorOpened] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftTemplate, setDraftTemplate] = useState('')
  const [draftVariableTypes, setDraftVariableTypes] = useState<Record<string, CommandSnippetTag>>({})
  const [draftError, setDraftError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [runnerSnippet, setRunnerSnippet] = useState<SshSavedSnippet | null>(null)
  const skipWriteRef = useRef(false)

  useEffect(() => {
    skipWriteRef.current = true
    let cancelled = false
    void loadSshCommandTemplates(connection.id, 'snippets').then((items) => {
      if (!cancelled) setSnippets(items)
    })
    return () => { cancelled = true }
  }, [connection.id])
  useEffect(() => {
    if (skipWriteRef.current) {
      skipWriteRef.current = false
      return
    }
    writeSshSnippets(connection.id, snippets)
  }, [connection.id, snippets])

  const sorted = useMemo(
    () => [...snippets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [snippets],
  )
  const draftVariables = useMemo<CommandSnippetVariable[]>(() => {
    try {
      return commandSnippetVariables(draftTemplate, draftVariableTypes)
    } catch {
      return []
    }
  }, [draftTemplate, draftVariableTypes])
  const openNew = (): void => {
    setEditingId(null)
    setDraftName('')
    setDraftTemplate('')
    setDraftVariableTypes({})
    setDraftError(null)
    setEditorOpened(true)
  }
  const openEdit = (snippet: SshSavedSnippet): void => {
    setEditingId(snippet.id)
    setDraftName(snippet.name)
    setDraftTemplate(snippet.template)
    setDraftVariableTypes(snippet.variableTypes ?? {})
    setDraftError(null)
    setEditorOpened(true)
  }
  const saveSnippet = (): void => {
    const name = draftName.trim()
    const template = draftTemplate.trim()
    if (!name) {
      setDraftError('Give the snippet a name.')
      return
    }
    if (!template) {
      setDraftError('Enter a command template.')
      return
    }
    let variableTypes: Record<string, CommandSnippetTag>
    try {
      variableTypes = Object.fromEntries(commandSnippetVariables(template, draftVariableTypes)
        .map((variable) => [variable.name, variable.tag]))
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : String(reason))
      return
    }
    const updatedAt = new Date().toISOString()
    if (editingId) {
      setSnippets((current) => current.map((snippet) =>
        snippet.id === editingId ? { ...snippet, name, template, variableTypes, updatedAt } : snippet))
    } else {
      setSnippets((current) => [{ id: crypto.randomUUID(), name, template, variableTypes, updatedAt }, ...current])
    }
    setEditorOpened(false)
  }
  const copyTemplate = (snippet: SshSavedSnippet): void => {
    void navigator.clipboard.writeText(snippet.template)
    setCopiedId(snippet.id)
    window.setTimeout(() => setCopiedId((current) => current === snippet.id ? null : current), 1_500)
  }

  return <section className="ssh-snippets">
    <header className="ssh-snippets-toolbar">
      <div>
        <Group gap={7}><IconCode size={17} /><Text fw={700} size="sm">Command snippets</Text>
          <Badge size="xs" variant="outline" color="gray">{snippets.length}</Badge></Group>
        <Text size="xs" c="dimmed">Reusable commands for {connection.name}</Text>
      </div>
      <Button size="compact-xs" leftSection={<IconPlus size={13} />} onClick={openNew}>New snippet</Button>
    </header>

    <div className="ssh-snippets-items">
      {sorted.map((snippet) => <article className="ssh-snippet-item" key={snippet.id}>
        <div className="ssh-snippet-item-main">
          <IconCode size={17} />
          <div><strong>{snippet.name}</strong><code>{snippet.template}</code></div>
        </div>
        <div className="ssh-snippet-item-actions">
          <Button size="compact-xs" leftSection={<IconPlayerPlay size={13} />}
            onClick={() => setRunnerSnippet(snippet)}>Run</Button>
          <Tooltip label={copiedId === snippet.id ? 'Copied' : 'Copy template'}>
            <ActionIcon size="sm" variant="subtle" color={copiedId === snippet.id ? 'teal' : 'gray'}
              onClick={() => copyTemplate(snippet)}>
              {copiedId === snippet.id ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Edit snippet">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => openEdit(snippet)}><IconEdit size={14} /></ActionIcon>
          </Tooltip>
          <Tooltip label="Delete snippet">
            <ActionIcon size="sm" variant="subtle" color="red"
              onClick={() => setSnippets((current) => current.filter((item) => item.id !== snippet.id))}>
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </div>
      </article>)}
      {!sorted.length && <div className="ssh-snippets-empty">
        <IconCode size={30} />
        <Text size="sm" fw={650}>No command snippets</Text>
        <Text size="xs" c="dimmed">Create a reusable command template for this server.</Text>
        <Button size="compact-xs" leftSection={<IconPlus size={13} />} onClick={openNew}>New snippet</Button>
      </div>}
    </div>

    <Modal opened={editorOpened} onClose={() => setEditorOpened(false)}
      title={editingId ? 'Edit command snippet' : 'New command snippet'} size="lg" centered>
      <div className="ssh-snippet-editor-modal">
        <TextInput autoFocus label="Name" placeholder="Example: Fix website ownership"
          value={draftName} onChange={(event) => { setDraftName(event.currentTarget.value); setDraftError(null) }} />
        <Textarea label="Command template" autosize minRows={6} maxRows={14}
          description="Use {{variable}} anywhere. Detected variables and their semantic types appear below."
          placeholder={"find {{target}} -type f -exec chmod {{permissions}} -- '{}' +"}
          classNames={{ input: 'ssh-snippets-template-input' }}
          value={draftTemplate} onChange={(event) => { setDraftTemplate(event.currentTarget.value); setDraftError(null) }} />
        {draftVariables.length > 0 && <section className="ssh-snippet-variable-schema">
          <header><Text size="xs" fw={700}>Detected variables</Text>
            <Text size="xs" c="dimmed">Type controls validation, suggestions, and automatic context values.</Text></header>
          <div>
            {draftVariables.map((variable) => <label key={variable.name}>
              <code>{`{{${variable.name}}}`}</code>
              <Select size="xs" value={variable.tag} disabled={variable.explicit} data={[
                { value: 'path', label: 'Path' },
                { value: 'user', label: 'User' },
                { value: 'group', label: 'Group' },
                { value: 'mode', label: 'Permission mode' },
                { value: 'text', label: 'Text' },
              ]} onChange={(value) => value && setDraftVariableTypes((current) => ({
                ...current, [variable.name]: value as CommandSnippetTag,
              }))} />
              <small>{variable.explicit ? 'Declared in template' : 'Saved with snippet'}</small>
            </label>)}
          </div>
        </section>}
        {draftError && <Text size="xs" c="red">{draftError}</Text>}
        <Group justify="flex-end" gap={6}>
          <Button size="compact-xs" variant="default" onClick={() => setEditorOpened(false)}>Cancel</Button>
          <Button size="compact-xs" onClick={saveSnippet}>{editingId ? 'Save changes' : 'Create snippet'}</Button>
        </Group>
      </div>
    </Modal>

    <SshSnippetRunner connection={connection} snippet={runnerSnippet}
      onClose={() => setRunnerSnippet(null)} onOpenTerminal={onOpenTerminal} />
  </section>
}
