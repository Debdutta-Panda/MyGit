import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Select, Text, TextInput, Tooltip } from '@mantine/core'
import { IconCheck, IconCopy, IconVariable } from '@tabler/icons-react'
import './command-snippets.css'

export type CommandSnippetTag = 'path' | 'user' | 'group' | 'mode' | 'text'
export interface CommandSnippetVariable { name: string; tag: CommandSnippetTag; explicit: boolean }
export interface CommandSnippetRenderResult {
  rendered: string | null
  missing: string[]
  error: string | null
}

const pattern = /{{\s*([a-zA-Z_][a-zA-Z0-9_-]*)(?::(path|user|group|mode|text))?\s*}}/g
const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`

export const hasCommandSnippetVariables = (source: string): boolean => {
  pattern.lastIndex = 0
  return pattern.test(source)
}
const inferTag = (name: string): CommandSnippetTag => {
  const value = name.toLowerCase()
  if (value === 'path' || value.endsWith('_path') || value.includes('folder') || value.includes('directory')) return 'path'
  if (value === 'owner' || value === 'user' || value.endsWith('_user')) return 'user'
  if (value === 'group' || value.endsWith('_group')) return 'group'
  if (value === 'mode' || value.endsWith('_mode') || value.includes('permission')) return 'mode'
  return 'text'
}
const variablesFrom = (source: string, overrides: Record<string, CommandSnippetTag>): CommandSnippetVariable[] => {
  const found = new Map<string, CommandSnippetVariable>()
  pattern.lastIndex = 0
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    const explicit = match[2] as CommandSnippetTag | undefined
    const previous = found.get(name)
    if (previous?.explicit && explicit && previous.tag !== explicit) throw new Error(`Variable "${name}" has conflicting tags.`)
    found.set(name, {
      name,
      tag: explicit ?? overrides[name] ?? previous?.tag ?? inferTag(name),
      explicit: Boolean(explicit ?? previous?.explicit),
    })
  }
  return [...found.values()]
}
const validated = (variable: CommandSnippetVariable, raw: string): string => {
  const value = raw.trim()
  if (!value) throw new Error(`Fill ${variable.name}.`)
  if (/[\r\n\0]/.test(value)) throw new Error(`${variable.name} contains an unsupported line break.`)
  if (variable.tag === 'path' && (!value.startsWith('/') || value.length > 4_096)) throw new Error(`${variable.name} must be an absolute path.`)
  if ((variable.tag === 'user' || variable.tag === 'group') && !/^[a-z_][a-z0-9_-]{0,30}\$?$/i.test(value)) {
    throw new Error(`${variable.name} is not a valid account name.`)
  }
  if (variable.tag === 'mode' && !/^[0-7]{3,4}$/.test(value)) throw new Error(`${variable.name} must be a three or four digit octal mode.`)
  return value
}
const render = (
  source: string,
  values: Record<string, string>,
  overrides: Record<string, CommandSnippetTag>,
): CommandSnippetRenderResult & { variables: CommandSnippetVariable[] } => {
  try {
    const variables = variablesFrom(source, overrides)
    const missing = variables.filter((variable) => !values[variable.name]?.trim()).map((variable) => variable.name)
    if (missing.length) return { rendered: null, missing, error: null, variables }
    const byName = new Map(variables.map((variable) => [variable.name, variable]))
    pattern.lastIndex = 0
    const rendered = source.replace(pattern, (_placeholder, name: string, _tag: string, offset: number) => {
      const variable = byName.get(name)!
      const value = validated(variable, values[name])
      const insideSingleQuote = (source.slice(0, offset).match(/'/g)?.length ?? 0) % 2 === 1
      if (insideSingleQuote) return value.replace(/'/g, `'"'"'`)
      return variable.tag === 'mode' ? value : quote(value)
    })
    return { rendered, missing: [], error: null, variables }
  } catch (reason) {
    return { rendered: null, missing: [], error: reason instanceof Error ? reason.message : String(reason), variables: [] }
  }
}

interface Props {
  template: string
  users?: string[]
  groups?: string[]
  initialValues?: Record<string, string>
  onResult: (result: CommandSnippetRenderResult) => void
}

export function CommandSnippetTemplate({ template, users = [], groups = [], initialValues = {}, onResult }: Props) {
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [tags, setTags] = useState<Record<string, CommandSnippetTag>>({})
  const [copied, setCopied] = useState(false)
  const result = useMemo(() => render(template, values, tags), [template, values, tags])

  useEffect(() => {
    setValues((current) => {
      const next = { ...current }
      for (const variable of result.variables) {
        if (!(variable.name in next) && initialValues[variable.name]) next[variable.name] = initialValues[variable.name]
      }
      return next
    })
  }, [template])
  useEffect(() => onResult({ rendered: result.rendered, missing: result.missing, error: result.error }),
    [result.rendered, result.missing.join('|'), result.error])

  if (!result.variables.length && !result.error) return null

  const inputFor = (variable: CommandSnippetVariable) => {
    const common = {
      size: 'xs' as const,
      value: values[variable.name] ?? '',
      placeholder: variable.tag === 'path' ? '/absolute/server/path' : `Enter ${variable.name}`,
      onChange: (value: string) => setValues((current) => ({ ...current, [variable.name]: value })),
    }
    if (variable.tag === 'user' && users.length) return <Select searchable data={users} {...common} onChange={(value) => common.onChange(value ?? '')} />
    if (variable.tag === 'group' && groups.length) return <Select searchable data={groups} {...common} onChange={(value) => common.onChange(value ?? '')} />
    return <TextInput {...common} onChange={(event) => common.onChange(event.currentTarget.value)} />
  }

  return <section className="command-snippet-template">
    <header><span><IconVariable size={14} /><strong>Template variables</strong></span>
      <Text size="xs" c="dimmed">Variables may be automatic or explicitly tagged.</Text></header>
    <div className="command-snippet-fields">
      {result.variables.map((variable) => <div className="command-snippet-field" key={variable.name}>
        <label>{variable.name}</label>
        <Select size="xs" value={tags[variable.name] ?? variable.tag} data={[
          { value: 'path', label: 'Path' }, { value: 'user', label: 'User' }, { value: 'group', label: 'Group' },
          { value: 'mode', label: 'Mode' }, { value: 'text', label: 'Text' },
        ]} onChange={(tag) => tag && setTags((current) => ({ ...current, [variable.name]: tag as CommandSnippetTag }))} />
        {inputFor({ ...variable, tag: tags[variable.name] ?? variable.tag })}
      </div>)}
    </div>
    {result.error && <div className="command-snippet-error">{result.error}</div>}
    {!result.error && result.missing.length > 0 && <div className="command-snippet-pending">Fill: {result.missing.join(', ')}</div>}
    {result.rendered && <div className="command-snippet-rendered">
      <div><strong>Rendered command</strong><Tooltip label={copied ? 'Copied' : 'Copy rendered command'}>
        <ActionIcon size="sm" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={() => {
          void navigator.clipboard.writeText(result.rendered!)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_500)
        }}>{copied ? <IconCheck size={13} /> : <IconCopy size={13} />}</ActionIcon></Tooltip></div>
      <pre>{result.rendered}</pre>
    </div>}
  </section>
}
