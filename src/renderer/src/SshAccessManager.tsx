import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Badge, Button, Checkbox, Group, Loader, Modal, SegmentedControl, Select, Switch, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { IconAdjustments, IconAlertTriangle, IconArrowUp, IconCheck, IconChevronRight, IconCode, IconCopy, IconFolder, IconFolderOpen, IconPlus, IconRefresh, IconShieldLock, IconTrash, IconUser, IconUsersGroup, IconX } from '@tabler/icons-react'
import type { SshAccessAclEntry, SshAccessChangeInput, SshAccessPreview, SshAccountCatalog, SshConnection, SshDirectoryListing } from '../../shared/desktop-api'

const messageFor = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)
const bits = [4, 2, 1] as const
const bitLetters = ['r', 'w', 'x'] as const
const modeFromRows = (rows: number[]): string => `0${rows.join('')}`
const rowsFromMode = (mode: string): number[] => mode.slice(-3).split('').map((digit) => Number(digit) || 0)
const aclPermissions = (value: number): string => bits.map((bit, index) => value & bit ? bitLetters[index] : '-').join('')
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`

const commandFor = (input: SshAccessChangeInput, command: string, directoriesOnly = false): string => {
  const path = shellQuote(input.path)
  if (!input.recursive) return `${command} -- ${path}`
  return `find ${path}${input.crossFilesystem ? '' : ' -xdev'}${directoriesOnly ? ' -type d' : ''} -exec ${command} -- '{}' +`
}
const commandsFromInput = (input: SshAccessChangeInput): string => {
  const commands: string[] = []
  if (input.owner && input.group) commands.push(commandFor(input, `chown -h ${shellQuote(`${input.owner}:${input.group}`)}`))
  else if (input.owner) commands.push(commandFor(input, `chown -h ${shellQuote(input.owner)}`))
  else if (input.group) commands.push(commandFor(input, `chgrp -h ${shellQuote(input.group)}`))
  if (input.permissions) commands.push(commandFor(input, `chmod ${input.permissions}`))
  for (const entry of input.acl) {
    const subject = `${entry.kind === 'user' ? 'u' : 'g'}:${entry.name}`
    const spec = `${entry.default ? 'd:' : ''}${subject}${entry.permissions === null ? '' : `:${entry.permissions}`}`
    commands.push(commandFor(input, `setfacl ${entry.permissions === null ? '-x' : '-m'} ${shellQuote(spec)}`, entry.default))
  }
  return commands.length ? commands.join('\n')
    : `# MyRepos access ${JSON.stringify({ path: input.path, recursive: input.recursive, crossFilesystem: input.crossFilesystem })}`
}
const shellWords = (line: string): string[] => {
  const words: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quote) {
      if (character === quote) quote = null
      else if (quote === '"' && character === '\\') {
        index += 1
        if (index < line.length) current += line[index]
      } else current += character
    } else if (character === "'" || character === '"') quote = character
    else if (/\s/.test(character)) {
      if (current) { words.push(current); current = '' }
    } else {
      if (';|&><`$()'.includes(character)) throw new Error(`Unsupported shell operator "${character}".`)
      current += character
    }
  }
  if (quote) throw new Error('An input quote is not closed.')
  if (current) words.push(current)
  return words
}
interface ParsedCommand {
  path: string
  recursive: boolean
  crossFilesystem: boolean
  owner?: string
  group?: string
  permissions?: string
  acl?: SshAccessAclEntry
}
const parseBasicCommand = (tokens: string[], forced?: Pick<ParsedCommand, 'path' | 'recursive' | 'crossFilesystem'>): ParsedCommand => {
  if (!tokens.length) throw new Error('Empty command.')
  const command = tokens[0]
  if (!['chmod', 'chown', 'chgrp', 'setfacl'].includes(command)) throw new Error(`"${command}" is not supported in access command mode.`)
  let recursive = forced?.recursive ?? false
  const args = tokens.slice(1).filter((token) => {
    if (token === '-R' || token === '--recursive') { recursive = true; return false }
    if (token === '-h' || token === '--no-dereference' || token === '--') return false
    return true
  })
  const path = forced?.path ?? args.pop()
  if (!path?.startsWith('/')) throw new Error(`${command} requires one absolute target path.`)
  const base = { path, recursive, crossFilesystem: forced?.crossFilesystem ?? recursive }
  if (command === 'chmod') {
    const permissions = args.shift()
    if (!permissions || !/^[0-7]{3,4}$/.test(permissions) || args.length) throw new Error('Supported chmod form: chmod [-R] 0755 /absolute/path')
    return { ...base, permissions: permissions.padStart(4, '0') }
  }
  if (command === 'chown' || command === 'chgrp') {
    const subject = args.shift()
    if (!subject || args.length) throw new Error(`Supported ${command} form requires one owner/group and one path.`)
    if (command === 'chgrp') return { ...base, group: subject }
    const separator = subject.indexOf(':')
    return separator < 0 ? { ...base, owner: subject }
      : { ...base, owner: subject.slice(0, separator) || undefined, group: subject.slice(separator + 1) || undefined }
  }
  const actionIndex = args.findIndex((token) => token === '-m' || token === '-x' || token === '--modify' || token === '--remove')
  if (actionIndex < 0 || actionIndex !== 0 || args.length !== 2) throw new Error('Supported setfacl forms use -m or -x with one named user/group entry.')
  const remove = args[0] === '-x' || args[0] === '--remove'
  const parts = args[1].split(':')
  const isDefault = parts[0] === 'd' || parts[0] === 'default'
  if (isDefault) parts.shift()
  const kindToken = parts.shift()
  const name = parts.shift() ?? ''
  const permissions = parts.shift()
  if (!['u', 'user', 'g', 'group'].includes(kindToken ?? '') || !name || parts.length
    || (!remove && !/^[r-][w-][x-]$/.test(permissions ?? ''))) {
    throw new Error('ACL entries must look like u:name:rwx, g:name:r-x, or d:u:name:rwx.')
  }
  return { ...base, acl: { kind: kindToken === 'u' || kindToken === 'user' ? 'user' : 'group', name, permissions: remove ? null : permissions!, default: isDefault } }
}
const parseAccessCommands = (source: string): SshAccessChangeInput => {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  if (!lines.length) {
    const metadata = source.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('# MyRepos access '))
    if (!metadata) throw new Error('Enter at least one supported access command.')
    try {
      const parsed = JSON.parse(metadata.slice('# MyRepos access '.length)) as { path?: unknown; recursive?: unknown; crossFilesystem?: unknown }
      if (typeof parsed.path !== 'string' || !parsed.path.startsWith('/')) throw new Error()
      return {
        path: parsed.path, owner: null, group: null, permissions: null, acl: [],
        recursive: Boolean(parsed.recursive), crossFilesystem: Boolean(parsed.crossFilesystem),
      }
    } catch {
      throw new Error('The MyRepos target metadata comment is invalid.')
    }
  }
  const parsed = lines.map((line): ParsedCommand => {
    const tokens = shellWords(line)
    if (tokens[0] !== 'find') return parseBasicCommand(tokens)
    const execIndex = tokens.indexOf('-exec')
    if (execIndex < 3 || tokens[tokens.length - 1] !== '+' || tokens[tokens.length - 2] !== '{}') {
      throw new Error('Only the safe generated find & -exec & {} + form is supported.')
    }
    const path = tokens[1]
    const options = tokens.slice(2, execIndex)
    if (!path.startsWith('/') || options.some((option) => !['-xdev', '-type', 'd'].includes(option))) {
      throw new Error('The find command contains unsupported path or traversal options.')
    }
    const inner = tokens.slice(execIndex + 1, -2)
    return parseBasicCommand([...inner, path], { path, recursive: true, crossFilesystem: !options.includes('-xdev') })
  })
  const first = parsed[0]
  if (parsed.some((item) => item.path !== first.path || item.recursive !== first.recursive || item.crossFilesystem !== first.crossFilesystem)) {
    throw new Error('All commands must use the same target path and recursive scope.')
  }
  const result: SshAccessChangeInput = {
    path: first.path, owner: null, group: null, permissions: null,
    recursive: first.recursive, crossFilesystem: first.crossFilesystem, acl: [],
  }
  for (const item of parsed) {
    if (item.owner !== undefined) {
      if (result.owner !== null) throw new Error('Only one ownership operation is supported.')
      result.owner = item.owner
    }
    if (item.group !== undefined) {
      if (result.group !== null) throw new Error('Only one group ownership operation is supported.')
      result.group = item.group
    }
    if (item.permissions !== undefined) {
      if (result.permissions !== null) throw new Error('Only one chmod operation is supported.')
      result.permissions = item.permissions
    }
    if (item.acl) result.acl.push(item.acl)
  }
  return result
}

interface Props {
  opened: boolean
  onClose: () => void
  connection: SshConnection
  catalog: SshAccountCatalog
  defaultUser: string
  defaultPath: string
}

export function SshAccessManager({ opened, onClose, connection, catalog, defaultUser, defaultPath }: Props) {
  const [path, setPath] = useState(defaultPath)
  const [owner, setOwner] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [mode, setMode] = useState<string | null>(null)
  const [modeRows, setModeRows] = useState([7, 5, 5])
  const [recursive, setRecursive] = useState(false)
  const [crossFilesystem, setCrossFilesystem] = useState(false)
  const [acl, setAcl] = useState<SshAccessAclEntry[]>([])
  const [preview, setPreview] = useState<SshAccessPreview | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [browser, setBrowser] = useState<SshDirectoryListing | null>(null)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserLoading, setBrowserLoading] = useState(false)
  const [editorMode, setEditorMode] = useState<'gui' | 'command'>('gui')
  const [commandText, setCommandText] = useState('')
  const [commandError, setCommandError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!opened) return
    setPath(defaultPath)
    setOwner(null)
    setGroup(null)
    setMode(null)
    setModeRows([7, 5, 5])
    setRecursive(false)
    setCrossFilesystem(false)
    setAcl([])
    setPreview(null)
    setConfirmation('')
    setError(null)
    setSuccess(null)
    setBrowser(null)
    setBrowserOpen(false)
    setEditorMode('gui')
    setCommandText(commandsFromInput({
      path: defaultPath, owner: null, group: null, permissions: null,
      recursive: false, crossFilesystem: false, acl: [],
    }))
    setCommandError(null)
    setCopied(false)
  }, [opened, defaultPath, defaultUser])

  const input = useMemo<SshAccessChangeInput>(() => ({
    path: path.trim(), owner, group, permissions: mode, recursive, crossFilesystem, acl,
  }), [path, owner, group, mode, recursive, crossFilesystem, acl])
  useEffect(() => {
    setPreview(null)
    setConfirmation('')
    setSuccess(null)
  }, [input])
  useEffect(() => {
    if (editorMode === 'gui') {
      setCommandText(commandsFromInput(input))
      setCommandError(null)
    }
  }, [input, editorMode])

  const acceptCommands = (source: string): boolean => {
    setCommandText(source)
    setCopied(false)
    try {
      const parsed = parseAccessCommands(source)
      const unknownOwner = parsed.owner && !catalog.users.some((user) => user.username === parsed.owner)
      const unknownGroup = parsed.group && !catalog.groups.some((item) => item.name === parsed.group)
      const unknownAcl = parsed.acl.find((entry) => entry.kind === 'user'
        ? !catalog.users.some((user) => user.username === entry.name)
        : !catalog.groups.some((item) => item.name === entry.name))
      if (unknownOwner) throw new Error(`Owner "${parsed.owner}" was not found in the loaded server accounts.`)
      if (unknownGroup) throw new Error(`Group "${parsed.group}" was not found in the loaded server groups.`)
      if (unknownAcl) throw new Error(`${unknownAcl.kind === 'user' ? 'User' : 'Group'} "${unknownAcl.name}" was not found on the server.`)
      setPath(parsed.path)
      setOwner(parsed.owner)
      setGroup(parsed.group)
      setMode(parsed.permissions)
      if (parsed.permissions) setModeRows(rowsFromMode(parsed.permissions))
      setRecursive(parsed.recursive)
      setCrossFilesystem(parsed.crossFilesystem)
      setAcl(parsed.acl)
      setCommandError(null)
      return true
    } catch (reason) {
      setCommandError(messageFor(reason))
      return false
    }
  }
  const changeEditorMode = (next: string): void => {
    if (next === 'command') {
      setCommandText(commandsFromInput(input))
      setCommandError(null)
      setEditorMode('command')
      return
    }
    if (acceptCommands(commandText)) setEditorMode('gui')
  }
  const copyCommands = async (): Promise<void> => {
    await navigator.clipboard.writeText(commandText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  const loadDirectory = async (nextPath: string): Promise<void> => {
    if (!window.desktop) return
    setBrowserLoading(true)
    setError(null)
    try {
      setBrowser(await window.desktop.ssh.listDirectory(connection.id, nextPath))
      setBrowserOpen(true)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBrowserLoading(false)
    }
  }
  const inspect = async (): Promise<void> => {
    if (!window.desktop) return
    if (editorMode === 'command' && !acceptCommands(commandText)) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      setPreview(await window.desktop.ssh.previewAccess(connection.id, input))
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }
  const apply = async (): Promise<void> => {
    if (!window.desktop || !preview) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.desktop.ssh.applyAccess(connection.id, input, preview.token, confirmation)
      setSuccess(`Access updated for ${result.affectedCount.toLocaleString()} item${result.affectedCount === 1 ? '' : 's'}.`)
      setPreview(null)
      setConfirmation('')
    } catch (reason) {
      setError(messageFor(reason))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }
  const toggleModeBit = (row: number, bit: number): void => {
    const next = modeRows.map((value, index) => index === row ? value ^ bit : value)
    setModeRows(next)
    setMode(modeFromRows(next))
  }
  const addAcl = (kind: 'user' | 'group'): void => {
    const name = kind === 'user' ? defaultUser : (catalog.users.find((user) => user.username === defaultUser)?.primaryGroup ?? catalog.groups[0]?.name ?? '')
    if (!name || acl.some((entry) => entry.kind === kind && entry.name === name && !entry.default)) return
    setAcl((current) => [...current, { kind, name, permissions: 'rwx', default: false }])
  }
  const updateAcl = (index: number, change: Partial<SshAccessAclEntry>): void =>
    setAcl((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...change } : entry))

  return (
    <Modal opened={opened} onClose={busy ? () => undefined : onClose} size="min(1220px, calc(100vw - 24px))"
      centered={false} title={<Group gap={7}><IconShieldLock size={18} /><span>Manage filesystem access</span></Group>}
      classNames={{ content: 'ssh-access-modal', body: 'ssh-access-modal-body' }}>
      <div className="ssh-access-manager">
        <section className="ssh-access-section">
          <header><strong>Target</strong><span>Choose visually or enter an absolute server path.</span></header>
          <div className="ssh-access-path">
            <TextInput autoFocus value={path} placeholder="/var/www/application"
              onChange={(event) => setPath(event.currentTarget.value)} />
            <Tooltip label="Browse remote folders"><ActionIcon size="lg" variant={browserOpen ? 'light' : 'default'}
              loading={browserLoading} onClick={() => void loadDirectory(path || defaultPath)}><IconFolderOpen size={16} /></ActionIcon></Tooltip>
            <Button variant="default" leftSection={<IconRefresh size={14} />} loading={busy} onClick={() => void inspect()}>Inspect</Button>
          </div>
          {browserOpen && (
            <div className="ssh-access-browser">
              <div className="ssh-access-browser-head">
                <ActionIcon size="sm" variant="subtle" disabled={!browser?.parentPath} onClick={() => browser?.parentPath && void loadDirectory(browser.parentPath)}><IconArrowUp size={14} /></ActionIcon>
                <code>{browser?.path ?? path}</code>
                <Button size="compact-xs" variant="light" onClick={() => { if (browser) setPath(browser.path); setBrowserOpen(false) }}>Use this folder</Button>
              </div>
              {browserLoading ? <Loader size="xs" /> : browser?.entries.map((entry) => (
                <button type="button" key={entry.path} onDoubleClick={() => entry.type === 'directory' && void loadDirectory(entry.path)}
                  onClick={() => setPath(entry.path)}>
                  {entry.type === 'directory' ? <IconFolder size={14} /> : <span className="ssh-access-file-dot" />}
                  <span>{entry.name}</span><small>{entry.permissions}</small>
                  {entry.type === 'directory' && <IconChevronRight size={13} />}
                </button>
              ))}
              {!browserLoading && !browser?.entries.length && <Text size="xs" c="dimmed">This folder is empty.</Text>}
            </div>
          )}
        </section>

        <div className="ssh-access-editor-switch">
          <SegmentedControl size="xs" value={editorMode} onChange={changeEditorMode} data={[
            { value: 'gui', label: <span><IconAdjustments size={13} /> GUI</span> },
            { value: 'command', label: <span><IconCode size={13} /> Command</span> },
          ]} />
          <span>Both views edit the same pending operation. Switching never executes a command.</span>
        </div>

        {editorMode === 'command' ? (
          <section className="ssh-access-section ssh-access-command">
            <header>
              <div><strong>Terminal-compatible commands</strong><span>Paste supported commands or edit the commands generated from the GUI.</span></div>
              <Group gap={5}>
                <Badge size="xs" variant="outline" color="teal">STRICT PARSER</Badge>
                <Tooltip label={copied ? 'Copied' : 'Copy commands'}><ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'}
                  onClick={() => void copyCommands()}>{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}</ActionIcon></Tooltip>
                <Tooltip label="Regenerate from the current parsed model"><ActionIcon variant="subtle" color="gray"
                  onClick={() => { setCommandText(commandsFromInput(input)); setCommandError(null) }}><IconRefresh size={14} /></ActionIcon></Tooltip>
              </Group>
            </header>
            <Textarea autosize minRows={7} maxRows={15} value={commandText}
              classNames={{ input: 'ssh-access-command-input' }}
              onChange={(event) => acceptCommands(event.currentTarget.value)}
              error={commandError ?? undefined}
              description="Supported: chmod, chown, chgrp, setfacl, and the safe find -exec form generated here." />
            <div className="ssh-access-command-status" data-valid={!commandError || undefined}>
              {commandError ? <><IconAlertTriangle size={14} /><span>The GUI was not changed. Fix the command before previewing or switching back.</span></>
                : <><IconCheck size={14} /><span>Parsed into GUI: <code>{input.path}</code> - {input.recursive ? 'recursive' : 'single item'} - {input.acl.length} ACL change{input.acl.length === 1 ? '' : 's'}</span></>}
            </div>
            <div className="ssh-access-command-rules">
              <span><b>Accepted</b> quoted paths, <code>-R</code>, <code>-xdev</code>, named user/group ACLs</span>
              <span><b>Rejected</b> sudo, pipes, redirects, substitutions, chained or unrelated commands</span>
              <span><b>Execution</b> only through Preview and Apply; this editor never runs raw shell text</span>
            </div>
          </section>
        ) : <>
        <div className="ssh-access-columns">
          <section className="ssh-access-section">
            <header><strong>Ownership</strong><span>Leave unchanged fields empty.</span></header>
            <div className="ssh-access-two">
              <Select clearable searchable label="Owner" placeholder="Keep current owner" leftSection={<IconUser size={13} />}
                data={catalog.users.map((user) => user.username)} value={owner} onChange={setOwner} />
              <Select clearable searchable label="Group" placeholder="Keep current group" leftSection={<IconUsersGroup size={13} />}
                data={catalog.groups.map((item) => item.name)} value={group} onChange={setGroup} />
            </div>
          </section>

          <section className="ssh-access-section">
            <header><strong>Unix permissions</strong><Switch size="xs" label="Change mode" checked={mode !== null}
              onChange={(event) => setMode(event.currentTarget.checked ? modeFromRows(modeRows) : null)} /></header>
            <div className="ssh-access-mode" data-disabled={mode === null || undefined}>
              <div /><small>Read</small><small>Write</small><small>Execute</small><small>Sum</small>
              {['Owner', 'Group', 'Others'].map((label, row) => (
                <div className="ssh-access-mode-row" key={label}>
                  <strong>{label}</strong>
                  {bits.map((bit) => <button type="button" key={bit} disabled={mode === null}
                    data-on={Boolean(modeRows[row] & bit) || undefined} onClick={() => toggleModeBit(row, bit)}>{bit}</button>)}
                  <b>{modeRows[row]}</b>
                </div>
              ))}
              <TextInput size="xs" disabled={mode === null} value={mode ?? modeFromRows(modeRows)} aria-label="Octal permissions"
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setMode(value)
                  if (/^[0-7]{3,4}$/.test(value)) setModeRows(rowsFromMode(value))
                }} />
            </div>
          </section>
        </div>

        <section className="ssh-access-section">
          <header>
            <div><strong>POSIX ACL</strong><span>Grant or remove named-user and named-group access without replacing other ACL entries.</span></div>
            <Group gap={5}><Button size="compact-xs" variant="default" leftSection={<IconPlus size={12} />} onClick={() => addAcl('user')}>User</Button>
              <Button size="compact-xs" variant="default" leftSection={<IconPlus size={12} />} onClick={() => addAcl('group')}>Group</Button></Group>
          </header>
          {acl.map((entry, index) => {
            const value = entry.permissions === null ? 0 : bits.reduce((sum, bit, bitIndex) => sum + (entry.permissions?.[bitIndex] !== '-' ? bit : 0), 0)
            return <div className="ssh-access-acl-row" key={`${entry.kind}-${index}`}>
              <Select size="xs" data={[{ value: 'user', label: 'User' }, { value: 'group', label: 'Group' }]} value={entry.kind}
                onChange={(kind) => kind && updateAcl(index, { kind: kind as 'user' | 'group', name: '' })} />
              <Select size="xs" searchable data={(entry.kind === 'user' ? catalog.users.map((user) => user.username) : catalog.groups.map((item) => item.name))}
                value={entry.name} onChange={(name) => updateAcl(index, { name: name ?? '' })} />
              {bits.map((bit, bitIndex) => <Tooltip key={bit} label={bitLetters[bitIndex] === 'r' ? 'Read' : bitLetters[bitIndex] === 'w' ? 'Write' : 'Execute'}>
                <button type="button" data-on={Boolean(value & bit) || undefined} onClick={() => {
                  const next = value ^ bit
                  updateAcl(index, { permissions: aclPermissions(next) })
                }}>{bitLetters[bitIndex].toUpperCase()}</button></Tooltip>)}
              <Checkbox size="xs" label="Default" checked={entry.default} onChange={(event) => updateAcl(index, { default: event.currentTarget.checked })} />
              <Tooltip label={entry.permissions === null ? 'Restore this ACL entry' : 'Mark this ACL entry for removal'}>
                <ActionIcon size="sm" variant="subtle" color={entry.permissions === null ? 'teal' : 'red'}
                  onClick={() => updateAcl(index, { permissions: entry.permissions === null ? 'rwx' : null })}>
                  {entry.permissions === null ? <IconRefresh size={13} /> : <IconTrash size={13} />}
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Remove this pending row"><ActionIcon size="sm" variant="subtle" color="gray"
                onClick={() => setAcl((current) => current.filter((_, itemIndex) => itemIndex !== index))}><IconX size={13} /></ActionIcon></Tooltip>
            </div>
          })}
          {!acl.length && <Text size="xs" c="dimmed">No ACL changes selected. Existing ACLs will remain untouched.</Text>}
        </section>

        <section className="ssh-access-section ssh-access-scope">
          <header><strong>Scope & safety</strong></header>
          <Switch checked={recursive} label="Include all descendants" description="The selected item is always included."
            onChange={(event) => { const checked = event.currentTarget.checked; setRecursive(checked); if (!checked) setCrossFilesystem(false) }} />
          <Switch checked={crossFilesystem} disabled={!recursive} color="orange" label="Cross mounted filesystems"
            description="Off by default. Enable only when the target intentionally spans mounts."
            onChange={(event) => setCrossFilesystem(event.currentTarget.checked)} />
        </section>
        </>}

        {preview && <section className="ssh-access-preview" data-risk={preview.risk}>
          <header><strong>Verified preview</strong><Badge size="xs" color={preview.risk === 'normal' ? 'teal' : preview.risk === 'elevated' ? 'yellow' : 'red'}>{preview.risk}</Badge></header>
          <div className="ssh-access-current">
            <span><small>Resolved path</small><code>{preview.resolvedPath}</code></span>
            <span><small>Type</small><b>{preview.type}</b></span><span><small>Owner</small><b>{preview.owner}:{preview.group}</b></span>
            <span><small>Mode</small><b>{preview.permissions}</b></span><span><small>Scope</small><b>{preview.countTruncated ? '>' : ''}{preview.affectedCount.toLocaleString()} items</b></span>
          </div>
          {preview.operations.length ? <ul>{preview.operations.map((operation) => <li key={operation}><IconCheck size={13} />{operation}</li>)}</ul>
            : <Text size="xs" c="dimmed">No changes selected.</Text>}
          {preview.warnings.map((warning) => <div className="ssh-access-warning" key={warning}><IconAlertTriangle size={14} />{warning}</div>)}
          {preview.currentAcl.length > 0 && <details><summary>Current ACL ({preview.currentAcl.length} lines)</summary><pre>{preview.currentAcl.join('\n')}</pre></details>}
          {preview.confirmationPhrase && <TextInput label="Confirmation required" description={`Type: ${preview.confirmationPhrase}`}
            value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} />}
        </section>}

        {error && <div className="ssh-accounts-error">{error}</div>}
        {success && <div className="ssh-access-success"><IconCheck size={14} />{success}</div>}
        <div className="ssh-access-footer">
          <Text size="xs" c="dimmed">Preview expires after 60 seconds and Apply re-checks the target.</Text>
          <Group gap={7}><Button size="xs" variant="subtle" color="gray" disabled={busy} onClick={onClose}>Close</Button>
            <Button size="xs" variant="default" loading={busy} onClick={() => void inspect()}>Preview changes</Button>
            <Button size="xs" color={preview?.risk === 'dangerous' ? 'red' : 'teal'} loading={busy}
              disabled={!preview || preview.risk === 'blocked' || !preview.operations.length || Boolean(preview.confirmationPhrase && confirmation !== preview.confirmationPhrase)}
              onClick={() => void apply()}>Apply verified changes</Button></Group>
        </div>
      </div>
    </Modal>
  )
}
