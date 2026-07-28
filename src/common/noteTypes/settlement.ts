import { z } from 'zod'
import { abilityScoresSchema } from './creatureStats'

// Storage design (see docs/plans/2026-07-27-initiative-timeline-settlement.md
// §3): a settlement's entire population and building stock lives as arrays
// in ONE note's frontmatter, exactly like map.ts's terrainTypes/zones/lines/
// pins — never one note per resident/building. A town of a few thousand is
// still just one note with a large JSON blob, not thousands of files/rows.
// Individual residents/buildings only become real npc/location notes via an
// explicit "promote" action (linkedNoteTitle gets set at that point) — see
// settlementGenerator.ts, which never touches a record once promoted.

export const districtSchema = z.object({
  id: z.string(),
  name: z.string()
})
export type District = z.infer<typeof districtSchema>

export const wealthTierSchema = z.object({
  id: z.string(),
  name: z.string(),
  percent: z.coerce.number().catch(0)
})
export type WealthTier = z.infer<typeof wealthTierSchema>

export const raceShareSchema = z.object({
  race: z.string(),
  percent: z.coerce.number().catch(0)
})
export type RaceShare = z.infer<typeof raceShareSchema>

export const religionShareSchema = z.object({
  religion: z.string(),
  percent: z.coerce.number().catch(0)
})
export type ReligionShare = z.infer<typeof religionShareSchema>

// A custom race a user adds beyond the 8 seeded baseline races (see
// settlementNames.ts). Name generation uses EITHER of two mechanisms, never
// both at once (kept as two separate fields rather than a tagged union so a
// user switching modes in a form doesn't lose the other mode's data):
// - inspirationSourceIds: pools one or more real-world regional NameBanks
//   (NAME_INSPIRATION_SOURCES) into one flat list to pick from.
// - phoneticProfileId: synthesizes names on the fly from tagged syllables
//   (see phoneticNames.ts) matching an invented sound profile instead of
//   picking from any pre-written list — settlementGenerator.ts checks this
//   FIRST, falling back to inspirationSourceIds pooling if unset.
export const customRaceDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  inspirationSourceIds: z.array(z.string()).catch([]),
  phoneticProfileId: z.string().nullable().catch(null)
})
export type CustomRaceDef = z.infer<typeof customRaceDefSchema>

export const BUILDING_CATEGORIES = ['residence', 'shop', 'civic', 'religious', 'tavern'] as const
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number]

// Ordered smallest to largest — settlementGenerator.ts compares a
// settlement's current size against a building type's minSizeId by index
// into this list, not by population directly, so a custom/renamed size
// preset still sorts sensibly.
export const SETTLEMENT_SIZE_IDS = ['hamlet', 'village', 'town', 'city', 'metropolis'] as const
export type SettlementSizeId = (typeof SETTLEMENT_SIZE_IDS)[number]

export const buildingTypeDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().catch('shop'),
  // A wealth tier id this building type normally belongs to — used as the
  // default when generating an instance, but not enforced (a user can
  // override any individual building's tier after generation).
  defaultWealthTierId: z.string().catch(''),
  // Only a staffed building type generates a full "notable" resident per
  // instance (shop owner, temple head, tavern keeper, ...) — the scope
  // lever that keeps a town of thousands from meaning thousands of fully
  // generated personalities. Non-staffed types (houses, warehouses, ...)
  // never get a notable of their own.
  staffed: z.boolean().catch(false),
  // Relative frequency vs other building types in the same category when
  // the generator allocates how many of each to build.
  weight: z.coerce.number().catch(1),
  // The settlement size (see SETTLEMENT_SIZE_IDS) this type starts becoming
  // common at. A SOFT floor, not a hard requirement — confirmed with the
  // user: below this size the generator scales the type's effective weight
  // down sharply (see settlementGenerator.ts's sizeGateMultiplier) rather
  // than forbidding it outright, so a hamlet CAN still roll a guildhall,
  // just very rarely.
  minSizeId: z.string().catch('hamlet'),
  // Which ability score(s) this trade favors — an AbilityKey ('str'..'cha')
  // or '' for none. Shifts that stat's generation MEAN upward for this
  // type's notable (a temple's Wisdom, a tavern's Charisma), not its
  // spread — see settlementGenerator.ts's rollAbilityScores. Empty for
  // non-staffed types, which never generate a notable at all.
  primaryAbility: z.string().catch(''),
  secondaryAbility: z.string().catch(''),
  // Candidate proficiency names this notable might roll 1-2 of — generic
  // skill/tool names (same "mechanism not content" spirit as everything
  // else seeded here), not enforced to any one ruleset's exact skill list.
  proficiencyPool: z.array(z.string()).catch([])
})
export type BuildingTypeDef = z.infer<typeof buildingTypeDefSchema>

// A settlement can lean into one or more specialties at once (e.g. a "Port
// Town" that's also a "Trade Hub") — see settlementGenerator.ts, where an
// active specialty's boosts multiply into a building type's effective
// weight and multiple active specialties stack multiplicatively.
export const specialtyBoostSchema = z.object({
  buildingTypeId: z.string(),
  multiplier: z.coerce.number().catch(1)
})
export type SpecialtyBoost = z.infer<typeof specialtyBoostSchema>

export const specialtyDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  boosts: z.array(specialtyBoostSchema).catch([])
})
export type SpecialtyDef = z.infer<typeof specialtyDefSchema>

export const settlementBuildingSchema = z.object({
  id: z.string(),
  name: z.string(),
  buildingTypeId: z.string(),
  wealthTierId: z.string(),
  districtId: z.string(),
  // Set once a user "promotes" this background record to a real `location`
  // note — from then on the generator leaves this record untouched on
  // regeneration.
  linkedNoteTitle: z.string().nullable().catch(null)
})
export type SettlementBuilding = z.infer<typeof settlementBuildingSchema>

export const settlementResidentSchema = z.object({
  id: z.string(),
  name: z.string(),
  race: z.string(),
  age: z.coerce.number().catch(30),
  gender: z.string().catch(''),
  professionBuildingId: z.string().nullable().catch(null),
  homeBuildingId: z.string().nullable().catch(null),
  wealthTierId: z.string(),
  districtId: z.string(),
  religion: z.string().catch(''),
  // Only staffed-building residents are notable (see BuildingTypeDef.staffed)
  // — everyone else is a cheap stub with just a flavorTag instead of a full
  // personality/goal/stats/proficiencies/appearance.
  notable: z.boolean().catch(false),
  flavorTag: z.string().catch(''),
  personalityLine: z.string().catch(''),
  goal: z.string().catch(''),
  stats: abilityScoresSchema.nullable().catch(null),
  // 1-2 for a notable (drawn from their building type's proficiencyPool),
  // empty for a stub.
  proficiencies: z.array(z.string()).catch([]),
  // Multi-line prose (hair/eyes, facial hair, skin, height+build) — notable
  // only, same cost/scope lever as stats. See settlementAppearance.ts.
  appearance: z.string().catch(''),
  // Set once a user "promotes" this background record to a real `npc` note.
  linkedNoteTitle: z.string().nullable().catch(null)
})
export type SettlementResident = z.infer<typeof settlementResidentSchema>

// User-editable per settlement so two campaigns can disagree about how long
// an elf lives (confirmed with the user: e.g. adulthood 30/old age 400/dies
// ~500 in one campaign vs. 26/350/450 in another) — the generator looks a
// resident's race up in this table (falling back to the 'human' row, then a
// hardcoded fallback, for any race with no entry — same pattern as
// settlementNames.ts's resolveNameBank) rather than using one fixed
// lifespan for everyone.
export const raceLifeStageSchema = z.object({
  race: z.string(),
  // Age this race is generated as a full adult (notables are always at
  // least this old). Anyone younger is a child/adolescent stub.
  adulthood: z.coerce.number().catch(18),
  // Age "elderly" starts being a plausible flavor, not a hard cutoff.
  oldAge: z.coerce.number().catch(70),
  // Oldest a generated resident of this race will ever be.
  maxAge: z.coerce.number().catch(90)
})
export type RaceLifeStage = z.infer<typeof raceLifeStageSchema>

export const settlementFrontmatterSchema = z
  .object({
    type: z.literal('settlement'),
    tags: z.array(z.string()).catch([]),
    summary: z.string().catch(''),
    // Last-used size/population for generation — stored so re-running
    // Generate doesn't require re-entering them, same as every other
    // generation input here (districts, wealth tiers, ...).
    sizeId: z.string().catch('village'),
    targetPopulation: z.coerce.number().catch(300),
    districts: z.array(districtSchema).catch(() => defaultDistricts()),
    raceDistribution: z.array(raceShareSchema).catch([]),
    customRaces: z.array(customRaceDefSchema).catch([]),
    raceLifeStages: z.array(raceLifeStageSchema).catch(() => defaultRaceLifeStages()),
    wealthTiers: z.array(wealthTierSchema).catch(() => defaultWealthTiers()),
    religionDistribution: z.array(religionShareSchema).catch([]),
    buildingTypes: z.array(buildingTypeDefSchema).catch(() => defaultBuildingTypes()),
    specialties: z.array(specialtyDefSchema).catch(() => defaultSpecialties()),
    // Which of `specialties` are actually active for THIS settlement — a
    // settlement can lean into more than one at once (e.g. Port Town +
    // Trade Hub), each stacking its boosts multiplicatively.
    activeSpecialtyIds: z.array(z.string()).catch([]),
    buildings: z.array(settlementBuildingSchema).catch([]),
    residents: z.array(settlementResidentSchema).catch([])
  })
  .passthrough()

export type SettlementFrontmatter = z.infer<typeof settlementFrontmatterSchema>

// Scaled district sets per settlement size — a hamlet is too small to
// meaningfully divide, but a city/metropolis plausibly has multiple market
// districts, not just one. Generic placeholder names (same spirit as every
// other seeded default here), fully renameable/removable/addable — this is
// just a better starting point than one bare "Main District" for every size.
const DISTRICTS_BY_SIZE: Record<string, District[]> = {
  hamlet: [{ id: 'main', name: 'Village Center' }],
  village: [
    { id: 'market', name: 'Market Square' },
    { id: 'residential', name: 'Residential Quarter' }
  ],
  town: [
    { id: 'market', name: 'Market District' },
    { id: 'residential', name: 'Residential District' },
    { id: 'government', name: 'Government District' }
  ],
  city: [
    { id: 'north-market', name: 'North Market District' },
    { id: 'south-market', name: 'South Market District' },
    { id: 'residential', name: 'Residential District' },
    { id: 'government', name: 'Government District' },
    { id: 'craft', name: 'Craft District' }
  ],
  metropolis: [
    { id: 'north-market', name: 'North Market District' },
    { id: 'south-market', name: 'South Market District' },
    { id: 'east-market', name: 'East Market District' },
    { id: 'residential', name: 'Residential District' },
    { id: 'government', name: 'Government District' },
    { id: 'craft', name: 'Craft District' },
    { id: 'old-town', name: 'Old Town' }
  ]
}

export function defaultDistrictsForSize(sizeId: string): District[] {
  return DISTRICTS_BY_SIZE[sizeId] ?? DISTRICTS_BY_SIZE.village
}

export function defaultDistricts(): District[] {
  return defaultDistrictsForSize('village')
}

export function defaultWealthTiers(): WealthTier[] {
  return [
    { id: 'upper', name: 'Upper', percent: 20 },
    { id: 'middle', name: 'Middle', percent: 50 },
    { id: 'lower', name: 'Lower', percent: 30 }
  ]
}

// ~30 generic archetypes across every BUILDING_CATEGORIES entry — round,
// clearly-placeholder starting points (same spirit as
// map.ts's defaultTerrainTypes()/travelModes.ts's DEFAULT_TRAVEL_MODES), not
// tied to any specific published setting. weight is relative frequency
// within its category, not an absolute count; minSizeId is a SOFT floor
// (see buildingTypeDefSchema's comment) letting a generated hamlet skew
// toward basics without a guildhall/jeweler being impossible outright. Ids
// double as default wealthTierId references into defaultWealthTiers()
// above, and as specialty-boost targets in defaultSpecialties() below.
export function defaultBuildingTypes(): BuildingTypeDef[] {
  // Residences and Warehouse are unstaffed (no notable, so ability bias/
  // proficiencies are moot for them) — left at '' / [].
  const none = { primaryAbility: '', secondaryAbility: '', proficiencyPool: [] as string[] }
  return [
    // Residences — not staffed, no notable generated; these are what the
    // generator's household-count math is built from.
    { id: 'house', name: 'House', category: 'residence', defaultWealthTierId: 'middle', staffed: false, weight: 40, minSizeId: 'hamlet', ...none },
    { id: 'manor', name: 'Manor', category: 'residence', defaultWealthTierId: 'upper', staffed: false, weight: 5, minSizeId: 'town', ...none },
    { id: 'tenement', name: 'Tenement', category: 'residence', defaultWealthTierId: 'lower', staffed: false, weight: 20, minSizeId: 'village', ...none },
    { id: 'farmstead', name: 'Farmstead', category: 'residence', defaultWealthTierId: 'lower', staffed: false, weight: 10, minSizeId: 'hamlet', ...none },
    // Shops
    { id: 'general-store', name: 'General Store', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 6, minSizeId: 'hamlet', primaryAbility: 'cha', secondaryAbility: 'int', proficiencyPool: ['Persuasion', 'Insight'] },
    { id: 'blacksmith', name: 'Blacksmith', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 3, minSizeId: 'hamlet', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ["Smith's Tools", 'Athletics'] },
    { id: 'bakery', name: 'Bakery', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 4, minSizeId: 'village', primaryAbility: 'con', secondaryAbility: 'wis', proficiencyPool: ["Cook's Utensils", 'Perception'] },
    { id: 'tailor', name: 'Tailor', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 3, minSizeId: 'village', primaryAbility: 'dex', secondaryAbility: 'int', proficiencyPool: ["Weaver's Tools", 'Sleight of Hand'] },
    { id: 'apothecary', name: 'Apothecary', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'int', secondaryAbility: 'wis', proficiencyPool: ['Herbalism Kit', 'Medicine'] },
    { id: 'jeweler', name: 'Jeweler', category: 'shop', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'dex', secondaryAbility: 'int', proficiencyPool: ["Jeweler's Tools", 'Investigation'] },
    { id: 'bookshop', name: 'Bookshop', category: 'shop', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'int', secondaryAbility: 'wis', proficiencyPool: ['History', 'Investigation'] },
    { id: 'stables', name: 'Stables', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'wis', secondaryAbility: 'con', proficiencyPool: ['Animal Handling', 'Survival'] },
    { id: 'tannery', name: 'Tannery', category: 'shop', defaultWealthTierId: 'lower', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ["Leatherworker's Tools", 'Athletics'] },
    { id: 'carpenter', name: 'Carpenter', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'str', secondaryAbility: 'dex', proficiencyPool: ["Carpenter's Tools", 'Athletics'] },
    { id: 'fishmonger', name: 'Fishmonger', category: 'shop', defaultWealthTierId: 'lower', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'con', secondaryAbility: 'str', proficiencyPool: ["Navigator's Tools", 'Survival'] },
    { id: 'mill', name: 'Mill', category: 'shop', defaultWealthTierId: 'lower', staffed: true, weight: 1, minSizeId: 'hamlet', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ['Athletics', 'Perception'] },
    { id: 'brewery', name: 'Brewery', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'village', primaryAbility: 'con', secondaryAbility: 'wis', proficiencyPool: ["Brewer's Supplies", 'Perception'] },
    { id: 'market-stall', name: 'Market Stall', category: 'shop', defaultWealthTierId: 'lower', staffed: true, weight: 5, minSizeId: 'hamlet', primaryAbility: 'cha', secondaryAbility: 'int', proficiencyPool: ['Persuasion', 'Deception'] },
    // Civic
    { id: 'town-hall', name: 'Town Hall', category: 'civic', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'cha', secondaryAbility: 'wis', proficiencyPool: ['Persuasion', 'Insight'] },
    { id: 'guard-house', name: 'Guard House', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'village', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ['Athletics', 'Intimidation'] },
    { id: 'guildhall', name: 'Guildhall', category: 'civic', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'cha', secondaryAbility: 'int', proficiencyPool: ['Persuasion', 'History'] },
    { id: 'warehouse', name: 'Warehouse', category: 'civic', defaultWealthTierId: 'middle', staffed: false, weight: 2, minSizeId: 'village', ...none },
    { id: 'docks', name: 'Docks', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'village', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ['Athletics', "Navigator's Tools"] },
    { id: 'mine', name: 'Mine', category: 'civic', defaultWealthTierId: 'lower', staffed: true, weight: 1, minSizeId: 'village', primaryAbility: 'con', secondaryAbility: 'str', proficiencyPool: ["Mason's Tools", 'Athletics'] },
    { id: 'barracks', name: 'Barracks', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ['Athletics', 'Intimidation'] },
    // Religious
    { id: 'temple', name: 'Temple', category: 'religious', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'wis', secondaryAbility: 'cha', proficiencyPool: ['Religion', 'Medicine', 'Insight'] },
    { id: 'shrine', name: 'Shrine', category: 'religious', defaultWealthTierId: 'lower', staffed: true, weight: 1, minSizeId: 'hamlet', primaryAbility: 'wis', secondaryAbility: 'cha', proficiencyPool: ['Religion', 'Insight'] },
    // Tavern
    { id: 'tavern', name: 'Tavern', category: 'tavern', defaultWealthTierId: 'middle', staffed: true, weight: 3, minSizeId: 'village', primaryAbility: 'cha', secondaryAbility: 'con', proficiencyPool: ['Performance', 'Persuasion', 'Insight'] },
    { id: 'inn', name: 'Inn', category: 'tavern', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'town', primaryAbility: 'cha', secondaryAbility: 'wis', proficiencyPool: ['Persuasion', 'Insight'] }
  ]
}

// Generic round lifespan milestones per baseline race — a widely-known
// fantasy trope (elves outlive humans by a lot, etc.), not tied to any one
// published ruleset's exact numbers. Fully user-editable per settlement
// (see raceLifeStageSchema) — these are just the seeded starting point.
export function defaultRaceLifeStages(): RaceLifeStage[] {
  return [
    { race: 'human', adulthood: 18, oldAge: 70, maxAge: 90 },
    { race: 'elf', adulthood: 100, oldAge: 700, maxAge: 750 },
    { race: 'dwarf', adulthood: 50, oldAge: 200, maxAge: 350 },
    { race: 'halfling', adulthood: 20, oldAge: 150, maxAge: 200 },
    { race: 'dragonborn', adulthood: 15, oldAge: 60, maxAge: 80 },
    { race: 'tiefling', adulthood: 18, oldAge: 80, maxAge: 100 },
    { race: 'orc', adulthood: 14, oldAge: 40, maxAge: 50 },
    { race: 'goliath', adulthood: 18, oldAge: 65, maxAge: 80 }
  ]
}

// 9 generic settlement specialties — the user's original 5 (Capital, Port
// Town, Trade Hub, Farming, Industrial) plus Mining, Fishing, Military/
// Garrison, and Religious/Pilgrimage. A settlement can have zero, one, or
// several active at once (see activeSpecialtyIds); each boost multiplies
// into that building type's effective weight during generation, and active
// specialties stack multiplicatively when they both boost the same type.
export function defaultSpecialties(): SpecialtyDef[] {
  return [
    {
      id: 'capital',
      name: 'Capital',
      boosts: [
        { buildingTypeId: 'town-hall', multiplier: 3 },
        { buildingTypeId: 'guildhall', multiplier: 3 },
        { buildingTypeId: 'manor', multiplier: 2 },
        { buildingTypeId: 'guard-house', multiplier: 2 },
        { buildingTypeId: 'temple', multiplier: 1.5 }
      ]
    },
    {
      id: 'port-town',
      name: 'Port Town',
      boosts: [
        { buildingTypeId: 'docks', multiplier: 3 },
        { buildingTypeId: 'fishmonger', multiplier: 2 },
        { buildingTypeId: 'warehouse', multiplier: 2.5 },
        { buildingTypeId: 'tavern', multiplier: 1.5 },
        { buildingTypeId: 'inn', multiplier: 1.5 }
      ]
    },
    {
      id: 'trade-hub',
      name: 'Trade Hub',
      boosts: [
        { buildingTypeId: 'market-stall', multiplier: 3 },
        { buildingTypeId: 'general-store', multiplier: 2 },
        { buildingTypeId: 'warehouse', multiplier: 2.5 },
        { buildingTypeId: 'inn', multiplier: 2 },
        { buildingTypeId: 'stables', multiplier: 2 }
      ]
    },
    {
      id: 'farming',
      name: 'Farming',
      boosts: [
        { buildingTypeId: 'farmstead', multiplier: 3 },
        { buildingTypeId: 'mill', multiplier: 2.5 },
        { buildingTypeId: 'market-stall', multiplier: 1.5 },
        { buildingTypeId: 'warehouse', multiplier: 1.5 }
      ]
    },
    {
      id: 'industrial',
      name: 'Industrial',
      boosts: [
        { buildingTypeId: 'blacksmith', multiplier: 2.5 },
        { buildingTypeId: 'tannery', multiplier: 2.5 },
        { buildingTypeId: 'carpenter', multiplier: 2 },
        { buildingTypeId: 'mill', multiplier: 1.5 },
        { buildingTypeId: 'warehouse', multiplier: 2 }
      ]
    },
    {
      id: 'mining',
      name: 'Mining',
      boosts: [
        { buildingTypeId: 'mine', multiplier: 3 },
        { buildingTypeId: 'blacksmith', multiplier: 2 },
        { buildingTypeId: 'warehouse', multiplier: 2 },
        { buildingTypeId: 'tenement', multiplier: 1.3 }
      ]
    },
    {
      id: 'fishing',
      name: 'Fishing',
      boosts: [
        { buildingTypeId: 'fishmonger', multiplier: 3 },
        { buildingTypeId: 'docks', multiplier: 2 },
        { buildingTypeId: 'tavern', multiplier: 1.3 }
      ]
    },
    {
      id: 'military',
      name: 'Military / Garrison',
      boosts: [
        { buildingTypeId: 'barracks', multiplier: 3 },
        { buildingTypeId: 'guard-house', multiplier: 2.5 },
        { buildingTypeId: 'blacksmith', multiplier: 1.5 },
        { buildingTypeId: 'warehouse', multiplier: 1.5 }
      ]
    },
    {
      id: 'religious',
      name: 'Religious / Pilgrimage',
      boosts: [
        { buildingTypeId: 'temple', multiplier: 3 },
        { buildingTypeId: 'shrine', multiplier: 3 },
        { buildingTypeId: 'inn', multiplier: 2 },
        { buildingTypeId: 'market-stall', multiplier: 1.5 }
      ]
    }
  ]
}

export function defaultSettlementFrontmatter(): SettlementFrontmatter {
  return settlementFrontmatterSchema.parse({
    type: 'settlement',
    districts: defaultDistricts(),
    wealthTiers: defaultWealthTiers(),
    buildingTypes: defaultBuildingTypes(),
    specialties: defaultSpecialties(),
    raceLifeStages: defaultRaceLifeStages()
  })
}
