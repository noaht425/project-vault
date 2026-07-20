import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileWriteQueue, readVersion } from '../src/main/vault/fileWriteQueue'
import type { FileVersion, SaveNoteResult } from '../src/common/types'

const dirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'vault-race-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('FileWriteQueue race conditions', () => {
  it('serializes concurrent app saves to the same path without corrupting the file', async () => {
    const dir = await makeTmpDir()
    const target = join(dir, 'note.md')
    await fs.writeFile(target, 'start\n', 'utf8')

    const queue = new FileWriteQueue()
    const baseVersion = await readVersion(target)

    const N = 12
    const contents = Array.from({ length: N }, (_, i) => `concurrent-save-${i}\n`)
    const results = await Promise.all(contents.map((c) => queue.saveFile(target, c, baseVersion)))

    const saved = results.filter((r) => r.status === 'saved')
    const conflicts = results.filter((r) => r.status === 'conflict')

    // Exactly one save can win against a shared baseVersion. Every other
    // concurrent attempt must detect the disk changed out from under it and
    // produce a conflict copy instead of silently clobbering the winner.
    expect(saved.length).toBe(1)
    expect(conflicts.length).toBe(N - 1)

    const finalContent = await fs.readFile(target, 'utf8')
    expect(contents).toContain(finalContent) // exactly one full write, never torn/mixed

    const filesInDir = await fs.readdir(dir)
    expect(filesInDir.filter((f) => f.includes('-conflict-')).length).toBe(N - 1)
    expect(filesInDir.some((f) => f.includes('.tmp-'))).toBe(false)

    // Every conflict file must contain exactly the content that lost the race —
    // proving nothing was silently dropped.
    for (const result of conflicts) {
      if (result.status !== 'conflict') continue
      const conflictContent = await fs.readFile(result.conflictPath, 'utf8')
      expect(contents).toContain(conflictContent)
    }
  })

  it('never loses data under interleaved in-app saves and external (non-atomic) edits', async () => {
    const dir = await makeTmpDir()
    const target = join(dir, 'note.md')
    await fs.writeFile(target, 'initial\n', 'utf8')

    const queue = new FileWriteQueue()
    let baseVersion: FileVersion | null = await readVersion(target)

    const APP_SAVES = 25
    const EXTERNAL_EDITS = 20

    const appWrites: string[] = []
    const externalWrites: string[] = ['initial\n']
    const saveResults: { content: string; result: SaveNoteResult }[] = []

    // Simulated in-app editor: debounced autosave firing roughly every few ms,
    // occasionally "noticing" a conflict banner and reloading before continuing.
    const appTask = (async (): Promise<void> => {
      for (let i = 0; i < APP_SAVES; i++) {
        await delay(Math.random() * 6)
        const content = `app-write-${i}\n`
        appWrites.push(content)
        const result = await queue.saveFile(target, content, baseVersion)
        saveResults.push({ content, result })
        if (result.status === 'saved') {
          baseVersion = result.version
        } else if (i % 4 === 3) {
          // user sees the conflict banner and reloads before their next edit
          baseVersion = await readVersion(target)
        }
      }
    })()

    // Simulated external program (e.g. another editor) writing directly to
    // the same path, non-atomically, concurrently with the app above.
    const externalTask = (async (): Promise<void> => {
      for (let j = 0; j < EXTERNAL_EDITS; j++) {
        await delay(Math.random() * 6)
        const content = `external-edit-${j}\n`
        externalWrites.push(content)
        await fs.writeFile(target, content, 'utf8')
      }
    })()

    // Concurrent monitor: hammers reads of the raw file while both tasks run,
    // asserting every read is one complete known write — never a torn/mixed one.
    // The external task uses plain fs.writeFile — which opens with 'w'
    // (truncating to zero bytes immediately) and then writes the new
    // content as a separate step — to stand in for a naive external
    // program (e.g. the old buggy Obsidian save). That truncate-then-write
    // gap is a real, expected torn state for THAT writer; we cannot and
    // should not try to make another program's writes atomic — that's
    // exactly why the design relies on conflict detection for external
    // changes rather than trying to prevent them. What must never appear
    // is a torn read of OUR OWN atomicWrite path, which this monitor would
    // also catch since it treats '' as the only allowed non-final state.
    let monitoring = true
    const seenButUnknown: string[] = []
    const monitorTask = (async (): Promise<void> => {
      while (monitoring) {
        const raw = await fs.readFile(target, 'utf8').catch(() => null)
        if (raw !== null && raw !== '') {
          const known = new Set([...appWrites, ...externalWrites])
          if (!known.has(raw)) seenButUnknown.push(raw)
        }
        await delay(0)
      }
    })()

    await Promise.all([appTask, externalTask])
    monitoring = false
    await monitorTask

    // The monitor may have raced a write that hadn't been recorded into
    // appWrites/externalWrites yet at read time; re-check stragglers against
    // the now-complete write logs.
    const allKnown = new Set([...appWrites, ...externalWrites])
    const trulyUnknown = seenButUnknown.filter((c) => !allKnown.has(c))
    expect(trulyUnknown).toEqual([])

    const finalContent = await fs.readFile(target, 'utf8')
    expect(allKnown.has(finalContent)).toBe(true)

    const filesInDir = await fs.readdir(dir)
    const conflictFiles = filesInDir.filter((f) => f.includes('-conflict-'))
    const conflictSaves = saveResults.filter((r) => r.result.status === 'conflict')

    // Every detected conflict produced exactly one conflict file, and no app
    // edit disappeared without either landing in the main file or a conflict copy.
    expect(conflictFiles.length).toBe(conflictSaves.length)
    for (const { result, content } of conflictSaves) {
      if (result.status !== 'conflict') continue
      expect(await fs.readFile(result.conflictPath, 'utf8')).toBe(content)
    }

    expect(filesInDir.some((f) => f.includes('.tmp-'))).toBe(false)
  })
})
