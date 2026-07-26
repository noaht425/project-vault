import { create } from 'zustand'
import type { CloudNoteData } from '../../../common/cloudTypes'

const AUTOSAVE_DELAY_MS = 1500

interface CloudEditorState {
  activeNote: CloudNoteData | null
  body: string
  /** Bumped whenever `body` is replaced by something other than the user
   *  typing (opening a note, discarding a conflict) — CloudEditor uses this
   *  to know when it must re-sync its own CodeMirror buffer. */
  revision: number
  dirty: boolean
  /** The server's current row, only set right after a 409 — nothing has
   *  been lost, the local edit just hasn't been persisted yet. See
   *  retrySaveWithLatestVersion/discardAndReloadFromConflict. */
  conflict: CloudNoteData | null
  openNote: (id: string) => Promise<void>
  setBody: (body: string) => void
  saveNow: () => Promise<void>
  retrySaveWithLatestVersion: () => Promise<void>
  discardAndReloadFromConflict: () => void
  closeNote: () => void
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

export const useCloudEditorStore = create<CloudEditorState>((set, get) => ({
  activeNote: null,
  body: '',
  revision: 0,
  dirty: false,
  conflict: null,

  openNote: async (id) => {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    const note = await window.cloudApi.getNote(id)
    set((s) => ({ activeNote: note, body: note.body, revision: s.revision + 1, dirty: false, conflict: null }))
  },

  setBody: (body) => {
    set({ body, dirty: true })
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      void get().saveNow()
    }, AUTOSAVE_DELAY_MS)
  },

  saveNow: async () => {
    const { activeNote, body, dirty } = get()
    if (!activeNote || !dirty) return
    const result = await window.cloudApi.saveNote({ id: activeNote.id, version: activeNote.version, body })
    if (result.status === 'saved') {
      set({ activeNote: result.note, dirty: false, conflict: null })
    } else {
      // Deliberately doesn't touch `body` — the local edit stays exactly as
      // typed, just unsaved, until the user picks retry or discard below.
      set({ conflict: result.current })
    }
  },

  // "Last write wins, on purpose": adopt the server's version so the next
  // save lands, but keep this session's body — the whole point of asking
  // rather than silently overwriting is that a person is here to make that
  // call, not an automated merge.
  retrySaveWithLatestVersion: async () => {
    const { conflict, activeNote } = get()
    if (!conflict || !activeNote) return
    set({ activeNote: { ...activeNote, version: conflict.version }, conflict: null, dirty: true })
    await get().saveNow()
  },

  discardAndReloadFromConflict: () => {
    const { conflict } = get()
    if (!conflict) return
    set((s) => ({ activeNote: conflict, body: conflict.body, revision: s.revision + 1, dirty: false, conflict: null }))
  },

  closeNote: () => {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    set((s) => ({ activeNote: null, body: '', revision: s.revision + 1, dirty: false, conflict: null }))
  }
}))
