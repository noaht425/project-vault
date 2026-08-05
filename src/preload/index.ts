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
  VaultOpenResult,
  VaultSettings
} from '../common/types'
import type { GraphData } from '../common/graph'
import type { Encounter } from '../common/initiative'
import type {
  CloudBacklink,
  CloudEventSummary,
  CloudFolder,
  CloudGraphData,
  CloudNoteData,
  CloudSaveResult,
  CloudSearchResult,
  CloudSessionSummary,
  CloudSignUpResult,
  CloudTitleMatch,
  CloudTreeNode,
  CloudWorkspaceSettings
} from '../common/cloudTypes'
import type { SettlementBuilding, SettlementResident } from '../common/noteTypes/settlement'

const vaultApi = {
  openVault: (): Promise<VaultOpenResult | null> => ipcRenderer.invoke('vault:open'),
  getTree: (): Promise<TreeEntry[]> => ipcRenderer.invoke('vault:getTree'),
  getCurrentVault: (): Promise<VaultOpenResult | null> => ipcRenderer.invoke('vault:getCurrent'),
  getSettings: (): Promise<VaultSettings> => ipcRenderer.invoke('vault:getSettings'),
  updateSettings: (patch: Partial<VaultSettings>): Promise<VaultSettings> => ipcRenderer.invoke('vault:updateSettings', patch),

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

  getCurrentEncounter: (): Promise<Encounter> => ipcRenderer.invoke('initiative:read'),
  saveCurrentEncounter: (encounter: Encounter): Promise<void> => ipcRenderer.invoke('initiative:write', encounter),

  // Local Vault counterparts to cloudApi's pickAndUploadMapImage/
  // getMapImageUrl — see docs/plans/2026-08-04-cloud-to-local-copy.md
  // Phase 2/3. Same cancel-returns-null convention as openVault.
  pickAndSaveLocalImage: (): Promise<{ path: string } | null> => ipcRenderer.invoke('vault:pickAndSaveLocalImage'),
  getLocalImageUrl: (relativePath: string): Promise<string> => ipcRenderer.invoke('vault:getLocalImageUrl', relativePath),
  saveLocalImageBytes: (bytes: ArrayBuffer, suggestedName: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('vault:saveLocalImageBytes', bytes, suggestedName),

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

// Lets the main process ask the renderer to flush any pending autosave
// before the app actually quits (see main/index.ts's before-quit handler)
// — the renderer is the only place that knows whether a note is dirty.
const appApi = {
  onFlushBeforeQuit: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:flushBeforeQuit', listener)
    return () => ipcRenderer.removeListener('app:flushBeforeQuit', listener)
  },
  flushComplete: (): void => ipcRenderer.send('app:flushComplete'),
  cancelQuit: (): void => ipcRenderer.send('app:cancelQuit')
}

export type AppApi = typeof appApi

contextBridge.exposeInMainWorld('appApi', appApi)

// Proof-of-concept bridge to project-vault-cloud, kept entirely separate
// from vaultApi — the local vault's file-backed read/write path is
// untouched by this.
const cloudApi = {
  getSession: (): Promise<{ userId: string } | null> => ipcRenderer.invoke('cloud:getSession'),
  signIn: (email: string, password: string): Promise<{ userId: string }> =>
    ipcRenderer.invoke('cloud:signIn', { email, password }),
  signUp: (email: string, password: string): Promise<CloudSignUpResult> =>
    ipcRenderer.invoke('cloud:signUp', { email, password }),
  createNote: (args: {
    name: string
    folderId?: string | null
    frontmatter?: Record<string, unknown>
    body?: string
  }): Promise<CloudNoteData> => ipcRenderer.invoke('cloud:createNote', args),
  getNote: (id: string): Promise<CloudNoteData> => ipcRenderer.invoke('cloud:getNote', id),

  saveNote: (args: {
    id: string
    version: number
    name?: string
    folderId?: string | null
    frontmatter?: Record<string, unknown>
    body?: string
  }): Promise<CloudSaveResult> => ipcRenderer.invoke('cloud:saveNote', args),
  renameNote: (id: string, newName: string, version: number): Promise<CloudSaveResult> =>
    ipcRenderer.invoke('cloud:renameNote', { id, newName, version }),
  moveNote: (id: string, newFolderId: string | null, version: number): Promise<CloudSaveResult> =>
    ipcRenderer.invoke('cloud:moveNote', { id, newFolderId, version }),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke('cloud:deleteNote', id),
  createFolder: (name: string, parentId?: string | null): Promise<CloudFolder> =>
    ipcRenderer.invoke('cloud:createFolder', { name, parentId }),
  renameFolder: (id: string, newName: string): Promise<CloudFolder> =>
    ipcRenderer.invoke('cloud:renameFolder', { id, newName }),
  moveFolder: (id: string, newParentId: string | null): Promise<CloudFolder> =>
    ipcRenderer.invoke('cloud:moveFolder', { id, newParentId }),
  deleteFolder: (id: string): Promise<void> => ipcRenderer.invoke('cloud:deleteFolder', id),

  searchTitles: (query: string, type?: string): Promise<CloudTitleMatch[]> =>
    ipcRenderer.invoke('cloud:searchTitles', query, type),
  getBacklinks: (id: string): Promise<CloudBacklink[]> => ipcRenderer.invoke('cloud:getBacklinks', id),
  search: (query: string, type?: string): Promise<CloudSearchResult[]> =>
    ipcRenderer.invoke('cloud:search', query, type),
  getGraph: (): Promise<CloudGraphData> => ipcRenderer.invoke('cloud:getGraph'),

  listSessions: (): Promise<CloudSessionSummary[]> => ipcRenderer.invoke('cloud:listSessions'),
  listEvents: (): Promise<CloudEventSummary[]> => ipcRenderer.invoke('cloud:listEvents'),
  migrateDates: (): Promise<{ migrated: number; skipped: number }> => ipcRenderer.invoke('cloud:migrateDates'),
  getWorkspaceSettings: (): Promise<CloudWorkspaceSettings> => ipcRenderer.invoke('cloud:getWorkspaceSettings'),
  updateWorkspaceSettings: (patch: Partial<CloudWorkspaceSettings>): Promise<CloudWorkspaceSettings> =>
    ipcRenderer.invoke('cloud:updateWorkspaceSettings', patch),

  // getCachedTree resolves instantly with whatever's already known (may be
  // null); refreshTree always hits the network. onTreeUpdated fires
  // whenever a refresh (from this call or a future one) completes.
  getCachedTree: (): Promise<CloudTreeNode[] | null> => ipcRenderer.invoke('cloud:getCachedTree'),
  refreshTree: (): Promise<CloudTreeNode[]> => ipcRenderer.invoke('cloud:refreshTree'),

  // Opens a native file picker and uploads the chosen image to Supabase
  // Storage; null means the user cancelled the picker, matching vault:open's
  // existing cancel convention.
  pickAndUploadMapImage: (): Promise<{ path: string } | null> => ipcRenderer.invoke('cloud:pickAndUploadMapImage'),
  getMapImageUrl: (path: string): Promise<string> => ipcRenderer.invoke('cloud:getMapImageUrl', path),
  uploadLocalMapImage: (relativePath: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('cloud:uploadLocalMapImage', relativePath),

  uploadSettlementBulkData: (residents: SettlementResident[], buildings: SettlementBuilding[]): Promise<{ path: string }> =>
    ipcRenderer.invoke('cloud:uploadSettlementBulkData', { residents, buildings }),
  getSettlementBulkData: (path: string): Promise<{ residents: SettlementResident[]; buildings: SettlementBuilding[] }> =>
    ipcRenderer.invoke('cloud:getSettlementBulkData', path),

  onTreeUpdated: (callback: (tree: CloudTreeNode[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CloudTreeNode[]): void => callback(payload)
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
