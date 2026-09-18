import { useMemo, useState, type ReactNode } from 'react'
import { Alert, Badge, Button, Group, Loader, SegmentedControl, Select, Text } from '@mantine/core'
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconChartBar,
  IconFileCode,
  IconFolder,
  IconGitCommit,
  IconRefresh,
  IconUsers,
} from '@tabler/icons-react'
import type {
  RepositoryAnalyticsRange,
  RepositoryChangeAnalytics as AnalyticsData,
  RepositoryChangeCommit,
} from '../../shared/desktop-api'

type AnalyticsGrouping = 'commit' | 'day' | 'week' | 'month'

interface ActivityBucket {
  key: string
  label: string
  title: string
  additions: number
  deletions: number
  commits: number
  files: Set<string>
}

interface RankedChange {
  name: string
  additions: number
  deletions: number
  commits: number
  churn: number
}

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const fullNumber = new Intl.NumberFormat()

const dateKey = (value: string, grouping: AnalyticsGrouping): { key: string; label: string } => {
  const date = new Date(value)
  if (grouping === 'day') {
    const key = date.toISOString().slice(0, 10)
    return { key, label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
  }
  if (grouping === 'week') {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const day = start.getUTCDay() || 7
    start.setUTCDate(start.getUTCDate() - day + 1)
    return {
      key: start.toISOString().slice(0, 10),
      label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    }
  }
  const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  return { key, label: date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) }
}

const activityBuckets = (
  commits: RepositoryChangeCommit[],
  grouping: AnalyticsGrouping,
): ActivityBucket[] => {
  if (grouping === 'commit') {
    return commits.slice(0, 120).reverse().map((commit) => ({
      key: commit.hash,
      label: commit.shortHash,
      title: `${commit.shortHash} · ${commit.subject}`,
      additions: commit.files.reduce((total, file) => total + file.additions, 0),
      deletions: commit.files.reduce((total, file) => total + file.deletions, 0),
      commits: 1,
      files: new Set(commit.files.map((file) => file.path)),
    }))
  }
  const buckets = new Map<string, ActivityBucket>()
  for (const commit of [...commits].reverse()) {
    const period = dateKey(commit.committedAt, grouping)
    const bucket = buckets.get(period.key) ?? {
      key: period.key,
      label: period.label,
      title: period.key,
      additions: 0,
      deletions: 0,
      commits: 0,
      files: new Set<string>(),
    }
    bucket.commits += 1
    for (const file of commit.files) {
      bucket.additions += file.additions
      bucket.deletions += file.deletions
      bucket.files.add(file.path)
    }
    buckets.set(period.key, bucket)
  }
  return [...buckets.values()]
}

const rankChanges = (
  commits: RepositoryChangeCommit[],
  nameForPath: (path: string) => string,
): RankedChange[] => {
  const values = new Map<string, RankedChange>()
  for (const commit of commits) {
    const touched = new Set<string>()
    for (const file of commit.files) {
      const name = nameForPath(file.path)
      const value = values.get(name) ?? { name, additions: 0, deletions: 0, commits: 0, churn: 0 }
      value.additions += file.additions
      value.deletions += file.deletions
      value.churn += file.additions + file.deletions
      if (!touched.has(name)) value.commits += 1
      touched.add(name)
      values.set(name, value)
    }
  }
  return [...values.values()].sort((left, right) => right.churn - left.churn)
}

function ChangeChart({ buckets }: { buckets: ActivityBucket[] }) {
  const width = 1_000
  const height = 260
  const baseline = 126
  const plotHeight = 104
  const maxValue = Math.max(1, ...buckets.flatMap((bucket) => [bucket.additions, bucket.deletions]))
  const slot = width / Math.max(1, buckets.length)
  const barWidth = Math.max(1.5, Math.min(15, slot * 0.62))
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 10))

  return (
    <div className="change-chart-scroll">
      <svg
        className="change-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Additions and deletions over time"
        preserveAspectRatio="xMidYMid meet"
      >
        <line x1="0" y1={baseline} x2={width} y2={baseline} className="change-chart-baseline" />
        {buckets.map((bucket, index) => {
          const x = index * slot + (slot - barWidth) / 2
          const additionHeight = bucket.additions / maxValue * plotHeight
          const deletionHeight = bucket.deletions / maxValue * plotHeight
          return (
            <g key={bucket.key}>
              <title>{`${bucket.title}: +${fullNumber.format(bucket.additions)} −${fullNumber.format(bucket.deletions)} · ${bucket.commits} commits · ${bucket.files.size} files`}</title>
              <rect x={x} y={baseline - additionHeight} width={barWidth} height={additionHeight} rx="1.5" className="change-chart-additions" />
              <rect x={x} y={baseline + 1} width={barWidth} height={deletionHeight} rx="1.5" className="change-chart-deletions" />
              {(index % labelEvery === 0 || index === buckets.length - 1) && (
                <text x={x + barWidth / 2} y="252" textAnchor="middle">{bucket.label}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function RankingList({
  title,
  icon,
  values,
  onSelect,
}: {
  title: string
  icon: ReactNode
  values: RankedChange[]
  onSelect?: (name: string) => void
}) {
  const visible = values.slice(0, 12)
  const max = Math.max(1, ...visible.map((value) => value.churn))
  return (
    <section className="change-ranking-panel">
      <header>{icon}<Text fw={700}>{title}</Text><Badge size="xs" variant="light" color="gray">Top {visible.length}</Badge></header>
      <div className="change-ranking-list">
        {visible.map((value, index) => (
          <button
            type="button"
            className="change-ranking-row"
            disabled={!onSelect}
            key={value.name}
            onClick={() => onSelect?.(value.name)}
          >
            <span className="change-ranking-number">{index + 1}</span>
            <span className="change-ranking-name" title={value.name}>{value.name}</span>
            <span className="change-ranking-stats">
              <strong>+{compactNumber.format(value.additions)}</strong>
              <em>−{compactNumber.format(value.deletions)}</em>
              <small>{value.commits} commits</small>
            </span>
            <span className="change-ranking-bar"><i style={{ width: `${value.churn / max * 100}%` }} /></span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function RepositoryChangeAnalytics({
  data,
  loading,
  error,
  range,
  onRangeChange,
  onRefresh,
  onOpenFile,
}: {
  data: AnalyticsData | null
  loading: boolean
  error: string | null
  range: RepositoryAnalyticsRange
  onRangeChange: (range: RepositoryAnalyticsRange) => void
  onRefresh: () => void
  onOpenFile: (path: string) => void
}) {
  const [grouping, setGrouping] = useState<AnalyticsGrouping>('week')
  const commits = data?.commits ?? []
  const buckets = useMemo(() => activityBuckets(commits, grouping), [commits, grouping])
  const files = useMemo(() => rankChanges(commits, (path) => path), [commits])
  const folders = useMemo(() => rankChanges(commits, (path) => {
    const slash = path.lastIndexOf('/')
    return slash > 0 ? path.slice(0, slash) : '(repository root)'
  }), [commits])
  const contributors = useMemo(() => {
    const values = new Map<string, RankedChange>()
    for (const commit of commits) {
      const key = commit.authorEmail || commit.author
      const value = values.get(key) ?? {
        name: commit.author,
        additions: 0,
        deletions: 0,
        commits: 0,
        churn: 0,
      }
      value.commits += 1
      for (const file of commit.files) {
        value.additions += file.additions
        value.deletions += file.deletions
        value.churn += file.additions + file.deletions
      }
      values.set(key, value)
    }
    return [...values.values()].sort((left, right) => right.churn - left.churn)
  }, [commits])
  const totals = useMemo(() => commits.reduce((summary, commit) => {
    summary.commits += 1
    for (const file of commit.files) {
      summary.additions += file.additions
      summary.deletions += file.deletions
      summary.files.add(file.path)
      if (file.binary) summary.binary.add(file.path)
    }
    return summary
  }, { commits: 0, additions: 0, deletions: 0, files: new Set<string>(), binary: new Set<string>() }), [commits])

  return (
    <section className="change-analytics">
      <div className="change-analytics-toolbar">
        <Group gap={8} wrap="nowrap">
          <Select
            size="xs"
            value={range}
            allowDeselect={false}
            aria-label="Analytics time range"
            data={[
              { value: '30d', label: 'Last 30 days' },
              { value: '90d', label: 'Last 90 days' },
              { value: '1y', label: 'Last year' },
              { value: 'all', label: 'All history' },
            ]}
            onChange={(value) => {
              if (value) onRangeChange(value as RepositoryAnalyticsRange)
            }}
          />
          <SegmentedControl
            size="xs"
            value={grouping}
            data={[
              { value: 'commit', label: 'Commits' },
              { value: 'day', label: 'Days' },
              { value: 'week', label: 'Weeks' },
              { value: 'month', label: 'Months' },
            ]}
            onChange={(value) => setGrouping(value as AnalyticsGrouping)}
          />
        </Group>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          leftSection={<IconRefresh size={14} />}
          loading={loading}
          onClick={onRefresh}
        >
          Refresh
        </Button>
      </div>

      <div className="change-analytics-scroll">
        {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
        {loading && !data ? (
          <div className="change-analytics-empty"><Loader size="sm" /><Text size="sm">Analyzing Git history…</Text></div>
        ) : commits.length === 0 ? (
          <div className="change-analytics-empty"><IconChartBar size={34} stroke={1.4} /><Text fw={650}>No changes in this range</Text></div>
        ) : (
          <>
            {data?.truncated && (
              <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
                Showing the newest {fullNumber.format(data.maxCommits)} commits. Choose a shorter range for complete totals.
              </Alert>
            )}
            <div className="change-summary-grid">
              <article><IconGitCommit size={20} /><span>Commits</span><strong>{fullNumber.format(totals.commits)}</strong></article>
              <article data-tone="positive"><IconArrowUp size={20} /><span>Added</span><strong>+{compactNumber.format(totals.additions)}</strong></article>
              <article data-tone="negative"><IconArrowDown size={20} /><span>Deleted</span><strong>−{compactNumber.format(totals.deletions)}</strong></article>
              <article data-tone={totals.additions - totals.deletions >= 0 ? 'positive' : 'negative'}>
                <IconChartBar size={20} /><span>Net change</span><strong>{totals.additions - totals.deletions >= 0 ? '+' : '−'}{compactNumber.format(Math.abs(totals.additions - totals.deletions))}</strong>
              </article>
              <article><IconFileCode size={20} /><span>Files touched</span><strong>{fullNumber.format(totals.files.size)}</strong></article>
              <article><IconUsers size={20} /><span>Contributors</span><strong>{fullNumber.format(contributors.length)}</strong></article>
            </div>

            <section className="change-trend-panel">
              <header>
                <div><IconChartBar size={18} /><Text fw={700}>Change activity</Text></div>
                <div className="change-chart-legend"><span>Additions</span><span>Deletions</span></div>
              </header>
              <ChangeChart buckets={buckets} />
            </section>

            <div className="change-ranking-grid">
              <RankingList title="Highest-churn files" icon={<IconFileCode size={18} />} values={files} onSelect={onOpenFile} />
              <RankingList title="Highest-churn folders" icon={<IconFolder size={18} />} values={folders} />
              <RankingList title="Contributor activity" icon={<IconUsers size={18} />} values={contributors} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
