import { describe, it, expect } from 'vitest'
import { buildGraph } from '../src/common/graph'

describe('buildGraph', () => {
  it('builds a node per note and an edge per link', () => {
    const notes = [
      { path: '/a.md', title: 'A', type: 'npc' },
      { path: '/b.md', title: 'B', type: 'location' }
    ]
    const links = [{ sourcePath: '/a.md', targetTitle: 'B' }]

    const graph = buildGraph(notes, links)
    expect(graph.nodes).toEqual([
      { id: '/a.md', title: 'A', noteType: 'npc', path: '/a.md' },
      { id: '/b.md', title: 'B', noteType: 'location', path: '/b.md' }
    ])
    expect(graph.edges).toEqual([{ source: '/a.md', target: '/b.md' }])
  })

  it('matches link targets to note titles case-insensitively', () => {
    const notes = [{ path: '/a.md', title: 'Kingdom of Geno', type: 'location' }]
    const links = [{ sourcePath: '/a.md', targetTitle: 'kingdom of GENO' }]
    // self-referential after case-insensitive resolution, so no edge — just
    // confirms the title match itself didn't fall through to a phantom node
    const graph = buildGraph(notes, links)
    expect(graph.nodes).toHaveLength(1)
  })

  it('synthesizes a phantom node for a link with no matching note', () => {
    const notes = [{ path: '/a.md', title: 'A', type: 'npc' }]
    const links = [{ sourcePath: '/a.md', targetTitle: 'Nara Veril' }]

    const graph = buildGraph(notes, links)
    expect(graph.nodes).toContainEqual({
      id: 'phantom:nara veril',
      title: 'Nara Veril',
      noteType: null,
      path: null
    })
    expect(graph.edges).toEqual([{ source: '/a.md', target: 'phantom:nara veril' }])
  })

  it('reuses the same phantom node for multiple links to the same missing title', () => {
    const notes = [
      { path: '/a.md', title: 'A', type: 'npc' },
      { path: '/b.md', title: 'B', type: 'npc' }
    ]
    const links = [
      { sourcePath: '/a.md', targetTitle: 'Ghost' },
      { sourcePath: '/b.md', targetTitle: 'ghost' } // different case, same title
    ]

    const graph = buildGraph(notes, links)
    const phantoms = graph.nodes.filter((n) => n.path === null)
    expect(phantoms).toHaveLength(1)
    expect(graph.edges).toHaveLength(2)
  })

  it('collapses duplicate links between the same pair into one edge', () => {
    const notes = [
      { path: '/a.md', title: 'A', type: 'npc' },
      { path: '/b.md', title: 'B', type: 'npc' }
    ]
    const links = [
      { sourcePath: '/a.md', targetTitle: 'B' },
      { sourcePath: '/a.md', targetTitle: 'B' }
    ]

    const graph = buildGraph(notes, links)
    expect(graph.edges).toHaveLength(1)
  })

  it('skips a note linking to itself', () => {
    const notes = [{ path: '/a.md', title: 'A', type: 'npc' }]
    const links = [{ sourcePath: '/a.md', targetTitle: 'A' }]

    const graph = buildGraph(notes, links)
    expect(graph.edges).toEqual([])
  })

  it('ignores a link whose source note no longer exists', () => {
    const notes = [{ path: '/b.md', title: 'B', type: 'npc' }]
    const links = [{ sourcePath: '/deleted.md', targetTitle: 'B' }]

    const graph = buildGraph(notes, links)
    expect(graph.edges).toEqual([])
    expect(graph.nodes).toHaveLength(1)
  })

  it('returns an empty graph for an empty vault', () => {
    expect(buildGraph([], [])).toEqual({ nodes: [], edges: [] })
  })
})
