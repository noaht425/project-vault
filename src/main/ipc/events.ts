import { ipcMain } from 'electron'
import type { VaultSession } from '../vault/session'
import type { EventSummary } from '../../common/types'

export function registerEventsIpc(session: VaultSession): void {
  ipcMain.handle('events:list', async (): Promise<EventSummary[]> => session.listEvents())
}
