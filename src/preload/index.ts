import { contextBridge, ipcRenderer } from 'electron'
import type {
  Backlink,
  ExternalChangeEvent,
  NoteData,
  NoteTemplate,
  NoteTitleMatch,
  SaveNoteRequest,
  SaveNoteResult,
  TreeEntry,
  VaultOpenResult
} from '../common/types'

const vaultApi = {
  openVault: (): Promise<VaultOpenResult | null> => ipcRenderer.invoke('vault:open'),
  getTree: (): Promise<TreeEntry[]> => ipcRenderer.invoke('vault:getTree'),

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

  searchTitles: (query: string): Promise<NoteTitleMatch[]> => ipcRenderer.invoke('links:search', query),
  getBacklinks: (path: string): Promise<Backlink[]> => ipcRenderer.invoke('links:backlinks', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

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
