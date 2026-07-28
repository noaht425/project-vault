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
}
