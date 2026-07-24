import { contextBridge, ipcRenderer } from 'electron'
import type {
  Backlink,
  EventSummary,
  ExternalChangeEvent,
  NoteData,
  NoteTemplate,
  NoteTitleMatch,
  SaveNoteRequest,
  SaveNoteResult,
  SearchResult,
  SessionSummary,
  TreeEntry,
  VaultOpenResult
} from '../common/types'
import type { GraphData } from '../common/graph'

const vaultApi = {
  openVault: (): Promise<VaultOpenResult | null> => ipcRenderer.invoke('vault:open'),
  getTree: (): Promise<TreeEntry[]> => ipcRenderer.invoke('vault:getTree'),
  getCurrentVault: (): Promise<VaultOpenResult | null> => ipcRenderer.invoke('vault:getCurrent'),

  readNote: (path: string): Promise<NoteData> => ipcRenderer.invoke('notes:read', path),
  saveNote: (req: SaveNoteRequest): Promise<SaveNoteResult> => ipcRenderer.invoke('notes:save', req),
  createNote: (parentDir: string, name: string, template?: NoteTemplate): Promise<NoteData> =>
    ipcRenderer.invoke('notes:create', { parentDir, name, template }),
  renameNote: (path: string, newName: string): Promise<{ newPath: string }> =>
    ipcRenderer.invoke('notes:rename', { path, newName }),
  moveNote: (path: string, newParentDir: string): Promise<{ newPath: string }> =>
    ipcRenderer.invoke('notes:move', { path, newParentDir }),
  deleteNote: (path: string): Promise<void> => ipcRenderer.invoke('notes:delete', { path }),
  createFolder: (parentDir: string, name: string): Promise<void> =>
    ipcRenderer.invoke('folders:create', { parentDir, name }),

  searchTitles: (query: string, type?: string): Promise<NoteTitleMatch[]> =>
    ipcRenderer.invoke('links:search', query, type),
  getBacklinks: (path: string): Promise<Backlink[]> => ipcRenderer.invoke('links:backlinks', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  listSessions: (): Promise<SessionSummary[]> => ipcRenderer.invoke('sessions:list'),
  listEvents: (): Promise<EventSummary[]> => ipcRenderer.invoke('events:list'),
  search: (query: string, type?: string): Promise<SearchResult[]> =>
    ipcRenderer.invoke('search:fullText', query, type),
  getGraph: (): Promise<GraphData> => ipcRenderer.invoke('graph:get'),

  onExternalChange: (callback: (event: ExternalChangeEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ExternalChangeEvent): void =>
      callback(payload)
    ipcRenderer.on('vault:externalChange', listener)
    return () => ipcRenderer.removeListener('vault:externalChange', listener)
  },

  onTreeUpdated: (callback: (tree: TreeEntry[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TreeEntry[]): void => callback(payload)
    ipcRenderer.on('vault:treeUpdated', listener)
    return () => ipcRenderer.removeListener('vault:treeUpdated', listener)
  }
}

export type VaultApi = typeof vaultApi

contextBridge.exposeInMainWorld('vaultApi', vaultApi)

// Proof-of-concept bridge to project-vault-cloud, kept entirely separate
// from vaultApi — the local vault's file-backed read/write path is
// untouched by this.
const cloudApi = {
  getSession: (): Promise<{ userId: string } | null> => ipcRenderer.invoke('cloud:getSession'),
  signIn: (email: string, password: string): Promise<{ userId: string }> =>
    ipcRenderer.invoke('cloud:signIn', { email, password }),
  createNote: (args: { name: string; frontmatter?: Record<string, unknown>; body?: string }): Promise<unknown> =>
    ipcRenderer.invoke('cloud:createNote', args),
  getNote: (id: string): Promise<unknown> => ipcRenderer.invoke('cloud:getNote', id),

  // getCachedTree resolves instantly with whatever's already known (may be
  // null); refreshTree always hits the network. onTreeUpdated fires
  // whenever a refresh (from this call or a future one) completes.
  getCachedTree: (): Promise<unknown> => ipcRenderer.invoke('cloud:getCachedTree'),
  refreshTree: (): Promise<unknown> => ipcRenderer.invoke('cloud:refreshTree'),

  onTreeUpdated: (callback: (tree: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on('cloud:treeUpdated', listener)
    return () => ipcRenderer.removeListener('cloud:treeUpdated', listener)
  },

  onSessionRestored: (callback: (session: { userId: string } | null) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { userId: string } | null): void =>
      callback(payload)
    ipcRenderer.on('cloud:sessionRestored', listener)
    return () => ipcRenderer.removeListener('cloud:sessionRestored', listener)
  }
}

export type CloudApi = typeof cloudApi

contextBridge.exposeInMainWorld('cloudApi', cloudApi)
