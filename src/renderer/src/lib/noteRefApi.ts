import { useMemo } from 'react'
import { parseNote, stringifyNote } from '../../../common/frontmatter'
import { useEditorStore } from '../state/editorStore'
import { useCloudEditorStore } from '../state/cloudEditorStore'
import { useVaultStore } from '../state/vaultStore'

// Shared shape for "resolve a note by title" operations that need to work
// against either backend: PcSheet's class-reference field, ClassFeaturesPanel's
// level lookup, and the family-tree diagram's click-to-open nodes. Before
// this existed, each of those three had its own copy of "search titles, find
// the exact case-insensitive match, then act or alert" — this consolidates
// that into one implementation per backend.
export interface NoteRefApi {
  searchTitles(query: string, type?: string): Promise<{ title: string }[]>
  openByTitle(title: string, type?: string): Promise<void>
  readBodyByTitle(title: string, type?: string): Promise<string | null>
  // Added for EventSheet's structured-date picker (see
  // docs/plans/2026-07-28-calendar-timeline-system.md, build step 4) — it
  // needs a referenced calendar note's actual era/month/week definitions to
  // populate its dropdowns, not just its body text like readBodyByTitle.
  readFrontmatterByTitle(title: string, type?: string): Promise<Record<string, unknown> | null>
  // Used by the Settlement Populator's "promote to real note" action — the
  // only place in the app that creates a note from inside a sheet rather
  // than the file tree. Lands in the vault/workspace root for both backends
  // in v1; the user can move it via the file tree afterward like any note.
  createNote(name: string, frontmatter: Record<string, unknown>, body?: string): Promise<{ title: string }>
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
  readFrontmatterByRef: (ref: string) => Promise<Record<string, unknown>>
): NoteRefApi {
  async function findExact(title: string, type?: string): Promise<{ title: string; ref: string } | undefined> {
    const matches = await searchTitles(title, type)
    return matches.find((m) => m.title.toLowerCase() === title.toLowerCase())
  }

  return {
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
    async createNote(name, frontmatter, body = '') {
      return createNoteImpl(name, frontmatter, body)
    }
  }
}

export function useLocalNoteRefApi(): NoteRefApi {
  const openNote = useEditorStore((s) => s.openNote)
  const vaultPath = useVaultStore((s) => s.vaultPath)
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
        async (path) => parseNote((await window.vaultApi.readNote(path)).content).frontmatter
      ),
    [openNote, vaultPath]
  )
}

export function useCloudNoteRefApi(): NoteRefApi {
  const openNote = useCloudEditorStore((s) => s.openNote)
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
        async (id) => (await window.cloudApi.getNote(id)).frontmatter
      ),
    [openNote]
  )
}
