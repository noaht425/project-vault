import { describe, it, expect } from 'vitest'
import { generateSettlement, inferSizeId, type GenerationOptions } from '../src/common/settlementGenerator'
import {
  defaultBuildingTypes,
  defaultRaceLifeStages,
  defaultWealthTiers,
  type BuildingTypeDef,
  type RaceLifeStage,
  type SettlementBuilding,
  type SettlementResident,
  type SpecialtyDef
} from '../src/common/noteTypes/settlement'

// Seeded PRNG (mulberry32) rather than a short repeating sequence — the
// generator makes many rng() calls per resident/building, and repeating the
// last value of a short array (as tests/dice.test.ts's sequenceRng does)
// would make every "random" pick collapse to the same value. Determinism
// here just means "same seed in -> same settlement out", not full coverage
// of every branch by hand-picked values.
function seededRng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sequenceIds(prefix: string): () => string {
  let i = 0
  return () => `${prefix}-${i++}`
}

function baseOptions(overrides: Partial<GenerationOptions> = {}): GenerationOptions {
  return {
    population: 120,
    districts: [{ id: 'main', name: 'Main District' }],
    raceDistribution: [{ race: 'human', percent: 70 }, { race: 'elf', percent: 30 }],
    wealthTiers: defaultWealthTiers(),
    religionDistribution: [{ religion: 'The Old Faith', percent: 100 }],
    buildingTypes: defaultBuildingTypes(),
    ...overrides
  }
}

describe('generateSettlement', () => {
  it('generates exactly `population` residents in total', () => {
    const result = generateSettlement(baseOptions(), undefined, seededRng(1), sequenceIds('r'))
    expect(result.residents).toHaveLength(120)
  })

  it('gives every staffed building exactly one notable resident, and no notable for non-staffed buildings', () => {
    const options = baseOptions()
    const result = generateSettlement(options, undefined, seededRng(2), sequenceIds('r'))

    const staffedBuildingIds = new Set(
      result.buildings
        .filter((b) => options.buildingTypes.find((t) => t.id === b.buildingTypeId)?.staffed)
        .map((b) => b.id)
    )
    const notables = result.residents.filter((r) => r.notable)

    expect(notables).toHaveLength(staffedBuildingIds.size)
    for (const notable of notables) {
      expect(notable.professionBuildingId).not.toBeNull()
      expect(staffedBuildingIds.has(notable.professionBuildingId!)).toBe(true)
      expect(notable.personalityLine.length).toBeGreaterThan(0)
      expect(notable.goal.length).toBeGreaterThan(0)
      expect(notable.stats).not.toBeNull()
    }
  })

  it('gives every non-notable resident a flavor tag instead of a full personality', () => {
    const result = generateSettlement(baseOptions(), undefined, seededRng(3), sequenceIds('r'))
    const stubs = result.residents.filter((r) => !r.notable)
    expect(stubs.length).toBeGreaterThan(0)
    for (const stub of stubs) {
      expect(stub.flavorTag.length).toBeGreaterThan(0)
      expect(stub.personalityLine).toBe('')
      expect(stub.stats).toBeNull()
    }
  })

  it('is deterministic given the same rng and id sequence', () => {
    const a = generateSettlement(baseOptions(), undefined, seededRng(42), sequenceIds('r'))
    const b = generateSettlement(baseOptions(), undefined, seededRng(42), sequenceIds('r'))
    expect(a).toEqual(b)
  })

  it('never touches a promoted (linkedNoteTitle set) building or resident on regeneration', () => {
    const promotedBuilding: SettlementBuilding = {
      id: 'kept-building',
      name: 'The Rusty Anchor',
      buildingTypeId: 'tavern',
      wealthTierId: 'middle',
      districtId: 'main',
      linkedNoteTitle: 'The Rusty Anchor'
    }
    const promotedResident: SettlementResident = {
      id: 'kept-resident',
      name: 'Old Tomas',
      race: 'human',
      age: 60,
      gender: 'Male',
      professionBuildingId: 'kept-building',
      homeBuildingId: null,
      wealthTierId: 'middle',
      districtId: 'main',
      religion: 'The Old Faith',
      notable: true,
      flavorTag: '',
      personalityLine: 'Set by the user, not the generator',
      goal: 'Custom goal',
      stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      proficiencies: [],
      appearance: '',
      linkedNoteTitle: 'Old Tomas'
    }
    const unpromotedResident: SettlementResident = { ...promotedResident, id: 'unpromoted', linkedNoteTitle: null }

    const result = generateSettlement(
      baseOptions(),
      { buildings: [promotedBuilding], residents: [promotedResident, unpromotedResident] },
      seededRng(7),
      sequenceIds('r')
    )

    expect(result.buildings).toContainEqual(promotedBuilding)
    expect(result.residents).toContainEqual(promotedResident)
    expect(result.residents.find((r) => r.id === 'unpromoted')).toBeUndefined()
  })

  it('applies a soft (not hard) size floor to building types above the current size tier', () => {
    // allocateByWeight is a pure function of weights, with no rng involved,
    // so with equal base weights this comparison is exact and seed-
    // independent — it isolates sizeGateMultiplier's effect specifically.
    const buildingTypes: BuildingTypeDef[] = [
      { id: 'basic-shop', name: 'Basic Shop', category: 'shop', defaultWealthTierId: '', staffed: true, weight: 1, minSizeId: 'hamlet', primaryAbility: '', secondaryAbility: '', proficiencyPool: [] },
      { id: 'metropolis-only', name: 'Grand Bazaar', category: 'shop', defaultWealthTierId: '', staffed: true, weight: 1, minSizeId: 'metropolis', primaryAbility: '', secondaryAbility: '', proficiencyPool: [] }
    ]
    const options = (sizeId: string): GenerationOptions => ({
      population: 400,
      sizeId,
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes
    })

    const hamletResult = generateSettlement(options('hamlet'), undefined, seededRng(1), sequenceIds('h'))
    const metropolisResult = generateSettlement(options('metropolis'), undefined, seededRng(1), sequenceIds('m'))

    const countOf = (buildings: SettlementBuilding[], typeId: string): number =>
      buildings.filter((b) => b.buildingTypeId === typeId).length

    // Never a hard zero — a hamlet CAN still roll the metropolis-tier type,
    // just heavily deprioritized relative to a metropolis rolling it.
    expect(countOf(hamletResult.buildings, 'metropolis-only')).toBeLessThan(countOf(metropolisResult.buildings, 'metropolis-only'))
    expect(countOf(hamletResult.buildings, 'basic-shop')).toBeGreaterThan(countOf(hamletResult.buildings, 'metropolis-only'))
  })

  it('boosts a specialty-targeted building type\'s share when that specialty is active, and stacks multiple active specialties', () => {
    const buildingTypes: BuildingTypeDef[] = [
      { id: 'fishmonger', name: 'Fishmonger', category: 'shop', defaultWealthTierId: '', staffed: true, weight: 1, minSizeId: 'hamlet', primaryAbility: '', secondaryAbility: '', proficiencyPool: [] },
      { id: 'jeweler', name: 'Jeweler', category: 'shop', defaultWealthTierId: '', staffed: true, weight: 1, minSizeId: 'hamlet', primaryAbility: '', secondaryAbility: '', proficiencyPool: [] }
    ]
    const specialties: SpecialtyDef[] = [
      { id: 'port-town', name: 'Port Town', boosts: [{ buildingTypeId: 'fishmonger', multiplier: 3 }] },
      { id: 'fishing', name: 'Fishing', boosts: [{ buildingTypeId: 'fishmonger', multiplier: 3 }] }
    ]
    const options = (activeSpecialtyIds: string[]): GenerationOptions => ({
      population: 800,
      sizeId: 'town',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes,
      specialties,
      activeSpecialtyIds
    })

    const countOf = (buildings: SettlementBuilding[], typeId: string): number =>
      buildings.filter((b) => b.buildingTypeId === typeId).length

    const neutral = generateSettlement(options([]), undefined, seededRng(1), sequenceIds('n'))
    const onePort = generateSettlement(options(['port-town']), undefined, seededRng(1), sequenceIds('p'))
    const bothStacked = generateSettlement(options(['port-town', 'fishing']), undefined, seededRng(1), sequenceIds('b'))

    expect(countOf(neutral.buildings, 'fishmonger')).toBe(countOf(neutral.buildings, 'jeweler'))
    expect(countOf(onePort.buildings, 'fishmonger')).toBeGreaterThan(countOf(neutral.buildings, 'fishmonger'))
    expect(countOf(bothStacked.buildings, 'fishmonger')).toBeGreaterThan(countOf(onePort.buildings, 'fishmonger'))
  })
})

describe('phonetic-profile custom races', () => {
  it('synthesizes resident names from the phonetic profile instead of a name-list pool', () => {
    const options = baseOptions({
      raceDistribution: [{ race: 'sylvani', percent: 100 }],
      customRaces: [{ id: 'sylvani', name: 'Sylvani', inspirationSourceIds: [], phoneticProfileId: 'elvish-leaning' }]
    })
    const result = generateSettlement(options, undefined, seededRng(11), sequenceIds('r'))
    // A synthesized name should never collide with the baseline human bank's
    // real-world last names — a light sanity check that generation actually
    // routed through phoneticNames.ts rather than falling through to
    // resolveNameBank's generic fallback.
    const lastNames = result.residents.map((r) => r.name.split(' ')[1])
    expect(lastNames.some((n) => n === 'Ashford' || n === 'Blackwell')).toBe(false)
  })
})

describe('wealth tier percent', () => {
  it('drives the residence class mix, not just each building type\'s own defaultWealthTierId', () => {
    // Every default building type has an opinionated defaultWealthTierId
    // (House -> middle, Manor -> upper, ...). Skewing the tiers' percent
    // heavily toward "lower" should still shift the overall residence mix
    // toward lower-tier buildings, since the percent split now happens
    // BEFORE picking which building type fills each tier's slots.
    const skewedTiers = [
      { id: 'upper', name: 'Upper', percent: 2 },
      { id: 'middle', name: 'Middle', percent: 8 },
      { id: 'lower', name: 'Lower', percent: 90 }
    ]
    const options: GenerationOptions = {
      population: 2000,
      sizeId: 'town',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: skewedTiers,
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: defaultBuildingTypes()
    }

    const result = generateSettlement(options, undefined, seededRng(5), sequenceIds('r'))
    const residenceBuildings = result.buildings.filter((b) =>
      defaultBuildingTypes().some((t) => t.category === 'residence' && t.id === b.buildingTypeId)
    )
    const lowerCount = residenceBuildings.filter((b) => b.wealthTierId === 'lower').length

    expect(lowerCount / residenceBuildings.length).toBeGreaterThan(0.8)
  })

  it('falls back to plain weighted allocation with no tier assigned when no wealth tiers are configured', () => {
    const options: GenerationOptions = {
      population: 200,
      sizeId: 'village',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: [],
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: defaultBuildingTypes()
    }
    const result = generateSettlement(options, undefined, seededRng(6), sequenceIds('r'))
    expect(result.buildings.length).toBeGreaterThan(0)
    expect(result.buildings.every((b) => b.wealthTierId === '')).toBe(true)
  })
})

describe('inferSizeId', () => {
  it('maps a population into the right preset, clamping outside the whole range', () => {
    expect(inferSizeId(50)).toBe('hamlet')
    expect(inferSizeId(500)).toBe('village')
    expect(inferSizeId(3000)).toBe('town')
    expect(inferSizeId(10000)).toBe('city')
    expect(inferSizeId(50000)).toBe('metropolis')
    expect(inferSizeId(1)).toBe('hamlet')
    expect(inferSizeId(10_000_000)).toBe('metropolis')
  })
})

describe('ability scores', () => {
  const unbiasedBuildingType: BuildingTypeDef = {
    id: 'shop',
    name: 'Shop',
    category: 'shop',
    defaultWealthTierId: '',
    staffed: true,
    weight: 1,
    minSizeId: 'hamlet',
    primaryAbility: '',
    secondaryAbility: '',
    proficiencyPool: []
  }

  it('centers unbiased ability scores around 10 with the majority in 8-12, matching the requested bell-curve shape', () => {
    const options: GenerationOptions = {
      population: 4000,
      sizeId: 'city',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: [unbiasedBuildingType]
    }
    const result = generateSettlement(options, undefined, seededRng(21), sequenceIds('r'))
    const notables = result.residents.filter((r) => r.notable)
    expect(notables.length).toBeGreaterThan(50)

    const allScores = notables.flatMap((r) => Object.values(r.stats!))
    const mean = allScores.reduce((sum, v) => sum + v, 0) / allScores.length
    expect(mean).toBeGreaterThan(9)
    expect(mean).toBeLessThan(11)

    const within8to12 = allScores.filter((v) => v >= 8 && v <= 12).length / allScores.length
    expect(within8to12).toBeGreaterThan(0.55)

    const extreme = allScores.filter((v) => v < 6 || v > 17).length / allScores.length
    expect(extreme).toBeLessThan(0.05)

    expect(allScores.every((v) => v >= 3 && v <= 18)).toBe(true)
  })

  it("shifts a building type's primary/secondary ability mean upward for its notables (a cleric's Wisdom, not a guarantee)", () => {
    const biasedType: BuildingTypeDef = { ...unbiasedBuildingType, id: 'temple-like', primaryAbility: 'wis', secondaryAbility: 'cha' }
    const options: GenerationOptions = {
      population: 4000,
      sizeId: 'city',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: [biasedType]
    }
    const result = generateSettlement(options, undefined, seededRng(22), sequenceIds('r'))
    const notables = result.residents.filter((r) => r.notable)
    const avgWis = notables.reduce((sum, r) => sum + r.stats!.wis, 0) / notables.length
    const avgStr = notables.reduce((sum, r) => sum + r.stats!.str, 0) / notables.length
    expect(avgWis).toBeGreaterThan(avgStr + 2)
    expect(avgWis).toBeGreaterThan(12)
  })
})

describe('proficiencies', () => {
  it("gives a notable 1-2 proficiencies drawn only from their building type's pool, with no duplicates", () => {
    const buildingType: BuildingTypeDef = {
      id: 'apothecary-like',
      name: 'Apothecary',
      category: 'shop',
      defaultWealthTierId: '',
      staffed: true,
      weight: 1,
      minSizeId: 'hamlet',
      primaryAbility: 'int',
      secondaryAbility: 'wis',
      proficiencyPool: ['Herbalism Kit', 'Medicine']
    }
    const options: GenerationOptions = {
      population: 2000,
      sizeId: 'town',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: [buildingType]
    }
    const result = generateSettlement(options, undefined, seededRng(23), sequenceIds('r'))
    const notables = result.residents.filter((r) => r.notable)
    expect(notables.length).toBeGreaterThan(10)
    for (const notable of notables) {
      expect(notable.proficiencies.length).toBeGreaterThanOrEqual(1)
      expect(notable.proficiencies.length).toBeLessThanOrEqual(2)
      for (const prof of notable.proficiencies) expect(['Herbalism Kit', 'Medicine']).toContain(prof)
      expect(new Set(notable.proficiencies).size).toBe(notable.proficiencies.length)
    }
  })

  it('gives no proficiencies when the building type has an empty proficiencyPool', () => {
    const buildingType: BuildingTypeDef = {
      id: 'plain-shop',
      name: 'Plain Shop',
      category: 'shop',
      defaultWealthTierId: '',
      staffed: true,
      weight: 1,
      minSizeId: 'hamlet',
      primaryAbility: '',
      secondaryAbility: '',
      proficiencyPool: []
    }
    const options: GenerationOptions = {
      population: 400,
      sizeId: 'village',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: [buildingType]
    }
    const result = generateSettlement(options, undefined, seededRng(25), sequenceIds('r'))
    const notables = result.residents.filter((r) => r.notable)
    expect(notables.length).toBeGreaterThan(0)
    expect(notables.every((r) => r.proficiencies.length === 0)).toBe(true)
  })

  it('never gives a stub resident proficiencies, regardless of the building pools available', () => {
    const result = generateSettlement(baseOptions(), undefined, seededRng(26), sequenceIds('r'))
    const stubs = result.residents.filter((r) => !r.notable)
    expect(stubs.length).toBeGreaterThan(0)
    expect(stubs.every((r) => r.proficiencies.length === 0)).toBe(true)
  })
})

describe('race life stages', () => {
  it("keeps a notable's age within [adulthood, oldAge] for their race", () => {
    const options: GenerationOptions = {
      population: 2000,
      sizeId: 'town',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: defaultBuildingTypes(),
      raceLifeStages: [{ race: 'human', adulthood: 18, oldAge: 70, maxAge: 90 }]
    }
    const result = generateSettlement(options, undefined, seededRng(31), sequenceIds('r'))
    const notables = result.residents.filter((r) => r.notable)
    expect(notables.length).toBeGreaterThan(5)
    expect(notables.every((r) => r.age >= 18 && r.age <= 70)).toBe(true)
  })

  it("keeps a fresh-adult notable (a young heir who inherited the shop) rare rather than as likely as any other adult age", () => {
    // Orc's short adulthood-to-old-age window (14-40) makes this easy to
    // sample heavily: with the old flat-uniform age roll, roughly the
    // youngest 15% of the range (ages 14-17) would appear ~15% of the time.
    // The normal-shaped roll centered 40% through the range should push
    // that well down without making it impossible.
    const options: GenerationOptions = {
      population: 6000,
      sizeId: 'city',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'orc', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: defaultBuildingTypes(),
      raceLifeStages: [{ race: 'orc', adulthood: 14, oldAge: 40, maxAge: 50 }]
    }
    const result = generateSettlement(options, undefined, seededRng(41), sequenceIds('r'))
    const notables = result.residents.filter((r) => r.notable)
    expect(notables.length).toBeGreaterThan(50)

    const freshAdultFraction = notables.filter((r) => r.age <= 17).length / notables.length
    expect(freshAdultFraction).toBeGreaterThan(0) // still possible — a young heir is a fine story
    expect(freshAdultFraction).toBeLessThan(0.1) // but no longer common

    const meanAge = notables.reduce((sum, r) => sum + r.age, 0) / notables.length
    expect(meanAge).toBeGreaterThan(20) // clustered toward "established", not toward the minimum
  })

  it('lets stub residents span the full lifespan including children, within [0, maxAge]', () => {
    const options: GenerationOptions = {
      population: 2000,
      sizeId: 'town',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'human', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: defaultBuildingTypes(),
      raceLifeStages: [{ race: 'human', adulthood: 18, oldAge: 70, maxAge: 90 }]
    }
    const result = generateSettlement(options, undefined, seededRng(32), sequenceIds('r'))
    const stubs = result.residents.filter((r) => !r.notable)
    expect(stubs.every((r) => r.age >= 0 && r.age <= 90)).toBe(true)
    expect(stubs.some((r) => r.age < 18)).toBe(true)
  })

  it('respects per-settlement custom life stages rather than a fixed race lifespan (e.g. a short-lived elf variant)', () => {
    const options: GenerationOptions = {
      population: 2000,
      sizeId: 'town',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'elf', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: defaultBuildingTypes(),
      raceLifeStages: [{ race: 'elf', adulthood: 26, oldAge: 350, maxAge: 450 }]
    }
    const result = generateSettlement(options, undefined, seededRng(33), sequenceIds('r'))
    const notables = result.residents.filter((r) => r.notable)
    expect(notables.length).toBeGreaterThan(0)
    expect(notables.every((r) => r.age >= 26 && r.age <= 350)).toBe(true)
    // None should ever reach the DEFAULT elf lifespan's oldAge (700) — this
    // custom, shorter table is what's actually driving generation.
    expect(notables.every((r) => r.age <= 450)).toBe(true)
  })

  it('falls back to a hardcoded default for a race with no life-stage entry at all', () => {
    const options: GenerationOptions = {
      population: 2000,
      sizeId: 'town',
      districts: [{ id: 'main', name: 'Main District' }],
      raceDistribution: [{ race: 'dwarf', percent: 100 }],
      wealthTiers: defaultWealthTiers(),
      religionDistribution: [{ religion: 'None', percent: 100 }],
      buildingTypes: defaultBuildingTypes(),
      raceLifeStages: []
    }
    const result = generateSettlement(options, undefined, seededRng(34), sequenceIds('r'))
    const notables = result.residents.filter((r) => r.notable)
    expect(notables.length).toBeGreaterThan(0)
    expect(notables.every((r) => r.age >= 18 && r.age <= 70)).toBe(true)
  })

  it('defaultRaceLifeStages() seeds all 8 baseline races with adulthood < oldAge < maxAge', () => {
    const stages = defaultRaceLifeStages()
    expect(stages.length).toBe(8)
    for (const stage of stages) {
      expect(stage.adulthood).toBeLessThan(stage.oldAge)
      expect(stage.oldAge).toBeLessThan(stage.maxAge)
    }
  })
})
