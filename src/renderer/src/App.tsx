import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  CopyButton,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  Pagination,
  Paper,
  Select,
  Stack,
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
  IconBrandGithub,
  IconBrandVscode,
  IconBook2,
  IconCheck,
  IconCommand,
  IconCopy,
  IconDownload,
  IconDeviceFloppy,
  IconExternalLink,
  IconFolderOpen,
  IconFolderSearch,
  IconGitBranch,
  IconGitCommit,
  IconLayoutGrid,
  IconLayoutList,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconStar,
  IconTrash,
  IconUsers,
  IconX,
} from '@tabler/icons-react'
import type {
  AppSettings,
  GitHubAccount,
  GitHubDeviceAuthorization,
  GitHubRepository,
  RepositoryChangedFile,
  RepositoryCommit,
  RepositoryCommitFile,
  RepositoryGitDetails,
  RepositoryGitStatus,
} from '../../shared/desktop-api'
import myReposIcon from './assets/myrepos-icon.png'

type AuthorizationState = 'idle' | 'starting' | 'waiting'
type ActiveView = 'accounts' | 'repositories' | 'settings'
type RepositoryTab = 'local' | 'github'
type RepositoryLayout = 'list' | 'grid'
type FilesPanelTab = 'changes' | 'history'

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
  const [repositoryLayout, setRepositoryLayout] = useState<RepositoryLayout>('list')
  const [repositoryPage, setRepositoryPage] = useState(1)
  const [cloningRepository, setCloningRepository] = useState<string | null>(null)
  const [cloneResult, setCloneResult] = useState<{ fullName: string; path: string } | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const repositoryResultsScrollRef = useRef<HTMLDivElement>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [authorizationState, setAuthorizationState] = useState<AuthorizationState>('idle')
  const [authorization, setAuthorization] = useState<GitHubDeviceAuthorization | null>(null)
  const [authorizationError, setAuthorizationError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>({ vscodeApplicationName: '' })
  const [savedSettings, setSavedSettings] = useState<AppSettings>({ vscodeApplicationName: '' })
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
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
  const platform =
    window.desktop?.platform ??
    (navigator.userAgent.includes('Macintosh') ? 'darwin' : 'unknown')

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (sidebarWidth > 72 && sidebarWidth < 190) setSidebarWidth(72)
  }, [sidebarWidth])

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
    return window.desktop.repositories.onStatusChanged((status) => {
      setGitStatuses((current) => ({ ...current, [status.path]: status }))
    })
  }, [])

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
  const visibleRepositories = searchedRepositories.filter((repository) =>
    repositoryTab === 'local' ? Boolean(repository.localPath) : !repository.localPath,
  )
  const repositoryPageCount = Math.max(
    1,
    Math.ceil(visibleRepositories.length / repositoriesPerPage),
  )
  const pagedRepositories = visibleRepositories.slice(
    (repositoryPage - 1) * repositoriesPerPage,
    repositoryPage * repositoriesPerPage,
  )
  const monitoredPaths = activeView === 'repositories' && repositoryTab === 'local'
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
        setRepositoryTab('local')
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
      setRepositoryTab('local')
      setRepositoryPage(1)
    } catch (error) {
      setRepositoriesError(errorMessage(error))
    }
  }

  const addLocalRepository = async (): Promise<void> => {
    if (!window.desktop || !selectedAccountId) return
    setRepositoriesError(null)

    try {
      const repository = await window.desktop.repositories.addLocal(
        selectedAccountId === 'all' ? null : Number(selectedAccountId),
      )
      if (!repository) return
      setRepositories((current) => mergeRepositoryDetails([repository], current))
      setCloneResult({ fullName: repository.fullName, path: repository.localPath! })
      setRepositoryTab('local')
      setRepositoryPage(1)
      void refreshRepositories()
    } catch (error) {
      setRepositoriesError(errorMessage(error))
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

  const historyFilesShown = filesPanelTab === 'history' && commitFilesVisible
  const scmHasContent = scmNavigatorVisible || historyFilesShown || diffVisible
  const scmGridColumns = [
    scmNavigatorVisible ? `${scmNavigatorWidth}px` : null,
    scmNavigatorVisible && (historyFilesShown || diffVisible) ? '6px' : null,
    historyFilesShown ? `${commitFilesWidth}px` : null,
    historyFilesShown && diffVisible ? '6px' : null,
    diffVisible ? 'minmax(0, 1fr)' : null,
  ].filter(Boolean).join(' ') || 'minmax(0, 1fr)'

  return (
    <div className="app-frame" data-platform={platform}>
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
                setRepositoryTab((value as RepositoryTab | null) ?? 'github')
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
              </Tabs.List>
            </Tabs>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconFolderSearch size={15} />}
              onClick={() => void addLocalRepository()}
            >
              Add local repository
            </Button>
            </>
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
          ) : (
            <Button
              size="sm"
              leftSection={<IconDeviceFloppy size={16} />}
              loading={settingsSaving}
              disabled={settingsLoading || settings.vscodeApplicationName === savedSettings.vscodeApplicationName}
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
                  <Badge variant="outline" color="gray" size="lg">
                    {visibleRepositories.length}{' '}
                    {repositoryTab === 'local' ? 'local' : 'on GitHub'}
                  </Badge>
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
                </section>
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
                    {repositorySearch
                      ? 'No matching repositories'
                      : repositoryTab === 'local'
                        ? 'No local repositories yet'
                        : 'No GitHub-only repositories'}
                  </Text>
                  <Text size="sm" c="dimmed" ta="center">
                    {repositorySearch
                      ? 'Try a different search.'
                      : repositoryTab === 'local'
                        ? 'Add an existing repository or get one from GitHub.'
                        : 'Every available GitHub repository is already local.'}
                  </Text>
                  {!repositorySearch && repositoryTab === 'local' && (
                    <Button
                      mt="xs"
                      variant="light"
                      leftSection={<IconFolderSearch size={16} />}
                      onClick={() => void addLocalRepository()}
                    >
                      Add local repository
                    </Button>
                  )}
                </Paper>
              ) : (
                <div className={`repository-collection repository-collection--${repositoryLayout}`}>
                  {pagedRepositories.map((repository) => {
                    const gitStatus = repository.localPath
                      ? gitStatuses[repository.localPath]
                      : undefined
                    const changeCount = gitStatus
                      ? gitStatus.staged + gitStatus.unstaged + gitStatus.untracked + gitStatus.conflicts
                      : 0

                    return <Paper
                      className={`repository-card repository-card--${repositoryLayout}`}
                      data-files-open={gitRepository?.localPath === repository.localPath || undefined}
                      radius="lg"
                      key={`${repository.accountId}:${repository.fullName}`}
                    >
                      <div className="repository-details">
                        <Group gap={8} wrap="wrap">
                          <Text fw={680}>{repository.fullName}</Text>
                          {repository.metadataLoaded && (
                            <>
                              <Badge
                                size="xs"
                                variant="light"
                                color={repository.private ? 'yellow' : 'gray'}
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
                              variant="light"
                              color={gitStatus.conflicts > 0
                                ? 'red'
                                : gitStatus.clean && gitStatus.upstream &&
                                    gitStatus.ahead === 0 && gitStatus.behind === 0
                                  ? 'teal'
                                  : gitStatus.clean
                                    ? 'blue'
                                    : 'yellow'}
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
                                      ? 'Published'
                                      : `${changeCount} changes`}
                            </Badge>
                          )}
                          {selectedAccountId === 'all' && (
                            <Badge size="xs" variant="outline" color="gray">
                              @{repository.accountLogin}
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
                            {gitStatus && (
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
                              color={gitDetails?.status.clean ? 'teal' : 'yellow'}
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
                                      <Text size="xs" fw={650} lineClamp={2}>{commit.subject}</Text>
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
                                  <Badge size="xs" variant="light" color={gitDetails.status.clean ? 'teal' : 'yellow'}>
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
                                        {file.unstaged && <Badge size="xs" color="yellow">Modified</Badge>}
                                        {file.untracked && <Badge size="xs" color="gray">Untracked</Badge>}
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
                    setSettings({ vscodeApplicationName: event.currentTarget.value })
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
                  color={gitDetails?.status.clean ? 'teal' : 'yellow'}
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
                            {file.unstaged && <Badge size="xs" color="yellow">Modified</Badge>}
                            {file.untracked && <Badge size="xs" color="gray">Untracked</Badge>}
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
