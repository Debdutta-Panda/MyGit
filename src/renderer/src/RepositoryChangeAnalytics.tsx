import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Alert, Badge, Button, Group, Loader, MultiSelect, SegmentedControl, Select, Text, Tooltip } from '@mantine/core'
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
  contributors: Set<string>
}

interface RankedChange {
  name: string
  additions: number
  deletions: number
  commits: number
  churn: number
}

type TrendMetric = 'churn' | 'commits' | 'files' | 'effort'

const trendMetricDetails: Record<TrendMetric, { label: string; description: string; color: string }> = {
  churn: { label: 'Line churn', description: 'Added + deleted lines', color: '#4dabf7' },
  commits: { label: 'Commit volume', description: 'Commits completed', color: '#b197fc' },
  files: { label: 'File breadth', description: 'Unique files touched', color: '#20c997' },
  effort: { label: 'Change effort', description: 'Lines changed per commit', color: '#ffa94d' },
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
      contributors: new Set([commit.authorEmail || commit.author]),
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
      contributors: new Set<string>(),
    }
    bucket.commits += 1
    bucket.contributors.add(commit.authorEmail || commit.author)
    for (const file of commit.files) {
      bucket.additions += file.additions
      bucket.deletions += file.deletions
      bucket.files.add(file.path)
    }
    buckets.set(period.key, bucket)
  }
  return [...buckets.values()]
}

function AnalyticsSpreadsheet({ buckets }: { buckets: ActivityBucket[] }) {
  const totals = buckets.reduce((summary, bucket) => {
    summary.commits += bucket.commits
    summary.additions += bucket.additions
    summary.deletions += bucket.deletions
    for (const file of bucket.files) summary.files.add(file)
    for (const contributor of bucket.contributors) summary.contributors.add(contributor)
    return summary
  }, {
    commits: 0,
    additions: 0,
    deletions: 0,
    files: new Set<string>(),
    contributors: new Set<string>(),
  })

  return (
    <section className="analytics-spreadsheet" aria-label="Analytics data table">
      <header>
        <div><strong>Activity data</strong><span>Exact values for the selected filters and grouping</span></div>
        <Badge size="sm" variant="light" color="gray">{buckets.length} rows</Badge>
      </header>
      <div className="analytics-spreadsheet-scroll">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Commits</th>
              <th>Contributors</th>
              <th>Files</th>
              <th>Additions</th>
              <th>Deletions</th>
              <th>Net change</th>
              <th>Total churn</th>
              <th>Lines / commit</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => {
              const churn = bucket.additions + bucket.deletions
              const net = bucket.additions - bucket.deletions
              return (
                <tr key={bucket.key}>
                  <th scope="row" title={bucket.title}>{bucket.title}</th>
                  <td>{fullNumber.format(bucket.commits)}</td>
                  <td>{fullNumber.format(bucket.contributors.size)}</td>
                  <td>{fullNumber.format(bucket.files.size)}</td>
                  <td data-tone="positive">+{fullNumber.format(bucket.additions)}</td>
                  <td data-tone="negative">−{fullNumber.format(bucket.deletions)}</td>
                  <td data-tone={net >= 0 ? 'positive' : 'negative'}>{net >= 0 ? '+' : '−'}{fullNumber.format(Math.abs(net))}</td>
                  <td>{fullNumber.format(churn)}</td>
                  <td>{fullNumber.format(Math.round(churn / Math.max(1, bucket.commits)))}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <td>{fullNumber.format(totals.commits)}</td>
              <td>{fullNumber.format(totals.contributors.size)}</td>
              <td>{fullNumber.format(totals.files.size)}</td>
              <td data-tone="positive">+{fullNumber.format(totals.additions)}</td>
              <td data-tone="negative">−{fullNumber.format(totals.deletions)}</td>
              <td data-tone={totals.additions - totals.deletions >= 0 ? 'positive' : 'negative'}>
                {totals.additions - totals.deletions >= 0 ? '+' : '−'}{fullNumber.format(Math.abs(totals.additions - totals.deletions))}
              </td>
              <td>{fullNumber.format(totals.additions + totals.deletions)}</td>
              <td>{fullNumber.format(Math.round((totals.additions + totals.deletions) / Math.max(1, totals.commits)))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function AnalyticsSummary({
  commits,
  buckets,
  files,
  folders,
  contributors,
  truncated,
}: {
  commits: RepositoryChangeCommit[]
  buckets: ActivityBucket[]
  files: RankedChange[]
  folders: RankedChange[]
  contributors: RankedChange[]
  truncated: boolean
}) {
  const totalAdditions = buckets.reduce((sum, bucket) => sum + bucket.additions, 0)
  const totalDeletions = buckets.reduce((sum, bucket) => sum + bucket.deletions, 0)
  const totalChurn = totalAdditions + totalDeletions
  const uniqueFiles = new Set(buckets.flatMap((bucket) => [...bucket.files])).size
  const midpoint = Math.max(1, Math.ceil(buckets.length / 2))
  const earlierChurn = buckets.slice(0, midpoint).reduce((sum, bucket) => sum + bucket.additions + bucket.deletions, 0)
  const laterChurn = buckets.slice(midpoint).reduce((sum, bucket) => sum + bucket.additions + bucket.deletions, 0)
  const trendPercent = earlierChurn === 0
    ? (laterChurn > 0 ? 100 : 0)
    : Math.round((laterChurn - earlierChurn) / earlierChurn * 100)
  const peakBucket = buckets.reduce((peak, bucket) =>
    bucket.additions + bucket.deletions > peak.additions + peak.deletions ? bucket : peak,
  buckets[0])
  const commitSizes = commits.map((commit) => ({
    commit,
    churn: commit.files.reduce((sum, file) => sum + file.additions + file.deletions, 0),
  })).sort((left, right) => right.churn - left.churn)
  const largestCommit = commitSizes[0]
  const sortedSizes = commitSizes.map((value) => value.churn).sort((left, right) => left - right)
  const medianCommit = sortedSizes[Math.floor(sortedSizes.length / 2)] ?? 0
  const topFile = files[0]
  const topFolder = folders[0]
  const topContributor = contributors[0]
  const topFiveChurn = files.slice(0, 5).reduce((sum, file) => sum + file.churn, 0)
  const topFiveShare = totalChurn ? Math.round(topFiveChurn / totalChurn * 100) : 0
  const fileTouches = commits.reduce((sum, commit) => sum + commit.files.length, 0)
  const filesPerCommit = fileTouches / Math.max(1, commits.length)
  const deletionShare = totalChurn ? Math.round(totalDeletions / totalChurn * 100) : 0
  const trendSentence = buckets.length < 2
    ? 'More periods are needed to calculate a meaningful direction of change.'
    : `Change activity ${trendPercent === 0
      ? 'was steady'
      : `${trendPercent > 0 ? 'increased' : 'decreased'} ${Math.abs(trendPercent)}%`} between the earlier and later halves of the selected range.`
  const signals: Array<{ title: string; detail: string; tone?: 'attention' | 'neutral' }> = []

  if (topFile && totalChurn > 0 && topFile.churn / totalChurn >= .3) {
    signals.push({
      title: 'Concentrated change area',
      detail: `${topFile.name} accounts for ${Math.round(topFile.churn / totalChurn * 100)}% of line churn. It may deserve focused review or smaller follow-up changes.`,
      tone: 'attention',
    })
  }
  if (largestCommit && medianCommit > 0 && largestCommit.churn >= medianCommit * 4) {
    signals.push({
      title: 'Unusually large commit',
      detail: `${largestCommit.commit.shortHash} changed ${fullNumber.format(largestCommit.churn)} lines—${(largestCommit.churn / medianCommit).toFixed(1)}× the median commit size.`,
      tone: 'attention',
    })
  }
  if (deletionShare >= 45) {
    signals.push({
      title: 'Substantial removal or rewrite activity',
      detail: `Deletions represent ${deletionShare}% of churn. This describes change shape and does not by itself indicate risk.`,
      tone: 'neutral',
    })
  }
  if (filesPerCommit >= 15) {
    signals.push({
      title: 'Broad commits',
      detail: `Commits touched ${filesPerCommit.toFixed(1)} files on average, indicating changes commonly span many files.`,
      tone: 'neutral',
    })
  }
  if (signals.length === 0) {
    signals.push({
      title: 'No strong concentration signals',
      detail: 'Change size and distribution are relatively balanced within the selected history.',
      tone: 'neutral',
    })
  }

  return (
    <div className="analytics-summary">
      <section className="analytics-summary-lead">
        <Badge size="sm" variant="light" color="teal">Selected history</Badge>
        <h2>{fullNumber.format(commits.length)} commits changed {fullNumber.format(uniqueFiles)} files</h2>
        <p>
          This selection contains <strong>+{fullNumber.format(totalAdditions)}</strong> additions and{' '}
          <strong>−{fullNumber.format(totalDeletions)}</strong> deletions, producing a net change of{' '}
          <strong>{totalAdditions - totalDeletions >= 0 ? '+' : '−'}{fullNumber.format(Math.abs(totalAdditions - totalDeletions))}</strong> lines.
          {' '}{trendSentence}
        </p>
        {truncated && <p className="analytics-summary-warning">This summary uses the newest available commits because the selected history was truncated.</p>}
      </section>

      <div className="analytics-summary-grid">
        <article>
          <span>Peak activity</span>
          <strong>{peakBucket.title}</strong>
          <p>{fullNumber.format(peakBucket.additions + peakBucket.deletions)} changed lines across {peakBucket.commits} commits and {peakBucket.files.size} files.</p>
        </article>
        <article>
          <span>Change hotspot</span>
          <strong title={topFile?.name}>{topFile?.name ?? 'No file data'}</strong>
          <p>{topFile ? `${fullNumber.format(topFile.churn)} changed lines (${Math.round(topFile.churn / Math.max(1, totalChurn) * 100)}% of churn).` : 'No changed files were found.'}</p>
        </article>
        <article>
          <span>Most active area</span>
          <strong title={topFolder?.name}>{topFolder?.name ?? 'Repository root'}</strong>
          <p>{topFolder ? `${fullNumber.format(topFolder.churn)} changed lines across ${topFolder.commits} commits.` : 'No folder activity was found.'}</p>
        </article>
        <article>
          <span>Top contributor</span>
          <strong>{topContributor?.name ?? 'No contributor data'}</strong>
          <p>{topContributor ? `${topContributor.commits} commits and ${fullNumber.format(topContributor.churn)} changed lines.` : 'No contributor activity was found.'}</p>
        </article>
        <article>
          <span>Typical change</span>
          <strong>{fullNumber.format(medianCommit)} lines</strong>
          <p>Median commit size; the average is {fullNumber.format(Math.round(totalChurn / Math.max(1, commits.length)))} lines.</p>
        </article>
        <article>
          <span>Change concentration</span>
          <strong>{topFiveShare}%</strong>
          <p>Share of total line churn contained in the five most-changed files.</p>
        </article>
      </div>

      <section className="analytics-summary-signals">
        <header><IconAlertCircle size={17} /><strong>Signals to review</strong></header>
        {signals.map((signal) => (
          <article key={signal.title} data-tone={signal.tone}>
            <strong>{signal.title}</strong>
            <p>{signal.detail}</p>
          </article>
        ))}
      </section>

      <p className="analytics-summary-note">
        These observations describe Git change volume and distribution. They do not measure developer productivity, difficulty, code quality, or business value.
      </p>
    </div>
  )
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
  const viewportRef = useRef<HTMLDivElement>(null)
  const tooltipFrameRef = useRef<number | null>(null)
  const pendingPointerRef = useRef<{ index: number; clientX: number; clientY: number } | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [tooltip, setTooltip] = useState<{
    index: number
    x: number
    y: number
    side: 'left' | 'right'
  } | null>(null)
  const leftInset = 58
  const rightInset = 14
  const width = Math.max(760, viewportWidth - 24, leftInset + rightInset + buckets.length * 62)
  const height = 306
  const baseline = 139
  const plotHeight = 108
  const maxValue = Math.max(1, ...buckets.flatMap((bucket) => [bucket.additions, bucket.deletions]))
  const slot = (width - leftInset - rightInset) / Math.max(1, buckets.length)
  const barWidth = Math.max(5, Math.min(18, slot * 0.42))
  const labelEvery = Math.max(1, Math.ceil(78 / slot))
  const ticks = [0.25, 0.5, 0.75, 1]
  const activeBucket = tooltip ? buckets[tooltip.index] : null

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateWidth = (): void => setViewportWidth(viewport.clientWidth)
    const observer = new ResizeObserver(updateWidth)
    observer.observe(viewport)
    updateWidth()
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    if (tooltipFrameRef.current !== null) cancelAnimationFrame(tooltipFrameRef.current)
  }, [])

  const showPointerTooltip = (
    index: number,
    event: ReactPointerEvent<SVGGElement>,
  ): void => {
    pendingPointerRef.current = { index, clientX: event.clientX, clientY: event.clientY }
    if (tooltipFrameRef.current !== null) return
    tooltipFrameRef.current = requestAnimationFrame(() => {
      tooltipFrameRef.current = null
      const pointer = pendingPointerRef.current
      const viewport = viewportRef.current
      if (!pointer || !viewport) return
      const bounds = viewport.getBoundingClientRect()
      const localX = pointer.clientX - bounds.left
      const rawX = localX + viewport.scrollLeft
      const side = localX + 318 <= viewport.clientWidth ? 'right' : 'left'
      const rawY = pointer.clientY - bounds.top + viewport.scrollTop
      setTooltip({
        index: pointer.index,
        x: rawX + (side === 'right' ? 18 : -18),
        y: Math.max(viewport.scrollTop + 96, Math.min(
          rawY,
          viewport.scrollTop + viewport.clientHeight - 96,
        )),
        side,
      })
    })
  }

  const hidePointerTooltip = (): void => {
    pendingPointerRef.current = null
    if (tooltipFrameRef.current !== null) cancelAnimationFrame(tooltipFrameRef.current)
    tooltipFrameRef.current = null
    setTooltip(null)
  }

  const showFocusTooltip = (
    index: number,
    event: ReactFocusEvent<SVGGElement>,
  ): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    const target = event.currentTarget.getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    const localX = target.left + target.width / 2 - bounds.left
    const rawX = localX + viewport.scrollLeft
    const side = localX + 318 <= viewport.clientWidth ? 'right' : 'left'
    const rawY = target.top + target.height / 2 - bounds.top + viewport.scrollTop
    setTooltip({
      index,
      x: rawX + (side === 'right' ? 18 : -18),
      y: Math.max(viewport.scrollTop + 96, Math.min(
        rawY,
        viewport.scrollTop + viewport.clientHeight - 96,
      )),
      side,
    })
  }

  return (
    <div className="change-chart-scroll" ref={viewportRef} onPointerLeave={hidePointerTooltip}>
      <svg
        className="change-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Additions and deletions over time"
        preserveAspectRatio="xMidYMid meet"
        style={{ width }}
      >
        {ticks.map((ratio) => (
          <g key={ratio}>
            <line
              x1={leftInset}
              y1={baseline - plotHeight * ratio}
              x2={width - rightInset}
              y2={baseline - plotHeight * ratio}
              className="change-chart-gridline"
            />
            <line
              x1={leftInset}
              y1={baseline + plotHeight * ratio}
              x2={width - rightInset}
              y2={baseline + plotHeight * ratio}
              className="change-chart-gridline"
            />
            <text x={leftInset - 8} y={baseline - plotHeight * ratio + 3} textAnchor="end" className="change-chart-axis-value">
              +{compactNumber.format(Math.round(maxValue * ratio))}
            </text>
            <text x={leftInset - 8} y={baseline + plotHeight * ratio + 3} textAnchor="end" className="change-chart-axis-value">
              −{compactNumber.format(Math.round(maxValue * ratio))}
            </text>
          </g>
        ))}
        <text x={leftInset - 8} y={baseline + 3} textAnchor="end" className="change-chart-axis-value">0</text>
        <line x1={leftInset} y1={baseline} x2={width - rightInset} y2={baseline} className="change-chart-baseline" />
        {buckets.map((bucket, index) => {
          const x = leftInset + index * slot + (slot - barWidth) / 2
          const additionHeight = bucket.additions / maxValue * plotHeight
          const deletionHeight = bucket.deletions / maxValue * plotHeight
          const center = x + barWidth / 2
          return (
            <g
              className="change-chart-column"
              data-active={tooltip?.index === index || undefined}
              key={bucket.key}
              tabIndex={0}
              role="graphics-symbol"
              aria-label={`${bucket.title}: ${fullNumber.format(bucket.additions)} additions, ${fullNumber.format(bucket.deletions)} deletions, ${bucket.commits} commits, ${bucket.files.size} files`}
              onPointerEnter={(event) => showPointerTooltip(index, event)}
              onPointerMove={(event) => showPointerTooltip(index, event)}
              onFocus={(event) => showFocusTooltip(index, event)}
              onBlur={() => setTooltip(null)}
            >
              <rect
                x={leftInset + index * slot}
                y="5"
                width={slot}
                height="297"
                className="change-chart-hit-area"
              />
              <rect x={x} y={baseline - additionHeight} width={barWidth} height={additionHeight} rx="1.5" className="change-chart-additions" />
              <rect x={x} y={baseline + 1} width={barWidth} height={deletionHeight} rx="1.5" className="change-chart-deletions" />
              {bucket.additions > 0 && (
                <text
                  x={center}
                  y={Math.max(11, baseline - additionHeight - 5)}
                  textAnchor="middle"
                  className="change-chart-value change-chart-value--added"
                >
                  +{compactNumber.format(bucket.additions)}
                </text>
              )}
              {bucket.deletions > 0 && (
                <text
                  x={center}
                  y={Math.min(267, baseline + deletionHeight + 13)}
                  textAnchor="middle"
                  className="change-chart-value change-chart-value--deleted"
                >
                  −{compactNumber.format(bucket.deletions)}
                </text>
              )}
              {(index % labelEvery === 0 || index === buckets.length - 1) && (
                <text x={center} y="286" textAnchor="middle" className="change-chart-period">{bucket.label}</text>
              )}
              <text x={center} y="301" textAnchor="middle" className="change-chart-commit-count">
                {bucket.commits}c · {bucket.files.size}f
              </text>
            </g>
          )
        })}
      </svg>
      {activeBucket && tooltip && (
        <div
          className="change-chart-tooltip"
          data-side={tooltip.side}
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <strong>{activeBucket.title}</strong>
          <div className="change-chart-tooltip-grid">
            <span>Additions</span><b data-tone="positive">+{fullNumber.format(activeBucket.additions)}</b>
            <span>Deletions</span><b data-tone="negative">−{fullNumber.format(activeBucket.deletions)}</b>
            <span>Net change</span>
            <b data-tone={activeBucket.additions - activeBucket.deletions >= 0 ? 'positive' : 'negative'}>
              {activeBucket.additions - activeBucket.deletions >= 0 ? '+' : '−'}{fullNumber.format(Math.abs(activeBucket.additions - activeBucket.deletions))}
            </b>
            <span>Total churn</span><b>{fullNumber.format(activeBucket.additions + activeBucket.deletions)}</b>
            <span>Commits</span><b>{fullNumber.format(activeBucket.commits)}</b>
            <span>Files touched</span><b>{fullNumber.format(activeBucket.files.size)}</b>
          </div>
        </div>
      )}
    </div>
  )
}

const trendValue = (bucket: ActivityBucket, metric: TrendMetric): number => {
  if (metric === 'commits') return bucket.commits
  if (metric === 'files') return bucket.files.size
  const churn = bucket.additions + bucket.deletions
  return metric === 'effort' ? Math.round(churn / Math.max(1, bucket.commits)) : churn
}

function TrendLineChart({ buckets, metric }: { buckets: ActivityBucket[]; metric: TrendMetric }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tooltipFrameRef = useRef<number | null>(null)
  const pendingPointerRef = useRef<{ index: number; clientX: number; clientY: number } | null>(null)
  const [active, setActive] = useState<{
    index: number
    x: number
    y: number
    side: 'left' | 'right'
  } | null>(null)
  const details = trendMetricDetails[metric]
  const values = buckets.map((bucket) => trendValue(bucket, metric))
  const total = values.reduce((sum, value) => sum + value, 0)
  const average = Math.round(total / Math.max(1, values.length))
  const peak = Math.max(0, ...values)
  const width = 520
  const height = 176
  const left = 42
  const right = 12
  const top = 14
  const bottom = 31
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const maxValue = Math.max(1, peak)
  const xFor = (index: number): number => left + (values.length <= 1 ? plotWidth / 2 : index / (values.length - 1) * plotWidth)
  const yFor = (value: number): number => top + plotHeight - value / maxValue * plotHeight
  const points = values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(' ')
  const areaPoints = `${left},${top + plotHeight} ${points} ${xFor(values.length - 1)},${top + plotHeight}`
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 5))
  const activeBucket = active ? buckets[active.index] : null
  const activeValue = active ? values[active.index] : null

  useEffect(() => () => {
    if (tooltipFrameRef.current !== null) cancelAnimationFrame(tooltipFrameRef.current)
  }, [])

  const showTooltip = (index: number, event: ReactPointerEvent<SVGGElement>): void => {
    pendingPointerRef.current = { index, clientX: event.clientX, clientY: event.clientY }
    if (tooltipFrameRef.current !== null) return
    tooltipFrameRef.current = requestAnimationFrame(() => {
      tooltipFrameRef.current = null
      const pointer = pendingPointerRef.current
      const wrapper = wrapperRef.current
      if (!pointer || !wrapper) return
      const bounds = wrapper.getBoundingClientRect()
      const localX = pointer.clientX - bounds.left
      const side = localX + 250 <= wrapper.clientWidth ? 'right' : 'left'
      setActive({
        index: pointer.index,
        x: localX + (side === 'right' ? 14 : -14),
        y: Math.max(74, Math.min(pointer.clientY - bounds.top, wrapper.clientHeight - 74)),
        side,
      })
    })
  }

  const hideTooltip = (): void => {
    pendingPointerRef.current = null
    if (tooltipFrameRef.current !== null) cancelAnimationFrame(tooltipFrameRef.current)
    tooltipFrameRef.current = null
    setActive(null)
  }

  return (
    <article className="trend-line-card">
      <header>
        <div><strong>{details.label}</strong><span>{details.description}</span></div>
        <div className="trend-line-headline">
          <strong style={{ color: details.color }}>{compactNumber.format(total)}</strong>
          <span>Total</span>
        </div>
      </header>
      <div className="trend-line-stats">
        <span>Average <b>{compactNumber.format(average)}</b></span>
        <span>Peak <b>{compactNumber.format(peak)}</b></span>
        <span>Periods <b>{fullNumber.format(values.length)}</b></span>
      </div>
      <div className="trend-line-viewport" ref={wrapperRef} onPointerLeave={hideTooltip}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${details.label} trend`} preserveAspectRatio="none">
          {[0, .5, 1].map((ratio) => (
            <g key={ratio}>
              <line x1={left} y1={top + plotHeight * (1 - ratio)} x2={width - right} y2={top + plotHeight * (1 - ratio)} className="trend-line-grid" />
              <text x={left - 7} y={top + plotHeight * (1 - ratio) + 3} textAnchor="end">{compactNumber.format(Math.round(maxValue * ratio))}</text>
            </g>
          ))}
          <polygon points={areaPoints} fill={details.color} className="trend-line-area" />
          <polyline points={points} fill="none" stroke={details.color} className="trend-line-path" />
          {buckets.map((bucket, index) => {
            const slotWidth = plotWidth / Math.max(1, buckets.length)
            return (
              <g
                key={bucket.key}
                className="trend-line-point"
                data-active={active?.index === index || undefined}
                tabIndex={0}
                aria-label={`${bucket.title}: ${fullNumber.format(values[index])} ${details.label.toLowerCase()}`}
                onPointerEnter={(event) => showTooltip(index, event)}
                onPointerMove={(event) => showTooltip(index, event)}
                onFocus={(event) => {
                  const wrapper = wrapperRef.current
                  if (!wrapper) return
                  const target = event.currentTarget.getBoundingClientRect()
                  const bounds = wrapper.getBoundingClientRect()
                  const localX = target.left + target.width / 2 - bounds.left
                  const side = localX + 250 <= wrapper.clientWidth ? 'right' : 'left'
                  setActive({ index, x: localX + (side === 'right' ? 14 : -14), y: 92, side })
                }}
                onBlur={() => setActive(null)}
              >
                <rect x={xFor(index) - slotWidth / 2} y={top} width={slotWidth} height={plotHeight} className="trend-line-hit" />
                <circle cx={xFor(index)} cy={yFor(values[index])} r={active?.index === index ? 4 : 2.3} fill={details.color} />
                {(index % labelEvery === 0 || index === buckets.length - 1) && (
                  <text x={xFor(index)} y={height - 9} textAnchor="middle" className="trend-line-period">{bucket.label}</text>
                )}
              </g>
            )
          })}
        </svg>
        {activeBucket && activeValue !== null && active && (
          <div className="trend-line-tooltip" data-side={active.side} style={{ left: active.x, top: active.y }} role="tooltip">
            <strong>{activeBucket.title}</strong>
            <span><i style={{ background: details.color }} />{details.label}<b>{fullNumber.format(activeValue)}</b></span>
            <span>Additions<b>+{fullNumber.format(activeBucket.additions)}</b></span>
            <span>Deletions<b>−{fullNumber.format(activeBucket.deletions)}</b></span>
            <span>Commits / files<b>{activeBucket.commits} / {activeBucket.files.size}</b></span>
          </div>
        )}
      </div>
    </article>
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
          <Tooltip
            key={value.name}
            position="top"
            withArrow
            multiline
            openDelay={180}
            label={(
              <div className="change-ranking-tooltip">
                <strong>{value.name}</strong>
                <span>+{fullNumber.format(value.additions)} additions</span>
                <span>−{fullNumber.format(value.deletions)} deletions</span>
                <span>{fullNumber.format(value.churn)} lines churned · {fullNumber.format(value.commits)} commits</span>
              </div>
            )}
          >
          <button
            type="button"
            className="change-ranking-row"
            data-actionable={onSelect ? true : undefined}
            aria-disabled={!onSelect}
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
          </Tooltip>
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
  scope,
}: {
  data: AnalyticsData | null
  loading: boolean
  error: string | null
  range: RepositoryAnalyticsRange
  onRangeChange: (range: RepositoryAnalyticsRange) => void
  onRefresh: () => void
  onOpenFile?: (path: string) => void
  scope?: { path: string; kind: 'file' | 'folder' }
}) {
  const [grouping, setGrouping] = useState<AnalyticsGrouping>('day')
  const [view, setView] = useState<'summary' | 'charts' | 'data'>('summary')
  const [selectedCommitters, setSelectedCommitters] = useState<string[]>([])
  const scopedCommits = useMemo(() => (data?.commits ?? []).flatMap((commit) => {
    if (!scope) return [commit]
    const prefix = `${scope.path.replace(/\/$/, '')}/`
    const files = commit.files.filter((file) => scope.kind === 'file'
      ? file.path === scope.path
      : file.path === scope.path || file.path.startsWith(prefix))
    return files.length > 0 ? [{ ...commit, files }] : []
  }), [data?.commits, scope?.kind, scope?.path])
  const committerOptions = useMemo(() => {
    const values = new Map<string, string>()
    for (const commit of scopedCommits) {
      const key = commit.authorEmail || commit.author
      values.set(key, commit.authorEmail ? `${commit.author} · ${commit.authorEmail}` : commit.author)
    }
    return [...values].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label))
  }, [scopedCommits])
  useEffect(() => {
    const available = new Set(committerOptions.map((option) => option.value))
    setSelectedCommitters((current) => current.filter((committer) => available.has(committer)))
  }, [committerOptions])
  const commits = useMemo(() => selectedCommitters.length === 0
    ? scopedCommits
    : scopedCommits.filter((commit) => selectedCommitters.includes(commit.authorEmail || commit.author)),
  [scopedCommits, selectedCommitters])
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
  const commitChurn = useMemo(() => commits.map((commit) => commit.files.reduce(
    (sum, file) => sum + file.additions + file.deletions,
    0,
  )).sort((left, right) => left - right), [commits])
  const totalChurn = totals.additions + totals.deletions
  const averageChurn = Math.round(totalChurn / Math.max(1, totals.commits))
  const medianChurn = commitChurn.length === 0 ? 0 : commitChurn[Math.floor(commitChurn.length / 2)]

  return (
    <section className="change-analytics">
      <div className="change-analytics-toolbar">
        <Group gap={8} wrap="nowrap">
          {scope && (
            <Badge
              className="change-analytics-scope"
              size="md"
              variant="light"
              color="teal"
              title={scope.path}
            >
              {scope.kind === 'folder' ? 'Folder' : 'File'} · {scope.path}
            </Badge>
          )}
          <Select
            size="xs"
            value={range}
            allowDeselect={false}
            aria-label="Analytics time range"
            data={[
              { value: '7d', label: 'Last 7 days' },
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
          <MultiSelect
            className="change-analytics-committers"
            size="xs"
            data={committerOptions}
            value={selectedCommitters}
            placeholder="All committers"
            aria-label="Filter by committers"
            searchable
            clearable
            maxDropdownHeight={280}
            onChange={setSelectedCommitters}
          />
          <SegmentedControl
            size="xs"
            value={view}
            aria-label="Analytics view"
            data={[{ value: 'summary', label: 'Summary' }, { value: 'charts', label: 'Charts' }, { value: 'data', label: 'Data' }]}
            onChange={(value) => setView(value as 'summary' | 'charts' | 'data')}
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
              <article><IconChartBar size={20} /><span>Total churn</span><strong>{compactNumber.format(totalChurn)}</strong></article>
              <article><IconGitCommit size={20} /><span>Avg / commit</span><strong>{compactNumber.format(averageChurn)}</strong></article>
            </div>

            {view === 'summary' ? (
              <AnalyticsSummary
                commits={commits}
                buckets={buckets}
                files={files}
                folders={folders}
                contributors={contributors}
                truncated={Boolean(data?.truncated)}
              />
            ) : view === 'data' ? (
              <AnalyticsSpreadsheet buckets={buckets} />
            ) : <>
            <section className="change-trend-panel">
              <header>
                <div><IconChartBar size={18} /><Text fw={700}>Change activity</Text></div>
                <div className="change-chart-legend"><span>Additions</span><span>Deletions</span></div>
              </header>
              <ChangeChart buckets={buckets} />
            </section>

            <section className="change-trends-section">
              <header>
                <div><IconChartBar size={18} /><Text fw={700}>Trend signals</Text></div>
                <Text size="xs" c="dimmed">Independent scales · hover any point for full context</Text>
              </header>
              <div className="trend-line-grid">
                <TrendLineChart buckets={buckets} metric="churn" />
                <TrendLineChart buckets={buckets} metric="commits" />
                <TrendLineChart buckets={buckets} metric="files" />
                <TrendLineChart buckets={buckets} metric="effort" />
              </div>
            </section>

            <section className="change-effort-strip">
              <article><span>Median commit</span><strong>{compactNumber.format(medianChurn)} lines</strong><small>Typical change size</small></article>
              <article><span>Largest commit</span><strong>{compactNumber.format(Math.max(0, ...commitChurn))} lines</strong><small>Peak single-change effort</small></article>
              <article><span>Add / delete mix</span><strong>{totalChurn ? Math.round(totals.additions / totalChurn * 100) : 0}% / {totalChurn ? Math.round(totals.deletions / totalChurn * 100) : 0}%</strong><small>Growth versus removal</small></article>
              <article><span>Files / commit</span><strong>{(commits.reduce((sum, commit) => sum + commit.files.length, 0) / Math.max(1, totals.commits)).toFixed(1)}</strong><small>Average change breadth</small></article>
            </section>

            <div className="change-ranking-grid">
              {scope?.kind !== 'file' && (
                <RankingList title="Highest-churn files" icon={<IconFileCode size={18} />} values={files} onSelect={onOpenFile} />
              )}
              {!scope && (
                <RankingList title="Highest-churn folders" icon={<IconFolder size={18} />} values={folders} />
              )}
              <RankingList title="Contributor activity" icon={<IconUsers size={18} />} values={contributors} />
            </div>
            </>}
          </>
        )}
      </div>
    </section>
  )
}
