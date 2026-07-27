import { ipcMain } from 'electron'
import { readEncounter, writeEncounter } from '../vault/initiativeStore'
import { parseEncounter, type Encounter } from '../../common/initiative'

export function registerInitiativeIpc(userDataDir: string): void {
  ipcMain.handle('initiative:read', async (): Promise<Encounter> => readEncounter(userDataDir))
  ipcMain.handle('initiative:write', async (_event, data: unknown): Promise<void> => {
    await writeEncounter(userDataDir, parseEncounter(data))
  })
}
