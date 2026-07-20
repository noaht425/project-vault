// Shared between main, preload, and renderer. Keep this file free of
// Electron- or Node-specific imports so it stays usable everywhere.

export interface FileVersion {
  mtimeMs: number
  contentHash: string
}

export interface TreeEntry {
  path: string // absolute path
  name: string
  isDirectory: boolean
  children?: TreeEntry[]
}

export interface NoteData {
  path: string
  content: string // full file content including frontmatter block
  version: FileVersion
}

export interface SaveNoteRequest {
  path: string
  content: string
  baseVersion: FileVersion | null // null = creating a new file
}

export type SaveNoteResult =
  | { status: 'saved'; version: FileVersion }
  | { status: 'conflict'; conflictPath: string; diskVersion: FileVersion }

export interface ExternalChangeEvent {
  path: string
  version: FileVersion
  kind: 'change' | 'add' | 'unlink'
}

export interface VaultOpenResult {
  vaultPath: string
  tree: TreeEntry[]
}

export type NoteTemplate = 'note' | 'pc' | 'npc'

export interface NoteTitleMatch {
  path: string
  title: string
}

export interface Backlink {
  sourcePath: string
  sourceTitle: string
}
