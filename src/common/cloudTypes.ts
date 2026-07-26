// Shared between main, preload, and renderer for the cloud-backed API —
// kept separate from types.ts because cloud notes are Postgres rows
// identified by id, not files identified by path. See
// src/main/cloud/cloudSession.ts for the client that produces these.

export interface CloudNoteData {
  id: string
  name: string
  folderId: string | null
  frontmatter: Record<string, unknown>
  body: string
  noteType: string | null
  version: number
}

export type CloudSaveResult =
  | { status: 'saved'; note: CloudNoteData }
  | { status: 'conflict'; current: CloudNoteData }

export interface CloudFolder {
  id: string
  name: string
  parentId: string | null
}

export interface CloudTreeNode {
  id: string
  name: string
  isDirectory: boolean
  noteType?: string | null
  version?: number
  children?: CloudTreeNode[]
}

export interface CloudTitleMatch {
  id: string
  name: string
}

export interface CloudBacklink {
  sourceId: string
  sourceName: string
}

export interface CloudSearchResult {
  id: string
  name: string
  noteType: string | null
  snippet: string
}

export interface CloudGraphNode {
  id: string
  name: string
  noteType: string | null
}

export interface CloudGraphEdge {
  source: string
  target: string
}

export interface CloudGraphData {
  nodes: CloudGraphNode[]
  edges: CloudGraphEdge[]
}

export interface CloudSessionSummary {
  id: string
  name: string
  date: string
  summary: string
}

export interface CloudEventSummary {
  id: string
  name: string
  date: string
  summary: string
  noteType: string
}
