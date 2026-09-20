import type { CommandSnippetTag } from './CommandSnippetTemplate'

export interface SshSavedCommandTemplate {
  id: string
  name: string
  template: string
  updatedAt: string
  variableTypes?: Record<string, CommandSnippetTag>
}
export type SshSavedSnippet = SshSavedCommandTemplate
export type SshSavedScript = SshSavedCommandTemplate

export type SshCommandTemplateKind = 'snippets' | 'scripts'

const storageKey = (connectionId: string, kind: SshCommandTemplateKind): string =>
  `myrepos:ssh-${kind}:${connectionId}`

export const sshSnippetStorageKey = (connectionId: string): string =>
  storageKey(connectionId, 'snippets')

export const readSshCommandTemplates = (connectionId: string, kind: SshCommandTemplateKind): SshSavedCommandTemplate[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(connectionId, kind)) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is SshSavedCommandTemplate =>
      Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item && 'template' in item)) : []
  } catch {
    return []
  }
}

export const readSshSnippets = (connectionId: string): SshSavedSnippet[] =>
  readSshCommandTemplates(connectionId, 'snippets')

export const writeSshSnippets = (connectionId: string, snippets: SshSavedSnippet[]): void => {
  localStorage.setItem(storageKey(connectionId, 'snippets'), JSON.stringify(snippets))
}

export const readSshScripts = (connectionId: string): SshSavedScript[] =>
  readSshCommandTemplates(connectionId, 'scripts')

export const writeSshScripts = (connectionId: string, scripts: SshSavedScript[]): void => {
  localStorage.setItem(storageKey(connectionId, 'scripts'), JSON.stringify(scripts))
}
