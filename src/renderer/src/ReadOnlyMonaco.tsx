import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/basic-languages/monaco.contribution.js'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js'
import 'monaco-editor/editor/contrib/links/browser/links.js'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'

type WorkerConstructor = new () => Worker

const workerFor = (WorkerType: WorkerConstructor): Worker => new WorkerType()

const monacoGlobal = self as typeof self & {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker
  }
}

monacoGlobal.MonacoEnvironment = {
  getWorker: () => workerFor(editorWorker),
}

let monacoConfigured = false
let viewerSequence = 0

const configureMonaco = (): void => {
  if (monacoConfigured) return
  monacoConfigured = true
  monaco.editor.defineTheme('myrepos-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0e141a',
      'editor.foreground': '#cbd5df',
      'editorLineNumber.foreground': '#526171',
      'editorLineNumber.activeForeground': '#aebbc8',
      'editor.lineHighlightBackground': '#151e27',
      'editor.selectionBackground': '#245f82aa',
      'editor.inactiveSelectionBackground': '#24465c88',
      'editorIndentGuide.background1': '#26313b',
      'editorIndentGuide.activeBackground1': '#465565',
      'editorGutter.background': '#0e141a',
      'editorWidget.background': '#161e27',
      'editorWidget.border': '#34414e',
      'scrollbarSlider.background': '#56647466',
      'scrollbarSlider.hoverBackground': '#6b7a8b88',
      'scrollbarSlider.activeBackground': '#8392a499',
    },
  })
}

const exactLanguages: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  Jenkinsfile: 'groovy',
  'package.json': 'json',
  'package-lock.json': 'json',
  'tsconfig.json': 'jsonc',
  '.gitignore': 'plaintext',
  '.gitattributes': 'plaintext',
  '.editorconfig': 'ini',
}

const extensionLanguages: Record<string, string> = {
  bash: 'shell',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'plaintext',
  dart: 'dart',
  diff: 'diff',
  env: 'plaintext',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  prisma: 'graphql',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'scss',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  svelte: 'html',
  swift: 'swift',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  vue: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

const languageForFile = (path: string): string => {
  const name = path.split('/').at(-1) ?? path
  if (exactLanguages[name]) return exactLanguages[name]
  const extension = name.includes('.') ? name.split('.').at(-1)?.toLowerCase() ?? '' : ''
  return extensionLanguages[extension] ?? 'plaintext'
}

interface ReadOnlyMonacoProps {
  path: string
  value: string
  readOnly?: boolean
  onChange?: (value: string) => void
  onSave?: () => void
}

export function ReadOnlyMonaco({
  path,
  value,
  readOnly = true,
  onChange,
  onSave,
}: ReadOnlyMonacoProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const viewerIdRef = useRef<number | null>(null)
  const applyingValueRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  if (viewerIdRef.current === null) viewerIdRef.current = ++viewerSequence

  useEffect(() => {
    if (!containerRef.current) return
    configureMonaco()
    const editor = monaco.editor.create(containerRef.current, {
      theme: 'myrepos-dark',
      readOnly,
      domReadOnly: readOnly,
      automaticLayout: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 12.5,
      lineHeight: 20,
      lineNumbersMinChars: 3,
      folding: true,
      foldingHighlight: true,
      glyphMargin: false,
      minimap: {
        enabled: true,
        renderCharacters: false,
        maxColumn: 100,
        scale: 1,
      },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      renderValidationDecorations: 'off',
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      stickyScroll: { enabled: true, maxLineCount: 4 },
      padding: { top: 10, bottom: 18 },
      wordWrap: 'off',
      contextmenu: true,
      links: true,
      readOnlyMessage: { value: 'This file is read-only.' },
    })
    const changeListener = editor.onDidChangeModelContent(() => {
      if (!applyingValueRef.current) onChangeRef.current?.(editor.getValue())
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.())
    editorRef.current = editor
    return () => {
      changeListener.dispose()
      modelRef.current?.dispose()
      modelRef.current = null
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, domReadOnly: readOnly })
  }, [readOnly])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    modelRef.current?.dispose()
    applyingValueRef.current = true
    const model = monaco.editor.createModel(
      value,
      languageForFile(path),
      monaco.Uri.from({
        scheme: 'inmemory',
        authority: 'myrepos',
        path: `/${viewerIdRef.current}/${path}`,
      }),
    )
    modelRef.current = model
    editor.setModel(model)
    editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 })
    applyingValueRef.current = false
  }, [path])

  useEffect(() => {
    const model = modelRef.current
    if (model && model.getValue() !== value) {
      applyingValueRef.current = true
      model.setValue(value)
      applyingValueRef.current = false
    }
  }, [value])

  return <div className="working-tree-monaco" ref={containerRef} />
}
