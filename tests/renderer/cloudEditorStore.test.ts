import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useCloudEditorStore } from '../../src/renderer/src/state/cloudEditorStore'

const NOTE_A = {
  id: 'note-1',
  name: 'Alice',
  folderId: null,
  frontmatter: { type: 'npc' },
  body: 'original body',
  noteType: 'npc',
  version: 1
}

function mockCloudApi(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): void {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
    cloudApi: {
      getNote: vi.fn().mockResolvedValue(NOTE_A),
      saveNote: vi.fn(),
      ...overrides
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  mockCloudApi()
  useCloudEditorStore.setState({
    activeNote: null,
    body: '',
    frontmatter: {},
    revision: 0,
    dirty: false,
    conflict: null
  })
})

describe('cloudEditorStore', () => {
  it('openNote loads the note and resets dirty/conflict state', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const state = useCloudEditorStore.getState()

    expect(state.activeNote).toEqual(NOTE_A)
    expect(state.body).toBe('original body')
    expect(state.frontmatter).toEqual({ type: 'npc' })
    expect(state.dirty).toBe(false)
    expect(state.conflict).toBeNull()
  })

  it('setBody marks dirty immediately and autosaves after the debounce delay', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const saveNote = (window as unknown as { cloudApi: { saveNote: ReturnType<typeof vi.fn> } }).cloudApi.saveNote
    saveNote.mockResolvedValue({ status: 'saved', note: { ...NOTE_A, body: 'edited body', version: 2 } })

    useCloudEditorStore.getState().setBody('edited body')
    expect(useCloudEditorStore.getState().dirty).toBe(true)
    expect(saveNote).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(saveNote).toHaveBeenCalledWith({ id: 'note-1', version: 1, body: 'edited body', frontmatter: { type: 'npc' } })
    expect(useCloudEditorStore.getState().dirty).toBe(false)
    expect(useCloudEditorStore.getState().activeNote?.version).toBe(2)
  })

  it('setFrontmatter marks dirty and autosaves the same way as setBody', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const saveNote = (window as unknown as { cloudApi: { saveNote: ReturnType<typeof vi.fn> } }).cloudApi.saveNote
    saveNote.mockResolvedValue({ status: 'saved', note: { ...NOTE_A, frontmatter: { type: 'npc', role: 'Guard' }, version: 2 } })

    useCloudEditorStore.getState().setFrontmatter({ type: 'npc', role: 'Guard' })
    await vi.runAllTimersAsync()

    expect(saveNote).toHaveBeenCalledWith({
      id: 'note-1',
      version: 1,
      body: 'original body',
      frontmatter: { type: 'npc', role: 'Guard' }
    })
    expect(useCloudEditorStore.getState().frontmatter).toEqual({ type: 'npc', role: 'Guard' })
  })

  it('saveNow does nothing when there are no unsaved changes', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const saveNote = (window as unknown as { cloudApi: { saveNote: ReturnType<typeof vi.fn> } }).cloudApi.saveNote

    await useCloudEditorStore.getState().saveNow()

    expect(saveNote).not.toHaveBeenCalled()
  })

  // The whole point of the conflict flow: a 409 keeps the user's in-progress
  // edit exactly as typed, never silently overwritten by the server's copy.
  it('a save conflict preserves the local edit and surfaces the server copy separately', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const conflictNote = { ...NOTE_A, body: 'someone else changed this', version: 9 }
    const saveNote = (window as unknown as { cloudApi: { saveNote: ReturnType<typeof vi.fn> } }).cloudApi.saveNote
    saveNote.mockResolvedValue({ status: 'conflict', current: conflictNote })

    useCloudEditorStore.getState().setBody('my in-progress edit')
    await vi.runAllTimersAsync()

    const state = useCloudEditorStore.getState()
    expect(state.body).toBe('my in-progress edit')
    expect(state.conflict).toEqual(conflictNote)
    expect(state.dirty).toBe(true)
  })

  it('discardAndReloadFromConflict replaces local state with the server copy', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const conflictNote = { ...NOTE_A, body: 'server copy', frontmatter: { type: 'npc', role: 'Guard' }, version: 9 }
    useCloudEditorStore.setState({ conflict: conflictNote, body: 'my edit', dirty: true })

    useCloudEditorStore.getState().discardAndReloadFromConflict()

    const state = useCloudEditorStore.getState()
    expect(state.activeNote).toEqual(conflictNote)
    expect(state.body).toBe('server copy')
    expect(state.frontmatter).toEqual({ type: 'npc', role: 'Guard' })
    expect(state.conflict).toBeNull()
    expect(state.dirty).toBe(false)
  })

  it('retrySaveWithLatestVersion adopts the conflicting version and saves the local edit anyway', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const conflictNote = { ...NOTE_A, version: 9 }
    const saveNote = (window as unknown as { cloudApi: { saveNote: ReturnType<typeof vi.fn> } }).cloudApi.saveNote
    saveNote.mockResolvedValue({ status: 'saved', note: { ...NOTE_A, body: 'my edit anyway', version: 10 } })
    useCloudEditorStore.setState({ conflict: conflictNote, body: 'my edit anyway', dirty: true })

    await useCloudEditorStore.getState().retrySaveWithLatestVersion()

    expect(saveNote).toHaveBeenCalledWith({ id: 'note-1', version: 9, body: 'my edit anyway', frontmatter: { type: 'npc' } })
    expect(useCloudEditorStore.getState().conflict).toBeNull()
    expect(useCloudEditorStore.getState().activeNote?.version).toBe(10)
  })

  it('closeNote clears all note state', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    useCloudEditorStore.getState().closeNote()

    const state = useCloudEditorStore.getState()
    expect(state.activeNote).toBeNull()
    expect(state.body).toBe('')
    expect(state.frontmatter).toEqual({})
    expect(state.dirty).toBe(false)
  })

  // Regression test for a real data-loss bug: switching to a different note
  // (or closing the current one) used to just clearTimeout the pending
  // debounced autosave and move on, silently discarding an edit that
  // hadn't reached its 1.5s quiet window yet — e.g. a just-run Settlement
  // Generate, followed by clicking a different note in the sidebar before
  // the debounce fired.
  it('openNote flushes a pending dirty edit on the currently open note before switching away', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const saveNote = (window as unknown as { cloudApi: { saveNote: ReturnType<typeof vi.fn> } }).cloudApi.saveNote
    saveNote.mockResolvedValue({ status: 'saved', note: { ...NOTE_A, body: 'edited body', version: 2 } })

    useCloudEditorStore.getState().setBody('edited body')
    expect(useCloudEditorStore.getState().dirty).toBe(true)

    // Switch to a different note WITHOUT letting the 1.5s debounce fire —
    // openNote itself must flush the pending save first.
    const noteB = { ...NOTE_A, id: 'note-2', name: 'Bob', body: 'note b body' }
    const getNote = (window as unknown as { cloudApi: { getNote: ReturnType<typeof vi.fn> } }).cloudApi.getNote
    getNote.mockResolvedValue(noteB)
    await useCloudEditorStore.getState().openNote('note-2')

    expect(saveNote).toHaveBeenCalledWith({ id: 'note-1', version: 1, body: 'edited body', frontmatter: { type: 'npc' } })
    expect(useCloudEditorStore.getState().activeNote?.id).toBe('note-2')
  })

  it('closeNote flushes a pending dirty edit before clearing note state', async () => {
    await useCloudEditorStore.getState().openNote('note-1')
    const saveNote = (window as unknown as { cloudApi: { saveNote: ReturnType<typeof vi.fn> } }).cloudApi.saveNote
    saveNote.mockResolvedValue({ status: 'saved', note: { ...NOTE_A, body: 'edited body', version: 2 } })

    useCloudEditorStore.getState().setBody('edited body')
    useCloudEditorStore.getState().closeNote()
    // closeNote's flush is fire-and-forget (the action itself isn't
    // async) — flush the microtask queue so its internal saveNow() (a
    // single already-mocked-resolved fetch, no real timers involved)
    // actually completes before asserting.
    await Promise.resolve()
    await Promise.resolve()

    expect(saveNote).toHaveBeenCalledWith({ id: 'note-1', version: 1, body: 'edited body', frontmatter: { type: 'npc' } })
  })
})
