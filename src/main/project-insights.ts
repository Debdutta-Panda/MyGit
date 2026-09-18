import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { verifiedClonePath } from './github-repositories'
import type {
  ProjectInsightFile,
  ProjectInsightFileCategory,
  ProjectInsightLanguage,
  ProjectInsightsResult,
  ProjectInsightTechnology,
} from '../shared/desktop-api'

const MAX_FILES = 100_000
const MAX_TEXT_BYTES = 4 * 1024 * 1024
const excludedDirectories = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.cache', '.idea', '.gradle', 'target', 'obj',
])

const languageByExtension: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.php': 'PHP', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.cs': 'C#', '.fs': 'F#', '.vb': 'Visual Basic', '.c': 'C', '.h': 'C',
  '.cc': 'C++', '.cpp': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.hh': 'C++',
  '.go': 'Go', '.rs': 'Rust', '.swift': 'Swift', '.dart': 'Dart', '.rb': 'Ruby',
  '.scala': 'Scala', '.lua': 'Lua', '.r': 'R', '.sh': 'Shell', '.bash': 'Shell',
  '.ps1': 'PowerShell', '.sql': 'SQL', '.html': 'HTML', '.htm': 'HTML', '.vue': 'Vue',
  '.svelte': 'Svelte', '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass', '.less': 'Less',
  '.xml': 'XML', '.xaml': 'XAML', '.json': 'JSON', '.jsonc': 'JSON with Comments',
  '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML', '.md': 'Markdown', '.mdx': 'MDX',
  '.graphql': 'GraphQL', '.gql': 'GraphQL', '.proto': 'Protocol Buffers',
  '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.hrl': 'Erlang',
}

const assetExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.wav', '.ogg', '.flac', '.mp4',
  '.webm', '.mov', '.avi', '.pdf', '.psd', '.ai', '.sketch', '.fig',
])
const archiveExtensions = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.jar', '.war'])
const binaryExtensions = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.db', '.sqlite', '.class', '.pyc'])
const configNames = new Set([
  'package.json', 'composer.json', 'tsconfig.json', 'jsconfig.json', 'vite.config.ts',
  'vite.config.js', 'webpack.config.js', 'rollup.config.js', 'eslint.config.js',
  'cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt', 'pom.xml', 'build.gradle',
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.gitignore', '.editorconfig',
])
const projectMarkerNames = new Set([
  'package.json', 'composer.json', 'cargo.toml', 'go.mod', 'pyproject.toml', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'pubspec.yaml', 'gemfile',
])

const normalizePath = (value: string): string => value.split(sep).join('/')

const gitFiles = async (rootPath: string): Promise<string[] | null> => await new Promise((done) => {
  const child = spawn('git', ['-C', rootPath, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    shell: false,
    windowsHide: true,
  })
  const chunks: Buffer[] = []
  let length = 0
  child.stdout.on('data', (chunk: Buffer) => {
    length += chunk.length
    if (length <= 25_000_000) chunks.push(chunk)
    else child.kill()
  })
  child.once('error', () => done(null))
  child.once('close', (code) => {
    if (code !== 0 || length > 25_000_000) return done(null)
    done(Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean))
  })
})

const walkedFiles = async (rootPath: string): Promise<string[]> => {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_FILES) return
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break
      if (entry.isSymbolicLink()) continue
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name.toLowerCase())) await visit(fullPath)
      } else if (entry.isFile()) files.push(normalizePath(relative(rootPath, fullPath)))
    }
  }
  await visit(rootPath)
  return files
}

const categoryFor = (filePath: string, language: string | null): ProjectInsightFileCategory => {
  const extension = extname(filePath).toLowerCase()
  const name = basename(filePath).toLowerCase()
  if (assetExtensions.has(extension)) return 'asset'
  if (archiveExtensions.has(extension)) return 'archive'
  if (binaryExtensions.has(extension)) return 'binary'
  if (configNames.has(name) || name.startsWith('.env')) return 'config'
  return language ? 'source' : 'text'
}

const lineCommentTokens: Record<string, string[]> = {
  TypeScript: ['//'], JavaScript: ['//'], Java: ['//'], Kotlin: ['//'], 'C#': ['//'],
  'F#': ['//'], 'C++': ['//'], C: ['//'], Go: ['//'], Rust: ['//'], Swift: ['//'],
  Dart: ['//'], PHP: ['//', '#'], Python: ['#'], Ruby: ['#'], Shell: ['#'],
  PowerShell: ['#'], R: ['#'], SQL: ['--'], Lua: ['--'], YAML: ['#'], TOML: ['#'],
}

const lineStats = (content: string, language: string | null): Pick<ProjectInsightFile,
  'lines' | 'codeLines' | 'commentLines' | 'blankLines'> => {
  if (content.length === 0) return { lines: 0, codeLines: 0, commentLines: 0, blankLines: 0 }
  const rows = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (rows.at(-1) === '') rows.pop()
  const tokens = language ? lineCommentTokens[language] ?? [] : []
  const htmlBlocks = language === 'HTML' || language === 'Vue' || language === 'Svelte' || language === 'XML'
  let blankLines = 0
  let commentLines = 0
  let codeLines = 0
  let blockEnd: string | null = null
  for (const row of rows) {
    const value = row.trim()
    if (!value) { blankLines += 1; continue }
    if (blockEnd) {
      commentLines += 1
      if (value.includes(blockEnd)) blockEnd = null
      continue
    }
    if (htmlBlocks && value.startsWith('<!--')) {
      commentLines += 1
      if (!value.includes('-->')) blockEnd = '-->'
      continue
    }
    if (value.startsWith('/*')) {
      commentLines += 1
      if (!value.includes('*/')) blockEnd = '*/'
      continue
    }
    if (tokens.some((token) => value.startsWith(token))) commentLines += 1
    else codeLines += 1
  }
  return { lines: rows.length, codeLines, commentLines, blankLines }
}

interface TechnologyDefinition {
  name: string
  category: ProjectInsightTechnology['category']
}

const technologyDefinitions: Record<string, TechnologyDefinition> = {
  // UI libraries stay libraries; application and server systems are frameworks.
  react: { name: 'React', category: 'library' },
  'react-dom': { name: 'React', category: 'library' },
  '@mantine/core': { name: 'Mantine', category: 'library' },
  '@mantine/hooks': { name: 'Mantine Hooks', category: 'library' },
  vue: { name: 'Vue', category: 'framework' },
  svelte: { name: 'Svelte', category: 'framework' },
  '@angular/core': { name: 'Angular', category: 'framework' },
  next: { name: 'Next.js', category: 'framework' },
  nuxt: { name: 'Nuxt', category: 'framework' },
  '@sveltejs/kit': { name: 'SvelteKit', category: 'framework' },
  electron: { name: 'Electron', category: 'framework' },
  express: { name: 'Express', category: 'framework' },
  fastify: { name: 'Fastify', category: 'framework' },
  '@nestjs/core': { name: 'NestJS', category: 'framework' },
  astro: { name: 'Astro', category: 'framework' },
  '@remix-run/react': { name: 'Remix', category: 'framework' },
  'laravel/framework': { name: 'Laravel', category: 'framework' },
  'codeigniter4/framework': { name: 'CodeIgniter', category: 'framework' },
  'symfony/framework-bundle': { name: 'Symfony', category: 'framework' },
  django: { name: 'Django', category: 'framework' },
  flask: { name: 'Flask', category: 'framework' },
  fastapi: { name: 'FastAPI', category: 'framework' },
  axum: { name: 'Axum', category: 'framework' },
  'actix-web': { name: 'Actix Web', category: 'framework' },
  rocket: { name: 'Rocket', category: 'framework' },
  tauri: { name: 'Tauri', category: 'framework' },
  'github.com/gin-gonic/gin': { name: 'Gin', category: 'framework' },
  'github.com/gofiber/fiber': { name: 'Fiber', category: 'framework' },
  vite: { name: 'Vite', category: 'tool' },
  typescript: { name: 'TypeScript', category: 'tool' },
  eslint: { name: 'ESLint', category: 'tool' },
  prettier: { name: 'Prettier', category: 'tool' },
  webpack: { name: 'webpack', category: 'tool' },
  rollup: { name: 'Rollup', category: 'tool' },
  esbuild: { name: 'esbuild', category: 'tool' },
  jest: { name: 'Jest', category: 'tool' },
  vitest: { name: 'Vitest', category: 'tool' },
  playwright: { name: 'Playwright', category: 'tool' },
  '@playwright/test': { name: 'Playwright', category: 'tool' },
  cypress: { name: 'Cypress', category: 'tool' },
  tailwindcss: { name: 'Tailwind CSS', category: 'framework' },
  bootstrap: { name: 'Bootstrap', category: 'framework' },
  pytest: { name: 'pytest', category: 'tool' },
  phpunit: { name: 'PHPUnit', category: 'tool' },
  'phpunit/phpunit': { name: 'PHPUnit', category: 'tool' },
}

const technologyDefinition = (name: string): TechnologyDefinition => {
  const normalized = name.toLowerCase()
  const known = technologyDefinitions[normalized]
  if (known) return known
  if (normalized.includes('spring-boot')) return { name: 'Spring Boot', category: 'framework' }
  if (normalized.startsWith('microsoft.aspnetcore.')) return { name: 'ASP.NET Core', category: 'framework' }
  if (normalized.startsWith('@types/')) return { name, category: 'tool' }
  if (normalized.startsWith('@vitejs/') || normalized.startsWith('@typescript-eslint/') ||
      /^(?:@[^/]+\/)?(?:eslint|babel|webpack|rollup|vite)-/.test(normalized)) {
    return { name, category: 'tool' }
  }
  return { name, category: 'library' }
}

const manifestTechnologies = (
  manifestPath: string,
  content: string,
): ProjectInsightTechnology[] => {
  const fileName = basename(manifestPath).toLowerCase()
  const technology = (name: string, version: string | null): ProjectInsightTechnology => {
    const definition = technologyDefinition(name)
    return {
      name: definition.name, category: definition.category, version,
      confidence: 'confirmed', evidence: [`${manifestPath}: ${name}`],
    }
  }
  if (fileName === 'package.json' || fileName === 'composer.json') try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const dependencies = {
      ...(parsed.dependencies as Record<string, string> | undefined),
      ...(parsed.require as Record<string, string> | undefined),
      ...(parsed.devDependencies as Record<string, string> | undefined),
      ...(parsed['require-dev'] as Record<string, string> | undefined),
      ...(parsed.peerDependencies as Record<string, string> | undefined),
    }
    const items = Object.entries(dependencies)
      .filter(([name]) => !['php', 'node'].includes(name))
      .map(([name, version]) => technology(name, typeof version === 'string' ? version : null))
    const runtimeVersion = fileName === 'package.json'
      ? (parsed.engines as Record<string, string> | undefined)?.node ?? null
      : (parsed.require as Record<string, string> | undefined)?.php ?? null
    items.push({
      name: fileName === 'package.json' ? 'Node.js' : 'PHP', category: 'runtime', version: runtimeVersion,
      confidence: 'confirmed', evidence: [manifestPath],
    })
    if (fileName === 'composer.json') items.push({
      name: 'Composer', category: 'tool', version: null, confidence: 'confirmed', evidence: [manifestPath],
    })
    return items
  } catch {
    return []
  }
  if (fileName === 'requirements.txt') {
    return content.split(/\r?\n/).map((line) => line.trim()).filter((line) =>
      line && !line.startsWith('#') && !line.startsWith('-')).map((line) => {
      const match = line.match(/^([a-z0-9_.-]+)\s*(?:[=<>!~]+\s*([^;\s]+))?/i)
      return match ? technology(match[1], match[2] ?? null) : null
    }).filter((item): item is ProjectInsightTechnology => Boolean(item))
  }
  if (fileName === 'pyproject.toml') {
    const items: ProjectInsightTechnology[] = [{
      name: 'Python', category: 'runtime', version: null, confidence: 'confirmed', evidence: [manifestPath],
    }]
    for (const match of content.matchAll(/^\s*["']?([a-z0-9_.-]+)["']?\s*(?:=|[<>=!~])\s*["']?([^"',\]\s]+)?/gim)) {
      if (['name', 'version', 'description', 'python'].includes(match[1].toLowerCase())) continue
      items.push(technology(match[1], match[2] ?? null))
    }
    return items
  }
  if (fileName === 'cargo.toml') {
    const items: ProjectInsightTechnology[] = [{
      name: 'Rust', category: 'runtime', version: null, confidence: 'confirmed', evidence: [manifestPath],
    }, { name: 'Cargo', category: 'tool', version: null, confidence: 'confirmed', evidence: [manifestPath] }]
    const dependencySection = content.match(/\[dependencies\]([\s\S]*?)(?=\n\[|$)/i)?.[1] ?? ''
    for (const match of dependencySection.matchAll(/^([\w-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) {
      items.push(technology(match[1], match[2] ?? match[3] ?? null))
    }
    return items
  }
  if (fileName === 'go.mod') {
    const items: ProjectInsightTechnology[] = [{
      name: 'Go', category: 'runtime', version: content.match(/^go\s+([^\s]+)/m)?.[1] ?? null,
      confidence: 'confirmed', evidence: [manifestPath],
    }]
    for (const match of content.matchAll(/^\s*([^\s()]+)\s+(v[^\s]+)/gm)) {
      if (!match[1].includes('.')) continue
      items.push(technology(match[1], match[2]))
    }
    return items
  }
  if (fileName === 'pom.xml') {
    const items: ProjectInsightTechnology[] = [{
      name: 'Maven', category: 'tool', version: null, confidence: 'confirmed', evidence: [manifestPath],
    }, { name: 'Java', category: 'runtime', version: null, confidence: 'confirmed', evidence: [manifestPath] }]
    for (const match of content.matchAll(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/g)) {
      items.push(technology(match[1], match[2] ?? null))
    }
    if (content.includes('spring-boot')) items.push(technology('spring-boot', null))
    return items
  }
  if (/\.(csproj|fsproj|vbproj)$/.test(fileName)) {
    const items: ProjectInsightTechnology[] = [{
      name: '.NET', category: 'runtime', version: content.match(/<TargetFramework>([^<]+)/)?.[1] ?? null,
      confidence: 'confirmed', evidence: [manifestPath],
    }]
    for (const match of content.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)) {
      items.push(technology(match[1], match[2] ?? null))
    }
    if (content.includes('Microsoft.NET.Sdk.Web')) items.push({
      name: 'ASP.NET Core', category: 'framework', version: null,
      confidence: 'confirmed', evidence: [`${manifestPath}: Microsoft.NET.Sdk.Web`],
    })
    return items
  }
  return []
}

const mergeTechnologies = (items: ProjectInsightTechnology[]): ProjectInsightTechnology[] => {
  const merged = new Map<string, ProjectInsightTechnology>()
  for (const item of items) {
    const key = `${item.category}:${item.name.toLowerCase()}`
    const existing = merged.get(key)
    if (existing) {
      existing.evidence = [...new Set([...existing.evidence, ...item.evidence])]
      if (!existing.version && item.version) existing.version = item.version
    } else merged.set(key, { ...item })
  }
  return [...merged.values()].sort((a, b) =>
    a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

const patternTechnologies = (filePath: string): ProjectInsightTechnology[] => {
  const path = filePath.toLowerCase()
  const name = basename(path)
  const result: ProjectInsightTechnology[] = []
  const add = (technologyName: string, category: ProjectInsightTechnology['category']): void => {
    result.push({
      name: technologyName, category, version: null, confidence: 'likely', evidence: [filePath],
    })
  }
  if (/^vite\.config\.[^.]+$/.test(name)) add('Vite', 'tool')
  if (/^electron\.vite\.config\.[^.]+$/.test(name)) add('Electron', 'framework')
  if (/^next\.config\.[^.]+$/.test(name)) add('Next.js', 'framework')
  if (/^nuxt\.config\.[^.]+$/.test(name)) add('Nuxt', 'framework')
  if (name === 'angular.json') add('Angular', 'framework')
  if (/^svelte\.config\.[^.]+$/.test(name)) add('SvelteKit', 'framework')
  if (/^vue\.config\.[^.]+$/.test(name)) add('Vue', 'framework')
  if (name === 'artisan') add('Laravel', 'framework')
  if (name === 'manage.py') add('Django', 'framework')
  if (name === 'dockerfile' || name.startsWith('docker-compose.')) add('Docker', 'tool')
  if (name === 'package-lock.json') add('npm', 'tool')
  if (name === 'yarn.lock') add('Yarn', 'tool')
  if (name === 'pnpm-lock.yaml') add('pnpm', 'tool')
  if (name === 'bun.lock' || name === 'bun.lockb') add('Bun', 'tool')
  if (path.startsWith('.github/workflows/')) add('GitHub Actions', 'tool')
  if (name === 'cmakelists.txt') add('CMake', 'tool')
  if (name === 'makefile') add('Make', 'tool')
  return result
}

const scanProject = async (path: unknown): Promise<ProjectInsightsResult> => {
  const startedAt = Date.now()
  const rootPath = await verifiedClonePath(path)
  const warnings: string[] = []
  const listed = await gitFiles(rootPath) ?? await walkedFiles(rootPath)
  const uniquePaths = [...new Set(listed.filter((filePath) =>
    !normalizePath(filePath).split('/').some((part) => excludedDirectories.has(part.toLowerCase())),
  ))].slice(0, MAX_FILES)
  if (listed.length > MAX_FILES) warnings.push(`Only the first ${MAX_FILES.toLocaleString()} files were scanned.`)
  const files: ProjectInsightFile[] = []
  const technologies: ProjectInsightTechnology[] = []
  const markers = new Map<string, Set<string>>()

  for (let offset = 0; offset < uniquePaths.length; offset += 40) {
    const batch = uniquePaths.slice(offset, offset + 40)
    await Promise.all(batch.map(async (filePath) => {
      const absolutePath = resolve(rootPath, filePath)
      if (!absolutePath.startsWith(`${rootPath}${sep}`) && absolutePath !== rootPath) return
      const details = await stat(absolutePath).catch(() => null)
      if (!details?.isFile()) return
      const extension = extname(filePath).toLowerCase()
      let language = languageByExtension[extension] ?? null
      let category = categoryFor(filePath, language)
      let stats = { lines: 0, codeLines: 0, commentLines: 0, blankLines: 0 }
      const canRead = !['asset', 'archive', 'binary'].includes(category) && details.size <= MAX_TEXT_BYTES
      if (canRead) {
        const buffer = await readFile(absolutePath).catch(() => null)
        if (buffer && buffer.subarray(0, 8_192).includes(0)) {
          category = 'binary'
        } else if (buffer) {
          const content = buffer.toString('utf8')
          if (!language && content.startsWith('#!')) {
            if (/\b(node|deno|bun)\b/i.test(content.slice(0, 160))) language = 'JavaScript'
            else if (/\bpython\d*\b/i.test(content.slice(0, 160))) language = 'Python'
            else if (/\b(bash|sh|zsh)\b/i.test(content.slice(0, 160))) language = 'Shell'
            if (language && category === 'text') category = 'source'
          }
          stats = lineStats(content, language)
          technologies.push(...manifestTechnologies(filePath, content))
        }
      } else if (details.size > MAX_TEXT_BYTES && !['asset', 'archive', 'binary'].includes(category)) {
        warnings.push(`Line analysis skipped for large file: ${filePath}`)
      }
      const name = basename(filePath).toLowerCase()
      technologies.push(...patternTechnologies(filePath))
      const marker = projectMarkerNames.has(name) || /\.(csproj|fsproj|vbproj)$/.test(name)
      if (marker) {
        const directory = normalizePath(dirname(filePath)) === '.' ? '.' : normalizePath(dirname(filePath))
        const current = markers.get(directory) ?? new Set<string>()
        current.add(basename(filePath))
        markers.set(directory, current)
      }
      files.push({
        path: normalizePath(filePath), extension: extension || '(none)', category, language,
        size: details.size, ...stats, projectPath: '.',
      })
    }))
  }

  const projectPaths = [...markers.keys()].sort((a, b) => b.length - a.length)
  for (const file of files) {
    file.projectPath = projectPaths.find((projectPath) =>
      projectPath === '.' || file.path.startsWith(`${projectPath}/`)) ?? '.'
  }
  const projects = [...markers.entries()].map(([projectPath, projectMarkers]) => {
    const scoped = files.filter((file) => file.projectPath === projectPath)
    return {
      path: projectPath,
      name: projectPath === '.' ? basename(rootPath) : basename(projectPath),
      markers: [...projectMarkers].sort(),
      files: scoped.length,
      lines: scoped.reduce((sum, file) => sum + file.lines, 0),
    }
  }).sort((a, b) => a.path.localeCompare(b.path))
  if (projects.length === 0) projects.push({
    path: '.', name: basename(rootPath), markers: [], files: files.length,
    lines: files.reduce((sum, file) => sum + file.lines, 0),
  })

  const languageMap = new Map<string, ProjectInsightLanguage>()
  for (const file of files) {
    if (!file.language) continue
    const summary = languageMap.get(file.language) ?? {
      name: file.language, files: 0, lines: 0, codeLines: 0, commentLines: 0, blankLines: 0,
    }
    summary.files += 1
    summary.lines += file.lines
    summary.codeLines += file.codeLines
    summary.commentLines += file.commentLines
    summary.blankLines += file.blankLines
    languageMap.set(file.language, summary)
  }
  const languages = [...languageMap.values()].sort((a, b) => b.codeLines - a.codeLines || b.files - a.files)
  const totals = files.reduce<ProjectInsightsResult['totals']>((total, file) => ({
    files: total.files + 1,
    textFiles: total.textFiles + (['source', 'text', 'config'].includes(file.category) ? 1 : 0),
    binaryFiles: total.binaryFiles + (['binary', 'archive'].includes(file.category) ? 1 : 0),
    assets: total.assets + (file.category === 'asset' ? 1 : 0),
    bytes: total.bytes + file.size,
    lines: total.lines + file.lines,
    codeLines: total.codeLines + file.codeLines,
    commentLines: total.commentLines + file.commentLines,
    blankLines: total.blankLines + file.blankLines,
  }), { files: 0, textFiles: 0, binaryFiles: 0, assets: 0, bytes: 0, lines: 0, codeLines: 0, commentLines: 0, blankLines: 0 })

  return {
    rootPath, scannedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
    files: files.sort((a, b) => a.path.localeCompare(b.path)), languages,
    technologies: mergeTechnologies(technologies), projects, totals,
    warnings: [...new Set(warnings)].slice(0, 100),
  }
}

export const registerProjectInsightHandlers = (): void => {
  ipcMain.handle('repositories:scan-insights', (_event, path: unknown) => scanProject(path))
}
