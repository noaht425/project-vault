import { ipcMain } from 'electron'
import { basename, join } from 'node:path'
import type { VaultSession } from '../vault/session'
import type { NoteData, NoteTemplate, SaveNoteRequest, SaveNoteResult } from '../../common/types'

export function registerNotesIpc(session: VaultSession): void {
  ipcMain.handle('notes:read', async (_event, path: string): Promise<NoteData> => session.readNote(path))

  ipcMain.handle(
    'notes:save',
    async (_event, req: SaveNoteRequest): Promise<SaveNoteResult> => session.saveNote(req)
  )

  ipcMain.handle(
    'notes:create',
    async (_event, args: { parentDir: string; name: string; template?: NoteTemplate }): Promise<NoteData> =>
      session.createNote(args.parentDir, args.name, args.template)
  )

  ipcMain.handle(
    'notes:rename',
    async (_event, args: { path: string; newName: string }): Promise<{ newPath: string }> =>
      session.renameNote(args.path, args.newName)
  )

  ipcMain.handle(
    'notes:move',
    async (_event, args: { path: string; newParentDir: string }): Promise<{ newPath: string }> =>
      session.movePath(args.path, join(args.newParentDir, basename(args.path)))
  )

  ipcMain.handle('notes:delete', async (_event, args: { path: string }): Promise<void> =>
    session.deleteNote(args.path)
  )

  ipcMain.handle(
    'folders:create',
    async (_event, args: { parentDir: string; name: string }): Promise<void> =>
      session.createFolder(args.parentDir, args.name)
  )
}
