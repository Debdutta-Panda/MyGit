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

    CREATE TABLE IF NOT EXISTS working_copies (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'github',
      account_id INTEGER NOT NULL,
      full_name TEXT NOT NULL COLLATE NOCASE,
      local_path TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      copy_type TEXT NOT NULL DEFAULT 'clone'
        CHECK (copy_type IN ('clone', 'worktree', 'local')),
      is_preferred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_synced_at TEXT,
      last_opened_at TEXT,
      last_seen_at TEXT
    );

    CREATE INDEX IF NOT EXISTS working_copies_repository_idx
      ON working_copies(provider, account_id, full_name, is_preferred);

    CREATE UNIQUE INDEX IF NOT EXISTS working_copies_one_preferred_idx
      ON working_copies(provider, account_id, full_name)
      WHERE is_preferred = 1;

    CREATE TABLE IF NOT EXISTS repository_commit_pushes (
      provider TEXT NOT NULL DEFAULT 'github',
      account_id INTEGER NOT NULL,
      full_name TEXT NOT NULL COLLATE NOCASE,
      commit_hash TEXT NOT NULL,
      pushed_at TEXT NOT NULL,
      PRIMARY KEY(provider, account_id, full_name, commit_hash)
    );

    CREATE INDEX IF NOT EXISTS repository_commit_pushes_repository_idx
      ON repository_commit_pushes(provider, account_id, full_name, pushed_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      vscode_application_name TEXT NOT NULL DEFAULT '',
      automatically_check_for_updates INTEGER NOT NULL DEFAULT 1,
      automatically_download_updates INTEGER NOT NULL DEFAULT 1
    );

    INSERT OR IGNORE INTO app_settings (id, vscode_application_name) VALUES (1, '');

    CREATE TABLE IF NOT EXISTS configuration_sync_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      local_path TEXT,
      account_id INTEGER,
      full_name TEXT,
      auto_sync INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      last_error TEXT
    );

    INSERT OR IGNORE INTO configuration_sync_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_local_targets (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('folder', 'code-workspace')),
      target_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_working_copies (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      full_name TEXT NOT NULL COLLATE NOCASE,
      working_copy_id TEXT NOT NULL REFERENCES working_copies(id) ON DELETE CASCADE,
      PRIMARY KEY(workspace_id, provider, account_id, full_name)
    );

    CREATE TABLE IF NOT EXISTS workspace_checkouts (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      root_path TEXT NOT NULL,
      code_workspace_path TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_repositories (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      full_name TEXT NOT NULL COLLATE NOCASE,
      color TEXT,
      UNIQUE(provider, account_id, full_name)
    );

    CREATE TABLE IF NOT EXISTS repository_workspaces (
      repository_id TEXT NOT NULL REFERENCES organization_repositories(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      repository_position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(repository_id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS repository_groups (
      repository_id TEXT NOT NULL REFERENCES organization_repositories(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(repository_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS repository_tags (
      repository_id TEXT NOT NULL REFERENCES organization_repositories(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(repository_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS ssh_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
      username TEXT NOT NULL,
      authentication_type TEXT NOT NULL
        CHECK (authentication_type IN ('password', 'private-key', 'agent')),
      private_key_path TEXT,
      agent_socket TEXT,
      encrypted_password TEXT,
      encrypted_passphrase TEXT,
      host_fingerprint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_connected_at TEXT
    );

    CREATE INDEX IF NOT EXISTS ssh_connections_name_idx
      ON ssh_connections(name);

    CREATE TABLE IF NOT EXISTS ssh_mysql_profiles (
      connection_id TEXT PRIMARY KEY REFERENCES ssh_connections(id) ON DELETE CASCADE,
      access_mode TEXT NOT NULL CHECK (access_mode IN ('system', 'password')),
      username TEXT NOT NULL DEFAULT '',
      encrypted_password TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ssh_command_templates (
      connection_id TEXT NOT NULL REFERENCES ssh_connections(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('snippets', 'scripts')),
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      template TEXT NOT NULL,
      variable_types_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (connection_id, kind, id)
    );

    CREATE TABLE IF NOT EXISTS portable_preferences (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS repository_workspaces_workspace_idx
      ON repository_workspaces(workspace_id, position);
    CREATE INDEX IF NOT EXISTS repository_groups_group_idx
      ON repository_groups(group_id, position);
    CREATE INDEX IF NOT EXISTS repository_tags_tag_idx
      ON repository_tags(tag_id);

    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (1, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (2, datetime('now'));
  `)

  const appSettingsColumns = db.prepare('PRAGMA table_info(app_settings)').all() as unknown as
    Array<{ name: string }>
  if (!appSettingsColumns.some((column) => column.name === 'automatically_check_for_updates')) {
    db.exec(`
      ALTER TABLE app_settings
        ADD COLUMN automatically_check_for_updates INTEGER NOT NULL DEFAULT 1;
    `)
  }
  if (!appSettingsColumns.some((column) => column.name === 'automatically_download_updates')) {
    db.exec(`
      ALTER TABLE app_settings
        ADD COLUMN automatically_download_updates INTEGER NOT NULL DEFAULT 1;
    `)
  }

  const workspaceColumns = db.prepare('PRAGMA table_info(repository_workspaces)').all() as unknown as
    Array<{ name: string }>
  if (!workspaceColumns.some((column) => column.name === 'repository_position')) {
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE repository_workspaces
        ADD COLUMN repository_position INTEGER NOT NULL DEFAULT 0;
      UPDATE repository_workspaces SET repository_position = rowid;
      COMMIT;
    `)
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS repository_workspaces_order_idx
      ON repository_workspaces(workspace_id, repository_position);
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (3, datetime('now'));
  `)

  const organizationRepositoryColumns = db.prepare(
    'PRAGMA table_info(organization_repositories)',
  ).all() as unknown as Array<{ name: string }>
  if (!organizationRepositoryColumns.some((column) => column.name === 'color')) {
    db.exec('ALTER TABLE organization_repositories ADD COLUMN color TEXT;')
  }
  db.exec(`
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (4, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (5, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (6, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (7, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (8, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (9, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (10, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (11, datetime('now'));
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (12, datetime('now'));
    INSERT OR IGNORE INTO portable_preferences (key, value_json, updated_at)
      SELECT 'app.updatePreferences',
        '{"automaticallyCheckForUpdates":' ||
          CASE WHEN automatically_check_for_updates <> 0 THEN 'true' ELSE 'false' END ||
        ',"automaticallyDownloadUpdates":' ||
          CASE WHEN automatically_download_updates <> 0 THEN 'true' ELSE 'false' END || '}',
        datetime('now') FROM app_settings WHERE id = 1;
  `)

  db.exec(`
    INSERT OR IGNORE INTO working_copies (
      id, provider, account_id, full_name, local_path, label, copy_type,
      is_preferred, created_at, last_synced_at, last_seen_at
    )
    SELECT id, provider, account_id, full_name, local_path, 'Primary', 'clone',
           1, cloned_at, last_synced_at, cloned_at
    FROM repositories
    WHERE local_path IS NOT NULL AND local_path <> '';
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
    // Legacy JSON is imported after schema creation, so run the idempotent projection once more.
    db.exec(`
      INSERT OR IGNORE INTO working_copies (
        id, provider, account_id, full_name, local_path, label, copy_type,
        is_preferred, created_at, last_synced_at, last_seen_at
      )
      SELECT id, provider, account_id, full_name, local_path, 'Primary', 'clone',
             1, cloned_at, last_synced_at, cloned_at
      FROM repositories
      WHERE local_path IS NOT NULL AND local_path <> '';
    `)
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
