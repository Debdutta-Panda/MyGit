import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, MultiSelect, Select, Tabs, Text } from '@mantine/core'
import { IconAlertCircle, IconChartBar, IconRefresh, IconTable } from '@tabler/icons-react'
import type {
  RepositoryAnalyticsRange,
  RepositoryChangeAnalytics as AnalyticsData,
} from '../../shared/desktop-api'
import { RepositoryChangeAnalytics } from './RepositoryChangeAnalytics'

export interface PortfolioAnalyticsRepository {
  key: string
  name: string
  color?: string | null
  data: AnalyticsData | null
  error: string | null
}

const fullNumber = new Intl.NumberFormat()
const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export function RepositoryPortfolioAnalytics({
  repositories,
  loading,
  range,
  onRangeChange,
  onRefresh,
}: {
  repositories: PortfolioAnalyticsRepository[]
  loading: boolean
  range: RepositoryAnalyticsRange
  onRangeChange: (range: RepositoryAnalyticsRange) => void
  onRefresh: () => void
}) {
  const [view, setView] = useState<string | null>('aggregate')
  const repositorySignature = repositories.map((repository) => repository.key).join('\u0000')
  const [selectedRepositoryKeys, setSelectedRepositoryKeys] = useState<string[]>([])
  useEffect(() => {
    setSelectedRepositoryKeys(repositories.map((repository) => repository.key))
  }, [repositorySignature])
  const scopedRepositories = repositories.filter((repository) => selectedRepositoryKeys.includes(repository.key))
  const available = scopedRepositories.filter((repository) => repository.data)
  const failed = scopedRepositories.filter((repository) => repository.error)
  const combined = useMemo<AnalyticsData | null>(() => {
    if (available.length === 0) return null
    const commits = available.flatMap((repository) => (repository.data?.commits ?? []).map((commit) => ({
      ...commit,
      hash: `${repository.key}:${commit.hash}`,
      subject: `${repository.name} · ${commit.subject}`,
      files: commit.files.map((file) => ({ ...file, path: `${repository.name}/${file.path}` })),
    }))).sort((left, right) => Date.parse(right.committedAt) - Date.parse(left.committedAt))
    return {
      range,
      truncated: available.some((repository) => repository.data?.truncated),
      maxCommits: available.reduce((sum, repository) => sum + (repository.data?.maxCommits ?? 0), 0),
      commits,
    }
  }, [available, range])
  const rows = scopedRepositories.map((repository) => {
    const commits = repository.data?.commits ?? []
    const files = new Set<string>()
    const contributors = new Set<string>()
    let additions = 0
    let deletions = 0
    for (const commit of commits) {
      contributors.add(commit.authorEmail || commit.author)
      for (const file of commit.files) {
        files.add(file.path)
        additions += file.additions
        deletions += file.deletions
      }
    }
    return { repository, commits: commits.length, files: files.size, contributors: contributors.size, additions, deletions, churn: additions + deletions }
  })
  const maxChurn = Math.max(1, ...rows.map((row) => row.churn))

  return (
    <section className="portfolio-analytics">
      <div className="portfolio-analytics-header">
        <Tabs value={view} onChange={setView}>
          <Tabs.List>
            <Tabs.Tab value="aggregate" leftSection={<IconChartBar size={14} />}>Aggregate</Tabs.Tab>
            <Tabs.Tab value="repositories" leftSection={<IconTable size={14} />}>Repositories</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Group gap={8} wrap="nowrap">
          <MultiSelect
            className="portfolio-repository-filter"
            size="xs"
            value={selectedRepositoryKeys}
            data={repositories.map((repository) => ({ value: repository.key, label: repository.name }))}
            placeholder="Select repositories"
            aria-label="Repositories included in analytics"
            searchable
            clearable
            onChange={setSelectedRepositoryKeys}
          />
          <Badge variant="light" color="teal">{available.length}/{scopedRepositories.length} available</Badge>
          {loading && <Loader size={15} />}
        </Group>
      </div>

      {failed.length > 0 && (
        <Alert className="portfolio-analytics-alert" color="yellow" icon={<IconAlertCircle size={16} />}>
          {failed.length} {failed.length === 1 ? 'repository is' : 'repositories are'} unavailable. Open the Repositories view for details.
        </Alert>
      )}

      {view === 'aggregate' ? (
        <RepositoryChangeAnalytics
          data={combined}
          loading={loading}
          error={!loading && available.length === 0 ? 'No repository analytics could be loaded.' : null}
          range={range}
          onRangeChange={onRangeChange}
          onRefresh={onRefresh}
        />
      ) : (
        <div className="portfolio-comparison">
          <div className="portfolio-comparison-toolbar">
            <div>
              <Text fw={700}>Repository comparison</Text>
              <Text size="xs" c="dimmed">Exact contribution to the selected portfolio and time range</Text>
            </div>
            <Group gap={8} wrap="nowrap">
              <Select
                size="xs"
                value={range}
                allowDeselect={false}
                data={[
                  { value: '7d', label: 'Last 7 days' },
                  { value: '30d', label: 'Last 30 days' },
                  { value: '90d', label: 'Last 90 days' },
                  { value: '1y', label: 'Last year' },
                  { value: 'all', label: 'All history' },
                ]}
                onChange={(value) => value && onRangeChange(value as RepositoryAnalyticsRange)}
              />
              <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconRefresh size={14} />} loading={loading} onClick={onRefresh}>Refresh</Button>
            </Group>
          </div>
          <div className="portfolio-comparison-scroll">
            <table>
              <thead><tr><th>Repository</th><th>Status</th><th>Commits</th><th>Contributors</th><th>Files</th><th>Additions</th><th>Deletions</th><th>Net</th><th>Churn</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.repository.key}>
                    <th scope="row"><i style={{ background: row.repository.color ?? '#20c997' }} /><span title={row.repository.name}>{row.repository.name}</span><em><b style={{ width: `${row.churn / maxChurn * 100}%` }} /></em></th>
                    <td>{row.repository.error
                      ? <Badge size="xs" color="yellow">Unavailable</Badge>
                      : row.repository.data
                        ? <Badge size="xs" color="teal">Ready</Badge>
                        : <Badge size="xs" color="gray">Loading</Badge>}</td>
                    <td>{fullNumber.format(row.commits)}</td>
                    <td>{fullNumber.format(row.contributors)}</td>
                    <td>{fullNumber.format(row.files)}</td>
                    <td data-tone="positive">+{fullNumber.format(row.additions)}</td>
                    <td data-tone="negative">−{fullNumber.format(row.deletions)}</td>
                    <td data-tone={row.additions - row.deletions >= 0 ? 'positive' : 'negative'}>{row.additions - row.deletions >= 0 ? '+' : '−'}{fullNumber.format(Math.abs(row.additions - row.deletions))}</td>
                    <td>{compactNumber.format(row.churn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {failed.map((repository) => <p className="portfolio-repository-error" key={repository.key}><strong>{repository.name}</strong>{repository.error}</p>)}
          </div>
        </div>
      )}
    </section>
  )
}
