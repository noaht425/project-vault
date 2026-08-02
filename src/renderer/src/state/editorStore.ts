import { create } from 'zustand'
import type { FileVersion } from '../../../common/types'

const AUTOSAVE_DELAY_MS = 1500

interface ConflictInfo {
  conflictPath: string
}

interface EditorState {
  activeNotePath: string | null
  content: string
  /** Bumped whenever `content` is set by something other than the user
   *  typing (opening a note, reloading after a conflict) — the editor
   *  component uses this to know when it must re-sync its own buffer. */
  revision: number
  dirty: boolean
  baseVersion: FileVersion | null
  conflict: ConflictInfo | null
  externalChangePending: boolean
  openNote: (path: string) => Promise<void>
  closeNote: () => void
  setContent: (content: string) => void
  setContentExternal: (content: string) => void
  saveNow: () => Promise<void>
  reloadFromDisk: () => Promise<void>
  dismissConflict: () => void
  markExternalChangePending: (path: string) => void
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

export const useEditorStore = create<EditorState>((set, get) => ({
  activeNotePath: null,
  content: '',
  revision: 0,
  dirty: false,
  baseVersion: null,
  conflict: null,
  externalChangePending: false,

  openNote: async (path) => {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    const note = await window.vaultApi.readNote(path)
    set((s) => ({
      activeNotePath: note.path,
      content: note.content,
      revision: s.revision + 1,
      baseVersion: note.version,
      dirty: false,
      conflict: null,
      externalChangePending: false
    }))
  },

  setContent: (content) => {
    set({ content, dirty: true })
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      void get().saveNow()
    }, AUTOSAVE_DELAY_MS)
  },

  // Same as setContent, but for edits that DIDN'T come from the CodeMirror
  // buffer itself (the SheetView form editing frontmatter). Bumping
  // revision forces the editor to resync its buffer from this new content
  // — without it, CodeMirror would keep showing stale frontmatter, and the
  // next keystroke there would blow away whatever SheetView just wrote.
  setContentExternal: (content) => {
    set((s) => ({ content, dirty: true, revision: s.revision + 1 }))
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      void get().saveNow()
    }, AUTOSAVE_DELAY_MS)
  },

  saveNow: async () => {
    const { activeNotePath, content, baseVersion, dirty } = get()
    if (!activeNotePath || !dirty) return
    try {
      const result = await window.vaultApi.saveNote({ path: activeNotePath, content, baseVersion })
      if (result.status === 'saved') {
        set({ baseVersion: result.version, dirty: false, externalChangePending: false })
      } else {
        set({ conflict: { conflictPath: result.conflictPath }, dirty: false })
      }
    } catch (err) {
      // Leave dirty:true on failure — nothing else retries a failed save
      // automatically, so the next edit (or the flush-before-quit path in
      // App.tsx) gets another chance instead of the failure being silent
      // and permanent. A large note (e.g. a generated Settlement) can be
      // slow enough to serialize/write that a transient failure here is
      // the difference between the last edit surviving a quit or not.
      console.error('Failed to save note:', err)
    }
  },

  reloadFromDisk: async () => {
    const { activeNotePath } = get()
    if (!activeNotePath) return
    if (autosaveTimer) clearTimeout(autosaveTimer)
    const note = await window.vaultApi.readNote(activeNotePath)
    set((s) => ({
      content: note.content,
      revision: s.revision + 1,
      baseVersion: note.version,
      dirty: false,
      conflict: null,
      externalChangePending: false
    }))
  },

  closeNote: () => {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    set((s) => ({
      activeNotePath: null,
      content: '',
      revision: s.revision + 1,
      dirty: false,
      baseVersion: null,
      conflict: null,
      externalChangePending: false
    }))
  },

  dismissConflict: () => set({ conflict: null }),

  markExternalChangePending: (path) => {
    if (get().activeNotePath === path && get().dirty) {
      set({ externalChangePending: true })
    }
  }
}))
