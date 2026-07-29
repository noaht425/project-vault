import { describe, it, expect } from 'vitest'
import { listNoteTitlesInFolder, listFolderPaths, type FolderTreeNode } from '../src/common/folderTree'

const tree: FolderTreeNode[] = [
  {
    name: 'NPCs',
    isDirectory: true,
    children: [
      {
        name: 'Archangels',
        isDirectory: true,
        children: [
          { name: 'Archangel Michael.md', isDirectory: false },
          { name: 'Archangel Gabriel.md', isDirectory: false },
          {
            name: 'Seraphim',
            isDirectory: true,
            children: [{ name: 'Metatron.md', isDirectory: false }]
          }
        ]
      },
      {
        name: 'Archdevils',
        isDirectory: true,
        children: [{ name: 'Abaddon.md', isDirectory: false }]
      }
    ]
  },
  { name: 'Loose Note.md', isDirectory: false }
]

describe('listNoteTitlesInFolder', () => {
  it('returns direct-child note titles with the .md extension stripped', () => {
    expect(listNoteTitlesInFolder(tree, 'NPCs/Archdevils')).toEqual(['Abaddon'])
  })

  it('recurses into subfolders (confirmed 2026-07-28: folder-add is not direct-children-only)', () => {
    expect(listNoteTitlesInFolder(tree, 'NPCs/Archangels')).toEqual(
      expect.arrayContaining(['Archangel Michael', 'Archangel Gabriel', 'Metatron'])
    )
    expect(listNoteTitlesInFolder(tree, 'NPCs/Archangels')).toHaveLength(3)
  })

  it('returns an empty array for a path that does not resolve to a real directory', () => {
    expect(listNoteTitlesInFolder(tree, 'NPCs/DoesNotExist')).toEqual([])
    expect(listNoteTitlesInFolder(tree, 'Loose Note')).toEqual([])
  })

  it('tolerates leading/trailing/doubled slashes in the folder path', () => {
    expect(listNoteTitlesInFolder(tree, '/NPCs/Archdevils/')).toEqual(['Abaddon'])
  })
})

describe('listFolderPaths', () => {
  it('lists every directory path, not files, joined with /', () => {
    expect(listFolderPaths(tree)).toEqual([
      'NPCs',
      'NPCs/Archangels',
      'NPCs/Archangels/Seraphim',
      'NPCs/Archdevils'
    ])
  })
})
