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
const permissionPresets = [
  { name: 'Shared web app', hint: 'Team writes; new items inherit group', directory: '2775', file: '0664' },
  { name: 'Public read-only', hint: 'Owner writes; everyone can read', directory: '0755', file: '0644' },
  { name: 'Private', hint: 'Only the owner has access', directory: '0700', file: '0600' },
  { name: 'Group private', hint: 'Team reads; others have no access', directory: '2750', file: '0640' },
] as const
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`

const commandFor = (input: SshAccessChangeInput, command: string, targetType: 'directory' | 'file' | null = null): string => {
  const path = shellQuote(input.path)
  if (!input.recursive) return `${command} -- ${path}`
  return `find ${path}${input.crossFilesystem ? '' : ' -xdev'}${targetType ? ` -type ${targetType === 'directory' ? 'd' : 'f'}` : ''} -exec ${command} -- '{}' +`
}
const commandsFromInput = (input: SshAccessChangeInput): string => {
  const commands: string[] = []
  if (input.owner && input.group) commands.push(commandFor(input, `chown -h ${shellQuote(`${input.owner}:${input.group}`)}`))
  else if (input.owner) commands.push(commandFor(input, `chown -h ${shellQuote(input.owner)}`))
  else if (input.group) commands.push(commandFor(input, `chgrp -h ${shellQuote(input.group)}`))
  if (input.permissions) commands.push(commandFor(input, `chmod ${input.permissions}`))
  if (input.directoryPermissions) commands.push(commandFor(input, `chmod ${input.directoryPermissions}`, 'directory'))
  if (input.filePermissions) commands.push(commandFor(input, `chmod ${input.filePermissions}`, 'file'))
  for (const entry of input.acl) {
    const subject = `${entry.kind === 'user' ? 'u' : 'g'}:${entry.name}`
    const spec = `${entry.default ? 'd:' : ''}${subject}${entry.permissions === null ? '' : `:${entry.permissions}`}`
    commands.push(commandFor(input, `setfacl ${entry.permissions === null ? '-x' : '-m'} ${shellQuote(spec)}`, entry.default ? 'directory' : null))
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
  targetType: 'all' | 'directory' | 'file'
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
  const base = { path, recursive, crossFilesystem: forced?.crossFilesystem ?? recursive, targetType: 'all' as const }
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
        path: parsed.path, owner: null, group: null, permissions: null,
        directoryPermissions: null, filePermissions: null, acl: [],
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
    if (!path.startsWith('/') || options.some((option) => !['-xdev', '-type', 'd', 'f'].includes(option))) {
      throw new Error('The find command contains unsupported path or traversal options.')
    }
    const typeIndex = options.indexOf('-type')
    const targetType = typeIndex < 0 ? 'all' : options[typeIndex + 1] === 'd' ? 'directory' : options[typeIndex + 1] === 'f' ? 'file' : null
    if (!targetType || (typeIndex >= 0 && typeIndex !== options.length - 2)) throw new Error('Only -type d or -type f is supported in generated find commands.')
    const inner = tokens.slice(execIndex + 1, -2)
    return { ...parseBasicCommand(inner, { path, recursive: true, crossFilesystem: !options.includes('-xdev') }), targetType }
  })
  const first = parsed[0]
  if (parsed.some((item) => item.path !== first.path || item.recursive !== first.recursive || item.crossFilesystem !== first.crossFilesystem)) {
    throw new Error('All commands must use the same target path and recursive scope.')
  }
  const result: SshAccessChangeInput = {
    path: first.path, owner: null, group: null, permissions: null, directoryPermissions: null, filePermissions: null,
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
      const key = item.targetType === 'directory' ? 'directoryPermissions' : item.targetType === 'file' ? 'filePermissions' : 'permissions'
      if (result[key] !== null) throw new Error(`Only one chmod operation per target type is supported.`)
      result[key] = item.permissions
    }
    if (item.acl) result.acl.push(item.acl)
  }
  if (result.permissions && (result.directoryPermissions || result.filePermissions)) {
    throw new Error('Do not mix a whole-tree chmod with separate folder/file chmod rules.')
  }
  if ((result.directoryPermissions || result.filePermissions) && !result.recursive) {
    throw new Error('Separate folder/file chmod rules require recursive scope.')
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
  const [directoryMode, setDirectoryMode] = useState<string | null>(null)
  const [fileMode, setFileMode] = useState<string | null>(null)
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
  const [editorMode, setEditorMode] = useState<'simple' | 'gui' | 'command'>('simple')
  const [selectedRecipe, setSelectedRecipe] = useState<'managed' | 'private' | 'shared' | null>(null)
  const [commandText, setCommandText] = useState('')
  const [commandError, setCommandError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!opened) return
    setPath(defaultPath)
    setOwner(null)
    setGroup(null)
    setMode(null)
    setDirectoryMode(null)
    setFileMode(null)
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
    setEditorMode('simple')
    setSelectedRecipe(null)
    setCommandText(commandsFromInput({
      path: defaultPath, owner: null, group: null, permissions: null,
      directoryPermissions: null, filePermissions: null,
      recursive: false, crossFilesystem: false, acl: [],
    }))
    setCommandError(null)
    setCopied(false)
  }, [opened, defaultPath, defaultUser])

  const input = useMemo<SshAccessChangeInput>(() => ({
    path: path.trim(), owner, group, permissions: mode, directoryPermissions: directoryMode,
    filePermissions: fileMode, recursive, crossFilesystem, acl,
  }), [path, owner, group, mode, directoryMode, fileMode, recursive, crossFilesystem, acl])
  useEffect(() => {
    setPreview(null)
    setConfirmation('')
    setSuccess(null)
  }, [input])
  useEffect(() => {
    if (editorMode !== 'command') {
      setCommandText(commandsFromInput(input))
      setCommandError(null)
    }
  }, [input, editorMode])

  const acceptCommands = (source: string, updateEditor = true): boolean => {
    if (updateEditor) setCommandText(source)
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
      setDirectoryMode(parsed.directoryPermissions)
      setFileMode(parsed.filePermissions)
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
    if (acceptCommands(commandText)) setEditorMode(next as 'simple' | 'gui')
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
  const permissionPolicy = directoryMode || fileMode ? 'split' : mode ? 'same' : 'keep'
  const setPermissionPolicy = (policy: string): void => {
    if (policy === 'keep') {
      setMode(null); setDirectoryMode(null); setFileMode(null)
    } else if (policy === 'same') {
      setMode(mode ?? directoryMode ?? fileMode ?? modeFromRows(modeRows))
      setDirectoryMode(null); setFileMode(null)
    } else {
      setMode(null)
      setDirectoryMode(directoryMode ?? '0755')
      setFileMode(fileMode ?? '0644')
      setRecursive(true)
    }
  }
  const applyPermissionPreset = (directory: string, file: string): void => {
    setMode(null)
    setDirectoryMode(directory)
    setFileMode(file)
    setRecursive(true)
  }
  const applyRecipe = (recipe: 'managed' | 'private' | 'shared'): void => {
    const user = catalog.users.find((item) => item.username === defaultUser)
    setSelectedRecipe(recipe)
    setOwner(defaultUser)
    setGroup(user?.primaryGroup ?? null)
    setMode(null)
    setDirectoryMode(recipe === 'private' ? '0700' : recipe === 'shared' ? '2775' : '0755')
    setFileMode(recipe === 'private' ? '0600' : recipe === 'shared' ? '0664' : '0644')
    setRecursive(true)
    setCrossFilesystem(false)
    setAcl([])
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
            { value: 'simple', label: <span><IconCheck size={13} /> Simple</span> },
            { value: 'gui', label: <span><IconAdjustments size={13} /> Advanced</span> },
            { value: 'command', label: <span><IconCode size={13} /> Command</span> },
          ]} />
          <span>Choose an outcome here. Advanced and Command show the same pending changes in more detail.</span>
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
              onChange={(event) => {
                const value = event.currentTarget.value
                setCommandText(value)
                setCopied(false)
                acceptCommands(value, false)
              }}
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
        ) : editorMode === 'simple' ? (
          <section className="ssh-access-section ssh-access-simple">
            <header><div><strong>What should this folder become?</strong><span>Choose the result you want. Nothing changes until you preview and apply.</span></div></header>
            <div className="ssh-access-recipes">
              <button type="button" data-active={selectedRecipe === 'managed' || undefined} onClick={() => applyRecipe('managed')}>
                <IconUser size={20} /><strong>User-managed</strong>
                <span>{defaultUser} can manage it; other users can read it.</span>
                <small>Folders 0755 - Files 0644</small>
              </button>
              <button type="button" data-active={selectedRecipe === 'private' || undefined} onClick={() => applyRecipe('private')}>
                <IconShieldLock size={20} /><strong>Private</strong>
                <span>Only {defaultUser} can open or change its contents.</span>
                <small>Folders 0700 - Files 0600</small>
              </button>
              <button type="button" data-active={selectedRecipe === 'shared' || undefined} onClick={() => applyRecipe('shared')}>
                <IconUsersGroup size={20} /><strong>Shared website/team</strong>
                <span>The owner and selected group can work together.</span>
                <small>Folders 2775 - Files 0664</small>
              </button>
              <button type="button" onClick={() => setEditorMode('gui')}>
                <IconAdjustments size={20} /><strong>Something else</strong>
                <span>Build a custom ownership, permission and ACL policy.</span>
                <small>Open advanced controls</small>
              </button>
            </div>
            {selectedRecipe ? <div className="ssh-access-simple-config">
              <div className="ssh-access-simple-fields">
                <Select searchable label="Who manages it?" description="The owner of this folder and its current contents."
                  data={catalog.users.map((user) => user.username)} value={owner} onChange={setOwner} />
                <Select searchable label={selectedRecipe === 'shared' ? 'Which team can edit it?' : 'Primary group'}
                  description={selectedRecipe === 'shared' ? 'Choose the web-server or project group.' : 'Used as the folder group.'}
                  data={catalog.groups.map((item) => item.name)} value={group} onChange={setGroup} />
                <Switch checked disabled label="Include everything already inside"
                  description="Required so folders and ordinary files receive the correct permissions." />
              </div>
              <div className="ssh-access-simple-summary">
                <strong>What Preview will check</strong>
                <span><IconUser size={14} /><b>Owner</b><em>{owner ?? 'unchanged'}{group ? ` : ${group}` : ''}</em></span>
                <span><IconFolder size={14} /><b>Folders</b><em>{directoryMode} - {selectedRecipe === 'private' ? 'owner only' : selectedRecipe === 'shared' ? 'owner and team can edit' : 'owner edits, others browse'}</em></span>
                <span><IconCode size={14} /><b>Files</b><em>{fileMode} - {selectedRecipe === 'private' ? 'owner only' : selectedRecipe === 'shared' ? 'owner and team can edit' : 'owner edits, others read'}</em></span>
                <span><IconRefresh size={14} /><b>Scope</b><em>this folder and all current contents</em></span>
              </div>
            </div> : <div className="ssh-access-simple-empty">
              <IconChevronRight size={18} /><span>Select one of the outcomes above to continue.</span>
            </div>}
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
            <header><strong>Unix permissions</strong><span>Use one mode or treat folders and files correctly.</span></header>
            <SegmentedControl fullWidth size="xs" value={permissionPolicy} onChange={setPermissionPolicy} data={[
              { value: 'keep', label: 'Keep' }, { value: 'same', label: 'Same mode' }, { value: 'split', label: 'Folders / files' },
            ]} />
            {permissionPolicy === 'same' && <div className="ssh-access-mode">
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
            </div>}
            {permissionPolicy === 'split' && <div className="ssh-access-split-modes">
              <label><span><IconFolder size={14} /> Folders <small>Need execute to enter</small></span>
                <TextInput size="xs" value={directoryMode ?? ''} aria-label="Folder permissions"
                  onChange={(event) => setDirectoryMode(event.currentTarget.value)} /></label>
              <label><span><IconCode size={14} /> Files <small>Usually not executable</small></span>
                <TextInput size="xs" value={fileMode ?? ''} aria-label="File permissions"
                  onChange={(event) => setFileMode(event.currentTarget.value)} /></label>
            </div>}
            {permissionPolicy === 'split' && <div className="ssh-access-presets">
              {permissionPresets.map((preset) => <Tooltip key={preset.name} label={preset.hint}>
                <button type="button" data-active={directoryMode === preset.directory && fileMode === preset.file || undefined}
                  onClick={() => applyPermissionPreset(preset.directory, preset.file)}>
                  <strong>{preset.name}</strong><span>{preset.directory} / {preset.file}</span>
                </button>
              </Tooltip>)}
            </div>}
            {permissionPolicy === 'keep' && <div className="ssh-access-permission-empty">
              Existing modes stay unchanged. Ownership and ACL steps can still be composed below.
            </div>}
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
