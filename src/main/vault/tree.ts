import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { TreeEntry } from '../../common/types'

export async function buildTree(root: string): Promise<TreeEntry[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const result: TreeEntry[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      result.push({
        path: full,
        name: entry.name,
        isDirectory: true,
        children: await buildTree(full)
      })
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      result.push({ path: full, name: entry.name, isDirectory: false })
    }
  }

  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return result
}
