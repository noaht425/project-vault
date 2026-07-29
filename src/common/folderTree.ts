// Structural shape shared by TreeEntry (types.ts, local vault) and
// CloudTreeNode (cloudTypes.ts, project-vault-cloud) — both already nest a
// folder's full recursive contents (see main/vault/tree.ts's buildTree and
// project-vault-cloud's /api/tree route), so a folder's note titles can be
// derived from either backend's already-cached tree with one shared
// function instead of a per-backend IPC/fetch method.
export interface FolderTreeNode {
  name: string
  isDirectory: boolean
  children?: FolderTreeNode[]
}

// Local file names carry a `.md` extension (see indexer.ts's titleFromPath);
// cloud note names never do. Stripping it here, once, means callers get a
// bare title back regardless of backend.
function titleFromNodeName(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -'.md'.length) : name
}

function collectNoteTitles(nodes: FolderTreeNode[]): string[] {
  const titles: string[] = []
  for (const node of nodes) {
    if (node.isDirectory) titles.push(...collectNoteTitles(node.children ?? []))
    else titles.push(titleFromNodeName(node.name))
  }
  return titles
}

/** `folderPath` is `/`-separated directory names (e.g. "NPCs/Archangels"), matched by exact
 * segment name. Recurses into subfolders (confirmed with the user 2026-07-28 — a folder-add
 * picks up every note anywhere underneath, not just direct children). Returns [] if the path
 * doesn't resolve to a real directory. */
export function listNoteTitlesInFolder(tree: FolderTreeNode[], folderPath: string): string[] {
  const segments = folderPath.split('/').map((s) => s.trim()).filter(Boolean)
  let level = tree
  for (const segment of segments) {
    const dir = level.find((n) => n.isDirectory && n.name === segment)
    if (!dir) return []
    level = dir.children ?? []
  }
  return collectNoteTitles(level)
}

/** Every directory path in the tree, `/`-joined — feeds the folder-add control's datalist
 * (this app's standard autocomplete pattern; see EventSheet.tsx's Location field). */
export function listFolderPaths(tree: FolderTreeNode[], prefix = ''): string[] {
  const paths: string[] = []
  for (const node of tree) {
    if (!node.isDirectory) continue
    const path = prefix ? `${prefix}/${node.name}` : node.name
    paths.push(path)
    paths.push(...listFolderPaths(node.children ?? [], path))
  }
  return paths
}
