# MyRepos

Electron + React + TypeScript desktop shell for a multi-account, multi-provider Git client.

The master application artwork lives in `resources/myrepos-icon-master.png`. Runtime and packaging-ready variants live in `src/renderer/src/assets`, `src/renderer/public`, and `build` (`icon.png`, `icon.icns`, and `icon.ico`).

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

## Local releases

Build packages for the current machine automatically:

```powershell
npm.cmd run package
```

The command detects the host operating system. Windows produces a Squirrel installer and update package;
macOS and Linux produce ZIP packages. Forge writes packages below `release/make/`. Each operating system must
build its own packages locally; macOS packages must be built on macOS.

Explicit platform commands are also available:

```powershell
npm.cmd run package:win
npm.cmd run package:mac
npm.cmd run package:linux
```

To publish manually, create a release at `https://github.com/Debdutta-Panda/MyGit/releases/new`, use tag
`v0.1.0` for package version `0.1.0`, and upload `MyRepos-Setup.exe`, `RELEASES`, and the matching
`MyRepos-<version>-full.nupkg` from `release/make/squirrel.windows/x64/`.

To build and publish through the authenticated GitHub CLI:

```powershell
npm run deploy
```

On Windows, `deploy` reads authentication from `gh auth`, increments the patch version automatically,
builds the Squirrel artifacts, creates the matching `v<package-version>` GitHub Release as a draft, uploads
all installer and update files, and publishes the completed release. If the current release is incomplete,
it reuses that version and repairs the release instead of skipping to another version. Never commit a
GitHub token or place one in `.env`.

### GitHub sign-in setup

1. Create a GitHub OAuth App in **Settings → Developer settings → OAuth Apps**.
2. Use `http://localhost` for the homepage and callback URL while developing.
3. Enable **Device Flow** in the OAuth App settings.
4. Put the app's public client ID in `.env` as `MYREPOS_GITHUB_CLIENT_ID`.

The device flow does not use or embed a client secret. MyRepos requests `repo`, `read:user`, and `user:email` so it can list and clone public and private repositories for the connected account. Access and refresh tokens remain in the Electron main process and are encrypted with the operating system's secure storage before their ciphertext is written to SQLite.

### Local data

MyRepos stores accounts, repository registrations, and settings in `myrepos.sqlite3` under Electron's application data directory. Database access stays in the main process, with foreign keys and WAL mode enabled. Credentials remain encrypted through Electron `safeStorage`; plaintext tokens are never stored in SQLite or exposed to the renderer.

Repositories can be organized manually into Workspaces (repositories worked on together), Groups (browsing collections), and Tags (descriptive labels). These many-to-many assignments are stored transactionally in SQLite and managed from each repository's Organize dialog.

Each repository can have any number of registered working copies. MyRepos tracks a preferred copy, friendly labels, full clones, local registrations, and Git worktrees independently. Missing copies can be relocated or detached, while folder deletion is a separate recoverable Trash action. Workspace checkouts can clone all or selected repositories into another root, remember a workspace-specific copy for each repository, and generate a multi-root `.code-workspace` file.

Each working copy also has a complete branch manager for local and remote discovery, worktree-aware checkout, dirty-tree carry or stash choices, branch creation from any branch or selected commit, detached commit checkout, publishing, renaming, and guarded local or remote deletion.

File history follows a path across renames and exposes every committed revision with exact commit time, recorded push time, per-commit diffs, complete historical contents, two-revision comparison, and one-click restoration into the working tree. It is available from both the Changes file list and every file in a selected commit.

The Files tab provides a searchable hierarchical view of the current working tree, including tracked and untracked files, optional ignored files, aggregated folder status, live refresh, VS Code-style file and folder icons, read-only Monaco code views, sandboxed Markdown/HTML/SVG previews with Code, Preview, and split Both modes, PDF/image/audio/video previews, copying, and direct access to each file's history.

SQL files add a local, non-executing schema preview with table-list, field-detail, and relationship-diagram views. SQL preview also supports the Code, Preview, and resizable Both modes.

The repository Analytics tab summarizes Git change activity over the last 30 days, 90 days, year, or full history. It groups additions and deletions by commit, day, week, or month and ranks high-churn files, folders, and contributors, with file rankings linking directly into file history.

The Files view also exposes Content and Analytics detail modes. Selecting a file scopes the charts and contributor activity to that path; selecting a folder aggregates every descendant file while keeping expansion on the folder chevron.

Settings can connect a portable configuration repository in three ways: create and publish a managed GitHub repository, clone an existing GitHub repository, or use an existing local Git repository. MyRepos stores the portable data in `.myrepos/config.json` and can commit/push changes automatically or pull, push, and sync manually. The file contains organization metadata, repository colors, assignments, workspace ordering, and working-copy label preferences; credentials, absolute local paths, and machine-specific availability are deliberately excluded.

On the first SQLite-backed launch, legacy `accounts.json`, `clones.json`, and `settings.json` data is imported in one transaction. Successfully imported files are retained alongside the database with a `.migrated` suffix for recovery.

## Structure

- `src/main` — Electron main process and future native/Git services
- `src/preload` — narrow, typed bridge exposed to the renderer
- `src/renderer` — React and Mantine interface

The current implementation supports connecting, listing, replacing, and removing multiple GitHub accounts, browsing their accessible repositories, and securely cloning through the system Git installation.
