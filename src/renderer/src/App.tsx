import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type CSSProperties,
} from 'react'
import cplusplusLogo from 'devicon/icons/cplusplus/cplusplus-original.svg'
import csharpLogo from 'devicon/icons/csharp/csharp-original.svg'
import cssLogo from 'devicon/icons/css3/css3-original.svg'
import cLogo from 'devicon/icons/c/c-original.svg'
import bashLogo from 'devicon/icons/bash/bash-original.svg'
import dartLogo from 'devicon/icons/dart/dart-original.svg'
import elixirLogo from 'devicon/icons/elixir/elixir-original.svg'
import erlangLogo from 'devicon/icons/erlang/erlang-original.svg'
import fsharpLogo from 'devicon/icons/fsharp/fsharp-original.svg'
import goLogo from 'devicon/icons/go/go-original.svg'
import graphqlLogo from 'devicon/icons/graphql/graphql-plain.svg'
import htmlLogo from 'devicon/icons/html5/html5-original.svg'
import javaLogo from 'devicon/icons/java/java-original.svg'
import javascriptLogo from 'devicon/icons/javascript/javascript-original.svg'
import jsonLogo from 'devicon/icons/json/json-original.svg'
import kotlinLogo from 'devicon/icons/kotlin/kotlin-original.svg'
import lessLogo from 'devicon/icons/less/less-plain-wordmark.svg'
import luaLogo from 'devicon/icons/lua/lua-original.svg'
import markdownLogo from 'devicon/icons/markdown/markdown-original.svg'
import phpLogo from 'devicon/icons/php/php-original.svg'
import powershellLogo from 'devicon/icons/powershell/powershell-original.svg'
import prismaLogo from 'devicon/icons/prisma/prisma-original.svg'
import pythonLogo from 'devicon/icons/python/python-original.svg'
import rLogo from 'devicon/icons/r/r-original.svg'
import rubyLogo from 'devicon/icons/ruby/ruby-original.svg'
import rustLogo from 'devicon/icons/rust/rust-original.svg'
import sassLogo from 'devicon/icons/sass/sass-original.svg'
import scalaLogo from 'devicon/icons/scala/scala-original.svg'
import sqlLogo from 'devicon/icons/sqldeveloper/sqldeveloper-original.svg'
import svelteLogo from 'devicon/icons/svelte/svelte-original.svg'
import swiftLogo from 'devicon/icons/swift/swift-original.svg'
import typescriptLogo from 'devicon/icons/typescript/typescript-original.svg'
import visualBasicLogo from 'devicon/icons/visualbasic/visualbasic-original.svg'
import vueLogo from 'devicon/icons/vuejs/vuejs-original.svg'
import xmlLogo from 'devicon/icons/xml/xml-original.svg'
import yamlLogo from 'devicon/icons/yaml/yaml-original.svg'
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Checkbox,
  ColorInput,
  CopyButton,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  Pagination,
  Paper,
  Progress,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconArrowUp,
  IconBrandGit,
  IconBrandGithub,
  IconBrandVscode,
  IconBook2,
  IconBriefcase,
  IconChartBar,
  IconCheck,
  IconCommand,
  IconCode,
  IconCopy,
  IconDownload,
  IconDeviceFloppy,
  IconExternalLink,
  IconFileCode,
  IconFile,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconFilter,
  IconFolderOpen,
  IconFolderSearch,
  IconFolders,
  IconGitBranch,
  IconGitCommit,
  IconGripVertical,
  IconLayoutGrid,
  IconLayoutList,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconKey,
  IconLink,
  IconLock,
  IconMinus,
  IconPlus,
  IconPhoto,
  IconRefresh,
  IconRestore,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconStar,
  IconSquare,
  IconTags,
  IconTemplate,
  IconTrash,
  IconUpload,
  IconUsers,
  IconUnlink,
  IconX,
} from '@tabler/icons-react'
import type {
  AppSettings,
  AppUpdateState,
  ConfigurationSyncAction,
  ConfigurationSyncState,
  GitHubAccount,
  GitHubDeviceAuthorization,
  GitHubRepository,
  OrganizationCatalog,
  OrganizationItem,
  OrganizationKind,
  RepositoryChangedFile,
  RepositoryCommit,
  RepositoryCommitFile,
  RepositoryGitDetails,
  RepositoryGitStatus,
  RepositoryOrganization,
  RepositoryOrganizationEntry,
  ProjectInsightsResult,
  ProjectInsightFile,
  ProjectInsightTechnology,
  WorkspaceLaunchTarget,
} from '../../shared/desktop-api'
import myReposIcon from './assets/myrepos-icon.png'

type AuthorizationState = 'idle' | 'starting' | 'waiting'
type ActiveView = 'accounts' | 'repositories' | 'workspaces' | 'groups' | 'tags' | 'settings'
type RepositoryTab = 'local' | 'github' | 'workspace'
type RepositoryLayout = 'list' | 'grid'
type FilesPanelTab = 'changes' | 'history'
type InsightsTab = 'overview' | 'files' | 'technologies' | 'projects'
type InsightsMode = 'off' | 'manual' | 'automatic' | 'hybrid'
type InsightsMetric = 'all' | 'lines' | 'code' | 'comments'
type TechnologyCategory = ProjectInsightsResult['technologies'][number]['category']
type BulkGitOperation = 'sync' | 'fetch' | 'pull' | 'push'
type BulkGitTarget = 'visible' | 'selected'

const bulkGitOperationLabel: Record<BulkGitOperation, string> = {
  sync: 'Sync',
  fetch: 'Fetch',
  pull: 'Pull',
  push: 'Push',
}

interface BulkGitResult {
  repositoryKey: string
  fullName: string
  status: 'pending' | 'running' | 'success' | 'error'
  message?: string
}

const emptyOrganizationCatalog = (): OrganizationCatalog => ({
  workspaces: [],
  groups: [],
  tags: [],
})

const emptyRepositoryOrganization = (): RepositoryOrganization => ({
  workspaceIds: [],
  groupIds: [],
  tagIds: [],
})

const emptyConfigurationSyncState: ConfigurationSyncState = {
  connected: false,
  localPath: null,
  accountId: null,
  fullName: null,
  autoSync: false,
  lastSyncedAt: null,
  lastError: null,
  hasRemote: false,
}

const repositoryOrganizationKey = (repository: Pick<GitHubRepository, 'accountId' | 'fullName'>): string =>
  `github:${repository.accountId}:${repository.fullName.toLowerCase()}`

const organizationFieldForKind: Record<OrganizationKind, keyof RepositoryOrganization> = {
  workspace: 'workspaceIds',
  group: 'groupIds',
  tag: 'tagIds',
}

const bulkOrganizationChangeKey = (kind: OrganizationKind, id: string): string => `${kind}:${id}`

const organizationDefaultColor: Record<OrganizationKind, string> = {
  workspace: '#20c997',
  group: '#4dabf7',
  tag: '#cc5de8',
}

const organizationKinds: OrganizationKind[] = ['workspace', 'group', 'tag']

const organizationCopy: Record<OrganizationKind, {
  singular: string
  plural: string
  description: string
  catalogField: keyof OrganizationCatalog
}> = {
  workspace: {
    singular: 'Workspace',
    plural: 'Workspaces',
    description: 'Build focused working sets from repositories that belong together.',
    catalogField: 'workspaces',
  },
  group: {
    singular: 'Group',
    plural: 'Groups',
    description: 'Create stable collections for teams, clients, products, or any structure you choose.',
    catalogField: 'groups',
  },
  tag: {
    singular: 'Tag',
    plural: 'Tags',
    description: 'Add flexible labels that can be combined across every repository.',
    catalogField: 'tags',
  },
}

interface DiffDisplayLine {
  kind: 'add' | 'delete' | 'context' | 'meta'
  oldLine: number | null
  newLine: number | null
  text: string
}

const parseUnifiedDiff = (value: string): DiffDisplayLine[] => {
  let oldLine = 0
  let newLine = 0

  return value.split('\n').map((text) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      return { kind: 'meta', oldLine: null, newLine: null, text }
    }
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') ||
        text.startsWith('index ')) {
      return { kind: 'meta', oldLine: null, newLine: null, text }
    }
    if (text.startsWith('+')) {
      const line = { kind: 'add' as const, oldLine: null, newLine, text: text.slice(1) }
      newLine += 1
      return line
    }
    if (text.startsWith('-')) {
      const line = { kind: 'delete' as const, oldLine, newLine: null, text: text.slice(1) }
      oldLine += 1
      return line
    }
    const line = {
      kind: 'context' as const,
      oldLine: oldLine || null,
      newLine: newLine || null,
      text: text.startsWith(' ') ? text.slice(1) : text,
    }
    if (oldLine) oldLine += 1
    if (newLine) newLine += 1
    return line
  })
}

interface HorizontalSplitterProps {
  label: string
  value: number
  resetValue: number
  min: number
  max: number
  reserveEnd: number
  onChange: (value: number) => void
}

const HorizontalSplitter = ({
  label,
  value,
  resetValue,
  min,
  max,
  reserveEnd,
  onChange,
}: HorizontalSplitterProps) => {
  const splitterRef = useRef<HTMLDivElement>(null)
  const availableMax = (): number => {
    const parentWidth = splitterRef.current?.parentElement?.getBoundingClientRect().width
    return Math.max(min, Math.min(max, parentWidth ? parentWidth - reserveEnd : max))
  }
  const clamp = (nextValue: number): number => Math.min(availableMax(), Math.max(min, nextValue))

  useEffect(() => {
    const parent = splitterRef.current?.parentElement
    if (!parent) return
    const keepSiblingsVisible = (): void => {
      const nextValue = Math.min(
        max,
        Math.max(min, parent.getBoundingClientRect().width - reserveEnd),
      )
      if (value > nextValue) onChange(nextValue)
    }
    const observer = new ResizeObserver(keepSiblingsVisible)
    observer.observe(parent)
    keepSiblingsVisible()
    return () => observer.disconnect()
  }, [max, min, onChange, reserveEnd, value])

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startValue = value
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (moveEvent: PointerEvent): void => {
      onChange(clamp(startValue + moveEvent.clientX - startX))
    }
    const finish = (): void => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <div
      ref={splitterRef}
      className="horizontal-splitter"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onDoubleClick={() => onChange(clamp(resetValue))}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onChange(clamp(value + (event.key === 'ArrowLeft' ? -20 : 20)))
      }}
      onPointerDown={beginResize}
    >
      <span />
    </div>
  )
}

const defaultSettings: AppSettings = {
  vscodeApplicationName: '',
  automaticallyCheckForUpdates: true,
  automaticallyDownloadUpdates: true,
}

const emptyUpdateState: AppUpdateState = {
  phase: 'idle',
  channel: 'stable',
  currentVersion: '',
  availableVersion: null,
  progress: null,
  transferred: null,
  total: null,
  checkedAt: null,
  message: null,
  packaged: false,
}

const VirtualizedInsightFiles = ({ files }: { files: ProjectInsightFile[] }) => {
  const rowHeight = 31
  const overscan = 10
  const visibleRows = 24
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(files.length, start + visibleRows + overscan * 2)

  useEffect(() => {
    setScrollTop(0)
    if (viewportRef.current) viewportRef.current.scrollTop = 0
  }, [files])

  return (
    <div className="insights-file-table">
      <div className="insights-file-row insights-file-head">
        <span>Path</span><span>Type</span><span>Size</span><span>Lines</span>
        <span>Code</span><span>Comments</span><span>Blank</span>
      </div>
      <div
        ref={viewportRef}
        className="insights-virtual-viewport insights-file-viewport"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="insights-virtual-spacer" style={{ height: files.length * rowHeight }}>
          <div className="insights-virtual-window" style={{ transform: `translateY(${start * rowHeight}px)` }}>
            {files.slice(start, end).map((file) => (
              <div className="insights-file-row" key={file.path}>
                <span className="insights-file-path-cell">
                  <span
                    className="insights-file-type-icon"
                    data-category={file.category}
                    data-on-light={['.md', '.mdx', '.sh', '.bash', '.prisma'].includes(file.extension) || undefined}
                    aria-hidden="true"
                  >
                    {repositoryFileIcon(file)}
                  </span>
                  <span className="insights-file-path" title={file.path}>{file.path}</span>
                </span>
                <span>{file.language ?? file.category}</span>
                <span>{formatBytes(file.size)}</span>
                <span>{file.lines.toLocaleString()}</span>
                <span>{file.codeLines.toLocaleString()}</span>
                <span>{file.commentLines.toLocaleString()}</span>
                <span>{file.blankLines.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const VirtualizedTechnologies = ({
  technologies,
  category,
}: {
  technologies: ProjectInsightTechnology[]
  category: TechnologyCategory
}) => {
  const rowHeight = 67
  const overscan = 6
  const visibleRows = 9
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(technologies.length, start + visibleRows + overscan * 2)

  useEffect(() => {
    setScrollTop(0)
    if (viewportRef.current) viewportRef.current.scrollTop = 0
  }, [technologies])

  return (
    <div
      ref={viewportRef}
      className="insights-virtual-viewport insights-technology-viewport"
      style={{ height: Math.min(603, Math.max(rowHeight, technologies.length * rowHeight)) }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="insights-virtual-spacer" style={{ height: technologies.length * rowHeight }}>
        <div className="insights-virtual-window" style={{ transform: `translateY(${start * rowHeight}px)` }}>
          {technologies.slice(start, end).map((technology) => (
            <div className="insights-technology-row" key={`${technology.category}:${technology.name}`}>
              <div>
                <Group gap="xs">
                  <Text size="sm" fw={700}>{technology.name}</Text>
                  <Badge size="xs" variant="outline" color={technologyCategoryMeta[category].color}>
                    {category}
                  </Badge>
                  <Badge size="xs" variant="outline" color="gray">{technology.confidence}</Badge>
                </Group>
                <Text size="xs" c="dimmed" mt={4} lineClamp={1}>{technology.evidence.join(' · ')}</Text>
              </div>
              <Text size="xs" c="dimmed">{technology.version ?? 'Version unavailable'}</Text>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const repositoriesPerPage = 15

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return message
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error: /, '')
}

const timeAgo = (value: string, now: number): string => {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const technologyCategoryOrder: TechnologyCategory[] = ['framework', 'library', 'runtime', 'tool']
const technologyCategoryMeta: Record<TechnologyCategory, { label: string; color: string }> = {
  framework: { label: 'Frameworks', color: 'teal' },
  library: { label: 'Libraries', color: 'blue' },
  runtime: { label: 'Runtimes', color: 'violet' },
  tool: { label: 'Tools', color: 'orange' },
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1_024
  let unit = 0
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const repositoryLanguageIcon = (language: string | null): ReactNode => {
  let logo: string | null = null
  switch (language?.toLowerCase()) {
    case 'typescript': logo = typescriptLogo; break
    case 'javascript': logo = javascriptLogo; break
    case 'python': logo = pythonLogo; break
    case 'php': logo = phpLogo; break
    case 'html': logo = htmlLogo; break
    case 'css': logo = cssLogo; break
    case 'scss':
    case 'sass': logo = sassLogo; break
    case 'less': logo = lessLogo; break
    case 'c#': logo = csharpLogo; break
    case 'f#': logo = fsharpLogo; break
    case 'visual basic': logo = visualBasicLogo; break
    case 'c': logo = cLogo; break
    case 'c++': logo = cplusplusLogo; break
    case 'java': logo = javaLogo; break
    case 'go': logo = goLogo; break
    case 'rust': logo = rustLogo; break
    case 'kotlin': logo = kotlinLogo; break
    case 'swift': logo = swiftLogo; break
    case 'dart': logo = dartLogo; break
    case 'ruby': logo = rubyLogo; break
    case 'scala': logo = scalaLogo; break
    case 'lua': logo = luaLogo; break
    case 'r': logo = rLogo; break
    case 'shell': logo = bashLogo; break
    case 'powershell': logo = powershellLogo; break
    case 'sql': logo = sqlLogo; break
    case 'json':
    case 'json with comments': logo = jsonLogo; break
    case 'markdown':
    case 'mdx': logo = markdownLogo; break
    case 'yaml': logo = yamlLogo; break
    case 'xml':
    case 'xaml': logo = xmlLogo; break
    case 'graphql': logo = graphqlLogo; break
    case 'elixir': logo = elixirLogo; break
    case 'erlang': logo = erlangLogo; break
    case 'vue': logo = vueLogo; break
    case 'svelte': logo = svelteLogo; break
    default: return <IconCode size={23} stroke={2.2} />
  }
  return <img className="repository-language-logo" src={logo} alt="" />
}

const repositoryLanguageColor = (language: string | null): string => {
  switch (language?.toLowerCase()) {
    case 'typescript': return '#5ea6e8'
    case 'javascript': return '#f7df1e'
    case 'python': return '#ffd43b'
    case 'php': return '#aeb2d5'
    case 'html': return '#ff7043'
    case 'css': return '#42a5f5'
    case 'c#': return '#b58cff'
    case 'c++': return '#659ad2'
    case 'go': return '#5dc9e2'
    case 'rust': return '#e6a66c'
    case 'kotlin': return '#b48cff'
    case 'swift': return '#ff7557'
    case 'vue': return '#63d7a0'
    case 'svelte': return '#ff5d3b'
    default: return '#91a0b2'
  }
}

const repositoryExtensionIcon = (extension: string): ReactNode => {
  const language: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.py': 'Python', '.php': 'PHP', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.cs': 'C#', '.fs': 'F#', '.vb': 'Visual Basic', '.c': 'C', '.h': 'C',
    '.cc': 'C++', '.cpp': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.hh': 'C++',
    '.go': 'Go', '.rs': 'Rust', '.swift': 'Swift', '.dart': 'Dart', '.rb': 'Ruby',
    '.scala': 'Scala', '.lua': 'Lua', '.r': 'R', '.sh': 'Shell', '.bash': 'Shell',
    '.ps1': 'PowerShell', '.sql': 'SQL', '.html': 'HTML', '.htm': 'HTML', '.vue': 'Vue',
    '.svelte': 'Svelte', '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass', '.less': 'Less',
    '.xml': 'XML', '.xaml': 'XAML', '.json': 'JSON', '.jsonc': 'JSON with Comments',
    '.yaml': 'YAML', '.yml': 'YAML', '.md': 'Markdown', '.mdx': 'MDX',
    '.graphql': 'GraphQL', '.gql': 'GraphQL', '.ex': 'Elixir', '.exs': 'Elixir',
    '.erl': 'Erlang', '.hrl': 'Erlang',
  }
  const detectedLanguage = language[extension]
  if (detectedLanguage) return repositoryLanguageIcon(detectedLanguage)
  if (extension === '.prisma') return <img className="repository-language-logo" src={prismaLogo} alt="" />
  if (extension === '.csv' || extension === '.tsv') return <IconFileSpreadsheet size={20} stroke={1.8} />
  if (extension === '.txt') return <IconFileText size={20} stroke={1.8} />
  if (extension === '.twig') return <IconTemplate size={20} stroke={1.8} />
  return <IconFileCode size={20} stroke={1.8} />
}

const repositoryFileIcon = (file: ProjectInsightFile): ReactNode => {
  const name = file.path.split('/').at(-1)?.toLowerCase() ?? ''
  if (name === '.env' || name.startsWith('.env.')) return <IconKey size={19} stroke={1.8} />
  if (name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules') {
    return <IconBrandGit size={19} stroke={1.8} />
  }
  if (file.extension === '.pdf') return <IconFileTypePdf size={20} stroke={1.8} />
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp', '.tiff']
    .includes(file.extension)) return <IconPhoto size={20} stroke={1.8} />
  if (['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz'].includes(file.extension)) {
    return <IconFileZip size={20} stroke={1.8} />
  }
  if (file.category === 'config' && file.extension === '(none)') return <IconSettings size={19} stroke={1.8} />
  if (file.extension === '(none)') return <IconFile size={20} stroke={1.7} />
  return repositoryExtensionIcon(file.extension)
}

const mergeRepositoryDetails = (
  localRepositories: GitHubRepository[],
  remoteRepositories: GitHubRepository[],
): GitHubRepository[] => {
  const remoteKeys = new Set(remoteRepositories.map(
    (repository) => `${repository.accountId}:${repository.fullName.toLowerCase()}`,
  ))
  return [
    ...remoteRepositories,
    ...localRepositories.filter((repository) =>
      !remoteKeys.has(`${repository.accountId}:${repository.fullName.toLowerCase()}`),
    ),
  ]
}

export function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [repositoryPaneVisible, setRepositoryPaneVisible] = useState(true)
  const [scmNavigatorVisible, setScmNavigatorVisible] = useState(true)
  const [commitFilesVisible, setCommitFilesVisible] = useState(true)
  const [diffVisible, setDiffVisible] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(244)
  const [repositoryPaneWidth, setRepositoryPaneWidth] = useState(430)
  const [scmNavigatorWidth, setScmNavigatorWidth] = useState(290)
  const [commitFilesWidth, setCommitFilesWidth] = useState(300)
  const [organizationCatalog, setOrganizationCatalog] = useState<OrganizationCatalog>(emptyOrganizationCatalog)
  const [organizationAssignments, setOrganizationAssignments] = useState<Record<string, RepositoryOrganization>>({})
  const [repositoryColors, setRepositoryColors] = useState<Record<string, string>>({})
  const [organizeRepository, setOrganizeRepository] = useState<GitHubRepository | null>(null)
  const [repositoryColorDraft, setRepositoryColorDraft] = useState('')
  const [organizationDraft, setOrganizationDraft] = useState<RepositoryOrganization>(emptyRepositoryOrganization)
  const [organizationLoading, setOrganizationLoading] = useState(false)
  const [organizationSaving, setOrganizationSaving] = useState(false)
  const [organizationError, setOrganizationError] = useState<string | null>(null)
  const [newOrganizationNames, setNewOrganizationNames] = useState<Record<OrganizationKind, string>>({
    workspace: '',
    group: '',
    tag: '',
  })
  const [organizationEditorKind, setOrganizationEditorKind] = useState<OrganizationKind | null>(null)
  const [organizationEditorItem, setOrganizationEditorItem] = useState<OrganizationItem | null>(null)
  const [organizationEditorName, setOrganizationEditorName] = useState('')
  const [organizationEditorColor, setOrganizationEditorColor] = useState(organizationDefaultColor.workspace)
  const [organizationEditorDescription, setOrganizationEditorDescription] = useState('')
  const [organizationEditorSaving, setOrganizationEditorSaving] = useState(false)
  const [organizationEditorError, setOrganizationEditorError] = useState<string | null>(null)
  const [organizationDeleteItem, setOrganizationDeleteItem] = useState<OrganizationItem | null>(null)
  const [repositorySelectionMode, setRepositorySelectionMode] = useState(false)
  const [selectedRepositoryKeys, setSelectedRepositoryKeys] = useState<string[]>([])
  const [bulkOrganizationOpen, setBulkOrganizationOpen] = useState(false)
  const [bulkOrganizationChanges, setBulkOrganizationChanges] = useState<Record<string, boolean>>({})
  const [bulkOrganizationSaving, setBulkOrganizationSaving] = useState(false)
  const [bulkOrganizationError, setBulkOrganizationError] = useState<string | null>(null)
  const [repositoryOrganizationFilters, setRepositoryOrganizationFilters] =
    useState<RepositoryOrganization>(emptyRepositoryOrganization)
  const [bulkGitOpen, setBulkGitOpen] = useState(false)
  const [bulkGitTarget, setBulkGitTarget] = useState<BulkGitTarget>('visible')
  const [bulkGitOperation, setBulkGitOperation] = useState<BulkGitOperation>('sync')
  const [bulkGitRunning, setBulkGitRunning] = useState(false)
  const [bulkGitResults, setBulkGitResults] = useState<BulkGitResult[]>([])
  const [accounts, setAccounts] = useState<GitHubAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ActiveView>('repositories')
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>('all')
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [repositoriesLoading, setRepositoriesLoading] = useState(false)
  const [repositoriesError, setRepositoriesError] = useState<string | null>(null)
  const [gitStatuses, setGitStatuses] = useState<Record<string, RepositoryGitStatus>>({})
  const [repositorySearch, setRepositorySearch] = useState('')
  const [repositoryTab, setRepositoryTab] = useState<RepositoryTab>('local')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [workspaceRepositoryOrder, setWorkspaceRepositoryOrder] = useState<string[]>([])
  const [workspaceOrderLoading, setWorkspaceOrderLoading] = useState(false)
  const [workspaceOrderSaving, setWorkspaceOrderSaving] = useState(false)
  const [workspaceOrderError, setWorkspaceOrderError] = useState<string | null>(null)
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceLaunchTarget | null>(null)
  const [workspaceTargetLoading, setWorkspaceTargetLoading] = useState(false)
  const [workspaceTargetAction, setWorkspaceTargetAction] = useState<string | null>(null)
  const [workspaceTargetError, setWorkspaceTargetError] = useState<string | null>(null)
  const [draggedRepositoryKey, setDraggedRepositoryKey] = useState<string | null>(null)
  const [repositoryDropTarget, setRepositoryDropTarget] = useState<string | null>(null)
  const [repositoryLayout, setRepositoryLayout] = useState<RepositoryLayout>('list')
  const [repositoryPage, setRepositoryPage] = useState(1)
  const [cloningRepository, setCloningRepository] = useState<string | null>(null)
  const [cloneResult, setCloneResult] = useState<{ fullName: string; path: string } | null>(null)
  const [publishRepository, setPublishRepository] = useState<GitHubRepository | null>(null)
  const [publishAccountId, setPublishAccountId] = useState<string | null>(null)
  const [publishOwner, setPublishOwner] = useState('')
  const [publishName, setPublishName] = useState('')
  const [publishDescription, setPublishDescription] = useState('')
  const [publishPrivate, setPublishPrivate] = useState(true)
  const [publishSaving, setPublishSaving] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const repositoryResultsScrollRef = useRef<HTMLDivElement>(null)
  const automaticInsightScanPathsRef = useRef(new Set<string>())
  const [connectOpen, setConnectOpen] = useState(false)
  const [authorizationState, setAuthorizationState] = useState<AuthorizationState>('idle')
  const [authorization, setAuthorization] = useState<GitHubDeviceAuthorization | null>(null)
  const [authorizationError, setAuthorizationError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [savedSettings, setSavedSettings] = useState<AppSettings>(defaultSettings)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [updateState, setUpdateState] = useState<AppUpdateState>(emptyUpdateState)
  const [updateAction, setUpdateAction] = useState<'check' | 'download' | 'install' | null>(null)
  const [configurationSync, setConfigurationSync] = useState<ConfigurationSyncState>(
    emptyConfigurationSyncState,
  )
  const [configurationSyncLoading, setConfigurationSyncLoading] = useState(true)
  const [configurationSyncAction, setConfigurationSyncAction] =
    useState<ConfigurationSyncAction | 'setup' | null>(null)
  const [configurationSyncError, setConfigurationSyncError] = useState<string | null>(null)
  const [configurationSetupOpen, setConfigurationSetupOpen] = useState(false)
  const [configurationSetupMode, setConfigurationSetupMode] =
    useState<'create' | 'remote' | 'local'>('create')
  const [configurationSetupAccountId, setConfigurationSetupAccountId] =
    useState<string | null>(null)
  const [configurationSetupOwner, setConfigurationSetupOwner] = useState('')
  const [configurationSetupName, setConfigurationSetupName] = useState('myrepos-config')
  const [configurationSetupPrivate, setConfigurationSetupPrivate] = useState(true)
  const [configurationSetupAutoSync, setConfigurationSetupAutoSync] = useState(true)
  const [configurationRemoteRepositories, setConfigurationRemoteRepositories] =
    useState<GitHubRepository[]>([])
  const [configurationRemoteRepository, setConfigurationRemoteRepository] =
    useState<string | null>(null)
  const [configurationRemoteLoading, setConfigurationRemoteLoading] = useState(false)
  const [gitRepository, setGitRepository] = useState<GitHubRepository | null>(null)
  const [gitDetails, setGitDetails] = useState<RepositoryGitDetails | null>(null)
  const [filesPanelTab, setFilesPanelTab] = useState<FilesPanelTab>('changes')
  const [fileSearch, setFileSearch] = useState('')
  const [gitHistory, setGitHistory] = useState<RepositoryCommit[]>([])
  const [gitPanelLoading, setGitPanelLoading] = useState(false)
  const [gitAction, setGitAction] = useState<string | null>(null)
  const [cardGitAction, setCardGitAction] = useState<string | null>(null)
  const [cardCommitRepository, setCardCommitRepository] = useState<GitHubRepository | null>(null)
  const [cardCommitAll, setCardCommitAll] = useState(false)
  const [cardCommitSync, setCardCommitSync] = useState(false)
  const [cardCommitMessage, setCardCommitMessage] = useState('')
  const [cardCommitError, setCardCommitError] = useState<string | null>(null)
  const [insightsRepository, setInsightsRepository] = useState<GitHubRepository | null>(null)
  const [insightsResult, setInsightsResult] = useState<ProjectInsightsResult | null>(null)
  const [insightsCache, setInsightsCache] = useState<Record<string, ProjectInsightsResult>>({})
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const [insightsMode, setInsightsMode] = useState<InsightsMode>('manual')
  const [insightsTab, setInsightsTab] = useState<InsightsTab>('overview')
  const [insightsTechnologyTab, setInsightsTechnologyTab] = useState<TechnologyCategory>('framework')
  const [insightsSearch, setInsightsSearch] = useState('')
  const [insightsCategory, setInsightsCategory] = useState<string | null>('all')
  const [insightsLanguage, setInsightsLanguage] = useState<string | null>('all')
  const [insightsExtension, setInsightsExtension] = useState<string | null>('all')
  const [insightsProject, setInsightsProject] = useState<string | null>('all')
  const [insightsMetric, setInsightsMetric] = useState<InsightsMetric>('all')
  const [gitError, setGitError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [diffTitle, setDiffTitle] = useState<string | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null)
  const [selectedCommitFiles, setSelectedCommitFiles] = useState<RepositoryCommitFile[]>([])
  const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(null)
  const [relativeTimeNow, setRelativeTimeNow] = useState(Date.now())
  const [windowMaximized, setWindowMaximized] = useState(false)
  const platform =
    window.desktop?.platform ??
    (navigator.userAgent.includes('Macintosh') ? 'darwin' : 'unknown')

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (platform !== 'win32' || !window.desktop) return
    void window.desktop.windowControls.isMaximized().then(setWindowMaximized)
    return window.desktop.windowControls.onMaximizedChanged(setWindowMaximized)
  }, [platform])

  useEffect(() => {
    if (sidebarWidth > 72 && sidebarWidth < 190) setSidebarWidth(72)
  }, [sidebarWidth])

  useEffect(() => {
    if (organizationCatalog.workspaces.length === 0) {
      setSelectedWorkspaceId(null)
      if (repositoryTab === 'workspace') setRepositoryTab('local')
      return
    }
    if (!selectedWorkspaceId ||
      !organizationCatalog.workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(organizationCatalog.workspaces[0].id)
    }
  }, [organizationCatalog.workspaces, repositoryTab, selectedWorkspaceId])

  useEffect(() => {
    if (!window.desktop || !selectedWorkspaceId) {
      setWorkspaceRepositoryOrder([])
      return
    }
    let cancelled = false
    setWorkspaceOrderLoading(true)
    setWorkspaceOrderError(null)
    window.desktop.organization.workspaceOrder(selectedWorkspaceId)
      .then((order) => {
        if (!cancelled) setWorkspaceRepositoryOrder(order)
      })
      .catch((error) => {
        if (!cancelled) setWorkspaceOrderError(errorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setWorkspaceOrderLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedWorkspaceId, organizationCatalog.workspaces])

  useEffect(() => {
    if (!window.desktop || !selectedWorkspaceId) {
      setWorkspaceTarget(null)
      setWorkspaceTargetLoading(false)
      return
    }
    let cancelled = false
    setWorkspaceTargetLoading(true)
    setWorkspaceTargetError(null)
    window.desktop.organization.workspaceTarget(selectedWorkspaceId)
      .then((target) => { if (!cancelled) setWorkspaceTarget(target) })
      .catch((error) => { if (!cancelled) setWorkspaceTargetError(errorMessage(error)) })
      .finally(() => { if (!cancelled) setWorkspaceTargetLoading(false) })
    return () => { cancelled = true }
  }, [selectedWorkspaceId])

  useEffect(() => {
    if (!window.desktop) return
    let cancelled = false
    const loadOrganization = async (): Promise<void> => {
      try {
        const [catalog, assignments, appearances] = await Promise.all([
          window.desktop!.organization.list(),
          window.desktop!.organization.assignments(),
          window.desktop!.organization.appearances(),
        ])
        if (cancelled) return
        setOrganizationCatalog(catalog)
        setOrganizationAssignments(Object.fromEntries(
          assignments.map((entry) => [entry.repositoryKey, {
            workspaceIds: entry.workspaceIds,
            groupIds: entry.groupIds,
            tagIds: entry.tagIds,
          }]),
        ))
        setRepositoryColors(Object.fromEntries(appearances.flatMap((entry) =>
          entry.color ? [[entry.repositoryKey, entry.color]] : [])))
      } catch (error) {
        if (!cancelled) setOrganizationError(errorMessage(error))
      }
    }
    void loadOrganization()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const loadAccounts = async (): Promise<void> => {
      if (!window.desktop) {
        setAccountsLoading(false)
        return
      }

      try {
        const connectedAccounts = await window.desktop.accounts.list()
        setAccounts(connectedAccounts)
        setSelectedAccountId((current) => current ?? 'all')
      } catch (error) {
        setAccountsError(errorMessage(error))
      } finally {
        setAccountsLoading(false)
      }
    }

    void loadAccounts()
  }, [])

  useEffect(() => {
    const loadSettings = async (): Promise<void> => {
      if (!window.desktop) {
        setSettingsLoading(false)
        return
      }

      try {
        const storedSettings = await window.desktop.settings.get()
        setSettings(storedSettings)
        setSavedSettings(storedSettings)
      } catch (error) {
        setSettingsError(errorMessage(error))
      } finally {
        setSettingsLoading(false)
      }
    }

    void loadSettings()
  }, [])

  useEffect(() => {
    if (!window.desktop) return
    let cancelled = false
    void window.desktop.updates.getState()
      .then((state) => { if (!cancelled) setUpdateState(state) })
      .catch((error) => {
        if (!cancelled) {
          setUpdateState((current) => ({ ...current, phase: 'error', message: errorMessage(error) }))
        }
      })
    const unsubscribe = window.desktop.updates.onStateChanged((state) => {
      if (!cancelled) setUpdateState(state)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!window.desktop) {
      setConfigurationSyncLoading(false)
      return
    }
    let cancelled = false
    void window.desktop.configurationSync.get()
      .then((state) => { if (!cancelled) setConfigurationSync(state) })
      .catch((error) => { if (!cancelled) setConfigurationSyncError(errorMessage(error)) })
      .finally(() => { if (!cancelled) setConfigurationSyncLoading(false) })
    const unsubscribe = window.desktop.configurationSync.onChanged((state) => {
      if (cancelled) return
      setConfigurationSync(state)
      void Promise.all([
        window.desktop!.organization.list(),
        window.desktop!.organization.assignments(),
        window.desktop!.organization.appearances(),
      ]).then(([catalog, assignments, appearances]) => {
        if (cancelled) return
        setOrganizationCatalog(catalog)
        setOrganizationAssignments(Object.fromEntries(assignments.map((entry) => [
          entry.repositoryKey,
          {
            workspaceIds: entry.workspaceIds,
            groupIds: entry.groupIds,
            tagIds: entry.tagIds,
          },
        ])))
        setRepositoryColors(Object.fromEntries(appearances.flatMap((entry) =>
          entry.color ? [[entry.repositoryKey, entry.color]] : [])))
      }).catch((error) => {
        if (!cancelled) setConfigurationSyncError(errorMessage(error))
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!window.desktop) return
    return window.desktop.repositories.onStatusChanged((status) => {
      setGitStatuses((current) => ({ ...current, [status.path]: status }))
    })
  }, [])

  useEffect(() => {
    if (!window.desktop) return
    let cancelled = false
    const pending = repositories.filter((repository) => repository.localPath &&
      localStorage.getItem(`myrepos:insights-mode:${repository.localPath}`) === 'automatic' &&
      !automaticInsightScanPathsRef.current.has(repository.localPath))
    for (const repository of pending) automaticInsightScanPathsRef.current.add(repository.localPath!)
    void (async () => {
      for (const repository of pending) {
        if (cancelled || !repository.localPath) return
        try {
          const result = await window.desktop!.repositories.scanInsights(repository.localPath)
          if (!cancelled) setInsightsCache((current) => ({ ...current, [repository.localPath!]: result }))
        } catch {
          // Background automatic scans remain quiet; opening Insights shows actionable errors.
        }
      }
    })()
    return () => { cancelled = true }
  }, [repositories])

  useEffect(() => {
    if (activeView !== 'repositories' || !selectedAccountId || !window.desktop) return
    let cancelled = false

    const loadRepositories = async (): Promise<void> => {
      setRepositoriesLoading(true)
      setRepositoriesError(null)
      setCloneResult(null)
      setRepositoryPage(1)
      setRepositories([])
      const accountId = selectedAccountId === 'all' ? null : Number(selectedAccountId)

      try {
        const localRepositories = await window.desktop!.repositories.listCloned(accountId)
        if (cancelled) return
        setRepositories(localRepositories)

        try {
          const remoteRepositories = await window.desktop!.repositories.list(accountId)
          if (!cancelled) {
            setRepositories(mergeRepositoryDetails(localRepositories, remoteRepositories))
          }
        } catch (error) {
          if (!cancelled) setRepositoriesError(errorMessage(error))
        }
      } catch (error) {
        if (!cancelled) setRepositoriesError(errorMessage(error))
      } finally {
        if (!cancelled) setRepositoriesLoading(false)
      }
    }

    void loadRepositories()
    return () => {
      cancelled = true
    }
  }, [activeView, selectedAccountId])

  const selectedAccount = accounts.find((account) => String(account.id) === selectedAccountId)
  const searchedRepositories = repositories.filter((repository) => {
    const query = repositorySearch.trim().toLowerCase()
    if (!query) return true
    return [repository.fullName, repository.description ?? '', repository.language ?? '']
      .some((value) => value.toLowerCase().includes(query))
  })
  const localRepositoryCount = repositories.filter((repository) => repository.localPath).length
  const githubOnlyRepositoryCount = repositories.length - localRepositoryCount
  const selectedWorkspace = organizationCatalog.workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  ) ?? null
  const selectedWorkspaceRepositoryCount = selectedWorkspaceId
    ? repositories.filter((repository) =>
      organizationAssignments[repositoryOrganizationKey(repository)]?.workspaceIds
        .includes(selectedWorkspaceId)).length
    : 0
  const activeRepositoryOrganizationFilterCount =
    (repositoryTab === 'workspace' ? 0 : repositoryOrganizationFilters.workspaceIds.length) +
    repositoryOrganizationFilters.groupIds.length +
    repositoryOrganizationFilters.tagIds.length
  const organizationFilteredRepositories = searchedRepositories.filter((repository) => {
    const assignment = organizationAssignments[repositoryOrganizationKey(repository)] ??
      emptyRepositoryOrganization()
    const matches = (filters: string[], assigned: string[]): boolean =>
      filters.length === 0 || filters.some((id) => assigned.includes(id))
    return (repositoryTab === 'workspace' ||
      matches(repositoryOrganizationFilters.workspaceIds, assignment.workspaceIds)) &&
      matches(repositoryOrganizationFilters.groupIds, assignment.groupIds) &&
      matches(repositoryOrganizationFilters.tagIds, assignment.tagIds)
  })
  const workspaceOrderIndex = new Map(
    workspaceRepositoryOrder.map((repositoryKey, index) => [repositoryKey, index]),
  )
  const visibleRepositories = organizationFilteredRepositories.filter((repository) => {
    if (repositoryTab === 'local') return Boolean(repository.localPath)
    if (repositoryTab === 'github') return !repository.localPath
    if (!selectedWorkspaceId) return false
    return organizationAssignments[repositoryOrganizationKey(repository)]?.workspaceIds
      .includes(selectedWorkspaceId) ?? false
  }).sort((left, right) => repositoryTab === 'workspace'
    ? (workspaceOrderIndex.get(repositoryOrganizationKey(left)) ?? Number.MAX_SAFE_INTEGER) -
      (workspaceOrderIndex.get(repositoryOrganizationKey(right)) ?? Number.MAX_SAFE_INTEGER)
    : 0)
  const repositoryPageCount = Math.max(
    1,
    Math.ceil(visibleRepositories.length / repositoriesPerPage),
  )
  const pagedRepositories = visibleRepositories.slice(
    (repositoryPage - 1) * repositoriesPerPage,
    repositoryPage * repositoriesPerPage,
  )
  const listedRepositoryStatuses = pagedRepositories.flatMap((repository) => {
    if (!repository.localPath) return []
    const status = gitStatuses[repository.localPath]
    return status && !status.error ? [status] : []
  })
  const listedRepositoriesWithChanges = listedRepositoryStatuses.filter((status) =>
    status.staged + status.unstaged + status.untracked + status.conflicts > 0)
  const listedChangeCount = listedRepositoriesWithChanges.reduce((total, status) =>
    total + status.staged + status.unstaged + status.untracked + status.conflicts, 0)
  const listedConflictCount = listedRepositoriesWithChanges.reduce((total, status) =>
    total + status.conflicts, 0)
  const listedPushNeededCount = listedRepositoryStatuses.filter((status) => status.ahead > 0).length
  const listedPullNeededCount = listedRepositoryStatuses.filter((status) => status.behind > 0).length
  const listedHasStatus = listedConflictCount > 0 || listedChangeCount > 0 ||
    listedPushNeededCount > 0 || listedPullNeededCount > 0
  const selectedRepositories = repositories.filter((repository) =>
    selectedRepositoryKeys.includes(repositoryOrganizationKey(repository)),
  )
  const visibleLocalRepositories = visibleRepositories.filter((repository) => repository.localPath)
  const selectedLocalRepositories = selectedRepositories.filter((repository) => repository.localPath)
  const bulkGitRepositories = bulkGitTarget === 'selected'
    ? selectedLocalRepositories
    : visibleLocalRepositories
  const pagedRepositoryKeys = pagedRepositories.map(repositoryOrganizationKey)
  const selectedOnPageCount = pagedRepositoryKeys.filter((key) =>
    selectedRepositoryKeys.includes(key),
  ).length
  const allRepositoriesOnPageSelected = pagedRepositoryKeys.length > 0 &&
    selectedOnPageCount === pagedRepositoryKeys.length
  const activeRepositoryOrganizationFilters = organizationKinds.flatMap((kind) => {
    const field = organizationFieldForKind[kind]
    const catalogField = organizationCopy[kind].catalogField
    return organizationCatalog[catalogField]
      .filter((item) => repositoryOrganizationFilters[field].includes(item.id))
  })
  const workspaceReorderEnabled = repositoryTab === 'workspace' &&
    !workspaceOrderLoading && !workspaceOrderSaving && !repositorySearch.trim() &&
    activeRepositoryOrganizationFilterCount === 0
  const monitoredPaths = activeView === 'repositories'
    ? pagedRepositories.flatMap((repository) => repository.localPath ? [repository.localPath] : [])
    : []
  const monitoredPathsKey = JSON.stringify(monitoredPaths)

  useEffect(() => {
    if (!window.desktop) return
    let cancelled = false

    void window.desktop.repositories.monitor(monitoredPaths).then((statuses) => {
      if (cancelled) return
      setGitStatuses((current) => {
        const next = { ...current }
        for (const status of statuses) next[status.path] = status
        return next
      })
    }).catch((error) => {
      if (!cancelled) setRepositoriesError(errorMessage(error))
    })

    return () => {
      cancelled = true
    }
  }, [monitoredPathsKey])

  const resetAuthorization = (): void => {
    setAuthorizationState('idle')
    setAuthorization(null)
    setAuthorizationError(null)
  }

  const closeConnect = (): void => {
    if (authorization && window.desktop) {
      void window.desktop.github.cancel(authorization.requestId)
    }
    setConnectOpen(false)
    resetAuthorization()
  }

  const beginAuthorization = async (): Promise<void> => {
    if (!window.desktop) {
      setAuthorizationError('GitHub sign-in is available in the MyRepos desktop app.')
      return
    }

    setAuthorizationState('starting')
    setAuthorizationError(null)

    try {
      const request = await window.desktop.github.start()
      setAuthorization(request)
      setAuthorizationState('waiting')
      await window.desktop.github.launch(request.requestId)
      const connectedAccount = await window.desktop.github.waitForAuthorization(request.requestId)

      setAccounts((current) => [
        ...current.filter((account) => account.id !== connectedAccount.id),
        connectedAccount,
      ])
      setSelectedAccountId('all')
      setConnectOpen(false)
      resetAuthorization()
    } catch (error) {
      const message = errorMessage(error)
      if (message.toLowerCase().includes('cancelled')) {
        resetAuthorization()
      } else {
        setAuthorizationState('idle')
        setAuthorizationError(message)
      }
    }
  }

  const removeConnectedAccount = async (account: GitHubAccount): Promise<void> => {
    if (!window.desktop) return
    if (!window.confirm(`Remove @${account.login} from MyRepos?`)) return

    try {
      const remainingAccounts = await window.desktop.accounts.remove(account.id)
      setAccounts(remainingAccounts)
      if (selectedAccountId === String(account.id)) {
        setSelectedAccountId('all')
      }
      setAccountsError(null)
    } catch (error) {
      setAccountsError(errorMessage(error))
    }
  }

  const refreshRepositories = async (): Promise<void> => {
    if (!window.desktop || !selectedAccountId) return
    setRepositoriesLoading(true)
    setRepositoriesError(null)
    const accountId = selectedAccountId === 'all' ? null : Number(selectedAccountId)

    try {
      const localRepositories = await window.desktop.repositories.listCloned(accountId)
      setRepositories(localRepositories)
      const remoteRepositories = await window.desktop.repositories.list(accountId)
      setRepositories(mergeRepositoryDetails(localRepositories, remoteRepositories))
      setRepositoryPage(1)
    } catch (error) {
      setRepositoriesError(errorMessage(error))
    } finally {
      setRepositoriesLoading(false)
    }
  }

  const changeRepositoryPage = (page: number): void => {
    setRepositoryPage(page)
    repositoryResultsScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cloneRepository = async (repository: GitHubRepository): Promise<void> => {
    if (!window.desktop || !selectedAccountId) return
    setCloningRepository(repository.fullName)
    setRepositoriesError(null)
    setCloneResult(null)

    try {
      const result = await window.desktop.repositories.clone(
        repository.accountId,
        repository.fullName,
      )
      if (result) {
        setCloneResult({ fullName: repository.fullName, path: result.path })
        setRepositories((current) => current.map((item) =>
          item.fullName === repository.fullName
            ? { ...item, localPath: result.path }
            : item,
        ))
        if (repositoryTab !== 'workspace') setRepositoryTab('local')
        setRepositoryPage(1)
      }
    } catch (error) {
      setRepositoriesError(errorMessage(error))
    } finally {
      setCloningRepository(null)
    }
  }

  const locateRepository = async (repository: GitHubRepository): Promise<void> => {
    if (!window.desktop || !selectedAccountId) return
    setRepositoriesError(null)

    try {
      const result = await window.desktop.repositories.locate(
        repository.accountId,
        repository.fullName,
      )
      if (!result) return

      setRepositories((current) => current.map((item) =>
        item.fullName === repository.fullName
          ? { ...item, localPath: result.path }
          : item,
      ))
      setCloneResult({ fullName: repository.fullName, path: result.path })
      if (repositoryTab !== 'workspace') setRepositoryTab('local')
      setRepositoryPage(1)
    } catch (error) {
      setRepositoriesError(errorMessage(error))
    }
  }

  const addLocalRepository = async (forPublishing = false): Promise<void> => {
    if (!window.desktop || !selectedAccountId) return
    setRepositoriesError(null)

    try {
      const requestedAccountId = selectedAccountId === 'all'
        ? forPublishing ? accounts[0]?.id ?? null : null
        : Number(selectedAccountId)
      const repository = await window.desktop.repositories.addLocal(
        requestedAccountId,
        forPublishing,
      )
      if (!repository) return
      setRepositories((current) => mergeRepositoryDetails([repository], current))
      setCloneResult({ fullName: repository.fullName, path: repository.localPath! })
      setRepositoryTab('local')
      setRepositoryPage(1)
      if (forPublishing) openPublishRepository(repository)
      void refreshRepositories()
    } catch (error) {
      setRepositoriesError(errorMessage(error))
    }
  }

  const openPublishRepository = (repository: GitHubRepository): void => {
    const account = accounts.find((item) => item.id === repository.accountId) ?? accounts[0]
    const [existingOwner, existingName] = repository.fullName.split('/', 2)
    setPublishRepository(repository)
    setPublishAccountId(account ? String(account.id) : null)
    setPublishOwner(repository.profileUrl && existingOwner ? existingOwner : account?.login ?? '')
    setPublishName(existingName || repository.name)
    setPublishDescription(repository.description ?? '')
    setPublishPrivate(true)
    setPublishError(null)
  }

  const publishLocalRepository = async (): Promise<void> => {
    if (!window.desktop || !publishRepository?.localPath || !publishAccountId) return
    const oldKey = repositoryOrganizationKey(publishRepository)
    setPublishSaving(true)
    setPublishError(null)
    try {
      const result = await window.desktop.repositories.publish({
        path: publishRepository.localPath,
        accountId: Number(publishAccountId),
        owner: publishOwner.trim(),
        name: publishName.trim(),
        description: publishDescription.trim(),
        private: publishPrivate,
      })
      const newKey = repositoryOrganizationKey(result.repository)
      setRepositories((current) => {
        const withoutPublishedPath = current.filter((item) =>
          item.localPath !== result.repository.localPath &&
          repositoryOrganizationKey(item) !== newKey)
        return [result.repository, ...withoutPublishedPath]
      })
      setGitStatuses((current) => ({ ...current, [result.status.path]: result.status }))
      if (oldKey !== newKey) {
        setOrganizationAssignments((current) => {
          const next = { ...current }
          if (next[oldKey]) next[newKey] = next[oldKey]
          delete next[oldKey]
          return next
        })
        setRepositoryColors((current) => {
          const next = { ...current }
          if (next[oldKey]) next[newKey] = next[oldKey]
          delete next[oldKey]
          return next
        })
        setSelectedRepositoryKeys((current) => current.map((key) => key === oldKey ? newKey : key))
      }
      setCloneResult({ fullName: result.repository.fullName, path: result.repository.localPath! })
      setPublishRepository(null)
      setRelativeTimeNow(Date.now())
    } catch (error) {
      setPublishError(errorMessage(error))
    } finally {
      setPublishSaving(false)
    }
  }

  const openRepositoryInVSCode = async (path: string): Promise<void> => {
    if (!window.desktop) return
    setRepositoriesError(null)

    try {
      await window.desktop.repositories.openInVSCode(path)
    } catch (error) {
      setRepositoriesError(errorMessage(error))
    }
  }

  const applyGitDetails = (details: RepositoryGitDetails): void => {
    setGitDetails(details)
    setGitStatuses((current) => ({ ...current, [details.status.path]: details.status }))
  }

  const openGitPanel = async (repository: GitHubRepository): Promise<void> => {
    if (!window.desktop || !repository.localPath) return
    setRepositoryLayout('list')
    setGitRepository(repository)
    setGitDetails(null)
    setFilesPanelTab('changes')
    setFileSearch('')
    setGitHistory([])
    setGitError(null)
    setCommitMessage('')
    setCommitDescription('')
    setDiffTitle(null)
    setDiffText(null)
    setSelectedDiffPath(null)
    setSelectedCommitHash(null)
    setSelectedCommitFiles([])
    setSelectedCommitFile(null)
    setGitPanelLoading(true)

    try {
      const [details, history] = await Promise.all([
        window.desktop.repositories.gitDetails(repository.localPath),
        window.desktop.repositories.gitHistory(repository.localPath).catch(() => []),
      ])
      applyGitDetails(details)
      setGitHistory(history)
      const firstFile = details.files[0]
      if (firstFile) {
        const staged = firstFile.staged && !firstFile.unstaged
        const diff = await window.desktop.repositories.gitDiff(repository.localPath, firstFile.path, staged)
        setSelectedDiffPath(firstFile.path)
        setDiffTitle(firstFile.path)
        setDiffText(diff || 'No textual diff is available for this file.')
      }
    } catch (error) {
      setGitError(errorMessage(error))
    } finally {
      setGitPanelLoading(false)
    }
  }

  const runGitAction = async (
    action: string,
    operation: () => Promise<RepositoryGitDetails>,
  ): Promise<boolean> => {
    setGitAction(action)
    setGitError(null)
    try {
      applyGitDetails(await operation())
      if (gitRepository?.localPath && ['commit', 'fetch', 'pull', 'push'].includes(action)) {
        setGitHistory(await window.desktop!.repositories.gitHistory(gitRepository.localPath))
      }
      setDiffTitle(null)
      setDiffText(null)
      return true
    } catch (error) {
      setGitError(errorMessage(error))
      return false
    } finally {
      setGitAction(null)
    }
  }

  const runCardGitAction = async (
    repository: GitHubRepository,
    action: 'pull' | 'push',
  ): Promise<void> => {
    if (!window.desktop || !repository.localPath) return

    const actionKey = `${action}:${repository.localPath}`
    setCardGitAction(actionKey)
    setRepositoriesError(null)
    try {
      const details = action === 'pull'
        ? await window.desktop.repositories.gitPull(repository.localPath)
        : await window.desktop.repositories.gitPush(repository.localPath)
      setGitStatuses((current) => ({ ...current, [details.status.path]: details.status }))
    } catch (error) {
      setRepositoriesError(errorMessage(error))
    } finally {
      setCardGitAction(null)
    }
  }

  const openCardCommit = (
    repository: GitHubRepository,
    stageAll: boolean,
    syncAfterCommit = false,
  ): void => {
    setCardCommitRepository(repository)
    setCardCommitAll(stageAll)
    setCardCommitSync(syncAfterCommit)
    setCardCommitMessage('')
    setCardCommitError(null)
  }

  const syncRepository = async (repository: GitHubRepository): Promise<void> => {
    if (!window.desktop || !repository.localPath) return
    const repositoryPath = repository.localPath
    setCardGitAction(`sync:${repositoryPath}`)
    setRepositoriesError(null)
    try {
      const pulledDetails = await window.desktop.repositories.gitPull(repositoryPath)
      setGitStatuses((current) => ({
        ...current,
        [pulledDetails.status.path]: pulledDetails.status,
      }))
      const details = await window.desktop.repositories.gitPush(repositoryPath)
      setGitStatuses((current) => ({ ...current, [details.status.path]: details.status }))
      const syncedAt = new Date().toISOString()
      setRepositories((current) => current.map((item) =>
        item.localPath === repositoryPath ? { ...item, lastSyncedAt: syncedAt } : item,
      ))
      setRelativeTimeNow(Date.now())
    } catch (error) {
      setRepositoriesError(errorMessage(error))
    } finally {
      setCardGitAction(null)
    }
  }

  const openBulkGit = (target: BulkGitTarget): void => {
    setBulkGitTarget(target)
    setBulkGitOperation('sync')
    setBulkGitResults([])
    setBulkGitOpen(true)
  }

  const runBulkGitOperation = async (): Promise<void> => {
    if (!window.desktop || bulkGitRepositories.length === 0) return
    const targets = [...bulkGitRepositories]
    setBulkGitRunning(true)
    setBulkGitResults(targets.map((repository) => ({
      repositoryKey: repositoryOrganizationKey(repository),
      fullName: repository.fullName,
      status: 'pending',
    })))

    for (const repository of targets) {
      const repositoryKey = repositoryOrganizationKey(repository)
      const repositoryPath = repository.localPath!
      setBulkGitResults((current) => current.map((result) =>
        result.repositoryKey === repositoryKey ? { ...result, status: 'running' } : result))
      try {
        let details: RepositoryGitDetails
        if (bulkGitOperation === 'sync') {
          await window.desktop.repositories.gitPull(repositoryPath)
          details = await window.desktop.repositories.gitPush(repositoryPath)
        } else if (bulkGitOperation === 'fetch') {
          details = await window.desktop.repositories.gitFetch(repositoryPath)
        } else if (bulkGitOperation === 'pull') {
          details = await window.desktop.repositories.gitPull(repositoryPath)
        } else {
          details = await window.desktop.repositories.gitPush(repositoryPath)
        }
        setGitStatuses((current) => ({ ...current, [details.status.path]: details.status }))
        if (bulkGitOperation === 'sync') {
          const syncedAt = new Date().toISOString()
          setRepositories((current) => current.map((item) =>
            item.localPath === repositoryPath ? { ...item, lastSyncedAt: syncedAt } : item,
          ))
        }
        setBulkGitResults((current) => current.map((result) =>
          result.repositoryKey === repositoryKey
            ? { ...result, status: 'success', message: 'Completed' }
            : result))
      } catch (error) {
        setBulkGitResults((current) => current.map((result) =>
          result.repositoryKey === repositoryKey
            ? { ...result, status: 'error', message: errorMessage(error) }
            : result))
        try {
          const details = await window.desktop.repositories.gitDetails(repositoryPath)
          setGitStatuses((current) => ({ ...current, [details.status.path]: details.status }))
        } catch {
          // Preserve the action error; refreshing status is best-effort.
        }
      }
    }

    setRelativeTimeNow(Date.now())
    setBulkGitRunning(false)
  }

  const commitFromCard = async (): Promise<void> => {
    if (!window.desktop || !cardCommitRepository?.localPath) return
    const message = cardCommitMessage.trim()
    if (!message) {
      setCardCommitError('Enter a commit message.')
      return
    }

    const repositoryPath = cardCommitRepository.localPath
    setCardGitAction(`${cardCommitSync ? 'sync' : 'commit'}:${repositoryPath}`)
    setCardCommitError(null)
    try {
      if (cardCommitAll) await window.desktop.repositories.gitStage(repositoryPath, [])
      let details = await window.desktop.repositories.gitCommit(repositoryPath, message)
      setGitStatuses((current) => ({ ...current, [details.status.path]: details.status }))
      if (cardCommitSync) {
        try {
          await window.desktop.repositories.gitPull(repositoryPath)
          details = await window.desktop.repositories.gitPush(repositoryPath)
          const syncedAt = new Date().toISOString()
          setRepositories((current) => current.map((item) =>
            item.localPath === repositoryPath ? { ...item, lastSyncedAt: syncedAt } : item,
          ))
          setRelativeTimeNow(Date.now())
        } catch (error) {
          setCardCommitRepository(null)
          setRepositoriesError(`Commit succeeded, but sync failed: ${errorMessage(error)}`)
          return
        }
      }
      setGitStatuses((current) => ({ ...current, [details.status.path]: details.status }))
      setCardCommitRepository(null)
      setCardCommitMessage('')
      setCardCommitSync(false)
    } catch (error) {
      setCardCommitError(errorMessage(error))
    } finally {
      setCardGitAction(null)
    }
  }

  const showFileDiff = async (file: RepositoryChangedFile, staged: boolean): Promise<void> => {
    if (!window.desktop || !gitRepository?.localPath) return
    const action = `diff:${staged ? 'staged' : 'working'}:${file.path}`
    setGitAction(action)
    setGitError(null)
    setSelectedDiffPath(file.path)
    setSelectedCommitHash(null)
    try {
      const diff = await window.desktop.repositories.gitDiff(
        gitRepository.localPath,
        file.path,
        staged,
      )
      setDiffTitle(file.path)
      setDiffText(diff || 'No textual diff is available for this file.')
    } catch (error) {
      setGitError(errorMessage(error))
    } finally {
      setGitAction(null)
    }
  }

  const showCommitDiff = async (commit: RepositoryCommit): Promise<void> => {
    if (!window.desktop || !gitRepository?.localPath) return
    setGitAction(`history:${commit.hash}`)
    setGitError(null)
    setSelectedDiffPath(null)
    setSelectedCommitHash(commit.hash)
    setSelectedCommitFiles([])
    setSelectedCommitFile(null)
    try {
      const files = await window.desktop.repositories.gitCommitFiles(
        gitRepository.localPath,
        commit.hash,
      )
      setSelectedCommitFiles(files)
      setDiffTitle(`${commit.shortHash} · ${commit.subject}`)
      const firstFile = files[0]
      if (firstFile) {
        const diff = await window.desktop.repositories.gitCommitFileDiff(
          gitRepository.localPath,
          commit.hash,
          firstFile.path,
        )
        setSelectedCommitFile(firstFile.path)
        setDiffText(diff || 'This file has no textual diff.')
      } else {
        setDiffText('This commit has no textual diff.')
      }
    } catch (error) {
      setGitError(errorMessage(error))
    } finally {
      setGitAction(null)
    }
  }

  const showCommitFileDiff = async (file: RepositoryCommitFile): Promise<void> => {
    if (!window.desktop || !gitRepository?.localPath || !selectedCommitHash) return
    setGitAction(`history-file:${file.path}`)
    setGitError(null)
    setSelectedCommitFile(file.path)
    try {
      const diff = await window.desktop.repositories.gitCommitFileDiff(
        gitRepository.localPath,
        selectedCommitHash,
        file.path,
      )
      setDiffText(diff || 'This file has no textual diff.')
    } catch (error) {
      setGitError(errorMessage(error))
    } finally {
      setGitAction(null)
    }
  }

  const openOrganizeRepository = (repository: GitHubRepository): void => {
    setOrganizeRepository(repository)
    setOrganizationDraft(
      organizationAssignments[repositoryOrganizationKey(repository)] ?? emptyRepositoryOrganization(),
    )
    setOrganizationError(null)
    setRepositoryColorDraft(repositoryColors[repositoryOrganizationKey(repository)] ?? '')
    setNewOrganizationNames({ workspace: '', group: '', tag: '' })
  }

  const toggleOrganizationAssignment = (kind: OrganizationKind, id: string): void => {
    const field = organizationFieldForKind[kind]
    setOrganizationDraft((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((itemId) => itemId !== id)
        : [...current[field], id],
    }))
  }

  const createOrganizationItem = async (kind: OrganizationKind): Promise<void> => {
    if (!window.desktop) return
    const name = newOrganizationNames[kind].trim()
    if (!name) return
    setOrganizationLoading(true)
    setOrganizationError(null)
    try {
      const item = await window.desktop.organization.create(kind, {
        name,
        color: organizationDefaultColor[kind],
      })
      const catalogField = kind === 'workspace' ? 'workspaces' : kind === 'group' ? 'groups' : 'tags'
      setOrganizationCatalog((current) => ({
        ...current,
        [catalogField]: [...current[catalogField], item].sort((left, right) =>
          left.name.localeCompare(right.name)),
      }))
      setNewOrganizationNames((current) => ({ ...current, [kind]: '' }))
      const assignmentField = organizationFieldForKind[kind]
      setOrganizationDraft((current) => ({
        ...current,
        [assignmentField]: [...current[assignmentField], item.id],
      }))
    } catch (error) {
      setOrganizationError(errorMessage(error))
    } finally {
      setOrganizationLoading(false)
    }
  }

  const saveRepositoryOrganization = async (): Promise<void> => {
    if (!window.desktop || !organizeRepository) return
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      const entry = await window.desktop.organization.saveRepository(
        organizeRepository.accountId,
        organizeRepository.fullName,
        organizationDraft,
      )
      setOrganizationAssignments((current) => ({
        ...current,
        [entry.repositoryKey]: {
          workspaceIds: entry.workspaceIds,
          groupIds: entry.groupIds,
          tagIds: entry.tagIds,
        },
      }))
      const appearance = await window.desktop.organization.saveRepositoryColor(
        organizeRepository.accountId,
        organizeRepository.fullName,
        repositoryColorDraft || null,
      )
      setRepositoryColors((current) => {
        const next = { ...current }
        if (appearance.color) next[appearance.repositoryKey] = appearance.color
        else delete next[appearance.repositoryKey]
        return next
      })
      setOrganizationCatalog(await window.desktop.organization.list())
      setOrganizeRepository(null)
    } catch (error) {
      setOrganizationError(errorMessage(error))
    } finally {
      setOrganizationSaving(false)
    }
  }

  const toggleRepositorySelection = (repository: GitHubRepository): void => {
    const key = repositoryOrganizationKey(repository)
    setSelectedRepositoryKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key])
  }

  const toggleRepositoryOrganizationFilter = (kind: OrganizationKind, id: string): void => {
    const field = organizationFieldForKind[kind]
    setRepositoryOrganizationFilters((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((itemId) => itemId !== id)
        : [...current[field], id],
    }))
    setRepositoryPage(1)
    repositoryResultsScrollRef.current?.scrollTo({ top: 0 })
  }

  const clearRepositoryOrganizationFilters = (): void => {
    setRepositoryOrganizationFilters(emptyRepositoryOrganization())
    setRepositoryPage(1)
    repositoryResultsScrollRef.current?.scrollTo({ top: 0 })
  }

  const toggleCurrentRepositoryPage = (): void => {
    setSelectedRepositoryKeys((current) => {
      if (allRepositoriesOnPageSelected) {
        return current.filter((key) => !pagedRepositoryKeys.includes(key))
      }
      return [...new Set([...current, ...pagedRepositoryKeys])]
    })
  }

  const closeRepositorySelection = (): void => {
    setRepositorySelectionMode(false)
    setSelectedRepositoryKeys([])
  }

  const openBulkOrganization = (): void => {
    if (selectedRepositories.length === 0) return
    setBulkOrganizationChanges({})
    setBulkOrganizationError(null)
    setBulkOrganizationOpen(true)
  }

  const saveBulkOrganization = async (): Promise<void> => {
    if (!window.desktop || selectedRepositories.length === 0) return
    setBulkOrganizationSaving(true)
    setBulkOrganizationError(null)
    try {
      const entries = await Promise.all(selectedRepositories.map((repository) => {
        const current = organizationAssignments[repositoryOrganizationKey(repository)] ??
          emptyRepositoryOrganization()
        const next: RepositoryOrganization = {
          workspaceIds: [...current.workspaceIds],
          groupIds: [...current.groupIds],
          tagIds: [...current.tagIds],
        }

        organizationKinds.forEach((kind) => {
          const field = organizationFieldForKind[kind]
          const catalogField = organizationCopy[kind].catalogField
          const ids = new Set(next[field])
          organizationCatalog[catalogField].forEach((item) => {
            const change = bulkOrganizationChanges[bulkOrganizationChangeKey(kind, item.id)]
            if (change === true) ids.add(item.id)
            if (change === false) ids.delete(item.id)
          })
          next[field] = [...ids]
        })

        return window.desktop!.organization.saveRepository(
          repository.accountId,
          repository.fullName,
          next,
        )
      }))

      setOrganizationAssignments((current) => {
        const next = { ...current }
        entries.forEach((entry) => {
          next[entry.repositoryKey] = {
            workspaceIds: entry.workspaceIds,
            groupIds: entry.groupIds,
            tagIds: entry.tagIds,
          }
        })
        return next
      })
      setOrganizationCatalog(await window.desktop.organization.list())
      setBulkOrganizationOpen(false)
      closeRepositorySelection()
    } catch (error) {
      setBulkOrganizationError(errorMessage(error))
      const [catalog, assignments] = await Promise.all([
        window.desktop.organization.list(),
        window.desktop.organization.assignments(),
      ]).catch(() => [null, null] as const)
      if (catalog) setOrganizationCatalog(catalog)
      if (assignments) {
        setOrganizationAssignments(Object.fromEntries(assignments.map((entry) => [
          entry.repositoryKey,
          {
            workspaceIds: entry.workspaceIds,
            groupIds: entry.groupIds,
            tagIds: entry.tagIds,
          },
        ])))
      }
    } finally {
      setBulkOrganizationSaving(false)
    }
  }

  const openOrganizationEditor = (
    kind: OrganizationKind,
    item: OrganizationItem | null = null,
  ): void => {
    setOrganizationEditorKind(kind)
    setOrganizationEditorItem(item)
    setOrganizationEditorName(item?.name ?? '')
    setOrganizationEditorColor(item?.color ?? organizationDefaultColor[kind])
    setOrganizationEditorDescription(item?.description ?? '')
    setOrganizationEditorError(null)
  }

  const connectWorkspaceLaunchTarget = async (
    type: WorkspaceLaunchTarget['type'],
  ): Promise<void> => {
    if (!window.desktop || !selectedWorkspaceId) return
    setWorkspaceTargetAction(`connect:${type}`)
    setWorkspaceTargetError(null)
    try {
      const target = await window.desktop.organization.connectWorkspaceTarget(
        selectedWorkspaceId,
        type,
      )
      if (target) setWorkspaceTarget(target)
    } catch (error) {
      setWorkspaceTargetError(errorMessage(error))
    } finally {
      setWorkspaceTargetAction(null)
    }
  }

  const scanRepositoryInsights = async (repository: GitHubRepository): Promise<void> => {
    if (!window.desktop || !repository.localPath) return
    setInsightsLoading(true)
    setInsightsError(null)
    try {
      const result = await window.desktop.repositories.scanInsights(repository.localPath)
      setInsightsResult(result)
      setInsightsCache((current) => ({ ...current, [repository.localPath!]: result }))
    } catch (error) {
      setInsightsError(errorMessage(error))
    } finally {
      setInsightsLoading(false)
    }
  }

  const openRepositoryInsights = (repository: GitHubRepository): void => {
    if (!repository.localPath) return
    const savedMode = localStorage.getItem(`myrepos:insights-mode:${repository.localPath}`)
    const mode: InsightsMode = savedMode === 'off' || savedMode === 'automatic' ||
      savedMode === 'hybrid' || savedMode === 'manual' ? savedMode : 'manual'
    const cached = insightsCache[repository.localPath]
    setInsightsRepository(repository)
    setInsightsResult(mode === 'off' ? null : cached ?? null)
    setInsightsError(null)
    setInsightsMode(mode)
    setInsightsTab('overview')
    setInsightsTechnologyTab('framework')
    setInsightsSearch('')
    setInsightsCategory('all')
    setInsightsLanguage('all')
    setInsightsExtension('all')
    setInsightsProject('all')
    setInsightsMetric('all')
    if (mode === 'automatic' || mode === 'hybrid' && !cached) void scanRepositoryInsights(repository)
  }

  const changeInsightsMode = (mode: InsightsMode): void => {
    setInsightsMode(mode)
    if (!insightsRepository?.localPath) return
    localStorage.setItem(`myrepos:insights-mode:${insightsRepository.localPath}`, mode)
    if (mode === 'off') {
      setInsightsResult(null)
      return
    }
    const cached = insightsCache[insightsRepository.localPath]
    if (!insightsResult && cached) setInsightsResult(cached)
    if ((mode === 'automatic' || mode === 'hybrid' && !cached) && !insightsLoading) {
      void scanRepositoryInsights(insightsRepository)
    }
  }

  const openWorkspaceLaunchTarget = async (): Promise<void> => {
    if (!window.desktop || !selectedWorkspaceId) return
    setWorkspaceTargetAction('open')
    setWorkspaceTargetError(null)
    try {
      await window.desktop.organization.openWorkspaceTarget(selectedWorkspaceId)
    } catch (error) {
      setWorkspaceTargetError(errorMessage(error))
    } finally {
      setWorkspaceTargetAction(null)
    }
  }

  const disconnectWorkspaceLaunchTarget = async (): Promise<void> => {
    if (!window.desktop || !selectedWorkspaceId) return
    setWorkspaceTargetAction('disconnect')
    setWorkspaceTargetError(null)
    try {
      await window.desktop.organization.disconnectWorkspaceTarget(selectedWorkspaceId)
      setWorkspaceTarget(null)
    } catch (error) {
      setWorkspaceTargetError(errorMessage(error))
    } finally {
      setWorkspaceTargetAction(null)
    }
  }

  const openWorkspaceRepositories = (workspaceId: string): void => {
    setSelectedWorkspaceId(workspaceId)
    setSelectedAccountId('all')
    setRepositoryTab('workspace')
    setRepositoryOrganizationFilters((current) => ({ ...current, workspaceIds: [] }))
    setRepositorySearch('')
    setRepositorySelectionMode(false)
    setSelectedRepositoryKeys([])
    setRepositoryPage(1)
    setActiveView('repositories')
  }

  const reorderWorkspaceRepository = async (
    sourceRepositoryKey: string,
    targetRepositoryKey: string,
  ): Promise<void> => {
    if (!window.desktop || !selectedWorkspaceId || sourceRepositoryKey === targetRepositoryKey) return
    const previousOrder = [...workspaceRepositoryOrder]
    const sourceIndex = previousOrder.indexOf(sourceRepositoryKey)
    const targetIndex = previousOrder.indexOf(targetRepositoryKey)
    if (sourceIndex < 0 || targetIndex < 0) {
      setWorkspaceOrderError('Workspace order changed. Refresh the workspace and try again.')
      return
    }

    const nextOrder = [...previousOrder]
    nextOrder.splice(sourceIndex, 1)
    const targetIndexAfterRemoval = nextOrder.indexOf(targetRepositoryKey)
    const insertIndex = sourceIndex < targetIndex ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval
    nextOrder.splice(insertIndex, 0, sourceRepositoryKey)
    setWorkspaceRepositoryOrder(nextOrder)
    setWorkspaceOrderSaving(true)
    setWorkspaceOrderError(null)
    try {
      setWorkspaceRepositoryOrder(
        await window.desktop.organization.reorderWorkspace(selectedWorkspaceId, nextOrder),
      )
    } catch (error) {
      setWorkspaceRepositoryOrder(previousOrder)
      setWorkspaceOrderError(errorMessage(error))
    } finally {
      setWorkspaceOrderSaving(false)
      setDraggedRepositoryKey(null)
      setRepositoryDropTarget(null)
    }
  }

  const saveOrganizationItem = async (): Promise<void> => {
    if (!window.desktop || !organizationEditorKind) return
    const name = organizationEditorName.trim()
    if (!name) {
      setOrganizationEditorError('Enter a name.')
      return
    }
    setOrganizationEditorSaving(true)
    setOrganizationEditorError(null)
    try {
      const input = {
        name,
        color: organizationEditorColor,
        description: organizationEditorDescription.trim(),
      }
      if (organizationEditorItem) {
        await window.desktop.organization.update(
          organizationEditorKind,
          organizationEditorItem.id,
          input,
        )
      } else {
        await window.desktop.organization.create(organizationEditorKind, input)
      }
      setOrganizationCatalog(await window.desktop.organization.list())
      setOrganizationEditorKind(null)
      setOrganizationEditorItem(null)
    } catch (error) {
      setOrganizationEditorError(errorMessage(error))
    } finally {
      setOrganizationEditorSaving(false)
    }
  }

  const removeOrganizationItem = async (): Promise<void> => {
    if (!window.desktop || !organizationDeleteItem) return
    setOrganizationEditorSaving(true)
    setOrganizationEditorError(null)
    try {
      await window.desktop.organization.remove(
        organizationDeleteItem.kind,
        organizationDeleteItem.id,
      )
      const [catalog, assignments] = await Promise.all([
        window.desktop.organization.list(),
        window.desktop.organization.assignments(),
      ])
      setOrganizationCatalog(catalog)
      const removedFilterField = organizationFieldForKind[organizationDeleteItem.kind]
      setRepositoryOrganizationFilters((current) => ({
        ...current,
        [removedFilterField]: current[removedFilterField].filter(
          (id) => id !== organizationDeleteItem.id,
        ),
      }))
      setOrganizationAssignments(Object.fromEntries(assignments.map((entry) => [
        entry.repositoryKey,
        {
          workspaceIds: entry.workspaceIds,
          groupIds: entry.groupIds,
          tagIds: entry.tagIds,
        },
      ])))
      setOrganizationDeleteItem(null)
    } catch (error) {
      setOrganizationEditorError(errorMessage(error))
    } finally {
      setOrganizationEditorSaving(false)
    }
  }

  const saveSettings = async (): Promise<void> => {
    if (!window.desktop) return
    setSettingsSaving(true)
    setSettingsError(null)
    setSettingsSaved(false)

    try {
      const storedSettings = await window.desktop.settings.save(settings)
      setSettings(storedSettings)
      setSavedSettings(storedSettings)
      setSettingsSaved(true)
    } catch (error) {
      setSettingsError(errorMessage(error))
    } finally {
      setSettingsSaving(false)
    }
  }

  const runUpdateAction = async (action: 'check' | 'download' | 'install'): Promise<void> => {
    if (!window.desktop) return
    setUpdateAction(action)
    try {
      if (action === 'check') setUpdateState(await window.desktop.updates.check())
      else if (action === 'download') setUpdateState(await window.desktop.updates.download())
      else await window.desktop.updates.install()
    } catch (error) {
      setUpdateState((current) => ({ ...current, phase: 'error', message: errorMessage(error) }))
    } finally {
      setUpdateAction(null)
    }
  }

  const reloadPortableConfiguration = async (): Promise<void> => {
    if (!window.desktop) return
    const [catalog, assignments, appearances] = await Promise.all([
      window.desktop.organization.list(),
      window.desktop.organization.assignments(),
      window.desktop.organization.appearances(),
    ])
    setOrganizationCatalog(catalog)
    setOrganizationAssignments(Object.fromEntries(assignments.map((entry) => [
      entry.repositoryKey,
      {
        workspaceIds: entry.workspaceIds,
        groupIds: entry.groupIds,
        tagIds: entry.tagIds,
      },
    ])))
    setRepositoryColors(Object.fromEntries(appearances.flatMap((entry) =>
      entry.color ? [[entry.repositoryKey, entry.color]] : [])))
  }

  const loadConfigurationRemoteRepositories = async (accountId: string): Promise<void> => {
    if (!window.desktop) return
    setConfigurationRemoteLoading(true)
    setConfigurationRemoteRepository(null)
    try {
      const remoteRepositories = await window.desktop.repositories.list(Number(accountId))
      setConfigurationRemoteRepositories(remoteRepositories.filter((repository) => !repository.archived))
      setConfigurationSyncError(null)
    } catch (error) {
      setConfigurationRemoteRepositories([])
      setConfigurationSyncError(errorMessage(error))
    } finally {
      setConfigurationRemoteLoading(false)
    }
  }

  const openConfigurationSetup = (mode: 'create' | 'remote' | 'local'): void => {
    const account = accounts.find((item) => String(item.id) === selectedAccountId) ?? accounts[0]
    setConfigurationSetupMode(mode)
    setConfigurationSetupAccountId(account ? String(account.id) : null)
    setConfigurationSetupOwner(account?.login ?? '')
    setConfigurationSetupName('myrepos-config')
    setConfigurationSetupPrivate(true)
    setConfigurationSetupAutoSync(true)
    setConfigurationRemoteRepository(null)
    setConfigurationSyncError(null)
    setConfigurationSetupOpen(true)
    if (mode === 'remote' && account) void loadConfigurationRemoteRepositories(String(account.id))
  }

  const completeConfigurationSetup = async (): Promise<void> => {
    if (!window.desktop || !configurationSetupAccountId) return
    setConfigurationSyncAction('setup')
    setConfigurationSyncError(null)
    try {
      let state: ConfigurationSyncState | null
      if (configurationSetupMode === 'create') {
        state = await window.desktop.configurationSync.create({
          accountId: Number(configurationSetupAccountId),
          owner: configurationSetupOwner.trim(),
          name: configurationSetupName.trim(),
          private: configurationSetupPrivate,
        })
      } else if (configurationSetupMode === 'remote') {
        if (!configurationRemoteRepository) throw new Error('Choose a GitHub repository.')
        state = await window.desktop.configurationSync.connectRemote(
          Number(configurationSetupAccountId),
          configurationRemoteRepository,
        )
      } else {
        state = await window.desktop.configurationSync.connectLocal(
          Number(configurationSetupAccountId),
        )
      }
      if (!state) return
      if (configurationSetupAutoSync) {
        state = await window.desktop.configurationSync.setAutoSync(true)
      }
      setConfigurationSync(state)
      await reloadPortableConfiguration()
      setConfigurationSetupOpen(false)
    } catch (error) {
      setConfigurationSyncError(errorMessage(error))
    } finally {
      setConfigurationSyncAction(null)
    }
  }

  const runConfigurationSync = async (action: ConfigurationSyncAction): Promise<void> => {
    if (!window.desktop) return
    setConfigurationSyncAction(action)
    setConfigurationSyncError(null)
    try {
      const state = await window.desktop.configurationSync.run(action)
      setConfigurationSync(state)
      if (action !== 'push') await reloadPortableConfiguration()
    } catch (error) {
      setConfigurationSyncError(errorMessage(error))
    } finally {
      setConfigurationSyncAction(null)
    }
  }

  const changeConfigurationAutoSync = async (enabled: boolean): Promise<void> => {
    if (!window.desktop) return
    setConfigurationSyncError(null)
    try {
      setConfigurationSync(await window.desktop.configurationSync.setAutoSync(enabled))
    } catch (error) {
      setConfigurationSyncError(errorMessage(error))
    }
  }

  const disconnectConfigurationSync = async (): Promise<void> => {
    if (!window.desktop || !window.confirm(
      'Disconnect this configuration repository? The repository and its files will not be deleted.',
    )) return
    try {
      setConfigurationSync(await window.desktop.configurationSync.disconnect())
      setConfigurationSyncError(null)
    } catch (error) {
      setConfigurationSyncError(errorMessage(error))
    }
  }

  const historyFilesShown = filesPanelTab === 'history' && commitFilesVisible
  const scmHasContent = scmNavigatorVisible || historyFilesShown || diffVisible
  const scmGridColumns = [
    scmNavigatorVisible ? `${scmNavigatorWidth}px` : null,
    scmNavigatorVisible && (historyFilesShown || diffVisible) ? '6px' : null,
    historyFilesShown ? `${commitFilesWidth}px` : null,
    historyFilesShown && diffVisible ? '6px' : null,
    diffVisible ? 'minmax(0, 1fr)' : null,
  ].filter(Boolean).join(' ') || 'minmax(0, 1fr)'
  const activeOrganizationKind: OrganizationKind | null = activeView === 'workspaces'
    ? 'workspace'
    : activeView === 'groups'
      ? 'group'
      : activeView === 'tags'
        ? 'tag'
        : null
  const activeOrganizationCopy = activeOrganizationKind
    ? organizationCopy[activeOrganizationKind]
    : null
  const activeOrganizationItems = activeOrganizationKind && activeOrganizationCopy
    ? organizationCatalog[activeOrganizationCopy.catalogField]
    : []
  const deferredInsightsSearch = useDeferredValue(insightsSearch)
  const scopedInsightFiles = useMemo(() => insightsResult?.files.filter((file) =>
    insightsProject === 'all' || file.projectPath === insightsProject) ?? [],
  [insightsProject, insightsResult])
  const filteredInsightFiles = useMemo(() => {
    const search = deferredInsightsSearch.toLowerCase()
    return scopedInsightFiles.filter((file) =>
      (!search || file.path.toLowerCase().includes(search)) &&
      (insightsCategory === 'all' || file.category === insightsCategory) &&
      (insightsLanguage === 'all' || file.language === insightsLanguage) &&
      (insightsExtension === 'all' || file.extension === insightsExtension) &&
      (insightsMetric === 'all' || insightsMetric === 'lines' && file.lines > 0 ||
        insightsMetric === 'code' && file.codeLines > 0 || insightsMetric === 'comments' && file.commentLines > 0))
  }, [deferredInsightsSearch, insightsCategory, insightsExtension, insightsLanguage, insightsMetric, scopedInsightFiles])
  const scopedInsightTotals = useMemo(() => scopedInsightFiles.reduce((total, file) => ({
      files: total.files + 1,
      lines: total.lines + file.lines,
      codeLines: total.codeLines + file.codeLines,
      commentLines: total.commentLines + file.commentLines,
      assets: total.assets + (file.category === 'asset' ? 1 : 0),
      bytes: total.bytes + file.size,
    }), { files: 0, lines: 0, codeLines: 0, commentLines: 0, assets: 0, bytes: 0 }),
  [scopedInsightFiles])
  const scopedInsightLanguages = useMemo(() => Object.values(scopedInsightFiles.reduce<Record<string, {
      name: string; files: number; codeLines: number
    }>>((languages, file) => {
      if (!file.language) return languages
      const value = languages[file.language] ?? { name: file.language, files: 0, codeLines: 0 }
      value.files += 1
      value.codeLines += file.codeLines
      languages[file.language] = value
      return languages
    }, {})).sort((a, b) => b.codeLines - a.codeLines || b.files - a.files),
  [scopedInsightFiles])
  const scopedInsightTechnologies = useMemo(() => insightsResult?.technologies.filter((technology) =>
      insightsProject === 'all' || technology.evidence.some((evidence) =>
        insightsProject === '.'
          ? !evidence.replaceAll('\\', '/').split(': ')[0].includes('/')
          : evidence.replaceAll('\\', '/').startsWith(`${insightsProject}/`))) ?? [],
  [insightsProject, insightsResult])
  const insightTechnologyCounts = useMemo(() => technologyCategoryOrder.reduce<Record<TechnologyCategory, number>>(
    (counts, category) => {
      counts[category] = scopedInsightTechnologies.filter((item) => item.category === category).length
      return counts
    }, { framework: 0, library: 0, runtime: 0, tool: 0 }),
  [scopedInsightTechnologies])
  const activeInsightTechnologies = useMemo(() => scopedInsightTechnologies.filter(
    (item) => item.category === insightsTechnologyTab),
  [insightsTechnologyTab, scopedInsightTechnologies])
  const insightExtensionStats = useMemo(() => insightsResult
    ? Object.entries(scopedInsightFiles.reduce<Record<string, {
        files: number; lines: number; codeLines: number; commentLines: number; blankLines: number; bytes: number
      }>>((counts, file) => {
        const value = counts[file.extension] ?? {
          files: 0, lines: 0, codeLines: 0, commentLines: 0, blankLines: 0, bytes: 0,
        }
        value.files += 1
        value.lines += file.lines
        value.codeLines += file.codeLines
        value.commentLines += file.commentLines
        value.blankLines += file.blankLines
        value.bytes += file.size
        counts[file.extension] = value
        return counts
      }, {})).sort((a, b) => b[1].lines - a[1].lines || b[1].files - a[1].files)
    : [], [insightsResult, scopedInsightFiles])

  return (
    <div
      className="app-frame"
      data-platform={platform}
      data-maximized={windowMaximized || undefined}
    >
      {sidebarVisible && (
      <>
      <aside
        className="sidebar"
        data-compact={sidebarWidth < 190 || undefined}
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      >
        <div className="brand">
          <div className="brand-mark">
            <img src={myReposIcon} alt="" aria-hidden="true" />
          </div>
          <div>
            <Text fw={750} lh={1.1}>MyRepos</Text>
            <Text size="10px" c="dimmed">Account manager</Text>
          </div>
          <Tooltip label="Hide sidebar">
            <ActionIcon
              className="sidebar-toggle"
              variant="subtle"
              color="gray"
              aria-label="Hide menu sidebar"
              onClick={() => setSidebarVisible(false)}
            >
              <IconLayoutSidebarLeftCollapse size={18} />
            </ActionIcon>
          </Tooltip>
        </div>

        <Divider color="dark.4" />

        <Box p="sm">
          <Text className="nav-section-title">MANAGE</Text>
          <UnstyledButton
            className="nav-item"
            title="Accounts"
            data-active={activeView === 'accounts' || undefined}
            onClick={() => setActiveView('accounts')}
          >
            <IconUsers size={17} stroke={1.7} />
            <Text size="sm" fw={600}>Accounts</Text>
          </UnstyledButton>
          <UnstyledButton
            className="nav-item"
            title="Repositories"
            data-active={activeView === 'repositories' || undefined}
            disabled={accounts.length === 0}
            onClick={() => setActiveView('repositories')}
          >
            <IconBook2 size={17} stroke={1.7} />
            <Text size="sm" fw={600}>Repositories</Text>
          </UnstyledButton>
          <Text className="nav-section-title nav-section-title--secondary">ORGANIZE</Text>
          <UnstyledButton
            className="nav-item"
            title="Workspaces"
            data-active={activeView === 'workspaces' || undefined}
            onClick={() => setActiveView('workspaces')}
          >
            <IconBriefcase size={17} stroke={1.7} />
            <Text size="sm" fw={600}>Workspaces</Text>
          </UnstyledButton>
          <UnstyledButton
            className="nav-item"
            title="Groups"
            data-active={activeView === 'groups' || undefined}
            onClick={() => setActiveView('groups')}
          >
            <IconFolders size={17} stroke={1.7} />
            <Text size="sm" fw={600}>Groups</Text>
          </UnstyledButton>
          <UnstyledButton
            className="nav-item"
            title="Tags"
            data-active={activeView === 'tags' || undefined}
            onClick={() => setActiveView('tags')}
          >
            <IconTags size={17} stroke={1.7} />
            <Text size="sm" fw={600}>Tags</Text>
          </UnstyledButton>
          <UnstyledButton
            className="nav-item"
            title="Settings"
            data-active={activeView === 'settings' || undefined}
            onClick={() => setActiveView('settings')}
          >
            <IconSettings size={17} stroke={1.7} />
            <Text size="sm" fw={600}>Settings</Text>
          </UnstyledButton>
        </Box>

        <div className="sidebar-spacer" />

        <div className="provider-status">
          <Group gap={9} wrap="nowrap">
            <ThemeIcon variant="light" color="gray" size={30} radius="md">
              <IconBrandGithub size={17} />
            </ThemeIcon>
            <div>
              <Text size="xs" fw={650}>GitHub</Text>
              <Text size="10px" c="dimmed">Only provider enabled</Text>
            </div>
          </Group>
          <Badge size="xs" variant="light" color="teal">Ready</Badge>
        </div>
      </aside>

      <HorizontalSplitter
        label="Resize navigation sidebar"
        value={sidebarWidth}
        resetValue={244}
        min={72}
        max={1200}
        reserveEnd={gitRepository ? filesPanelTab === 'history' ? 900 : 700 : 420}
        onChange={(width) => setSidebarWidth(width < 190 ? 72 : width)}
      />
      </>
      )}

      <main className="main-area">
        <header className="topbar">
          {platform === 'win32' && window.desktop && (
            <div className="window-controls" aria-label="Window controls">
              <button
                type="button"
                className="window-control"
                aria-label="Minimize"
                title="Minimize"
                onClick={() => void window.desktop?.windowControls.minimize()}
              >
                <IconMinus size={15} stroke={1.5} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="window-control"
                aria-label={windowMaximized ? 'Restore' : 'Maximize'}
                title={windowMaximized ? 'Restore' : 'Maximize'}
                onClick={() => void window.desktop?.windowControls.toggleMaximize()
                  .then(setWindowMaximized)}
              >
                {windowMaximized
                  ? <IconRestore size={14} stroke={1.5} aria-hidden="true" />
                  : <IconSquare size={13} stroke={1.5} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="window-control window-control-close"
                aria-label="Close"
                title="Close"
                onClick={() => void window.desktop?.windowControls.close()}
              >
                <IconX size={16} stroke={1.5} aria-hidden="true" />
              </button>
            </div>
          )}
          <Tooltip label={`${sidebarVisible ? 'Hide' : 'Show'} sidebar`}>
            <ActionIcon
              className="workspace-menu-button"
              variant={sidebarVisible ? 'subtle' : 'light'}
              color={sidebarVisible ? 'gray' : 'teal'}
              aria-label={`${sidebarVisible ? 'Hide' : 'Show'} menu sidebar`}
              onClick={() => setSidebarVisible((visible) => !visible)}
            >
              {sidebarVisible
                ? <IconLayoutSidebarLeftCollapse size={19} />
                : <IconLayoutSidebarLeftExpand size={19} />}
            </ActionIcon>
          </Tooltip>
          <Menu position="bottom-start" shadow="xl" width={280} withinPortal>
            <Menu.Target>
              <ActionIcon
                className="workspace-menu-button"
                variant="subtle"
                color="gray"
                aria-label="Open workspace menu"
              >
                <IconCommand size={19} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Navigate</Menu.Label>
              <Menu.Item
                leftSection={<IconUsers size={15} />}
                onClick={() => setActiveView('accounts')}
              >
                Accounts
              </Menu.Item>
              <Menu.Item
                leftSection={<IconBook2 size={15} />}
                disabled={accounts.length === 0}
                onClick={() => setActiveView('repositories')}
              >
                Repositories
              </Menu.Item>
              <Menu.Item
                leftSection={<IconBriefcase size={15} />}
                onClick={() => setActiveView('workspaces')}
              >
                Workspaces
              </Menu.Item>
              <Menu.Item
                leftSection={<IconFolders size={15} />}
                onClick={() => setActiveView('groups')}
              >
                Groups
              </Menu.Item>
              <Menu.Item
                leftSection={<IconTags size={15} />}
                onClick={() => setActiveView('tags')}
              >
                Tags
              </Menu.Item>
              <Menu.Item
                leftSection={<IconSettings size={15} />}
                onClick={() => setActiveView('settings')}
              >
                Settings
              </Menu.Item>

              <Menu.Divider />
              <Menu.Label>View</Menu.Label>
              <Menu.Item
                leftSection={sidebarVisible
                  ? <IconLayoutSidebarLeftCollapse size={15} />
                  : <IconLayoutSidebarLeftExpand size={15} />}
                onClick={() => setSidebarVisible((visible) => !visible)}
              >
                {sidebarVisible ? 'Hide' : 'Show'} menu sidebar
              </Menu.Item>
              <Menu.Item
                leftSection={repositoryPaneVisible
                  ? <IconLayoutSidebarLeftCollapse size={15} />
                  : <IconLayoutSidebarLeftExpand size={15} />}
                disabled={!gitRepository}
                onClick={() => setRepositoryPaneVisible((visible) => !visible)}
              >
                {repositoryPaneVisible ? 'Hide' : 'Show'} repositories pane
              </Menu.Item>
              <Menu.Item
                leftSection={scmNavigatorVisible
                  ? <IconLayoutSidebarLeftCollapse size={15} />
                  : <IconLayoutSidebarLeftExpand size={15} />}
                disabled={!gitRepository}
                onClick={() => setScmNavigatorVisible((visible) => !visible)}
              >
                {scmNavigatorVisible ? 'Hide' : 'Show'} {filesPanelTab} navigator
              </Menu.Item>
              <Menu.Item
                leftSection={commitFilesVisible
                  ? <IconLayoutSidebarLeftCollapse size={15} />
                  : <IconLayoutSidebarLeftExpand size={15} />}
                disabled={!gitRepository || filesPanelTab !== 'history'}
                onClick={() => setCommitFilesVisible((visible) => !visible)}
              >
                {commitFilesVisible ? 'Hide' : 'Show'} commit files
              </Menu.Item>
              <Menu.Item
                leftSection={diffVisible
                  ? <IconLayoutSidebarRightCollapse size={15} />
                  : <IconLayoutSidebarRightExpand size={15} />}
                disabled={!gitRepository}
                onClick={() => setDiffVisible((visible) => !visible)}
              >
                {diffVisible ? 'Hide' : 'Show'} diff pane
              </Menu.Item>
              <Menu.Item
                color="teal"
                leftSection={<IconLayoutGrid size={15} />}
                disabled={!gitRepository}
                onClick={() => {
                  setRepositoryPaneVisible(true)
                  setScmNavigatorVisible(true)
                  setCommitFilesVisible(true)
                  setDiffVisible(true)
                }}
              >
                Show all workspace panes
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>

          {activeView === 'accounts' ? (
            <div className="topbar-heading">
              <Text fw={700} fz="lg">Accounts</Text>
              <Text size="xs" c="dimmed">
                Manage the GitHub identities available to MyRepos
              </Text>
            </div>
          ) : activeView === 'repositories' ? (
            <>
            <Tabs
              className="topbar-tabs"
              value={repositoryTab}
              onChange={(value) => {
                const nextTab = (value as RepositoryTab | null) ?? 'github'
                setRepositoryTab(nextTab)
                if (nextTab === 'workspace') {
                  setSelectedAccountId('all')
                  setRepositoryOrganizationFilters((current) => ({
                    ...current,
                    workspaceIds: [],
                  }))
                }
                setRepositorySelectionMode(false)
                setSelectedRepositoryKeys([])
                setRepositoryPage(1)
                repositoryResultsScrollRef.current?.scrollTo({ top: 0 })
              }}
            >
              <Tabs.List>
                <Tabs.Tab value="local" leftSection={<IconCheck size={14} />}>
                  Local <span className="tab-count">{localRepositoryCount}</span>
                </Tabs.Tab>
                <Tabs.Tab value="github" leftSection={<IconPlus size={14} />}>
                  GitHub <span className="tab-count">{repositoriesLoading ? '…' : githubOnlyRepositoryCount}</span>
                </Tabs.Tab>
                <Tabs.Tab
                  value="workspace"
                  leftSection={<IconBriefcase size={14} />}
                  disabled={organizationCatalog.workspaces.length === 0}
                >
                  <span
                    className="workspace-tab-name"
                    title={selectedWorkspace?.name ?? 'Workspaces'}
                  >
                    {selectedWorkspace?.name ?? 'Workspaces'}
                  </span>
                  <span className="tab-count">
                    {repositoriesLoading ? '…' : selectedWorkspaceRepositoryCount}
                  </span>
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
            {repositoryTab === 'workspace' ? (
              <Group gap="xs" wrap="nowrap">
                {workspaceTarget && (
                  <Tooltip label={workspaceTarget.path}>
                    <Button
                      size="xs"
                      leftSection={<IconBrandVscode size={15} />}
                      loading={workspaceTargetAction === 'open'}
                      disabled={Boolean(workspaceTargetAction)}
                      onClick={() => void openWorkspaceLaunchTarget()}
                    >
                      Open in VS Code
                    </Button>
                  </Tooltip>
                )}
                <Menu position="bottom-end" shadow="xl" width={245} withinPortal>
                  <Menu.Target>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={workspaceTarget
                        ? <IconLink size={15} />
                        : <IconFolderSearch size={15} />}
                      loading={workspaceTargetLoading || Boolean(workspaceTargetAction?.startsWith('connect:'))}
                      disabled={workspaceTargetLoading || Boolean(workspaceTargetAction)}
                    >
                      {workspaceTarget ? 'Connected' : 'Connect'}
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {workspaceTarget && (
                      <>
                        <Menu.Label>{workspaceTarget.type === 'folder'
                          ? 'Connected folder'
                          : 'Connected VS Code workspace'}</Menu.Label>
                        <Menu.Item disabled className="workspace-target-path">
                          {workspaceTarget.path}
                        </Menu.Item>
                        <Menu.Divider />
                      </>
                    )}
                    <Menu.Item
                      leftSection={<IconFolderOpen size={15} />}
                      onClick={() => void connectWorkspaceLaunchTarget('folder')}
                    >
                      {workspaceTarget ? 'Change to folder' : 'Connect folder'}
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconFileCode size={15} />}
                      onClick={() => void connectWorkspaceLaunchTarget('code-workspace')}
                    >
                      {workspaceTarget ? 'Change to .code-workspace' : 'Connect .code-workspace'}
                    </Menu.Item>
                    {workspaceTarget && (
                      <>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconUnlink size={15} />}
                          onClick={() => void disconnectWorkspaceLaunchTarget()}
                        >
                          Disconnect
                        </Menu.Item>
                      </>
                    )}
                  </Menu.Dropdown>
                </Menu>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconBriefcase size={15} />}
                  onClick={() => setActiveView('workspaces')}
                >
                  Manage
                </Button>
              </Group>
            ) : (
              <Group gap="xs" wrap="nowrap">
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconFolderSearch size={15} />}
                  onClick={() => void addLocalRepository()}
                >
                  Add local repository
                </Button>
                <Button
                  size="xs"
                  leftSection={<IconUpload size={15} />}
                  disabled={accounts.length === 0}
                  onClick={() => void addLocalRepository(true)}
                >
                  Publish folder
                </Button>
              </Group>
            )}
            </>
          ) : activeOrganizationCopy ? (
            <div className="topbar-heading">
              <Text fw={700} fz="lg">{activeOrganizationCopy.plural}</Text>
              <Text size="xs" c="dimmed">
                {activeOrganizationCopy.description}
              </Text>
            </div>
          ) : (
            <div className="topbar-heading">
              <Text fw={700} fz="lg">Settings</Text>
              <Text size="xs" c="dimmed">
                Configure application integrations
              </Text>
            </div>
          )}

          {activeView === 'accounts' ? (
            <Tooltip label="Add a GitHub account">
              <Button
                size="sm"
                leftSection={<IconPlus size={16} />}
                onClick={() => setConnectOpen(true)}
              >
                Add account
              </Button>
            </Tooltip>
          ) : activeView === 'repositories' ? (
            <Button
              size="sm"
              variant="light"
              leftSection={<IconRefresh size={16} />}
              loading={repositoriesLoading}
              onClick={() => void refreshRepositories()}
            >
              Refresh
            </Button>
          ) : activeOrganizationKind && activeOrganizationCopy ? (
            <Button
              size="sm"
              leftSection={<IconPlus size={16} />}
              onClick={() => openOrganizationEditor(activeOrganizationKind)}
            >
              New {activeOrganizationCopy.singular.toLowerCase()}
            </Button>
          ) : (
            <Button
              size="sm"
              leftSection={<IconDeviceFloppy size={16} />}
              loading={settingsSaving}
              disabled={
                settingsLoading ||
                (
                  settings.vscodeApplicationName === savedSettings.vscodeApplicationName &&
                  settings.automaticallyCheckForUpdates === savedSettings.automaticallyCheckForUpdates &&
                  settings.automaticallyDownloadUpdates === savedSettings.automaticallyDownloadUpdates
                )
              }
              onClick={() => void saveSettings()}
            >
              Save settings
            </Button>
          )}
        </header>

        <div
          className={`content-scroll${activeView === 'repositories' ? ' repository-view-scroll' : ''}`}
          ref={contentScrollRef}
        >
          {activeView === 'accounts' ? (
            <div className="accounts-content">
            <section className="intro-row">
              <div>
                <Text fz={24} fw={720} className="page-title">Your GitHub accounts</Text>
                <Text c="dimmed" mt={5} maw={600}>
                  Connect one or more accounts. Credentials are encrypted using your operating system’s secure storage.
                </Text>
              </div>
              <Badge variant="outline" color="gray" size="lg">
                {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
              </Badge>
            </section>

            {accountsError && (
              <Alert mt="lg" color="red" icon={<IconAlertCircle size={17} />}>
                {accountsError}
              </Alert>
            )}

            {accountsLoading ? (
              <Paper className="empty-state" radius="lg">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">Loading accounts…</Text>
              </Paper>
            ) : accounts.length === 0 ? (
              <Paper className="empty-state" radius="lg">
                <div className="empty-icon-wrap">
                  <IconBrandGithub size={35} stroke={1.55} />
                </div>
                <Text fz={19} fw={680}>Connect your first GitHub account</Text>
                <Text c="dimmed" size="sm" maw={430} ta="center" lh={1.6}>
                  Sign in through GitHub in your browser. MyRepos will never ask for or store your GitHub password.
                </Text>
                <Button
                  mt="xs"
                  leftSection={<IconBrandGithub size={18} />}
                  onClick={() => setConnectOpen(true)}
                >
                  Connect GitHub
                </Button>
              </Paper>
            ) : (
              <Stack gap="sm" mt={28}>
                {accounts.map((account) => (
                  <Paper className="account-card" radius="lg" key={account.id}>
                    <Group gap="md" wrap="nowrap">
                      <Avatar src={account.avatarUrl} alt={account.login} size={48} radius="xl" />
                      <div className="account-identity">
                        <Group gap={8}>
                          <Text fw={680}>{account.name || account.login}</Text>
                          <Badge size="xs" variant="light" color="teal">Connected</Badge>
                        </Group>
                        <Text size="sm" c="dimmed">@{account.login}</Text>
                      </div>
                    </Group>

                    <Group gap="xs" wrap="nowrap">
                      <Button
                        variant="light"
                        size="xs"
                        leftSection={<IconBook2 size={14} />}
                        onClick={() => {
                          setSelectedAccountId(String(account.id))
                          setActiveView('repositories')
                        }}
                      >
                        Repositories
                      </Button>
                      <Button
                        component="a"
                        href={account.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        variant="subtle"
                        color="gray"
                        size="xs"
                        rightSection={<IconExternalLink size={14} />}
                      >
                        Profile
                      </Button>
                      <Tooltip label={`Remove @${account.login}`}>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Remove ${account.login}`}
                          onClick={() => void removeConnectedAccount(account)}
                        >
                          <IconTrash size={17} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}

            <section className="security-card">
              <ThemeIcon variant="light" color="teal" size={38} radius="md">
                <IconShieldCheck size={21} />
              </ThemeIcon>
              <div>
                <Text size="sm" fw={650}>Credentials stay protected</Text>
                <Text size="xs" c="dimmed" mt={3} lh={1.55}>
                  Access tokens are encrypted through macOS Keychain, Windows DPAPI, or Linux Secret Service—not stored as plain text or sent to the React interface.
                </Text>
              </div>
            </section>
            </div>
          ) : activeView === 'repositories' ? (
            <div className="repositories-content">
              <div className="repository-sticky-controls">
                <section className="repository-toolbar">
                  <Text fz={18} fw={720} className="page-title">Repositories</Text>
                  {repositoryTab === 'workspace' ? (
                    <Select
                      aria-label="Workspace"
                      value={selectedWorkspaceId}
                      data={organizationCatalog.workspaces.map((workspace) => ({
                        value: workspace.id,
                        label: workspace.name,
                      }))}
                      allowDeselect={false}
                      leftSection={<IconBriefcase size={15} />}
                      rightSection={workspaceOrderSaving ? <Loader size={13} /> : undefined}
                      rightSectionPointerEvents="none"
                      onChange={(value) => {
                        setSelectedWorkspaceId(value)
                        setRepositorySearch('')
                        setRepositorySelectionMode(false)
                        setSelectedRepositoryKeys([])
                        setRepositoryPage(1)
                      }}
                    />
                  ) : (
                    <Select
                      aria-label="GitHub account"
                      value={selectedAccountId}
                      data={[
                        { value: 'all', label: 'All Accounts' },
                        ...accounts.map((account) => ({
                          value: String(account.id),
                          label: `@${account.login}`,
                        })),
                      ]}
                      allowDeselect={false}
                      onChange={(value) => {
                        setSelectedAccountId(value)
                        setRepositorySearch('')
                        setRepositoryPage(1)
                      }}
                    />
                  )}
                  <TextInput
                    aria-label="Search repositories"
                    placeholder="Search name, description, or language"
                    value={repositorySearch}
                    leftSection={<IconSearch size={16} />}
                    onChange={(event) => {
                      setRepositorySearch(event.currentTarget.value)
                      setRepositoryPage(1)
                    }}
                  />
                  <Group className="repository-summary-badges" gap={3} wrap="nowrap">
                    {listedConflictCount > 0 && (
                      <Tooltip label={`${listedConflictCount} unresolved ${listedConflictCount === 1 ? 'conflict' : 'conflicts'}`}>
                        <Badge variant="filled" color="red" size="sm">
                          {listedConflictCount} {listedConflictCount === 1 ? 'conflict' : 'conflicts'}
                        </Badge>
                      </Tooltip>
                    )}
                    {listedChangeCount > 0 && (
                      <Tooltip label={`${listedChangeCount} pending ${listedChangeCount === 1 ? 'change' : 'changes'} across ${listedRepositoriesWithChanges.length} ${listedRepositoriesWithChanges.length === 1 ? 'repository' : 'repositories'}`}>
                        <Badge variant="filled" color="orange" size="sm">
                          {listedChangeCount} {listedChangeCount === 1 ? 'change' : 'changes'}
                        </Badge>
                      </Tooltip>
                    )}
                    {listedPushNeededCount > 0 && (
                      <Tooltip label={`${listedPushNeededCount} ${listedPushNeededCount === 1 ? 'repository needs' : 'repositories need'} push`}>
                        <Badge variant="filled" color="pink" size="sm">
                          ↑ {listedPushNeededCount} push
                        </Badge>
                      </Tooltip>
                    )}
                    {listedPullNeededCount > 0 && (
                      <Tooltip label={`${listedPullNeededCount} ${listedPullNeededCount === 1 ? 'repository needs' : 'repositories need'} pull`}>
                        <Badge variant="filled" color="yellow" size="sm">
                          ↓ {listedPullNeededCount} pull
                        </Badge>
                      </Tooltip>
                    )}
                    {!listedHasStatus && (
                      <Tooltip label={`${visibleRepositories.length} repositories in the current view`}>
                        <Badge variant="outline" color="gray" size="sm">
                          {visibleRepositories.length} repos
                        </Badge>
                      </Tooltip>
                    )}
                  </Group>
                  <Group className="repository-layout-toggle" gap={3} wrap="nowrap">
                    <Tooltip label="List view">
                      <ActionIcon
                        aria-label="Show repositories as a list"
                        variant={repositoryLayout === 'list' ? 'light' : 'subtle'}
                        color={repositoryLayout === 'list' ? 'teal' : 'gray'}
                        onClick={() => setRepositoryLayout('list')}
                      >
                        <IconLayoutList size={17} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Grid view">
                      <ActionIcon
                        aria-label="Show repositories as a grid"
                        variant={repositoryLayout === 'grid' ? 'light' : 'subtle'}
                        color={repositoryLayout === 'grid' ? 'teal' : 'gray'}
                        disabled={Boolean(gitRepository)}
                        onClick={() => setRepositoryLayout('grid')}
                      >
                        <IconLayoutGrid size={17} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  <Group className="repository-toolbar-actions" gap={4} wrap="nowrap">
                    <Menu
                      position="bottom-end"
                      shadow="xl"
                      width={290}
                      closeOnItemClick={false}
                      withinPortal
                    >
                      <Menu.Target>
                        <Button
                          size="xs"
                          variant={activeRepositoryOrganizationFilterCount > 0 ? 'light' : 'subtle'}
                          color={activeRepositoryOrganizationFilterCount > 0 ? 'teal' : 'gray'}
                          leftSection={<IconFilter size={15} />}
                        >
                          Filters{activeRepositoryOrganizationFilterCount > 0
                            ? ` ${activeRepositoryOrganizationFilterCount}`
                            : ''}
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown className="repository-filter-menu">
                        {organizationKinds
                          .filter((kind) => repositoryTab !== 'workspace' || kind !== 'workspace')
                          .map((kind, index) => {
                          const copy = organizationCopy[kind]
                          const field = organizationFieldForKind[kind]
                          const items = organizationCatalog[copy.catalogField]
                          return (
                            <div key={kind}>
                              {index > 0 && <Menu.Divider />}
                              <Menu.Label>{copy.plural}</Menu.Label>
                              {items.length === 0 ? (
                                <Menu.Item disabled>No {copy.plural.toLowerCase()} created</Menu.Item>
                              ) : items.map((item) => (
                                <Menu.Item
                                  key={item.id}
                                  leftSection={(
                                    <Checkbox
                                      size="xs"
                                      checked={repositoryOrganizationFilters[field].includes(item.id)}
                                      readOnly
                                      tabIndex={-1}
                                      styles={{ input: { pointerEvents: 'none' } }}
                                    />
                                  )}
                                  onClick={() => toggleRepositoryOrganizationFilter(kind, item.id)}
                                >
                                  <Group justify="space-between" gap="xs" wrap="nowrap">
                                    <Group gap={8} wrap="nowrap">
                                      <span
                                        className="organization-color"
                                        style={{ backgroundColor: item.color }}
                                      />
                                      <Text size="sm" truncate>{item.name}</Text>
                                    </Group>
                                    <Text size="10px" c="dimmed">{item.repositoryCount}</Text>
                                  </Group>
                                </Menu.Item>
                              ))}
                            </div>
                          )
                        })}
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          disabled={activeRepositoryOrganizationFilterCount === 0}
                          leftSection={<IconX size={14} />}
                          onClick={clearRepositoryOrganizationFilters}
                        >
                          Clear organization filters
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      leftSection={<IconRefresh size={15} />}
                      disabled={selectedRepositoryKeys.length > 0
                        ? selectedLocalRepositories.length === 0
                        : visibleLocalRepositories.length === 0}
                      onClick={() => openBulkGit(
                        selectedRepositoryKeys.length > 0 ? 'selected' : 'visible',
                      )}
                    >
                      {selectedRepositoryKeys.length > 0 ? 'Sync selected' : 'Sync visible'}
                    </Button>
                    <Button
                      size="xs"
                      variant={repositorySelectionMode ? 'light' : 'subtle'}
                      color={repositorySelectionMode ? 'teal' : 'gray'}
                      leftSection={<IconCheck size={15} />}
                      onClick={() => {
                        if (repositorySelectionMode) closeRepositorySelection()
                        else setRepositorySelectionMode(true)
                      }}
                    >
                      {repositorySelectionMode ? 'Done' : 'Select'}
                    </Button>
                  </Group>
                </section>
                {activeRepositoryOrganizationFilters.length > 0 && (
                  <section className="repository-active-filters">
                    <Text size="xs" c="dimmed" fw={650}>Filtered by</Text>
                    {activeRepositoryOrganizationFilters.map((item) => (
                      <Button
                        className="repository-filter-chip"
                        key={`${item.kind}:${item.id}`}
                        size="compact-xs"
                        variant="light"
                        color="gray"
                        leftSection={(
                          <span
                            className="organization-color"
                            style={{ backgroundColor: item.color }}
                          />
                        )}
                        rightSection={<IconX size={12} />}
                        onClick={() => toggleRepositoryOrganizationFilter(item.kind, item.id)}
                      >
                        {item.name}
                      </Button>
                    ))}
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      onClick={clearRepositoryOrganizationFilters}
                    >
                      Clear all
                    </Button>
                  </section>
                )}
                {repositorySelectionMode && (
                  <section className="repository-bulk-toolbar">
                    <Checkbox
                      size="xs"
                      checked={allRepositoriesOnPageSelected}
                      indeterminate={selectedOnPageCount > 0 && !allRepositoriesOnPageSelected}
                      disabled={pagedRepositories.length === 0}
                      label="Select this page"
                      onChange={toggleCurrentRepositoryPage}
                    />
                    <Text size="xs" c="dimmed">
                      {selectedRepositories.length} selected
                    </Text>
                    <div className="repository-bulk-toolbar-spacer" />
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      disabled={selectedRepositories.length === 0}
                      onClick={() => setSelectedRepositoryKeys([])}
                    >
                      Clear
                    </Button>
                    <Button
                      size="xs"
                      leftSection={<IconTags size={15} />}
                      disabled={selectedRepositories.length === 0}
                      onClick={openBulkOrganization}
                    >
                      Organize selected
                    </Button>
                  </section>
                )}
              </div>

              <div className={`repository-workspace${gitRepository ? ' repository-workspace--split' : ''}`}>
                {(!gitRepository || repositoryPaneVisible) && (
                <section
                  className="repository-browser-panel"
                  style={gitRepository ? {
                    width: repositoryPaneWidth,
                    flexBasis: repositoryPaneWidth,
                    flexShrink: 0,
                  } : undefined}
                >
              {gitRepository && (
                <div className="workspace-pane-local-header">
                  <Text size="xs" fw={650}>Repositories</Text>
                  <Tooltip label="Hide repositories pane">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label="Hide repositories pane"
                      onClick={() => setRepositoryPaneVisible(false)}
                    >
                      <IconLayoutSidebarLeftCollapse size={16} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              )}
              <div className="repository-results-scroll" ref={repositoryResultsScrollRef}>
              {selectedAccount && !selectedAccount.scopes.includes('repo') && (
                <Alert mt="lg" color="yellow" icon={<IconAlertCircle size={17} />}>
                  @{selectedAccount.login} was connected before repository access was enabled. Reconnect it from Accounts to include private repositories.
                </Alert>
              )}

              {repositoriesError && (
                <Alert mt="lg" color="red" icon={<IconAlertCircle size={17} />}>
                  {repositoriesError}
                </Alert>
              )}

              {repositoryTab === 'workspace' && workspaceOrderError && (
                <Alert mt="lg" color="red" icon={<IconAlertCircle size={17} />}>
                  {workspaceOrderError}
                </Alert>
              )}
              {repositoryTab === 'workspace' && workspaceTargetError && (
                <Alert mt="lg" color="red" icon={<IconAlertCircle size={17} />}>
                  {workspaceTargetError}
                </Alert>
              )}

              {cloneResult && (
                <Alert mt="lg" color="teal" icon={<IconCheck size={17} />}>
                  <Group justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="sm" fw={650}>{cloneResult.fullName} is ready locally</Text>
                      <Text size="xs" c="dimmed" className="clone-path">{cloneResult.path}</Text>
                    </div>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconBrandVscode size={14} />}
                        onClick={() => void openRepositoryInVSCode(cloneResult.path)}
                      >
                        Open in VS Code
                      </Button>
                      <Tooltip label="Open folder">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`Open ${cloneResult.fullName} folder`}
                          onClick={() => void window.desktop?.repositories.openFolder(cloneResult.path)}
                        >
                          <IconFolderOpen size={17} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Alert>
              )}

              {repositoriesLoading && visibleRepositories.length === 0 ? (
                <Paper className="empty-state repository-empty" radius="lg">
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed">Loading repositories…</Text>
                </Paper>
              ) : visibleRepositories.length === 0 ? (
                <Paper className="empty-state repository-empty" radius="lg">
                  <div className="empty-icon-wrap">
                    <IconBook2 size={34} stroke={1.55} />
                  </div>
                  <Text fz={18} fw={680}>
                    {repositorySearch || activeRepositoryOrganizationFilterCount > 0
                      ? 'No matching repositories'
                      : repositoryTab === 'local'
                        ? 'No local repositories yet'
                        : repositoryTab === 'github'
                          ? 'No GitHub-only repositories'
                          : `No repositories in ${selectedWorkspace?.name ?? 'this workspace'}`}
                  </Text>
                  <Text size="sm" c="dimmed" ta="center">
                    {repositorySearch || activeRepositoryOrganizationFilterCount > 0
                      ? 'Try a different search or clear some filters.'
                      : repositoryTab === 'local'
                        ? 'Add an existing repository or get one from GitHub.'
                        : repositoryTab === 'github'
                          ? 'Every available GitHub repository is already local.'
                          : 'Assign repositories from their Organize action, then they will appear here.'}
                  </Text>
                  {activeRepositoryOrganizationFilterCount > 0 && (
                    <Button
                      mt="xs"
                      variant="light"
                      leftSection={<IconX size={15} />}
                      onClick={clearRepositoryOrganizationFilters}
                    >
                      Clear filters
                    </Button>
                  )}
                  {!repositorySearch && activeRepositoryOrganizationFilterCount === 0 &&
                    repositoryTab === 'local' && (
                    <Group mt="xs" gap="xs">
                      <Button
                        variant="light"
                        leftSection={<IconFolderSearch size={16} />}
                        onClick={() => void addLocalRepository()}
                      >
                        Add local repository
                      </Button>
                      <Button
                        leftSection={<IconUpload size={16} />}
                        disabled={accounts.length === 0}
                        onClick={() => void addLocalRepository(true)}
                      >
                        Publish folder
                      </Button>
                    </Group>
                  )}
                  {!repositorySearch && activeRepositoryOrganizationFilterCount === 0 &&
                    repositoryTab === 'workspace' && (
                    <Button
                      mt="xs"
                      variant="light"
                      leftSection={<IconBriefcase size={16} />}
                      onClick={() => setActiveView('workspaces')}
                    >
                      Manage workspaces
                    </Button>
                  )}
                </Paper>
              ) : (
                <div className={`repository-collection repository-collection--${repositoryLayout}`}>
                  {pagedRepositories.map((repository) => {
                    const repositoryKey = repositoryOrganizationKey(repository)
                    const repositoryColor = repositoryColors[repositoryKey]
                    const gitStatus = repository.localPath
                      ? gitStatuses[repository.localPath]
                      : undefined
                    const changeCount = gitStatus
                      ? gitStatus.staged + gitStatus.unstaged + gitStatus.untracked + gitStatus.conflicts
                      : 0
                    const assignment = organizationAssignments[repositoryKey]
                    const assignedOrganizationItems = assignment ? [
                      ...organizationCatalog.workspaces.filter((item) => assignment.workspaceIds.includes(item.id)),
                      ...organizationCatalog.groups.filter((item) => assignment.groupIds.includes(item.id)),
                      ...organizationCatalog.tags.filter((item) => assignment.tagIds.includes(item.id)),
                    ] : []

                    return <Paper
                      className={`repository-card repository-card--${repositoryLayout}`}
                      data-repository-color={repositoryColor ? true : undefined}
                      style={repositoryColor
                        ? ({ '--repository-color': repositoryColor } as CSSProperties)
                        : undefined}
                      data-status={gitStatus && !gitStatus.error
                        ? gitStatus.conflicts > 0
                          ? 'conflict'
                          : gitStatus.ahead > 0 || gitStatus.behind > 0
                            ? 'sync-needed'
                            : !gitStatus.clean ? 'changes' : undefined
                        : undefined}
                      data-files-open={gitRepository?.localPath === repository.localPath || undefined}
                      data-selected={selectedRepositoryKeys.includes(repositoryKey) || undefined}
                      data-selecting={repositorySelectionMode || undefined}
                      data-clickable={repository.localPath || repositorySelectionMode || undefined}
                      data-dragging={draggedRepositoryKey === repositoryKey || undefined}
                      data-drop-target={repositoryDropTarget === repositoryKey &&
                        draggedRepositoryKey !== repositoryKey || undefined}
                      onDragOver={(event) => {
                        if (!workspaceReorderEnabled || !draggedRepositoryKey) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setRepositoryDropTarget(repositoryKey)
                      }}
                      onDrop={(event) => {
                        if (!workspaceReorderEnabled) return
                        event.preventDefault()
                        const sourceKey = draggedRepositoryKey || event.dataTransfer.getData('text/plain')
                        if (sourceKey) void reorderWorkspaceRepository(sourceKey, repositoryKey)
                      }}
                      role={repository.localPath || repositorySelectionMode ? 'button' : undefined}
                      tabIndex={repository.localPath || repositorySelectionMode ? 0 : undefined}
                      aria-label={repository.localPath
                        ? `Open files for ${repository.fullName}`
                        : repositorySelectionMode ? `Select ${repository.fullName}` : undefined}
                      onClick={(event) => {
                        const target = event.target
                        const interactive = target instanceof Element
                          ? target.closest(
                              'button, a, input, textarea, select, [role="button"], [draggable="true"]',
                            )
                          : null
                        if (interactive && interactive !== event.currentTarget) return
                        if (repositorySelectionMode) {
                          toggleRepositorySelection(repository)
                        } else if (repository.localPath) {
                          void openGitPanel(repository)
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget ||
                          (event.key !== 'Enter' && event.key !== ' ')) return
                        event.preventDefault()
                        if (repositorySelectionMode) {
                          toggleRepositorySelection(repository)
                        } else if (repository.localPath) {
                          void openGitPanel(repository)
                        }
                      }}
                      radius="lg"
                      key={`${repository.accountId}:${repository.fullName}`}
                    >
                      {repositorySelectionMode && (
                        <Checkbox
                          className="repository-selection-checkbox"
                          checked={selectedRepositoryKeys.includes(repositoryKey)}
                          aria-label={`Select ${repository.fullName}`}
                          onChange={() => toggleRepositorySelection(repository)}
                        />
                      )}
                      <div className="repository-details">
                        <Group gap={8} wrap="wrap">
                          <span
                            className="repository-language-icon"
                            style={{ color: repositoryLanguageColor(repository.language) }}
                            title={repository.language ?? 'Primary language unavailable'}
                            aria-label={repository.language
                              ? `Primary language: ${repository.language}`
                              : 'Primary language unavailable'}
                          >
                            {repositoryLanguageIcon(repository.language)}
                          </span>
                          {repositoryColor && (
                            <span
                              className="repository-color-dot"
                              style={{ backgroundColor: repositoryColor }}
                              title="Repository color"
                            />
                          )}
                          <Text fw={680}>{repository.fullName}</Text>
                          {repository.metadataLoaded && (
                            <>
                              <Badge
                                size="xs"
                                variant={repository.private ? 'outline' : 'light'}
                                color="gray"
                                leftSection={repository.private ? <IconLock size={10} /> : undefined}
                              >
                                {repository.private ? 'Private' : 'Public'}
                              </Badge>
                              {repository.archived && (
                                <Badge size="xs" variant="outline" color="gray">Archived</Badge>
                              )}
                              {repository.fork && (
                                <Badge size="xs" variant="outline" color="blue">Fork</Badge>
                              )}
                            </>
                          )}
                          {repository.localPath && gitStatus && !gitStatus.error && (
                            <Badge
                              size="xs"
                              variant={gitStatus.conflicts === 0 &&
                                (!gitStatus.clean || gitStatus.ahead > 0 || gitStatus.behind > 0)
                                ? 'filled'
                                : 'light'}
                              color={gitStatus.conflicts > 0
                                ? 'red'
                                : gitStatus.clean && gitStatus.upstream &&
                                    gitStatus.ahead === 0 && gitStatus.behind === 0
                                  ? 'teal'
                                  : gitStatus.ahead > 0 || gitStatus.behind > 0
                                    ? 'pink'
                                  : gitStatus.clean
                                    ? 'blue'
                                    : 'orange'}
                            >
                              {gitStatus.conflicts > 0
                                ? `${gitStatus.conflicts} conflicts`
                                : gitStatus.clean && gitStatus.upstream &&
                                    gitStatus.ahead === 0 && gitStatus.behind === 0
                                  ? `Synced${repository.lastSyncedAt
                                    ? ` ${timeAgo(repository.lastSyncedAt, relativeTimeNow)}`
                                    : ''}`
                                  : gitStatus.ahead > 0 || gitStatus.behind > 0
                                    ? 'Sync needed'
                                    : gitStatus.clean
                                      ? 'Local only'
                                      : `${changeCount} changes`}
                            </Badge>
                          )}
                          {selectedAccountId === 'all' && (
                            <Badge size="xs" variant="outline" color="gray">
                              @{repository.accountLogin}
                            </Badge>
                          )}
                          {assignedOrganizationItems.slice(0, 3).map((item) => (
                            <Badge
                              size="xs"
                              variant="outline"
                              color="gray"
                              styles={{ root: { borderColor: item.color, color: item.color } }}
                              key={item.id}
                            >
                              {item.name}
                            </Badge>
                          ))}
                          {assignedOrganizationItems.length > 3 && (
                            <Badge size="xs" variant="outline" color="gray">
                              +{assignedOrganizationItems.length - 3}
                            </Badge>
                          )}
                        </Group>
                        <Text size="sm" c="dimmed" mt={5} lineClamp={2}>
                          {repository.metadataLoaded
                            ? repository.description || 'No description provided.'
                            : repository.localPath}
                        </Text>
                        {repository.metadataLoaded ? (
                          <Group gap="md" mt="sm" className="repository-meta">
                            {repository.language && <Text size="xs">{repository.language}</Text>}
                            <Group gap={4}>
                              <IconStar size={13} />
                              <Text size="xs">{repository.stars}</Text>
                            </Group>
                            <Text size="xs">Updated {new Date(repository.updatedAt).toLocaleDateString()}</Text>
                            <Text size="xs">Default: {repository.defaultBranch}</Text>
                          </Group>
                        ) : (
                          <Group gap={7} mt="sm" className="repository-meta">
                            {repositoriesLoading && <Loader size={12} />}
                            <Text size="xs">
                              {repositoriesLoading ? 'Loading GitHub details…' : 'GitHub details unavailable'}
                            </Text>
                          </Group>
                        )}
                        {repository.localPath && (
                          <Group gap={7} mt="sm" className="git-status-row">
                            {!gitStatus ? (
                              <>
                                <Loader size={12} />
                                <Text size="xs">Checking Git status…</Text>
                              </>
                            ) : gitStatus.error ? (
                              <Text size="xs" c="red.4">{gitStatus.error}</Text>
                            ) : (
                              <>
                                <Group gap={4}>
                                  <IconGitBranch size={13} />
                                  <Text size="xs">{gitStatus.branch ?? 'Detached HEAD'}</Text>
                                </Group>
                                {gitStatus.staged > 0 && <Text size="xs">{gitStatus.staged} staged</Text>}
                                {gitStatus.unstaged > 0 && <Text size="xs">{gitStatus.unstaged} modified</Text>}
                                {gitStatus.untracked > 0 && <Text size="xs">{gitStatus.untracked} untracked</Text>}
                                {gitStatus.conflicts > 0 && <Text size="xs" c="red.4">{gitStatus.conflicts} conflicts</Text>}
                                {gitStatus.ahead > 0 && <Text size="xs" c="teal.4">↑ {gitStatus.ahead} unpushed</Text>}
                                {gitStatus.behind > 0 && <Text size="xs" c="yellow.4">↓ {gitStatus.behind} behind</Text>}
                                {gitStatus.clean && gitStatus.ahead === 0 && gitStatus.behind === 0 && (
                                  <Text size="xs">Working tree clean</Text>
                                )}
                              </>
                            )}
                          </Group>
                        )}
                      </div>

                      <Group className="repository-actions" gap="xs" wrap="nowrap">
                        {repositoryTab === 'workspace' && (
                          <Tooltip label={workspaceReorderEnabled
                            ? 'Drag to permanently reorder this workspace'
                            : workspaceOrderSaving
                              ? 'Saving workspace order…'
                              : 'Clear search and filters to reorder'}>
                            <ActionIcon
                              className="repository-drag-handle"
                              variant="subtle"
                              color="gray"
                              disabled={!workspaceReorderEnabled}
                              draggable={workspaceReorderEnabled}
                              aria-label={`Reorder ${repository.fullName}`}
                              onDragStart={(event) => {
                                if (!workspaceReorderEnabled) {
                                  event.preventDefault()
                                  return
                                }
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', repositoryKey)
                                setDraggedRepositoryKey(repositoryKey)
                                setRepositoryDropTarget(null)
                              }}
                              onDragEnd={() => {
                                setDraggedRepositoryKey(null)
                                setRepositoryDropTarget(null)
                              }}
                            >
                              <IconGripVertical size={17} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        <Tooltip label="Organize repository">
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label={`Organize ${repository.fullName}`}
                            onClick={() => openOrganizeRepository(repository)}
                          >
                            <IconTags size={17} />
                          </ActionIcon>
                        </Tooltip>
                        {repository.profileUrl && (
                          <ActionIcon
                            component="a"
                            href={repository.profileUrl}
                            target="_blank"
                            rel="noreferrer"
                            variant="subtle"
                            color="gray"
                            aria-label={`Open ${repository.fullName} on GitHub`}
                          >
                            <IconExternalLink size={17} />
                          </ActionIcon>
                        )}
                        {repository.localPath ? (
                          <Group gap="xs" wrap="nowrap">
                            {gitStatus && gitStatus.behind > 0 && (
                              <Button
                                size="xs"
                                variant="light"
                                color="yellow"
                                loading={cardGitAction === `pull:${repository.localPath}`}
                                disabled={Boolean(cardGitAction)}
                                onClick={() => void runCardGitAction(repository, 'pull')}
                              >
                                Pull {gitStatus.behind}
                              </Button>
                            )}
                            {gitStatus && gitStatus.staged > 0 && (
                              <Button
                                size="xs"
                                variant="light"
                                color="teal"
                                loading={cardGitAction === `commit:${repository.localPath}`}
                                disabled={Boolean(cardGitAction)}
                                onClick={() => openCardCommit(repository, false)}
                              >
                                Commit {gitStatus.staged}
                              </Button>
                            )}
                            {gitStatus && gitStatus.staged === 0 && gitStatus.conflicts === 0 &&
                              gitStatus.unstaged + gitStatus.untracked > 0 && (
                              <Button
                                size="xs"
                                variant="light"
                                color="teal"
                                loading={cardGitAction === `commit:${repository.localPath}`}
                                disabled={Boolean(cardGitAction)}
                                onClick={() => openCardCommit(repository, true)}
                              >
                                Commit all {gitStatus.unstaged + gitStatus.untracked}
                              </Button>
                            )}
                            {gitStatus && gitStatus.ahead > 0 && (
                              <Button
                                size="xs"
                                loading={cardGitAction === `push:${repository.localPath}`}
                                disabled={Boolean(cardGitAction)}
                                onClick={() => void runCardGitAction(repository, 'push')}
                              >
                                Push {gitStatus.ahead}
                              </Button>
                            )}
                            {gitStatus && !gitStatus.upstream && (
                              <Button
                                size="xs"
                                variant="light"
                                leftSection={<IconUpload size={14} />}
                                disabled={Boolean(cardGitAction) || gitStatus.conflicts > 0}
                                onClick={() => openPublishRepository(repository)}
                              >
                                Publish
                              </Button>
                            )}
                            {gitStatus?.upstream && (
                              <Button
                                size="xs"
                                variant="light"
                                loading={cardGitAction === `sync:${repository.localPath}`}
                                disabled={Boolean(cardGitAction) || gitStatus.conflicts > 0}
                                onClick={() => {
                                  const hasChanges = gitStatus.staged + gitStatus.unstaged + gitStatus.untracked > 0
                                  if (hasChanges) {
                                    openCardCommit(
                                      repository,
                                      gitStatus.unstaged + gitStatus.untracked > 0,
                                      true,
                                    )
                                  } else {
                                    void syncRepository(repository)
                                  }
                                }}
                              >
                                Sync
                              </Button>
                            )}
                            <Button
                              className="repository-insights-button"
                              size="xs"
                              variant="subtle"
                              color="gray"
                              leftSection={<IconChartBar size={14} />}
                              onClick={() => openRepositoryInsights(repository)}
                            >
                              Insights
                            </Button>
                            <Button
                              className="repository-files-button"
                              size="xs"
                              variant="subtle"
                              color="gray"
                              leftSection={<IconGitCommit size={14} />}
                              onClick={() => void openGitPanel(repository)}
                            >
                              Files
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconBrandVscode size={14} />}
                              onClick={() => void openRepositoryInVSCode(repository.localPath!)}
                            >
                              Open in VS Code
                            </Button>
                            <Tooltip label="Open folder">
                              <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label={`Open ${repository.fullName} folder`}
                                onClick={() => void window.desktop?.repositories.openFolder(repository.localPath!)}
                              >
                                <IconFolderOpen size={17} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        ) : (
                          <>
                            <Tooltip label="Locate an existing clone">
                              <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label={`Locate an existing clone of ${repository.fullName}`}
                                onClick={() => void locateRepository(repository)}
                              >
                                <IconFolderSearch size={17} />
                              </ActionIcon>
                            </Tooltip>
                            <Button
                              size="xs"
                              leftSection={<IconDownload size={14} />}
                              loading={cloningRepository === repository.fullName}
                              disabled={Boolean(cloningRepository) || repository.archived}
                              onClick={() => void cloneRepository(repository)}
                            >
                              Clone
                            </Button>
                          </>
                        )}
                      </Group>
                    </Paper>
                  })}
                </div>
              )}
              </div>

              {repositoryPageCount > 1 && (
                <div className="repository-pagination">
                  <Text size="xs" c="dimmed">
                    Showing {(repositoryPage - 1) * repositoriesPerPage + 1}–{Math.min(
                      repositoryPage * repositoriesPerPage,
                      visibleRepositories.length,
                    )} of {visibleRepositories.length}
                  </Text>
                  <Pagination
                    value={repositoryPage}
                    total={repositoryPageCount}
                    siblings={1}
                    boundaries={1}
                    onChange={changeRepositoryPage}
                  />
                </div>
              )}
                </section>
                )}

                {gitRepository && repositoryPaneVisible && (
                  <HorizontalSplitter
                    label="Resize repositories and files panes"
                    value={repositoryPaneWidth}
                    resetValue={430}
                    min={180}
                    max={2400}
                    reserveEnd={filesPanelTab === 'history' ? 660 : 420}
                    onChange={setRepositoryPaneWidth}
                  />
                )}

                {gitRepository?.localPath && (
                  <aside className="repository-files-panel" aria-label={`Files for ${gitRepository.fullName}`}>
                    <div className="files-panel-header">
                      {!repositoryPaneVisible && (
                        <>
                        <Tooltip label="Show repositories pane">
                          <ActionIcon
                            className="pane-restore-button"
                            variant="light"
                            color="teal"
                            aria-label="Show repositories pane"
                            onClick={() => setRepositoryPaneVisible(true)}
                          >
                            <IconLayoutSidebarLeftExpand size={17} />
                          </ActionIcon>
                        </Tooltip>
                        <Select
                          className="repository-quick-switch"
                          size="xs"
                          aria-label="Switch repository"
                          searchable
                          allowDeselect={false}
                          value={gitRepository.localPath}
                          data={repositories
                            .filter((repository) => Boolean(repository.localPath))
                            .map((repository) => ({
                              value: repository.localPath!,
                              label: repository.fullName,
                            }))}
                          onChange={(path) => {
                            const repository = repositories.find((item) => item.localPath === path)
                            if (repository) void openGitPanel(repository)
                          }}
                        />
                        </>
                      )}
                      <div className="files-panel-tabs" role="tablist" aria-label="Repository files">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={filesPanelTab === 'changes'}
                          data-active={filesPanelTab === 'changes' || undefined}
                          onClick={() => setFilesPanelTab('changes')}
                        >
                          Changes <span>{gitDetails?.files.length ?? 0}</span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={filesPanelTab === 'history'}
                          data-active={filesPanelTab === 'history' || undefined}
                          onClick={() => setFilesPanelTab('history')}
                        >
                          History
                        </button>
                        <Tooltip label={`${scmNavigatorVisible ? 'Hide' : 'Show'} ${filesPanelTab} navigator`}>
                          <ActionIcon
                            className="pane-local-toggle"
                            variant="subtle"
                            color="gray"
                            aria-label={`${scmNavigatorVisible ? 'Hide' : 'Show'} ${filesPanelTab} navigator`}
                            onClick={() => setScmNavigatorVisible((visible) => !visible)}
                          >
                            {scmNavigatorVisible
                              ? <IconLayoutSidebarLeftCollapse size={17} />
                              : <IconLayoutSidebarLeftExpand size={17} />}
                          </ActionIcon>
                        </Tooltip>
                      </div>
                      <Group gap={2} wrap="nowrap">
                      {filesPanelTab === 'history' && !commitFilesVisible && (
                        <Tooltip label="Show commit files">
                          <ActionIcon
                            variant="light"
                            color="teal"
                            aria-label="Show commit files"
                            onClick={() => setCommitFilesVisible(true)}
                          >
                            <IconLayoutSidebarLeftExpand size={17} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {!diffVisible && (
                      <Tooltip label="Show diff">
                        <ActionIcon
                          variant="light"
                          color="teal"
                          aria-label="Show diff"
                          onClick={() => setDiffVisible(true)}
                        >
                          <IconLayoutSidebarRightExpand size={17} />
                        </ActionIcon>
                      </Tooltip>
                      )}
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label="Close files panel"
                        disabled={Boolean(gitAction)}
                        onClick={() => {
                          setGitRepository(null)
                          setGitDetails(null)
                          setGitError(null)
                          setDiffTitle(null)
                          setDiffText(null)
                        }}
                      >
                        <IconX size={18} />
                      </ActionIcon>
                      </Group>
                    </div>

                    <div className="files-panel-scroll">
                      <Stack gap="md">
                        <Group justify="space-between" align="flex-start" wrap="wrap">
                          <Group gap="xs">
                            <Badge
                              variant="light"
                              color={gitDetails?.status.conflicts
                                ? 'red'
                                : gitDetails?.status.clean ? 'teal' : 'orange'}
                              leftSection={<IconGitBranch size={12} />}
                            >
                              {gitDetails?.status.branch ?? 'Repository'}
                            </Badge>
                            {gitDetails && gitDetails.status.ahead > 0 && (
                              <Badge variant="outline" color="teal">↑ {gitDetails.status.ahead}</Badge>
                            )}
                            {gitDetails && gitDetails.status.behind > 0 && (
                              <Badge variant="outline" color="yellow">↓ {gitDetails.status.behind}</Badge>
                            )}
                          </Group>
                          <Group gap={5}>
                            <Button
                              size="compact-xs"
                              variant="light"
                              loading={gitAction === 'fetch'}
                              disabled={Boolean(gitAction)}
                              onClick={() => void runGitAction('fetch', () =>
                                window.desktop!.repositories.gitFetch(gitRepository.localPath!),
                              )}
                            >
                              Fetch
                            </Button>
                            <Button
                              size="compact-xs"
                              variant="light"
                              loading={gitAction === 'pull'}
                              disabled={Boolean(gitAction)}
                              onClick={() => void runGitAction('pull', () =>
                                window.desktop!.repositories.gitPull(gitRepository.localPath!),
                              )}
                            >
                              Pull
                            </Button>
                            <Button
                              size="compact-xs"
                              loading={gitAction === 'push'}
                              disabled={Boolean(gitAction)}
                              onClick={() => void runGitAction('push', () =>
                                window.desktop!.repositories.gitPush(gitRepository.localPath!),
                              )}
                            >
                              Push
                            </Button>
                          </Group>
                        </Group>

                        {gitError && (
                          <Alert color="red" icon={<IconAlertCircle size={17} />}>{gitError}</Alert>
                        )}

                        {gitPanelLoading ? (
                          <Paper className="git-loading" radius="md">
                            <Loader size="sm" />
                            <Text size="sm" c="dimmed">Reading repository status…</Text>
                          </Paper>
                        ) : gitDetails ? (
                          <div
                            className="scm-surface"
                            data-tab={filesPanelTab}
                            style={{ gridTemplateColumns: scmGridColumns }}
                          >
                            {scmNavigatorVisible && (
                            <section className="scm-navigator">
                              {filesPanelTab === 'changes' ? (
                                <>
                                  <div className="scm-filter">
                                    <TextInput
                                      size="xs"
                                      aria-label="Filter changed files"
                                      placeholder="Filter"
                                      value={fileSearch}
                                      leftSection={<IconSearch size={14} />}
                                      onChange={(event) => setFileSearch(event.currentTarget.value)}
                                    />
                                    <Group justify="space-between" gap="xs" mt={8} wrap="nowrap">
                                      <Text size="xs" fw={650}>
                                        {gitDetails.files.length} changed {gitDetails.files.length === 1 ? 'file' : 'files'}
                                      </Text>
                                      <Group gap={4} wrap="nowrap">
                                        <Button
                                          size="compact-xs"
                                          variant="subtle"
                                          disabled={Boolean(gitAction) || gitDetails.files.length === 0}
                                          onClick={() => void runGitAction('stage-all', () =>
                                            window.desktop!.repositories.gitStage(gitRepository.localPath!, []),
                                          )}
                                        >
                                          Stage all
                                        </Button>
                                        <Button
                                          size="compact-xs"
                                          variant="subtle"
                                          color="gray"
                                          disabled={Boolean(gitAction) || !gitDetails.files.some((file) => file.staged)}
                                          onClick={() => void runGitAction('unstage-all', () =>
                                            window.desktop!.repositories.gitUnstage(gitRepository.localPath!, []),
                                          )}
                                        >
                                          Reset
                                        </Button>
                                      </Group>
                                    </Group>
                                  </div>

                                  <div className="scm-file-tree">
                                    {gitDetails.files
                                      .filter((file) => file.path.toLowerCase().includes(fileSearch.toLowerCase()))
                                      .map((file) => {
                                        const stagedDiff = file.staged && !file.unstaged
                                        return (
                                          <div
                                            className="scm-file-row"
                                            data-selected={selectedDiffPath === file.path || undefined}
                                            key={file.path}
                                          >
                                            <UnstyledButton
                                              className="scm-file-select"
                                              onClick={() => void showFileDiff(file, stagedDiff)}
                                            >
                                              <span className="scm-file-state" data-conflict={file.conflicted || undefined}>
                                                {file.untracked ? 'U' : file.conflicted ? '!' : file.staged ? 'S' : 'M'}
                                              </span>
                                              <Text component="span" size="xs" truncate>{file.path}</Text>
                                            </UnstyledButton>
                                            <Tooltip label={file.staged ? 'Unstage file' : 'Stage file'}>
                                              <ActionIcon
                                                size="sm"
                                                variant="subtle"
                                                color={file.staged ? 'gray' : 'teal'}
                                                disabled={Boolean(gitAction)}
                                                aria-label={`${file.staged ? 'Unstage' : 'Stage'} ${file.path}`}
                                                onClick={() => void runGitAction(
                                                  `${file.staged ? 'unstage' : 'stage'}:${file.path}`,
                                                  () => file.staged
                                                    ? window.desktop!.repositories.gitUnstage(
                                                        gitRepository.localPath!, [file.path],
                                                      )
                                                    : window.desktop!.repositories.gitStage(
                                                        gitRepository.localPath!, [file.path],
                                                      ),
                                                )}
                                              >
                                                {file.staged ? '−' : '+'}
                                              </ActionIcon>
                                            </Tooltip>
                                          </div>
                                        )
                                      })}
                                  </div>

                                  <div className="scm-commit-box">
                                    <TextInput
                                      aria-label="Commit summary"
                                      placeholder="Summary (required)"
                                      value={commitMessage}
                                      onChange={(event) => setCommitMessage(event.currentTarget.value)}
                                    />
                                    <Textarea
                                      mt={8}
                                      aria-label="Commit description"
                                      placeholder="Description"
                                      minRows={3}
                                      maxRows={6}
                                      autosize
                                      value={commitDescription}
                                      onChange={(event) => setCommitDescription(event.currentTarget.value)}
                                    />
                                    <Button
                                      fullWidth
                                      size="xs"
                                      mt={8}
                                      leftSection={<IconGitCommit size={15} />}
                                      loading={gitAction === 'commit'}
                                      disabled={Boolean(gitAction) || !commitMessage.trim() ||
                                        !gitDetails.files.some((file) => file.staged)}
                                      onClick={() => void (async () => {
                                        const committed = await runGitAction('commit', () =>
                                          window.desktop!.repositories.gitCommit(
                                            gitRepository.localPath!,
                                            commitDescription.trim()
                                              ? `${commitMessage}\n\n${commitDescription.trim()}`
                                              : commitMessage,
                                          ),
                                        )
                                        if (committed) {
                                          setCommitMessage('')
                                          setCommitDescription('')
                                        }
                                      })()}
                                    >
                                      Commit staged
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <div className="scm-history-list">
                                  {gitHistory.length === 0 ? (
                                    <Text size="xs" c="dimmed" p="md">No commits yet.</Text>
                                  ) : gitHistory.map((commit) => (
                                    <UnstyledButton
                                      className="scm-history-row"
                                      data-selected={selectedCommitHash === commit.hash || undefined}
                                      disabled={Boolean(gitAction)}
                                      key={commit.hash}
                                      onClick={() => void showCommitDiff(commit)}
                                    >
                                      <div className="scm-history-subject">
                                        <Text size="xs" fw={650} lineClamp={2}>{commit.subject}</Text>
                                        {commit.unpushed && (
                                          <span
                                            className="scm-history-unpushed"
                                            title="Not pushed to the upstream branch"
                                            aria-label="Not pushed"
                                          >
                                            <IconArrowUp size={13} stroke={2.2} />
                                          </span>
                                        )}
                                      </div>
                                      <Group gap={7} mt={4} wrap="nowrap">
                                        <Text size="10px" c="teal.4">{commit.shortHash}</Text>
                                        <Text size="10px" c="dimmed" truncate>{commit.author}</Text>
                                        <Text size="10px" c="dimmed">
                                          {new Date(commit.authoredAt).toLocaleDateString()}
                                        </Text>
                                      </Group>
                                    </UnstyledButton>
                                  ))}
                                </div>
                              )}
                            </section>
                            )}

                            {scmNavigatorVisible && (historyFilesShown || diffVisible) && (
                            <HorizontalSplitter
                              label={`Resize ${filesPanelTab} navigator`}
                              value={scmNavigatorWidth}
                              resetValue={290}
                              min={150}
                              max={1600}
                              reserveEnd={filesPanelTab === 'history' ? 446 : 280}
                              onChange={setScmNavigatorWidth}
                            />
                            )}

                            {historyFilesShown && (
                              <section className="scm-commit-files-panel">
                                {selectedCommitHash ? (
                                  <>
                                    <div className="scm-commit-summary">
                                      <Tooltip label="Hide commit files">
                                        <ActionIcon
                                          className="pane-corner-toggle"
                                          size="sm"
                                          variant="subtle"
                                          color="gray"
                                          aria-label="Hide commit files"
                                          onClick={() => setCommitFilesVisible(false)}
                                        >
                                          <IconLayoutSidebarLeftCollapse size={16} />
                                        </ActionIcon>
                                      </Tooltip>
                                      <Text size="sm" fw={700} lineClamp={2}>
                                        {gitHistory.find((commit) => commit.hash === selectedCommitHash)?.subject}
                                      </Text>
                                      <Group gap={7} mt={5} wrap="nowrap">
                                        <Text size="10px" c="teal.4">
                                          {gitHistory.find((commit) => commit.hash === selectedCommitHash)?.shortHash}
                                        </Text>
                                        <Text size="10px" c="dimmed" truncate>
                                          {gitHistory.find((commit) => commit.hash === selectedCommitHash)?.author}
                                        </Text>
                                      </Group>
                                    </div>
                                    <Text className="scm-commit-files-count" size="xs" fw={650}>
                                      {selectedCommitFiles.length} changed {selectedCommitFiles.length === 1 ? 'file' : 'files'}
                                    </Text>
                                    <div className="scm-commit-files-list">
                                      {selectedCommitFiles.map((file) => (
                                        <UnstyledButton
                                          className="scm-commit-file-row"
                                          data-selected={selectedCommitFile === file.path || undefined}
                                          disabled={Boolean(gitAction)}
                                          key={file.path}
                                          onClick={() => void showCommitFileDiff(file)}
                                        >
                                          <Text component="span" size="xs" truncate>{file.path}</Text>
                                          <span data-status={file.status}>{file.status}</span>
                                        </UnstyledButton>
                                      ))}
                                    </div>
                                  </>
                                ) : (
                                  <div className="scm-diff-empty">
                                    <IconGitCommit size={27} stroke={1.4} />
                                    <Text size="xs" fw={650}>Select a commit</Text>
                                  </div>
                                )}
                              </section>
                            )}

                            {historyFilesShown && diffVisible && (
                              <HorizontalSplitter
                                label="Resize changed files and diff panes"
                                value={commitFilesWidth}
                                resetValue={300}
                                min={150}
                                max={1600}
                                reserveEnd={280}
                                onChange={setCommitFilesWidth}
                              />
                            )}

                            {diffVisible && (
                            <section className="scm-diff-workspace">
                              <div className="scm-diff-header">
                                <Text size="xs" fw={650} truncate>
                                  {filesPanelTab === 'history'
                                    ? selectedCommitFile ?? 'Select a file'
                                    : diffTitle ?? gitRepository.fullName}
                                </Text>
                                {filesPanelTab === 'changes' && (
                                <Group gap={5} wrap="nowrap">
                                  <Badge
                                    size="xs"
                                    variant="light"
                                    color={gitDetails.status.conflicts > 0
                                      ? 'red'
                                      : gitDetails.status.clean ? 'teal' : 'orange'}
                                  >
                                    {gitDetails.status.branch ?? 'Detached'}
                                  </Badge>
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    loading={gitAction === 'fetch'}
                                    disabled={Boolean(gitAction)}
                                    onClick={() => void runGitAction('fetch', () =>
                                      window.desktop!.repositories.gitFetch(gitRepository.localPath!),
                                    )}
                                  >
                                    Fetch
                                  </Button>
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    disabled={Boolean(gitAction)}
                                    onClick={() => void runGitAction('pull', () =>
                                      window.desktop!.repositories.gitPull(gitRepository.localPath!),
                                    )}
                                  >
                                    Pull
                                  </Button>
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    disabled={Boolean(gitAction)}
                                    onClick={() => void runGitAction('push', () =>
                                      window.desktop!.repositories.gitPush(gitRepository.localPath!),
                                    )}
                                  >
                                    Push
                                  </Button>
                                </Group>
                                )}
                                <Tooltip label="Hide diff pane">
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    color="gray"
                                    aria-label="Hide diff pane"
                                    onClick={() => setDiffVisible(false)}
                                  >
                                    <IconLayoutSidebarRightCollapse size={16} />
                                  </ActionIcon>
                                </Tooltip>
                              </div>

                              {diffText !== null ? (
                                <div className="scm-diff-code" role="table" aria-label={diffTitle ?? 'File diff'}>
                                  {parseUnifiedDiff(diffText).map((line, index) => (
                                    <div className="scm-diff-line" data-kind={line.kind} role="row" key={index}>
                                      <span className="scm-line-number">{line.oldLine ?? ''}</span>
                                      <span className="scm-line-number">{line.newLine ?? ''}</span>
                                      <span className="scm-line-marker">
                                        {line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : ''}
                                      </span>
                                      <code>{line.text || ' '}</code>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="scm-diff-empty">
                                  <IconGitCommit size={30} stroke={1.4} />
                                  <Text size="sm" fw={650}>Select a changed file</Text>
                                  <Text size="xs" c="dimmed">Its diff will open here.</Text>
                                </div>
                              )}
                            </section>
                            )}

                            {!scmHasContent && (
                              <div className="scm-diff-empty">
                                <IconLayoutGrid size={30} stroke={1.4} />
                                <Text size="sm" fw={650}>All workspace panes are hidden</Text>
                                <Button
                                  size="xs"
                                  variant="light"
                                  onClick={() => {
                                    setScmNavigatorVisible(true)
                                    setCommitFilesVisible(true)
                                    setDiffVisible(true)
                                  }}
                                >
                                  Restore panes
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : null}

                        <div hidden>
                        {gitPanelLoading ? (
                          <Paper className="git-loading" radius="md">
                            <Loader size="sm" />
                            <Text size="sm" c="dimmed">Reading repository status…</Text>
                          </Paper>
                        ) : gitDetails ? (
                          <>
                            <Group justify="space-between" wrap="wrap">
                              <div>
                                <Text size="sm" fw={680}>Changed files</Text>
                                <Text size="xs" c="dimmed">
                                  {gitDetails.files.length === 0
                                    ? 'Working tree clean'
                                    : `${gitDetails.files.length} changed ${gitDetails.files.length === 1 ? 'file' : 'files'}`}
                                </Text>
                              </div>
                              {gitDetails.files.length > 0 && (
                                <Group gap={5}>
                                  <Button
                                    size="compact-xs"
                                    variant="light"
                                    disabled={Boolean(gitAction)}
                                    loading={gitAction === 'stage-all'}
                                    onClick={() => void runGitAction('stage-all', () =>
                                      window.desktop!.repositories.gitStage(gitRepository.localPath!, []),
                                    )}
                                  >
                                    Stage all
                                  </Button>
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    color="gray"
                                    disabled={Boolean(gitAction) || !gitDetails.files.some((file) => file.staged)}
                                    loading={gitAction === 'unstage-all'}
                                    onClick={() => void runGitAction('unstage-all', () =>
                                      window.desktop!.repositories.gitUnstage(gitRepository.localPath!, []),
                                    )}
                                  >
                                    Unstage all
                                  </Button>
                                </Group>
                              )}
                            </Group>

                            {gitDetails.files.length > 0 && (
                              <Stack gap={7} className="git-file-list">
                                {gitDetails.files.map((file) => (
                                  <Paper className="git-file-row" radius="md" key={file.path}>
                                    <div className="git-file-name">
                                      <Text size="sm" fw={600} truncate>{file.path}</Text>
                                      <Group gap={5} mt={4}>
                                        {file.conflicted && <Badge size="xs" color="red">Conflict</Badge>}
                                        {file.staged && <Badge size="xs" color="teal">Staged</Badge>}
                                        {file.unstaged && <Badge size="xs" color="orange">Modified</Badge>}
                                        {file.untracked && <Badge size="xs" variant="light" color="orange">Untracked</Badge>}
                                      </Group>
                                    </div>
                                    <Group gap={4} wrap="nowrap">
                                      {(file.unstaged || file.untracked) && (
                                        <Button
                                          size="compact-xs"
                                          variant="subtle"
                                          color="gray"
                                          loading={gitAction === `diff:working:${file.path}`}
                                          disabled={Boolean(gitAction)}
                                          onClick={() => void showFileDiff(file, false)}
                                        >
                                          Diff
                                        </Button>
                                      )}
                                      {file.staged && (
                                        <Button
                                          size="compact-xs"
                                          variant="subtle"
                                          color="gray"
                                          loading={gitAction === `diff:staged:${file.path}`}
                                          disabled={Boolean(gitAction)}
                                          onClick={() => void showFileDiff(file, true)}
                                        >
                                          Diff
                                        </Button>
                                      )}
                                      {(file.unstaged || file.untracked) ? (
                                        <Button
                                          size="compact-xs"
                                          variant="light"
                                          disabled={Boolean(gitAction)}
                                          loading={gitAction === `stage:${file.path}`}
                                          onClick={() => void runGitAction(`stage:${file.path}`, () =>
                                            window.desktop!.repositories.gitStage(gitRepository.localPath!, [file.path]),
                                          )}
                                        >
                                          Stage
                                        </Button>
                                      ) : file.staged ? (
                                        <Button
                                          size="compact-xs"
                                          variant="light"
                                          color="gray"
                                          disabled={Boolean(gitAction)}
                                          loading={gitAction === `unstage:${file.path}`}
                                          onClick={() => void runGitAction(`unstage:${file.path}`, () =>
                                            window.desktop!.repositories.gitUnstage(gitRepository.localPath!, [file.path]),
                                          )}
                                        >
                                          Unstage
                                        </Button>
                                      ) : null}
                                    </Group>
                                  </Paper>
                                ))}
                              </Stack>
                            )}

                            {diffText !== null && (
                              <Paper className="git-diff-panel" radius="md">
                                <Group justify="space-between" mb="sm" wrap="nowrap">
                                  <Text size="sm" fw={650} truncate>{diffTitle}</Text>
                                  <ActionIcon
                                    variant="subtle"
                                    color="gray"
                                    aria-label="Close diff"
                                    onClick={() => {
                                      setDiffTitle(null)
                                      setDiffText(null)
                                    }}
                                  >
                                    <IconX size={15} />
                                  </ActionIcon>
                                </Group>
                                <pre>{diffText}</pre>
                              </Paper>
                            )}

                            <Divider />
                            <Textarea
                              label="Commit message"
                              placeholder="Describe this change"
                              minRows={2}
                              maxRows={4}
                              autosize
                              value={commitMessage}
                              onChange={(event) => setCommitMessage(event.currentTarget.value)}
                            />
                            <Button
                              fullWidth
                              leftSection={<IconGitCommit size={16} />}
                              loading={gitAction === 'commit'}
                              disabled={Boolean(gitAction) || !commitMessage.trim() ||
                                !gitDetails.files.some((file) => file.staged)}
                              onClick={() => void (async () => {
                                const committed = await runGitAction('commit', () =>
                                  window.desktop!.repositories.gitCommit(
                                    gitRepository.localPath!,
                                    commitMessage,
                                  ),
                                )
                                if (committed) setCommitMessage('')
                              })()}
                            >
                              Commit staged changes
                            </Button>
                          </>
                        ) : null}
                        </div>
                      </Stack>
                    </div>
                  </aside>
                )}
              </div>
            </div>
          ) : activeOrganizationKind && activeOrganizationCopy ? (
            <div className="organization-management-content">
              <section className="intro-row">
                <div>
                  <Text fz={24} fw={720} className="page-title">
                    Manage {activeOrganizationCopy.plural.toLowerCase()}
                  </Text>
                  <Text c="dimmed" mt={5} maw={650}>
                    {activeOrganizationCopy.description}
                  </Text>
                </div>
                <Badge variant="outline" color="gray" size="lg">
                  {activeOrganizationItems.length}{' '}
                  {activeOrganizationItems.length === 1
                    ? activeOrganizationCopy.singular.toLowerCase()
                    : activeOrganizationCopy.plural.toLowerCase()}
                </Badge>
              </section>

              {activeOrganizationItems.length === 0 ? (
                <Paper className="empty-state organization-empty" radius="lg">
                  <div className="empty-icon-wrap">
                    {activeOrganizationKind === 'workspace'
                      ? <IconBriefcase size={34} stroke={1.55} />
                      : activeOrganizationKind === 'group'
                        ? <IconFolders size={34} stroke={1.55} />
                        : <IconTags size={34} stroke={1.55} />}
                  </div>
                  <Text fz={19} fw={680}>
                    Create your first {activeOrganizationCopy.singular.toLowerCase()}
                  </Text>
                  <Text c="dimmed" size="sm" maw={470} ta="center" lh={1.6}>
                    Once created, you can assign it to repositories from each repository’s Organize action.
                  </Text>
                  <Button
                    mt="xs"
                    leftSection={<IconPlus size={17} />}
                    onClick={() => openOrganizationEditor(activeOrganizationKind)}
                  >
                    New {activeOrganizationCopy.singular.toLowerCase()}
                  </Button>
                </Paper>
              ) : (
                <div className="organization-management-grid">
                  {activeOrganizationItems.map((item) => (
                    <Paper className="organization-management-card" radius="lg" key={item.id}>
                      <div
                        className="organization-management-accent"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Group gap="sm" wrap="nowrap">
                          <ThemeIcon
                            variant="light"
                            color="gray"
                            size={38}
                            radius="md"
                            styles={{ root: { color: item.color } }}
                          >
                            {item.kind === 'workspace'
                              ? <IconBriefcase size={20} />
                              : item.kind === 'group'
                                ? <IconFolders size={20} />
                                : <IconTags size={20} />}
                          </ThemeIcon>
                          <div className="organization-management-identity">
                            <Text fw={700} truncate>{item.name}</Text>
                            <Text size="xs" c="dimmed">
                              {item.repositoryCount} {item.repositoryCount === 1 ? 'repository' : 'repositories'}
                            </Text>
                          </div>
                        </Group>
                        <Group gap={4} wrap="nowrap">
                          {item.kind === 'workspace' && (
                            <Button
                              size="compact-xs"
                              variant="light"
                              leftSection={<IconBriefcase size={13} />}
                              onClick={() => openWorkspaceRepositories(item.id)}
                            >
                              Open
                            </Button>
                          )}
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="gray"
                            onClick={() => openOrganizationEditor(item.kind, item)}
                          >
                            Edit
                          </Button>
                          <Tooltip label={`Delete ${item.name}`}>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="red"
                              aria-label={`Delete ${item.name}`}
                              onClick={() => {
                                setOrganizationEditorError(null)
                                setOrganizationDeleteItem(item)
                              }}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                      <Text className="organization-management-description" size="sm" c="dimmed">
                        {item.description || `No description for this ${organizationCopy[item.kind].singular.toLowerCase()}.`}
                      </Text>
                    </Paper>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="settings-content">
              <section className="intro-row">
                <div>
                  <Text fz={24} fw={720} className="page-title">Application settings</Text>
                  <Text c="dimmed" mt={5} maw={620}>
                    Choose how MyRepos opens your local repositories.
                  </Text>
                </div>
              </section>

              {settingsError && (
                <Alert mt="lg" color="red" icon={<IconAlertCircle size={17} />}>
                  {settingsError}
                </Alert>
              )}
              {settingsSaved && (
                <Alert mt="lg" color="teal" icon={<IconCheck size={17} />}>
                  Settings saved.
                </Alert>
              )}

              {configurationSyncError && (
                <Alert mt="lg" color="red" icon={<IconAlertCircle size={17} />}>
                  {configurationSyncError}
                </Alert>
              )}

              <Paper className="settings-card" radius="lg" mt={28}>
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon variant="light" color="teal" size={40} radius="md">
                      <IconBrandGithub size={22} />
                    </ThemeIcon>
                    <div>
                      <Text fw={680}>Portable configuration repository</Text>
                      <Text size="xs" c="dimmed">
                        Sync workspaces, groups, tags, colors, assignments, and ordering through Git.
                      </Text>
                    </div>
                  </Group>
                  {configurationSync.connected && (
                    <Badge
                      color={configurationSync.lastError
                        ? 'red'
                        : configurationSync.hasRemote ? 'teal' : 'blue'}
                      variant="light"
                    >
                      {configurationSync.lastError
                        ? 'Needs attention'
                        : configurationSync.hasRemote ? 'Connected' : 'Local only'}
                    </Badge>
                  )}
                </Group>

                {configurationSyncLoading ? (
                  <Group gap="sm" mt="lg"><Loader size="sm" /><Text size="sm">Checking configuration…</Text></Group>
                ) : configurationSync.connected ? (
                  <Stack gap="md" mt="lg">
                    <Paper className="configuration-sync-location" radius="md">
                      <Text size="sm" fw={650}>
                        {configurationSync.fullName || 'Local configuration repository'}
                      </Text>
                      <Text size="xs" c="dimmed" truncate title={configurationSync.localPath ?? undefined}>
                        {configurationSync.localPath}
                      </Text>
                      <Text size="xs" c={configurationSync.lastError ? 'red.4' : 'dimmed'} mt={5}>
                        {configurationSync.lastError
                          ? configurationSync.lastError
                          : configurationSync.lastSyncedAt
                            ? `Last updated ${timeAgo(configurationSync.lastSyncedAt, relativeTimeNow)}`
                            : 'Ready for its first sync'}
                      </Text>
                    </Paper>
                    <Switch
                      checked={configurationSync.autoSync}
                      disabled={Boolean(configurationSyncAction)}
                      label={configurationSync.hasRemote
                        ? 'Automatically commit and push configuration changes'
                        : 'Automatically commit local configuration snapshots'}
                      description="Changes are debounced and only .myrepos/config.json is committed."
                      onChange={(event) => void changeConfigurationAutoSync(event.currentTarget.checked)}
                    />
                    <Group justify="space-between" wrap="wrap">
                      <Group gap="xs">
                        {configurationSync.hasRemote && (
                          <>
                            <Button
                              size="xs"
                              variant="light"
                              loading={configurationSyncAction === 'sync'}
                              disabled={Boolean(configurationSyncAction)}
                              leftSection={<IconRefresh size={14} />}
                              onClick={() => void runConfigurationSync('sync')}
                            >
                              Sync now
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              color="gray"
                              loading={configurationSyncAction === 'pull'}
                              disabled={Boolean(configurationSyncAction)}
                              onClick={() => void runConfigurationSync('pull')}
                            >
                              Pull
                            </Button>
                          </>
                        )}
                        <Button
                          size="xs"
                          variant="subtle"
                          color="gray"
                          loading={configurationSyncAction === 'push'}
                          disabled={Boolean(configurationSyncAction)}
                          onClick={() => void runConfigurationSync('push')}
                        >
                          {configurationSync.hasRemote ? 'Push' : 'Save snapshot'}
                        </Button>
                      </Group>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="subtle"
                          color="gray"
                          leftSection={<IconFolderOpen size={14} />}
                          onClick={() => void window.desktop?.configurationSync.openFolder()
                            .catch((error) => setConfigurationSyncError(errorMessage(error)))}
                        >
                          Open folder
                        </Button>
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <Button size="xs" variant="subtle" color="gray">Change repository</Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => openConfigurationSetup('create')}>
                              Create a new repository
                            </Menu.Item>
                            <Menu.Item onClick={() => openConfigurationSetup('remote')}>
                              Use a GitHub repository
                            </Menu.Item>
                            <Menu.Item onClick={() => openConfigurationSetup('local')}>
                              Use a local repository
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          onClick={() => void disconnectConfigurationSync()}
                        >
                          Disconnect
                        </Button>
                      </Group>
                    </Group>
                  </Stack>
                ) : (
                  <Stack gap="md" mt="lg">
                    <Alert color="blue" variant="light">
                      Credentials, OAuth tokens, absolute local paths, and machine-specific settings
                      are never written to the shared configuration.
                    </Alert>
                    <Group gap="xs" wrap="wrap">
                      <Button
                        size="xs"
                        leftSection={<IconUpload size={14} />}
                        disabled={accounts.length === 0}
                        onClick={() => openConfigurationSetup('create')}
                      >
                        Create automatically
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        disabled={accounts.length === 0}
                        onClick={() => openConfigurationSetup('remote')}
                      >
                        Use GitHub repository
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="gray"
                        disabled={accounts.length === 0}
                        onClick={() => openConfigurationSetup('local')}
                      >
                        Use local repository
                      </Button>
                    </Group>
                    {accounts.length === 0 && (
                      <Text size="xs" c="dimmed">Connect a GitHub account before configuring sync.</Text>
                    )}
                  </Stack>
                )}
              </Paper>

              <Paper className="settings-card" radius="lg" mt={28}>
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon variant="light" color="teal" size={40} radius="md">
                      <IconDownload size={22} />
                    </ThemeIcon>
                    <div>
                      <Text fw={680}>Application updates</Text>
                      <Text size="xs" c="dimmed">Stable channel · GitHub Releases</Text>
                    </div>
                  </Group>
                  <Badge
                    variant="light"
                    color={
                      updateState.phase === 'error' ? 'red' :
                      updateState.phase === 'downloaded' ? 'teal' :
                      updateState.phase === 'available' || updateState.phase === 'downloading' ? 'blue' : 'gray'
                    }
                  >
                    {updateState.phase === 'up-to-date' ? 'Up to date' : updateState.phase.replace('-', ' ')}
                  </Badge>
                </Group>

                <Paper className="update-status" radius="md" mt="lg">
                  <Group justify="space-between" align="center" wrap="wrap">
                    <div>
                      <Text size="sm" fw={650}>
                        MyRepos {updateState.currentVersion || 'development'}
                      </Text>
                      <Text size="xs" c={updateState.phase === 'error' ? 'red.4' : 'dimmed'} mt={3}>
                        {updateState.message || 'Ready to check for a newer stable release.'}
                      </Text>
                    </div>
                    <Group gap="xs">
                      {updateState.phase === 'available' && (
                        <Button
                          size="xs"
                          leftSection={<IconDownload size={14} />}
                          loading={updateAction === 'download'}
                          onClick={() => void runUpdateAction('download')}
                        >
                          Download {updateState.availableVersion}
                        </Button>
                      )}
                      {updateState.phase === 'downloaded' && (
                        <Button
                          size="xs"
                          leftSection={<IconRefresh size={14} />}
                          loading={updateAction === 'install'}
                          onClick={() => void runUpdateAction('install')}
                        >
                          Restart and install
                        </Button>
                      )}
                      {updateState.phase !== 'downloaded' && (
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconRefresh size={14} />}
                          loading={updateState.phase === 'checking' || updateAction === 'check'}
                          disabled={
                            !updateState.packaged ||
                            updateState.phase === 'downloading' ||
                            updateAction === 'download'
                          }
                          onClick={() => void runUpdateAction('check')}
                        >
                          Check for updates
                        </Button>
                      )}
                    </Group>
                  </Group>
                  {updateState.phase === 'downloading' && (
                    <div className="update-progress">
                      <Progress value={updateState.progress ?? 0} animated size="sm" radius="xl" />
                      <Text size="xs" c="dimmed">
                        {updateState.transferred !== null && updateState.total !== null
                          ? `${formatBytes(updateState.transferred)} of ${formatBytes(updateState.total)}`
                          : 'Preparing download…'}
                      </Text>
                    </div>
                  )}
                </Paper>

                <Stack gap="sm" mt="lg">
                  <Switch
                    checked={settings.automaticallyCheckForUpdates}
                    disabled={settingsLoading}
                    label="Automatically check for updates"
                    description="Checks shortly after launch and every six hours while MyRepos is running."
                    onChange={(event) => {
                      setSettings((current) => ({
                        ...current,
                        automaticallyCheckForUpdates: event.currentTarget.checked,
                      }))
                      setSettingsSaved(false)
                    }}
                  />
                  <Switch
                    checked={settings.automaticallyDownloadUpdates}
                    disabled={settingsLoading}
                    label="Automatically download available updates"
                    description="Installation waits until you choose Restart and install."
                    onChange={(event) => {
                      setSettings((current) => ({
                        ...current,
                        automaticallyDownloadUpdates: event.currentTarget.checked,
                      }))
                      setSettingsSaved(false)
                    }}
                  />
                </Stack>
              </Paper>

              <Paper className="settings-card" radius="lg" mt={28}>
                <Group gap="sm" mb="lg" wrap="nowrap">
                  <ThemeIcon variant="light" color="blue" size={40} radius="md">
                    <IconBrandVscode size={22} />
                  </ThemeIcon>
                  <div>
                    <Text fw={680}>Visual Studio Code</Text>
                    <Text size="xs" c="dimmed">Repository editor integration</Text>
                  </div>
                </Group>

                <TextInput
                  label="macOS application name"
                  description="If you renamed Visual Studio Code, enter its exact Finder name here. Leave blank to use the registered official VS Code application."
                  placeholder="For example: VS Code Work"
                  value={settings.vscodeApplicationName}
                  disabled={settingsLoading || platform !== 'darwin'}
                  leftSection={<IconBrandVscode size={16} />}
                  onChange={(event) => {
                    setSettings((current) => ({
                      ...current,
                      vscodeApplicationName: event.currentTarget.value,
                    }))
                    setSettingsError(null)
                    setSettingsSaved(false)
                  }}
                />

                {platform !== 'darwin' && (
                  <Text size="xs" c="dimmed" mt="sm">
                    On Windows and Linux, MyRepos uses the installed <code>code</code> launcher.
                  </Text>
                )}
              </Paper>
            </div>
          )}
        </div>
      </main>

      <Modal
        opened={Boolean(insightsRepository)}
        onClose={() => setInsightsRepository(null)}
        title={insightsRepository ? `Insights · ${insightsRepository.fullName}` : 'Insights'}
        size="calc(100vw - 64px)"
        centered
        closeButtonProps={{ className: 'insights-close-button', 'aria-label': 'Close Insights' }}
        classNames={{ content: 'insights-modal', body: 'insights-modal-body' }}
      >
        <div className="insights-toolbar">
          <div>
            <Text size="sm" fw={700}>Project intelligence</Text>
            <Text size="xs" c="dimmed">
              {insightsResult
                ? `Scanned ${timeAgo(insightsResult.scannedAt, relativeTimeNow)} in ${insightsResult.durationMs.toLocaleString()} ms`
                : 'Files stay on this machine and are analyzed locally.'}
            </Text>
          </div>
          <Group gap="xs" wrap="nowrap">
            <Select
              size="xs"
              aria-label="Insights scan mode"
              value={insightsMode}
              allowDeselect={false}
              data={[
                { value: 'off', label: 'Off' },
                { value: 'manual', label: 'Manual' },
                { value: 'automatic', label: 'Automatic' },
                { value: 'hybrid', label: 'Hybrid' },
              ]}
              onChange={(value) => changeInsightsMode((value as InsightsMode | null) ?? 'manual')}
            />
            <Button
              size="xs"
              leftSection={<IconChartBar size={15} />}
              loading={insightsLoading}
              disabled={insightsMode === 'off' || !insightsRepository?.localPath}
              onClick={() => insightsRepository && void scanRepositoryInsights(insightsRepository)}
            >
              {insightsResult ? 'Rescan project' : 'Scan project'}
            </Button>
          </Group>
        </div>

        {insightsError && (
          <Alert color="red" icon={<IconAlertCircle size={17} />} mb="md">{insightsError}</Alert>
        )}

        {insightsLoading && !insightsResult ? (
          <div className="insights-empty">
            <Loader size="md" />
            <Text fw={650}>Scanning the project…</Text>
            <Text size="xs" c="dimmed">Classifying files, counting lines, and detecting technologies.</Text>
          </div>
        ) : !insightsResult ? (
          <div className="insights-empty">
            <IconChartBar size={34} stroke={1.5} />
            <Text fw={650}>{insightsMode === 'off' ? 'Insights are off' : 'No scan report yet'}</Text>
            <Text size="xs" c="dimmed">
              {insightsMode === 'off'
                ? 'Choose a scan mode to enable Insights for this repository.'
                : 'Scan the project to build its local intelligence report.'}
            </Text>
          </div>
        ) : (
          <>
            <Group justify="space-between" mt="sm" gap="sm">
              <Text size="xs" c="dimmed">Report scope</Text>
              <Select
                size="xs"
                value={insightsProject}
                allowDeselect={false}
                searchable
                data={[
                  { value: 'all', label: `Entire repository (${insightsResult.projects.length} projects)` },
                  ...insightsResult.projects.map((item) => ({ value: item.path, label: `${item.name} · ${item.path}` })),
                ]}
                onChange={(value) => {
                  setInsightsProject(value ?? 'all')
                  setInsightsLanguage('all')
                  setInsightsExtension('all')
                  setInsightsMetric('all')
                }}
              />
            </Group>
            <div className="insights-stats">
              {[
                { label: 'Files', value: scopedInsightTotals.files, metric: 'all' as const },
                { label: 'Lines', value: scopedInsightTotals.lines, metric: 'lines' as const },
                { label: 'Code', value: scopedInsightTotals.codeLines, metric: 'code' as const },
                { label: 'Comments', value: scopedInsightTotals.commentLines, metric: 'comments' as const },
              ].map((stat) => (
                <UnstyledButton
                  className="insights-stat"
                  key={stat.label}
                  onClick={() => {
                    setInsightsMetric(stat.metric)
                    setInsightsCategory('all')
                    setInsightsTab('files')
                  }}
                >
                  <span>{stat.label}</span>
                  <strong>{stat.value.toLocaleString()}</strong>
                </UnstyledButton>
              ))}
              <UnstyledButton
                className="insights-stat"
                onClick={() => {
                  setInsightsMetric('all')
                  setInsightsCategory('asset')
                  setInsightsTab('files')
                }}
              >
                <span>Assets</span>
                <strong>{scopedInsightTotals.assets.toLocaleString()}</strong>
              </UnstyledButton>
              <UnstyledButton className="insights-stat" onClick={() => setInsightsTab('files')}>
                <span>Size</span>
                <strong>{formatBytes(scopedInsightTotals.bytes)}</strong>
              </UnstyledButton>
            </div>

            <div className="insights-tabs" role="tablist" aria-label="Insights report sections">
              {(['overview', 'files', 'technologies', 'projects'] as InsightsTab[]).map((tab) => (
                <button
                  type="button"
                  role="tab"
                  data-active={insightsTab === tab || undefined}
                  aria-selected={insightsTab === tab}
                  key={tab}
                  onClick={() => setInsightsTab(tab)}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="insights-content">
              {insightsTab === 'overview' && (
                <div className="insights-overview-grid">
                  <section className="insights-section">
                    <Group justify="space-between" mb="sm">
                      <Text fw={700}>Languages</Text>
                      <Badge variant="light">{scopedInsightLanguages.length}</Badge>
                    </Group>
                    <div className="insights-ranking">
                      {scopedInsightLanguages.length === 0 ? (
                        <Text size="xs" c="dimmed">No recognized source languages.</Text>
                      ) : scopedInsightLanguages.slice(0, 15).map((language) => (
                        <UnstyledButton
                          className="insights-ranking-row"
                          key={language.name}
                          onClick={() => {
                            setInsightsLanguage(language.name)
                            setInsightsMetric('all')
                            setInsightsTab('files')
                          }}
                        >
                          <span className="insights-language-name">
                            <span
                              className="insights-language-icon"
                              data-on-light={['Markdown', 'Shell'].includes(language.name) || undefined}
                              style={{ color: repositoryLanguageColor(language.name) }}
                              aria-hidden="true"
                            >
                              {repositoryLanguageIcon(language.name)}
                            </span>
                            <span>{language.name}</span>
                          </span>
                          <span>{language.files.toLocaleString()} files</span>
                          <strong>{language.codeLines.toLocaleString()} lines</strong>
                        </UnstyledButton>
                      ))}
                    </div>
                  </section>
                  <section className="insights-section">
                    <Group justify="space-between" mb="sm">
                      <Text fw={700}>Extensions</Text>
                      <Badge variant="light">{insightExtensionStats.length}</Badge>
                    </Group>
                    <div className="insights-extension-table">
                      <div className="insights-extension-row insights-extension-head">
                        <span>Ext</span><span>Files</span><span>Lines</span><span>Code</span>
                        <span>Comments</span><span>Blank</span><span>Size</span>
                      </div>
                      {insightExtensionStats.slice(0, 15).map(([extension, stats]) => (
                        <UnstyledButton
                          className="insights-extension-row"
                          key={extension}
                          onClick={() => {
                            setInsightsExtension(extension)
                            setInsightsMetric('all')
                            setInsightsTab('files')
                          }}
                        >
                          <span className="insights-extension-name">
                            <span
                              className="insights-extension-icon"
                              data-on-light={['.md', '.mdx', '.sh', '.bash', '.prisma'].includes(extension) || undefined}
                              aria-hidden="true"
                            >
                              {repositoryExtensionIcon(extension)}
                            </span>
                            <span>{extension}</span>
                          </span>
                          <span>{stats.files.toLocaleString()}</span>
                          <span>{stats.lines.toLocaleString()}</span>
                          <span>{stats.codeLines.toLocaleString()}</span>
                          <span>{stats.commentLines.toLocaleString()}</span>
                          <span>{stats.blankLines.toLocaleString()}</span>
                          <span>{formatBytes(stats.bytes)}</span>
                        </UnstyledButton>
                      ))}
                    </div>
                  </section>
                  <section className="insights-section">
                    <Group justify="space-between" mb="sm">
                      <Text fw={700}>Technologies</Text>
                      <Badge variant="light">{scopedInsightTechnologies.length}</Badge>
                    </Group>
                    <div className="insights-technology-groups">
                      {technologyCategoryOrder.map((category) => {
                        const technologies = scopedInsightTechnologies.filter((item) => item.category === category)
                        if (technologies.length === 0) return null
                        return (
                          <div className="insights-technology-group" key={category}>
                            <Text size="10px" fw={800} c={`${technologyCategoryMeta[category].color}.4`}>
                              {technologyCategoryMeta[category].label} · {technologies.length}
                            </Text>
                            <div className="insights-chip-list">
                              {technologies.slice(0, 12).map((technology) => (
                                <Badge
                                  variant="outline"
                                  color={technologyCategoryMeta[category].color}
                                  key={`${technology.category}:${technology.name}`}
                                >
                                  {technology.name}{technology.version ? ` ${technology.version}` : ''}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <Button size="compact-xs" variant="subtle" mt="md" onClick={() => setInsightsTab('technologies')}>
                      View evidence
                    </Button>
                  </section>
                  <section className="insights-section">
                    <Group justify="space-between" mb="sm">
                      <Text fw={700}>Projects</Text>
                      <Badge variant="light">{insightsResult.projects.length}</Badge>
                    </Group>
                    <div className="insights-ranking">
                      {insightsResult.projects.slice(0, 15).map((project) => (
                        <UnstyledButton
                          className="insights-ranking-row"
                          key={project.path}
                          onClick={() => {
                            setInsightsProject(project.path)
                            setInsightsLanguage('all')
                            setInsightsExtension('all')
                            setInsightsMetric('all')
                            setInsightsTab('overview')
                          }}
                        >
                          <span>{project.name}</span>
                          <span>{project.path}</span>
                          <strong>{project.files.toLocaleString()} files</strong>
                        </UnstyledButton>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              {insightsTab === 'files' && (
                <>
                  <div className="insights-filters">
                    <TextInput
                      size="xs"
                      placeholder="Filter path"
                      value={insightsSearch}
                      leftSection={<IconSearch size={14} />}
                      onChange={(event) => setInsightsSearch(event.currentTarget.value)}
                    />
                    <Select
                      size="xs" value={insightsCategory} allowDeselect={false}
                      data={['all', 'source', 'text', 'config', 'asset', 'archive', 'binary'].map((value) => ({
                        value, label: value === 'all' ? 'All categories' : value[0].toUpperCase() + value.slice(1),
                      }))}
                      onChange={(value) => setInsightsCategory(value ?? 'all')}
                    />
                    <Select
                      size="xs" value={insightsLanguage} allowDeselect={false} searchable
                      data={[{ value: 'all', label: 'All languages' }, ...insightsResult.languages.map((item) => ({ value: item.name, label: item.name }))]}
                      onChange={(value) => setInsightsLanguage(value ?? 'all')}
                    />
                    <Select
                      size="xs" value={insightsExtension} allowDeselect={false} searchable
                      data={[{ value: 'all', label: 'All extensions' }, ...insightExtensionStats.map(([value, stats]) => ({ value, label: `${value} (${stats.files} files · ${stats.lines.toLocaleString()} lines)` }))]}
                      onChange={(value) => setInsightsExtension(value ?? 'all')}
                    />
                    <Select
                      size="xs" value={insightsProject} allowDeselect={false} searchable
                      data={[{ value: 'all', label: 'All projects' }, ...insightsResult.projects.map((item) => ({ value: item.path, label: item.path }))]}
                      onChange={(value) => setInsightsProject(value ?? 'all')}
                    />
                    <Button
                      size="compact-xs" variant="subtle" color="gray"
                      onClick={() => {
                        setInsightsSearch(''); setInsightsCategory('all'); setInsightsLanguage('all')
                        setInsightsExtension('all'); setInsightsProject('all'); setInsightsMetric('all')
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                  <Text size="xs" c="dimmed" mb="xs">
                    {filteredInsightFiles.length.toLocaleString()} matching files
                    {' · virtualized rendering'}
                  </Text>
                  <VirtualizedInsightFiles files={filteredInsightFiles} />
                </>
              )}

              {insightsTab === 'technologies' && (
                <div className="insights-technologies-view">
                  {scopedInsightTechnologies.length === 0 ? (
                    <Text size="sm" c="dimmed">No supported frameworks or libraries detected yet.</Text>
                  ) : (
                    <>
                      <div className="insights-technology-summary">
                        {technologyCategoryOrder.map((category) => {
                          const count = insightTechnologyCounts[category]
                          return (
                            <UnstyledButton
                              className="insights-technology-summary-card"
                              data-category={category}
                              data-active={insightsTechnologyTab === category || undefined}
                              key={category}
                              onClick={() => setInsightsTechnologyTab(category)}
                            >
                              <span>{technologyCategoryMeta[category].label}</span>
                              <strong>{count.toLocaleString()}</strong>
                            </UnstyledButton>
                          )
                        })}
                      </div>
                      <div className="insights-technology-subtabs" role="tablist" aria-label="Technology categories">
                        {technologyCategoryOrder.map((category) => {
                          const count = insightTechnologyCounts[category]
                          return (
                            <button
                              type="button"
                              role="tab"
                              data-category={category}
                              data-active={insightsTechnologyTab === category || undefined}
                              aria-selected={insightsTechnologyTab === category}
                              key={category}
                              onClick={() => setInsightsTechnologyTab(category)}
                            >
                              {technologyCategoryMeta[category].label}
                              <span>{count}</span>
                            </button>
                          )
                        })}
                      </div>
                      <section
                        className="insights-technology-category insights-technology-category--active"
                        data-category={insightsTechnologyTab}
                      >
                        {activeInsightTechnologies.length === 0 ? (
                          <div className="insights-technology-empty">
                            <Text size="sm" fw={650}>No {technologyCategoryMeta[insightsTechnologyTab].label.toLowerCase()} detected</Text>
                            <Text size="xs" c="dimmed">This scan found no confirmed or likely matches in this category.</Text>
                          </div>
                        ) : (
                          <VirtualizedTechnologies
                            technologies={activeInsightTechnologies}
                            category={insightsTechnologyTab}
                          />
                        )}
                      </section>
                    </>
                  )}
                </div>
              )}

              {insightsTab === 'projects' && (
                <div className="insights-project-list">
                  {insightsResult.projects.map((project) => (
                    <UnstyledButton
                      className="insights-project-row"
                      key={project.path}
                      onClick={() => {
                        setInsightsProject(project.path)
                        setInsightsLanguage('all')
                        setInsightsExtension('all')
                        setInsightsMetric('all')
                        setInsightsTab('overview')
                      }}
                    >
                      <div>
                        <Text size="sm" fw={700}>{project.name}</Text>
                        <Text size="xs" c="dimmed">{project.path}</Text>
                      </div>
                      <div className="insights-chip-list">
                        {project.markers.map((marker) => <Badge size="xs" variant="outline" key={marker}>{marker}</Badge>)}
                      </div>
                      <Text size="xs">{project.files.toLocaleString()} files · {project.lines.toLocaleString()} lines</Text>
                    </UnstyledButton>
                  ))}
                </div>
              )}
            </div>

            {insightsResult.warnings.length > 0 && (
              <Alert color="yellow" icon={<IconAlertCircle size={17} />} mt="md">
                {insightsResult.warnings.length} scan warning{insightsResult.warnings.length === 1 ? '' : 's'}.
                {' '}{insightsResult.warnings[0]}
              </Alert>
            )}
          </>
        )}
      </Modal>

      <Modal
        opened={configurationSetupOpen}
        onClose={() => {
          if (configurationSyncAction === 'setup') return
          setConfigurationSetupOpen(false)
          setConfigurationSyncError(null)
        }}
        title={configurationSetupMode === 'create'
          ? 'Create configuration repository'
          : configurationSetupMode === 'remote'
            ? 'Use GitHub configuration repository'
            : 'Use local configuration repository'}
        size="lg"
        centered
        closeOnClickOutside={configurationSyncAction !== 'setup'}
        closeOnEscape={configurationSyncAction !== 'setup'}
      >
        <Stack gap="md">
          <Alert color="blue" variant="light" icon={<IconBrandGithub size={17} />}>
            {configurationSetupMode === 'create'
              ? 'With your consent, MyRepos will create, initialize, publish, and connect this repository.'
              : configurationSetupMode === 'remote'
                ? 'MyRepos will clone the repository into its managed application data and import .myrepos/config.json when present.'
                : 'Choose any local Git repository. MyRepos only manages .myrepos/config.json inside it.'}
          </Alert>
          {configurationSyncError && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {configurationSyncError}
            </Alert>
          )}
          <Select
            label="GitHub account"
            value={configurationSetupAccountId}
            allowDeselect={false}
            disabled={configurationSyncAction === 'setup'}
            data={accounts.map((account) => ({
              value: String(account.id),
              label: `@${account.login}`,
            }))}
            onChange={(value) => {
              setConfigurationSetupAccountId(value)
              const account = accounts.find((item) => String(item.id) === value)
              if (account) setConfigurationSetupOwner(account.login)
              setConfigurationSyncError(null)
              if (configurationSetupMode === 'remote' && value) {
                void loadConfigurationRemoteRepositories(value)
              }
            }}
          />
          {configurationSetupMode === 'create' ? (
            <>
              <Group grow align="flex-start">
                <TextInput
                  label="Owner"
                  description="Your account or an organization"
                  value={configurationSetupOwner}
                  maxLength={39}
                  disabled={configurationSyncAction === 'setup'}
                  onChange={(event) => setConfigurationSetupOwner(event.currentTarget.value)}
                />
                <TextInput
                  label="Repository name"
                  value={configurationSetupName}
                  maxLength={100}
                  disabled={configurationSyncAction === 'setup'}
                  onChange={(event) => setConfigurationSetupName(event.currentTarget.value)}
                />
              </Group>
              <Select
                label="Visibility"
                value={configurationSetupPrivate ? 'private' : 'public'}
                allowDeselect={false}
                disabled={configurationSyncAction === 'setup'}
                data={[
                  { value: 'private', label: 'Private — recommended for personal configuration' },
                  { value: 'public', label: 'Public — anyone can read the configuration' },
                ]}
                onChange={(value) => setConfigurationSetupPrivate(value !== 'public')}
              />
            </>
          ) : configurationSetupMode === 'remote' ? (
            <Select
              label="Repository"
              description="An existing config file is imported; otherwise MyRepos initializes one."
              placeholder={configurationRemoteLoading ? 'Loading repositories…' : 'Choose repository'}
              searchable
              value={configurationRemoteRepository}
              disabled={configurationRemoteLoading || configurationSyncAction === 'setup'}
              rightSection={configurationRemoteLoading ? <Loader size={14} /> : undefined}
              data={configurationRemoteRepositories.map((repository) => ({
                value: repository.fullName,
                label: `${repository.fullName}${repository.private ? ' · Private' : ' · Public'}`,
              }))}
              onChange={setConfigurationRemoteRepository}
            />
          ) : (
            <Text size="sm" c="dimmed">
              Clicking Continue opens the folder chooser. The selected repository may be local-only
              or already connected to GitHub.
            </Text>
          )}
          <Switch
            checked={configurationSetupAutoSync}
            disabled={configurationSyncAction === 'setup'}
            label="Keep configuration synchronized automatically"
            description={configurationSetupMode === 'local'
              ? 'Portable changes are committed automatically; they are pushed when the repository has an origin.'
              : 'Portable changes are committed and pushed after a short debounce.'}
            onChange={(event) => setConfigurationSetupAutoSync(event.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              disabled={configurationSyncAction === 'setup'}
              onClick={() => {
                setConfigurationSetupOpen(false)
                setConfigurationSyncError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              leftSection={configurationSetupMode === 'local'
                ? <IconFolderSearch size={16} />
                : <IconUpload size={16} />}
              loading={configurationSyncAction === 'setup'}
              disabled={!configurationSetupAccountId ||
                (configurationSetupMode === 'create' &&
                  (!configurationSetupOwner.trim() || !configurationSetupName.trim())) ||
                (configurationSetupMode === 'remote' && !configurationRemoteRepository)}
              onClick={() => void completeConfigurationSetup()}
            >
              {configurationSetupMode === 'create'
                ? 'Create and connect'
                : configurationSetupMode === 'remote' ? 'Clone and connect' : 'Choose folder'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(publishRepository)}
        onClose={() => {
          if (publishSaving) return
          setPublishRepository(null)
          setPublishError(null)
        }}
        title={publishRepository ? `Publish · ${publishRepository.name}` : 'Publish repository'}
        size="lg"
        centered
        closeOnClickOutside={!publishSaving}
        closeOnEscape={!publishSaving}
      >
        <Stack gap="md">
          <Alert color="blue" variant="light" icon={<IconUpload size={17} />}>
            This creates the GitHub repository, adds it as <code>origin</code>, and pushes the
            current branch with upstream tracking. If the folder has no commit yet, MyRepos stages
            all non-ignored files and creates an <strong>Initial commit</strong>. Review its
            <code>.gitignore</code> before publishing.
          </Alert>
          {publishError && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>{publishError}</Alert>
          )}
          <Group grow align="flex-start">
            <Select
              label="GitHub account"
              value={publishAccountId}
              allowDeselect={false}
              disabled={publishSaving}
              data={accounts.map((account) => ({
                value: String(account.id),
                label: `@${account.login}`,
              }))}
              onChange={(value) => {
                setPublishAccountId(value)
                const account = accounts.find((item) => String(item.id) === value)
                if (account) setPublishOwner(account.login)
                setPublishError(null)
              }}
            />
            <TextInput
              label="Owner"
              description="Your account or a GitHub organization"
              value={publishOwner}
              maxLength={39}
              disabled={publishSaving}
              onChange={(event) => {
                setPublishOwner(event.currentTarget.value)
                setPublishError(null)
              }}
            />
          </Group>
          <TextInput
            label="Repository name"
            value={publishName}
            maxLength={100}
            disabled={publishSaving}
            autoFocus
            onChange={(event) => {
              setPublishName(event.currentTarget.value)
              setPublishError(null)
            }}
          />
          <Textarea
            label="Description"
            description={`${publishDescription.length}/350 characters`}
            value={publishDescription}
            maxLength={350}
            minRows={2}
            autosize
            disabled={publishSaving}
            onChange={(event) => setPublishDescription(event.currentTarget.value)}
          />
          <Select
            label="Visibility"
            value={publishPrivate ? 'private' : 'public'}
            allowDeselect={false}
            disabled={publishSaving}
            data={[
              { value: 'private', label: 'Private — only selected people can access it' },
              { value: 'public', label: 'Public — anyone can see it' },
            ]}
            onChange={(value) => setPublishPrivate(value !== 'public')}
          />
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              GitHub permissions decide which organizations this account may publish to.
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Button
                variant="subtle"
                color="gray"
                disabled={publishSaving}
                onClick={() => {
                  setPublishRepository(null)
                  setPublishError(null)
                }}
              >
                Cancel
              </Button>
              <Button
                leftSection={<IconUpload size={16} />}
                loading={publishSaving}
                disabled={!publishAccountId || !publishOwner.trim() || !publishName.trim()}
                onClick={() => void publishLocalRepository()}
              >
                Publish repository
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={bulkGitOpen}
        onClose={() => {
          if (bulkGitRunning) return
          setBulkGitOpen(false)
          setBulkGitResults([])
        }}
        title={`${bulkGitOperationLabel[bulkGitOperation]} repositories`}
        size="lg"
        centered
        closeOnClickOutside={!bulkGitRunning}
        closeOnEscape={!bulkGitRunning}
      >
        <Stack gap="md">
          <Group grow align="flex-start">
            <Select
              label="Target repositories"
              description="Visible means every filtered result, across all pages."
              value={bulkGitTarget}
              allowDeselect={false}
              disabled={bulkGitRunning}
              data={[
                {
                  value: 'visible',
                  label: `Visible local repositories (${visibleLocalRepositories.length})`,
                  disabled: visibleLocalRepositories.length === 0,
                },
                {
                  value: 'selected',
                  label: `Selected local repositories (${selectedLocalRepositories.length})`,
                  disabled: selectedLocalRepositories.length === 0,
                },
              ]}
              onChange={(value) => {
                setBulkGitTarget((value as BulkGitTarget | null) ?? 'visible')
                setBulkGitResults([])
              }}
            />
            <Select
              label="Action"
              description="Actions run sequentially, one repository at a time."
              value={bulkGitOperation}
              allowDeselect={false}
              disabled={bulkGitRunning}
              data={[
                { value: 'sync', label: 'Sync (pull, then push)' },
                { value: 'fetch', label: 'Fetch' },
                { value: 'pull', label: 'Pull' },
                { value: 'push', label: 'Push' },
              ]}
              onChange={(value) => {
                setBulkGitOperation((value as BulkGitOperation | null) ?? 'sync')
                setBulkGitResults([])
              }}
            />
          </Group>

          <Alert color="blue" variant="light" icon={<IconRefresh size={17} />}>
            Repositories with conflicts, unsupported remotes, or blocking local changes may fail.
            The queue will continue and report each result.
          </Alert>

          {bulkGitResults.length > 0 && (
            <Paper className="bulk-git-results" radius="md">
              <Group justify="space-between" mb="sm">
                <Text size="sm" fw={700}>Progress</Text>
                <Text size="xs" c="dimmed">
                  {bulkGitResults.filter((result) =>
                    result.status === 'success' || result.status === 'error').length}
                  /{bulkGitResults.length} completed
                </Text>
              </Group>
              <Stack gap={0}>
                {bulkGitResults.map((result) => (
                  <div className="bulk-git-result" key={result.repositoryKey}>
                    <div className="bulk-git-result-name">
                      <Text size="sm" fw={600} truncate>{result.fullName}</Text>
                      {result.message && result.status === 'error' && (
                        <Text size="xs" c="red.4" lineClamp={2}>{result.message}</Text>
                      )}
                    </div>
                    {result.status === 'running' ? (
                      <Group gap={7} wrap="nowrap">
                        <Loader size={13} />
                        <Text size="xs" c="dimmed">Running</Text>
                      </Group>
                    ) : (
                      <Badge
                        size="xs"
                        variant="light"
                        color={result.status === 'success'
                          ? 'teal'
                          : result.status === 'error'
                            ? 'red'
                            : 'gray'}
                      >
                        {result.status}
                      </Badge>
                    )}
                  </div>
                ))}
              </Stack>
            </Paper>
          )}

          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {bulkGitRepositories.length} local {bulkGitRepositories.length === 1
                ? 'repository'
                : 'repositories'} will be processed
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Button
                variant="subtle"
                color="gray"
                disabled={bulkGitRunning}
                onClick={() => {
                  setBulkGitOpen(false)
                  setBulkGitResults([])
                }}
              >
                Close
              </Button>
              <Button
                leftSection={<IconRefresh size={16} />}
                loading={bulkGitRunning}
                disabled={bulkGitRepositories.length === 0}
                onClick={() => void runBulkGitOperation()}
              >
                {bulkGitOperationLabel[bulkGitOperation]} repositories
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={bulkOrganizationOpen}
        onClose={() => {
          if (bulkOrganizationSaving) return
          setBulkOrganizationOpen(false)
          setBulkOrganizationError(null)
        }}
        title={`Organize ${selectedRepositories.length} selected ${selectedRepositories.length === 1 ? 'repository' : 'repositories'}`}
        size="lg"
        centered
        closeOnClickOutside={!bulkOrganizationSaving}
        closeOnEscape={!bulkOrganizationSaving}
      >
        <Stack gap="md">
          <Alert color="blue" variant="light" icon={<IconTags size={17} />}>
            A dash means only some selected repositories have that item. Check it to add it to all,
            or clear a checked item to remove it from all. Unchanged items are preserved.
          </Alert>
          {bulkOrganizationError && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {bulkOrganizationError}
            </Alert>
          )}

          {organizationKinds.map((kind) => {
            const copy = organizationCopy[kind]
            const items = organizationCatalog[copy.catalogField]
            const field = organizationFieldForKind[kind]
            return (
              <Paper className="organization-section" radius="md" key={kind}>
                <Group gap="sm" mb="sm" wrap="nowrap">
                  <ThemeIcon variant="light" color="teal" size={32}>
                    {kind === 'workspace'
                      ? <IconBriefcase size={17} />
                      : kind === 'group'
                        ? <IconFolders size={17} />
                        : <IconTags size={17} />}
                  </ThemeIcon>
                  <div>
                    <Text size="sm" fw={700}>{copy.plural}</Text>
                    <Text size="xs" c="dimmed">Apply {copy.plural.toLowerCase()} to the selection.</Text>
                  </div>
                </Group>

                {items.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    No {copy.plural.toLowerCase()} yet. Create one from the {copy.plural} section.
                  </Text>
                ) : (
                  <div className="organization-options organization-options--bulk">
                    {items.map((item) => {
                      const assignedCount = selectedRepositories.filter((repository) => {
                        const assignment = organizationAssignments[repositoryOrganizationKey(repository)] ??
                          emptyRepositoryOrganization()
                        return assignment[field].includes(item.id)
                      }).length
                      const changeKey = bulkOrganizationChangeKey(kind, item.id)
                      const explicitChange = bulkOrganizationChanges[changeKey]
                      const allAssigned = assignedCount === selectedRepositories.length
                      const someAssigned = assignedCount > 0 && !allAssigned
                      const checked = explicitChange ?? allAssigned
                      return (
                        <Checkbox
                          key={item.id}
                          checked={checked}
                          indeterminate={explicitChange === undefined && someAssigned}
                          disabled={bulkOrganizationSaving}
                          onChange={(event) => {
                            const nextChecked = event.currentTarget.checked
                            setBulkOrganizationChanges((current) => ({
                              ...current,
                              [changeKey]: nextChecked,
                            }))
                          }}
                          label={(
                            <Group gap={8} wrap="nowrap">
                              <span className="organization-color" style={{ backgroundColor: item.color }} />
                              <Text component="span" size="sm">{item.name}</Text>
                              <Text component="span" size="10px" c="dimmed">
                                {explicitChange === true
                                  ? 'add to all'
                                  : explicitChange === false
                                    ? 'remove from all'
                                    : `${assignedCount}/${selectedRepositories.length}`}
                              </Text>
                            </Group>
                          )}
                        />
                      )
                    })}
                  </div>
                )}
              </Paper>
            )
          })}

          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {Object.keys(bulkOrganizationChanges).length === 0
                ? 'Choose at least one change.'
                : `${Object.keys(bulkOrganizationChanges).length} organization changes ready`}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Button
                variant="subtle"
                color="gray"
                disabled={bulkOrganizationSaving}
                onClick={() => {
                  setBulkOrganizationOpen(false)
                  setBulkOrganizationError(null)
                }}
              >
                Cancel
              </Button>
              <Button
                loading={bulkOrganizationSaving}
                disabled={Object.keys(bulkOrganizationChanges).length === 0}
                onClick={() => void saveBulkOrganization()}
              >
                Apply to {selectedRepositories.length}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(organizationEditorKind)}
        onClose={() => {
          if (organizationEditorSaving) return
          setOrganizationEditorKind(null)
          setOrganizationEditorItem(null)
          setOrganizationEditorError(null)
        }}
        title={organizationEditorKind
          ? `${organizationEditorItem ? 'Edit' : 'New'} ${organizationCopy[organizationEditorKind].singular.toLowerCase()}`
          : 'Organization item'}
        centered
        closeOnClickOutside={!organizationEditorSaving}
        closeOnEscape={!organizationEditorSaving}
      >
        <Stack gap="md">
          {organizationEditorError && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {organizationEditorError}
            </Alert>
          )}
          <TextInput
            label="Name"
            placeholder={organizationEditorKind
              ? `${organizationCopy[organizationEditorKind].singular} name`
              : 'Name'}
            value={organizationEditorName}
            maxLength={80}
            disabled={organizationEditorSaving}
            autoFocus
            onChange={(event) => setOrganizationEditorName(event.currentTarget.value)}
          />
          <ColorInput
            label="Color"
            description="Used for repository badges and quick visual recognition."
            format="hex"
            value={organizationEditorColor}
            disabled={organizationEditorSaving}
            swatches={['#20c997', '#4dabf7', '#cc5de8', '#fcc419', '#ff6b6b', '#845ef7', '#22b8cf', '#94d82d']}
            onChange={setOrganizationEditorColor}
          />
          <Textarea
            label="Description"
            description={`${organizationEditorDescription.length}/500 characters`}
            placeholder="What belongs here?"
            value={organizationEditorDescription}
            maxLength={500}
            minRows={3}
            autosize
            disabled={organizationEditorSaving}
            onChange={(event) => setOrganizationEditorDescription(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              disabled={organizationEditorSaving}
              onClick={() => {
                setOrganizationEditorKind(null)
                setOrganizationEditorItem(null)
                setOrganizationEditorError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              loading={organizationEditorSaving}
              disabled={!organizationEditorName.trim() || !/^#[0-9a-f]{6}$/i.test(organizationEditorColor)}
              onClick={() => void saveOrganizationItem()}
            >
              {organizationEditorItem ? 'Save changes' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(organizationDeleteItem)}
        onClose={() => {
          if (organizationEditorSaving) return
          setOrganizationDeleteItem(null)
          setOrganizationEditorError(null)
        }}
        title={organizationDeleteItem
          ? `Delete ${organizationCopy[organizationDeleteItem.kind].singular.toLowerCase()}?`
          : 'Delete item?'}
        centered
        size="sm"
        closeOnClickOutside={!organizationEditorSaving}
        closeOnEscape={!organizationEditorSaving}
      >
        <Stack gap="md">
          {organizationEditorError && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {organizationEditorError}
            </Alert>
          )}
          <Text size="sm">
            Delete <strong>{organizationDeleteItem?.name}</strong>? It will be removed from{' '}
            {organizationDeleteItem?.repositoryCount ?? 0}{' '}
            {(organizationDeleteItem?.repositoryCount ?? 0) === 1 ? 'repository' : 'repositories'}.
            The repositories themselves will not be deleted.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              disabled={organizationEditorSaving}
              onClick={() => {
                setOrganizationDeleteItem(null)
                setOrganizationEditorError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={organizationEditorSaving}
              onClick={() => void removeOrganizationItem()}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(organizeRepository)}
        onClose={() => {
          if (!organizationSaving) setOrganizeRepository(null)
        }}
        title={organizeRepository ? `Organize · ${organizeRepository.fullName}` : 'Organize repository'}
        size="lg"
        centered
        closeOnClickOutside={!organizationSaving}
        closeOnEscape={!organizationSaving}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Assign this repository to any number of workspaces, groups, and tags.
          </Text>
          {organizationError && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>{organizationError}</Alert>
          )}

          <ColorInput
            label="Repository color"
            description="Optional identity color shown as a card accent in every repository view."
            placeholder="No custom color"
            format="hex"
            value={repositoryColorDraft}
            clearable
            disabled={organizationSaving}
            swatches={['#20c997', '#4dabf7', '#845ef7', '#cc5de8', '#f06595', '#ff922b', '#ffd43b', '#ff6b6b']}
            onChange={setRepositoryColorDraft}
          />

          {([
            {
              kind: 'workspace' as const,
              label: 'Workspaces',
              description: 'Repositories that you work on together.',
              icon: <IconBriefcase size={17} />,
              items: organizationCatalog.workspaces,
            },
            {
              kind: 'group' as const,
              label: 'Groups',
              description: 'Manual collections for browsing and organization.',
              icon: <IconFolders size={17} />,
              items: organizationCatalog.groups,
            },
            {
              kind: 'tag' as const,
              label: 'Tags',
              description: 'Descriptive labels that can be combined freely.',
              icon: <IconTags size={17} />,
              items: organizationCatalog.tags,
            },
          ] satisfies Array<{
            kind: OrganizationKind
            label: string
            description: string
            icon: ReactNode
            items: OrganizationItem[]
          }>).map((section) => {
            const field = organizationFieldForKind[section.kind]
            return (
              <Paper className="organization-section" radius="md" key={section.kind}>
                <Group gap="sm" mb="sm" wrap="nowrap">
                  <ThemeIcon variant="light" color="teal" size={32}>{section.icon}</ThemeIcon>
                  <div>
                    <Text size="sm" fw={700}>{section.label}</Text>
                    <Text size="xs" c="dimmed">{section.description}</Text>
                  </div>
                </Group>

                {section.items.length > 0 ? (
                  <div className="organization-options">
                    {section.items.map((item) => (
                      <Checkbox
                        key={item.id}
                        checked={organizationDraft[field].includes(item.id)}
                        disabled={organizationSaving}
                        onChange={() => toggleOrganizationAssignment(section.kind, item.id)}
                        label={(
                          <Group gap={8} wrap="nowrap">
                            <span className="organization-color" style={{ backgroundColor: item.color }} />
                            <Text component="span" size="sm">{item.name}</Text>
                            <Text component="span" size="10px" c="dimmed">
                              {item.repositoryCount} repos
                            </Text>
                          </Group>
                        )}
                      />
                    ))}
                  </div>
                ) : (
                  <Text size="xs" c="dimmed" mb="sm">No {section.label.toLowerCase()} yet.</Text>
                )}

                <Group gap="xs" mt="sm" wrap="nowrap">
                  <TextInput
                    size="xs"
                    style={{ flex: 1 }}
                    aria-label={`New ${section.kind} name`}
                    placeholder={`Create a ${section.kind}`}
                    value={newOrganizationNames[section.kind]}
                    disabled={organizationLoading || organizationSaving}
                    onChange={(event) => setNewOrganizationNames((current) => ({
                      ...current,
                      [section.kind]: event.currentTarget.value,
                    }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void createOrganizationItem(section.kind)
                      }
                    }}
                  />
                  <Button
                    size="xs"
                    variant="light"
                    loading={organizationLoading}
                    disabled={!newOrganizationNames[section.kind].trim() || organizationSaving}
                    onClick={() => void createOrganizationItem(section.kind)}
                  >
                    Create
                  </Button>
                </Group>
              </Paper>
            )
          })}

          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              disabled={organizationSaving}
              onClick={() => setOrganizeRepository(null)}
            >
              Cancel
            </Button>
            <Button
              loading={organizationSaving}
              disabled={organizationLoading || Boolean(repositoryColorDraft) &&
                !/^#[0-9a-f]{6}$/i.test(repositoryColorDraft)}
              onClick={() => void saveRepositoryOrganization()}
            >
              Save repository details
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(cardCommitRepository)}
        onClose={() => {
          if (cardGitAction) return
          setCardCommitRepository(null)
          setCardCommitError(null)
          setCardCommitSync(false)
        }}
        title={cardCommitRepository
          ? `${cardCommitSync ? 'Commit and sync' : cardCommitAll ? 'Commit all changes' : 'Commit staged changes'} · ${cardCommitRepository.fullName}`
          : 'Commit changes'}
        centered
        closeOnClickOutside={!cardGitAction}
        closeOnEscape={!cardGitAction}
      >
        <Stack gap="md">
          {cardCommitAll && (
            <Text size="sm" c="dimmed">
              All modified and untracked files will be staged before committing.
            </Text>
          )}
          {cardCommitSync && (
            <Text size="sm" c="dimmed">
              After committing, MyRepos will pull remote changes and push your commits.
            </Text>
          )}
          {cardCommitError && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {cardCommitError}
            </Alert>
          )}
          <Textarea
            label="Commit message"
            placeholder="Describe your changes"
            value={cardCommitMessage}
            autosize
            minRows={3}
            autoFocus
            disabled={Boolean(cardGitAction)}
            onChange={(event) => {
              setCardCommitMessage(event.currentTarget.value)
              setCardCommitError(null)
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                void commitFromCard()
              }
            }}
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              disabled={Boolean(cardGitAction)}
              onClick={() => {
                setCardCommitRepository(null)
                setCardCommitSync(false)
              }}
            >
              Cancel
            </Button>
            <Button
              loading={Boolean(cardGitAction)}
              disabled={!cardCommitMessage.trim()}
              onClick={() => void commitFromCard()}
            >
              {cardCommitSync
                ? cardCommitAll ? 'Stage, commit and sync' : 'Commit and sync'
                : cardCommitAll ? 'Stage and commit' : 'Commit'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={false}
        onClose={() => {
          if (gitAction) return
          setGitRepository(null)
          setGitDetails(null)
          setGitError(null)
        }}
        title={gitRepository ? `Git · ${gitRepository.fullName}` : 'Git'}
        size="xl"
        centered
        closeOnClickOutside={!gitAction}
        closeOnEscape={!gitAction}
        overlayProps={{ backgroundOpacity: 0.7, blur: 5 }}
      >
        {gitRepository?.localPath && (
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Group gap="xs">
                <Badge
                  variant="light"
                  color={gitDetails?.status.conflicts
                    ? 'red'
                    : gitDetails?.status.clean ? 'teal' : 'orange'}
                  leftSection={<IconGitBranch size={12} />}
                >
                  {gitDetails?.status.branch ?? 'Repository'}
                </Badge>
                {gitDetails && gitDetails.status.ahead > 0 && (
                  <Badge variant="outline" color="teal">↑ {gitDetails.status.ahead} ahead</Badge>
                )}
                {gitDetails && gitDetails.status.behind > 0 && (
                  <Badge variant="outline" color="yellow">↓ {gitDetails.status.behind} behind</Badge>
                )}
              </Group>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="light"
                  loading={gitAction === 'fetch'}
                  disabled={Boolean(gitAction)}
                  onClick={() => void runGitAction('fetch', () =>
                    window.desktop!.repositories.gitFetch(gitRepository.localPath!),
                  )}
                >
                  Fetch
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  loading={gitAction === 'pull'}
                  disabled={Boolean(gitAction)}
                  onClick={() => void runGitAction('pull', () =>
                    window.desktop!.repositories.gitPull(gitRepository.localPath!),
                  )}
                >
                  Pull
                </Button>
                <Button
                  size="xs"
                  loading={gitAction === 'push'}
                  disabled={Boolean(gitAction)}
                  onClick={() => void runGitAction('push', () =>
                    window.desktop!.repositories.gitPush(gitRepository.localPath!),
                  )}
                >
                  Push
                </Button>
              </Group>
            </Group>

            {gitError && (
              <Alert color="red" icon={<IconAlertCircle size={17} />}>
                {gitError}
              </Alert>
            )}

            {gitPanelLoading ? (
              <Paper className="git-loading" radius="md">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">Reading repository status…</Text>
              </Paper>
            ) : gitDetails ? (
              <>
                <Group justify="space-between" wrap="wrap">
                  <div>
                    <Text fw={680}>Changed files</Text>
                    <Text size="xs" c="dimmed">
                      {gitDetails.files.length === 0
                        ? 'The working tree is clean.'
                        : `${gitDetails.files.length} changed ${gitDetails.files.length === 1 ? 'file' : 'files'}`}
                    </Text>
                  </div>
                  {gitDetails.files.length > 0 && (
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="light"
                        disabled={Boolean(gitAction)}
                        loading={gitAction === 'stage-all'}
                        onClick={() => void runGitAction('stage-all', () =>
                          window.desktop!.repositories.gitStage(gitRepository.localPath!, []),
                        )}
                      >
                        Stage all
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="gray"
                        disabled={Boolean(gitAction) || !gitDetails.files.some((file) => file.staged)}
                        loading={gitAction === 'unstage-all'}
                        onClick={() => void runGitAction('unstage-all', () =>
                          window.desktop!.repositories.gitUnstage(gitRepository.localPath!, []),
                        )}
                      >
                        Unstage all
                      </Button>
                    </Group>
                  )}
                </Group>

                {gitDetails.files.length > 0 && (
                  <Stack gap={7} className="git-file-list">
                    {gitDetails.files.map((file) => (
                      <Paper className="git-file-row" radius="md" key={file.path}>
                        <div className="git-file-name">
                          <Text size="sm" fw={600} truncate>{file.path}</Text>
                          <Group gap={5} mt={4}>
                            {file.conflicted && <Badge size="xs" color="red">Conflict</Badge>}
                            {file.staged && <Badge size="xs" color="teal">Staged</Badge>}
                            {file.unstaged && <Badge size="xs" color="orange">Modified</Badge>}
                            {file.untracked && <Badge size="xs" variant="light" color="orange">Untracked</Badge>}
                          </Group>
                        </div>
                        <Group gap={5} wrap="nowrap">
                          {(file.unstaged || file.untracked) && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              color="gray"
                              loading={gitAction === `diff:working:${file.path}`}
                              disabled={Boolean(gitAction)}
                              onClick={() => void showFileDiff(file, false)}
                            >
                              Diff
                            </Button>
                          )}
                          {file.staged && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              color="gray"
                              loading={gitAction === `diff:staged:${file.path}`}
                              disabled={Boolean(gitAction)}
                              onClick={() => void showFileDiff(file, true)}
                            >
                              Staged diff
                            </Button>
                          )}
                          {(file.unstaged || file.untracked) && (
                            <Button
                              size="compact-xs"
                              variant="light"
                              disabled={Boolean(gitAction)}
                              loading={gitAction === `stage:${file.path}`}
                              onClick={() => void runGitAction(`stage:${file.path}`, () =>
                                window.desktop!.repositories.gitStage(gitRepository.localPath!, [file.path]),
                              )}
                            >
                              Stage
                            </Button>
                          )}
                          {file.staged && (
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="gray"
                              disabled={Boolean(gitAction)}
                              loading={gitAction === `unstage:${file.path}`}
                              onClick={() => void runGitAction(`unstage:${file.path}`, () =>
                                window.desktop!.repositories.gitUnstage(gitRepository.localPath!, [file.path]),
                              )}
                            >
                              Unstage
                            </Button>
                          )}
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                )}

                {diffText !== null && (
                  <Paper className="git-diff-panel" radius="md">
                    <Group justify="space-between" mb="sm">
                      <Text size="sm" fw={650}>{diffTitle}</Text>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="gray"
                        onClick={() => {
                          setDiffTitle(null)
                          setDiffText(null)
                        }}
                      >
                        Close diff
                      </Button>
                    </Group>
                    <pre>{diffText}</pre>
                  </Paper>
                )}

                <Divider />

                <div>
                  <Textarea
                    label="Commit message"
                    placeholder="Describe this change"
                    minRows={2}
                    maxRows={5}
                    autosize
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.currentTarget.value)}
                  />
                  <Group justify="flex-end" mt="sm">
                    <Button
                      leftSection={<IconGitCommit size={16} />}
                      loading={gitAction === 'commit'}
                      disabled={
                        Boolean(gitAction) ||
                        !commitMessage.trim() ||
                        !gitDetails.files.some((file) => file.staged)
                      }
                      onClick={() => void (async () => {
                        const committed = await runGitAction('commit', () =>
                          window.desktop!.repositories.gitCommit(
                            gitRepository.localPath!,
                            commitMessage,
                          ),
                        )
                        if (committed) setCommitMessage('')
                      })()}
                    >
                      Commit staged changes
                    </Button>
                  </Group>
                </div>
              </>
            ) : null}
          </Stack>
        )}
      </Modal>

      <Modal
        opened={connectOpen}
        onClose={closeConnect}
        title="Add GitHub account"
        centered
        size="md"
        closeOnClickOutside={authorizationState === 'idle'}
        closeOnEscape={authorizationState === 'idle'}
        overlayProps={{ backgroundOpacity: 0.65, blur: 5 }}
      >
        <Stack gap="lg">
          <Text size="sm" c="dimmed">
            MyRepos uses GitHub’s secure device authorization flow. Your password is entered only on GitHub.
          </Text>

          <Paper className="provider-option" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="md" wrap="nowrap">
                <ThemeIcon color="dark" variant="filled" size={42} radius="md">
                  <IconBrandGithub size={23} />
                </ThemeIcon>
                <div>
                  <Text size="sm" fw={650}>GitHub.com</Text>
                  <Text size="xs" c="dimmed">Personal and organization accounts</Text>
                </div>
              </Group>
              <ThemeIcon variant="light" color="teal" size={25} radius="xl">
                <IconCheck size={15} />
              </ThemeIcon>
            </Group>
          </Paper>

          {authorizationError && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {authorizationError}
            </Alert>
          )}

          {authorizationState === 'waiting' && authorization ? (
            <div className="device-code-panel">
              <Text size="xs" c="dimmed" ta="center">Enter this code on GitHub</Text>
              <Text className="device-code" ta="center">{authorization.userCode}</Text>
              <Group justify="center" gap="xs">
                <CopyButton value={authorization.userCode} timeout={1800}>
                  {({ copied, copy }) => (
                    <Button
                      variant="light"
                      size="xs"
                      color={copied ? 'teal' : 'gray'}
                      leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      onClick={copy}
                    >
                      {copied ? 'Copied' : 'Copy code'}
                    </Button>
                  )}
                </CopyButton>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  rightSection={<IconExternalLink size={14} />}
                  onClick={() => void window.desktop?.github.launch(authorization.requestId)}
                >
                  Open GitHub again
                </Button>
              </Group>
              <Group justify="center" gap="xs" mt="md">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">Waiting for authorization…</Text>
              </Group>
            </div>
          ) : (
            <>
              <div className="permission-note">
                <IconLock size={17} />
                <Text size="xs" c="dimmed" lh={1.55}>
                  GitHub will show the requested profile, email, and repository permissions before you approve access.
                </Text>
              </div>

              <Button
                fullWidth
                rightSection={
                  authorizationState === 'starting'
                    ? <Loader size={15} color="currentColor" />
                    : <IconExternalLink size={16} />
                }
                loading={authorizationState === 'starting'}
                onClick={() => void beginAuthorization()}
              >
                Continue in browser
              </Button>
            </>
          )}

          <Text size="10px" c="dimmed" ta="center">
            The authorization code expires automatically and can be cancelled at any time.
          </Text>
        </Stack>
      </Modal>
    </div>
  )
}
