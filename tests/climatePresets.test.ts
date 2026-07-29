import { describe, it, expect } from 'vitest'
import { CLIMATE_PRESETS, applyClimatePreset } from '../src/common/climatePresets'

// Deterministic id sequence so assertions can check exact ids instead of
// just shapes — same "injectable idFactory" pattern as
// settlementGenerator.ts's generateSettlement.
function sequentialIdFactory(): () => string {
  let n = 0
  return () => `id-${n++}`
}

const TWELVE_MONTHS = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}` }))

describe('CLIMATE_PRESETS', () => {
  it('has 12 curated presets, each with unique ids', () => {
    expect(CLIMATE_PRESETS).toHaveLength(12)
    expect(new Set(CLIMATE_PRESETS.map((p) => p.id)).size).toBe(12)
  })

  it('every preset\'s season fractions sum to (approximately) 1', () => {
    for (const preset of CLIMATE_PRESETS) {
      const total = preset.seasons.reduce((sum, s) => sum + s.fractionOfYear, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })

  it('every preset has at least one season, and every season has at least one condition', () => {
    for (const preset of CLIMATE_PRESETS) {
      expect(preset.seasons.length).toBeGreaterThan(0)
      for (const season of preset.seasons) {
        expect(season.conditions.length).toBeGreaterThan(0)
        for (const condition of season.conditions) {
          expect(condition.weight).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('applyClimatePreset', () => {
  it('assigns every month to exactly one season', () => {
    const preset = CLIMATE_PRESETS.find((p) => p.id === 'humid-subtropical')! // 4 equal seasons
    const seasons = applyClimatePreset(preset, TWELVE_MONTHS, sequentialIdFactory())

    const allAssigned = seasons.flatMap((s) => s.monthIds)
    expect(allAssigned).toHaveLength(12)
    expect(new Set(allAssigned).size).toBe(12) // no month assigned twice

    // Equal fractions (0.25 each) over 12 months -> 3 months per season, in order.
    expect(seasons.map((s) => s.monthIds)).toEqual([
      ['m0', 'm1', 'm2'],
      ['m3', 'm4', 'm5'],
      ['m6', 'm7', 'm8'],
      ['m9', 'm10', 'm11']
    ])
  })

  it('splits unevenly according to season fractions (e.g. a 75/25 winter-heavy climate)', () => {
    const preset = CLIMATE_PRESETS.find((p) => p.id === 'subarctic')! // Short Summer 0.25, Long Winter 0.75
    const seasons = applyClimatePreset(preset, TWELVE_MONTHS, sequentialIdFactory())

    expect(seasons[0].name).toBe('Short Summer')
    expect(seasons[0].monthIds).toHaveLength(3)
    expect(seasons[1].name).toBe('Long Winter')
    expect(seasons[1].monthIds).toHaveLength(9)
  })

  it('produces real season/condition ids and copies over names + weights', () => {
    const preset = CLIMATE_PRESETS.find((p) => p.id === 'desert')!
    const seasons = applyClimatePreset(preset, TWELVE_MONTHS, sequentialIdFactory())

    expect(seasons[0].id).toBe('id-0')
    expect(seasons[0].name).toBe('Scorching Season')
    expect(seasons[0].conditions[0]).toEqual({ id: 'id-1', name: 'Clear and scorching', weight: 5 })
  })

  it('returns empty monthIds (but still builds seasons/conditions) when the calendar has no months yet', () => {
    const preset = CLIMATE_PRESETS.find((p) => p.id === 'tundra')!
    const seasons = applyClimatePreset(preset, [], sequentialIdFactory())

    expect(seasons).toHaveLength(2)
    expect(seasons.every((s) => s.monthIds.length === 0)).toBe(true)
    expect(seasons[0].conditions.length).toBeGreaterThan(0)
  })

  it('handles a calendar with fewer months than seasons without dropping any month', () => {
    const preset = CLIMATE_PRESETS.find((p) => p.id === 'humid-continental')! // 4 equal seasons
    const twoMonths = [{ id: 'a' }, { id: 'b' }]
    const seasons = applyClimatePreset(preset, twoMonths, sequentialIdFactory())

    const allAssigned = seasons.flatMap((s) => s.monthIds)
    expect(allAssigned.sort()).toEqual(['a', 'b'])
  })

  it('handles a single-season preset by assigning every month to it', () => {
    const preset = CLIMATE_PRESETS.find((p) => p.id === 'tropical-rainforest')! // 1 season, fraction 1
    const seasons = applyClimatePreset(preset, TWELVE_MONTHS, sequentialIdFactory())

    expect(seasons).toHaveLength(1)
    expect(seasons[0].monthIds).toHaveLength(12)
  })
})
