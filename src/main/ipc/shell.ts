import { ipcMain, shell } from 'electron'

export function registerShellIpc(): void {
  ipcMain.handle('shell:openExternal', async (_event, url: string): Promise<void> => {
    // Only ever hand http(s) URLs to the OS — never let arbitrary note
    // content trigger opening local files or other URL schemes.
    if (!/^https?:\/\//i.test(url)) return
    await shell.openExternal(url)
  })
}
