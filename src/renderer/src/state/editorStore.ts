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
  /** True for the duration of an in-flight saveNote IPC call — lets the UI
   *  distinguish "still working on a big save" from "stuck/failed", since
   *  a large Settlement note's save can genuinely take a while even after
   *  the stringify itself got fast (see common/frontmatter.ts's noRefs
   *  comment) — the IPC transfer and disk write of tens of megabytes isn't
   *  instant either. */
  saving: boolean
  /** Set when saveNow's IPC call throws — previously only logged to the
   *  (invisible to a normal user) devtools console, so a genuinely failing
   *  save looked identical to "just still working" from the UI. Cleared at
   *  the start of the next save attempt. */
  saveError: string | null
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

// Doesn't cancel the underlying IPC call (there's no clean way to abort an
// in-flight ipcRenderer.invoke) — it just stops the renderer from waiting
// on it forever. A save that times out may still land on disk moments
// later; if a retry ALSO succeeds in the meantime, the existing baseVersion
// optimistic-concurrency check (the same mechanism that already handles a
// real external edit) is what keeps that from silently corrupting
// anything — worst case is a spurious conflict banner, never lost data.
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

export const useEditorStore = create<EditorState>((set, get) => ({
  activeNotePath: null,
  content: '',
  revision: 0,
  dirty: false,
  saving: false,
  saveError: null,
  baseVersion: null,
  conflict: null,
  externalChangePending: false,

  openNote: async (path) => {
    // Flush whatever's pending on the CURRENTLY open note before switching
    // away — this used to just clearTimeout the debounce and move on,
    // silently discarding an edit (e.g. a just-run Settlement Generate)
    // that hadn't reached its 1.5s quiet window yet. saveNow() is itself a
    // no-op when nothing is dirty, so this is free the vast majority of
    // the time.
    await get().saveNow()
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    const note = await window.vaultApi.readNote(path)
    set((s) => ({
      activeNotePath: note.path,
      content: note.content,
      revision: s.revision + 1,
      baseVersion: note.version,
      dirty: false,
      saveError: null,
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
    set({ saving: true, saveError: null })
    try {
      const result = await withTimeout(window.vaultApi.saveNote({ path: activeNotePath, content, baseVersion }), SAVE_TIMEOUT_MS, 'Save')
      if (result.status === 'saved') {
        set({ baseVersion: result.version, dirty: false, externalChangePending: false, saving: false, saveError: null })
      } else {
        set({ conflict: { conflictPath: result.conflictPath }, dirty: false, saving: false, saveError: null })
      }
    } catch (err) {
      // Leave dirty:true on failure — nothing else retries a failed save
      // automatically, so the next edit (or the flush-before-quit path in
      // App.tsx) gets another chance instead of the failure being silent
      // and permanent. saveError now actually surfaces WHY, instead of
      // only ever reaching the (invisible to a normal user) devtools
      // console — this was the actual gap: a failing save looked
      // identical to "still working" from the UI, with no way to tell
      // them apart.
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to save note:', err)
      set({ saving: false, saveError: message })
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
      saveError: null,
      conflict: null,
      externalChangePending: false
    }))
  },

  closeNote: () => {
    // Unlike openNote, this must NOT flush a pending save: closeNote's only
    // caller (FileTree's delete handler) invokes it after the file is
    // already gone from disk. Saving stale dirty content at that point
    // would race fileWriteQueue's optimistic-concurrency check — it sees
    // "file missing but I still have a baseVersion" as unsafe and writes
    // the content back out as a new `-conflict-*.md` file, resurrecting a
    // note the user just deleted. Discard instead.
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    set((s) => ({
      activeNotePath: null,
      content: '',
      revision: s.revision + 1,
      dirty: false,
      saveError: null,
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
