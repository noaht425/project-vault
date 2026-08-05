import { describe, it, expect, vi } from 'vitest'
import {
  importVaultIntoCloud,
  importCloudIntoVault,
  isSourceNewer,
  type MigrationCloudApi,
  type MigrationVaultApi,
  type MigrationCloudSourceApi,
  type MigrationVaultDestApi
} from '../../src/renderer/src/lib/vaultCloudMigration'
import type { TreeEntry, NoteData, FileVersion, SaveNoteRequest } from '../../src/common/types'
import type { CloudFolder, CloudNoteData, CloudTreeNode } from '../../src/common/cloudTypes'

function note(path: string, content: string): NoteData {
  return { path, content, version: { mtimeMs: 0, contentHash: 'x' } }
}

function fakeVaultApi(tree: TreeEntry[], notes: Record<string, string>): MigrationVaultApi {
  return {
    getTree: async () => tree,
    readNote: async (path: string) => note(path, notes[path])
  }
}

// A minimal in-memory cloud so tests exercise the real create/index logic
// instead of mocking every call — closer to how the function actually
// behaves against project-vault-cloud's real folder/note uniqueness rules.
// notesById seeds full note content (frontmatter/body/version) for any tree
// entry that already exists — needed since getNote/saveNote (added for the
// compare-and-warn upgrade, Phase 6) operate on real note data, not just
// tree metadata.
function fakeCloudApi(
  initialTree: CloudTreeNode[] = [],
  initialNotesById: Record<string, CloudNoteData> = {}
): MigrationCloudApi & { tree: CloudTreeNode[]; notesById: Record<string, CloudNoteData> } {
  let nextId = 1
  const state = { tree: initialTree }
  const notesById: Record<string, CloudNoteData> = { ...initialNotesById }

  function findChildren(parentId: string | null): CloudTreeNode[] {
    if (parentId === null) return state.tree
    const stack = [...state.tree]
    while (stack.length) {
      const node = stack.pop()!
      if (node.id === parentId) return (node.children ??= [])
      if (node.children) stack.push(...node.children)
    }
    throw new Error(`parent ${parentId} not found`)
  }

  return {
    tree: state.tree,
    notesById,
    refreshTree: async () => state.tree,
    createFolder: async (name: string, parentId?: string | null): Promise<CloudFolder> => {
      const id = `folder-${nextId++}`
      findChildren(parentId ?? null).push({ id, name, isDirectory: true, children: [] })
      return { id, name, parentId: parentId ?? null }
    },
    createNote: async (args): Promise<CloudNoteData> => {
      const id = `note-${nextId++}`
      findChildren(args.folderId ?? null).push({ id, name: args.name, isDirectory: false, noteType: null, version: 1 })
      const created: CloudNoteData = {
        id,
        name: args.name,
        folderId: args.folderId ?? null,
        frontmatter: args.frontmatter ?? {},
        body: args.body ?? '',
        noteType: null,
        version: 1
      }
      notesById[id] = created
      return created
    },
    getNote: async (id: string): Promise<CloudNoteData> => {
      const found = notesById[id]
      if (!found) throw new Error(`note ${id} not found`)
      return found
    },
    saveNote: async (args): Promise<{ status: 'saved'; note: CloudNoteData }> => {
      const current = notesById[args.id]
      if (!current) throw new Error(`note ${args.id} not found`)
      const updated: CloudNoteData = {
        ...current,
        frontmatter: args.frontmatter ?? current.frontmatter,
        body: args.body ?? current.body,
        version: current.version + 1
      }
      notesById[args.id] = updated
      return { status: 'saved', note: updated }
    }
  }
}

describe('importVaultIntoCloud', () => {
  it('creates a cloud note per local note, splitting frontmatter from body', async () => {
    const tree: TreeEntry[] = [{ path: '/vault/A.md', name: 'A.md', isDirectory: false }]
    const vaultApi = fakeVaultApi(tree, { '/vault/A.md': '---\ntype: npc\ntags: []\n---\nHello' })
    const cloudApi = fakeCloudApi()

    const progress = await importVaultIntoCloud(vaultApi, cloudApi, () => {})

    expect(progress.total).toBe(1)
    expect(progress.done).toBe(1)
    expect(progress.errors).toEqual([])
    expect(cloudApi.tree).toEqual([
      expect.objectContaining({ name: 'A', isDirectory: false })
    ])
  })

  it('recreates folder hierarchy before creating the notes inside it', async () => {
    const tree: TreeEntry[] = [
      {
        path: '/vault/Locations',
        name: 'Locations',
        isDirectory: true,
        children: [{ path: '/vault/Locations/Geno.md', name: 'Geno.md', isDirectory: false }]
      }
    ]
    const vaultApi = fakeVaultApi(tree, { '/vault/Locations/Geno.md': '---\ntype: location\n---\n' })
    const cloudApi = fakeCloudApi()

    await importVaultIntoCloud(vaultApi, cloudApi, () => {})

    const folder = cloudApi.tree[0]
    expect(folder).toEqual(expect.objectContaining({ name: 'Locations', isDirectory: true }))
    expect(folder.children).toEqual([expect.objectContaining({ name: 'Geno' })])
  })

  it('warns rather than creating a duplicate when the note already exists in the cloud with no comparable timestamp', async () => {
    const tree: TreeEntry[] = [{ path: '/vault/A.md', name: 'A.md', isDirectory: false }]
    const vaultApi = fakeVaultApi(tree, { '/vault/A.md': '---\ntype: npc\n---\n' })
    const cloudApi = fakeCloudApi(
      [{ id: 'note-existing', name: 'A', isDirectory: false, noteType: 'npc', version: 1 }],
      { 'note-existing': { id: 'note-existing', name: 'A', folderId: null, frontmatter: { type: 'npc' }, body: '', noteType: 'npc', version: 1 } }
    )

    const progress = await importVaultIntoCloud(vaultApi, cloudApi, () => {})

    expect(progress.done).toBe(1)
    expect(progress.errors).toEqual([])
    expect(progress.warnings).toEqual([expect.objectContaining({ name: 'A' })])
    expect(cloudApi.tree).toHaveLength(1) // no second "A" created
  })

  it('overwrites an existing cloud note when the local copy is strictly newer', async () => {
    const tree: TreeEntry[] = [{ path: '/vault/A.md', name: 'A.md', isDirectory: false }]
    const vaultApi = fakeVaultApi(tree, {
      '/vault/A.md': "---\ntype: npc\nupdatedAt: '2026-08-04T12:00:00.000Z'\n---\nnew body"
    })
    const cloudApi = fakeCloudApi(
      [{ id: 'note-existing', name: 'A', isDirectory: false, noteType: 'npc', version: 1 }],
      {
        'note-existing': {
          id: 'note-existing',
          name: 'A',
          folderId: null,
          frontmatter: { type: 'npc', updatedAt: '2026-08-01T00:00:00.000Z' },
          body: 'old body',
          noteType: 'npc',
          version: 1
        }
      }
    )

    const progress = await importVaultIntoCloud(vaultApi, cloudApi, () => {})

    expect(progress.errors).toEqual([])
    expect(progress.warnings).toEqual([])
    expect(cloudApi.notesById['note-existing'].body).toBe('new body')
    expect(cloudApi.notesById['note-existing'].version).toBe(2)
  })

  it('warns and leaves the cloud note untouched when the destination is newer, same age, or either side is unknown', async () => {
    const cases: { cloudUpdatedAt: string; localUpdatedAt: unknown }[] = [
      { cloudUpdatedAt: '2026-08-04T00:00:00.000Z', localUpdatedAt: '2026-08-01T00:00:00.000Z' }, // cloud (dest) newer
      { cloudUpdatedAt: '2026-08-04T00:00:00.000Z', localUpdatedAt: '2026-08-04T00:00:00.000Z' }, // same age
      { cloudUpdatedAt: '2026-08-04T00:00:00.000Z', localUpdatedAt: undefined } // local (source) side unknown
    ]

    for (const { cloudUpdatedAt, localUpdatedAt } of cases) {
      const tree: TreeEntry[] = [{ path: '/vault/A.md', name: 'A.md', isDirectory: false }]
      const localFrontmatter = localUpdatedAt === undefined ? 'type: npc' : `type: npc\nupdatedAt: '${localUpdatedAt}'`
      const vaultApi = fakeVaultApi(tree, { '/vault/A.md': `---\n${localFrontmatter}\n---\nnew body` })
      const cloudApi = fakeCloudApi(
        [{ id: 'note-existing', name: 'A', isDirectory: false, noteType: 'npc', version: 1 }],
        {
          'note-existing': {
            id: 'note-existing',
            name: 'A',
            folderId: null,
            frontmatter: { type: 'npc', updatedAt: cloudUpdatedAt },
            body: 'old body',
            noteType: 'npc',
            version: 1
          }
        }
      )

      const progress = await importVaultIntoCloud(vaultApi, cloudApi, () => {})

      expect(progress.warnings).toEqual([expect.objectContaining({ name: 'A' })])
      expect(progress.errors).toEqual([])
      expect(cloudApi.notesById['note-existing'].body).toBe('old body')
    }
  })

  it('rerunning after a full import is a no-op — the key regression case for root-level NULL-parent duplicates', async () => {
    const tree: TreeEntry[] = [
      { path: '/vault/A.md', name: 'A.md', isDirectory: false },
      { path: '/vault/B.md', name: 'B.md', isDirectory: false }
    ]
    const vaultApi = fakeVaultApi(tree, {
      '/vault/A.md': '---\ntype: npc\n---\n',
      '/vault/B.md': '---\ntype: npc\n---\n'
    })
    const cloudApi = fakeCloudApi()

    await importVaultIntoCloud(vaultApi, cloudApi, () => {})
    const afterFirstRun = cloudApi.tree.length
    await importVaultIntoCloud(vaultApi, cloudApi, () => {})

    expect(cloudApi.tree).toHaveLength(afterFirstRun)
  })

  it('records a failed create as an error and keeps processing the rest', async () => {
    const tree: TreeEntry[] = [
      { path: '/vault/A.md', name: 'A.md', isDirectory: false },
      { path: '/vault/B.md', name: 'B.md', isDirectory: false }
    ]
    const vaultApi = fakeVaultApi(tree, {
      '/vault/A.md': '---\ntype: npc\n---\n',
      '/vault/B.md': '---\ntype: npc\n---\n'
    })
    const cloudApi = fakeCloudApi()
    const realCreateNote = cloudApi.createNote
    cloudApi.createNote = vi.fn(async (args) => {
      if (args.name === 'A') throw new Error('boom')
      return realCreateNote(args)
    })

    const progress = await importVaultIntoCloud(vaultApi, cloudApi, () => {})

    expect(progress.done).toBe(2)
    expect(progress.errors).toEqual([{ name: 'A', message: 'boom' }])
    expect(cloudApi.tree).toEqual([expect.objectContaining({ name: 'B' })])
  })

  it('runs the per-note-type transform hook on both the create and update path', async () => {
    const tree: TreeEntry[] = [
      { path: '/vault/New.md', name: 'New.md', isDirectory: false },
      { path: '/vault/Existing.md', name: 'Existing.md', isDirectory: false }
    ]
    const vaultApi = fakeVaultApi(tree, {
      '/vault/New.md': '---\ntype: map\n---\n',
      '/vault/Existing.md': "---\ntype: map\nupdatedAt: '2026-08-04T12:00:00.000Z'\n---\n"
    })
    const cloudApi = fakeCloudApi(
      [{ id: 'note-existing', name: 'Existing', isDirectory: false, noteType: 'map', version: 1 }],
      {
        'note-existing': {
          id: 'note-existing',
          name: 'Existing',
          folderId: null,
          frontmatter: { type: 'map', updatedAt: '2026-08-01T00:00:00.000Z' },
          body: '',
          noteType: 'map',
          version: 1
        }
      }
    )
    const transformNote = vi.fn(async (note: { frontmatter: Record<string, unknown>; body: string }) => ({
      frontmatter: { ...note.frontmatter, transformed: true },
      body: note.body
    }))

    await importVaultIntoCloud(vaultApi, cloudApi, () => {}, transformNote)

    expect(transformNote).toHaveBeenCalledTimes(2)
    const created = cloudApi.tree.find((n) => n.name === 'New')!
    expect(cloudApi.notesById[created.id].frontmatter.transformed).toBe(true)
    expect(cloudApi.notesById['note-existing'].frontmatter.transformed).toBe(true)
  })

  it('dryRun:true computes accurate toCreate/toUpdate/warnings counts without writing anything', async () => {
    const tree: TreeEntry[] = [
      { path: '/vault/New.md', name: 'New.md', isDirectory: false },
      { path: '/vault/UpdateMe.md', name: 'UpdateMe.md', isDirectory: false },
      { path: '/vault/Conflicted.md', name: 'Conflicted.md', isDirectory: false }
    ]
    const vaultApi = fakeVaultApi(tree, {
      '/vault/New.md': '---\ntype: npc\n---\n',
      '/vault/UpdateMe.md': "---\ntype: npc\nupdatedAt: '2026-08-04T12:00:00.000Z'\n---\nnew body",
      '/vault/Conflicted.md': '---\ntype: npc\n---\nlocal body, no timestamp'
    })
    const cloudApi = fakeCloudApi(
      [
        { id: 'note-update', name: 'UpdateMe', isDirectory: false, noteType: 'npc', version: 1 },
        { id: 'note-conflict', name: 'Conflicted', isDirectory: false, noteType: 'npc', version: 1 }
      ],
      {
        'note-update': {
          id: 'note-update',
          name: 'UpdateMe',
          folderId: null,
          frontmatter: { type: 'npc', updatedAt: '2026-08-01T00:00:00.000Z' },
          body: 'old body',
          noteType: 'npc',
          version: 1
        },
        'note-conflict': {
          id: 'note-conflict',
          name: 'Conflicted',
          folderId: null,
          frontmatter: { type: 'npc' },
          body: 'cloud body',
          noteType: 'npc',
          version: 1
        }
      }
    )

    const plan = await importVaultIntoCloud(vaultApi, cloudApi, () => {}, undefined, true)

    expect(plan.toCreate).toBe(1)
    expect(plan.toUpdate).toBe(1)
    expect(plan.warnings).toEqual([expect.objectContaining({ name: 'Conflicted' })])
    expect(plan.errors).toEqual([])
    // Nothing actually written.
    expect(cloudApi.tree).toHaveLength(2)
    expect(cloudApi.notesById['note-update'].body).toBe('old body')
    expect(cloudApi.notesById['note-conflict'].body).toBe('cloud body')
  })

  it('dryRun:true never descends into creating cloud folders, but still counts every note underneath as toCreate', async () => {
    const tree: TreeEntry[] = [
      {
        path: '/vault/Locations',
        name: 'Locations',
        isDirectory: true,
        children: [{ path: '/vault/Locations/Geno.md', name: 'Geno.md', isDirectory: false }]
      }
    ]
    const vaultApi = fakeVaultApi(tree, { '/vault/Locations/Geno.md': '---\ntype: location\n---\n' })
    const cloudApi = fakeCloudApi()
    cloudApi.createFolder = vi.fn(cloudApi.createFolder)
    cloudApi.createNote = vi.fn(cloudApi.createNote)

    const plan = await importVaultIntoCloud(vaultApi, cloudApi, () => {}, undefined, true)

    expect(plan.toCreate).toBe(1)
    expect(cloudApi.createFolder).not.toHaveBeenCalled()
    expect(cloudApi.createNote).not.toHaveBeenCalled()
    expect(cloudApi.tree).toHaveLength(0)
  })

  it('reports progress incrementally as notes are created', async () => {
    const tree: TreeEntry[] = [
      { path: '/vault/A.md', name: 'A.md', isDirectory: false },
      { path: '/vault/B.md', name: 'B.md', isDirectory: false }
    ]
    const vaultApi = fakeVaultApi(tree, {
      '/vault/A.md': '---\ntype: npc\n---\n',
      '/vault/B.md': '---\ntype: npc\n---\n'
    })
    const cloudApi = fakeCloudApi()
    const updates: number[] = []

    await importVaultIntoCloud(vaultApi, cloudApi, (p) => updates.push(p.done))

    expect(updates[0]).toBe(0) // initial report before anything is created
    expect(updates.at(-1)).toBe(2)
    expect(updates).toEqual([...updates].sort((a, b) => a - b)) // monotonically increasing
  })
})

describe('isSourceNewer', () => {
  it('is true only when the source timestamp strictly postdates the destination', () => {
    expect(isSourceNewer('2026-08-04T12:00:00.000Z', '2026-08-01T00:00:00.000Z')).toBe(true)
    expect(isSourceNewer('2026-08-01T00:00:00.000Z', '2026-08-04T12:00:00.000Z')).toBe(false)
    expect(isSourceNewer('2026-08-04T12:00:00.000Z', '2026-08-04T12:00:00.000Z')).toBe(false) // same age — warn, don't overwrite
  })

  it('treats a missing/undefined timestamp on either side as unknown, not "infinitely old"', () => {
    expect(isSourceNewer(undefined, '2026-08-01T00:00:00.000Z')).toBe(false)
    expect(isSourceNewer('2026-08-04T12:00:00.000Z', undefined)).toBe(false)
    expect(isSourceNewer(undefined, undefined)).toBe(false)
  })

  it('treats an unparseable string as unknown', () => {
    expect(isSourceNewer('not a date', '2026-08-01T00:00:00.000Z')).toBe(false)
  })

  // Regression: gray-matter's YAML layer (js-yaml) parses an UNQUOTED
  // ISO-timestamp-looking scalar into a native JS Date, not a string — this
  // only ever happens with hand-edited frontmatter (stringifyNote always
  // quotes the value it writes, verified directly against gray-matter), but
  // a hand-edited file is exactly the kind of input this comparison must
  // not crash or silently misbehave on. A Date isn't a string, so it falls
  // through to the same "don't know, don't overwrite" path as any other
  // unrecognized shape — never treated as comparable, let alone newer.
  it('treats a non-string value (e.g. a Date parsed from unquoted YAML) as unknown', () => {
    expect(isSourceNewer(new Date('2026-08-04T12:00:00.000Z'), '2026-08-01T00:00:00.000Z')).toBe(false)
  })
})

const VAULT_ROOT = '/vault'

function cloudNoteData(id: string, name: string, frontmatter: Record<string, unknown>, body = ''): CloudNoteData {
  return { id, name, folderId: null, frontmatter, body, noteType: (frontmatter.type as string) ?? null, version: 1 }
}

// A minimal in-memory local vault, exercising the real create/update/index
// logic the same way fakeCloudApi (above) does for the other direction —
// closer to the app's actual behavior than mocking every call.
function fakeVaultDestApi(
  initialTree: TreeEntry[] = [],
  initialNotes: Record<string, { content: string; version: FileVersion }> = {}
): MigrationVaultDestApi & { tree: TreeEntry[]; notes: Record<string, { content: string; version: FileVersion }> } {
  const state = { tree: initialTree }
  const notes: Record<string, { content: string; version: FileVersion }> = { ...initialNotes }
  let nextVersion = 1

  function findChildren(dirPath: string): TreeEntry[] {
    if (dirPath === VAULT_ROOT) return state.tree
    const stack = [...state.tree]
    while (stack.length) {
      const node = stack.pop()!
      if (node.path === dirPath) return (node.children ??= [])
      if (node.children) stack.push(...node.children)
    }
    throw new Error(`folder not found: ${dirPath}`)
  }

  return {
    tree: state.tree,
    notes,
    getTree: async () => state.tree,
    readNote: async (path: string): Promise<NoteData> => {
      const found = notes[path]
      if (!found) throw new Error(`not found: ${path}`)
      return { path, content: found.content, version: found.version }
    },
    createFolder: async (parentDir: string, name: string): Promise<void> => {
      findChildren(parentDir).push({ path: `${parentDir}/${name}`, name, isDirectory: true, children: [] })
    },
    createNote: async (parentDir: string, name: string): Promise<NoteData> => {
      const path = `${parentDir}/${name}.md`
      const version: FileVersion = { mtimeMs: nextVersion, contentHash: `v${nextVersion}` }
      nextVersion += 1
      const content = '---\ntype: note\ntags: []\n---\n\n'
      notes[path] = { content, version }
      findChildren(parentDir).push({ path, name: `${name}.md`, isDirectory: false })
      return { path, content, version }
    },
    saveNote: async (req: SaveNoteRequest) => {
      const version: FileVersion = { mtimeMs: nextVersion, contentHash: `v${nextVersion}` }
      nextVersion += 1
      notes[req.path] = { content: req.content, version }
      return { status: 'saved' as const, version }
    }
  }
}

function fakeCloudSourceApi(tree: CloudTreeNode[], notesById: Record<string, CloudNoteData>): MigrationCloudSourceApi {
  return {
    refreshTree: async () => tree,
    getNote: async (id: string) => notesById[id]
  }
}

describe('importCloudIntoVault', () => {
  it('creates a local note per cloud note, writing frontmatter+body into the note content', async () => {
    const cloudTree: CloudTreeNode[] = [{ id: 'note-a', name: 'A', isDirectory: false, version: 1 }]
    const cloudApi = fakeCloudSourceApi(cloudTree, { 'note-a': cloudNoteData('note-a', 'A', { type: 'npc', tags: [] }, 'Hello') })
    const vaultApi = fakeVaultDestApi()

    const progress = await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})

    expect(progress.total).toBe(1)
    expect(progress.done).toBe(1)
    expect(progress.errors).toEqual([])
    expect(progress.warnings).toEqual([])
    const created = vaultApi.notes[`${VAULT_ROOT}/A.md`]
    expect(created.content).toContain('type: npc')
    expect(created.content.trim().endsWith('Hello')).toBe(true)
  })

  it('recreates folder hierarchy before creating the notes inside it', async () => {
    const cloudTree: CloudTreeNode[] = [
      {
        id: 'folder-locations',
        name: 'Locations',
        isDirectory: true,
        children: [{ id: 'note-geno', name: 'Geno', isDirectory: false, version: 1 }]
      }
    ]
    const cloudApi = fakeCloudSourceApi(cloudTree, { 'note-geno': cloudNoteData('note-geno', 'Geno', { type: 'location' }) })
    const vaultApi = fakeVaultDestApi()

    await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})

    const folder = vaultApi.tree[0]
    expect(folder).toEqual(expect.objectContaining({ name: 'Locations', isDirectory: true }))
    expect(folder.children).toEqual([expect.objectContaining({ name: 'Geno.md' })])
    expect(vaultApi.notes[`${VAULT_ROOT}/Locations/Geno.md`]).toBeDefined()
  })

  it('overwrites an existing local note when the cloud copy is strictly newer', async () => {
    const cloudTree: CloudTreeNode[] = [{ id: 'note-a', name: 'A', isDirectory: false, version: 2 }]
    const cloudApi = fakeCloudSourceApi(cloudTree, {
      'note-a': cloudNoteData('note-a', 'A', { type: 'npc', updatedAt: '2026-08-04T12:00:00.000Z' }, 'new body')
    })
    const existingTree: TreeEntry[] = [{ path: `${VAULT_ROOT}/A.md`, name: 'A.md', isDirectory: false }]
    const vaultApi = fakeVaultDestApi(existingTree, {
      [`${VAULT_ROOT}/A.md`]: {
        content: "---\ntype: npc\nupdatedAt: '2026-08-01T00:00:00.000Z'\n---\nold body",
        version: { mtimeMs: 1, contentHash: 'old' }
      }
    })

    const progress = await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})

    expect(progress.warnings).toEqual([])
    expect(progress.errors).toEqual([])
    expect(vaultApi.notes[`${VAULT_ROOT}/A.md`].content).toContain('new body')
  })

  it('warns and leaves the local note untouched when the destination is newer, same age, or either side is unknown', async () => {
    const cases: { label: string; cloudUpdatedAt: unknown; localUpdatedAt: string }[] = [
      { label: 'local newer', cloudUpdatedAt: '2026-08-01T00:00:00.000Z', localUpdatedAt: '2026-08-04T00:00:00.000Z' },
      { label: 'same age', cloudUpdatedAt: '2026-08-04T00:00:00.000Z', localUpdatedAt: '2026-08-04T00:00:00.000Z' },
      { label: 'cloud side missing updatedAt', cloudUpdatedAt: undefined, localUpdatedAt: '2026-08-04T00:00:00.000Z' }
    ]

    for (const { cloudUpdatedAt, localUpdatedAt } of cases) {
      const cloudTree: CloudTreeNode[] = [{ id: 'note-a', name: 'A', isDirectory: false, version: 2 }]
      const frontmatter: Record<string, unknown> = { type: 'npc' }
      if (cloudUpdatedAt !== undefined) frontmatter.updatedAt = cloudUpdatedAt
      const cloudApi = fakeCloudSourceApi(cloudTree, { 'note-a': cloudNoteData('note-a', 'A', frontmatter, 'new body') })
      const existingTree: TreeEntry[] = [{ path: `${VAULT_ROOT}/A.md`, name: 'A.md', isDirectory: false }]
      const vaultApi = fakeVaultDestApi(existingTree, {
        [`${VAULT_ROOT}/A.md`]: {
          content: `---\ntype: npc\nupdatedAt: '${localUpdatedAt}'\n---\nold body`,
          version: { mtimeMs: 1, contentHash: 'old' }
        }
      })

      const progress = await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})

      expect(progress.warnings).toEqual([expect.objectContaining({ name: 'A' })])
      expect(progress.errors).toEqual([])
      expect(vaultApi.notes[`${VAULT_ROOT}/A.md`].content).toContain('old body')
    }
  })

  it('warns rather than overwrites when the local note has no updatedAt at all (predates the field)', async () => {
    const cloudTree: CloudTreeNode[] = [{ id: 'note-a', name: 'A', isDirectory: false, version: 2 }]
    const cloudApi = fakeCloudSourceApi(cloudTree, {
      'note-a': cloudNoteData('note-a', 'A', { type: 'npc', updatedAt: '2026-08-04T00:00:00.000Z' }, 'new body')
    })
    const existingTree: TreeEntry[] = [{ path: `${VAULT_ROOT}/A.md`, name: 'A.md', isDirectory: false }]
    const vaultApi = fakeVaultDestApi(existingTree, {
      [`${VAULT_ROOT}/A.md`]: { content: '---\ntype: npc\n---\nold body', version: { mtimeMs: 1, contentHash: 'old' } }
    })

    const progress = await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})

    expect(progress.warnings).toEqual([expect.objectContaining({ name: 'A' })])
    expect(vaultApi.notes[`${VAULT_ROOT}/A.md`].content).toContain('old body')
  })

  it('rerunning after a full import is idempotent — creates nothing further', async () => {
    const cloudTree: CloudTreeNode[] = [
      { id: 'note-a', name: 'A', isDirectory: false, version: 1 },
      { id: 'note-b', name: 'B', isDirectory: false, version: 1 }
    ]
    const cloudApi = fakeCloudSourceApi(cloudTree, {
      'note-a': cloudNoteData('note-a', 'A', { type: 'npc' }),
      'note-b': cloudNoteData('note-b', 'B', { type: 'npc' })
    })
    const vaultApi = fakeVaultDestApi()

    await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})
    const afterFirstRun = Object.keys(vaultApi.notes).length
    await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})

    // Neither side ever had updatedAt set, so the second run warns on both
    // (unknown, don't overwrite) rather than creating duplicates.
    expect(Object.keys(vaultApi.notes)).toHaveLength(afterFirstRun)
  })

  it('records a failed create as an error and keeps processing the rest', async () => {
    const cloudTree: CloudTreeNode[] = [
      { id: 'note-a', name: 'A', isDirectory: false, version: 1 },
      { id: 'note-b', name: 'B', isDirectory: false, version: 1 }
    ]
    const cloudApi: MigrationCloudSourceApi = {
      refreshTree: async () => cloudTree,
      getNote: async (id) => {
        if (id === 'note-a') throw new Error('boom')
        return cloudNoteData('note-b', 'B', { type: 'npc' })
      }
    }
    const vaultApi = fakeVaultDestApi()

    const progress = await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})

    expect(progress.done).toBe(2)
    expect(progress.errors).toEqual([{ name: 'A', message: 'boom' }])
    expect(vaultApi.notes[`${VAULT_ROOT}/B.md`]).toBeDefined()
    expect(vaultApi.notes[`${VAULT_ROOT}/A.md`]).toBeUndefined()
  })

  it('skips a folder\'s whole subtree (rather than erroring per-descendant) when the folder itself fails to create', async () => {
    const cloudTree: CloudTreeNode[] = [
      {
        id: 'folder-locations',
        name: 'Locations',
        isDirectory: true,
        children: [{ id: 'note-geno', name: 'Geno', isDirectory: false, version: 1 }]
      }
    ]
    const cloudApi = fakeCloudSourceApi(cloudTree, { 'note-geno': cloudNoteData('note-geno', 'Geno', { type: 'location' }) })
    const vaultApi = fakeVaultDestApi()
    vaultApi.createFolder = vi.fn(async () => {
      throw new Error('disk full')
    })

    const progress = await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {})

    expect(progress.errors).toEqual([{ name: 'Locations', message: 'disk full' }])
    expect(vaultApi.notes[`${VAULT_ROOT}/Locations/Geno.md`]).toBeUndefined()
  })

  it('runs the per-note-type transform hook on both the create and update path', async () => {
    const cloudTree: CloudTreeNode[] = [
      { id: 'note-new', name: 'New', isDirectory: false, version: 1 },
      { id: 'note-existing', name: 'Existing', isDirectory: false, version: 2 }
    ]
    const cloudApi = fakeCloudSourceApi(cloudTree, {
      'note-new': cloudNoteData('note-new', 'New', { type: 'map' }),
      'note-existing': cloudNoteData('note-existing', 'Existing', { type: 'map', updatedAt: '2026-08-04T00:00:00.000Z' })
    })
    const existingTree: TreeEntry[] = [{ path: `${VAULT_ROOT}/Existing.md`, name: 'Existing.md', isDirectory: false }]
    const vaultApi = fakeVaultDestApi(existingTree, {
      [`${VAULT_ROOT}/Existing.md`]: {
        content: "---\ntype: map\nupdatedAt: '2026-08-01T00:00:00.000Z'\n---\n",
        version: { mtimeMs: 1, contentHash: 'old' }
      }
    })
    const transformNote = vi.fn(async (note: { frontmatter: Record<string, unknown>; body: string }) => ({
      frontmatter: { ...note.frontmatter, transformed: true },
      body: note.body
    }))

    await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {}, transformNote)

    expect(transformNote).toHaveBeenCalledTimes(2)
    expect(vaultApi.notes[`${VAULT_ROOT}/New.md`].content).toContain('transformed: true')
    expect(vaultApi.notes[`${VAULT_ROOT}/Existing.md`].content).toContain('transformed: true')
  })

  it('dryRun:true computes accurate toCreate/toUpdate/warnings counts without writing anything', async () => {
    const cloudTree: CloudTreeNode[] = [
      { id: 'note-new', name: 'New', isDirectory: false, version: 1 },
      { id: 'note-update', name: 'UpdateMe', isDirectory: false, version: 2 },
      { id: 'note-conflict', name: 'Conflicted', isDirectory: false, version: 2 }
    ]
    const cloudApi = fakeCloudSourceApi(cloudTree, {
      'note-new': cloudNoteData('note-new', 'New', { type: 'npc' }),
      'note-update': cloudNoteData('note-update', 'UpdateMe', { type: 'npc', updatedAt: '2026-08-04T12:00:00.000Z' }, 'new body'),
      'note-conflict': cloudNoteData('note-conflict', 'Conflicted', { type: 'npc' }, 'cloud body')
    })
    const existingTree: TreeEntry[] = [
      { path: `${VAULT_ROOT}/UpdateMe.md`, name: 'UpdateMe.md', isDirectory: false },
      { path: `${VAULT_ROOT}/Conflicted.md`, name: 'Conflicted.md', isDirectory: false }
    ]
    const vaultApi = fakeVaultDestApi(existingTree, {
      [`${VAULT_ROOT}/UpdateMe.md`]: {
        content: "---\ntype: npc\nupdatedAt: '2026-08-01T00:00:00.000Z'\n---\nold body",
        version: { mtimeMs: 1, contentHash: 'old' }
      },
      [`${VAULT_ROOT}/Conflicted.md`]: {
        content: '---\ntype: npc\n---\nlocal body, no timestamp',
        version: { mtimeMs: 1, contentHash: 'old' }
      }
    })

    const plan = await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {}, undefined, true)

    expect(plan.toCreate).toBe(1)
    expect(plan.toUpdate).toBe(1)
    expect(plan.warnings).toEqual([expect.objectContaining({ name: 'Conflicted' })])
    expect(plan.errors).toEqual([])
    // Nothing actually written.
    expect(vaultApi.notes[`${VAULT_ROOT}/New.md`]).toBeUndefined()
    expect(vaultApi.notes[`${VAULT_ROOT}/UpdateMe.md`].content).toContain('old body')
    expect(vaultApi.notes[`${VAULT_ROOT}/Conflicted.md`].content).toContain('local body, no timestamp')
  })

  it('dryRun:true never descends into creating local folders, but still counts every note underneath as toCreate', async () => {
    const cloudTree: CloudTreeNode[] = [
      {
        id: 'folder-locations',
        name: 'Locations',
        isDirectory: true,
        children: [{ id: 'note-geno', name: 'Geno', isDirectory: false, version: 1 }]
      }
    ]
    const cloudApi = fakeCloudSourceApi(cloudTree, { 'note-geno': cloudNoteData('note-geno', 'Geno', { type: 'location' }) })
    const vaultApi = fakeVaultDestApi()
    vaultApi.createFolder = vi.fn(vaultApi.createFolder)
    vaultApi.createNote = vi.fn(vaultApi.createNote)

    const plan = await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, () => {}, undefined, true)

    expect(plan.toCreate).toBe(1)
    expect(vaultApi.createFolder).not.toHaveBeenCalled()
    expect(vaultApi.createNote).not.toHaveBeenCalled()
    expect(vaultApi.tree).toHaveLength(0)
  })

  it('reports progress incrementally as notes are created', async () => {
    const cloudTree: CloudTreeNode[] = [
      { id: 'note-a', name: 'A', isDirectory: false, version: 1 },
      { id: 'note-b', name: 'B', isDirectory: false, version: 1 }
    ]
    const cloudApi = fakeCloudSourceApi(cloudTree, {
      'note-a': cloudNoteData('note-a', 'A', { type: 'npc' }),
      'note-b': cloudNoteData('note-b', 'B', { type: 'npc' })
    })
    const vaultApi = fakeVaultDestApi()
    const updates: number[] = []

    await importCloudIntoVault(cloudApi, vaultApi, VAULT_ROOT, (p) => updates.push(p.done))

    expect(updates[0]).toBe(0)
    expect(updates.at(-1)).toBe(2)
    expect(updates).toEqual([...updates].sort((a, b) => a - b))
  })
})
