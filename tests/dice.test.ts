import { describe, it, expect } from 'vitest'
import { rollDice } from '../src/common/dice'

// Deterministic RNG: returns a fixed sequence of [0,1) values in order,
// repeating the last one if exhausted.
function sequenceRng(values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('rollDice', () => {
  it('sums a plain roll plus a flat modifier', () => {
    const rng = sequenceRng([0 / 6, 5 / 6]) // -> 1, 6
    const result = rollDice('2d6+3', rng)
    expect(result?.groups).toHaveLength(1)
    expect(result?.groups[0].rolls).toEqual([1, 6])
    expect(result?.groups[0].kept).toEqual([1, 6])
    expect(result?.modifier).toBe(3)
    expect(result?.total).toBe(1 + 6 + 3)
  })

  it('defaults count to 1 when omitted', () => {
    const rng = sequenceRng([19 / 20]) // -> 20
    const result = rollDice('d20', rng)
    expect(result?.groups[0].count).toBe(1)
    expect(result?.total).toBe(20)
  })

  it('combines two different dice types in one expression (the reported bug)', () => {
    const rng = sequenceRng([11 / 12, 4 / 10]) // 1d12 -> 12, 1d10 -> 5
    const result = rollDice('1d12+1d10', rng)
    expect(result?.groups).toHaveLength(2)
    expect(result?.groups[0]).toMatchObject({ sides: 12, rolls: [12], kept: [12] })
    expect(result?.groups[1]).toMatchObject({ sides: 10, rolls: [5], kept: [5] })
    expect(result?.total).toBe(12 + 5)
  })

  it('handles the same combo with spaces around the operator', () => {
    const rng = sequenceRng([0, 0]) // -> 1, 1
    const result = rollDice('1d12 + 1d10', rng)
    expect(result?.total).toBe(1 + 1)
  })

  it('supports three or more mixed dice/modifier terms', () => {
    const rng = sequenceRng([0 / 6, 0 / 4]) // 2d6 -> [1,1], 1d4 -> [1]
    const result = rollDice('2d6+1d4+3', rng)
    expect(result?.groups).toHaveLength(2)
    expect(result?.modifier).toBe(3)
    expect(result?.total).toBe(1 + 1 + 1 + 3)
  })

  it('subtracts a dice group when preceded by a minus', () => {
    const rng = sequenceRng([9 / 20, 3 / 6]) // 1d20 -> 10, 1d6 -> 4
    const result = rollDice('1d20-1d6', rng)
    expect(result?.groups[1].sign).toBe(-1)
    expect(result?.total).toBe(10 - 4)
  })

  it('keeps only the highest N for kh (advantage-style)', () => {
    const rng = sequenceRng([2 / 20, 19 / 20]) // -> 3, 20
    const result = rollDice('2d20kh1', rng)
    expect(result?.groups[0].rolls.slice().sort((a, b) => a - b)).toEqual([3, 20])
    expect(result?.groups[0].kept).toEqual([20])
    expect(result?.total).toBe(20)
  })

  it('keeps only the lowest N for kl (disadvantage-style)', () => {
    const rng = sequenceRng([2 / 20, 19 / 20]) // -> 3, 20
    const result = rollDice('2d20kl1', rng)
    expect(result?.groups[0].kept).toEqual([3])
    expect(result?.total).toBe(3)
  })

  it('rejects a keep count larger than the number of dice', () => {
    expect(rollDice('2d20kh3')).toBeNull()
  })

  it('rejects garbage input instead of throwing', () => {
    expect(rollDice('hello')).toBeNull()
    expect(rollDice('')).toBeNull()
    expect(rollDice('d')).toBeNull()
    expect(rollDice('1d12+')).toBeNull()
    expect(rollDice('1d12++1d10')).toBeNull()
    expect(rollDice('1d12 1d10')).toBeNull() // missing operator between terms
  })

  it('rejects absurd dice counts/sides (guards against accidental huge rolls)', () => {
    expect(rollDice('99999d6')).toBeNull()
    expect(rollDice('1d99999')).toBeNull()
  })

  it('every roll lands within [1, sides]', () => {
    for (let i = 0; i < 200; i++) {
      const result = rollDice('1d20')
      expect(result).not.toBeNull()
      expect(result!.groups[0].rolls[0]).toBeGreaterThanOrEqual(1)
      expect(result!.groups[0].rolls[0]).toBeLessThanOrEqual(20)
    }
  })
})
