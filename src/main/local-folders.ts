import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { createReadStream } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  LocalFolderEntry,
  LocalFolderListing,
  LocalFolderSelection,
  LocalFolderUploadInput,
  LocalFolderUploadProgress,
  LocalFolderUploadResult,
} from '../shared/desktop-api'
import { withRemoteFileSystem } from './remote-filesystem'
import { getRemoteFileConnection } from './remote-connections'

const isWithin = (root: string, target: string): boolean =>
  target === root || target.startsWith(`${root}${sep}`)

const safeLocalTarget = async (rootPath: unknown, relativePath: unknown): Promise<{
  root: string
  target: string
  relativePath: string
}> => {
  if (typeof rootPath !== 'string' || !rootPath || rootPath.length > 4_096 ||
    typeof relativePath !== 'string' || relativePath.length > 4_096 || relativePath.includes('\0')) {
    throw new Error('Invalid local folder path.')
  }
  const root = await realpath(resolve(rootPath))
  const target = resolve(root, relativePath || '.')
  if (!isWithin(root, target)) throw new Error('The selected path is outside the opened folder.')
  const canonicalTarget = await realpath(target)
  if (!isWithin(root, canonicalTarget)) throw new Error('Symbolic links outside the opened folder are not allowed.')
  return {
    root,
    target,
    relativePath: relative(root, target).split(sep).join('/'),
  }
}

const gitRepository = async (path: string): Promise<boolean> => {
  try {
    return (await stat(join(path, '.git'))).isDirectory() || (await stat(join(path, '.git'))).isFile()
  } catch {
    return false
  }
}

const chooseLocalFolder = async (
  event: IpcMainInvokeEvent,
): Promise<LocalFolderSelection | null> => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(owner ?? undefined, {
    title: 'Open local folder',
    buttonLabel: 'Open folder',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const path = await realpath(result.filePaths[0])
  return { path, name: basename(path), gitRepository: await gitRepository(path) }
}

const listLocalFolder = async (
  rootPath: unknown,
  requestedRelativePath: unknown = '',
): Promise<LocalFolderListing> => {
  const location = await safeLocalTarget(rootPath, requestedRelativePath)
  const directory = await lstat(location.target)
  if (!directory.isDirectory()) throw new Error('The selected local path is not a folder.')
  const rows = await readdir(location.target, { withFileTypes: true })
  const entries = (await Promise.all(rows.map(async (row): Promise<LocalFolderEntry> => {
    const path = join(location.target, row.name)
    const details = await lstat(path)
    const entryRelativePath = relative(location.root, path).split(sep).join('/')
    return {
      name: row.name,
      relativePath: entryRelativePath,
      type: details.isSymbolicLink() ? 'link'
        : details.isDirectory() ? 'directory'
          : details.isFile() ? 'file' : 'other',
      size: details.size,
      modifiedAt: details.mtime.toISOString(),
    }
  }))).sort((left, right) => left.type === right.type
    ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    : left.type === 'directory' ? -1 : right.type === 'directory' ? 1 : 0)
  return {
    path: location.root,
    name: basename(location.root),
    gitRepository: await gitRepository(location.root),
    relativePath: location.relativePath,
    parentPath: location.relativePath
      ? posix.dirname(location.relativePath) === '.' ? '' : posix.dirname(location.relativePath)
      : null,
    entries,
  }
}

interface UploadFile {
  path: string
  relativePath: string
  size: number
}

const collectUpload = async (root: string, target: string): Promise<{
  files: UploadFile[]
  directories: string[]
  skippedLinks: number
}> => {
  const files: UploadFile[] = []
  const directories: string[] = []
  let skippedLinks = 0
  const visit = async (path: string): Promise<void> => {
    if (files.length + directories.length > 100_000) {
      throw new Error('Upload stopped after 100,000 entries. Choose a smaller folder.')
    }
    const details = await lstat(path)
    const itemPath = relative(root, path).split(sep).join('/')
    if (details.isSymbolicLink()) {
      skippedLinks += 1
    } else if (details.isDirectory()) {
      directories.push(itemPath)
      for (const child of await readdir(path)) await visit(join(path, child))
    } else if (details.isFile()) {
      files.push({ path, relativePath: itemPath, size: details.size })
    }
  }
  await visit(target)
  return { files, directories, skippedLinks }
}

const uploadLocalEntry = async (
  event: IpcMainInvokeEvent,
  input: LocalFolderUploadInput,
): Promise<LocalFolderUploadResult> => {
  if (!input || typeof input !== 'object' || typeof input.remoteConnectionId !== 'string' ||
    !input.remoteConnectionId || typeof input.remoteDirectory !== 'string' ||
    typeof input.overwrite !== 'boolean') throw new Error('Invalid upload request.')
  const location = await safeLocalTarget(input.rootPath, input.relativePath)
  const upload = await collectUpload(location.root, location.target)
  const id = randomUUID()
  const totalBytes = upload.files.reduce((sum, file) => sum + file.size, 0)
  const selectedRelativePath = location.relativePath || basename(location.root)
  const selectedBase = basename(location.target)
  const remoteRoot = posix.join(input.remoteDirectory || '.', selectedBase)
  let transferredBytes = 0
  let completedFiles = 0
  const sendProgress = (relativePath: string, currentFileBytes = 0): void => {
    if (event.sender.isDestroyed()) return
    const progress: LocalFolderUploadProgress = {
      id,
      relativePath,
      transferredBytes: transferredBytes + currentFileBytes,
      totalBytes,
      completedFiles,
      totalFiles: upload.files.length,
    }
    event.sender.send('local-folders:upload-progress', progress)
  }

  await withRemoteFileSystem(
    getRemoteFileConnection(input.remoteConnectionId),
    async (filesystem) => {
      for (const directory of upload.directories) {
        const suffix = posix.relative(selectedRelativePath, directory)
        await filesystem.mkdir(suffix ? posix.join(remoteRoot, suffix) : remoteRoot, true)
      }
      if (upload.directories.length === 0 && upload.files.length === 1) {
        await filesystem.mkdir(posix.dirname(remoteRoot), true)
      }
      for (const file of upload.files) {
        const suffix = posix.relative(selectedRelativePath, file.relativePath)
        const remotePath = upload.directories.length === 0
          ? remoteRoot
          : posix.join(remoteRoot, suffix)
        if (!input.overwrite) {
          try {
            await filesystem.stat(remotePath)
            throw new Error(`A remote entry already exists: ${remotePath}`)
          } catch (error) {
            if (error instanceof Error && error.message.startsWith('A remote entry already exists:')) throw error
          }
        }
        await filesystem.upload(createReadStream(file.path), remotePath, ({ bytes }) =>
          sendProgress(file.relativePath, bytes))
        transferredBytes += file.size
        completedFiles += 1
        sendProgress(file.relativePath)
      }
    },
  )
  return {
    id,
    remotePath: remoteRoot,
    uploadedFiles: upload.files.length,
    uploadedBytes: transferredBytes,
    skippedLinks: upload.skippedLinks,
  }
}

export const registerLocalFolderHandlers = (): void => {
  ipcMain.handle('local-folders:choose', (event) => chooseLocalFolder(event))
  ipcMain.handle('local-folders:list', (_event, rootPath, relativePath) =>
    listLocalFolder(rootPath, relativePath))
  ipcMain.handle('local-folders:upload', (event, input) => uploadLocalEntry(event, input))
}
