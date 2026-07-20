import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { VaultSession } from './vault/session'
import { registerVaultIpc } from './ipc/vault'
import { registerNotesIpc } from './ipc/notes'
import { registerLinksIpc } from './ipc/links'
import { registerShellIpc } from './ipc/shell'
import { registerSessionsIpc } from './ipc/sessions'
import type { ExternalChangeEvent, TreeEntry } from '../common/types'

let mainWindow: BrowserWindow | null = null
let session: VaultSession | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => window.show())

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    window.loadURL(devServerUrl)
  } else {
    window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  mainWindow = createWindow()

  session = new VaultSession(app.getPath('userData'), {
    onExternalChange: (event: ExternalChangeEvent) => {
      mainWindow?.webContents.send('vault:externalChange', event)
    },
    onTreeUpdated: (tree: TreeEntry[]) => {
      mainWindow?.webContents.send('vault:treeUpdated', tree)
    }
  })

  registerVaultIpc(session, mainWindow)
  registerNotesIpc(session)
  registerLinksIpc(session)
  registerShellIpc()
  registerSessionsIpc(session)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  void session?.closeVault()
  if (process.platform !== 'darwin') app.quit()
})
