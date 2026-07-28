import { describe, it, expect } from 'vitest'
import {
  settlementFrontmatterSchema,
  defaultSettlementFrontmatter,
  defaultWealthTiers,
  defaultBuildingTypes,
  BUILDING_CATEGORIES,
  customRaceDefSchema
} from '../src/common/noteTypes/settlement'

describe('defaultSettlementFrontmatter', () => {
  it('produces a settlement note with sane seeded defaults', () => {
    const fm = defaultSettlementFrontmatter()
    expect(fm.type).toBe('settlement')
    expect(fm.districts).toHaveLength(1)
    expect(fm.buildings).toEqual([])
    expect(fm.residents).toEqual([])
  })

  it('seeds wealth tiers that sum to 100 percent', () => {
    const tiers = defaultWealthTiers()
    expect(tiers.reduce((sum, t) => sum + t.percent, 0)).toBe(100)
  })

  it('seeds building types spanning every category', () => {
    const types = defaultBuildingTypes()
    for (const category of BUILDING_CATEGORIES) {
      expect(types.some((t) => t.category === category)).toBe(true)
    }
  })

  it('only marks building types as staffed when they are meant to generate a notable', () => {
    const types = defaultBuildingTypes()
    const residences = types.filter((t) => t.category === 'residence')
    expect(residences.every((t) => t.staffed === false)).toBe(true)
  })
})

describe('settlementFrontmatterSchema', () => {
  it('falls back to seeded defaults when fields are missing entirely', () => {
    const fm = settlementFrontmatterSchema.parse({ type: 'settlement' })
    expect(fm.wealthTiers).toEqual(defaultWealthTiers())
    expect(fm.buildingTypes).toEqual(defaultBuildingTypes())
    expect(fm.districts).toHaveLength(1)
  })

  it('falls back on corrupt arrays instead of throwing', () => {
    const fm = settlementFrontmatterSchema.parse({ type: 'settlement', residents: 'not-an-array', buildings: 42 })
    expect(fm.residents).toEqual([])
    expect(fm.buildings).toEqual([])
  })

  it('round-trips a resident with notable content and a promoted note link', () => {
    const fm = settlementFrontmatterSchema.parse({
      type: 'settlement',
      residents: [
        {
          id: 'r1',
          name: 'Test Notable',
          race: 'human',
          wealthTierId: 'middle',
          districtId: 'main',
          notable: true,
          personalityLine: 'Gruff but fair',
          goal: 'wants to retire',
          stats: { str: 12, dex: 10, con: 11, int: 9, wis: 13, cha: 14 },
          linkedNoteTitle: 'Test Notable'
        }
      ]
    })
    expect(fm.residents[0].notable).toBe(true)
    expect(fm.residents[0].linkedNoteTitle).toBe('Test Notable')
    expect(fm.residents[0].stats).toEqual({ str: 12, dex: 10, con: 11, int: 9, wis: 13, cha: 14 })
  })
})

describe('customRaceDefSchema', () => {
  it('defaults inspirationSourceIds to an empty array', () => {
    const race = customRaceDefSchema.parse({ id: 'gnome', name: 'Gnome' })
    expect(race.inspirationSourceIds).toEqual([])
  })
})
