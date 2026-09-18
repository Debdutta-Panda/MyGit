import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Group,
  SegmentedControl,
  Select,
  Tabs,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { IconChevronRight, IconColumns3, IconList, IconSchema, IconSearch } from '@tabler/icons-react'

interface SqlReference {
  table: string
  column: string | null
}

interface SqlColumn {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue: string | null
  reference: SqlReference | null
}

interface SqlTable {
  name: string
  columns: SqlColumn[]
}

const cleanIdentifier = (value: string): string => value
  .trim()
  .split(/\s*\.\s*/)
  .map((part) => part.replace(/^(?:"|`|\[)|(?:"|`|\])$/g, ''))
  .join('.')

const identifierPattern = String.raw`(?:"[^"]+"|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|[\w$]+)`

const splitSqlList = (value: string): string[] => {
  const items: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (quote === ']' && character === ']') quote = ''
      else if (character === quote) {
        if (value[index + 1] === quote) index += 1
        else quote = ''
      } else if (character === '\\') index += 1
      continue
    }
    if (character === "'" || character === '"' || character === '`') quote = character
    else if (character === '[') quote = ']'
    else if (character === '(') depth += 1
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === ',' && depth === 0) {
      items.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  const last = value.slice(start).trim()
  if (last) items.push(last)
  return items
}

const closingParenthesis = (value: string, start: number): number => {
  let depth = 0
  let quote = ''
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (quote === ']' && character === ']') quote = ''
      else if (character === quote) {
        if (value[index + 1] === quote) index += 1
        else quote = ''
      } else if (character === '\\') index += 1
      continue
    }
    if (character === "'" || character === '"' || character === '`') quote = character
    else if (character === '[') quote = ']'
    else if (character === '(') depth += 1
    else if (character === ')' && --depth === 0) return index
  }
  return -1
}

const identifierList = (value: string): string[] => splitSqlList(value)
  .map(cleanIdentifier)
  .filter(Boolean)

const parseSqlSchema = (sql: string): SqlTable[] => {
  const source = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
  const tablePattern = new RegExp(
    String.raw`\bcreate\s+(?:(?:temporary|temp)\s+)?table\s+(?:if\s+not\s+exists\s+)?(${identifierPattern}(?:\s*\.\s*${identifierPattern})?)\s*\(`,
    'gi',
  )
  const tables: SqlTable[] = []
  let match: RegExpExecArray | null
  while ((match = tablePattern.exec(source))) {
    const openingIndex = tablePattern.lastIndex - 1
    const closingIndex = closingParenthesis(source, openingIndex)
    if (closingIndex < 0) continue
    const entries = splitSqlList(source.slice(openingIndex + 1, closingIndex))
    const columns: SqlColumn[] = []
    const primaryKeys = new Set<string>()
    const references = new Map<string, SqlReference>()

    for (const entry of entries) {
      const normalized = entry.replace(/^constraint\s+\S+\s+/i, '').trim()
      const primaryMatch = normalized.match(/^primary\s+key\s*\(([^)]+)\)/i)
      if (primaryMatch) {
        for (const name of identifierList(primaryMatch[1])) primaryKeys.add(name.toLowerCase())
        continue
      }
      const foreignMatch = normalized.match(new RegExp(
        String.raw`^foreign\s+key\s*\(([^)]+)\)\s+references\s+(${identifierPattern}(?:\s*\.\s*${identifierPattern})?)(?:\s*\(([^)]+)\))?`,
        'i',
      ))
      if (foreignMatch) {
        const localColumns = identifierList(foreignMatch[1])
        const targetColumns = foreignMatch[3] ? identifierList(foreignMatch[3]) : []
        localColumns.forEach((name, index) => references.set(name.toLowerCase(), {
          table: cleanIdentifier(foreignMatch[2]),
          column: targetColumns[index] ?? targetColumns[0] ?? null,
        }))
        continue
      }
      if (/^(?:unique|check|exclude|key|index)\b/i.test(normalized)) continue
      const columnMatch = normalized.match(new RegExp(`^(${identifierPattern})\\s+([\\s\\S]+)$`, 'i'))
      if (!columnMatch) continue
      const definition = columnMatch[2].trim()
      const modifierIndex = definition.search(/\s+(?:constraint|primary\s+key|not\s+null|null|default|references|unique|check|collate|generated|identity)\b/i)
      const type = (modifierIndex < 0 ? definition : definition.slice(0, modifierIndex)).trim()
      const inlineReference = definition.match(new RegExp(
        String.raw`\breferences\s+(${identifierPattern}(?:\s*\.\s*${identifierPattern})?)(?:\s*\(\s*(${identifierPattern})\s*\))?`,
        'i',
      ))
      const defaultMatch = definition.match(/\bdefault\s+((?:'[^']*(?:''[^']*)*'|"[^"]*"|[^\s,]+))/i)
      columns.push({
        name: cleanIdentifier(columnMatch[1]),
        type: type || 'unknown',
        nullable: !/\bnot\s+null\b/i.test(definition) && !/\bprimary\s+key\b/i.test(definition),
        primaryKey: /\bprimary\s+key\b/i.test(definition),
        defaultValue: defaultMatch?.[1] ?? null,
        reference: inlineReference ? {
          table: cleanIdentifier(inlineReference[1]),
          column: inlineReference[2] ? cleanIdentifier(inlineReference[2]) : null,
        } : null,
      })
    }
    for (const column of columns) {
      if (primaryKeys.has(column.name.toLowerCase())) {
        column.primaryKey = true
        column.nullable = false
      }
      column.reference ??= references.get(column.name.toLowerCase()) ?? null
    }
    tables.push({ name: cleanIdentifier(match[1]), columns })
    tablePattern.lastIndex = closingIndex + 1
  }
  return tables
}

interface DiagramPosition {
  x: number
  y: number
  width: number
  height: number
}

const diagramLayout = (tables: SqlTable[]): {
  positions: Map<string, DiagramPosition>
  width: number
  height: number
} => {
  const columns = Math.max(1, Math.ceil(Math.sqrt(tables.length)))
  const cardWidth = 390
  const horizontalGap = 120
  const verticalGap = 72
  const positions = new Map<string, DiagramPosition>()
  let y = 36
  for (let start = 0; start < tables.length; start += columns) {
    const row = tables.slice(start, start + columns)
    const rowHeight = Math.max(...row.map((table) => 78 + Math.min(12, table.columns.length) * 25 +
      (table.columns.length > 12 ? 25 : 0)))
    row.forEach((table, index) => {
      const position = {
        x: 36 + index * (cardWidth + horizontalGap),
        y,
        width: cardWidth,
        height: rowHeight,
      }
      positions.set(table.name.toLowerCase(), position)
      const shortName = table.name.split('.').at(-1)?.toLowerCase()
      if (shortName && !positions.has(shortName)) positions.set(shortName, position)
    })
    y += rowHeight + verticalGap
  }
  return {
    positions,
    width: 72 + columns * cardWidth + Math.max(0, columns - 1) * horizontalGap,
    height: y - verticalGap + 36,
  }
}

export function SqlSchemaPreview({ sql }: { sql: string }) {
  const [tab, setTab] = useState<string | null>('tables')
  const [fieldSearch, setFieldSearch] = useState('')
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null)
  const [diagramTableName, setDiagramTableName] = useState<string | null>(null)
  const [diagramScope, setDiagramScope] = useState<'related' | 'all'>('related')
  const tables = useMemo(() => parseSqlSchema(sql), [sql])
  const fieldCount = tables.reduce((total, table) => total + table.columns.length, 0)
  const filteredFieldTables = useMemo(() => {
    const query = fieldSearch.trim().toLowerCase()
    if (!query) return tables
    return tables.filter((table) => table.name.toLowerCase().includes(query))
  }, [fieldSearch, tables])
  const selectedFieldTable = filteredFieldTables.find((table) => table.name === selectedTableName) ??
    filteredFieldTables[0] ?? null
  const selectedDiagramTable = tables.find((table) => table.name === diagramTableName) ??
    tables[0] ?? null
  const findReferencedTable = (referenceName: string): SqlTable | null => {
    const normalized = referenceName.toLowerCase()
    const shortName = normalized.split('.').at(-1)
    return tables.find((table) => {
      const tableName = table.name.toLowerCase()
      return tableName === normalized || tableName.split('.').at(-1) === shortName
    }) ?? null
  }
  const relatedTableNames = useMemo(() => {
    if (!selectedDiagramTable) return new Set<string>()
    const names = new Set([selectedDiagramTable.name])
    for (const column of selectedDiagramTable.columns) {
      if (!column.reference) continue
      const target = findReferencedTable(column.reference.table)
      if (target) names.add(target.name)
    }
    for (const table of tables) {
      if (table.columns.some((column) => column.reference &&
        findReferencedTable(column.reference.table)?.name === selectedDiagramTable.name)) {
        names.add(table.name)
      }
    }
    return names
  }, [selectedDiagramTable, tables])
  const diagramTables = diagramScope === 'all'
    ? tables
    : tables.filter((table) => relatedTableNames.has(table.name))
  const layout = useMemo(() => diagramLayout(diagramTables), [diagramTables])
  const diagramRelationships = useMemo(() => {
    if (!selectedDiagramTable) return []
    const visibleNames = new Set(diagramTables.map((table) => table.name))
    return tables.flatMap((table) => table.columns.flatMap((column) => {
      if (!column.reference) return []
      const target = findReferencedTable(column.reference.table)
      if (!target || !visibleNames.has(table.name) || !visibleNames.has(target.name)) return []
      if (table.name !== selectedDiagramTable.name && target.name !== selectedDiagramTable.name) return []
      return [{ table, column, target }]
    }))
  }, [diagramTables, selectedDiagramTable, tables])

  useEffect(() => {
    if (selectedFieldTable && selectedFieldTable.name !== selectedTableName) {
      setSelectedTableName(selectedFieldTable.name)
    }
  }, [selectedFieldTable, selectedTableName])

  useEffect(() => {
    if (selectedDiagramTable && selectedDiagramTable.name !== diagramTableName) {
      setDiagramTableName(selectedDiagramTable.name)
    }
  }, [diagramTableName, selectedDiagramTable])

  if (tables.length === 0) {
    return (
      <div className="sql-preview-empty">
        <IconSchema size={34} stroke={1.35} />
        <Text fw={650}>No CREATE TABLE statements found</Text>
        <Text size="xs" c="dimmed">This preview visualizes SQL schema definitions without executing them.</Text>
      </div>
    )
  }

  return (
    <div className="sql-preview">
      <div className="sql-preview-toolbar">
        <Tabs value={tab} onChange={setTab} variant="outline">
          <Tabs.List>
            <Tabs.Tab value="tables" leftSection={<IconList size={14} />}>Tables</Tabs.Tab>
            <Tabs.Tab value="fields" leftSection={<IconColumns3 size={14} />}>Fields</Tabs.Tab>
            <Tabs.Tab value="diagram" leftSection={<IconSchema size={14} />}>Diagram</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Group gap={6} wrap="nowrap">
          <Badge size="sm" variant="light" color="teal">{tables.length} tables</Badge>
          <Badge size="sm" variant="light" color="gray">{fieldCount} fields</Badge>
        </Group>
      </div>

      {tab === 'tables' && (
        <div className="sql-table-list">
          {tables.map((table, index) => (
            <div className="sql-table-list-row" key={table.name}>
              <span className="sql-table-number">{index + 1}</span>
              <IconSchema size={17} />
              <strong>{table.name}</strong>
              <Badge size="xs" variant="outline" color="gray">
                {table.columns.length} {table.columns.length === 1 ? 'field' : 'fields'}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {tab === 'fields' && (
        <div className="sql-fields-view">
          <aside className="sql-fields-sidebar">
            <div className="sql-fields-search">
              <TextInput
                size="xs"
                value={fieldSearch}
                leftSection={<IconSearch size={14} />}
                placeholder="Filter tables"
                aria-label="Filter SQL tables"
                onChange={(event) => setFieldSearch(event.currentTarget.value)}
              />
              <Text size="xs" c="dimmed">{filteredFieldTables.length} of {tables.length} tables</Text>
            </div>
            <div className="sql-fields-table-nav">
              {filteredFieldTables.map((table) => (
                <UnstyledButton
                  className="sql-fields-table-option"
                  data-selected={selectedFieldTable?.name === table.name || undefined}
                  key={table.name}
                  onClick={() => setSelectedTableName(table.name)}
                >
                  <IconSchema size={15} />
                  <span title={table.name}>{table.name}</span>
                  <small>{table.columns.length}</small>
                  <IconChevronRight size={13} />
                </UnstyledButton>
              ))}
              {filteredFieldTables.length === 0 && (
                <div className="sql-fields-no-results">No matching tables</div>
              )}
            </div>
          </aside>
          <main className="sql-fields-detail">
            {selectedFieldTable ? (
            <section className="sql-fields-table" key={selectedFieldTable.name}>
              <header>
                <IconSchema size={17} />
                <strong>{selectedFieldTable.name}</strong>
                <Badge size="xs" variant="light" color="gray">
                  {selectedFieldTable.columns.length} fields
                </Badge>
              </header>
              <div className="sql-field-row sql-field-head">
                <span>Field</span><span>Type</span><span>Rules</span><span>Reference / default</span>
              </div>
              {selectedFieldTable.columns.map((column) => (
                <div className="sql-field-row" key={column.name}>
                  <strong>{column.name}</strong>
                  <code>{column.type}</code>
                  <span className="sql-field-rules">
                    {column.primaryKey && <Badge size="xs" color="yellow">PK</Badge>}
                    {!column.nullable && <Badge size="xs" variant="light" color="blue">NOT NULL</Badge>}
                    {column.reference && <Badge size="xs" variant="light" color="violet">FK</Badge>}
                  </span>
                  <span>{column.reference
                    ? `→ ${column.reference.table}${column.reference.column ? `.${column.reference.column}` : ''}`
                    : column.defaultValue ? `DEFAULT ${column.defaultValue}` : '—'}</span>
                </div>
              ))}
            </section>
            ) : (
              <div className="sql-fields-no-selection">
                <IconSearch size={28} stroke={1.4} />
                <Text size="sm" fw={650}>No matching table</Text>
                <Text size="xs" c="dimmed">Change the table filter to inspect its fields.</Text>
              </div>
            )}
          </main>
        </div>
      )}

      {tab === 'diagram' && (
        <div className="sql-diagram-view">
          <div className="sql-diagram-toolbar">
            <Select
              size="xs"
              searchable
              value={selectedDiagramTable?.name ?? null}
              data={tables.map((table) => ({ value: table.name, label: table.name }))}
              leftSection={<IconSearch size={14} />}
              placeholder="Focus a table"
              aria-label="Focus a table in the SQL diagram"
              onChange={setDiagramTableName}
            />
            <SegmentedControl
              size="xs"
              value={diagramScope}
              data={[
                { value: 'related', label: 'Related tables' },
                { value: 'all', label: 'All tables' },
              ]}
              onChange={(value) => setDiagramScope(value as 'related' | 'all')}
            />
            <Text size="xs" c="dimmed" truncate>
              Showing {diagramTables.length} tables · {diagramRelationships.length} direct relationships
            </Text>
            <Group gap={10} wrap="nowrap" className="sql-diagram-legend">
              <span data-kind="outgoing">Outgoing FK</span>
              <span data-kind="incoming">Incoming FK</span>
            </Group>
          </div>
          <div className="sql-diagram-viewport">
            <div className="sql-diagram-canvas" style={{ width: layout.width, height: layout.height }}>
              <svg className="sql-diagram-links" width={layout.width} height={layout.height}>
                <defs>
                  <marker id="sql-reference-outgoing" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                    <path d="M0,0 L9,4.5 L0,9 Z" fill="#20c997" />
                  </marker>
                  <marker id="sql-reference-incoming" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                    <path d="M0,0 L9,4.5 L0,9 Z" fill="#ff922b" />
                  </marker>
                </defs>
                {diagramRelationships.map(({ table, column, target }) => {
                  const from = layout.positions.get(table.name.toLowerCase())
                  const to = layout.positions.get(target.name.toLowerCase())
                  if (!from || !to) return null
                  const fromColumnIndex = table.columns.indexOf(column)
                  const targetColumnIndex = column.reference?.column
                    ? target.columns.findIndex((candidate) =>
                        candidate.name.toLowerCase() === column.reference?.column?.toLowerCase())
                    : -1
                  const fromY = from.y + 38 + Math.min(12, Math.max(0, fromColumnIndex)) * 25 + 12
                  const toY = to.y + 38 + Math.min(12, Math.max(0, targetColumnIndex)) * 25 + 12
                  const travelsRight = from.x <= to.x
                  const fromX = travelsRight ? from.x + from.width : from.x
                  const toX = travelsRight ? to.x : to.x + to.width
                  const bend = Math.max(55, Math.abs(toX - fromX) * 0.34)
                  const outgoing = table.name === selectedDiagramTable?.name
                  const color = outgoing ? '#20c997' : '#ff922b'
                  return (
                    <path
                      className="sql-diagram-relationship"
                      key={`${table.name}.${column.name}-${target.name}.${column.reference?.column ?? ''}`}
                      d={`M ${fromX} ${fromY} C ${fromX + (travelsRight ? bend : -bend)} ${fromY}, ${toX + (travelsRight ? -bend : bend)} ${toY}, ${toX} ${toY}`}
                      fill="none"
                      stroke={color}
                      strokeWidth="2.4"
                      markerEnd={`url(#sql-reference-${outgoing ? 'outgoing' : 'incoming'})`}
                    >
                      <title>{`${table.name}.${column.name} → ${target.name}.${column.reference?.column ?? '?'}`}</title>
                    </path>
                  )
                })}
              </svg>
              {diagramTables.map((table) => {
                const position = layout.positions.get(table.name.toLowerCase())!
                const selected = table.name === selectedDiagramTable?.name
                return (
                  <button
                    type="button"
                    className="sql-diagram-table"
                    data-selected={selected || undefined}
                    key={table.name}
                    style={{ left: position.x, top: position.y, width: position.width, minHeight: position.height }}
                    onClick={() => setDiagramTableName(table.name)}
                  >
                    <header>
                      <IconSchema size={16} />
                      <strong title={table.name}>{table.name}</strong>
                      {selected && <Badge size="xs" color="teal">Focused</Badge>}
                    </header>
                    {table.columns.slice(0, 12).map((column) => (
                      <div className="sql-diagram-field" key={column.name}>
                        <span>{column.primaryKey ? '◆' : column.reference ? '◇' : ''}</span>
                        <strong title={column.name}>{column.name}</strong>
                        <code title={column.type}>{column.type}</code>
                      </div>
                    ))}
                    {table.columns.length > 12 && (
                      <div className="sql-diagram-more">+{table.columns.length - 12} more fields</div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
