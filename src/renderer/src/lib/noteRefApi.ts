import { useMemo } from 'react'
import { parseNote } from '../../../common/frontmatter'
import { useEditorStore } from '../state/editorStore'
import { useCloudEditorStore } from '../state/cloudEditorStore'

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
}

// Exported for direct testing (tests/noteRefApi.test.ts) — the two hooks
// below are thin, barely-testable wiring around window.vaultApi/cloudApi
// and a React hook context; this factory is where the actual
// find-exact-or-alert logic (and its risk of regressing) lives.
export function createNoteRefApi(
  searchTitles: (query: string, type?: string) => Promise<{ title: string; ref: string }[]>,
  openByRef: (ref: string) => Promise<void>,
  readBodyByRef: (ref: string) => Promise<string>
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
    }
  }
}

export function useLocalNoteRefApi(): NoteRefApi {
  const openNote = useEditorStore((s) => s.openNote)
  return useMemo(
    () =>
      createNoteRefApi(
        async (query, type) =>
          (await window.vaultApi.searchTitles(query, type)).map((m) => ({ title: m.title, ref: m.path })),
        (path) => openNote(path),
        async (path) => parseNote((await window.vaultApi.readNote(path)).content).body
      ),
    [openNote]
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
        async (id) => (await window.cloudApi.getNote(id)).body
      ),
    [openNote]
  )
}
