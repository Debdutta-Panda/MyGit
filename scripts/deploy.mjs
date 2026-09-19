import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function fail(message) {
  console.error(`\nDeploy failed: ${message}`)
  process.exit(1)
}

function execute(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    windowsHide: true,
    ...options
  })
}

function run(command, args) {
  const result = execute(command, args, { stdio: 'inherit' })

  if (result.error) {
    fail(result.error.message)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function capture(command, args) {
  const result = execute(command, args, { encoding: 'utf8' })

  if (result.error) {
    fail(result.error.message)
  }

  return result
}

function findGitHubCli() {
  const command = process.platform === 'win32' ? 'gh.exe' : 'gh'
  const result = execute(command, ['--version'], { stdio: 'ignore' })

  if (!result.error && result.status === 0) {
    return command
  }

  if (process.platform === 'win32') {
    const installedPath = 'C:\\Program Files\\GitHub CLI\\gh.exe'
    if (existsSync(installedPath)) {
      return installedPath
    }
  }

  fail('GitHub CLI was not found. Install `gh`, reopen the terminal, and run `gh auth login`.')
}

function parseStableVersion(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return match ? match.slice(1).map(Number) : null
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function versionText(version) {
  return version.join('.')
}

function nextPatch(version) {
  return [version[0], version[1], version[2] + 1]
}

function platformReleaseIsComplete(version, assets) {
  const names = assets.map((asset) => asset.name)
  const escapedVersion = version.replace(/\./g, '\\.')

  if (process.platform === 'win32') {
    return names.includes('latest.yml') &&
      names.some((name) => new RegExp(`^MyRepos-Setup-${escapedVersion}-.+\\.exe$`).test(name))
  }
  if (process.platform === 'darwin') {
    return names.includes('latest-mac.yml') &&
      names.some((name) => new RegExp(`^MyRepos-${escapedVersion}-mac-.+\\.(?:dmg|zip)$`).test(name))
  }
  return names.includes('latest-linux.yml') &&
    names.some((name) => new RegExp(`^MyRepos-${escapedVersion}-linux-.+\\.(?:AppImage|deb)$`).test(name))
}

function saveVersion(projectRoot, packageJson, version) {
  packageJson.version = version
  const packageLockPath = resolve(projectRoot, 'package-lock.json')
  const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'))
  packageLock.version = version
  if (packageLock.packages?.['']) packageLock.packages[''].version = version

  writeFileSync(resolve(projectRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`)
}

if (!process.env.npm_execpath) {
  fail('Run deployment through `npm run deploy`.')
}

const projectRoot = process.cwd()
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
const configuredVersion = packageJson.version
const repositoryUrl =
  typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository?.url
const repositoryMatch = repositoryUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i)

const parsedConfiguredVersion = parseStableVersion(configuredVersion)
if (!parsedConfiguredVersion) {
  fail('package.json version must use stable semantic versioning, for example 1.2.3.')
}

if (!repositoryMatch) {
  fail('package.json must contain a valid GitHub repository URL.')
}

const repository = `${repositoryMatch[1]}/${repositoryMatch[2]}`
const gh = findGitHubCli()
const authStatus = capture(gh, ['auth', 'status'])

if (authStatus.status !== 0) {
  fail('GitHub CLI is not authenticated. Run `gh auth login` first.')
}

const latestReleaseResult = capture(gh, [
  'release',
  'view',
  '--repo',
  repository,
  '--json',
  'tagName,assets'
])
let versionParts = parsedConfiguredVersion

if (latestReleaseResult.status === 0) {
  try {
    const latestRelease = JSON.parse(latestReleaseResult.stdout)
    const remoteVersion = parseStableVersion(latestRelease.tagName)
    if (remoteVersion) {
      if (compareVersions(remoteVersion, versionParts) > 0) versionParts = remoteVersion
      if (
        compareVersions(remoteVersion, versionParts) === 0 &&
        platformReleaseIsComplete(versionText(remoteVersion), latestRelease.assets ?? [])
      ) {
        versionParts = nextPatch(versionParts)
      }
    }
  } catch {
    fail('GitHub returned invalid release information.')
  }
}

const version = versionText(versionParts)
if (version !== configuredVersion) {
  saveVersion(projectRoot, packageJson, version)
  console.log(`Version ${configuredVersion} → ${version}`)
} else {
  console.log(`Using version ${version} to complete or repair its release.`)
}

const tag = `v${version}`

console.log('Building MyRepos...')
run(process.execPath, [process.env.npm_execpath, 'run', 'build'])

console.log(`Packaging MyRepos ${version} for ${process.platform}...`)
run(process.execPath, [
  resolve(projectRoot, 'node_modules', 'electron-builder', 'cli.js'),
  '--publish',
  'never'
])

const releaseDirectory = resolve(projectRoot, 'release')
const updateMetadata = new Set(['latest.yml', 'latest-mac.yml', 'latest-linux.yml'])
const artifacts = readdirSync(releaseDirectory, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      (entry.name.includes(`-${version}-`) || updateMetadata.has(entry.name))
  )
  .map((entry) => resolve(releaseDirectory, entry.name))

if (artifacts.length === 0) {
  fail(`No ${version} release artifacts were produced.`)
}

const existingRelease = capture(gh, ['release', 'view', tag, '--repo', repository])

if (existingRelease.status !== 0) {
  const branchResult = capture(gh, [
    'repo',
    'view',
    repository,
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name'
  ])
  const defaultBranch = branchResult.stdout?.trim()

  if (branchResult.status !== 0 || !defaultBranch) {
    fail(`Could not determine the default branch for ${repository}.`)
  }

  console.log(`Creating GitHub release ${tag}...`)
  run(gh, [
    'release',
    'create',
    tag,
    '--repo',
    repository,
    '--target',
    defaultBranch,
    '--title',
    version,
    '--generate-notes'
  ])
}

console.log(`Uploading ${artifacts.length} release artifacts...`)
run(gh, ['release', 'upload', tag, ...artifacts, '--clobber', '--repo', repository])

console.log(`\nMyRepos ${version} was published successfully.`)
