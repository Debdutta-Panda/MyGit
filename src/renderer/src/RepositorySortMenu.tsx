import { ActionIcon, Menu, Text } from '@mantine/core'
import {
  IconArrowDown,
  IconArrowsSort,
  IconArrowUp,
  IconChevronsDown,
  IconChevronsUp,
  IconPlus,
  IconX,
} from '@tabler/icons-react'

export interface SortRule<Field extends string> {
  field: Field
  direction: 'asc' | 'desc'
}

interface Props<Field extends string> {
  rules: SortRule<Field>[]
  fields: Field[]
  labels: Record<Field, string>
  onChange: (rules: SortRule<Field>[]) => void
}

export function RepositorySortMenu<Field extends string>({
  rules,
  fields,
  labels,
  onChange,
}: Props<Field>) {
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const add = (field: Field) => onChange([...rules, {
    field,
    direction: ['attention', 'updated', 'sync'].includes(field) ? 'desc' : 'asc',
  }])

  const isSavedOrder = rules.length === 1 &&
    rules[0]?.field === fields[0] &&
    rules[0]?.direction === 'asc'

  return (
    <Menu position="bottom-end" shadow="xl" width={380} closeOnItemClick={false} withinPortal>
      <Menu.Target>
        <ActionIcon
          className="repository-toolbar-icon"
          size="lg"
          color={isSavedOrder ? 'gray' : 'teal'}
          variant={isSavedOrder ? 'subtle' : 'light'}
          aria-label={rules.length > 1
            ? 'Sort repositories using ' + rules.length + ' fields'
            : 'Sort repositories'}
          title={rules.length > 1
            ? 'Sort repositories - ' + rules.length + ' fields'
            : 'Sort repositories'}
        >
          <IconArrowsSort size={17} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown className="repository-sort-menu">
        <Menu.Label>Sort priority - top rule first</Menu.Label>
        <div className="repository-sort-rules">
          {rules.map((rule, index) => (
            <div className="repository-sort-rule" key={rule.field}>
              <span className="repository-sort-priority">{index + 1}</span>
              <Text size="xs" fw={650}>{labels[rule.field]}</Text>
              <div className="repository-sort-row-actions">
                <ActionIcon
                  size="sm"
                  variant="light"
                  color="teal"
                  aria-label="Reverse sort direction"
                  title={rule.direction === 'asc' ? 'Ascending' : 'Descending'}
                  onClick={() => onChange(rules.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' }
                      : item))}
                >
                  {rule.direction === 'asc'
                    ? <IconArrowUp size={14} />
                    : <IconArrowDown size={14} />}
                </ActionIcon>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label="Increase sort priority"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <IconChevronsUp size={14} />
                </ActionIcon>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label="Decrease sort priority"
                  disabled={index === rules.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <IconChevronsDown size={14} />
                </ActionIcon>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  aria-label="Remove sort field"
                  onClick={() => onChange(rules.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <IconX size={14} />
                </ActionIcon>
              </div>
            </div>
          ))}
        </div>
        <Menu.Divider />
        <Menu.Label>Add field</Menu.Label>
        {fields
          .filter((field) => !rules.some((rule) => rule.field === field))
          .map((field) => (
            <Menu.Item
              key={field}
              leftSection={<IconPlus size={13} />}
              onClick={() => add(field)}
            >
              {labels[field]}
            </Menu.Item>
          ))}
        <Menu.Divider />
        <Menu.Item onClick={() => onChange([{ field: fields[0], direction: 'asc' }])}>
          Reset to saved order
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
