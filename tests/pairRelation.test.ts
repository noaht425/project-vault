import { describe, it, expect } from 'vitest'
import { findPairPercent, upsertPairRelation, type PairRelation } from '../src/common/noteTypes/settlement'

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
