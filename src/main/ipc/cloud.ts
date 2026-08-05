import { ipcMain, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { CloudSession } from '../cloud/cloudSession'
import type { VaultSession } from '../vault/session'
import type { SettlementBuilding, SettlementResident } from '../../common/noteTypes/settlement'
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
} from '../../common/cloudTypes'

export function registerCloudIpc(cloud: CloudSession, window: BrowserWindow, vaultSession: VaultSession): void {
  ipcMain.handle('cloud:getSession', (): { userId: string } | null => cloud.getSession())

  ipcMain.handle(
    'cloud:signIn',
    async (_event, args: { email: string; password: string }): Promise<{ userId: string }> =>
      cloud.signIn(args.email, args.password)
  )

  ipcMain.handle(
    'cloud:signUp',
    async (_event, args: { email: string; password: string }): Promise<CloudSignUpResult> =>
      cloud.signUp(args.email, args.password)
  )

  ipcMain.handle(
    'cloud:createNote',
    async (
      _event,
      args: { name: string; folderId?: string | null; frontmatter?: Record<string, unknown>; body?: string }
    ): Promise<CloudNoteData> => cloud.createNote(args)
  )

  ipcMain.handle('cloud:getNote', async (_event, id: string): Promise<CloudNoteData> => cloud.getNote(id))

  ipcMain.handle(
    'cloud:saveNote',
    async (
      _event,
      args: {
        id: string
        version: number
        name?: string
        folderId?: string | null
        frontmatter?: Record<string, unknown>
        body?: string
      }
    ): Promise<CloudSaveResult> => {
      const { id, ...req } = args
      return cloud.saveNote(id, req)
    }
  )

  ipcMain.handle(
    'cloud:renameNote',
    async (_event, args: { id: string; newName: string; version: number }): Promise<CloudSaveResult> =>
      cloud.renameNote(args.id, args.newName, args.version)
  )

  ipcMain.handle(
    'cloud:moveNote',
    async (_event, args: { id: string; newFolderId: string | null; version: number }): Promise<CloudSaveResult> =>
      cloud.moveNote(args.id, args.newFolderId, args.version)
  )

  ipcMain.handle('cloud:deleteNote', async (_event, id: string): Promise<void> => cloud.deleteNote(id))

  ipcMain.handle(
    'cloud:createFolder',
    async (_event, args: { name: string; parentId?: string | null }): Promise<CloudFolder> =>
      cloud.createFolder(args.name, args.parentId ?? null)
  )

  ipcMain.handle(
    'cloud:renameFolder',
    async (_event, args: { id: string; newName: string }): Promise<CloudFolder> =>
      cloud.renameFolder(args.id, args.newName)
  )

  ipcMain.handle(
    'cloud:moveFolder',
    async (_event, args: { id: string; newParentId: string | null }): Promise<CloudFolder> =>
      cloud.moveFolder(args.id, args.newParentId)
  )

  ipcMain.handle('cloud:deleteFolder', async (_event, id: string): Promise<void> => cloud.deleteFolder(id))

  ipcMain.handle(
    'cloud:searchTitles',
    async (_event, query: string, type?: string): Promise<CloudTitleMatch[]> => cloud.searchTitles(query, type)
  )

  ipcMain.handle(
    'cloud:getBacklinks',
    async (_event, id: string): Promise<CloudBacklink[]> => cloud.getBacklinks(id)
  )

  ipcMain.handle(
    'cloud:search',
    async (_event, query: string, type?: string): Promise<CloudSearchResult[]> => cloud.search(query, type)
  )

  ipcMain.handle('cloud:getGraph', async (): Promise<CloudGraphData> => cloud.getGraph())

  ipcMain.handle('cloud:listSessions', async (): Promise<CloudSessionSummary[]> => cloud.listSessions())
  ipcMain.handle('cloud:listEvents', async (): Promise<CloudEventSummary[]> => cloud.listEvents())
  ipcMain.handle('cloud:migrateDates', async (): Promise<{ migrated: number; skipped: number }> => cloud.migrateDates())

  ipcMain.handle('cloud:getWorkspaceSettings', async (): Promise<CloudWorkspaceSettings> => cloud.getWorkspaceSettings())
  ipcMain.handle(
    'cloud:updateWorkspaceSettings',
    async (_event, patch: Partial<CloudWorkspaceSettings>): Promise<CloudWorkspaceSettings> =>
      cloud.updateWorkspaceSettings(patch)
  )

  ipcMain.handle('cloud:getCachedTree', (): CloudTreeNode[] | null => cloud.getCachedTree())
  ipcMain.handle('cloud:refreshTree', async (): Promise<CloudTreeNode[]> => cloud.refreshTree())

  ipcMain.handle('cloud:pickAndUploadMapImage', async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a map image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return cloud.uploadMapImage(result.filePaths[0])
  })

  ipcMain.handle('cloud:getMapImageUrl', async (_event, path: string): Promise<string> => cloud.getMapImageUrl(path))

  // For the cloud-to-local copier — see CloudSession.downloadMapImage's own
  // comment for why this exists alongside getMapImageUrl rather than
  // reusing it (CORS blocks the renderer's own fetch() of the signed URL).
  ipcMain.handle('cloud:downloadMapImage', async (_event, path: string): Promise<ArrayBuffer> => {
    const buffer = await cloud.downloadMapImage(path)
    // A fresh copy into a plain Uint8Array rather than slicing buffer.buffer
    // directly — Buffer.buffer is typed ArrayBufferLike (it could in theory
    // be a SharedArrayBuffer), and the IPC return type here needs a real
    // ArrayBuffer.
    const copy = new Uint8Array(buffer.byteLength)
    copy.set(buffer)
    return copy.buffer
  })

  // No dialog, unlike pickAndUploadMapImage above — for the local-to-cloud
  // copier uploading a Map note's already-known local image (see
  // docs/plans/2026-08-04-cloud-to-local-copy.md Phase 6). Resolves the
  // vault-root-relative path against whatever vault is currently open,
  // mirroring how the vault-attachment:// protocol handler (main/index.ts)
  // resolves the same kind of path for local display.
  ipcMain.handle('cloud:uploadLocalMapImage', async (_event, relativePath: string): Promise<{ path: string }> => {
    const root = vaultSession.getVaultRoot()
    if (!root) throw new Error('No vault open')
    return cloud.uploadMapImage(join(root, relativePath))
  })

  ipcMain.handle(
    'cloud:uploadSettlementBulkData',
    async (
      _event,
      args: { residents: SettlementResident[]; buildings: SettlementBuilding[] }
    ): Promise<{ path: string }> => cloud.uploadSettlementBulkData(args.residents, args.buildings)
  )

  ipcMain.handle(
    'cloud:getSettlementBulkData',
    async (_event, path: string): Promise<{ residents: SettlementResident[]; buildings: SettlementBuilding[] }> =>
      cloud.getSettlementBulkData(path)
  )
}
