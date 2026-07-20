import { ipcMain } from 'electron'
import type { VaultSession } from '../vault/session'
import type { SearchResult } from '../../common/types'

export function registerSearchIpc(session: VaultSession): void {
  ipcMain.handle(
    'search:fullText',
    async (_event, query: string, type?: string): Promise<SearchResult[]> => session.searchFullText(query, type)
  )
}
