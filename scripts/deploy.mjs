import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

if (!process.env.npm_execpath) {
  fail('Run deployment through `npm run deploy`.')
}

const projectRoot = process.cwd()
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const repositoryUrl =
  typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository?.url
const repositoryMatch = repositoryUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i)

if (!version) {
  fail('No version is defined in package.json.')
}

if (!repositoryMatch) {
  fail('package.json must contain a valid GitHub repository URL.')
}

const repository = `${repositoryMatch[1]}/${repositoryMatch[2]}`
const tag = `v${version}`
const gh = findGitHubCli()
const authStatus = capture(gh, ['auth', 'status'])

if (authStatus.status !== 0) {
  fail('GitHub CLI is not authenticated. Run `gh auth login` first.')
}

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
