import { create } from 'zustand'
import type { CloudNoteData } from '../../../common/cloudTypes'

const AUTOSAVE_DELAY_MS = 1500

interface CloudEditorState {
  activeNote: CloudNoteData | null
  body: string
  frontmatter: Record<string, unknown>
  /** Bumped whenever `body`/`frontmatter` are replaced by something other
   *  than the user typing/the SheetView form (opening a note, discarding a
   *  conflict) — CloudEditor uses this to know when it must re-sync its own
   *  CodeMirror buffer. SheetView doesn't need this: it's a plain React
   *  component that re-renders from `frontmatter` props on its own. */
  revision: number
  dirty: boolean
  /** True for the duration of an in-flight saveNote call — see
   *  editorStore.ts's own field for the full reasoning (same fix, mirrored
   *  here). */
  saving: boolean
  /** Set when saveNow's call throws — previously only logged to the
   *  (invisible to a normal user) devtools console. Cleared at the start
   *  of the next save attempt. */
  saveError: string | null
  /** The server's current row, only set right after a 409 — nothing has
   *  been lost, the local edit just hasn't been persisted yet. See
   *  retrySaveWithLatestVersion/discardAndReloadFromConflict. */
  conflict: CloudNoteData | null
  openNote: (id: string) => Promise<void>
  setBody: (body: string) => void
  setFrontmatter: (frontmatter: Record<string, unknown>) => void
  saveNow: () => Promise<void>
  retrySaveWithLatestVersion: () => Promise<void>
  discardAndReloadFromConflict: () => void
  closeNote: () => void
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutosave(saveNow: () => Promise<void>): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS)
}

// Same reasoning as editorStore.ts's own withTimeout — doesn't cancel the
// underlying network request, just stops the renderer waiting forever;
// the existing version-conflict check is what keeps a late-arriving
// response from silently clobbering anything.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s — the note may be too large, or something else is stuck.`)),
        ms
      )
    )
  ])
}

const SAVE_TIMEOUT_MS = 60000

export const useCloudEditorStore = create<CloudEditorState>((set, get) => ({
  activeNote: null,
  body: '',
  frontmatter: {},
  revision: 0,
  dirty: false,
  saving: false,
  saveError: null,
  conflict: null,

  openNote: async (id) => {
    // Flush whatever's pending on the CURRENTLY open note before switching
    // away — see editorStore.ts's openNote for the full reasoning (same
    // fix, same bug, mirrored here for Cloud Workspace).
    await get().saveNow()
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    const note = await window.cloudApi.getNote(id)
    set((s) => ({
      activeNote: note,
      body: note.body,
      frontmatter: note.frontmatter,
      revision: s.revision + 1,
      dirty: false,
      saveError: null,
      conflict: null
    }))
  },

  setBody: (body) => {
    set({ body, dirty: true })
    scheduleAutosave(get().saveNow)
  },

  setFrontmatter: (frontmatter) => {
    set({ frontmatter, dirty: true })
    scheduleAutosave(get().saveNow)
  },

  saveNow: async () => {
    const { activeNote, body, frontmatter, dirty } = get()
    if (!activeNote || !dirty) return
    set({ saving: true, saveError: null })
    try {
      const result = await withTimeout(
        window.cloudApi.saveNote({ id: activeNote.id, version: activeNote.version, body, frontmatter }),
        SAVE_TIMEOUT_MS,
        'Save'
      )
      if (result.status === 'saved') {
        set({
          activeNote: result.note,
          body: result.note.body,
          frontmatter: result.note.frontmatter,
          dirty: false,
          saving: false,
          saveError: null,
          conflict: null
        })
      } else {
        // Deliberately doesn't touch `body`/`frontmatter` — the local edit
        // stays exactly as made, just unsaved, until retry/discard below.
        set({ conflict: result.current, saving: false, saveError: null })
      }
    } catch (err) {
      // Leave dirty:true on failure (e.g. an expired session, or a dropped
      // network request) so a retry — the next edit, or the
      // flush-before-quit path in App.tsx — gets another chance instead of
      // the failure being silent and permanent. saveError now actually
      // surfaces WHY instead of only ever reaching the devtools console.
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to save cloud note:', err)
      set({ saving: false, saveError: message })
    }
  },

  // "Last write wins, on purpose": adopt the server's version so the next
  // save lands, but keep this session's body/frontmatter — the whole point
  // of asking rather than silently overwriting is that a person is here to
  // make that call, not an automated merge.
  retrySaveWithLatestVersion: async () => {
    const { conflict, activeNote } = get()
    if (!conflict || !activeNote) return
    set({ activeNote: { ...activeNote, version: conflict.version }, conflict: null, dirty: true })
    await get().saveNow()
  },

  discardAndReloadFromConflict: () => {
    const { conflict } = get()
    if (!conflict) return
    set((s) => ({
      activeNote: conflict,
      body: conflict.body,
      frontmatter: conflict.frontmatter,
      revision: s.revision + 1,
      dirty: false,
      saveError: null,
      conflict: null
    }))
  },

  closeNote: () => {
    // Same reasoning as editorStore.ts's closeNote — fire-and-forget is
    // safe since saveNow() reads state synchronously before its own first
    // await, ahead of the set() below.
    void get().saveNow()
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    set((s) => ({ activeNote: null, body: '', frontmatter: {}, revision: s.revision + 1, dirty: false, saveError: null, conflict: null }))
  }
}))
