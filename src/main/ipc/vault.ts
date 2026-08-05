import { ipcMain, dialog, type BrowserWindow } from 'electron'
import type { VaultSession } from '../vault/session'
import type { VaultOpenResult, VaultSettings } from '../../common/types'

export function registerVaultIpc(session: VaultSession, window: BrowserWindow): void {
  ipcMain.handle('vault:open', async (): Promise<VaultOpenResult | null> => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Open or create a vault folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return session.openVault(result.filePaths[0])
  })

  ipcMain.handle('vault:getTree', async () => session.getTree())
  ipcMain.handle('vault:getCurrent', async (): Promise<VaultOpenResult | null> => session.getCurrentVault())

  ipcMain.handle('vault:getSettings', async (): Promise<VaultSettings> => session.getSettings())
  ipcMain.handle('vault:updateSettings', async (_event, patch: Partial<VaultSettings>): Promise<VaultSettings> =>
    session.updateSettings(patch)
  )

  // Local Vault counterpart to cloud:pickAndUploadMapImage — see
  // docs/plans/2026-08-04-cloud-to-local-copy.md Phase 2/3. Same cancel
  // convention (null) as vault:open above.
  ipcMain.handle('vault:pickAndSaveLocalImage', async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return session.saveLocalImage(result.filePaths[0])
  })

  // No dialog — for bytes the caller already has (the cloud-to-local
  // copier's downloaded Map image). See docs/plans/2026-08-04-cloud-to-
  // local-copy.md Phase 5.
  ipcMain.handle(
    'vault:saveLocalImageBytes',
    async (_event, bytes: ArrayBuffer, suggestedName: string): Promise<{ path: string }> =>
      session.saveLocalImageBytes(new Uint8Array(bytes), suggestedName)
  )

  // Builds a vault-attachment:// URL (see main/index.ts's protocol.handle
  // registration) rather than resolving straight to a file:// path here —
  // centralizes the URL scheme in one place and keeps parity with cloud's
  // getMapImageUrl, which is also an IPC round trip (there, a genuine
  // network call for a signed URL; here, just string-building, but the
  // renderer-side call shape stays identical either way).
  ipcMain.handle('vault:getLocalImageUrl', (_event, relativePath: string): string => {
    return `vault-attachment://attachment/${encodeURIComponent(relativePath)}`
  })
}
