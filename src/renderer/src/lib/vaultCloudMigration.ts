// One-time (safely re-runnable) tool to seed the Cloud Workspace from the
// local Vault. The two are otherwise entirely independent stores — nothing
// here is a sync engine, it's a bulk "create what's missing" pass reusing
// the same one-at-a-time IPC calls the UI uses for everyday edits.
import { parseNote } from '../../../common/frontmatter'
import type { TreeEntry, NoteData } from '../../../common/types'
import type { CloudFolder, CloudNoteData, CloudTreeNode } from '../../../common/cloudTypes'

export interface MigrationProgress {
  total: number
  done: number
  currentName: string
  errors: { name: string; message: string }[]
}

export interface MigrationVaultApi {
  getTree(): Promise<TreeEntry[]>
  readNote(path: string): Promise<NoteData>
}

export interface MigrationCloudApi {
  refreshTree(): Promise<CloudTreeNode[]>
  createFolder(name: string, parentId?: string | null): Promise<CloudFolder>
  createNote(args: {
    name: string
    folderId?: string | null
    frontmatter?: Record<string, unknown>
    body?: string
  }): Promise<CloudNoteData>
}

function countNotes(entries: TreeEntry[]): number {
  let total = 0
  for (const entry of entries) {
    total += entry.isDirectory ? countNotes(entry.children ?? []) : 1
  }
  return total
}

// Root-level items have parentId null, and Postgres's unique constraint
// never treats two NULLs as equal — so a plain "did the create fail with a
// conflict" check can't catch a root-level duplicate on rerun. Building this
// index up front from the real cloud tree and checking it before every
// create is what makes a rerun safe.
function indexKey(parentId: string | null, name: string): string {
  return `${parentId ?? 'root'}::${name}`
}

function indexCloudTree(
  nodes: CloudTreeNode[],
  parentId: string | null,
  index: Map<string, { id: string; isDirectory: boolean }>
): void {
  for (const node of nodes) {
    index.set(indexKey(parentId, node.name), { id: node.id, isDirectory: node.isDirectory })
    if (node.children) indexCloudTree(node.children, node.id, index)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function importVaultIntoCloud(
  vaultApi: MigrationVaultApi,
  cloudApi: MigrationCloudApi,
  onProgress: (progress: MigrationProgress) => void
): Promise<MigrationProgress> {
  const [localTree, cloudTree] = await Promise.all([vaultApi.getTree(), cloudApi.refreshTree()])

  const index = new Map<string, { id: string; isDirectory: boolean }>()
  indexCloudTree(cloudTree, null, index)

  const progress: MigrationProgress = { total: countNotes(localTree), done: 0, currentName: '', errors: [] }
  const report = (): void => onProgress({ ...progress, errors: [...progress.errors] })
  report()

  async function walk(entries: TreeEntry[], parentCloudId: string | null): Promise<void> {
    const directories = entries.filter((e) => e.isDirectory)
    const notes = entries.filter((e) => !e.isDirectory)

    for (const dir of directories) {
      progress.currentName = dir.name
      const key = indexKey(parentCloudId, dir.name)
      const existing = index.get(key)

      let folderId = existing?.id ?? null
      if (folderId === null) {
        try {
          const folder = await cloudApi.createFolder(dir.name, parentCloudId)
          folderId = folder.id
          index.set(key, { id: folder.id, isDirectory: true })
        } catch (err) {
          progress.errors.push({ name: dir.name, message: errorMessage(err) })
          report()
          continue // no parent id to attach this folder's contents to — skip descending
        }
      }
      await walk(dir.children ?? [], folderId)
    }

    for (const file of notes) {
      const name = file.name.replace(/\.md$/, '')
      progress.currentName = name

      if (!index.has(indexKey(parentCloudId, name))) {
        try {
          const note = await vaultApi.readNote(file.path)
          const { frontmatter, body } = parseNote(note.content)
          const created = await cloudApi.createNote({ name, folderId: parentCloudId, frontmatter, body })
          index.set(indexKey(parentCloudId, name), { id: created.id, isDirectory: false })
        } catch (err) {
          progress.errors.push({ name, message: errorMessage(err) })
        }
      }

      progress.done += 1
      report()
    }
  }

  await walk(localTree, null)
  return progress
}
