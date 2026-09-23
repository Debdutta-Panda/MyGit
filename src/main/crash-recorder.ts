import { app, crashReporter, ipcMain, type BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let crashLogPath = ''
let initialized = false

const errorDetails = (error: unknown): Record<string, unknown> => error instanceof Error
  ? { name: error.name, message: error.message, stack: error.stack }
  : { message: String(error) }

export const recordCrash = (
  source: string,
  details: Record<string, unknown> = {},
): void => {
  try {
    if (!crashLogPath) return
    appendFileSync(crashLogPath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      source,
      pid: process.pid,
      versions: process.versions,
      ...details,
    })}\n`, 'utf8')
  } catch (error) {
    console.error('[crash-recorder-failed]', error)
  }
}

export const initializeCrashRecorder = (): void => {
  if (initialized) return
  initialized = true
  const diagnosticsDirectory = join(app.getPath('userData'), 'diagnostics')
  const crashDirectory = join(diagnosticsDirectory, 'crashes')
  mkdirSync(crashDirectory, { recursive: true })
  crashLogPath = join(diagnosticsDirectory, 'crash-events.jsonl')
  app.setPath('crashDumps', crashDirectory)
  try {
    crashReporter.start({
      companyName: 'MyRepos',
      productName: 'MyRepos',
      submitURL: '',
      uploadToServer: false,
      compress: false,
    })
  } catch (error) {
    recordCrash('crashReporter.start-failed', errorDetails(error))
  }

  process.on('uncaughtException', (error) => {
    recordCrash('main.uncaughtException', errorDetails(error))
    app.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    recordCrash('main.unhandledRejection', errorDetails(reason))
  })
  app.on('child-process-gone', (_event, details) => {
    recordCrash('app.child-process-gone', { ...details })
  })
  ipcMain.on('diagnostics:renderer-error', (_event, value: unknown) => {
    const candidate = value && typeof value === 'object'
      ? value as Record<string, unknown>
      : { message: String(value) }
    const clean = Object.fromEntries(Object.entries(candidate).slice(0, 20).map(([key, entry]) => [
      key.slice(0, 80),
      typeof entry === 'string' ? entry.slice(0, 30_000) : entry,
    ]))
    recordCrash('renderer.javascript', clean)
  })
}

export const registerWindowCrashRecorder = (window: BrowserWindow): void => {
  window.webContents.on('render-process-gone', (_event, details) => {
    recordCrash('renderer.process-gone', { ...details, url: window.webContents.getURL() })
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    recordCrash('renderer.preload-error', { preloadPath, ...errorDetails(error) })
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    recordCrash('renderer.did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    })
  })
  window.on('unresponsive', () => {
    recordCrash('renderer.unresponsive', { url: window.webContents.getURL() })
  })
}

export const getCrashLogPath = (): string => crashLogPath
