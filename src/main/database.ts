import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { access, chmod, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let database: DatabaseSync | null = null

const databasePath = (): string => join(app.getPath('userData'), 'myrepos.sqlite3')

const legacyPath = (name: string): string => join(app.getPath('userData'), name)

const readLegacyJson = async (name: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await readFile(legacyPath(name), 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`Could not migrate ${name}: ${error instanceof Error ? error.message : 'Invalid JSON.'}`)
  }
}

const backupLegacyFile = async (name: string): Promise<void> => {
  const source = legacyPath(name)
  try {
    await access(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  let destination = `${source}.migrated`
  try {
    await access(destination)
    destination = `${destination}.${Date.now()}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rename(source, destination)
}

const createSchema = (db: DatabaseSync): void => {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      login TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT NOT NULL,
      profile_url TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      added_at TEXT NOT NULL,
      encrypted_access_token TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      access_token_expires_at TEXT,
      refresh_token_expires_at TEXT,
      token_type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'github',
      account_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      cloned_at TEXT NOT NULL,
      last_synced_at TEXT,
      UNIQUE(provider, account_id, full_name)
    );

    CREATE INDEX IF NOT EXISTS repositories_local_path_idx
      ON repositories(local_path);

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      vscode_application_name TEXT NOT NULL DEFAULT ''
    );

    INSERT OR IGNORE INTO app_settings (id, vscode_application_name) VALUES (1, '');
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (1, datetime('now'));
  `)
}

const migrateLegacyJson = async (db: DatabaseSync): Promise<void> => {
  const completed = db.prepare(
    "SELECT value FROM app_metadata WHERE key = 'legacy_json_import_v1'",
  ).get() as { value?: string } | undefined
  if (completed?.value === 'complete') return

  const [accountData, cloneData, settingsData] = await Promise.all([
    readLegacyJson('accounts.json'),
    readLegacyJson('clones.json'),
    readLegacyJson('settings.json'),
  ])

  if (accountData !== null) {
    const candidate = accountData as { version?: unknown; accounts?: unknown }
    if (candidate.version !== 1 || !Array.isArray(candidate.accounts)) {
      throw new Error('Could not migrate accounts.json: unsupported format.')
    }
  }
  if (cloneData !== null && !Array.isArray(cloneData)) {
    throw new Error('Could not migrate clones.json: unsupported format.')
  }
  if (settingsData !== null) {
    const candidate = settingsData as { version?: unknown; settings?: unknown }
    if (candidate.version !== 1 || !candidate.settings || typeof candidate.settings !== 'object') {
      throw new Error('Could not migrate settings.json: unsupported format.')
    }
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    if (accountData !== null) {
      const accounts = (accountData as { accounts: Array<Record<string, unknown>> }).accounts
      const insertAccount = db.prepare(`
        INSERT OR REPLACE INTO accounts (
          id, login, name, avatar_url, profile_url, scopes_json, added_at,
          encrypted_access_token, encrypted_refresh_token, access_token_expires_at,
          refresh_token_expires_at, token_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const account of accounts) {
        if (
          typeof account.id !== 'number' ||
          typeof account.login !== 'string' ||
          typeof account.avatarUrl !== 'string' ||
          typeof account.profileUrl !== 'string' ||
          !Array.isArray(account.scopes) ||
          typeof account.addedAt !== 'string' ||
          typeof account.encryptedAccessToken !== 'string' ||
          typeof account.tokenType !== 'string'
        ) throw new Error('Could not migrate accounts.json: invalid account record.')

        insertAccount.run(
          account.id,
          account.login,
          typeof account.name === 'string' ? account.name : null,
          account.avatarUrl,
          account.profileUrl,
          JSON.stringify(account.scopes),
          account.addedAt,
          account.encryptedAccessToken,
          typeof account.encryptedRefreshToken === 'string' ? account.encryptedRefreshToken : null,
          typeof account.accessTokenExpiresAt === 'string' ? account.accessTokenExpiresAt : null,
          typeof account.refreshTokenExpiresAt === 'string' ? account.refreshTokenExpiresAt : null,
          account.tokenType,
        )
      }
    }

    if (cloneData !== null) {
      const insertRepository = db.prepare(`
        INSERT INTO repositories (
          id, provider, account_id, full_name, local_path, cloned_at, last_synced_at
        ) VALUES (?, 'github', ?, ?, ?, ?, ?)
        ON CONFLICT(provider, account_id, full_name) DO UPDATE SET
          local_path = excluded.local_path,
          cloned_at = excluded.cloned_at,
          last_synced_at = excluded.last_synced_at
      `)
      for (const record of cloneData as Array<Record<string, unknown>>) {
        if (
          typeof record.accountId !== 'number' ||
          typeof record.fullName !== 'string' ||
          typeof record.path !== 'string' ||
          typeof record.clonedAt !== 'string'
        ) throw new Error('Could not migrate clones.json: invalid clone record.')
        insertRepository.run(
          randomUUID(),
          record.accountId,
          record.fullName,
          record.path,
          record.clonedAt,
          typeof record.lastSyncedAt === 'string' ? record.lastSyncedAt : null,
        )
      }
    }

    if (settingsData !== null) {
      const settings = (settingsData as { settings: Record<string, unknown> }).settings
      const applicationName = typeof settings.vscodeApplicationName === 'string'
        ? settings.vscodeApplicationName
        : ''
      db.prepare(`
        UPDATE app_settings SET vscode_application_name = ? WHERE id = 1
      `).run(applicationName)
    }

    db.prepare(`
      INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('legacy_json_import_v1', 'complete')
    `).run()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  await Promise.all([
    backupLegacyFile('accounts.json'),
    backupLegacyFile('clones.json'),
    backupLegacyFile('settings.json'),
  ])
}

export const initializeDatabase = async (): Promise<void> => {
  if (database) return
  const db = new DatabaseSync(databasePath())
  try {
    createSchema(db)
    await migrateLegacyJson(db)
    await chmod(databasePath(), 0o600)
    database = db
  } catch (error) {
    db.close()
    throw error
  }
}

export const getDatabase = (): DatabaseSync => {
  if (!database) throw new Error('The application database has not been initialized.')
  return database
}

export const closeDatabase = (): void => {
  database?.close()
  database = null
}
