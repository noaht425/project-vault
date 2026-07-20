import chokidar, { type FSWatcher } from 'chokidar'
import { readVersion } from './fileWriteQueue'
import type { ExternalChangeEvent } from '../../common/types'

const DEBOUNCE_MS = 300

export interface VaultWatcherHandlers {
  /** Last hash this app already knows about for `path`, if any (from the index). */
  getKnownHash(path: string): string | undefined
  onExternalChange(event: ExternalChangeEvent): void
}

export interface VaultWatcher {
  close(): Promise<void>
}

export function createVaultWatcher(vaultRoot: string, handlers: VaultWatcherHandlers): VaultWatcher {
  const timers = new Map<string, NodeJS.Timeout>()

  const schedule = (path: string, kind: ExternalChangeEvent['kind']): void => {
    const existing = timers.get(path)
    if (existing) clearTimeout(existing)
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path)
        void handleEvent(path, kind)
      }, DEBOUNCE_MS)
    )
  }

  const handleEvent = async (path: string, kind: ExternalChangeEvent['kind']): Promise<void> => {
    if (kind === 'unlink') {
      handlers.onExternalChange({ path, version: { mtimeMs: 0, contentHash: '' }, kind })
      return
    }

    const version = await readVersion(path)
    if (version === null) return // file disappeared again before we got to it

    const known = handlers.getKnownHash(path)
    if (known === version.contentHash) {
      // Echo of a write this app already made (or already indexed) — nothing to do.
      return
    }

    handlers.onExternalChange({ path, version, kind })
  }

  const watcher: FSWatcher = chokidar.watch(vaultRoot, {
    // Ignore our own atomic-write temp files (they're written as dotfiles,
    // see atomicWrite.ts) and any other dotfiles/dotfolders (.git, etc.)
    ignored: (path: string) => /(^|[/\\])\./.test(path.slice(vaultRoot.length))
  })

  watcher.on('add', (path) => schedule(path, 'add'))
  watcher.on('change', (path) => schedule(path, 'change'))
  watcher.on('unlink', (path) => schedule(path, 'unlink'))

  return {
    async close() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      await watcher.close()
    }
  }
}
