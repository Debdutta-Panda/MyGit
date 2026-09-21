export type ApacheConfigNodeKind = 'blank' | 'comment' | 'directive' | 'block-open' | 'block-close' | 'unknown'
export type ApacheDirectiveValueKind = 'text' | 'path' | 'number' | 'boolean' | 'list'

export interface ApacheConfigNode {
  id: string
  kind: ApacheConfigNodeKind
  line: number
  raw: string
  name: string | null
  value: string
  context: string[]
  recognized: boolean
  valueKind: ApacheDirectiveValueKind
  prefix: string
  suffix: string
}

export interface ApacheConfigDiagnostic {
  line: number
  level: 'warning' | 'error'
  message: string
}

export interface ApacheConfigDocument {
  nodes: ApacheConfigNode[]
  diagnostics: ApacheConfigDiagnostic[]
  recognizedCount: number
  unknownCount: number
}

const directiveKinds: Record<string, ApacheDirectiveValueKind> = {
  serverroot: 'path', servername: 'text', serveralias: 'list', serveradmin: 'text', documentroot: 'path',
  listen: 'text', timeout: 'number', keepalive: 'boolean', maxkeepaliverequests: 'number', keepalivetimeout: 'number',
  errorlog: 'path', customlog: 'text', loglevel: 'text', directoryindex: 'list', include: 'path', includeoptional: 'path',
  loadmodule: 'text', options: 'list', allowoverride: 'text', require: 'text', allow: 'text', deny: 'text', order: 'text',
  redirect: 'text', redirectmatch: 'text', rewriteengine: 'boolean', rewritecond: 'text', rewriterule: 'text',
  proxypass: 'text', proxypassreverse: 'text', proxyrequests: 'boolean', requestheader: 'text', header: 'text',
  sslengine: 'boolean', sslcertificatefile: 'path', sslcertificatekeyfile: 'path', sslcertificatechainfile: 'path',
  sslprotocol: 'list', sslciphersuite: 'text', protocols: 'list', sethandler: 'text', addhandler: 'text',
  addtype: 'text', typesconfig: 'path', accessfilename: 'text', user: 'text', group: 'text', pidfile: 'path',
}

const inlineCommentIndex = (value: string): number => {
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) { escaped = false; continue }
    if (character === '\\') { escaped = true; continue }
    if (quote) { if (character === quote) quote = null; continue }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '#' && (index === 0 || /\s/.test(value[index - 1]))) return index
  }
  return -1
}

export const parseApacheConfiguration = (source: string): ApacheConfigDocument => {
  const nodes: ApacheConfigNode[] = []
  const diagnostics: ApacheConfigDiagnostic[] = []
  const contexts: Array<{ name: string; line: number }> = []
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = index + 1
    const trimmed = raw.trim()
    const base = { id: `line-${line}`, line, raw, context: contexts.map((item) => item.name), prefix: '', suffix: '', value: '', name: null }
    if (!trimmed) { nodes.push({ ...base, kind: 'blank', recognized: true, valueKind: 'text' }); continue }
    if (trimmed.startsWith('#')) { nodes.push({ ...base, kind: 'comment', recognized: true, valueKind: 'text' }); continue }
    const closing = trimmed.match(/^<\/\s*([A-Za-z][\w:-]*)\s*>\s*(?:#.*)?$/)
    if (closing) {
      const expected = contexts.at(-1)
      if (!expected || expected.name.toLowerCase() !== closing[1].toLowerCase()) {
        diagnostics.push({ line, level: 'error', message: `Unexpected closing block </${closing[1]}>.` })
      } else contexts.pop()
      nodes.push({ ...base, kind: 'block-close', name: closing[1], recognized: true, valueKind: 'text' })
      continue
    }
    const opening = trimmed.match(/^<\s*([A-Za-z][\w:-]*)\b(.*?)>\s*(?:#.*)?$/)
    if (opening) {
      nodes.push({ ...base, kind: 'block-open', name: opening[1], value: opening[2].trim(), recognized: true, valueKind: 'text' })
      contexts.push({ name: opening[1], line })
      continue
    }
    const directive = raw.match(/^(\s*)([A-Za-z][\w:-]*)(\s+)(.*)$/)
    if (directive) {
      const [, indentation, name, spacing, remainder] = directive
      const commentAt = inlineCommentIndex(remainder)
      const valuePart = commentAt >= 0 ? remainder.slice(0, commentAt) : remainder
      const trailingLength = valuePart.length - valuePart.trimEnd().length
      const value = valuePart.trimEnd()
      const suffix = `${' '.repeat(trailingLength)}${commentAt >= 0 ? remainder.slice(commentAt) : ''}`
      const valueKind = directiveKinds[name.toLowerCase()] ?? 'text'
      nodes.push({ ...base, kind: 'directive', name, value, prefix: `${indentation}${name}${spacing}`, suffix,
        recognized: Object.hasOwn(directiveKinds, name.toLowerCase()), valueKind })
      continue
    }
    nodes.push({ ...base, kind: 'unknown', recognized: false, valueKind: 'text' })
    diagnostics.push({ line, level: 'warning', message: 'This line is preserved but is not structurally recognized.' })
  }
  for (const context of contexts) diagnostics.push({ line: context.line, level: 'error', message: `Block <${context.name}> is not closed in this file.` })
  return {
    nodes,
    diagnostics,
    recognizedCount: nodes.filter((node) => node.kind === 'directive' && node.recognized).length,
    unknownCount: nodes.filter((node) => (node.kind === 'directive' && !node.recognized) || node.kind === 'unknown').length,
  }
}

export const updateApacheDirective = (source: string, node: ApacheConfigNode, value: string): string => {
  if (value.includes('\n') || value.includes('\r')) return source
  const lines = source.split(/\r?\n/)
  if (lines[node.line - 1] !== node.raw || node.kind !== 'directive') return source
  lines[node.line - 1] = `${node.prefix}${value}${node.suffix}`
  return lines.join(source.includes('\r\n') ? '\r\n' : '\n')
}
