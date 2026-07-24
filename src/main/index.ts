import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { VaultSession } from './vault/session'
import { readLastVaultPath, writeLastVaultPath } from './vault/lastVault'
import { registerVaultIpc } from './ipc/vault'
import { registerNotesIpc } from './ipc/notes'
import { registerLinksIpc } from './ipc/links'
import { registerShellIpc } from './ipc/shell'
import { registerSessionsIpc } from './ipc/sessions'
import { registerEventsIpc } from './ipc/events'
import { registerSearchIpc } from './ipc/search'
import { registerGraphIpc } from './ipc/graph'
import { registerCloudIpc } from './ipc/cloud'
import { CloudSession } from './cloud/cloudSession'
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

app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData')

  session = new VaultSession(userDataDir, {
    onExternalChange: (event: ExternalChangeEvent) => {
      mainWindow?.webContents.send('vault:externalChange', event)
    },
    onTreeUpdated: (tree: TreeEntry[]) => {
      mainWindow?.webContents.send('vault:treeUpdated', tree)
    },
    onVaultOpened: (vaultPath: string) => {
      void writeLastVaultPath(userDataDir, vaultPath)
    }
  })

  // Reopen whatever vault was open last time, so the app doesn't start on
  // a blank "no vault" screen every launch. Done before the window loads
  // so the renderer's first getCurrentVault() call already sees it — no
  // dialog, and no race between the auto-open and the renderer mounting.
  const lastVaultPath = await readLastVaultPath(userDataDir)
  if (lastVaultPath) {
    const info = await stat(lastVaultPath).catch(() => null)
    if (info?.isDirectory()) {
      await session.openVault(lastVaultPath).catch((err: unknown) => {
        console.error('Failed to auto-reopen last vault:', err)
      })
    }
  }

  mainWindow = createWindow()

  registerVaultIpc(session, mainWindow)
  registerNotesIpc(session)
  registerLinksIpc(session)
  registerShellIpc()
  registerSessionsIpc(session)
  registerEventsIpc(session)
  registerSearchIpc(session)
  registerGraphIpc(session)
  registerCloudIpc(new CloudSession())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, closing the last window does not quit the app (standard Mac
  // behavior — think of a text editor with no documents open) — the vault
  // stays open in memory so reactivating (dock click) just needs a new
  // window, not a full reopen-from-disk. Only actually close the vault
  // (and quit) here on platforms where closing the window IS quitting.
  if (process.platform !== 'darwin') {
    void session?.closeVault()
    app.quit()
  }
})

app.on('before-quit', () => {
  void session?.closeVault()
})
