# MyRepos

Electron + React + TypeScript desktop shell for a multi-account, multi-provider Git client.

The master application artwork lives in `resources/myrepos-icon-master.png`. Runtime and packaging-ready variants live in `src/renderer/src/assets`, `src/renderer/public`, and `build` (`icon.png`, `icon.icns`, and `icon.ico`).

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

### GitHub sign-in setup

1. Create a GitHub OAuth App in **Settings → Developer settings → OAuth Apps**.
2. Use `http://localhost` for the homepage and callback URL while developing.
3. Enable **Device Flow** in the OAuth App settings.
4. Put the app's public client ID in `.env` as `MYREPOS_GITHUB_CLIENT_ID`.

The device flow does not use or embed a client secret. MyRepos requests `repo`, `read:user`, and `user:email` so it can list and clone public and private repositories for the connected account. Access and refresh tokens remain in the Electron main process and are encrypted with the operating system's secure storage before being written to the app data directory.

## Structure

- `src/main` — Electron main process and future native/Git services
- `src/preload` — narrow, typed bridge exposed to the renderer
- `src/renderer` — React and Mantine interface

The current implementation supports connecting, listing, replacing, and removing multiple GitHub accounts, browsing their accessible repositories, and securely cloning through the system Git installation.
