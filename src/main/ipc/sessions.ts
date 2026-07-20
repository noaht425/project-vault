import { ipcMain } from 'electron'
import type { VaultSession } from '../vault/session'
import type { SessionSummary } from '../../common/types'

export function registerSessionsIpc(session: VaultSession): void {
  ipcMain.handle('sessions:list', async (): Promise<SessionSummary[]> => session.listSessions())
}
