import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEditorStore } from '../../src/renderer/src/state/editorStore'

const VERSION_A = { mtimeMs: 1000, contentHash: 'hash-a' }
const VERSION_B = { mtimeMs: 2000, contentHash: 'hash-b' }

const NOTE_A = { path: '/vault/a.md', content: 'original content', version: VERSION_A }
const NOTE_B = { path: '/vault/b.md', content: 'note b content', version: VERSION_B }

function mockVaultApi(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): void {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
    vaultApi: {
      readNote: vi.fn().mockResolvedValue(NOTE_A),
      saveNote: vi.fn(),
      ...overrides
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  mockVaultApi()
  useEditorStore.setState({
    activeNotePath: null,
    content: '',
    revision: 0,
    dirty: false,
    baseVersion: null,
    conflict: null,
    externalChangePending: false
  })
})

describe('editorStore', () => {
  it('openNote loads the note and resets dirty/conflict state', async () => {
    await useEditorStore.getState().openNote('/vault/a.md')
    const state = useEditorStore.getState()

    expect(state.activeNotePath).toBe('/vault/a.md')
    expect(state.content).toBe('original content')
    expect(state.baseVersion).toEqual(VERSION_A)
    expect(state.dirty).toBe(false)
  })

  it('setContent marks dirty immediately and autosaves after the debounce delay', async () => {
    await useEditorStore.getState().openNote('/vault/a.md')
    const saveNote = (window as unknown as { vaultApi: { saveNote: ReturnType<typeof vi.fn> } }).vaultApi.saveNote
    saveNote.mockResolvedValue({ status: 'saved', version: VERSION_B })

    useEditorStore.getState().setContent('edited content')
    expect(useEditorStore.getState().dirty).toBe(true)
    expect(saveNote).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(saveNote).toHaveBeenCalledWith({ path: '/vault/a.md', content: 'edited content', baseVersion: VERSION_A })
    expect(useEditorStore.getState().dirty).toBe(false)
    expect(useEditorStore.getState().baseVersion).toEqual(VERSION_B)
  })

  it('saveNow does nothing when there are no unsaved changes', async () => {
    await useEditorStore.getState().openNote('/vault/a.md')
    const saveNote = (window as unknown as { vaultApi: { saveNote: ReturnType<typeof vi.fn> } }).vaultApi.saveNote

    await useEditorStore.getState().saveNow()

    expect(saveNote).not.toHaveBeenCalled()
  })

  it('a failed save leaves dirty:true so a later save attempt can retry, instead of silently giving up', async () => {
    await useEditorStore.getState().openNote('/vault/a.md')
    const saveNote = (window as unknown as { vaultApi: { saveNote: ReturnType<typeof vi.fn> } }).vaultApi.saveNote
    saveNote.mockRejectedValueOnce(new Error('disk write failed'))

    useEditorStore.getState().setContent('edited content')
    await vi.runAllTimersAsync()

    expect(useEditorStore.getState().dirty).toBe(true)
    expect(useEditorStore.getState().content).toBe('edited content')
  })

  // Regression test for a real data-loss bug: switching to a different note
  // (or closing the current one) used to just clearTimeout the pending
  // debounced autosave and move on, silently discarding an edit that
  // hadn't reached its 1.5s quiet window yet — e.g. a just-run Settlement
  // Generate, followed by clicking a different note in the sidebar before
  // the debounce fired.
  it('openNote flushes a pending dirty edit on the currently open note before switching away', async () => {
    await useEditorStore.getState().openNote('/vault/a.md')
    const saveNote = (window as unknown as { vaultApi: { saveNote: ReturnType<typeof vi.fn> } }).vaultApi.saveNote
    saveNote.mockResolvedValue({ status: 'saved', version: VERSION_B })

    useEditorStore.getState().setContentExternal('edited via SheetView (e.g. Settlement Generate)')
    expect(useEditorStore.getState().dirty).toBe(true)

    // Switch to a different note WITHOUT letting the 1.5s debounce fire —
    // openNote itself must flush the pending save first.
    const readNote = (window as unknown as { vaultApi: { readNote: ReturnType<typeof vi.fn> } }).vaultApi.readNote
    readNote.mockResolvedValue(NOTE_B)
    await useEditorStore.getState().openNote('/vault/b.md')

    expect(saveNote).toHaveBeenCalledWith({
      path: '/vault/a.md',
      content: 'edited via SheetView (e.g. Settlement Generate)',
      baseVersion: VERSION_A
    })
    expect(useEditorStore.getState().activeNotePath).toBe('/vault/b.md')
  })

  it('closeNote flushes a pending dirty edit before clearing note state', async () => {
    await useEditorStore.getState().openNote('/vault/a.md')
    const saveNote = (window as unknown as { vaultApi: { saveNote: ReturnType<typeof vi.fn> } }).vaultApi.saveNote
    saveNote.mockResolvedValue({ status: 'saved', version: VERSION_B })

    useEditorStore.getState().setContent('edited content')
    useEditorStore.getState().closeNote()
    // closeNote's flush is fire-and-forget (the action itself isn't
    // async) — flush the microtask queue so its internal saveNow() (a
    // single already-mocked-resolved fetch, no real timers involved)
    // actually completes before asserting.
    await Promise.resolve()
    await Promise.resolve()

    expect(saveNote).toHaveBeenCalledWith({ path: '/vault/a.md', content: 'edited content', baseVersion: VERSION_A })
  })

  it('closeNote clears all note state', async () => {
    await useEditorStore.getState().openNote('/vault/a.md')
    useEditorStore.getState().closeNote()

    const state = useEditorStore.getState()
    expect(state.activeNotePath).toBeNull()
    expect(state.content).toBe('')
    expect(state.dirty).toBe(false)
  })
})
