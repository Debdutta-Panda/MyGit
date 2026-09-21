import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { getDatabase } from './database'
import { scheduleConfigurationSync } from './configuration-sync'
import { autoPushPolicyChanged, cancelScheduledAutoPush } from './repository-auto-push'
import { refreshRepositoryStatus } from './repository-monitor'
import {
  cloneRepository,
  locateRepository,
  refreshedCredentials,
  runGitClone,
} from './github-repositories'
import {
  detachWorkingCopy,
  getWorkingCopy,
  listWorkingCopies,
  registerWorkingCopy,
  setPreferredWorkingCopy,
  updateWorkingCopyLabel,
  updateWorkingCopyAutoPush,
  updateWorkingCopyPath,
} from './working-copy-store'
import type {
  RepositoryWorkingCopy,
  WorkspaceLaunchTarget,
  WorkspaceProvisionResult,
} from '../shared/desktop-api'

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

const runGit = async (
  path: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<string> => await new Promise((resolvePromise, reject) => {
  const git = spawn('git', ['-C', path, ...args], { shell: false, windowsHide: true })
  let stdout = ''
  let stderr = ''
  const timer = setTimeout(() => {
    git.kill()
    reject(new Error('The Git operation timed out.'))
  }, timeoutMs)
  git.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  git.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-20_000) })
  git.once('error', (error) => {
    clearTimeout(timer)
    reject((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? new Error('Git is not installed or is not available in PATH.')
      : error)
  })
  git.once('close', (code) => {
    clearTimeout(timer)
    if (code === 0) resolvePromise(stdout.trim())
    else reject(new Error(stderr.trim() || stdout.trim() || `Git exited with code ${code ?? 'unknown'}.`))
  })
})

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const normalizedGitHubRemote = (remote: string): string | null => {
  const match = remote.match(/^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}` : null
}

const verifyWorkingCopyFolder = async (path: string, fullName: string): Promise<void> => {
  await runGit(path, ['rev-parse', '--git-dir'])
  const remote = await runGit(path, ['remote', 'get-url', 'origin'])
  if (normalizedGitHubRemote(remote)?.toLowerCase() !== fullName.toLowerCase()) {
    throw new Error(`The selected folder is not a working copy of ${fullName}.`)
  }
}

const ownerWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender)

const assertNotConfigurationRepository = (path: string): void => {
  const row = getDatabase().prepare(`
    SELECT 1 FROM configuration_sync_settings WHERE id = 1 AND local_path = ?
  `).get(path)
  if (row) throw new Error('Disconnect this repository from configuration sync before removing its working copy.')
}

const relocateWorkingCopy = async (
  event: Electron.IpcMainInvokeEvent,
  idValue: unknown,
): Promise<RepositoryWorkingCopy | null> => {
  if (typeof idValue !== 'string') throw new Error('Invalid working copy selection.')
  const copy = await getWorkingCopy(idValue)
  const options: Electron.OpenDialogOptions = {
    title: `Locate ${copy.label}`,
    buttonLabel: 'Use this folder',
    defaultPath: dirname(copy.path),
    properties: ['openDirectory'],
  }
  const owner = ownerWindow(event)
  const selection = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null
  const path = resolve(selection.filePaths[0])
  await verifyWorkingCopyFolder(path, copy.fullName)
  const relocated = await updateWorkingCopyPath(copy.id, path)
  getDatabase().prepare(`
    UPDATE configuration_sync_settings SET local_path = ? WHERE id = 1 AND local_path = ?
  `).run(relocated.path, copy.path)
  return relocated
}

const trashWorkingCopy = async (idValue: unknown): Promise<void> => {
  if (typeof idValue !== 'string') throw new Error('Invalid working copy selection.')
  const copy = await getWorkingCopy(idValue)
  assertNotConfigurationRepository(copy.path)
  const resolvedPath = resolve(copy.path)
  const protectedPaths = new Set([
    resolve('/'),
    resolve(app.getPath('home')),
    resolve(app.getPath('documents')),
    resolve(app.getPath('userData')),
  ])
  if (protectedPaths.has(resolvedPath) || dirname(resolvedPath) === resolvedPath) {
    throw new Error('MyRepos will not delete a protected or broad system folder.')
  }
  if (copy.available) await stat(resolve(copy.path, '.git'))
  if (copy.available && copy.type === 'worktree') {
    const siblings = await listWorkingCopies(copy.accountId, copy.fullName)
    const source = siblings.find((item) => item.id !== copy.id && item.available)
    if (!source) throw new Error('Another available clone is required to remove this Git worktree safely.')
    await shell.trashItem(copy.path)
    await runGit(source.path, ['worktree', 'prune'])
  } else if (copy.available) {
    await shell.trashItem(copy.path)
  }
  await detachWorkingCopy(copy.id)
  scheduleConfigurationSync()
}

const createWorktree = async (
  event: Electron.IpcMainInvokeEvent,
  sourceIdValue: unknown,
  branchValue: unknown,
  createBranchValue: unknown,
  labelValue: unknown,
): Promise<RepositoryWorkingCopy | null> => {
  if (typeof sourceIdValue !== 'string' || typeof branchValue !== 'string' ||
    typeof createBranchValue !== 'boolean') throw new Error('Invalid worktree request.')
  const branch = branchValue.trim()
  if (!branch || branch.length > 240 || /[\s~^:?*[\\]/.test(branch) || branch.includes('..')) {
    throw new Error('Enter a valid Git branch name.')
  }
  const source = await getWorkingCopy(sourceIdValue)
  if (!source.available) throw new Error('The source working copy is unavailable.')
  const options: Electron.OpenDialogOptions = {
    title: `Create worktree for ${source.fullName}`,
    buttonLabel: 'Choose parent folder',
    defaultPath: dirname(source.path),
    properties: ['openDirectory', 'createDirectory'],
  }
  const owner = ownerWindow(event)
  const selection = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null
  const folderName = `${basename(source.fullName)}-${branch.replace(/[^A-Za-z0-9_.-]/g, '-')}`
  const destination = resolve(selection.filePaths[0], folderName)
  if (await pathExists(destination)) throw new Error(`A folder named “${folderName}” already exists.`)
  await runGit(source.path, createBranchValue
    ? ['worktree', 'add', '-b', branch, destination]
    : ['worktree', 'add', destination, branch])
  return await registerWorkingCopy(source.accountId, source.fullName, destination, {
    label: typeof labelValue === 'string' ? labelValue : branch,
    type: 'worktree',
  })
}

const parseRepositoryKey = (key: string): { accountId: number; fullName: string } | null => {
  const match = key.match(/^github:(\d+):(.+\/.+)$/i)
  if (!match) return null
  return { accountId: Number(match[1]), fullName: match[2] }
}

const workspaceRepositories = (workspaceId: string): Array<{
  repositoryKey: string
  accountId: number
  fullName: string
}> => {
  const rows = getDatabase().prepare(`
    SELECT repository.account_id, repository.full_name
    FROM repository_workspaces link
    JOIN organization_repositories repository ON repository.id = link.repository_id
    WHERE link.workspace_id = ?
    ORDER BY link.repository_position, repository.full_name COLLATE NOCASE
  `).all(workspaceId) as unknown as Array<{ account_id: number; full_name: string }>
  return rows.map((row) => ({
    repositoryKey: `github:${row.account_id}:${row.full_name.toLowerCase()}`,
    accountId: row.account_id,
    fullName: row.full_name,
  }))
}

const validateWorkspace = (value: unknown): { id: string; name: string } => {
  if (typeof value !== 'string') throw new Error('Invalid workspace selection.')
  const row = getDatabase().prepare('SELECT id, name FROM workspaces WHERE id = ?')
    .get(value) as { id: string; name: string } | undefined
  if (!row) throw new Error('The selected workspace no longer exists.')
  return row
}

const saveWorkspaceSelection = (
  workspaceIdValue: unknown,
  workingCopyIdValue: unknown,
): void => {
  const workspace = validateWorkspace(workspaceIdValue)
  if (typeof workingCopyIdValue !== 'string') throw new Error('Invalid working copy selection.')
  const copy = getDatabase().prepare(`
    SELECT id, provider, account_id, full_name FROM working_copies WHERE id = ?
  `).get(workingCopyIdValue) as {
    id: string
    provider: string
    account_id: number
    full_name: string
  } | undefined
  if (!copy) throw new Error('The selected working copy no longer exists.')
  const member = getDatabase().prepare(`
    SELECT 1 FROM repository_workspaces link
    JOIN organization_repositories repository ON repository.id = link.repository_id
    WHERE link.workspace_id = ? AND repository.provider = ?
      AND repository.account_id = ? AND repository.full_name = ? COLLATE NOCASE
  `).get(workspace.id, copy.provider, copy.account_id, copy.full_name)
  if (!member) throw new Error('This repository is not part of the selected workspace.')
  getDatabase().prepare(`
    INSERT INTO workspace_working_copies (
      workspace_id, provider, account_id, full_name, working_copy_id
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, provider, account_id, full_name) DO UPDATE SET
      working_copy_id = excluded.working_copy_id
  `).run(workspace.id, copy.provider, copy.account_id, copy.full_name, copy.id)
  scheduleConfigurationSync()
}

const workspaceSelections = (workspaceIdValue: unknown): Record<string, string> => {
  const workspace = validateWorkspace(workspaceIdValue)
  const rows = getDatabase().prepare(`
    SELECT account_id, full_name, working_copy_id
    FROM workspace_working_copies WHERE workspace_id = ?
  `).all(workspace.id) as unknown as Array<{
    account_id: number
    full_name: string
    working_copy_id: string
  }>
  return Object.fromEntries(rows.map((row) => [
    `github:${row.account_id}:${row.full_name.toLowerCase()}`,
    row.working_copy_id,
  ]))
}

const provisionWorkspace = async (
  event: Electron.IpcMainInvokeEvent,
  workspaceIdValue: unknown | null,
  repositoryKeysValue: unknown,
): Promise<WorkspaceProvisionResult | null> => {
  if (!Array.isArray(repositoryKeysValue) || repositoryKeysValue.some((key) => typeof key !== 'string')) {
    throw new Error('Invalid workspace repository selection.')
  }
  const selectedKeys = new Set(repositoryKeysValue as string[])
  const workspace = workspaceIdValue === null ? null : validateWorkspace(workspaceIdValue)
  const repositories = workspace
    ? workspaceRepositories(workspace.id)
      .filter((repository) => selectedKeys.size === 0 || selectedKeys.has(repository.repositoryKey))
    : [...selectedKeys].flatMap((key) => {
        const repository = parseRepositoryKey(key)
        return repository ? [{ repositoryKey: key, ...repository }] : []
      })
  if (repositories.length === 0) throw new Error(
    workspace ? 'This workspace has no selected repositories.' : 'Select at least one repository.',
  )
  const options: Electron.OpenDialogOptions = {
    title: workspace ? `Create checkout for ${workspace.name}` : 'Clone selected repositories',
    buttonLabel: 'Choose checkout folder',
    properties: ['openDirectory', 'createDirectory'],
  }
  const owner = ownerWindow(event)
  const selection = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (selection.canceled || !selection.filePaths[0]) return null
  const rootPath = resolve(selection.filePaths[0])
  await mkdir(rootPath, { recursive: true })
  const checkoutLabel = workspace
    ? `${workspace.name} · ${basename(rootPath)}`
    : `Batch · ${basename(rootPath)}`

  const duplicateNames = new Map<string, number>()
  repositories.forEach((repository) => {
    const name = basename(repository.fullName).toLowerCase()
    duplicateNames.set(name, (duplicateNames.get(name) ?? 0) + 1)
  })
  const credentials = new Map<number, Awaited<ReturnType<typeof refreshedCredentials>>>()
  const results: WorkspaceProvisionResult['results'] = []
  for (const repository of repositories) {
    const [ownerName, repositoryName] = repository.fullName.split('/', 2)
    const folderName = (duplicateNames.get(repositoryName.toLowerCase()) ?? 0) > 1
      ? `${ownerName}-${repositoryName}`
      : repositoryName
    const destination = resolve(rootPath, folderName)
    try {
      let workingCopy: RepositoryWorkingCopy
      if (await pathExists(destination)) {
        await verifyWorkingCopyFolder(destination, repository.fullName)
        workingCopy = await registerWorkingCopy(
          repository.accountId,
          repository.fullName,
          destination,
          { label: checkoutLabel, type: 'clone' },
        )
        results.push({ ...repository, status: 'registered', workingCopy, message: null })
      } else {
        let auth = credentials.get(repository.accountId)
        if (!auth) {
          auth = await refreshedCredentials(repository.accountId)
          credentials.set(repository.accountId, auth)
        }
        const temporary = resolve(rootPath, `.myrepos-clone-${randomUUID()}`)
        try {
          await runGitClone(
            `https://github.com/${repository.fullName}.git`,
            temporary,
            auth.accountLogin,
            auth.token,
          )
          await rename(temporary, destination)
        } catch (error) {
          await rm(temporary, { recursive: true, force: true })
          throw error
        }
        workingCopy = await registerWorkingCopy(
          repository.accountId,
          repository.fullName,
          destination,
          { label: checkoutLabel, type: 'clone' },
        )
        results.push({ ...repository, status: 'cloned', workingCopy, message: null })
      }
      if (workspace) saveWorkspaceSelection(workspace.id, workingCopy.id)
    } catch (error) {
      results.push({
        ...repository,
        status: 'error',
        workingCopy: null,
        message: error instanceof Error ? error.message : 'Could not create working copy.',
      })
    }
  }
  if (workspace) getDatabase().prepare(`
      INSERT INTO workspace_checkouts (workspace_id, root_path, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        root_path = excluded.root_path,
        updated_at = excluded.updated_at
    `).run(workspace.id, rootPath, new Date().toISOString())
  scheduleConfigurationSync()
  return { workspaceId: workspace?.id ?? '', rootPath, results }
}

const generateCodeWorkspace = async (
  event: Electron.IpcMainInvokeEvent,
  workspaceIdValue: unknown,
): Promise<WorkspaceLaunchTarget> => {
  const workspace = validateWorkspace(workspaceIdValue)
  const repositories = workspaceRepositories(workspace.id)
  const selections = workspaceSelections(workspace.id)
  const folders: Array<{ name: string; path: string }> = []
  const missing: string[] = []
  for (const repository of repositories) {
    const copies = await listWorkingCopies(repository.accountId, repository.fullName)
    const selectedId = selections[repository.repositoryKey]
    const copy = copies.find((item) => item.id === selectedId && item.available) ??
      copies.find((item) => item.preferred && item.available) ?? copies.find((item) => item.available)
    if (!copy) missing.push(repository.fullName)
    else folders.push({ name: repository.fullName, path: copy.path })
  }
  if (missing.length > 0) {
    throw new Error(`Clone or locate working copies first: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}.`)
  }
  const checkout = getDatabase().prepare(`
    SELECT root_path, code_workspace_path FROM workspace_checkouts WHERE workspace_id = ?
  `).get(workspace.id) as { root_path: string; code_workspace_path: string | null } | undefined
  let path: string
  if (checkout?.root_path) {
    const safeName = workspace.name.replace(/[^A-Za-z0-9_.-]/g, '-')
    path = resolve(checkout.root_path, `${safeName}.code-workspace`)
    if (await pathExists(path) && resolve(checkout.code_workspace_path ?? '') !== path) {
      let suffix = 2
      while (await pathExists(resolve(checkout.root_path, `${safeName}-${suffix}.code-workspace`))) {
        suffix += 1
      }
      path = resolve(checkout.root_path, `${safeName}-${suffix}.code-workspace`)
    }
  } else {
    const owner = ownerWindow(event)
    const options: Electron.SaveDialogOptions = {
      title: `Create VS Code workspace for ${workspace.name}`,
      defaultPath: `${workspace.name.replace(/[^A-Za-z0-9_.-]/g, '-')}.code-workspace`,
      filters: [{ name: 'VS Code Workspace', extensions: ['code-workspace'] }],
    }
    const selection = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (selection.canceled || !selection.filePath) throw new Error('Workspace creation was cancelled.')
    path = resolve(selection.filePath)
  }
  const base = dirname(path)
  await writeFile(path, `${JSON.stringify({
    folders: folders.map((folder) => ({
      name: folder.name,
      path: relative(base, folder.path) || '.',
    })),
    settings: {},
  }, null, 2)}\n`, 'utf8')
  getDatabase().prepare(`
    INSERT INTO workspace_local_targets (workspace_id, target_type, target_path)
    VALUES (?, 'code-workspace', ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      target_type = excluded.target_type,
      target_path = excluded.target_path
  `).run(workspace.id, path)
  getDatabase().prepare(`
    INSERT INTO workspace_checkouts (workspace_id, root_path, code_workspace_path, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      code_workspace_path = excluded.code_workspace_path,
      updated_at = excluded.updated_at
  `).run(workspace.id, checkout?.root_path ?? base, path, new Date().toISOString())
  return { workspaceId: workspace.id, type: 'code-workspace', path }
}

export const registerWorkingCopyHandlers = (): void => {
  ipcMain.handle('working-copies:list', (_event, accountId, fullName) => {
    if (!Number.isInteger(accountId) || typeof fullName !== 'string' || !repositoryPattern.test(fullName)) {
      throw new Error('Invalid repository selection.')
    }
    return listWorkingCopies(accountId, fullName)
  })
  ipcMain.handle('working-copies:update-label', async (_event, id, label) => {
    if (typeof id !== 'string' || typeof label !== 'string') throw new Error('Invalid working copy details.')
    const copy = await updateWorkingCopyLabel(id, label)
    scheduleConfigurationSync()
    return copy
  })
  ipcMain.handle('working-copies:set-auto-push', async (_event, id, mode) => {
    if (typeof id !== 'string' || (mode !== 'off' && mode !== 'idle')) {
      throw new Error('Invalid auto-push preference.')
    }
    const copy = await updateWorkingCopyAutoPush(id, mode)
    autoPushPolicyChanged({
      id: copy.id,
      account_id: copy.accountId,
      full_name: copy.fullName,
      local_path: copy.path,
      auto_push_mode: copy.autoPushMode,
    })
    if (copy.autoPushMode === 'idle') void refreshRepositoryStatus(copy.path)
    return copy
  })
  ipcMain.handle('working-copies:cancel-auto-push', (_event, id) => {
    if (typeof id !== 'string') throw new Error('Invalid working copy selection.')
    return cancelScheduledAutoPush(id)
  })
  ipcMain.handle('working-copies:clone', async (event, accountId, fullName, options) => {
    if (!Number.isInteger(accountId) || typeof fullName !== 'string') {
      throw new Error('Invalid repository selection.')
    }
    const cloneOptions = options && typeof options === 'object'
      ? options as { folderName?: string; label?: string }
      : {}
    const result = await cloneRepository(event, accountId, fullName, cloneOptions)
    if (result) scheduleConfigurationSync()
    return result
  })
  ipcMain.handle('working-copies:locate', async (event, accountId, fullName, label) => {
    if (!Number.isInteger(accountId) || typeof fullName !== 'string' ||
      (label !== undefined && typeof label !== 'string')) {
      throw new Error('Invalid repository selection.')
    }
    const copy = (await locateRepository(event, accountId, fullName, label))?.workingCopy ?? null
    if (copy) scheduleConfigurationSync()
    return copy
  })
  ipcMain.handle('working-copies:set-preferred', async (_event, id) => {
    if (typeof id !== 'string') throw new Error('Invalid working copy selection.')
    const copies = await setPreferredWorkingCopy(id)
    scheduleConfigurationSync()
    return copies
  })
  ipcMain.handle('working-copies:relocate', (event, id) => relocateWorkingCopy(event, id))
  ipcMain.handle('working-copies:detach', (_event, id) => {
    if (typeof id !== 'string') throw new Error('Invalid working copy selection.')
    return getWorkingCopy(id).then((copy) => {
      assertNotConfigurationRepository(copy.path)
      return detachWorkingCopy(id).then(() => scheduleConfigurationSync())
    })
  })
  ipcMain.handle('working-copies:trash', (_event, id) => trashWorkingCopy(id))
  ipcMain.handle('working-copies:create-worktree', async (event, sourceId, branch, createBranch, label) => {
    const copy = await createWorktree(event, sourceId, branch, createBranch, label)
    if (copy) scheduleConfigurationSync()
    return copy
  })
  ipcMain.handle('working-copies:set-for-workspace', (_event, workspaceId, workingCopyId) =>
    saveWorkspaceSelection(workspaceId, workingCopyId))
  ipcMain.handle('working-copies:workspace-selections', (_event, workspaceId) =>
    workspaceSelections(workspaceId))
  ipcMain.handle('working-copies:provision-workspace', (event, workspaceId, repositoryKeys) =>
    provisionWorkspace(event, workspaceId, repositoryKeys))
  ipcMain.handle('working-copies:clone-batch', (event, repositoryKeys) =>
    provisionWorkspace(event, null, repositoryKeys))
  ipcMain.handle('working-copies:generate-code-workspace', (event, workspaceId) =>
    generateCodeWorkspace(event, workspaceId))
}
