import { useMemo, useState } from 'react'
import { Alert, Badge, Group, SegmentedControl, Text, TextInput, Textarea } from '@mantine/core'
import { IconAlertTriangle, IconCode, IconForms, IconLayoutColumns } from '@tabler/icons-react'
import { parseApacheConfiguration, updateApacheDirective } from './apache-config-document'

type EditorView = 'raw' | 'gui' | 'hybrid' | 'diff'

export function ApacheConfigurationEditor({ original, value, onChange }: {
  original: string
  value: string
  onChange: (value: string) => void
}) {
  const [view, setView] = useState<EditorView>('hybrid')
  const document = useMemo(() => parseApacheConfiguration(value), [value])
  const directives = document.nodes.filter((node) => node.kind === 'directive' && node.recognized)
  const raw = <Textarea className="ssh-web-editor" autosize={false} value={value}
    onChange={(event) => onChange(event.currentTarget.value)} spellCheck={false} aria-label="Raw Apache configuration" />
  const gui = <div className="apache-gui-editor">
    {directives.length === 0 ? <div className="apache-gui-empty"><Text size="sm" fw={650}>No common directives recognized</Text><Text size="xs" c="dimmed">The raw source remains fully editable and will be preserved.</Text></div>
      : directives.map((node) => <div className="apache-directive-row" key={node.id}>
        <div className="apache-directive-label"><Group gap={6} wrap="nowrap"><Text size="xs" fw={700}>{node.name}</Text><Badge size="xs" variant="outline" color="gray">L{node.line}</Badge></Group>
          <Text size="xs" c="dimmed">{node.context.length ? node.context.join(' › ') : 'Global context'} · {node.valueKind}</Text></div>
        <TextInput value={node.value} onChange={(event) => onChange(updateApacheDirective(value, node, event.currentTarget.value))}
          aria-label={`${node.name} on line ${node.line}`} />
      </div>)}
    {document.unknownCount > 0 && <Alert color="gray" variant="light" mt="sm">
      {document.unknownCount} custom or module-specific directive{document.unknownCount === 1 ? '' : 's'} remain untouched in raw source.
    </Alert>}
  </div>
  const originalLines = original.split(/\r?\n/)
  const currentLines = value.split(/\r?\n/)
  const diff = <div className="apache-source-diff">
    <section><header>Saved source</header>{originalLines.map((line, index) => <div key={index} data-changed={line !== currentLines[index] || undefined}><span>{index + 1}</span><code>{line || ' '}</code></div>)}</section>
    <section><header>Pending source</header>{currentLines.map((line, index) => <div key={index} data-changed={line !== originalLines[index] || undefined}><span>{index + 1}</span><code>{line || ' '}</code></div>)}</section>
  </div>

  return <div className="apache-config-editor-shell">
    <Group justify="space-between" gap="sm" wrap="wrap" mb="sm">
      <SegmentedControl size="xs" value={view} onChange={(next) => setView(next as EditorView)} data={[
        { value: 'raw', label: <Group gap={5}><IconCode size={13} />Raw</Group> },
        { value: 'gui', label: <Group gap={5}><IconForms size={13} />GUI</Group> },
        { value: 'hybrid', label: <Group gap={5}><IconLayoutColumns size={13} />Hybrid</Group> },
        { value: 'diff', label: 'Diff' },
      ]} />
      <Group gap={6}><Badge size="xs" color="teal">{document.recognizedCount} recognized</Badge>
        <Badge size="xs" color={document.unknownCount ? 'gray' : 'teal'}>{document.unknownCount} preserved custom</Badge>
        <Badge size="xs" color={document.diagnostics.some((item) => item.level === 'error') ? 'red' : 'gray'}>{document.diagnostics.length} diagnostics</Badge></Group>
    </Group>
    {document.diagnostics.length > 0 && <Alert mb="sm" color={document.diagnostics.some((item) => item.level === 'error') ? 'yellow' : 'gray'} icon={<IconAlertTriangle size={16} />}>
      {document.diagnostics.slice(0, 3).map((item) => <div key={`${item.line}:${item.message}`}>Line {item.line}: {item.message}</div>)}
    </Alert>}
    {view === 'raw' ? raw : view === 'gui' ? gui : view === 'diff' ? diff
      : <div className="apache-hybrid-editor"><section>{raw}</section><section>{gui}</section></div>}
  </div>
}
