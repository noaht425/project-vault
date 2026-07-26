import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// Last-known tree, persisted to disk so a cold app launch has something to
// render immediately instead of a blank panel while the network request is
// still in flight — the actual point of this whole slice: prove reads can
// feel instant, not just "eventually fast once warm."
function cloudTreeCacheFilePath(userDataDir: string): string {
  return join(userDataDir, 'cloud-tree-cache.json')
}

export async function readCachedTree<T>(userDataDir: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(cloudTreeCacheFilePath(userDataDir), 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function writeCachedTree<T>(userDataDir: string, tree: T): Promise<void> {
  await fs.writeFile(cloudTreeCacheFilePath(userDataDir), JSON.stringify(tree), 'utf8').catch(() => {})
}
