import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTravelModesStore } from '../../src/renderer/src/state/travelModesStore'

const EXISTING_NOTE = {
  id: 'travel-modes-1',
  name: 'Travel Modes',
  frontmatter: { type: 'travel-modes', tags: [], modes: [{ id: 'walking', name: 'Walking', speed: 3, timeUnitLabel: 'hours' }] },
  version: 1
}

function mockCloudApi(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): void {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
    cloudApi: {
      getCachedTree: vi.fn().mockResolvedValue(null),
      refreshTree: vi.fn().mockResolvedValue([]),
      getNote: vi.fn().mockResolvedValue(EXISTING_NOTE),
      createNote: vi.fn().mockResolvedValue({ id: 'new-note-1', version: 0 }),
      ...overrides
    }
  }
}

beforeEach(() => {
  mockCloudApi()
  useTravelModesStore.setState({ noteId: null, version: 0, frontmatter: null, loading: false })
})

describe('travelModesStore.load', () => {
  it('creates the note when none exists in the tree', async () => {
    await useTravelModesStore.getState().load()

    const win = globalThis as unknown as { window: { cloudApi: { createNote: ReturnType<typeof vi.fn> } } }
    expect(win.window.cloudApi.createNote).toHaveBeenCalledTimes(1)
    expect(useTravelModesStore.getState().noteId).toBe('new-note-1')
  })

  it('finds and loads an existing note instead of creating a duplicate', async () => {
    mockCloudApi({
      refreshTree: vi.fn().mockResolvedValue([{ id: 'travel-modes-1', name: 'Travel Modes', isDirectory: false, noteType: 'travel-modes' }])
    })

    await useTravelModesStore.getState().load()

    const win = globalThis as unknown as { window: { cloudApi: { createNote: ReturnType<typeof vi.fn>; getNote: ReturnType<typeof vi.fn> } } }
    expect(win.window.cloudApi.createNote).not.toHaveBeenCalled()
    expect(win.window.cloudApi.getNote).toHaveBeenCalledWith('travel-modes-1')
    expect(useTravelModesStore.getState().noteId).toBe('travel-modes-1')
  })

  // Regression test for the actual bug reported: MapSheet, MapTripCalculator,
  // and TravelModesEditor each mount their own "if (!noteId && !loading)
  // load()" effect when a map note opens, all firing before any of them
  // observes the others' in-flight state — without the module-level
  // in-flight-promise guard, this used to create up to 3 duplicate "Travel
  // Modes" notes from one map open.
  it('only creates one note when load() is called concurrently by multiple mounted components', async () => {
    const [a, b, c] = [useTravelModesStore.getState().load(), useTravelModesStore.getState().load(), useTravelModesStore.getState().load()]
    await Promise.all([a, b, c])

    const win = globalThis as unknown as { window: { cloudApi: { createNote: ReturnType<typeof vi.fn> } } }
    expect(win.window.cloudApi.createNote).toHaveBeenCalledTimes(1)
    expect(useTravelModesStore.getState().noteId).toBe('new-note-1')
  })

  it('does nothing on a second call once a note is already loaded', async () => {
    await useTravelModesStore.getState().load()
    await useTravelModesStore.getState().load()

    const win = globalThis as unknown as { window: { cloudApi: { createNote: ReturnType<typeof vi.fn> } } }
    expect(win.window.cloudApi.createNote).toHaveBeenCalledTimes(1)
  })
})
