import { describe, it, expect, vi } from 'vitest'
import {
  translateCloudNoteForLocal,
  translateLocalNoteForCloud,
  mergeMapPins,
  type CloudToLocalMediaApi,
  type LocalToCloudMediaApi
} from '../../src/renderer/src/lib/migrationNoteTypeHooks'

describe('mergeMapPins', () => {
  const pin = (id: string, label = id): { id: string; x: number; y: number; locationTitle: null; label: string } => ({
    id,
    x: 0,
    y: 0,
    locationTitle: null,
    label
  })

  it('adds a pin the destination is missing', () => {
    const dest = { type: 'map', pins: [pin('a')] }
    const source = { type: 'map', pins: [pin('a'), pin('b')] }

    const result = mergeMapPins(dest, source)

    expect(result).toEqual({ pins: [pin('a'), pin('b')], addedCount: 1 })
  })

  it('returns null when the destination already has every pin the source has (nothing to do)', () => {
    const dest = { type: 'map', pins: [pin('a'), pin('b')] }
    const source = { type: 'map', pins: [pin('a')] }

    expect(mergeMapPins(dest, source)).toBeNull()
  })

  it('returns null when neither side has any pins at all', () => {
    expect(mergeMapPins({ type: 'map', pins: [] }, { type: 'map', pins: [] })).toBeNull()
  })

  it('on an id collision, keeps the destination\'s own pin rather than the source\'s', () => {
    const dest = { type: 'map', pins: [pin('a', 'dest label')] }
    const source = { type: 'map', pins: [pin('a', 'source label'), pin('b')] }

    const result = mergeMapPins(dest, source)

    expect(result?.pins).toContainEqual(pin('a', 'dest label'))
    expect(result?.pins).not.toContainEqual(pin('a', 'source label'))
    expect(result?.addedCount).toBe(1)
  })

  it('returns null when either side is not a map note', () => {
    expect(mergeMapPins({ type: 'npc' }, { type: 'map', pins: [pin('a')] })).toBeNull()
    expect(mergeMapPins({ type: 'map', pins: [] }, { type: 'npc' })).toBeNull()
  })

  it('treats a missing/malformed pins field as an empty array rather than throwing', () => {
    expect(mergeMapPins({ type: 'map' }, { type: 'map', pins: [pin('a')] })).toEqual({ pins: [pin('a')], addedCount: 1 })
    expect(mergeMapPins({ type: 'map', pins: 'not an array' }, { type: 'map', pins: [pin('a')] })).toEqual({
      pins: [pin('a')],
      addedCount: 1
    })
  })
})

describe('translateCloudNoteForLocal', () => {
  function fakeApi(overrides: Partial<CloudToLocalMediaApi> = {}): CloudToLocalMediaApi {
    return {
      downloadMapImage: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      getSettlementBulkData: vi.fn().mockResolvedValue({ residents: [], buildings: [] }),
      saveLocalImageBytes: vi.fn().mockResolvedValue({ path: '.attachments/local-image.png' }),
      ...overrides
    }
  }

  it('downloads and re-saves a map note image, rewriting frontmatter.image.path to the local attachment path', async () => {
    const api = fakeApi()
    const note = { frontmatter: { type: 'map', image: { path: 'user-1/abc.png', width: 800, height: 600 } }, body: '' }

    const result = await translateCloudNoteForLocal(note, api)

    expect(api.downloadMapImage).toHaveBeenCalledWith('user-1/abc.png')
    expect(api.saveLocalImageBytes).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'abc.png')
    expect(result.frontmatter).toEqual({
      type: 'map',
      image: { path: '.attachments/local-image.png', width: 800, height: 600 }
    })
  })

  it('leaves a map note with no image untouched', async () => {
    const api = fakeApi()
    const note = { frontmatter: { type: 'map', image: null }, body: '' }

    const result = await translateCloudNoteForLocal(note, api)

    expect(api.downloadMapImage).not.toHaveBeenCalled()
    expect(result).toEqual(note)
  })

  it('downloads offloaded settlement bulk data and inlines it, dropping the storage pointer', async () => {
    const api = fakeApi({
      getSettlementBulkData: vi.fn().mockResolvedValue({ residents: [{ name: 'Alice' }], buildings: [{ name: 'Inn' }] })
    })
    const note = { frontmatter: { type: 'settlement', bulkDataStoragePath: 'user-1/xyz.json', residents: [], buildings: [] }, body: '' }

    const result = await translateCloudNoteForLocal(note, api)

    expect(api.getSettlementBulkData).toHaveBeenCalledWith('user-1/xyz.json')
    expect(result.frontmatter).toEqual({
      type: 'settlement',
      bulkDataStoragePath: null,
      residents: [{ name: 'Alice' }],
      buildings: [{ name: 'Inn' }]
    })
  })

  it('leaves an already-inline settlement (no bulkDataStoragePath) untouched', async () => {
    const api = fakeApi()
    const note = { frontmatter: { type: 'settlement', residents: [{ name: 'Bob' }], buildings: [] }, body: '' }

    const result = await translateCloudNoteForLocal(note, api)

    expect(api.getSettlementBulkData).not.toHaveBeenCalled()
    expect(result).toEqual(note)
  })

  it('leaves every other note type untouched', async () => {
    const api = fakeApi()
    const note = { frontmatter: { type: 'npc', tags: [] }, body: 'hello' }

    const result = await translateCloudNoteForLocal(note, api)

    expect(result).toEqual(note)
  })
})

describe('translateLocalNoteForCloud', () => {
  function fakeApi(overrides: Partial<LocalToCloudMediaApi> = {}): LocalToCloudMediaApi {
    return {
      getLocalImageUrl: vi.fn().mockResolvedValue('vault-attachment://attachment/x.png'),
      uploadSettlementBulkData: vi.fn().mockResolvedValue({ path: 'user-1/settlement.json' }),
      uploadLocalMapImage: vi.fn().mockResolvedValue({ path: 'user-1/uploaded.png' }),
      ...overrides
    }
  }

  it('uploads a local map image and rewrites frontmatter.image.path to the cloud storage path', async () => {
    const api = fakeApi()
    const note = { frontmatter: { type: 'map', image: { path: '.attachments/local.png', width: 10, height: 20 } }, body: '' }

    const result = await translateLocalNoteForCloud(note, api, () => false)

    expect(api.uploadLocalMapImage).toHaveBeenCalledWith('.attachments/local.png')
    expect(result.frontmatter).toEqual({ type: 'map', image: { path: 'user-1/uploaded.png', width: 10, height: 20 } })
  })

  it('offloads oversized settlement bulk data when shouldOffloadBulkData says to', async () => {
    const api = fakeApi()
    const residents = [{ name: 'Alice' }]
    const buildings = [{ name: 'Inn' }]
    const note = { frontmatter: { type: 'settlement', residents, buildings }, body: '' }

    const result = await translateLocalNoteForCloud(note, api, () => true)

    expect(api.uploadSettlementBulkData).toHaveBeenCalledWith(residents, buildings)
    expect(result.frontmatter).toEqual({
      type: 'settlement',
      residents: [],
      buildings: [],
      bulkDataStoragePath: 'user-1/settlement.json'
    })
  })

  it('leaves a small settlement inline when shouldOffloadBulkData says not to', async () => {
    const api = fakeApi()
    const note = { frontmatter: { type: 'settlement', residents: [{ name: 'Bob' }], buildings: [] }, body: '' }

    const result = await translateLocalNoteForCloud(note, api, () => false)

    expect(api.uploadSettlementBulkData).not.toHaveBeenCalled()
    expect(result).toEqual(note)
  })

  it('leaves every other note type untouched', async () => {
    const api = fakeApi()
    const note = { frontmatter: { type: 'npc' }, body: 'hello' }

    const result = await translateLocalNoteForCloud(note, api, () => true)

    expect(api.uploadLocalMapImage).not.toHaveBeenCalled()
    expect(api.uploadSettlementBulkData).not.toHaveBeenCalled()
    expect(result).toEqual(note)
  })
})

// Chains the two translate functions against a shared fake "storage" so a
// note's media survives a full round trip through both directions — closer
// to what actually happens when a note gets copied one way and then copied
// back (docs/plans/2026-08-04-cloud-to-local-copy.md Phase 7's explicit
// round-trip requirement), without needing a real Electron/Supabase
// integration harness (none exists anywhere in this repo — see
// tests/cloudSession.test.ts for the same "mock the network boundary,
// exercise the real logic" approach used elsewhere for CloudSession itself).
describe('Map/Settlement round trip', () => {
  it('a map note image survives local -> cloud -> local with dimensions and a valid attachment path intact', async () => {
    const cloudStorage = new Map<string, ArrayBuffer>()
    let nextId = 1

    const localToCloud: LocalToCloudMediaApi = {
      getLocalImageUrl: async () => '',
      uploadSettlementBulkData: async () => ({ path: '' }),
      uploadLocalMapImage: async (path) => {
        const cloudPath = `cloud-storage/${nextId++}.png`
        cloudStorage.set(cloudPath, new TextEncoder().encode(`bytes-for-${path}`).buffer as ArrayBuffer)
        return { path: cloudPath }
      }
    }
    const cloudToLocal: CloudToLocalMediaApi = {
      downloadMapImage: async (path) => {
        const bytes = cloudStorage.get(path)
        if (!bytes) throw new Error(`not found: ${path}`)
        return bytes
      },
      getSettlementBulkData: async () => ({ residents: [], buildings: [] }),
      saveLocalImageBytes: async (_bytes, suggestedName) => ({ path: `.attachments/${nextId++}-${suggestedName}` })
    }

    const localNote = {
      frontmatter: { type: 'map', image: { path: '.attachments/original-map.png', width: 800, height: 600 } },
      body: ''
    }

    const cloudNote = await translateLocalNoteForCloud(localNote, localToCloud, () => false)
    const roundTripped = await translateCloudNoteForLocal(cloudNote, cloudToLocal)

    const image = roundTripped.frontmatter.image as { path: string; width: number; height: number }
    expect(image.width).toBe(800)
    expect(image.height).toBe(600)
    expect(image.path.startsWith('.attachments/')).toBe(true)
    // The path actually changed (re-saved locally under a new name) — a
    // stale local path pointing at nothing would be the silent-data-loss
    // failure mode this translation exists to prevent.
    expect(image.path).not.toBe('.attachments/original-map.png')
  })

  it('a map note image survives cloud -> local -> cloud with dimensions intact, on both the create and update path', async () => {
    const localStorage = new Map<string, ArrayBuffer>()
    let nextId = 1

    const cloudToLocal: CloudToLocalMediaApi = {
      downloadMapImage: async () => new TextEncoder().encode('cloud bytes').buffer as ArrayBuffer,
      getSettlementBulkData: async () => ({ residents: [], buildings: [] }),
      saveLocalImageBytes: async (bytes, suggestedName) => {
        const localPath = `.attachments/${nextId++}-${suggestedName}`
        localStorage.set(localPath, bytes)
        return { path: localPath }
      }
    }
    const localToCloud: LocalToCloudMediaApi = {
      getLocalImageUrl: async () => '',
      uploadSettlementBulkData: async () => ({ path: '' }),
      uploadLocalMapImage: async (path) => {
        if (!localStorage.has(path)) throw new Error(`local file missing: ${path}`)
        return { path: `cloud-storage/${nextId++}.png` }
      }
    }

    const cloudNote = { frontmatter: { type: 'map', image: { path: 'cloud-storage/original.png', width: 1024, height: 768 } }, body: '' }

    const localNote = await translateCloudNoteForLocal(cloudNote, cloudToLocal)
    const backToCloud = await translateLocalNoteForCloud(localNote, localToCloud, () => false)

    const image = backToCloud.frontmatter.image as { path: string; width: number; height: number }
    expect(image.width).toBe(1024)
    expect(image.height).toBe(768)
    expect(image.path.startsWith('cloud-storage/')).toBe(true)
  })

  it('settlement bulk data survives cloud -> local -> cloud with residents/buildings intact, regardless of which side offloads', async () => {
    const bulkStorage = new Map<string, { residents: unknown[]; buildings: unknown[] }>()
    let nextId = 1
    bulkStorage.set('cloud-storage/settlement.json', { residents: [{ name: 'Alice' }], buildings: [{ name: 'Inn' }] })

    const cloudToLocal: CloudToLocalMediaApi = {
      downloadMapImage: async () => new ArrayBuffer(0),
      getSettlementBulkData: async (path) => {
        const found = bulkStorage.get(path)
        if (!found) throw new Error(`not found: ${path}`)
        return found
      },
      saveLocalImageBytes: async () => ({ path: '' })
    }
    const localToCloud: LocalToCloudMediaApi = {
      getLocalImageUrl: async () => '',
      uploadLocalMapImage: async () => ({ path: '' }),
      uploadSettlementBulkData: async (residents, buildings) => {
        const path = `cloud-storage/settlement-${nextId++}.json`
        bulkStorage.set(path, { residents, buildings })
        return { path }
      }
    }

    const cloudNote = {
      frontmatter: { type: 'settlement', bulkDataStoragePath: 'cloud-storage/settlement.json', residents: [], buildings: [] },
      body: ''
    }

    // Local always keeps bulk data inline (no offload system — design
    // decision #5) — this is the create path locally.
    const localNote = await translateCloudNoteForLocal(cloudNote, cloudToLocal)
    expect(localNote.frontmatter.residents).toEqual([{ name: 'Alice' }])
    expect(localNote.frontmatter.buildings).toEqual([{ name: 'Inn' }])
    expect(localNote.frontmatter.bulkDataStoragePath).toBeNull()

    // Pushing it back up re-offloads (simulating an oversized settlement,
    // shouldOffloadBulkData -> true) — the update path on the cloud side.
    const backToCloud = await translateLocalNoteForCloud(localNote, localToCloud, () => true)
    const finalPath = backToCloud.frontmatter.bulkDataStoragePath as string
    expect(bulkStorage.get(finalPath)).toEqual({ residents: [{ name: 'Alice' }], buildings: [{ name: 'Inn' }] })
    expect(backToCloud.frontmatter.residents).toEqual([])
    expect(backToCloud.frontmatter.buildings).toEqual([])
  })
})
