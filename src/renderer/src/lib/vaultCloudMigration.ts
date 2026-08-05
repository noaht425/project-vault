// One-time (safely re-runnable) tool to seed the Cloud Workspace from the
// local Vault. The two are otherwise entirely independent stores — nothing
// here is a sync engine, it's a bulk "create what's missing" pass reusing
// the same one-at-a-time IPC calls the UI uses for everyday edits.
//
// See docs/plans/2026-08-04-cloud-to-local-copy.md for the reverse
// direction (importCloudIntoVault, below importVaultIntoCloud in this same
// file per design decision #6) and for the compare-and-warn upgrade shared
// by both directions.
import { parseNote, stringifyNote } from '../../../common/frontmatter'
import type { TreeEntry, NoteData, SaveNoteRequest, SaveNoteResult } from '../../../common/types'
import type { CloudFolder, CloudNoteData, CloudSaveResult, CloudTreeNode } from '../../../common/cloudTypes'

export interface MigrationProgress {
  total: number
  done: number
  currentName: string
  errors: { name: string; message: string }[]
  // "This note exists on both sides, but the destination looks newer, the
  // same age, or either side's updatedAt is unknown" — see design
  // decision #1. Recorded rather than silently skipped or blindly
  // overwritten; surfaced in the UI (VaultImportPanel/CloudImportPanel)
  // alongside the existing created/updated/error counts, per design
  // decision #8.
  warnings: { name: string; message: string }[]
  // Only meaningful when the pass was run with dryRun:true (see the `dryRun`
  // param below) — how many notes WOULD be created/updated, since a dry run
  // performs every read/comparison a real run does but skips every write.
  // Both stay 0 on a real run (those notes get folded into `done` instead).
  // Powers the "N will be created, M updated, K skipped as conflicts —
  // proceed?" confirmation the UI shows before a real run ever touches
  // anything, addressing the plan's own open question about confirming
  // before an overwrite-capable copy runs.
  toCreate: number
  toUpdate: number
}

export interface MigrationVaultApi {
  getTree(): Promise<TreeEntry[]>
  readNote(path: string): Promise<NoteData>
}

export interface MigrationCloudApi {
  refreshTree(): Promise<CloudTreeNode[]>
  createFolder(name: string, parentId?: string | null): Promise<CloudFolder>
  createNote(args: {
    name: string
    folderId?: string | null
    frontmatter?: Record<string, unknown>
    body?: string
  }): Promise<CloudNoteData>
  // Added for the compare-and-warn upgrade (design decision #1/#6) — reading
  // an already-present cloud note's current frontmatter/version to compare
  // against the local source, and writing an update when the local copy is
  // newer.
  getNote(id: string): Promise<CloudNoteData>
  saveNote(args: {
    id: string
    version: number
    frontmatter?: Record<string, unknown>
    body?: string
  }): Promise<CloudSaveResult>
}

// Destination-side local vault API — a superset of MigrationVaultApi
// (source-side, above) since being the destination also means creating
// folders/notes and updating existing ones, not just reading.
export interface MigrationVaultDestApi {
  getTree(): Promise<TreeEntry[]>
  readNote(path: string): Promise<NoteData>
  createFolder(parentDir: string, name: string): Promise<void>
  createNote(parentDir: string, name: string): Promise<NoteData>
  saveNote(req: SaveNoteRequest): Promise<SaveNoteResult>
}

// Source-side cloud API for the reverse direction — narrower than
// MigrationCloudApi (source-only: read, not create).
export interface MigrationCloudSourceApi {
  refreshTree(): Promise<CloudTreeNode[]>
  getNote(id: string): Promise<CloudNoteData>
}

// The per-note-type post-processing hook (design decision #7) — run on
// both the create and update path, right before a note's frontmatter/body
// are written to the destination. Defaults to a no-op identity so tests and
// callers that don't care about Map/Settlement translation can omit it.
// See lib/migrationNoteTypeHooks.ts for the real Map/Settlement
// implementations.
export type NoteTransform = (note: { frontmatter: Record<string, unknown>; body: string }) => Promise<{
  frontmatter: Record<string, unknown>
  body: string
}>

const identityTransform: NoteTransform = async (note) => note

// "Is the source's updatedAt strictly newer than the destination's?" — the
// single safe-to-overwrite condition (design decision #1/#2). Anything else
// (equal, destination newer, either side missing/unparseable) returns
// false, folding into the warn-and-skip branch rather than ever risking a
// silent overwrite. Exported for reuse by both copy directions and direct
// testing.
export function isSourceNewer(sourceUpdatedAt: unknown, destUpdatedAt: unknown): boolean {
  if (typeof sourceUpdatedAt !== 'string' || typeof destUpdatedAt !== 'string') return false
  const source = Date.parse(sourceUpdatedAt)
  const dest = Date.parse(destUpdatedAt)
  if (Number.isNaN(source) || Number.isNaN(dest)) return false
  return source > dest
}

function countNotes(entries: TreeEntry[]): number {
  let total = 0
  for (const entry of entries) {
    total += entry.isDirectory ? countNotes(entry.children ?? []) : 1
  }
  return total
}

// Root-level items have parentId null, and Postgres's unique constraint
// never treats two NULLs as equal — so a plain "did the create fail with a
// conflict" check can't catch a root-level duplicate on rerun. Building this
// index up front from the real cloud tree and checking it before every
// create is what makes a rerun safe.
function indexKey(parentId: string | null, name: string): string {
  return `${parentId ?? 'root'}::${name}`
}

function indexCloudTree(
  nodes: CloudTreeNode[],
  parentId: string | null,
  index: Map<string, { id: string; isDirectory: boolean }>
): void {
  for (const node of nodes) {
    index.set(indexKey(parentId, node.name), { id: node.id, isDirectory: node.isDirectory })
    if (node.children) indexCloudTree(node.children, node.id, index)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Regression fix: a single hung note used to freeze the entire copy forever
// — nothing here had a timeout, unlike editorStore.ts's/cloudEditorStore.ts's
// own saveNow (SAVE_TIMEOUT_MS). The per-note-type transform hook is the
// most likely culprit (a Map image download or Settlement bulk-data fetch
// in migrationNoteTypeHooks.ts, both raw network calls with no bound of
// their own), but this wraps the WHOLE per-note try body so any hang
// anywhere in it — a stuck IPC call, a network request that never resolves
// or errors — gets caught and turned into a normal per-item error instead
// of stalling every note after it. Same "doesn't cancel the underlying
// call, just stops waiting on it" tradeoff as editorStore.ts's withTimeout:
// a late-arriving response may still land in the background; a rerun's
// idempotent index check treats that as an already-existing note and
// compares timestamps normally, same as any other completed item.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Timed out after ${Math.round(ms / 1000)}s processing "${label}" — it may be too large, or something else is stuck.`)
          ),
        ms
      )
    )
  ])
}

// Generous on purpose — a single note can chain several network round trips
// through the transform hook (fetch a signed URL, download the bytes, write
// them back out) on top of the create/update calls themselves, and a large
// Map image or Settlement bulk-data blob over a slow connection can
// legitimately take a while. Long enough that only a genuine hang trips it,
// not a merely slow transfer.
const PER_NOTE_TIMEOUT_MS = 120000

export async function importVaultIntoCloud(
  vaultApi: MigrationVaultApi,
  cloudApi: MigrationCloudApi,
  onProgress: (progress: MigrationProgress) => void,
  transformNote: NoteTransform = identityTransform,
  // When true, performs every read/comparison a real run does (so the
  // resulting toCreate/toUpdate/warnings/errors counts are accurate) but
  // skips every write (createFolder/createNote/saveNote) — lets the UI show
  // an accurate "N will be created, M updated, K skipped — proceed?" summary
  // before a real, overwrite-capable run ever touches anything.
  dryRun = false
): Promise<MigrationProgress> {
  const [localTree, cloudTree] = await Promise.all([vaultApi.getTree(), cloudApi.refreshTree()])

  const index = new Map<string, { id: string; isDirectory: boolean }>()
  indexCloudTree(cloudTree, null, index)

  const progress: MigrationProgress = {
    total: countNotes(localTree),
    done: 0,
    currentName: '',
    errors: [],
    warnings: [],
    toCreate: 0,
    toUpdate: 0
  }
  const report = (): void => onProgress({ ...progress, errors: [...progress.errors], warnings: [...progress.warnings] })
  report()

  async function walk(entries: TreeEntry[], parentCloudId: string | null): Promise<void> {
    const directories = entries.filter((e) => e.isDirectory)
    const notes = entries.filter((e) => !e.isDirectory)

    for (const dir of directories) {
      progress.currentName = dir.name
      const key = indexKey(parentCloudId, dir.name)
      const existing = index.get(key)

      let folderId = existing?.id ?? null
      if (folderId === null) {
        if (dryRun) {
          // Nothing under a not-yet-created cloud folder could already
          // exist either, so every descendant note below is unconditionally
          // "would create" — this synthetic id is only ever used as an
          // index lookup key (see the notes loop below), which correctly
          // never matches anything from the real, already-fetched cloudTree.
          folderId = `dry-run:${key}`
        } else {
          try {
            const folder = await cloudApi.createFolder(dir.name, parentCloudId)
            folderId = folder.id
            index.set(key, { id: folder.id, isDirectory: true })
          } catch (err) {
            progress.errors.push({ name: dir.name, message: errorMessage(err) })
            report()
            continue // no parent id to attach this folder's contents to — skip descending
          }
        }
      }
      await walk(dir.children ?? [], folderId)
    }

    for (const file of notes) {
      const name = file.name.replace(/\.md$/, '')
      progress.currentName = name
      const existing = index.get(indexKey(parentCloudId, name))

      const processNote = async (): Promise<void> => {
        if (!existing) {
          if (dryRun) {
            progress.toCreate += 1
          } else {
            const note = await vaultApi.readNote(file.path)
            const { frontmatter, body } = parseNote(note.content)
            const translated = await transformNote({ frontmatter, body })
            const created = await cloudApi.createNote({ name, folderId: parentCloudId, ...translated })
            index.set(indexKey(parentCloudId, name), { id: created.id, isDirectory: false })
          }
        } else {
          // Diverges from the old create-only behavior here: an
          // already-present note gets an updatedAt comparison (design
          // decision #1) instead of an unconditional skip. Mirrors
          // importCloudIntoVault's own update/warn branch (Phase 5) — see
          // isSourceNewer's own comment for what counts as "safe." Still
          // needs the real read/comparison in dry-run mode (only the final
          // write is skipped) for an accurate toUpdate count.
          const [note, dest] = await Promise.all([vaultApi.readNote(file.path), cloudApi.getNote(existing.id)])
          const { frontmatter, body } = parseNote(note.content)
          if (isSourceNewer(frontmatter.updatedAt, dest.frontmatter.updatedAt)) {
            if (dryRun) {
              progress.toUpdate += 1
            } else {
              const translated = await transformNote({ frontmatter, body })
              const result = await cloudApi.saveNote({ id: existing.id, version: dest.version, ...translated })
              // A conflict here means the cloud note changed between the
              // dest read above and this write — the transferred content
              // never actually landed. Left silently unchecked, this used
              // to be indistinguishable from a real success: progress.done
              // still incremented, no error or warning recorded, even
              // though the note's content is exactly as it was before this
              // run. Surfacing it as a per-note error (via the existing
              // try/catch around processNote(), same as any other failure
              // mode) means a rerun will see it and retry instead of the
              // gap going unnoticed.
              if (result.status === 'conflict') {
                throw new Error('The cloud copy changed while this update was in flight — nothing was overwritten. Safe to retry.')
              }
            }
          } else {
            progress.warnings.push({
              name,
              message: 'The cloud copy is newer, the same age, or has no edit timestamp yet — left as-is.'
            })
          }
        }
      }

      try {
        await withTimeout(processNote(), PER_NOTE_TIMEOUT_MS, name)
      } catch (err) {
        progress.errors.push({ name, message: errorMessage(err) })
      }

      progress.done += 1
      report()
    }
  }

  await walk(localTree, null)
  return progress
}

function countCloudNotes(nodes: CloudTreeNode[]): number {
  let total = 0
  for (const node of nodes) {
    total += node.isDirectory ? countCloudNotes(node.children ?? []) : 1
  }
  return total
}

// Local identity is a filesystem path, and TreeEntry.path (built by
// buildTree — see main/vault/tree.ts) already IS that path, uniquely
// encoding parent+name — unlike indexCloudTree above, no synthetic
// `${parentId}::${name}` key is needed here (that scheme exists only to
// work around Postgres's opaque, otherwise-un-lookupable folder ids and its
// NULL-parent-never-equals-NULL uniqueness quirk — neither applies to a
// plain path string).
function indexVaultTree(entries: TreeEntry[], index: Map<string, TreeEntry>): void {
  for (const entry of entries) {
    index.set(entry.path, entry)
    if (entry.children) indexVaultTree(entry.children, index)
  }
}

// Not path.join — this file runs in the renderer (no Node path module
// bundled), and the rest of the renderer already assumes '/' unconditionally
// for local vault paths (see e.g. FileTree.tsx's drag/drop
// `entry.path.startsWith(...)` checks) — this app is macOS-only today.
function childPath(parentDir: string, name: string): string {
  return `${parentDir}/${name}`
}

// Cloud Workspace -> Local Vault. Mirrors importVaultIntoCloud's
// recursive, indexed, per-item-error-tolerant walk (see design decision #6)
// but diverges at the "already exists" branch: instead of an unconditional
// skip, compares both sides' updatedAt (isSourceNewer, above) and either
// overwrites (source newer) or records a warning (destination newer/same-
// age/either side unknown) — see design decisions #1, #2, #8.
export async function importCloudIntoVault(
  cloudApi: MigrationCloudSourceApi,
  vaultApi: MigrationVaultDestApi,
  vaultRoot: string,
  onProgress: (progress: MigrationProgress) => void,
  transformNote: NoteTransform = identityTransform,
  // See importVaultIntoCloud's own dryRun comment — same contract, mirrored.
  dryRun = false
): Promise<MigrationProgress> {
  const [cloudTree, localTree] = await Promise.all([cloudApi.refreshTree(), vaultApi.getTree()])

  const index = new Map<string, TreeEntry>()
  indexVaultTree(localTree, index)

  const progress: MigrationProgress = {
    total: countCloudNotes(cloudTree),
    done: 0,
    currentName: '',
    errors: [],
    warnings: [],
    toCreate: 0,
    toUpdate: 0
  }
  const report = (): void => onProgress({ ...progress, errors: [...progress.errors], warnings: [...progress.warnings] })
  report()

  async function walk(nodes: CloudTreeNode[], parentDir: string): Promise<void> {
    const directories = nodes.filter((n) => n.isDirectory)
    const notes = nodes.filter((n) => !n.isDirectory)

    for (const dir of directories) {
      progress.currentName = dir.name
      const dirPath = childPath(parentDir, dir.name)

      // Local identity is a plain path string, computable without actually
      // creating anything (unlike the cloud direction's opaque folder ids)
      // — so dry-run mode needs no synthetic-key workaround here, just skip
      // the real create call and keep descending with the same dirPath.
      if (!index.has(dirPath) && !dryRun) {
        try {
          await vaultApi.createFolder(parentDir, dir.name)
        } catch (err) {
          progress.errors.push({ name: dir.name, message: errorMessage(err) })
          report()
          continue // can't attach this folder's contents to a path that doesn't exist — skip descending
        }
      }
      await walk(dir.children ?? [], dirPath)
    }

    for (const cloudNote of notes) {
      const name = cloudNote.name
      progress.currentName = name
      const notePath = childPath(parentDir, `${name}.md`)

      const processNote = async (): Promise<void> => {
        const existingPath = index.has(notePath) ? notePath : null
        if (!existingPath) {
          if (dryRun) {
            progress.toCreate += 1
          } else {
            const source = await cloudApi.getNote(cloudNote.id)
            const translated = await transformNote({ frontmatter: source.frontmatter, body: source.body })
            const created = await vaultApi.createNote(parentDir, name)
            const result = await vaultApi.saveNote({ path: created.path, content: stringifyNote(translated), baseVersion: created.version })
            // This is a two-step create-then-overwrite (createNote always
            // seeds a blank {type:'note',tags:[]} stub — there's no API to
            // create a note with arbitrary frontmatter directly), so there's
            // a real gap between the two writes. A conflict here means
            // something else wrote to this exact new path in that gap — left
            // unchecked, the real cloud content silently never lands (it's
            // diverted to a `-conflict-*.md` file instead) while this note
            // still gets counted as a normal success. Surfacing it as an
            // error (instead of deleting whatever's now at that path) is the
            // safe choice: the conflicting write could just as easily be a
            // real, concurrent local edit racing the same new path, and
            // deleting that to "clean up" would destroy real content instead
            // of an orphaned stub. If it genuinely was still the untouched
            // blank stub, the user can delete it by hand to unblock a rerun
            // — worse than automatic, but never destructive.
            if (result.status === 'conflict') {
              throw new Error('Another write landed on this note while it was being created — nothing was overwritten. Safe to retry.')
            }
          }
        } else {
          const [source, dest] = await Promise.all([cloudApi.getNote(cloudNote.id), vaultApi.readNote(existingPath)])
          const destFrontmatter = parseNote(dest.content).frontmatter
          if (isSourceNewer(source.frontmatter.updatedAt, destFrontmatter.updatedAt)) {
            if (dryRun) {
              progress.toUpdate += 1
            } else {
              const translated = await transformNote({ frontmatter: source.frontmatter, body: source.body })
              const result = await vaultApi.saveNote({ path: existingPath, content: stringifyNote(translated), baseVersion: dest.version })
              // Same reasoning as the CREATE branch's own check above, minus
              // the rollback — this path is an already-existing note, not an
              // orphaned stub, so there's nothing to clean up. A conflict
              // just means it changed between the dest read and this write;
              // surfacing it as an error (instead of silent success) means a
              // rerun will see it and retry with a fresh read.
              if (result.status === 'conflict') {
                throw new Error('The local copy changed while this update was in flight — nothing was overwritten. Safe to retry.')
              }
            }
          } else {
            progress.warnings.push({
              name,
              message: 'The local copy is newer, the same age, or has no edit timestamp yet — left as-is.'
            })
          }
        }
      }

      try {
        await withTimeout(processNote(), PER_NOTE_TIMEOUT_MS, name)
      } catch (err) {
        progress.errors.push({ name, message: errorMessage(err) })
      }

      progress.done += 1
      report()
    }
  }

  await walk(cloudTree, vaultRoot)
  return progress
}
