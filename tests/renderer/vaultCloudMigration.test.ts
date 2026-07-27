import { describe, it, expect, vi } from 'vitest'
import { importVaultIntoCloud, type MigrationCloudApi, type MigrationVaultApi } from '../../src/renderer/src/lib/vaultCloudMigration'
import type { TreeEntry, NoteData } from '../../src/common/types'
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
function fakeCloudApi(initialTree: CloudTreeNode[] = []): MigrationCloudApi & { tree: CloudTreeNode[] } {
  let nextId = 1
  const state = { tree: initialTree }

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
    refreshTree: async () => state.tree,
    createFolder: async (name: string, parentId?: string | null): Promise<CloudFolder> => {
      const id = `folder-${nextId++}`
      findChildren(parentId ?? null).push({ id, name, isDirectory: true, children: [] })
      return { id, name, parentId: parentId ?? null }
    },
    createNote: async (args): Promise<CloudNoteData> => {
      const id = `note-${nextId++}`
      findChildren(args.folderId ?? null).push({ id, name: args.name, isDirectory: false, noteType: null, version: 1 })
      return {
        id,
        name: args.name,
        folderId: args.folderId ?? null,
        frontmatter: args.frontmatter ?? {},
        body: args.body ?? '',
        noteType: null,
        version: 1
      }
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

  it('skips items that already exist in the cloud instead of creating duplicates', async () => {
    const tree: TreeEntry[] = [{ path: '/vault/A.md', name: 'A.md', isDirectory: false }]
    const vaultApi = fakeVaultApi(tree, { '/vault/A.md': '---\ntype: npc\n---\n' })
    const cloudApi = fakeCloudApi([{ id: 'note-existing', name: 'A', isDirectory: false, noteType: 'npc', version: 1 }])

    const progress = await importVaultIntoCloud(vaultApi, cloudApi, () => {})

    expect(progress.done).toBe(1)
    expect(progress.errors).toEqual([])
    expect(cloudApi.tree).toHaveLength(1) // no second "A" created
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
