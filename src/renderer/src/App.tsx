import { useEffect, useRef, useState } from 'react'
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
  IconCopy,
  IconDownload,
  IconDeviceFloppy,
  IconExternalLink,
  IconFolderOpen,
  IconFolderSearch,
  IconGitBranch,
  IconGitCommit,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconStar,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react'
import type {
  AppSettings,
  GitHubAccount,
  GitHubDeviceAuthorization,
  GitHubRepository,
  RepositoryChangedFile,
  RepositoryGitDetails,
  RepositoryGitStatus,
} from '../../shared/desktop-api'
import myReposIcon from './assets/myrepos-icon.png'

type AuthorizationState = 'idle' | 'starting' | 'waiting'
type ActiveView = 'accounts' | 'repositories' | 'settings'
type RepositoryTab = 'cloned' | 'new'
const repositoriesPerPage = 15

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return message
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error: /, '')
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
  const [repositoryTab, setRepositoryTab] = useState<RepositoryTab>('cloned')
  const [repositoryPage, setRepositoryPage] = useState(1)
  const [cloningRepository, setCloningRepository] = useState<string | null>(null)
  const [cloneResult, setCloneResult] = useState<{ fullName: string; path: string } | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)
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
  const [gitPanelLoading, setGitPanelLoading] = useState(false)
  const [gitAction, setGitAction] = useState<string | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [diffTitle, setDiffTitle] = useState<string | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const platform =
    window.desktop?.platform ??
    (navigator.userAgent.includes('Macintosh') ? 'darwin' : 'unknown')

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
  const clonedRepositoryCount = repositories.filter((repository) => repository.localPath).length
  const newRepositoryCount = repositories.length - clonedRepositoryCount
  const visibleRepositories = searchedRepositories.filter((repository) =>
    repositoryTab === 'cloned' ? Boolean(repository.localPath) : !repository.localPath,
  )
  const repositoryPageCount = Math.max(
    1,
    Math.ceil(visibleRepositories.length / repositoriesPerPage),
  )
  const pagedRepositories = visibleRepositories.slice(
    (repositoryPage - 1) * repositoriesPerPage,
    repositoryPage * repositoriesPerPage,
  )
  const monitoredPaths = activeView === 'repositories' && repositoryTab === 'cloned'
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
    contentScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
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
        setRepositoryTab('cloned')
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
      setRepositoryTab('cloned')
      setRepositoryPage(1)
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
    setGitRepository(repository)
    setGitDetails(null)
    setGitError(null)
    setCommitMessage('')
    setDiffTitle(null)
    setDiffText(null)
    setGitPanelLoading(true)

    try {
      applyGitDetails(await window.desktop.repositories.gitDetails(repository.localPath))
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

  const showFileDiff = async (file: RepositoryChangedFile, staged: boolean): Promise<void> => {
    if (!window.desktop || !gitRepository?.localPath) return
    const action = `diff:${staged ? 'staged' : 'working'}:${file.path}`
    setGitAction(action)
    setGitError(null)
    try {
      const diff = await window.desktop.repositories.gitDiff(
        gitRepository.localPath,
        file.path,
        staged,
      )
      setDiffTitle(`${staged ? 'Staged' : 'Working tree'} · ${file.path}`)
      setDiffText(diff || 'No textual diff is available for this file.')
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

  return (
    <div className="app-frame" data-platform={platform}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={myReposIcon} alt="" aria-hidden="true" />
          </div>
          <div>
            <Text fw={750} lh={1.1}>MyRepos</Text>
            <Text size="10px" c="dimmed">Account manager</Text>
          </div>
        </div>

        <Divider color="dark.4" />

        <Box p="sm">
          <Text className="nav-section-title">MANAGE</Text>
          <UnstyledButton
            className="nav-item"
            data-active={activeView === 'accounts' || undefined}
            onClick={() => setActiveView('accounts')}
          >
            <IconUsers size={17} stroke={1.7} />
            <Text size="sm" fw={600}>Accounts</Text>
          </UnstyledButton>
          <UnstyledButton
            className="nav-item"
            data-active={activeView === 'repositories' || undefined}
            disabled={accounts.length === 0}
            onClick={() => setActiveView('repositories')}
          >
            <IconBook2 size={17} stroke={1.7} />
            <Text size="sm" fw={600}>Repositories</Text>
          </UnstyledButton>
          <UnstyledButton
            className="nav-item"
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

      <main className="main-area">
        <header className="topbar">
          {activeView === 'accounts' ? (
            <div>
              <Text fw={700} fz="lg">Accounts</Text>
              <Text size="xs" c="dimmed">
                Manage the GitHub identities available to MyRepos
              </Text>
            </div>
          ) : activeView === 'repositories' ? (
            <Tabs
              className="topbar-tabs"
              value={repositoryTab}
              onChange={(value) => {
                setRepositoryTab((value as RepositoryTab | null) ?? 'new')
                setRepositoryPage(1)
                contentScrollRef.current?.scrollTo({ top: 0 })
              }}
            >
              <Tabs.List>
                <Tabs.Tab value="cloned" leftSection={<IconCheck size={14} />}>
                  Cloned <span className="tab-count">{clonedRepositoryCount}</span>
                </Tabs.Tab>
                <Tabs.Tab value="new" leftSection={<IconPlus size={14} />}>
                  New <span className="tab-count">{repositoriesLoading ? '…' : newRepositoryCount}</span>
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          ) : (
            <div>
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

        <div className="content-scroll" ref={contentScrollRef}>
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
                    {repositoryTab === 'cloned' ? 'cloned' : 'new'}
                  </Badge>
                </section>
              </div>

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
                      <Text size="sm" fw={650}>{cloneResult.fullName} cloned</Text>
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
                      : repositoryTab === 'cloned'
                        ? 'No cloned repositories yet'
                        : 'No new repositories'}
                  </Text>
                  <Text size="sm" c="dimmed" ta="center">
                    {repositorySearch
                      ? 'Try a different search.'
                      : repositoryTab === 'cloned'
                        ? 'Clone a repository or locate an existing local clone.'
                        : 'Every available repository is already cloned.'}
                  </Text>
                </Paper>
              ) : (
                <Stack gap="sm" mt="lg">
                  {pagedRepositories.map((repository) => {
                    const gitStatus = repository.localPath
                      ? gitStatuses[repository.localPath]
                      : undefined
                    const changeCount = gitStatus
                      ? gitStatus.staged + gitStatus.unstaged + gitStatus.untracked + gitStatus.conflicts
                      : 0

                    return <Paper
                      className="repository-card"
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
                          {repository.localPath && (
                            <Badge
                              size="xs"
                              variant="light"
                              color="teal"
                              leftSection={<IconCheck size={10} />}
                            >
                              Cloned
                            </Badge>
                          )}
                          {repository.localPath && gitStatus && !gitStatus.error && (
                            <Badge
                              size="xs"
                              variant="light"
                              color={gitStatus.conflicts > 0 ? 'red' : gitStatus.clean ? 'teal' : 'yellow'}
                            >
                              {gitStatus.clean ? 'Clean' : `${changeCount} changes`}
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

                      <Group gap="xs" wrap="nowrap">
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
                            <Button
                              size="xs"
                              variant="subtle"
                              color="gray"
                              leftSection={<IconGitCommit size={14} />}
                              onClick={() => void openGitPanel(repository)}
                            >
                              Changes
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
                </Stack>
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
        opened={Boolean(gitRepository)}
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
