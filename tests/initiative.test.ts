import { describe, it, expect } from 'vitest'
import {
  buildCombatants,
  rollInitiativeFor,
  sortedTurnOrder,
  advanceTurn,
  endEncounter,
  applyHpDelta,
  addCondition,
  removeCondition,
  removeCombatant,
  parseEncounter,
  type Combatant,
  type Encounter
} from '../src/common/initiative'

// Deterministic RNG: returns a fixed sequence of [0,1) values in order,
// repeating the last one if exhausted. Same helper as tests/dice.test.ts.
function sequenceRng(values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

function sequenceIds(ids: string[]): () => string {
  let i = 0
  return () => ids[Math.min(i++, ids.length - 1)]
}

function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'c1',
    name: 'Goblin',
    sourceNoteTitle: null,
    ac: 12,
    maxHp: 7,
    currentHp: 7,
    initiativeBonus: 0,
    initiative: null,
    conditions: [],
    isPc: false,
    ...overrides
  }
}

describe('buildCombatants', () => {
  it('keeps a plain name when count is 1', () => {
    const [combatant] = buildCombatants(
      { name: 'Goblin', sourceNoteTitle: null, ac: 12, maxHp: 7, initiativeBonus: 1, isPc: false, count: 1 },
      sequenceIds(['id-1'])
    )
    expect(combatant.name).toBe('Goblin')
    expect(combatant.currentHp).toBe(7)
    expect(combatant.initiative).toBeNull()
    expect(combatant.conditions).toEqual([])
  })

  it('numbers combatants when count is greater than 1', () => {
    const combatants = buildCombatants(
      { name: 'Goblin', sourceNoteTitle: null, ac: 12, maxHp: 7, initiativeBonus: 1, isPc: false, count: 3 },
      sequenceIds(['id-1', 'id-2', 'id-3'])
    )
    expect(combatants.map((c) => c.name)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3'])
    expect(combatants.map((c) => c.id)).toEqual(['id-1', 'id-2', 'id-3'])
  })

  it('starts currentHp at maxHp for every copy when startingHp is omitted', () => {
    const combatants = buildCombatants(
      { name: 'Goblin', sourceNoteTitle: null, ac: 12, maxHp: 7, initiativeBonus: 0, isPc: false, count: 2 },
      sequenceIds(['a', 'b'])
    )
    expect(combatants.every((c) => c.currentHp === c.maxHp)).toBe(true)
  })

  it('starts at startingHp when given (a note-sourced combatant already recorded as wounded)', () => {
    const [combatant] = buildCombatants(
      { name: 'Bandit', sourceNoteTitle: 'Bandit', ac: 12, maxHp: 11, startingHp: 4, initiativeBonus: 0, isPc: false, count: 1 },
      sequenceIds(['a'])
    )
    expect(combatant.currentHp).toBe(4)
    expect(combatant.maxHp).toBe(11)
  })
})

describe('rollInitiativeFor', () => {
  it('adds a positive initiative bonus', () => {
    const rng = sequenceRng([14 / 20]) // -> 15
    expect(rollInitiativeFor(makeCombatant({ initiativeBonus: 3 }), rng)).toBe(18)
  })

  it('subtracts a negative initiative bonus', () => {
    const rng = sequenceRng([14 / 20]) // -> 15
    expect(rollInitiativeFor(makeCombatant({ initiativeBonus: -2 }), rng)).toBe(13)
  })

  it('handles a zero bonus', () => {
    const rng = sequenceRng([19 / 20]) // -> 20
    expect(rollInitiativeFor(makeCombatant({ initiativeBonus: 0 }), rng)).toBe(20)
  })
})

describe('sortedTurnOrder', () => {
  it('sorts by initiative descending', () => {
    const combatants = [
      makeCombatant({ id: 'a', name: 'A', initiative: 10 }),
      makeCombatant({ id: 'b', name: 'B', initiative: 20 }),
      makeCombatant({ id: 'c', name: 'C', initiative: 15 })
    ]
    expect(sortedTurnOrder(combatants).map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('breaks initiative ties by initiative bonus, then name', () => {
    const combatants = [
      makeCombatant({ id: 'a', name: 'Zed', initiative: 15, initiativeBonus: 1 }),
      makeCombatant({ id: 'b', name: 'Amy', initiative: 15, initiativeBonus: 3 }),
      makeCombatant({ id: 'c', name: 'Ben', initiative: 15, initiativeBonus: 1 })
    ]
    // b wins the initiative tie on bonus; a ("Zed") vs c ("Ben") tie on both, so name breaks it.
    expect(sortedTurnOrder(combatants).map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts un-rolled combatants (null initiative) after every rolled one', () => {
    const combatants = [
      makeCombatant({ id: 'a', name: 'A', initiative: null }),
      makeCombatant({ id: 'b', name: 'B', initiative: 5 })
    ]
    expect(sortedTurnOrder(combatants).map((c) => c.id)).toEqual(['b', 'a'])
  })
})

describe('advanceTurn', () => {
  const combatants = [
    makeCombatant({ id: 'a', name: 'A', initiative: 20 }),
    makeCombatant({ id: 'b', name: 'B', initiative: 10 })
  ]

  it('starts round 1 on the very first call, without incrementing', () => {
    const encounter: Encounter = { round: 1, combatants, activeCombatantId: null }
    const next = advanceTurn(encounter)
    expect(next.activeCombatantId).toBe('a')
    expect(next.round).toBe(1)
  })

  it('moves to the next combatant in turn order without wrapping', () => {
    const encounter: Encounter = { round: 1, combatants, activeCombatantId: 'a' }
    const next = advanceTurn(encounter)
    expect(next.activeCombatantId).toBe('b')
    expect(next.round).toBe(1)
  })

  it('wraps to the first combatant and increments round', () => {
    const encounter: Encounter = { round: 1, combatants, activeCombatantId: 'b' }
    const next = advanceTurn(encounter)
    expect(next.activeCombatantId).toBe('a')
    expect(next.round).toBe(2)
  })

  it('is a no-op on an empty encounter', () => {
    const encounter: Encounter = { round: 1, combatants: [], activeCombatantId: null }
    expect(advanceTurn(encounter)).toEqual(encounter)
  })
})

describe('endEncounter', () => {
  it('keeps PCs (with their HP) and drops everyone else', () => {
    const encounter: Encounter = {
      round: 3,
      combatants: [
        makeCombatant({ id: 'pc1', name: 'Hero', isPc: true, currentHp: 4, maxHp: 10, initiative: 18, conditions: ['Prone'] }),
        makeCombatant({ id: 'goblin', name: 'Goblin', isPc: false })
      ],
      activeCombatantId: 'goblin'
    }
    const ended = endEncounter(encounter)
    expect(ended.round).toBe(1)
    expect(ended.activeCombatantId).toBeNull()
    expect(ended.combatants).toHaveLength(1)
    expect(ended.combatants[0]).toMatchObject({ id: 'pc1', currentHp: 4, maxHp: 10, initiative: null, conditions: [] })
  })
})

describe('applyHpDelta', () => {
  it('clamps healing at maxHp', () => {
    const combatant = makeCombatant({ currentHp: 5, maxHp: 7 })
    expect(applyHpDelta(combatant, 10).currentHp).toBe(7)
  })

  it('clamps damage at 0', () => {
    const combatant = makeCombatant({ currentHp: 3, maxHp: 7 })
    expect(applyHpDelta(combatant, -10).currentHp).toBe(0)
  })

  it('applies a plain delta within bounds', () => {
    const combatant = makeCombatant({ currentHp: 5, maxHp: 7 })
    expect(applyHpDelta(combatant, -2).currentHp).toBe(3)
  })
})

describe('conditions', () => {
  it('adds a trimmed condition, ignoring duplicates', () => {
    const combatant = makeCombatant({ conditions: ['Prone'] })
    const withDupe = addCondition(combatant, '  Prone  ')
    expect(withDupe.conditions).toEqual(['Prone'])
    const withNew = addCondition(combatant, 'Poisoned')
    expect(withNew.conditions).toEqual(['Prone', 'Poisoned'])
  })

  it('ignores a blank condition', () => {
    const combatant = makeCombatant({ conditions: [] })
    expect(addCondition(combatant, '   ').conditions).toEqual([])
  })

  it('removes a condition', () => {
    const combatant = makeCombatant({ conditions: ['Prone', 'Poisoned'] })
    expect(removeCondition(combatant, 'Prone').conditions).toEqual(['Poisoned'])
  })
})

describe('removeCombatant', () => {
  it('removes the matching combatant and clears activeCombatantId if it was active', () => {
    const encounter: Encounter = {
      round: 1,
      combatants: [makeCombatant({ id: 'a' }), makeCombatant({ id: 'b' })],
      activeCombatantId: 'a'
    }
    const next = removeCombatant(encounter, 'a')
    expect(next.combatants.map((c) => c.id)).toEqual(['b'])
    expect(next.activeCombatantId).toBeNull()
  })

  it('leaves activeCombatantId alone if a different combatant is removed', () => {
    const encounter: Encounter = {
      round: 1,
      combatants: [makeCombatant({ id: 'a' }), makeCombatant({ id: 'b' })],
      activeCombatantId: 'a'
    }
    const next = removeCombatant(encounter, 'b')
    expect(next.activeCombatantId).toBe('a')
  })
})

describe('parseEncounter', () => {
  it('falls back to an empty encounter for missing/corrupt data', () => {
    expect(parseEncounter(null)).toEqual({ round: 1, combatants: [], activeCombatantId: null })
    expect(parseEncounter(undefined)).toEqual({ round: 1, combatants: [], activeCombatantId: null })
    expect(parseEncounter('not an object')).toEqual({ round: 1, combatants: [], activeCombatantId: null })
  })

  it('round-trips a well-formed encounter', () => {
    const encounter: Encounter = {
      round: 2,
      combatants: [makeCombatant({ id: 'a' })],
      activeCombatantId: 'a'
    }
    expect(parseEncounter(encounter)).toEqual(encounter)
  })
})
