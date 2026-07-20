import { ipcMain } from 'electron'
import type { VaultSession } from '../vault/session'
import type { Backlink, NoteTitleMatch } from '../../common/types'

export function registerLinksIpc(session: VaultSession): void {
  ipcMain.handle(
    'links:search',
    async (_event, query: string, type?: string): Promise<NoteTitleMatch[]> => session.searchTitles(query, type)
  )

  ipcMain.handle(
    'links:backlinks',
    async (_event, path: string): Promise<Backlink[]> => session.getBacklinks(path)
  )
}
