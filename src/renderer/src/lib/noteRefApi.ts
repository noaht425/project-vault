import { useMemo } from 'react'
import { parseNote, stringifyNote } from '../../../common/frontmatter'
import { listFolderPaths, listNoteTitlesInFolder } from '../../../common/folderTree'
import { useEditorStore } from '../state/editorStore'
import { useCloudEditorStore } from '../state/cloudEditorStore'
import { useVaultStore } from '../state/vaultStore'
import { useCloudStore } from '../state/cloudStore'

// Shared shape for "resolve a note by title" operations that need to work
// against either backend: PcSheet's class-reference field, ClassFeaturesPanel's
// level lookup, and the family-tree diagram's click-to-open nodes. Before
// this existed, each of those three had its own copy of "search titles, find
// the exact case-insensitive match, then act or alert" — this consolidates
// that into one implementation per backend.
export interface NoteRefApi {
  // Cloud Workspace vs. Local Vault — added so a sheet can gate backend-
  // specific behavior (e.g. SettlementSheet.tsx's Supabase-Storage bulk
  // data offload, which only makes sense for Cloud, since Local Vault
  // writes straight to a file with no request-size limit to work around).
  isCloud: boolean
  searchTitles(query: string, type?: string): Promise<{ title: string }[]>
  openByTitle(title: string, type?: string): Promise<void>
  readBodyByTitle(title: string, type?: string): Promise<string | null>
  // Added for EventSheet's structured-date picker (see
  // docs/plans/2026-07-28-calendar-timeline-system.md, build step 4) — it
  // needs a referenced calendar note's actual era/month/week definitions to
  // populate its dropdowns, not just its body text like readBodyByTitle.
  readFrontmatterByTitle(title: string, type?: string): Promise<Record<string, unknown> | null>
  // Combines the two reads above into one title-resolve + one note read —
  // used by the contradiction checker, which needs both frontmatter and body
  // for every event note it scans. Calling readBodyByTitle and
  // readFrontmatterByTitle separately for the same title did the exact-match
  // search twice and read the note twice (for Cloud, that's up to 4 network
  // round trips per note instead of 2).
  readNoteByTitle(title: string, type?: string): Promise<{ frontmatter: Record<string, unknown>; body: string } | null>
  // Used by the Settlement Populator's "promote to real note" action — the
  // only place in the app that creates a note from inside a sheet rather
  // than the file tree. Lands in the vault/workspace root for both backends
  // in v1; the user can move it via the file tree afterward like any note.
  createNote(name: string, frontmatter: Record<string, unknown>, body?: string): Promise<{ title: string }>
  // Added for the settlement religion picker's "add all from folder" bulk
  // action (docs/plans/2026-07-28-settlement-religion-note-references.md) —
  // recurses into subfolders. Derived from the already-cached vault/cloud
  // tree client-side (see common/folderTree.ts) rather than a new IPC/API
  // round-trip, since both backends' tree already nests full folder
  // contents.
  listNotesInFolder(folderPath: string): Promise<{ title: string }[]>
  // Every directory path in the tree, for that same control's folder-path
  // datalist.
  listFolderPaths(): Promise<string[]>
}

// Exported for direct testing (tests/noteRefApi.test.ts) — the two hooks
// below are thin, barely-testable wiring around window.vaultApi/cloudApi
// and a React hook context; this factory is where the actual
// find-exact-or-alert logic (and its risk of regressing) lives.
export function createNoteRefApi(
  searchTitles: (query: string, type?: string) => Promise<{ title: string; ref: string }[]>,
  openByRef: (ref: string) => Promise<void>,
  readBodyByRef: (ref: string) => Promise<string>,
  createNoteImpl: (name: string, frontmatter: Record<string, unknown>, body: string) => Promise<{ title: string }>,
  readFrontmatterByRef: (ref: string) => Promise<Record<string, unknown>>,
  listNotesInFolderImpl: (folderPath: string) => Promise<{ title: string }[]> = async () => [],
  listFolderPathsImpl: () => Promise<string[]> = async () => [],
  // Defaults to the naive "call both separately" behavior so existing
  // callers/tests that don't pass this still work — the two real hooks below
  // override it with a genuinely combined single-read implementation.
  readNoteByRef: (ref: string) => Promise<{ frontmatter: Record<string, unknown>; body: string }> = async (ref) => {
    const [frontmatter, body] = await Promise.all([readFrontmatterByRef(ref), readBodyByRef(ref)])
    return { frontmatter, body }
  },
  // Defaults to false so existing callers/tests that don't pass this (and
  // don't care about the local/cloud distinction) still work.
  isCloud = false
): NoteRefApi {
  async function findExact(title: string, type?: string): Promise<{ title: string; ref: string } | undefined> {
    const matches = await searchTitles(title, type)
    return matches.find((m) => m.title.toLowerCase() === title.toLowerCase())
  }

  return {
    isCloud,
    searchTitles,
    // Callers (PcSheet's Open button, the family-tree diagram's clickable
    // nodes) don't wrap this in their own try/catch, so an IPC/network
    // failure needs to surface here rather than becoming a silent unhandled
    // rejection — matching the try/catch the old useWikiLinkNavigation had.
    async openByTitle(title, type) {
      try {
        const exact = await findExact(title, type)
        if (exact) await openByRef(exact.ref)
        else window.alert(`No note titled "${title}" yet.`)
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },
    async readBodyByTitle(title, type) {
      const exact = await findExact(title, type)
      return exact ? readBodyByRef(exact.ref) : null
    },
    async readFrontmatterByTitle(title, type) {
      const exact = await findExact(title, type)
      return exact ? readFrontmatterByRef(exact.ref) : null
    },
    async readNoteByTitle(title, type) {
      const exact = await findExact(title, type)
      return exact ? readNoteByRef(exact.ref) : null
    },
    async createNote(name, frontmatter, body = '') {
      return createNoteImpl(name, frontmatter, body)
    },
    async listNotesInFolder(folderPath) {
      return listNotesInFolderImpl(folderPath)
    },
    async listFolderPaths() {
      return listFolderPathsImpl()
    }
  }
}

export function useLocalNoteRefApi(): NoteRefApi {
  const openNote = useEditorStore((s) => s.openNote)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const tree = useVaultStore((s) => s.tree)
  return useMemo(
    () =>
      createNoteRefApi(
        async (query, type) =>
          (await window.vaultApi.searchTitles(query, type)).map((m) => ({ title: m.title, ref: m.path })),
        (path) => openNote(path),
        async (path) => parseNote((await window.vaultApi.readNote(path)).content).body,
        async (name, frontmatter, body) => {
          if (!vaultPath) throw new Error('No vault open')
          // vaultApi.createNote only accepts a NoteTemplate for default
          // frontmatter, not an arbitrary object — create a blank note, then
          // immediately overwrite it with the real (frontmatter, body).
          const created = await window.vaultApi.createNote(vaultPath, name)
          await window.vaultApi.saveNote({
            path: created.path,
            content: stringifyNote({ frontmatter, body }),
            baseVersion: created.version
          })
          return { title: name }
        },
        async (path) => parseNote((await window.vaultApi.readNote(path)).content).frontmatter,
        async (folderPath) => listNoteTitlesInFolder(tree, folderPath).map((title) => ({ title })),
        async () => listFolderPaths(tree),
        // One readNote + one parse instead of two of each.
        async (path) => parseNote((await window.vaultApi.readNote(path)).content),
        false
      ),
    [openNote, vaultPath, tree]
  )
}

export function useCloudNoteRefApi(): NoteRefApi {
  const openNote = useCloudEditorStore((s) => s.openNote)
  const tree = useCloudStore((s) => s.tree)
  return useMemo(
    () =>
      createNoteRefApi(
        async (query, type) =>
          (await window.cloudApi.searchTitles(query, type)).map((m) => ({ title: m.name, ref: m.id })),
        (id) => openNote(id),
        async (id) => (await window.cloudApi.getNote(id)).body,
        async (name, frontmatter, body) => {
          const created = await window.cloudApi.createNote({ name, frontmatter, body })
          return { title: created.name }
        },
        async (id) => (await window.cloudApi.getNote(id)).frontmatter,
        async (folderPath) => listNoteTitlesInFolder(tree ?? [], folderPath).map((title) => ({ title })),
        async () => listFolderPaths(tree ?? []),
        // One getNote call instead of two — CloudNoteData already carries
        // both frontmatter and body together.
        async (id) => {
          const note = await window.cloudApi.getNote(id)
          return { frontmatter: note.frontmatter, body: note.body }
        },
        true
      ),
    [openNote, tree]
  )
}
