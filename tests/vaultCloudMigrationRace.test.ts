import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importCloudIntoVault, type MigrationCloudSourceApi, type MigrationVaultDestApi } from '../src/renderer/src/lib/vaultCloudMigration'
import { fileWriteQueue, readNote, readVersion } from '../src/main/vault/fileWriteQueue'
import { stampUpdatedAt, stringifyNote, parseNote } from '../src/common/frontmatter'
import { TEMPLATE_DEFAULTS, TEMPLATE_STARTER_BODY } from '../src/common/noteTemplateDefaults'
import type { NoteData, SaveNoteRequest, TreeEntry, FileVersion } from '../src/common/types'
import type { CloudNoteData, CloudTreeNode } from '../src/common/cloudTypes'

// Real-stack reproduction harness for a production incident: a Language
// note's frontmatter was found reduced to ONLY `updatedAt` after an "Import
// Cloud Workspace into Local Vault" run, even though its body (85+
// dictionary words) landed fully intact. The existing vaultCloudMigration
// unit tests (vaultCloudMigration.test.ts) already prove isSourceNewer
// correctly blocks overwriting a note with no updatedAt, and
// fileWriteQueue.race.test.ts already proves the write queue's optimistic-
// concurrency check turns every lost race into a `-conflict-*.md` file, not
// silent corruption. Both of those are pure/mocked. This file re-runs the
// same scenarios against the REAL fileWriteQueue/atomicWrite on a real temp
// directory (not fakeVaultDestApi's in-memory map) and against a genuine
// concurrent "editor autosave" writer, to see whether real disk/async
// timing changes the outcome.
const dirs: string[] = []

async function makeVaultDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'vault-cloud-migration-race-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function listDir(dir: string): Promise<string[]> {
  return fs.readdir(dir)
}

// Mirrors session.ts's real createNote (session.ts:268-291): compute
// TEMPLATE_DEFAULTS/TEMPLATE_STARTER_BODY, write via the real
// fileWriteQueue with baseVersion:null.
async function realCreateNote(parentDir: string, name: string, template: 'note' | 'language' = 'note'): Promise<NoteData> {
  const path = join(parentDir, `${name}.md`)
  const frontmatter = TEMPLATE_DEFAULTS[template]?.() ?? { type: 'note', tags: [] }
  const body = TEMPLATE_STARTER_BODY[template] ?? '\n'
  const content = stringifyNote({ frontmatter, body })
  const result = await fileWriteQueue.saveFile(path, content, null)
  if (result.status !== 'saved') throw new Error('unexpected conflict creating a brand new note')
  return { path, content, version: result.version }
}

// Mirrors session.ts's real saveNote (session.ts:244-266), minus the SQLite
// side-index bookkeeping (irrelevant to what lands in the .md file itself).
async function realSaveNote(req: SaveNoteRequest): ReturnType<typeof fileWriteQueue.saveFile> {
  return fileWriteQueue.saveFile(req.path, req.content, req.baseVersion)
}

async function buildTree(dir: string): Promise<TreeEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: TreeEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push({ path, name: entry.name, isDirectory: true, children: await buildTree(path) })
    } else {
      out.push({ path, name: entry.name, isDirectory: false })
    }
  }
  return out
}

// Real-fileWriteQueue-backed MigrationVaultDestApi — same shape
// vaultCloudMigrationTest's fakeVaultDestApi provides, but every operation
// hits the real filesystem through the real queue instead of an in-memory
// map.
function realVaultDestApi(root: string): MigrationVaultDestApi {
  return {
    getTree: () => buildTree(root),
    readNote: async (path) => {
      const { content, version } = await readNote(path)
      return { path, content, version }
    },
    createFolder: async (parentDir, name) => {
      await fs.mkdir(join(parentDir, name), { recursive: true })
    },
    createNote: (parentDir, name) => realCreateNote(parentDir, name, 'note'),
    saveNote: realSaveNote
  }
}

function cloudSource(tree: CloudTreeNode[], notesById: Record<string, CloudNoteData>): MigrationCloudSourceApi {
  return {
    refreshTree: async () => tree,
    getNote: async (id) => notesById[id]
  }
}

// The exact 85+-word-style dictionary body shape the real Draconic note had
// — headings, sub-lines, and a markdown table — so a bug that's sensitive to
// body shape (e.g. a stray "---" line mistaken for a frontmatter delimiter)
// would show up here too.
const DRACONIC_BODY = `
## Word: keth
Meaning: fire
POS: noun
Gender: masculine
Ancient and still spoken in ritual contexts.

## Word: vahl
Meaning: sky
POS: noun
The root of most weather-related vocabulary.

## Grammar: Word Order
Verb-Subject-Object, unusually rigid even for a conlang.

| Person | Singular | Plural |
| --- | --- | --- |
| 1st | -o | -mos |
| 2nd | -as | -is |

---

Further notes: dialectal variation is common near the coast.
`.trim()

function draconicCloudNote(updatedAt: string): CloudNoteData {
  return {
    id: 'cloud-draconic',
    name: 'Draconic',
    folderId: null,
    frontmatter: { type: 'language', tags: ['conlang'], summary: 'The tongue of dragons', updatedAt },
    body: DRACONIC_BODY,
    noteType: 'language',
    version: 3
  }
}

// Replicates editorStore.ts's saveNow() EXACTLY (editorStore.ts:124-160):
// stamp `content` via the real stampUpdatedAt, then call the real
// saveNote-equivalent with whatever baseVersion is currently held.
async function editorAutosave(path: string, content: string, baseVersion: FileVersion | null): ReturnType<typeof fileWriteQueue.saveFile> {
  const stamped = stampUpdatedAt(content, new Date().toISOString())
  return realSaveNote({ path, content: stamped, baseVersion })
}

describe('importCloudIntoVault against the real fileWriteQueue (not a mock)', () => {
  it('CREATE branch: writes the full cloud note (frontmatter + body) in one clean pass with nothing else running', async () => {
    const root = await makeVaultDir()
    const cloudTree: CloudTreeNode[] = [{ id: 'cloud-draconic', name: 'Draconic', isDirectory: false, version: 3 }]
    const cloudApi = cloudSource(cloudTree, { 'cloud-draconic': draconicCloudNote('2026-08-05T00:00:00.000Z') })

    const progress = await importCloudIntoVault(cloudApi, realVaultDestApi(root), root, () => {})

    expect(progress.errors).toEqual([])
    const { content } = await readNote(join(root, 'Draconic.md'))
    const { frontmatter, body } = parseNote(content)
    expect(frontmatter).toEqual({ type: 'language', tags: ['conlang'], summary: 'The tongue of dragons', updatedAt: '2026-08-05T00:00:00.000Z' })
    expect(body.trim()).toBe(DRACONIC_BODY)
  })

  // The literal reproduction steps given: create a local stub via the
  // "+New" menu (session.ts's createNote with template 'language' — see
  // common/noteTypes/language.ts's defaultLanguageFrontmatter, which seeds
  // {type, tags, summary} but deliberately no `updatedAt`), leave it open
  // un-edited (editorStore.openNote sets dirty:false, so no autosave is
  // ever scheduled), then run the import.
  //
  // Updated after a later, real report of the isSourceNewer gap this
  // exposed: an untouched local stub has no updatedAt, so under the
  // original symmetric isSourceNewer it could never be confirmed "older"
  // than the cloud source no matter how obviously stale it was — stuck
  // warning forever. isSourceNewer now treats a missing DESTINATION
  // timestamp as older whenever the source has a real one (source has
  // definitely been through a real save; a never-updated destination
  // almost certainly hasn't), so this scenario now correctly resolves by
  // overwriting the blank stub with the cloud's real content.
  it('literal repro steps (stub via +New, left open unedited, then import): the cloud content now lands cleanly, no corruption', async () => {
    const root = await makeVaultDir()
    const stub = await realCreateNote(root, 'Draconic', 'language')
    expect(parseNote(stub.content).frontmatter).toEqual({ type: 'language', tags: [], summary: '' })

    // "Leave it open in the editor" — editorStore.openNote's own read,
    // nothing more (dirty stays false, so saveNow() would be a no-op).
    const opened = await readNote(stub.path)
    expect(opened.content).toBe(stub.content)

    const cloudTree: CloudTreeNode[] = [{ id: 'cloud-draconic', name: 'Draconic', isDirectory: false, version: 3 }]
    const cloudApi = cloudSource(cloudTree, { 'cloud-draconic': draconicCloudNote('2026-08-05T00:00:00.000Z') })

    const progress = await importCloudIntoVault(cloudApi, realVaultDestApi(root), root, () => {})

    expect(progress.warnings).toEqual([])
    expect(progress.errors).toEqual([])
    const finalContent = (await readNote(stub.path)).content
    const finalParsed = parseNote(finalContent)
    expect(finalParsed.frontmatter).toEqual({ type: 'language', tags: ['conlang'], summary: 'The tongue of dragons', updatedAt: '2026-08-05T00:00:00.000Z' })
    expect(finalContent).toContain('keth')
    // The critical invariant this whole investigation was about: never
    // reduced to just updatedAt, regardless of which side wins.
    expect(Object.keys(finalParsed.frontmatter).sort()).not.toEqual(['updatedAt'])
  })

  // Same as above, but the stub DOES have a prior updatedAt (as it would
  // after at least one real editor autosave) that is older than the cloud
  // note's — the actual gate that lets an update happen — with a second,
  // concurrent editor autosave (stale content, stale baseVersion) racing
  // against the migration's own read-then-write for the SAME path, using
  // real setTimeout-based interleaving rather than fake timers.
  it.each([
    ['migration write lands first', 5, 30],
    ['stale autosave lands first', 30, 5]
  ])('UPDATE branch race (%s): the loser always becomes a conflict file, never silent corruption', async (_label, migrationDelayMs, autosaveDelayMs) => {
    const root = await makeVaultDir()
    const path = join(root, 'Draconic.md')

    // One real prior save (mirrors a genuine editorStore autosave) so the
    // stub has a real, older updatedAt and isSourceNewer's gate opens up.
    const seed = stringifyNote({ frontmatter: { type: 'language', tags: [], summary: 'wip' }, body: '\n*draft*\n' })
    const created = await fileWriteQueue.saveFile(path, seed, null)
    if (created.status !== 'saved') throw new Error('setup failed')
    const firstSave = await editorAutosave(path, seed, created.version)
    if (firstSave.status !== 'saved') throw new Error('setup failed')
    const stubBaseVersion = firstSave.version
    const stubContent = (await readNote(path)).content
    expect(parseNote(stubContent).frontmatter.updatedAt).toBeTruthy()

    const cloudTree: CloudTreeNode[] = [{ id: 'cloud-draconic', name: 'Draconic', isDirectory: false, version: 3 }]
    // Comfortably newer than the stub's just-stamped updatedAt.
    const cloudApi = cloudSource(cloudTree, { 'cloud-draconic': draconicCloudNote('2099-01-01T00:00:00.000Z') })

    const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

    // The "user is still typing" stale autosave: same content/baseVersion
    // the editor store would have held right after the first save, fired
    // after its own independent delay — never re-reading disk first,
    // exactly like a debounced autosave that doesn't know an external
    // writer touched the file.
    const staleAutosave = (async (): Promise<void> => {
      await delay(autosaveDelayMs)
      await editorAutosave(path, stubContent + '\nmore notes while it was open\n', stubBaseVersion)
    })()

    let migrationProgress: Awaited<ReturnType<typeof importCloudIntoVault>> | null = null
    const migrationRun = (async (): Promise<void> => {
      await delay(migrationDelayMs)
      migrationProgress = await importCloudIntoVault(cloudApi, realVaultDestApi(root), root, () => {})
    })()

    await Promise.all([staleAutosave, migrationRun])

    const filesAfter = await listDir(root)
    const conflictFiles = filesAfter.filter((f) => f.includes('-conflict-'))
    const mainContent = (await readNote(path)).content
    const mainParsed = parseNote(mainContent)

    // Migration re-reads `dest` fresh (Promise.all([cloudApi.getNote(...),
    // vaultApi.readNote(existingPath)])) immediately before deciding to
    // write, rather than reusing a baseVersion captured earlier — so if the
    // autosave fully lands BEFORE migration even starts its read, migration
    // sees the fresh version and writes cleanly on top of it: two
    // sequential successful saves, zero conflicts, cloud content ends up on
    // top since it wrote last. Conversely, if migration's read/write
    // straddles the autosave's own write, the autosave's now-stale
    // baseVersion loses and is diverted to a conflict file. Both are
    // correct, race-timing-dependent outcomes — the only wrong outcome
    // would be silent corruption or a torn write.
    expect(conflictFiles.length).toBeLessThanOrEqual(1)
    const wonWithFullCloudContent = mainContent.includes('keth') && mainParsed.frontmatter.type === 'language'
    const wonWithStaleEdit = mainContent.includes('more notes while it was open')
    expect(wonWithFullCloudContent || wonWithStaleEdit).toBe(true)

    // The critical invariant this whole investigation is about: whichever
    // writer wins, frontmatter is never reduced to just `updatedAt` — every
    // other field either writer's content actually had must survive.
    expect(Object.keys(mainParsed.frontmatter).sort()).not.toEqual(['updatedAt'])

    if (conflictFiles.length === 1) {
      const conflictContent = await fs.readFile(join(root, conflictFiles[0]), 'utf8')
      const conflictParsed = parseNote(conflictContent)
      expect(Object.keys(conflictParsed.frontmatter).sort()).not.toEqual(['updatedAt'])
    }

    // Regression check for the fix: importCloudIntoVault's UPDATE branch
    // used to discard saveNote's result entirely, so a losing migration
    // write (the stale edit won) still counted as a clean success with no
    // error or warning — indistinguishable from the cloud content actually
    // having landed. It must now show up as a per-note error.
    expect(migrationProgress).not.toBeNull()
    if (wonWithStaleEdit) {
      expect(migrationProgress!.errors).toEqual([expect.objectContaining({ name: 'Draconic' })])
    } else {
      expect(migrationProgress!.errors).toEqual([])
    }
  })

  // vaultCloudMigration.ts's CREATE branch (no pre-existing local note) is a
  // two-step create-then-overwrite: vaultApi.createNote() writes a BLANK
  // {type:'note',tags:[]} stub first, then a separate vaultApi.saveNote()
  // call overwrites it with the real translated content — the exact same
  // "create blank, then overwrite" pattern noteRefApi.ts's createNote and
  // FileTree.tsx's submitCreateMap also use. There's a real gap between
  // those two IPC calls; this drives a genuine concurrent write (a
  // simulated editor autosave) into that gap and checks what lands.
  it.each([
    ['editor write happens in the gap, before migration\'s overwrite', 0],
    ['editor write happens right as migration\'s overwrite is landing', 1]
  ])('CREATE branch step-A/step-B gap (%s): concurrent write into the blank stub never produces a "just updatedAt" file', async (_label, editorDelayMs) => {
    const root = await makeVaultDir()
    const path = join(root, 'Draconic.md')

    let blankStubVersion: FileVersion | null = null
    const vaultApi: MigrationVaultDestApi = {
      ...realVaultDestApi(root),
      createNote: async (parentDir, name) => {
        const created = await realCreateNote(parentDir, name, 'note')
        blankStubVersion = created.version
        // Simulate: the chokidar 'add' event fires, the user notices the
        // new (blank) note in the tree, opens it, and starts typing —
        // landing a real, concurrent editorAutosave-style write into the
        // SAME path before this function returns control to
        // importCloudIntoVault's own follow-up saveNote call.
        await new Promise((resolve) => setTimeout(resolve, editorDelayMs))
        await editorAutosave(created.path, created.content + '\nuser typed this while it was a blank stub\n', blankStubVersion)
        return created
      }
    }

    const cloudTree: CloudTreeNode[] = [{ id: 'cloud-draconic', name: 'Draconic', isDirectory: false, version: 3 }]
    const cloudApi = cloudSource(cloudTree, { 'cloud-draconic': draconicCloudNote('2026-08-05T00:00:00.000Z') })

    const progress = await importCloudIntoVault(cloudApi, vaultApi, root, () => {})

    const filesAfter = await listDir(root)
    const conflictFiles = filesAfter.filter((f) => f.includes('-conflict-'))
    const mainContent = (await readNote(path)).content
    const mainParsed = parseNote(mainContent)

    // Migration's own step-B save uses baseVersion:blankStubVersion — by
    // the time it runs, the concurrent editor write already moved the disk
    // version forward, so migration's save MUST be detected as a conflict
    // (diverted to a -conflict-*.md file) rather than silently applied on
    // top of, or lost underneath, the editor's write.
    expect(conflictFiles.length).toBe(1)
    expect(Object.keys(mainParsed.frontmatter).sort()).not.toEqual(['updatedAt'])
    // The editor's write always wins the main path here — migration's
    // step-B save is what conflicts (its baseVersion is the pre-edit blank
    // stub), never a truncated/merged hybrid of the two.
    expect(mainContent).toContain('user typed this while it was a blank stub')
    expect(mainContent).not.toContain('keth')

    // Regression check for the fix: this used to be silent — progress.done
    // incremented, no error, no warning — even though the real cloud
    // content never landed (it's sitting in the conflict file instead,
    // never surfaced to the user, and the blank-turned-edited stub has no
    // updatedAt so a rerun would just warn-and-skip it forever). The
    // conflict must now be a visible per-note error.
    expect(progress.errors).toEqual([expect.objectContaining({ name: 'Draconic' })])
  })
})
