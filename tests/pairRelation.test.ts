import { describe, it, expect } from 'vitest'
import { findPairPercent, resolvePairRelationTable, upsertPairRelation, type PairRelation } from '../src/common/noteTypes/settlement'

describe('findPairPercent', () => {
  it('finds a stored pair regardless of which order it was stored in', () => {
    const relations: PairRelation[] = [{ a: 'human', b: 'elf', percent: 30 }]
    expect(findPairPercent(relations, 'human', 'elf')).toBe(30)
    expect(findPairPercent(relations, 'elf', 'human')).toBe(30)
  })

  it('returns undefined for a pair that has never been stored', () => {
    expect(findPairPercent([], 'human', 'elf')).toBeUndefined()
  })
})

describe('upsertPairRelation', () => {
  it('appends a new row when the pair has no existing entry', () => {
    const result = upsertPairRelation([], 'human', 'elf', 25)
    expect(result).toEqual([{ a: 'human', b: 'elf', percent: 25 }])
  })

  it('replaces the existing row in place, regardless of stored order, without adding a duplicate', () => {
    const relations: PairRelation[] = [{ a: 'elf', b: 'human', percent: 10 }]
    const result = upsertPairRelation(relations, 'human', 'elf', 40)
    expect(result).toHaveLength(1)
    expect(result[0].percent).toBe(40)
  })

  it("doesn't mutate the original array", () => {
    const relations: PairRelation[] = [{ a: 'human', b: 'elf', percent: 10 }]
    upsertPairRelation(relations, 'human', 'elf', 99)
    expect(relations[0].percent).toBe(10)
  })
})

describe('resolvePairRelationTable', () => {
  it('includes every unique pair among the keys, including self-pairs, exactly once', () => {
    const rows = resolvePairRelationTable(['human', 'elf', 'dwarf'], [], () => 0)
    const pairKeys = rows.map((r) => [r.a, r.b].sort().join(','))
    expect(pairKeys.sort()).toEqual(['dwarf,dwarf', 'dwarf,elf', 'dwarf,human', 'elf,elf', 'elf,human', 'human,human'].sort())
  })

  it('uses the stored percent when a pair has one, and defaultPercent otherwise', () => {
    const relations: PairRelation[] = [{ a: 'human', b: 'elf', percent: 15 }]
    const rows = resolvePairRelationTable(['human', 'elf'], relations, (a, b) => (a === b ? 100 : 0))

    const humanElf = rows.find((r) => (r.a === 'human' && r.b === 'elf') || (r.a === 'elf' && r.b === 'human'))!
    const humanHuman = rows.find((r) => r.a === 'human' && r.b === 'human')!
    expect(humanElf.percent).toBe(15)
    expect(humanHuman.percent).toBe(100)
  })

  it('returns an empty table for an empty key list', () => {
    expect(resolvePairRelationTable([], [], () => 0)).toEqual([])
  })
})
