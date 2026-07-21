import { describe, it, expect } from 'vitest'
import { parseRelationships, computeFamilyTreeLayout } from '../src/common/noteTypes/familyTree'

describe('parseRelationships', () => {
  it('parses all four relation phrases', () => {
    const body = `
## Relationships
- [[Alice]] parent of [[Bob]]
- [[Carol]] child of [[Bob]]
- [[Alice]] spouse of [[Dave]]
- [[Bob]] sibling of [[Eve]]
`
    expect(parseRelationships(body)).toEqual([
      { a: 'Alice', b: 'Bob', relation: 'parent' },
      { a: 'Bob', b: 'Carol', relation: 'parent' },
      { a: 'Alice', b: 'Dave', relation: 'spouse' },
      { a: 'Bob', b: 'Eve', relation: 'sibling' }
    ])
  })

  it('is case-insensitive on the relation phrase and heading', () => {
    const body = '## relationships\n- [[Alice]] PARENT OF [[Bob]]\n'
    expect(parseRelationships(body)).toEqual([{ a: 'Alice', b: 'Bob', relation: 'parent' }])
  })

  it('ignores prose and unrelated headings, only reading lines under Relationships', () => {
    const body = `
## Overview
- [[Alice]] parent of [[Bob]]

## Relationships
- [[Carol]] parent of [[Dave]]
`
    expect(parseRelationships(body)).toEqual([{ a: 'Carol', b: 'Dave', relation: 'parent' }])
  })

  it('merges multiple Relationships sections', () => {
    const body = `
## Relationships
- [[Alice]] parent of [[Bob]]

## Notes

## Relationships
- [[Carol]] spouse of [[Dave]]
`
    expect(parseRelationships(body)).toEqual([
      { a: 'Alice', b: 'Bob', relation: 'parent' },
      { a: 'Carol', b: 'Dave', relation: 'spouse' }
    ])
  })

  it('silently skips malformed lines instead of throwing', () => {
    const body = '## Relationships\n- Alice parent of Bob\n- [[Alice]] married to [[Bob]]\n- not a bullet at all\n'
    expect(parseRelationships(body)).toEqual([])
  })

  it('returns nothing when there is no Relationships heading', () => {
    expect(parseRelationships('just prose, no relationships here')).toEqual([])
  })
})

describe('computeFamilyTreeLayout', () => {
  it('assigns generation 0 to nodes with no recorded parent', () => {
    const layout = computeFamilyTreeLayout([{ a: 'Alice', b: 'Bob', relation: 'spouse' }])
    expect(layout.nodes.map((n) => ({ name: n.name, generation: n.generation }))).toEqual([
      { name: 'Alice', generation: 0 },
      { name: 'Bob', generation: 0 }
    ])
  })

  it('stacks three generations by depth', () => {
    const layout = computeFamilyTreeLayout([
      { a: 'Grandpa', b: 'Dad', relation: 'parent' },
      { a: 'Dad', b: 'Kid', relation: 'parent' }
    ])
    const byName = Object.fromEntries(layout.nodes.map((n) => [n.name, n.generation]))
    expect(byName).toEqual({ Grandpa: 0, Dad: 1, Kid: 2 })
  })

  it('places declared spouse pairs adjacent within their row', () => {
    const layout = computeFamilyTreeLayout([
      { a: 'Alice', b: 'Bob', relation: 'parent' },
      { a: 'Carol', b: 'Dave', relation: 'spouse' },
      { a: 'Carol', b: 'Bob', relation: 'parent' }
    ])
    const row0 = layout.nodes.filter((n) => n.generation === 0).sort((x, y) => x.col - y.col)
    const names = row0.map((n) => n.name)
    const carolIdx = names.indexOf('Carol')
    const daveIdx = names.indexOf('Dave')
    expect(Math.abs(carolIdx - daveIdx)).toBe(1)
  })

  it('does not hang on a circular parent chain, falling back to generation 0', () => {
    const layout = computeFamilyTreeLayout([
      { a: 'Alice', b: 'Bob', relation: 'parent' },
      { a: 'Bob', b: 'Alice', relation: 'parent' }
    ])
    expect(layout.nodes).toHaveLength(2)
    expect(layout.nodes.every((n) => Number.isFinite(n.generation))).toBe(true)
  })

  it('draws a parent-child line per recorded parent, and a spouse line per couple', () => {
    const layout = computeFamilyTreeLayout([
      { a: 'Alice', b: 'Kid', relation: 'parent' },
      { a: 'Bob', b: 'Kid', relation: 'parent' },
      { a: 'Alice', b: 'Bob', relation: 'spouse' }
    ])
    expect(layout.lines).toEqual(
      expect.arrayContaining([
        { kind: 'parent-child', from: 'Alice', to: 'Kid' },
        { kind: 'parent-child', from: 'Bob', to: 'Kid' },
        { kind: 'spouse', from: 'Alice', to: 'Bob' }
      ])
    )
  })

  it('omits a sibling line when the pair already shares a recorded parent', () => {
    const layout = computeFamilyTreeLayout([
      { a: 'Alice', b: 'Bob', relation: 'parent' },
      { a: 'Alice', b: 'Carol', relation: 'parent' },
      { a: 'Bob', b: 'Carol', relation: 'sibling' }
    ])
    expect(layout.lines.some((l) => l.kind === 'sibling')).toBe(false)
  })

  it('keeps a sibling line when no shared parent is on record', () => {
    const layout = computeFamilyTreeLayout([{ a: 'Bob', b: 'Carol', relation: 'sibling' }])
    expect(layout.lines).toContainEqual({ kind: 'sibling', from: 'Bob', to: 'Carol' })
  })
})
