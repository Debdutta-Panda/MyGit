import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button, Group, Modal, Select, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { IconCheck, IconCopy, IconEdit, IconPlayerPlay, IconPlus, IconScript, IconTrash } from '@tabler/icons-react'
import type { SshConnection } from '../../shared/desktop-api'
import { commandSnippetVariables, type CommandSnippetTag, type CommandSnippetVariable } from './CommandSnippetTemplate'
import { SshSnippetRunner } from './SshSnippetRunner'
import { loadSshCommandTemplates, readSshScripts, writeSshScripts, type SshSavedScript } from './ssh-snippets-store'

export function SshScripts({ connection, onOpenTerminal }: {
  connection: SshConnection
  onOpenTerminal: (command: string) => void
}) {
  const [scripts, setScripts] = useState<SshSavedScript[]>(() => readSshScripts(connection.id))
  const [editorOpened, setEditorOpened] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftTemplate, setDraftTemplate] = useState('')
  const [draftVariableTypes, setDraftVariableTypes] = useState<Record<string, CommandSnippetTag>>({})
  const [draftError, setDraftError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [runnerScript, setRunnerScript] = useState<SshSavedScript | null>(null)
  const skipWriteRef = useRef(false)

  useEffect(() => {
    skipWriteRef.current = true
    let cancelled = false
    void loadSshCommandTemplates(connection.id, 'scripts').then((items) => {
      if (!cancelled) setScripts(items)
    })
    return () => { cancelled = true }
  }, [connection.id])
  useEffect(() => {
    if (skipWriteRef.current) {
      skipWriteRef.current = false
      return
    }
    writeSshScripts(connection.id, scripts)
  }, [connection.id, scripts])

  const sorted = useMemo(
    () => [...scripts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [scripts],
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
  const openEdit = (script: SshSavedScript): void => {
    setEditingId(script.id)
    setDraftName(script.name)
    setDraftTemplate(script.template)
    setDraftVariableTypes(script.variableTypes ?? {})
    setDraftError(null)
    setEditorOpened(true)
  }
  const saveScript = (): void => {
    const name = draftName.trim()
    const template = draftTemplate.trim()
    if (!name) {
      setDraftError('Give the script a name.')
      return
    }
    if (!template) {
      setDraftError('Enter the script body.')
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
      setScripts((current) => current.map((script) =>
        script.id === editingId ? { ...script, name, template, variableTypes, updatedAt } : script))
    } else {
      setScripts((current) => [{ id: crypto.randomUUID(), name, template, variableTypes, updatedAt }, ...current])
    }
    setEditorOpened(false)
  }
  const copyScript = (script: SshSavedScript): void => {
    void navigator.clipboard.writeText(script.template)
    setCopiedId(script.id)
    window.setTimeout(() => setCopiedId((current) => current === script.id ? null : current), 1_500)
  }

  return <section className="ssh-snippets">
    <header className="ssh-snippets-toolbar">
      <div>
        <Group gap={7}><IconScript size={17} /><Text fw={700} size="sm">Scripts</Text>
          <Badge size="xs" variant="outline" color="gray">{scripts.length}</Badge></Group>
        <Text size="xs" c="dimmed">Reusable multi-line shell programs for {connection.name}</Text>
      </div>
      <Button size="compact-xs" leftSection={<IconPlus size={13} />} onClick={openNew}>New script</Button>
    </header>

    <div className="ssh-snippets-items">
      {sorted.map((script) => <article className="ssh-snippet-item" key={script.id}>
        <div className="ssh-snippet-item-main">
          <IconScript size={17} />
          <div><strong>{script.name}</strong><code>{script.template.split(/\r?\n/)[0]}</code></div>
        </div>
        <div className="ssh-snippet-item-actions">
          <Button size="compact-xs" leftSection={<IconPlayerPlay size={13} />}
            onClick={() => setRunnerScript(script)}>Run</Button>
          <Tooltip label={copiedId === script.id ? 'Copied' : 'Copy script'}>
            <ActionIcon size="sm" variant="subtle" color={copiedId === script.id ? 'teal' : 'gray'}
              onClick={() => copyScript(script)}>
              {copiedId === script.id ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Edit script">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => openEdit(script)}><IconEdit size={14} /></ActionIcon>
          </Tooltip>
          <Tooltip label="Delete script">
            <ActionIcon size="sm" variant="subtle" color="red"
              onClick={() => setScripts((current) => current.filter((item) => item.id !== script.id))}>
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </div>
      </article>)}
      {!sorted.length && <div className="ssh-snippets-empty">
        <IconScript size={30} />
        <Text size="sm" fw={650}>No scripts</Text>
        <Text size="xs" c="dimmed">Create a reusable multi-line script for this server.</Text>
        <Button size="compact-xs" leftSection={<IconPlus size={13} />} onClick={openNew}>New script</Button>
      </div>}
    </div>

    <Modal opened={editorOpened} onClose={() => setEditorOpened(false)}
      title={editingId ? 'Edit script' : 'New script'} size="90vw" centered
      classNames={{ content: 'ssh-script-editor-modal-shell', body: 'ssh-script-editor-modal-body' }}>
      <div className="ssh-snippet-editor-modal ssh-script-editor-modal">
        <TextInput autoFocus label="Name" placeholder="Example: Inspect deployment"
          value={draftName} onChange={(event) => { setDraftName(event.currentTarget.value); setDraftError(null) }} />
        <Textarea label="Script body"
          description="Write a multi-line shell script and use {{variable}} wherever input is required."
          placeholder={"set -e\necho \"Inspecting {{target}}\"\nfind {{target}} -maxdepth {{depth}} -print"}
          className="ssh-script-body-field" classNames={{ input: 'ssh-snippets-template-input' }}
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
              <small>{variable.explicit ? 'Declared in script' : 'Saved with script'}</small>
            </label>)}
          </div>
        </section>}
        {draftError && <Text size="xs" c="red">{draftError}</Text>}
        <Group justify="flex-end" gap={6}>
          <Button size="compact-xs" variant="default" onClick={() => setEditorOpened(false)}>Cancel</Button>
          <Button size="compact-xs" onClick={saveScript}>{editingId ? 'Save changes' : 'Create script'}</Button>
        </Group>
      </div>
    </Modal>

    <SshSnippetRunner connection={connection} snippet={runnerScript}
      onClose={() => setRunnerScript(null)} onOpenTerminal={onOpenTerminal} />
  </section>
}
