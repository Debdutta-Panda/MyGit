import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/basic-languages/monaco.contribution.js'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import type { SshMySqlSchemaColumn } from '../../shared/desktop-api'

const globalScope = self as typeof self & { MonacoEnvironment?: { getWorker: () => Worker } }
globalScope.MonacoEnvironment ??= { getWorker: () => new editorWorker() }

let configured = false
const configure = (): void => {
  if (configured) return
  configured = true
  monaco.editor.defineTheme('myrepos-sql', {
    base: 'vs-dark', inherit: true, rules: [],
    colors: {
      'editor.background': '#090f14', 'editor.foreground': '#cbd5df',
      'editorLineNumber.foreground': '#4f6170', 'editorLineNumber.activeForeground': '#b4c1cb',
      'editor.lineHighlightBackground': '#111a22', 'editor.selectionBackground': '#1d6b6288',
      'editorGutter.background': '#090f14', 'editorWidget.background': '#121b23', 'editorWidget.border': '#344550',
    },
  })
}

const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IN', 'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END']

export interface SqlMonacoHandle {
  selectionOrStatement: () => string
  all: () => string
  focus: () => void
  markError: (message: string) => void
  clearErrors: () => void
}

export const SqlMonaco = forwardRef<SqlMonacoHandle, {
  tabId: string
  value: string
  schema: SshMySqlSchemaColumn[]
  databases: string[]
  onChange: (value: string) => void
  onRunCurrent: () => void
  onRunAll: () => void
}>(function SqlMonaco({ tabId, value, schema, databases, onChange, onRunCurrent, onRunAll }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const applyingRef = useRef(false)
  const changeRef = useRef(onChange)
  const currentRef = useRef(onRunCurrent)
  const allRef = useRef(onRunAll)
  const schemaRef = useRef(schema)
  const databasesRef = useRef(databases)
  changeRef.current = onChange; currentRef.current = onRunCurrent; allRef.current = onRunAll
  schemaRef.current = schema; databasesRef.current = databases

  useImperativeHandle(ref, () => ({
    selectionOrStatement: () => {
      const editor = editorRef.current
      const model = editor?.getModel()
      if (!editor || !model) return ''
      const selection = editor.getSelection()
      if (selection && !selection.isEmpty()) return model.getValueInRange(selection)
      const position = editor.getPosition()
      if (!position) return model.getValue()
      const value = model.getValue()
      const offset = model.getOffsetAt(position)
      const start = value.lastIndexOf(';', Math.max(0, offset - 1)) + 1
      const next = value.indexOf(';', offset)
      return value.slice(start, next < 0 ? value.length : next + 1).trim()
    },
    all: () => editorRef.current?.getValue() ?? '',
    focus: () => editorRef.current?.focus(),
    markError: (message: string) => {
      const model = modelRef.current
      if (!model) return
      const line = Math.max(1, Math.min(model.getLineCount(), Number(message.match(/(?:at|on) line\s+(\d+)/i)?.[1] ?? 1)))
      const column = Math.max(1, Math.min(model.getLineMaxColumn(line), Number(message.match(/column\s+(\d+)/i)?.[1] ?? 1)))
      monaco.editor.setModelMarkers(model, 'mysql', [{ severity: monaco.MarkerSeverity.Error, message, startLineNumber: line, endLineNumber: line, startColumn: column, endColumn: model.getLineMaxColumn(line) }])
      editorRef.current?.revealLineInCenter(line)
    },
    clearErrors: () => { if (modelRef.current) monaco.editor.setModelMarkers(modelRef.current, 'mysql', []) },
  }), [])

  useEffect(() => {
    if (!containerRef.current) return
    configure()
    const editor = monaco.editor.create(containerRef.current, {
      theme: 'myrepos-sql', language: 'sql', automaticLayout: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 12.5, lineHeight: 20,
      lineNumbersMinChars: 3, glyphMargin: false, folding: true, minimap: { enabled: false }, overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true, renderWhitespace: 'selection', scrollBeyondLastLine: false, smoothScrolling: true,
      stickyScroll: { enabled: false }, padding: { top: 10, bottom: 16 }, wordWrap: 'off', contextmenu: true,
      suggest: { showKeywords: true, showFields: true, showStructs: true }, quickSuggestions: { other: true, comments: false, strings: false },
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => currentRef.current())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => allRef.current())
    const changes = editor.onDidChangeModelContent(() => { if (!applyingRef.current) changeRef.current(editor.getValue()) })
    const completion = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', '`'],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        const tables = Array.from(new Set(schemaRef.current.map((column) => column.table)))
        const suggestions: monaco.languages.CompletionItem[] = [
          ...keywords.map((keyword) => ({ label: keyword, kind: monaco.languages.CompletionItemKind.Keyword, insertText: keyword, range })),
          ...databasesRef.current.map((database) => ({ label: database, detail: 'Database', kind: monaco.languages.CompletionItemKind.Module, insertText: `\`${database}\``, range })),
          ...tables.map((table) => ({ label: table, detail: 'Table', kind: monaco.languages.CompletionItemKind.Struct, insertText: `\`${table}\``, range })),
          ...schemaRef.current.map((column) => ({ label: column.name, detail: `${column.table} · ${column.dataType}`, kind: monaco.languages.CompletionItemKind.Field, insertText: `\`${column.name}\``, range })),
        ]
        return { suggestions }
      },
    })
    editorRef.current = editor
    return () => { completion.dispose(); changes.dispose(); modelRef.current?.dispose(); editor.dispose(); editorRef.current = null; modelRef.current = null }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    modelRef.current?.dispose()
    applyingRef.current = true
    const model = monaco.editor.createModel(value, 'sql', monaco.Uri.parse(`inmemory://myrepos-sql/${tabId}.sql`))
    modelRef.current = model; editor.setModel(model); applyingRef.current = false; editor.focus()
  }, [tabId])

  useEffect(() => {
    const model = modelRef.current
    if (model && model.getValue() !== value) { applyingRef.current = true; model.setValue(value); applyingRef.current = false }
  }, [value])

  return <div className="ssh-sql-monaco" ref={containerRef} />
})
