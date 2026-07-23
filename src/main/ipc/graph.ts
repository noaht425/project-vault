import { ipcMain } from 'electron'
import type { VaultSession } from '../vault/session'
import type { GraphData } from '../../common/graph'

export function registerGraphIpc(session: VaultSession): void {
  ipcMain.handle('graph:get', async (): Promise<GraphData> => session.getGraph())
}
