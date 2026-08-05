import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { join, normalize, sep, extname } from 'node:path'
import { stat, readFile } from 'node:fs/promises'
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
import { registerInitiativeIpc } from './ipc/initiative'
import { registerCloudIpc } from './ipc/cloud'
import { CloudSession } from './cloud/cloudSession'
import type { ExternalChangeEvent, TreeEntry } from '../common/types'

let mainWindow: BrowserWindow | null = null
let session: VaultSession | null = null

// Serves Local Vault attachment images (Map images today — see
// docs/plans/2026-08-04-cloud-to-local-copy.md Phase 2/3) to the renderer.
// A custom scheme rather than a bare file:// URL because the renderer loads
// from http://localhost in dev (ELECTRON_RENDERER_URL) — a cross-origin
// file:// load there would hit webSecurity, whereas this is registered as
// its own privileged, fetchable scheme that works identically in dev and
// the packaged file:// build. Must be called before app.whenReady().
const ATTACHMENT_PROTOCOL = 'vault-attachment'
protocol.registerSchemesAsPrivileged([
  { scheme: ATTACHMENT_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

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

const ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

// Resolves a vault-attachment://attachment/<encoded relative path> request
// against whichever vault is currently open and returns the file's bytes
// with an explicit Content-Type. Originally used net.fetch(file://...) to
// reuse Chromium's own file:// handling, but that leaves Content-Type
// unset — the renderer has to MIME-sniff the response instead of being
// told what it is, which is exactly the kind of thing worth ruling out for
// a reported "image looks garbled" bug. A plain readFile + typed Response
// is the standard, more predictable pattern for serving local files from a
// custom Electron protocol handler. Rejects anything that would resolve
// outside the vault root (defensively unreachable today, since callers only
// ever pass back a path this app itself generated, but cheap to guard
// against a malformed/tampered URL).
async function handleAttachmentRequest(request: Request): Promise<Response> {
  const root = session?.getVaultRoot()
  if (!root) return new Response('No vault open', { status: 404 })

  const relativePath = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
  const normalizedRoot = normalize(root)
  const resolved = normalize(join(normalizedRoot, relativePath))
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    return new Response('Invalid attachment path', { status: 403 })
  }

  try {
    const bytes = await readFile(resolved)
    const contentType = ATTACHMENT_CONTENT_TYPES[extname(resolved).toLowerCase()] ?? 'application/octet-stream'
    return new Response(bytes, { headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.byteLength) } })
  } catch (err) {
    return new Response(`Failed to read attachment: ${err instanceof Error ? err.message : String(err)}`, { status: 404 })
  }
}

app.whenReady().then(async () => {
  protocol.handle(ATTACHMENT_PROTOCOL, handleAttachmentRequest)

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
  registerInitiativeIpc(userDataDir)

  const cloud = new CloudSession(userDataDir, {
    onTreeUpdated: (tree: unknown) => {
      mainWindow?.webContents.send('cloud:treeUpdated', tree)
    },
    onSessionRestored: (restoredSession: { userId: string } | null) => {
      mainWindow?.webContents.send('cloud:sessionRestored', restoredSession)
    }
  })
  registerCloudIpc(cloud, mainWindow, session)
  // Fire-and-forget, deliberately not awaited — unlike the vault reopen
  // above, a slow or failing network request here must never delay
  // showing the window (the window is already created and shown by now).
  void cloud.restore()

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

// A settlement/map note's frontmatter can be tens of megabytes (a large
// generated settlement) — parsing/serializing it is slow enough on the
// renderer's main thread that the normal 1.5s debounced autosave (see
// editorStore.ts/cloudEditorStore.ts) can still be pending when the app
// quits, silently discarding the last edit. Quitting now always asks the
// renderer to flush first and waits for it (bounded by a timeout in case
// the renderer is unresponsive), rather than trusting the debounce timer
// to have already fired.
let quitConfirmed = false

// Generous on purpose: the renderer can't even start processing this
// event until whatever synchronous work it was doing (e.g. the frontmatter
// stringify a Settlement Generate triggers — see common/frontmatter.ts's
// noRefs comment, ~1s at Metropolis scale after that fix, but slower
// machines or an even larger settlement could still take a few seconds)
// finishes and control returns to its event loop. A save landing a few
// seconds late is a vastly better outcome than the old short timeout
// forcing a quit before the flush ever got a chance to run.
const QUIT_FLUSH_TIMEOUT_MS = 30000

async function flushRendererAndQuit(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    quitConfirmed = true
    app.quit()
    return
  }

  const outcome = await new Promise<'done' | 'cancelled' | 'timeout'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), QUIT_FLUSH_TIMEOUT_MS)
    const onComplete = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('app:cancelQuit', onCancel)
      resolve('done')
    }
    const onCancel = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('app:flushComplete', onComplete)
      resolve('cancelled')
    }
    ipcMain.once('app:flushComplete', onComplete)
    ipcMain.once('app:cancelQuit', onCancel)
    mainWindow!.webContents.send('app:flushBeforeQuit')
  })

  if (outcome === 'cancelled') return // renderer had an unsaved note it couldn't save and the user chose not to quit

  await session?.closeVault()
  quitConfirmed = true
  app.quit()
}

app.on('before-quit', (event) => {
  if (quitConfirmed) return
  event.preventDefault()
  void flushRendererAndQuit()
})
