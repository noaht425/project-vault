import { promises as fs } from 'node:fs'
import { dirname, join, basename, extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicWrite } from './atomicWrite'
import { hashContent } from './hash'
import type { FileVersion, SaveNoteResult } from '../../common/types'

interface ErrnoException extends Error {
  code?: string
}

/**
 * Direct (unlocked) reads. Because writes only ever become visible via an
 * atomic rename (see atomicWrite.ts), a concurrent read can only ever see
 * a fully-old or fully-new file — never a torn/partial one. So reads don't
 * need to go through the write queue below; only writes to the same path
 * need to be serialized against each other.
 */
export async function readVersion(path: string): Promise<FileVersion | null> {
  try {
    const content = await fs.readFile(path, 'utf8')
    const stat = await fs.stat(path)
    return { mtimeMs: stat.mtimeMs, contentHash: hashContent(content) }
  } catch (err) {
    if ((err as ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function readNote(path: string): Promise<{ content: string; version: FileVersion }> {
  const content = await fs.readFile(path, 'utf8')
  const stat = await fs.stat(path)
  return { content, version: { mtimeMs: stat.mtimeMs, contentHash: hashContent(content) } }
}

function conflictPathFor(path: string): string {
  const dir = dirname(path)
  const ext = extname(path)
  const base = basename(path, ext)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  // Timestamp alone is only millisecond-resolution — two conflicts landing
  // in the same millisecond would otherwise collide and clobber each other,
  // which is exactly the silent-data-loss failure mode this exists to avoid.
  const unique = randomBytes(3).toString('hex')
  return join(dir, `${base}-conflict-${timestamp}-${unique}${ext}`)
}

function versionsMatch(a: FileVersion, b: FileVersion): boolean {
  return a.mtimeMs === b.mtimeMs && a.contentHash === b.contentHash
}

/**
 * Single-writer-per-path queue. Guards against the in-app autosave firing
 * again before a previous save finished, or any other two write attempts
 * to the same path overlapping. This is a same-process lock only — it
 * cannot stop an external program from writing to the file, which is
 * exactly why saveFile() also does an optimistic-concurrency check
 * (compare baseVersion to what's actually on disk) rather than relying on
 * locking alone.
 */
class FileWriteQueue {
  private queues = new Map<string, Promise<unknown>>()

  private enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(path) ?? Promise.resolve()
    const run = prev.then(task, task)
    // Chain continuation must never reject, or the next enqueue on this
    // path would inherit a rejected promise and fail immediately.
    this.queues.set(
      path,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
  }

  async saveFile(
    path: string,
    content: string,
    baseVersion: FileVersion | null
  ): Promise<SaveNoteResult> {
    return this.enqueue(path, async () => {
      const diskVersion = await readVersion(path)

      const safeToWrite =
        diskVersion === null
          ? baseVersion === null // both agree the file doesn't exist yet
          : baseVersion !== null && versionsMatch(diskVersion, baseVersion)

      if (!safeToWrite) {
        const conflictPath = conflictPathFor(path)
        await atomicWrite(conflictPath, content)
        return {
          status: 'conflict',
          conflictPath,
          diskVersion: diskVersion ?? { mtimeMs: 0, contentHash: hashContent('') }
        }
      }

      const { mtimeMs } = await atomicWrite(path, content)
      return { status: 'saved', version: { mtimeMs, contentHash: hashContent(content) } }
    })
  }
}

export const fileWriteQueue = new FileWriteQueue()
export { FileWriteQueue }
