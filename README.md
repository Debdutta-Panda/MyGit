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

The command detects the host operating system: Windows produces an NSIS installer, macOS produces DMG
and ZIP packages for Intel and Apple Silicon, and Linux produces AppImage and DEB packages for x64 and
ARM64. Packages and update metadata are written to `release/`. Each operating system must build its own
packages locally; macOS packages must be built on macOS.

Explicit platform commands are also available:

```powershell
npm.cmd run package:win
npm.cmd run package:mac
npm.cmd run package:linux
```

To publish manually, create a release at `https://github.com/Debdutta-Panda/MyGit/releases/new`, use tag
`v0.1.0` for package version `0.1.0`, and upload every generated file from `release/`.

To publish directly from the terminal, provide a GitHub token with repository Contents write access:

```powershell
$env:GH_TOKEN = 'YOUR_GITHUB_TOKEN'
npm.cmd run publish:github
Remove-Item Env:GH_TOKEN
```

`publish:github` also detects the current operating system and uploads that machine's packages directly
to the matching GitHub Release. Run it once on each operating system whose downloads you want to offer.
Before each release, update the version in `package.json`. Keep the release tag in the form
`v<package-version>`. Never commit a GitHub token or place it in `.env`.

### GitHub sign-in setup

1. Create a GitHub OAuth App in **Settings → Developer settings → OAuth Apps**.
2. Use `http://localhost` for the homepage and callback URL while developing.
3. Enable **Device Flow** in the OAuth App settings.
4. Put the app's public client ID in `.env` as `MYREPOS_GITHUB_CLIENT_ID`.

The device flow does not use or embed a client secret. MyRepos requests `repo`, `read:user`, and `user:email` so it can list and clone public and private repositories for the connected account. Access and refresh tokens remain in the Electron main process and are encrypted with the operating system's secure storage before their ciphertext is written to SQLite.

### Local data

MyRepos stores accounts, repository registrations, and settings in `myrepos.sqlite3` under Electron's application data directory. Database access stays in the main process, with foreign keys and WAL mode enabled. Credentials remain encrypted through Electron `safeStorage`; plaintext tokens are never stored in SQLite or exposed to the renderer.

Repositories can be organized manually into Workspaces (repositories worked on together), Groups (browsing collections), and Tags (descriptive labels). These many-to-many assignments are stored transactionally in SQLite and managed from each repository's Organize dialog.

Settings can connect a portable configuration repository in three ways: create and publish a managed GitHub repository, clone an existing GitHub repository, or use an existing local Git repository. MyRepos stores the portable data in `.myrepos/config.json` and can commit/push changes automatically or pull, push, and sync manually. The file contains organization metadata, repository colors, assignments, and workspace ordering; credentials, local paths, and machine-specific settings are deliberately excluded.

On the first SQLite-backed launch, legacy `accounts.json`, `clones.json`, and `settings.json` data is imported in one transaction. Successfully imported files are retained alongside the database with a `.migrated` suffix for recovery.

## Structure

- `src/main` — Electron main process and future native/Git services
- `src/preload` — narrow, typed bridge exposed to the renderer
- `src/renderer` — React and Mantine interface

The current implementation supports connecting, listing, replacing, and removing multiple GitHub accounts, browsing their accessible repositories, and securely cloning through the system Git installation.
