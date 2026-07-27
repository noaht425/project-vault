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

export type NoteTemplate =
  | 'note'
  | 'pc'
  | 'npc'
  | 'class-reference'
  | 'session'
  | 'event'
  | 'faction'
  | 'item'
  | 'location'
  | 'language'
  | 'family-tree'

export interface NoteTitleMatch {
  path: string
  title: string
}

export interface Backlink {
  sourcePath: string
  sourceTitle: string
}

export interface SessionSummary {
  path: string
  title: string
  date: string
  summary: string
}

export interface EventSummary {
  path: string
  title: string
  date: string
  summary: string
  // The source note's own type ('event', 'npc', 'location', ...) — lets the
  // Events timeline show entries pulled from other notes' History sections
  // distinctly from dedicated Event notes.
  noteType: string
  // Only ever set for noteType === 'event' entries (a location note's
  // title, from that note's own `location` field) — History-section-derived
  // facts have no such concept. Used by the Map×Timeline crossover to match
  // an event to a pin on a given map.
  location?: string | null
}

export interface SearchResult {
  path: string
  title: string
  type: string
  snippet: string // titled/bodied text with SNIPPET_MATCH_START/END markers around matches (see common/searchSnippet.ts)
}
