import { ABILITY_KEYS, type AbilityScores } from './noteTypes/creatureStats'
import {
  SETTLEMENT_SIZE_IDS,
  type BuildingTypeDef,
  type CustomRaceDef,
  type District,
  type RaceLifeStage,
  type RaceShare,
  type ReligionShare,
  type SettlementBuilding,
  type SettlementResident,
  type SpecialtyDef,
  type WealthTier
} from './noteTypes/settlement'
import { generateFlavorTag, generateGoal, generateName, generatePersonalityLine, resolveNameBank, type NameBank } from './settlementNames'
import { generateSyntheticName, PHONETIC_PROFILES, type PhoneticProfile } from './phoneticNames'
import { generateAppearance } from './settlementAppearance'

export interface SettlementSizePreset {
  id: string
  name: string
  minPopulation: number
  maxPopulation: number
}

// Round starting points for the "pick a size" step of generation — the user
// can always override with an exact population instead. Generic, not tied
// to any specific ruleset's settlement-size tables. Ids match
// SETTLEMENT_SIZE_IDS in noteTypes/settlement.ts, which is what
// sizeGateMultiplier below actually compares against.
export const SETTLEMENT_SIZE_PRESETS: SettlementSizePreset[] = [
  { id: 'hamlet', name: 'Hamlet', minPopulation: 20, maxPopulation: 100 },
  { id: 'village', name: 'Village', minPopulation: 100, maxPopulation: 1000 },
  { id: 'town', name: 'Town', minPopulation: 1000, maxPopulation: 5000 },
  { id: 'city', name: 'City', minPopulation: 5000, maxPopulation: 25000 },
  { id: 'metropolis', name: 'Metropolis', minPopulation: 25000, maxPopulation: 100000 }
]

/** Nearest size preset for a raw population, for callers that haven't picked a size explicitly. Clamps to the smallest/largest preset outside the whole range. */
export function inferSizeId(population: number): string {
  for (const preset of SETTLEMENT_SIZE_PRESETS) {
    if (population <= preset.maxPopulation) return preset.id
  }
  return SETTLEMENT_SIZE_PRESETS[SETTLEMENT_SIZE_PRESETS.length - 1].id
}

function sizeIndex(sizeId: string): number {
  const index = SETTLEMENT_SIZE_IDS.indexOf(sizeId as (typeof SETTLEMENT_SIZE_IDS)[number])
  return index === -1 ? SETTLEMENT_SIZE_IDS.indexOf('village') : index
}

// A SOFT size floor (confirmed with the user, not a hard cutoff): each size
// tier below a building type's minSizeId cuts its effective weight to 15%
// of the previous tier's, so a hamlet CAN still roll a guildhall, just at
// roughly 0.3% of its normal weight (two tiers below town) rather than 0.
function sizeGateMultiplier(currentSizeId: string, minSizeId: string): number {
  const diff = sizeIndex(minSizeId) - sizeIndex(currentSizeId)
  return diff <= 0 ? 1 : Math.pow(0.15, diff)
}

/** Multiplies together every active specialty's boost for one building type — stacks when more than one active specialty boosts the same type. */
function specialtyMultiplier(buildingTypeId: string, specialties: SpecialtyDef[], activeSpecialtyIds: string[]): number {
  let multiplier = 1
  for (const specialty of specialties) {
    if (!activeSpecialtyIds.includes(specialty.id)) continue
    for (const boost of specialty.boosts) {
      if (boost.buildingTypeId === buildingTypeId) multiplier *= boost.multiplier
    }
  }
  return multiplier
}

// Roughly how many residents live in one residence building — flattened
// across residence building types for v1 (a manor and a tenement currently
// hold the same "household" for generation purposes, even though their
// wealth tiers differ). Tune later if a per-type capacity turns out to
// matter more than this simplification.
const AVG_HOUSEHOLD_SIZE = 4

// Roughly how many residents "support" one staffed (shop/civic/religious/
// tavern) building — an assumption, not a simulated economy. Tuned low
// enough that even a modest village (a few hundred people) ends up with
// more than one or two shop types, not just whichever single type has the
// highest weight. A hamlet of 40 still gets at least one of whatever
// staffed types are defined.
const POPULATION_PER_STAFFED_BUILDING = 40

// A generic default gender mix for generated residents — not exposed as a
// per-settlement editable list (unlike race/wealth/religion) since nothing
// requested that granularity yet; tune here if it ever needs to be. Male/
// Female draw from their own name pool plus the bank's unisex pool (see
// settlementNames.ts's genderPool); Nonbinary draws from all three pools
// combined for maximum variety despite being the smallest slice.
const GENDER_DISTRIBUTION: { gender: string; percent: number }[] = [
  { gender: 'Male', percent: 47 },
  { gender: 'Female', percent: 47 },
  { gender: 'Nonbinary', percent: 6 }
]

function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

/** Weighted pick by `.percent`, falling back to the last item (or null) if every percent is 0/negative or the list is empty. */
function pickByPercent<T extends { percent: number }>(items: T[], rng: () => number): T | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.percent), 0)
  if (items.length === 0 || total <= 0) return items[items.length - 1] ?? null
  let roll = rng() * total
  for (const item of items) {
    roll -= Math.max(0, item.percent)
    if (roll <= 0) return item
  }
  return items[items.length - 1]
}

/**
 * Splits an integer `budget` across `weights` proportionally, using the
 * largest-remainder method so the per-item counts always sum to exactly
 * `budget` (plain rounding can drift a few units off). Zero total weight
 * yields an all-zero allocation rather than dividing by zero.
 */
function allocateByWeight(budget: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (weights.length === 0 || totalWeight <= 0 || budget <= 0) return weights.map(() => 0)

  const raw = weights.map((w) => (w / totalWeight) * budget)
  const floors = raw.map(Math.floor)
  const allocated = floors.reduce((sum, f) => sum + f, 0)
  const remainder = budget - allocated

  const byFractionDesc = raw
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction)

  const result = [...floors]
  for (let i = 0; i < remainder; i++) result[byFractionDesc[i % byFractionDesc.length].index]++
  return result
}

// Box-Muller transform — a standard normal (mean 0, sd 1) value from two
// uniform rng() draws. Used instead of a dice-roll formula (the old
// 4d6-keep-highest-3) because the user specifically wants a bell curve
// centered on 10 with a stated shape: the bulk of scores in 8-12, a smaller
// "shoulder" at 7/13-14, rarer still at 6/15-17, and near-impossible beyond
// that. Mean 10 + SD 2 reproduces almost exactly that shape (±1 SD = 8-12 is
// ~68% of a normal distribution, ±2 SD = 6-14 is ~95%, beyond ±3.5 SD i.e.
// <3 or >17 is under 0.1%) — the SD wasn't tuned by trial and error, it
// falls out directly from the user's own bucket description.
function normalRandom(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// A requested population is an estimate, not a precise census — generating
// EXACTLY the typed number every single time (especially when it's the
// size preset's suspiciously round midpoint, e.g. 62500 for a Metropolis)
// reads as artificial. SD 1% of the target keeps the actual count close to
// what was asked for while landing on an ordinary-looking number almost
// every time; reuses the same normalRandom tool as ability scores/ages for
// consistency.
const POPULATION_JITTER_SD_FRACTION = 0.01

function jitterPopulation(target: number, rng: () => number): number {
  const sd = Math.max(1, target * POPULATION_JITTER_SD_FRACTION)
  return Math.max(1, Math.round(target + sd * normalRandom(rng)))
}

const ABILITY_MEAN = 10
const ABILITY_SD = 2
const ABILITY_MIN = 3
const ABILITY_MAX = 18
// How far a building type's primary/secondary ability shifts that stat's
// MEAN (not its spread) — a temple's Wisdom rolls from a mean of 14, not a
// guaranteed 14, so it still varies notable to notable.
const PRIMARY_ABILITY_BONUS = 4
const SECONDARY_ABILITY_BONUS = 2

function rollAbilityScore(mean: number, rng: () => number): number {
  const raw = Math.round(mean + ABILITY_SD * normalRandom(rng))
  return Math.min(ABILITY_MAX, Math.max(ABILITY_MIN, raw))
}

/** A notable's stats lean toward their building type's primaryAbility/secondaryAbility (a cleric's Wisdom, a tavern keeper's Charisma) — every other stat rolls from the population-average mean of 10. */
function rollAbilityScores(buildingType: BuildingTypeDef | undefined, rng: () => number): AbilityScores {
  const scores = {} as AbilityScores
  for (const key of ABILITY_KEYS) {
    let mean = ABILITY_MEAN
    if (buildingType?.primaryAbility === key) mean += PRIMARY_ABILITY_BONUS
    else if (buildingType?.secondaryAbility === key) mean += SECONDARY_ABILITY_BONUS
    scores[key] = rollAbilityScore(mean, rng)
  }
  return scores
}

/** Picks without replacement — "one or two" proficiencies (weighted toward one) from the building type's candidate pool, or none if it has no pool defined. */
function pickProficiencies(buildingType: BuildingTypeDef | undefined, rng: () => number): string[] {
  const pool = buildingType?.proficiencyPool ?? []
  if (pool.length === 0) return []
  const count = pool.length >= 2 && rng() < 0.5 ? 2 : 1
  const remaining = [...pool]
  const picked: string[] = []
  while (remaining.length > 0 && picked.length < count) {
    const index = Math.floor(rng() * remaining.length)
    picked.push(remaining.splice(index, 1)[0])
  }
  return picked
}

// Age-gated employment for STUB residents (notables are always "employed" —
// see the notable-generation loop below). The user was explicit that a
// child having a job should be a hard 0%, not just unlikely; everything
// else is a simple piecewise-linear ramp/plateau/decline shape, tunable
// here without hunting through the algorithm:
// 0% at adulthood -> ramps up to a plateau by adulthood + (oldAge-adulthood)
// * EMPLOYMENT_RAMP_FRACTION -> holds the plateau until oldAge -> ramps back
// down to a low-but-nonzero floor by maxAge (some people do work into old
// age).
const EMPLOYMENT_RAMP_FRACTION = 0.25
const EMPLOYMENT_PLATEAU_RATE = 0.75
const EMPLOYMENT_ELDERLY_FLOOR = 0.12

function employmentProbability(age: number, stage: RaceLifeStage): number {
  if (age < stage.adulthood) return 0
  const rampEnd = stage.adulthood + (stage.oldAge - stage.adulthood) * EMPLOYMENT_RAMP_FRACTION
  if (rampEnd > stage.adulthood && age < rampEnd) {
    return EMPLOYMENT_PLATEAU_RATE * ((age - stage.adulthood) / (rampEnd - stage.adulthood))
  }
  if (age <= stage.oldAge) return EMPLOYMENT_PLATEAU_RATE
  if (stage.maxAge <= stage.oldAge) return EMPLOYMENT_ELDERLY_FLOOR
  const t = Math.min(1, (age - stage.oldAge) / (stage.maxAge - stage.oldAge))
  return EMPLOYMENT_PLATEAU_RATE + (EMPLOYMENT_ELDERLY_FLOOR - EMPLOYMENT_PLATEAU_RATE) * t
}

const GENERIC_JOB_TITLES = ['Laborer', 'Hand', 'Worker']

/** A stub's job title comes from their workplace's jobTitlePool — falls back to a generic title for a building type with none configured, same fallback spirit used elsewhere in this file rather than leaving it blank. */
function pickJobTitle(buildingType: BuildingTypeDef | undefined, rng: () => number): string {
  const pool = buildingType?.jobTitlePool ?? []
  if (pool.length > 0) return pool[Math.floor(rng() * pool.length)]
  return GENERIC_JOB_TITLES[Math.floor(rng() * GENERIC_JOB_TITLES.length)]
}

// Homelessness is a deliberate state (see noteTypes/settlement.ts's
// `homeless` field comment), independent of wealth tier — only rolled for
// unemployed adults already in the settlement's lowest wealth tier (the
// last entry in `wealthTiers`, same "list order = rank" convention the UI
// already relies on for wealth-tier sorting). A tunable rate, not derived
// from anything more precise.
const HOMELESS_RATE = 0.08

// Target stock count for a shop/tavern/religious building's inventory, by
// settlement size — round numbers, not derived from anything more precise.
// Only building types with a non-empty itemPool generate inventory at all
// (see buildInventory below); civic/residence types are skipped entirely
// regardless of size.
const STOCK_COUNT_BY_SIZE: Record<string, { min: number; max: number }> = {
  hamlet: { min: 2, max: 4 },
  village: { min: 4, max: 6 },
  town: { min: 6, max: 9 },
  city: { min: 9, max: 13 },
  metropolis: { min: 13, max: 18 }
}

// Magic Item Shop draws from a much larger single pool (~375 items, see its
// itemPool in noteTypes/settlement.ts) than a mundane shop's 5-25 items, so
// the default stock counts above would barely sample it — confirmed with
// the user: a shop should pull a bigger selection (around 30 for a typical
// size), scaling with settlement size same as everything else here.
const STOCK_COUNT_OVERRIDE_BY_TYPE_ID: Record<string, Record<string, { min: number; max: number }>> = {
  'magic-item-shop': {
    town: { min: 15, max: 20 },
    city: { min: 22, max: 28 },
    metropolis: { min: 28, max: 36 }
  }
}

/**
 * Picks a building's actual stock from its type's itemPool — weighted by
 * `sizeGateMultiplier` (reusing the exact same function that gates whole
 * building types by size) so a hamlet's shop mostly draws common items with
 * an occasional rare one slipping in, while a metropolis version skews
 * toward the pool's fancier end. Pick-without-replacement, same pattern as
 * `pickProficiencies`; capped at the pool's actual size.
 */
function buildInventory(buildingType: BuildingTypeDef, sizeId: string, rng: () => number): string[] {
  const pool = buildingType.itemPool ?? []
  if (pool.length === 0) return []
  const sizeTable = STOCK_COUNT_OVERRIDE_BY_TYPE_ID[buildingType.id] ?? STOCK_COUNT_BY_SIZE
  const range = sizeTable[sizeId] ?? STOCK_COUNT_BY_SIZE.village
  const targetCount = Math.min(pool.length, randomInt(range.min, range.max, rng))

  const remaining = [...pool]
  const picked: string[] = []
  while (remaining.length > 0 && picked.length < targetCount) {
    const weights = remaining.map((item) => sizeGateMultiplier(sizeId, item.minSizeId))
    const total = weights.reduce((sum, w) => sum + w, 0)
    let index = remaining.length - 1
    if (total > 0) {
      let roll = rng() * total
      index = 0
      for (; index < remaining.length; index++) {
        roll -= weights[index]
        if (roll <= 0) break
      }
      index = Math.min(index, remaining.length - 1)
    } else {
      index = Math.floor(rng() * remaining.length)
    }
    picked.push(remaining.splice(index, 1)[0].name)
  }
  return picked
}

const FALLBACK_LIFE_STAGE: RaceLifeStage = { race: 'human', adulthood: 18, oldAge: 70, maxAge: 90 }

/** Falls back to the table's own 'human' row, then a hardcoded default, for any race with no life-stage entry — same fallback spirit as settlementNames.ts's resolveNameBank. */
function resolveLifeStage(race: string, lifeStages: RaceLifeStage[]): RaceLifeStage {
  const exact = lifeStages.find((stage) => stage.race === race)
  if (exact) return exact
  return lifeStages.find((stage) => stage.race === 'human') ?? FALLBACK_LIFE_STAGE
}

/** A notable is always a working adult — somewhere between this race's adulthood and old-age milestones (user-editable per settlement, see RaceLifeStage). Guards against a hand-edited adulthood >= oldAge. */
// A notable's age was originally flat-uniform across [adulthood, oldAge],
// which made "just became an adult and somehow already runs the temple"
// exactly as likely as any other age in the range — not wrong (a young
// heir who inherited early is a fine story), just too common. Reusing the
// same normal-distribution tool as ability scores: centered 40% through the
// adult range (an established-but-not-elderly professional is the typical
// case), SD 20% of the range, so the youngest ages become a rare tail
// (~2% one-sided at the very bottom) rather than a flat 1-in-range chance.
function randomAdultAge(stage: RaceLifeStage, rng: () => number): number {
  const low = Math.min(stage.adulthood, stage.oldAge)
  const high = Math.max(stage.adulthood, stage.oldAge)
  const range = high - low
  if (range <= 0) return low
  const mean = low + range * 0.4
  const sd = Math.max(1, range * 0.2)
  const raw = Math.round(mean + sd * normalRandom(rng))
  return Math.min(high, Math.max(low, raw))
}

/** General population spans the full lifespan — weighted toward a believable population pyramid (child/young-adult/adult/elder buckets) rather than flat-uniform 0..maxAge, which would make "half the town is over 40" for a human settlement. */
function randomLifespanAge(stage: RaceLifeStage, rng: () => number): number {
  const adulthood = Math.max(0, stage.adulthood)
  const oldAge = Math.max(adulthood, stage.oldAge)
  const maxAge = Math.max(oldAge, stage.maxAge)
  const midAdult = Math.round((adulthood + oldAge) / 2)

  const buckets: { min: number; max: number; percent: number }[] = [
    { min: 0, max: Math.max(0, adulthood - 1), percent: 20 },
    { min: adulthood, max: Math.max(adulthood, midAdult), percent: 30 },
    { min: midAdult, max: Math.max(midAdult, oldAge), percent: 30 },
    { min: oldAge, max: Math.max(oldAge, maxAge), percent: 20 }
  ]
  const bucket = pickByPercent(buckets, rng) ?? buckets[0]
  return randomInt(bucket.min, bucket.max, rng)
}

export interface GenerationOptions {
  population: number
  // Defaults to inferSizeId(population) when omitted — only needed
  // explicitly when a caller wants the size label itself to drive gating
  // independent of the exact population number (e.g. a hand-typed
  // population that's a bit outside its chosen preset's range).
  sizeId?: string
  districts: District[]
  raceDistribution: RaceShare[]
  customRaces?: CustomRaceDef[]
  inspirationSources?: NameBank[]
  // Defaults to PHONETIC_PROFILES when omitted — a custom race's
  // phoneticProfileId looks itself up in here.
  phoneticProfiles?: PhoneticProfile[]
  wealthTiers: WealthTier[]
  religionDistribution: ReligionShare[]
  buildingTypes: BuildingTypeDef[]
  specialties?: SpecialtyDef[]
  activeSpecialtyIds?: string[]
  // Defaults to [] when omitted, which makes resolveLifeStage fall straight
  // to its hardcoded human default for every race.
  raceLifeStages?: RaceLifeStage[]
}

export interface ExistingSettlementData {
  buildings: SettlementBuilding[]
  residents: SettlementResident[]
}

export interface GeneratedSettlementData {
  buildings: SettlementBuilding[]
  residents: SettlementResident[]
}

/**
 * Generates a fresh set of buildings/residents for a settlement and merges
 * them with any already-PROMOTED records from `existing` (a building/
 * resident with `linkedNoteTitle` set is a real npc/location note now —
 * regeneration must never overwrite or duplicate it). Everything else in
 * `existing` is discarded and regenerated from scratch; `options.population`
 * describes the size of that freshly-generated portion, not the promoted
 * portion on top of it. `rng`/`idFactory` are injectable for deterministic
 * tests, same pattern as dice.ts's rollDice and initiative.ts's
 * buildCombatants.
 */
export function generateSettlement(
  options: GenerationOptions,
  existing: ExistingSettlementData = { buildings: [], residents: [] },
  rng: () => number = Math.random,
  idFactory: () => string = () => crypto.randomUUID()
): GeneratedSettlementData {
  const keptBuildings = existing.buildings.filter((b) => b.linkedNoteTitle)
  const keptResidents = existing.residents.filter((r) => r.linkedNoteTitle)

  const districts = options.districts.length > 0 ? options.districts : [{ id: 'main', name: 'Main District', buildingTypeBoosts: [] }]
  const wealthTiers = options.wealthTiers
  const customRaces = options.customRaces ?? []
  const inspirationSources = options.inspirationSources ?? []
  const phoneticProfiles = options.phoneticProfiles ?? PHONETIC_PROFILES
  // sizeId is inferred from the NOMINAL population (the user's actual size
  // choice), not the jittered one below — a Metropolis pick should always
  // gate building types like a Metropolis regardless of which side of
  // 62500 the jitter happens to land on.
  const sizeId = options.sizeId ?? inferSizeId(options.population)
  const population = jitterPopulation(options.population, rng)
  const specialties = options.specialties ?? []
  const activeSpecialtyIds = options.activeSpecialtyIds ?? []
  const raceLifeStages = options.raceLifeStages ?? []

  const effectiveWeight = (type: BuildingTypeDef): number =>
    type.weight * sizeGateMultiplier(sizeId, type.minSizeId) * specialtyMultiplier(type.id, specialties, activeSpecialtyIds)

  let districtCursor = 0
  const nextDistrictId = (): string => {
    const district = districts[districtCursor % districts.length]
    districtCursor++
    return district.id
  }

  // Weights every district's odds of getting THIS specific building type by
  // its buildingTypeBoosts (see districtSchema) — a district themed toward
  // temples should get MOST of them, not ALL, so every district still
  // starts from a baseline weight of 1 (round-robin-equivalent) and a
  // matching boost multiplies on top, same "soft bias, never a hard
  // exclusion" shape as sizeGateMultiplier/specialtyMultiplier above. A
  // district with no matching boost is exactly as likely as any other
  // unboosted district, which is the round-robin-shaped fallback the design
  // doc asked for, just expressed as weighted-random (consistent with every
  // other pick in this generator) instead of a literal alternating cursor.
  const pickDistrictIdForBuildingType = (buildingTypeId: string): string => {
    const weights = districts.map((d) => (d.buildingTypeBoosts ?? []).find((b) => b.buildingTypeId === buildingTypeId)?.multiplier ?? 1)
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0)
    if (total <= 0) return nextDistrictId()
    let roll = rng() * total
    for (let i = 0; i < districts.length; i++) {
      roll -= Math.max(0, weights[i])
      if (roll <= 0) return districts[i].id
    }
    return districts[districts.length - 1].id
  }

  const pickWealthTierId = (): string => pickByPercent(wealthTiers, rng)?.id ?? ''
  const pickRace = (): string => pickByPercent(options.raceDistribution, rng)?.race ?? 'human'
  const pickReligion = (): string => pickByPercent(options.religionDistribution, rng)?.religion ?? ''
  const pickGender = (): string => pickByPercent(GENDER_DISTRIBUTION, rng)?.gender ?? 'Male'
  // A custom race with a phoneticProfileId set is synthesized from tagged
  // syllables (see phoneticNames.ts) instead of picking from a name-list
  // pool — checked first, per CustomRaceDef's "either/or, not both" design.
  const nameFor = (race: string, gender: string): string => {
    const customRace = customRaces.find((r) => r.id === race)
    const profile = customRace?.phoneticProfileId
      ? phoneticProfiles.find((p) => p.id === customRace.phoneticProfileId)
      : undefined
    if (profile) return generateSyntheticName(profile, rng)
    return generateName(resolveNameBank(race, customRaces, inspirationSources), gender, rng)
  }

  const residenceTypes = options.buildingTypes.filter((t) => t.category === 'residence')
  const staffedTypes = options.buildingTypes.filter((t) => t.category !== 'residence')

  const buildings: SettlementBuilding[] = []
  const instanceCountByTypeId = new Map<string, number>()
  const buildOneBuilding = (buildingType: BuildingTypeDef, wealthTierId: string): void => {
    const instanceNumber = (instanceCountByTypeId.get(buildingType.id) ?? 0) + 1
    instanceCountByTypeId.set(buildingType.id, instanceNumber)
    buildings.push({
      id: idFactory(),
      name: buildingType.id, // placeholder, fixed up to include the count below once every instance of this type is known
      buildingTypeId: buildingType.id,
      inventory: buildInventory(buildingType, sizeId, rng),
      wealthTierId,
      districtId: pickDistrictIdForBuildingType(buildingType.id),
      linkedNoteTitle: null
    })
  }

  // Residences are allocated in two passes so a settlement's wealth-tier
  // percentages (the population's actual class/lifestyle makeup — see
  // noteTypes/settlement.ts's WealthTier) genuinely drive the outcome,
  // rather than being overridden by each building type's own
  // defaultWealthTierId as before: first split the household budget across
  // wealth tiers by their percent, THEN pick which residence type (house,
  // manor, tenement, farmstead, ...) fills each tier's slots by weight —
  // preferring types whose defaultWealthTierId matches that tier, falling
  // back to every residence type if none match.
  const targetResidenceCount = Math.max(1, Math.ceil(population / AVG_HOUSEHOLD_SIZE))
  if (residenceTypes.length > 0) {
    const tierBudgets =
      wealthTiers.length > 0
        ? allocateByWeight(targetResidenceCount, wealthTiers.map((t) => Math.max(0, t.percent)))
        : []
    wealthTiers.forEach((tier, tierIndex) => {
      const matchingTypes = residenceTypes.filter((t) => t.defaultWealthTierId === tier.id)
      const pool = matchingTypes.length > 0 ? matchingTypes : residenceTypes
      const poolCounts = allocateByWeight(tierBudgets[tierIndex], pool.map(effectiveWeight))
      pool.forEach((type, i) => {
        for (let n = 0; n < poolCounts[i]; n++) buildOneBuilding(type, tier.id)
      })
    })
    // No wealth tiers configured at all — fall back to plain weighted
    // allocation across residence types with no tier assigned.
    if (wealthTiers.length === 0) {
      const counts = allocateByWeight(targetResidenceCount, residenceTypes.map(effectiveWeight))
      residenceTypes.forEach((type, i) => {
        for (let n = 0; n < counts[i]; n++) buildOneBuilding(type, '')
      })
    }
  }

  const staffedBudget = Math.max(1, Math.round(population / POPULATION_PER_STAFFED_BUILDING))
  const staffedCounts = allocateByWeight(staffedBudget, staffedTypes.map(effectiveWeight))
  staffedTypes.forEach((type, i) => {
    const wealthTierId = wealthTiers.some((t) => t.id === type.defaultWealthTierId) ? type.defaultWealthTierId : pickWealthTierId()
    // maxInstances is a hard cap (unlike every other soft gate in this
    // engine) — some building types are singular by nature (a settlement
    // has exactly one Town Hall), not just less common. The budget "lost"
    // to a capped type simply isn't redistributed elsewhere; a slightly
    // smaller total staffed-building count is a fine tradeoff for never
    // generating seventeen Town Halls.
    const count = type.maxInstances != null ? Math.min(staffedCounts[i], type.maxInstances) : staffedCounts[i]
    for (let n = 0; n < count; n++) buildOneBuilding(type, wealthTierId)
  })

  // Fix up names now that every instance of each type has been created, so
  // numbering ("House 1", "House 2", ...) is correct even though residence
  // types can be built across more than one wealth-tier pass above.
  const typeNameById = new Map(options.buildingTypes.map((t) => [t.id, t.name]))
  const seenSoFar = new Map<string, number>()
  for (const building of buildings) {
    const total = instanceCountByTypeId.get(building.buildingTypeId) ?? 1
    const index = (seenSoFar.get(building.buildingTypeId) ?? 0) + 1
    seenSoFar.set(building.buildingTypeId, index)
    const name = typeNameById.get(building.buildingTypeId) ?? building.buildingTypeId
    building.name = total > 1 ? `${name} ${index}` : name
  }

  const residenceBuildings = buildings.filter((b) => residenceTypes.some((t) => t.id === b.buildingTypeId))
  const staffedBuildingTypeById = new Map(staffedTypes.map((t) => [t.id, t]))
  const staffedBuildings = buildings.filter((b) => staffedBuildingTypeById.get(b.buildingTypeId)?.staffed)
  // Lowest wealth tier by list position — same "list order = rank"
  // convention the People/Buildings tabs already rely on for wealth-tier
  // sorting (see wealthTierRankById in those files).
  const lowestWealthTierId = wealthTiers.length > 0 ? wealthTiers[wealthTiers.length - 1].id : ''

  const residents: SettlementResident[] = []

  // One full notable per staffed building instance — the scope lever that
  // keeps a large settlement's generation effort bounded (see
  // noteTypes/settlement.ts's BuildingTypeDef.staffed comment).
  for (const building of buildings) {
    const buildingType = staffedBuildingTypeById.get(building.buildingTypeId)
    if (!buildingType?.staffed) continue
    const race = pickRace()
    const gender = pickGender()
    residents.push({
      id: idFactory(),
      name: nameFor(race, gender),
      race,
      age: randomAdultAge(resolveLifeStage(race, raceLifeStages), rng),
      gender,
      professionBuildingId: building.id,
      // A notable definitionally runs the place they're staffed at (see
      // BuildingTypeDef.staffed) — the building type's own notableTitle
      // ("Mayor" for a Town Hall, "High Priest" for a Temple, ...), falling
      // back to "Owner" for the common case of an actual commercial shop.
      jobTitle: buildingType.notableTitle ?? 'Owner',
      employmentStatus: 'employed',
      homeless: false,
      homeBuildingId: null,
      wealthTierId: building.wealthTierId,
      districtId: building.districtId,
      religion: pickReligion(),
      notable: true,
      flavorTag: '',
      personalityLine: generatePersonalityLine(rng),
      goal: generateGoal(rng),
      stats: rollAbilityScores(buildingType, rng),
      proficiencies: pickProficiencies(buildingType, rng),
      appearance: generateAppearance(race, gender, rng),
      linkedNoteTitle: null
    })
  }

  // Remaining population fills as cheap stub residents, grouped a few per
  // residence building. If population outpaces total residence capacity
  // (e.g. wealth-tier/building-type editing left too few residences), the
  // overflow still gets generated but with no homeBuildingId — an honest
  // signal to add more residences rather than silently dropping people.
  const notableCount = residents.length
  const remainingPopulation = Math.max(0, population - notableCount)
  let homeCursor = 0
  const nextHomeBuildingId = (occupantIndex: number): string | null => {
    if (residenceBuildings.length === 0) return null
    if (occupantIndex >= residenceBuildings.length * AVG_HOUSEHOLD_SIZE) return null
    const home = residenceBuildings[homeCursor % residenceBuildings.length]
    homeCursor++
    return home.id
  }

  for (let i = 0; i < remainingPopulation; i++) {
    const race = pickRace()
    const gender = pickGender()
    const lifeStage = resolveLifeStage(race, raceLifeStages)
    const age = randomLifespanAge(lifeStage, rng)
    const homeBuildingId = nextHomeBuildingId(i)
    const home = homeBuildingId ? residenceBuildings.find((b) => b.id === homeBuildingId) : undefined
    const wealthTierId = home?.wealthTierId ?? pickWealthTierId()

    const employed = staffedBuildings.length > 0 && rng() < employmentProbability(age, lifeStage)
    const workplace = employed ? staffedBuildings[Math.floor(rng() * staffedBuildings.length)] : undefined
    const professionBuildingId = workplace?.id ?? null
    const jobTitle = workplace ? pickJobTitle(staffedBuildingTypeById.get(workplace.buildingTypeId), rng) : ''

    // Homelessness only rolled for unemployed adults already in the
    // lowest wealth tier — see HOMELESS_RATE's comment. A homeless
    // resident's homeBuildingId is forced null even if nextHomeBuildingId
    // assigned one, since "homeless" should mean homeless.
    const isAdult = age >= lifeStage.adulthood
    const homeless = !employed && isAdult && wealthTierId === lowestWealthTierId && rng() < HOMELESS_RATE

    residents.push({
      id: idFactory(),
      name: nameFor(race, gender),
      race,
      age,
      gender,
      professionBuildingId,
      jobTitle,
      employmentStatus: employed ? 'employed' : 'unemployed',
      homeless,
      homeBuildingId: homeless ? null : homeBuildingId,
      wealthTierId,
      districtId: home?.districtId ?? nextDistrictId(),
      religion: pickReligion(),
      notable: false,
      flavorTag: generateFlavorTag(rng),
      personalityLine: '',
      goal: '',
      stats: null,
      proficiencies: [],
      appearance: '',
      linkedNoteTitle: null
    })
  }

  return {
    buildings: [...keptBuildings, ...buildings],
    residents: [...keptResidents, ...residents]
  }
}
