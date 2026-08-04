import { promises as fs } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface AtomicWriteResult {
  mtimeMs: number
}

/**
 * Writes `content` to `targetPath` without ever leaving a partially-written
 * file at that path. Writes to a temp file in the SAME directory (rename is
 * only atomic within one filesystem/volume — a temp file on a different
 * drive, e.g. os.tmpdir(), would lose that guarantee), fsyncs it, then
 * renames over the target.
 *
 * Best-effort only: fsync-before-rename reduces but does not eliminate risk
 * on sudden power loss, and cloud-synced folders (Dropbox/OneDrive/iCloud
 * Drive) can observe the temp file and rename as separate sync events,
 * which can break the atomicity guarantee entirely.
 */
export async function atomicWrite(targetPath: string, content: string | Buffer): Promise<AtomicWriteResult> {
  const dir = dirname(targetPath)
  const tmpPath = join(dir, `.${basename(targetPath)}.tmp-${randomBytes(6).toString('hex')}`)

  const handle = await fs.open(tmpPath, 'w')
  try {
    // The 'utf8' encoding is ignored by Node when content is already a
    // Buffer (e.g. cloudSessionStore.ts's encrypted refresh token) — safe
    // to pass unconditionally for both cases.
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await fs.rename(tmpPath, targetPath)
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {})
    throw err
  }

  // Best-effort directory fsync so the rename's directory-entry update is
  // flushed too. Not supported on Windows (opening a directory throws
  // EISDIR/EPERM) — that's an inherent platform gap, not a bug here.
  try {
    const dirHandle = await fs.open(dir, 'r')
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch {
    // best-effort — ignore on platforms/filesystems that don't support it
  }

  const stat = await fs.stat(targetPath)
  return { mtimeMs: stat.mtimeMs }
}
