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

// A settlement can lean into one or more specialties at once (e.g. a "Port
// Town" that's also a "Trade Hub") — see settlementGenerator.ts, where an
// active specialty's boosts multiply into a building type's effective
// weight and multiple active specialties stack multiplicatively. Also
// reused as-is by districtSchema's buildingTypeBoosts below — same "bias a
// building type's odds by a multiplier" concept, just scoped to one
// district instead of the whole settlement, so it gets the exact same shape
// rather than a near-duplicate schema.
export const specialtyBoostSchema = z.object({
  buildingTypeId: z.string(),
  multiplier: z.coerce.number().catch(1)
})
export type SpecialtyBoost = z.infer<typeof specialtyBoostSchema>

export const districtSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Soft bias only (see settlementGenerator.ts's district-weighting logic,
  // same "never a hard exclusion" philosophy as sizeGateMultiplier and
  // settlement-wide specialty boosts) — a district themed toward temples
  // gets MOST of them, not ALL, so a temple built elsewhere is still
  // possible, just less likely.
  buildingTypeBoosts: z.array(specialtyBoostSchema).catch([])
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
// - phoneticProfileIds: synthesizes names on the fly from tagged syllables
//   (see phoneticNames.ts) matching one or more invented sound profiles
//   instead of picking from any pre-written list — settlementGenerator.ts
//   checks this FIRST, falling back to inspirationSourceIds pooling if
//   empty. Multi-select, same shape as inspirationSourceIds: each generated
//   name picks ONE profile at random from the selected set (not a blend of
//   all of them), so a race built from e.g. draconic + aquatic profiles
//   produces a population with SOME cleanly-draconic names and SOME
//   cleanly-aquatic ones, rather than one washed-out in-between sound.
export const customRaceDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  inspirationSourceIds: z.array(z.string()).catch([]),
  phoneticProfileIds: z.array(z.string()).catch([]),
  // Appearance-generation inputs for this race's Notable NPCs (see
  // settlementAppearance.ts) — the same two things baseline races get a
  // hardcoded profile for (a height range, plus distinctive features like
  // tusks/horns/scales), just user-editable here since a custom race has
  // no seeded profile to fall back on otherwise. Height defaults to a
  // roughly human range rather than something arbitrary.
  heightRangeCm: z.tuple([z.coerce.number(), z.coerce.number()]).catch([150, 190]),
  specialFeatures: z.array(z.string()).catch([])
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

// One candidate good/service a shop/tavern/religious building type might
// stock — see BuildingTypeDef.itemPool and settlementGenerator.ts's
// inventory generation. minSizeId reuses SETTLEMENT_SIZE_IDS as the exact
// same soft-gate concept used everywhere else in this file.
export const itemListingDefSchema = z.object({
  name: z.string(),
  minSizeId: z.string().catch('hamlet')
})
export type ItemListingDef = z.infer<typeof itemListingDefSchema>

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
  proficiencyPool: z.array(z.string()).catch([]),
  // Generic job titles an EMPLOYED STUB (not the notable — see
  // settlementResidentSchema.jobTitle) working here might be given, e.g.
  // "Apprentice"/"Journeyman" for a Blacksmith. Empty for non-staffed types,
  // which never employ anyone.
  jobTitlePool: z.array(z.string()).catch([]),
  // Candidate goods/services this building offers (shop/tavern/religious
  // categories only, see settlementGenerator.ts) — freeform strings mixing
  // goods and services, e.g. "Hand-forged nails" or "Horseshoeing
  // (service)". minSizeId reuses the exact same soft-gate concept as the
  // building type's own minSizeId: rarity IS availability-by-size, no
  // separate rarity enum needed.
  itemPool: z.array(itemListingDefSchema).catch([]),
  // What a notable of this type is actually CALLED — "Owner" is right for a
  // commercial shop, but wrong for a Town Hall (a mayor doesn't "own" city
  // government) or a Temple (a High Priest doesn't "own" the faith).
  // Optional (not .catch()) so every existing seeded entry doesn't need
  // updating — settlementGenerator.ts falls back to 'Owner' when unset,
  // same defensive-fallback pattern as itemPool/jobTitlePool elsewhere.
  notableTitle: z.string().optional(),
  // Hard cap on how many instances of this type a single settlement will
  // ever generate, regardless of weight/population (e.g. a city has ONE
  // Town Hall, not seventeen). Optional/undefined = unlimited, same as
  // every other building type's existing behavior.
  maxInstances: z.number().nullable().optional(),
  // Soft cap, as a percent (0-100) of the total staffed-building budget
  // (population / POPULATION_PER_STAFFED_BUILDING) this type can ever
  // claim, regardless of how high its weight is set. Unlike maxInstances
  // this scales with settlement size instead of being a fixed count — a
  // Temple weighted way up should still be capped as a SHARE of the town,
  // not frozen at some absolute number that's wrong for both a village and
  // a metropolis. Overflow past the cap is dropped, not redistributed to
  // other types — same tradeoff maxInstances already makes (a slightly
  // smaller total staffed-building count beats runaway overrepresentation
  // of one type). Optional/undefined = unlimited, same as every other soft
  // gate's default.
  maxSharePercent: z.coerce.number().nullable().optional()
})
export type BuildingTypeDef = z.infer<typeof buildingTypeDefSchema>

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
  linkedNoteTitle: z.string().nullable().catch(null),
  // Goods/services actually in stock at THIS instance — generated once at
  // creation time from the building type's itemPool (see
  // buildingTypeDefSchema) and preserved on regeneration same as everything
  // else about a promoted building. Empty for building types with no
  // itemPool (civic/residence — see settlementGenerator.ts).
  inventory: z.array(z.string()).catch([])
})
export type SettlementBuilding = z.infer<typeof settlementBuildingSchema>

export const settlementResidentSchema = z.object({
  id: z.string(),
  name: z.string(),
  race: z.string(),
  age: z.coerce.number().catch(30),
  gender: z.string().catch(''),
  professionBuildingId: z.string().nullable().catch(null),
  // What this resident is actually called at their workplace — "Owner" for
  // every notable (v1, see settlementGenerator.ts), or a generic drawn-from-
  // jobTitlePool title ("Apprentice", "Laborer", ...) for an employed stub.
  // Empty for anyone with no professionBuildingId. This is deliberately
  // separate from the People tab's "Workplace" column (renamed from
  // "Profession" — see SettlementPeopleTab.tsx), which shows WHERE someone
  // works; this is the role they hold there.
  jobTitle: z.string().catch(''),
  // Independent of wealthTierId by design (confirmed with the user): a
  // resident can be Middle class and between jobs, or Lower class and
  // homeless specifically — these are different axes in reality and
  // conflating them would complicate the wealth-tier percent-total UI.
  employmentStatus: z.enum(['employed', 'unemployed']).catch('unemployed'),
  // Distinct from `homeBuildingId === null`, which can also just mean "no
  // home building was assigned due to capacity" — this is a deliberate
  // homelessness state, not a generation-capacity artifact.
  homeless: z.boolean().catch(false),
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
    // A climate note's title (noteTypes/climate.ts) — optional. Same "note
    // title reference" convention as event.ts's location field.
    climateNoteTitle: z.string().nullable().catch(null),
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
// Each themed district gets a light default buildingTypeBoosts set so the
// seeded names actually mean something out of the box (a "Market District"
// skews toward shops, a "Government District" toward civic buildings) — see
// districtSchema's comment: this is a soft bias, not exclusive, so nothing
// here prevents a blacksmith from also showing up in the Craft District's
// neighbor.
const marketBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'general-store', multiplier: 2 },
  { buildingTypeId: 'market-stall', multiplier: 2 },
  { buildingTypeId: 'jeweler', multiplier: 1.5 },
  { buildingTypeId: 'bookshop', multiplier: 1.3 }
]
const governmentBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'town-hall', multiplier: 3 },
  { buildingTypeId: 'guildhall', multiplier: 2 },
  { buildingTypeId: 'guard-house', multiplier: 1.5 }
]
const craftBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'blacksmith', multiplier: 2 },
  { buildingTypeId: 'carpenter', multiplier: 2 },
  { buildingTypeId: 'tannery', multiplier: 1.5 }
]
const templeBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'temple', multiplier: 3 },
  { buildingTypeId: 'shrine', multiplier: 3 }
]
const entertainmentBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'theater', multiplier: 3 },
  { buildingTypeId: 'tavern', multiplier: 1.5 },
  { buildingTypeId: 'inn', multiplier: 1.3 }
]
const universityBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'university', multiplier: 3 },
  { buildingTypeId: 'school', multiplier: 2 },
  { buildingTypeId: 'library', multiplier: 2.5 },
  { buildingTypeId: 'bookshop', multiplier: 1.5 }
]
const docksBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'docks', multiplier: 3 },
  { buildingTypeId: 'fishmonger', multiplier: 2 },
  { buildingTypeId: 'warehouse', multiplier: 2 },
  { buildingTypeId: 'tavern', multiplier: 1.3 }
]
// Confirmed bug fix (user): "Residential District" had no boosts at all
// before this — a house was exactly as likely to land there as anywhere
// else, which defeats the point of naming it "Residential." Boosts every
// residence type equally; Wealthy District (below) gives Manor a stronger
// pull specifically, so manors skew toward Wealthy over plain Residential
// without excluding either.
const residentialBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'house', multiplier: 2 },
  { buildingTypeId: 'tenement', multiplier: 2 },
  { buildingTypeId: 'manor', multiplier: 2 },
  { buildingTypeId: 'farmstead', multiplier: 2 }
]
const wealthyBoosts: SpecialtyBoost[] = [
  { buildingTypeId: 'manor', multiplier: 3 },
  { buildingTypeId: 'library', multiplier: 2 },
  { buildingTypeId: 'jeweler', multiplier: 1.5 },
  { buildingTypeId: 'tailor', multiplier: 1.5 },
  { buildingTypeId: 'bakery', multiplier: 1.5 },
  { buildingTypeId: 'magic-item-shop', multiplier: 1.3 }
]
const noBoosts: SpecialtyBoost[] = []

const DISTRICTS_BY_SIZE: Record<string, District[]> = {
  hamlet: [{ id: 'main', name: 'Village Center', buildingTypeBoosts: noBoosts }],
  village: [
    { id: 'market', name: 'Market Square', buildingTypeBoosts: marketBoosts },
    { id: 'residential', name: 'Residential Quarter', buildingTypeBoosts: residentialBoosts }
  ],
  town: [
    { id: 'market', name: 'Market District', buildingTypeBoosts: marketBoosts },
    { id: 'residential', name: 'Residential District', buildingTypeBoosts: residentialBoosts },
    { id: 'government', name: 'Government District', buildingTypeBoosts: governmentBoosts },
    { id: 'temple', name: 'Temple District', buildingTypeBoosts: templeBoosts }
  ],
  city: [
    { id: 'north-market', name: 'North Market District', buildingTypeBoosts: marketBoosts },
    { id: 'south-market', name: 'South Market District', buildingTypeBoosts: marketBoosts },
    { id: 'residential', name: 'Residential District', buildingTypeBoosts: residentialBoosts },
    { id: 'government', name: 'Government District', buildingTypeBoosts: governmentBoosts },
    { id: 'craft', name: 'Craft District', buildingTypeBoosts: craftBoosts },
    { id: 'temple', name: 'Temple District', buildingTypeBoosts: templeBoosts },
    { id: 'entertainment', name: 'Entertainment District', buildingTypeBoosts: entertainmentBoosts },
    { id: 'university', name: 'University District', buildingTypeBoosts: universityBoosts },
    { id: 'docks', name: 'Docks District', buildingTypeBoosts: docksBoosts },
    { id: 'wealthy', name: 'Wealthy District', buildingTypeBoosts: wealthyBoosts }
  ],
  metropolis: [
    { id: 'north-market', name: 'North Market District', buildingTypeBoosts: marketBoosts },
    { id: 'south-market', name: 'South Market District', buildingTypeBoosts: marketBoosts },
    { id: 'east-market', name: 'East Market District', buildingTypeBoosts: marketBoosts },
    { id: 'residential', name: 'Residential District', buildingTypeBoosts: residentialBoosts },
    { id: 'government', name: 'Government District', buildingTypeBoosts: governmentBoosts },
    { id: 'craft', name: 'Craft District', buildingTypeBoosts: craftBoosts },
    { id: 'old-town', name: 'Old Town', buildingTypeBoosts: noBoosts },
    { id: 'temple', name: 'Temple District', buildingTypeBoosts: templeBoosts },
    { id: 'entertainment', name: 'Entertainment District', buildingTypeBoosts: entertainmentBoosts },
    { id: 'university', name: 'University District', buildingTypeBoosts: universityBoosts },
    { id: 'docks', name: 'Docks District', buildingTypeBoosts: docksBoosts },
    { id: 'wealthy', name: 'Wealthy District', buildingTypeBoosts: wealthyBoosts }
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
    { id: 'ultra-wealthy', name: 'Ultra-wealthy', percent: 2 },
    { id: 'upper', name: 'Upper', percent: 16 },
    { id: 'middle', name: 'Middle', percent: 47 },
    { id: 'lower', name: 'Lower', percent: 25 },
    // Deliberately last in the list — settlementGenerator.ts's homelessness
    // logic treats the LAST wealthTiers entry as "the lowest tier" (same
    // "list order = rank" convention the People/Buildings tabs already rely
    // on for wealth sorting), so this tier automatically becomes the one
    // homelessness rolls against without any code change.
    { id: 'destitute', name: 'Destitute', percent: 10 }
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
  // proficiencies/job titles/inventory are all moot for them) — left at
  // '' / [].
  const none = { primaryAbility: '', secondaryAbility: '', proficiencyPool: [] as string[], jobTitlePool: [] as string[], itemPool: [] as ItemListingDef[] }
  // Shorthand for an ItemListingDef — see buildingTypeDefSchema's itemPool
  // comment. Every shop/tavern/religious type below spans hamlet-to-
  // metropolis minSizeId tiers on purpose, so a bigger settlement's version
  // of the same shop genuinely skews toward rarer/pricier stock rather than
  // every item being reachable everywhere (see settlementGenerator.ts's
  // buildInventory, which reuses sizeGateMultiplier for the weighting).
  const item = (name: string, minSizeId: string): ItemListingDef => ({ name, minSizeId })
  // Magic Item Shop's itemPool is intentionally empty here — its content
  // (real item names/rarities/prices) is sourced from the user directly
  // rather than authored generically like the rest of this file, per
  // feedback_project_vault_no_campaign_content. Fill in once provided.
  const noItems: ItemListingDef[] = []
  return [
    // Residences — not staffed, no notable generated; these are what the
    // generator's household-count math is built from.
    { id: 'house', name: 'House', category: 'residence', defaultWealthTierId: 'middle', staffed: false, weight: 40, minSizeId: 'hamlet', ...none },
    { id: 'manor', name: 'Manor', category: 'residence', defaultWealthTierId: 'upper', staffed: false, weight: 5, minSizeId: 'town', ...none },
    { id: 'tenement', name: 'Tenement', category: 'residence', defaultWealthTierId: 'lower', staffed: false, weight: 20, minSizeId: 'village', ...none },
    { id: 'farmstead', name: 'Farmstead', category: 'residence', defaultWealthTierId: 'lower', staffed: false, weight: 10, minSizeId: 'hamlet', ...none },
    // Shops
    { id: 'general-store', name: 'General Store', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 6, minSizeId: 'hamlet', primaryAbility: 'cha', secondaryAbility: 'int', proficiencyPool: ['Persuasion', 'Insight'], jobTitlePool: ['Clerk', 'Shop Hand', 'Stock Keeper'], itemPool: [
      item('Rope (50 ft)', 'hamlet'), item('Lantern oil', 'hamlet'), item("Traveler's rations", 'hamlet'), item('Iron cookpot', 'hamlet'),
      item('Sewing kit', 'village'), item('Tinderbox', 'village'),
      item('Fine wool blanket', 'town'), item('Imported spices', 'city'), item('Ornamental hand mirror', 'metropolis'),
      item('Abacus (2 gp)', 'town'),
      item('Barrel (2 gp)', 'hamlet'),
      item('Chest (5 gp)', 'town'),
      item('Clothes, Fine (15 gp)', 'city'),
      item('Ink, 1 ounce bottle (10 gp)', 'hamlet'),
      item('Journal, soft bound, 25 sheets (7 gp)', 'village'),
      item('Ladder, 10-foot (1 sp)', 'village'),
      item('Lantern, hooded (5 gp)', 'town'),
      item('Lock (10 gp)', 'town'),
      item('Mirror, steel (5 gp)', 'village'),
      item('Rope, hempen, 50 feet (1 gp)', 'village'),
      item('Rope, silk, 50 feet (10 gp)', 'city'),
      item('Scale, merchant\'s (5 gp)', 'town'),
      item('Signet ring (5 gp)', 'town'),
      item('Soap (2 cp)', 'town'),
    ] },
    { id: 'blacksmith', name: 'Blacksmith', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 3, minSizeId: 'hamlet', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ["Smith's Tools", 'Athletics'], jobTitlePool: ['Apprentice', 'Striker', 'Journeyman Smith'], itemPool: [
      item('Hand-forged nails', 'hamlet'), item('Horseshoeing (service)', 'hamlet'), item('Simple dagger', 'hamlet'), item('Farming hoe', 'hamlet'),
      item('Chainmail shirt', 'village'), item('Weapon repair (service)', 'village'),
      item('Steel longsword', 'town'), item("Custom armor fitting (service)", 'city'), item('Masterwork plate armor', 'metropolis'),
      item('Studded leather armor (45 gp)', 'city'),
      item('Chain shirt (50 gp)', 'hamlet'),
      item('Scale mail (50 gp)', 'town'),
      item('Breastplate (400 gp)', 'hamlet'),
      item('Half plate (750 gp)', 'city'),
      item('Ring mail (30 gp)', 'village'),
      item('Chain mail (75 gp)', 'hamlet'),
      item('Splint armor (200 gp)', 'town'),
      item('Plate armor (1,500 gp)', 'city'),
      item('Shield (10 gp)', 'hamlet'),
      item('Battleaxe (10 gp)', 'hamlet'),
      item('Greataxe (30 gp)', 'village'),
      item('Warhammer (15 gp)', 'village'),
      item('Rapier (25 gp)', 'city'),
      item('Tinker\'s tools (50 gp)', 'city'),
    ] },
    { id: 'bakery', name: 'Bakery', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 4, minSizeId: 'village', primaryAbility: 'con', secondaryAbility: 'wis', proficiencyPool: ["Cook's Utensils", 'Perception'], jobTitlePool: ["Baker's Apprentice", 'Kitchen Hand'], itemPool: [
      item('Loaf of bread', 'hamlet'), item('Meat pie', 'hamlet'),
      item('Honey cake', 'village'), item('Spiced fruit bread', 'town'),
      item('Iced pastries', 'city'), item('Sugar-sculpture centerpiece (custom order)', 'metropolis'),
      item('Almond or sweet roll (1 sp)', 'hamlet'),
      item('Seedcake (5 cp)', 'hamlet'),
      item('Wheaten loaf (2 sp)', 'hamlet'),
      item('Cheese danish (1 sp)', 'village'),
      item('Fruit tart (2 sp)', 'hamlet'),
      item('Manchet loaf (1 gp)', 'city'),
      item('Rye loaf (2 cp)', 'hamlet'),
    ] },
    { id: 'tailor', name: 'Tailor', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 3, minSizeId: 'village', primaryAbility: 'dex', secondaryAbility: 'int', proficiencyPool: ["Weaver's Tools", 'Sleight of Hand'], jobTitlePool: ['Apprentice Tailor', 'Seamstress', 'Cutter'], itemPool: [
      item('Patchwork cloak', 'hamlet'), item('Plain wool tunic', 'hamlet'), item('Mending (service)', 'hamlet'),
      item('Dyed linen shirt', 'village'), item('Traveling cloak, weatherproofed', 'town'),
      item('Silk-lined coat', 'city'), item('Custom court gown', 'metropolis'),
      item('Cloak, canvas (7 sp)', 'village'),
      item('Cloak, leather (2 gp)', 'town'),
      item('Robes (1 gp)', 'village'),
      item('Bone needle, 5 (3 cp)', 'hamlet'),
      item('Steel needle (1 sp)', 'village'),
      item('Cotton thread, 30 feet (5 sp)', 'village'),
      item('Dress (7 gp)', 'city'),
      item('Coat (5 gp)', 'town'),
      item('Vests (3 gp)', 'town'),
      item('Corset (3 gp)', 'city'),
      item('Bandolier (8 gp)', 'town'),
      item('Embroidery, per foot (2 gp)', 'city'),
    ] },
    { id: 'apothecary', name: 'Apothecary', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'int', secondaryAbility: 'wis', proficiencyPool: ['Herbalism Kit', 'Medicine'], jobTitlePool: ['Apprentice', 'Herb Gatherer'], itemPool: [
      item('Dried herbs bundle', 'hamlet'), item('Basic salve', 'hamlet'),
      item('Headache tonic', 'village'),
      item('Antitoxin', 'town'), item('Sleeping draught', 'town'),
      item('Rare imported root extract', 'city'), item("Alchemist's exotic tincture", 'metropolis'),
      item('Acid, vial (25 gp)', 'village'),
      item('Alchemist\'s fire, flask (50 gp)', 'town'),
      item('Antitoxin, vial (50 gp)', 'hamlet'),
      item('Component pouch (25 gp)', 'town'),
      item('Poison, basic, vial (100 gp)', 'hamlet'),
      item('Alchemy ingredient, common (3 sp)', 'hamlet'),
      item('Alchemy ingredient, uncommon (1 gp)', 'hamlet'),
      item('Alchemy ingredient, rare (10 gp)', 'town'),
      item('Alchemy ingredient, very rare (30 gp)', 'city'),
      item('Alchemist\'s supplies (50 gp)', 'town'),
      item('Poisoner\'s kit (50 gp)', 'village'),
    ] },
    { id: 'jeweler', name: 'Jeweler', category: 'shop', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'dex', secondaryAbility: 'int', proficiencyPool: ["Jeweler's Tools", 'Investigation'], jobTitlePool: ['Apprentice', 'Polisher'], itemPool: [
      item('Polished stone ring', 'town'), item('Silver bracelet', 'town'), item('Gold locket', 'town'),
      item('Sapphire pendant', 'city'), item('Cut diamond', 'city'), item('Matched pearl necklace', 'city'),
      item('Flawless emerald tiara', 'metropolis'), item('Antique royal signet ring', 'metropolis'),
      item('Ring, exquisite (3 gp)', 'town'),
      item('Earrings, exquisite (4 gp)', 'town'),
      item('Azurite, 10 gp gemstone (10 gp)', 'town'),
      item('Lapis lazuli, 10 gp gemstone (10 gp)', 'town'),
      item('Bloodstone, 50 gp gemstone (50 gp)', 'town'),
      item('Onyx, 50 gp gemstone (50 gp)', 'town'),
      item('Amber, 100 gp gemstone (100 gp)', 'city'),
      item('Garnet, 100 gp gemstone (100 gp)', 'city'),
      item('Pearl, 100 gp gemstone (100 gp)', 'city'),
      item('Aquamarine, 500 gp gemstone (500 gp)', 'city'),
      item('Topaz, 500 gp gemstone (500 gp)', 'city'),
      item('Emerald, 1,000 gp gemstone (1,000 gp)', 'city'),
      item('Blue sapphire, 1,000 gp gemstone (1,000 gp)', 'city'),
      item('Diamond, 5,000 gp gemstone (5,000 gp)', 'metropolis'),
      item('Ruby, 5,000 gp gemstone (5,000 gp)', 'metropolis'),
      item('Gemstone appraisal, 3 gems (service, 5 gp)', 'town'),
      item('Resizing jewelry (service, 10 gp)', 'town'),
      item('Setting a gem under 100 gp value (service, 45 gp)', 'town'),
    ] },
    { id: 'bookshop', name: 'Bookshop', category: 'shop', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'int', secondaryAbility: 'wis', proficiencyPool: ['History', 'Investigation'], jobTitlePool: ['Clerk', 'Copyist'], itemPool: [
      item('Well-worn almanac', 'town'), item('Local history pamphlet', 'town'), item('Poetry chapbook', 'town'),
      item('Illustrated bestiary', 'city'), item('Rare first-edition novel', 'city'),
      item('Ancient hand-copied manuscript', 'metropolis'),
      item('Book, common, soft bound (8 gp)', 'town'),
      item('Book, common, hard bound (10 gp)', 'town'),
      item('Book, uncommon, soft bound (15 gp)', 'city'),
      item('Book, uncommon, hard bound (20 gp)', 'city'),
      item('Book, rare, soft bound (30 gp)', 'metropolis'),
      item('Book, rare, hard bound (50 gp)', 'metropolis'),
    ] },
    { id: 'stables', name: 'Stables', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'wis', secondaryAbility: 'con', proficiencyPool: ['Animal Handling', 'Survival'], jobTitlePool: ['Stablehand', 'Groom'], itemPool: [
      item('Stabling for the night (service)', 'village'), item('Saddle and tack', 'village'), item('Cart horse', 'village'), item('Pack mule', 'village'),
      item('Riding horse, well-trained', 'town'),
      item('Prize-bred warhorse', 'city'),
      item('Donkey or mule (8 gp)', 'hamlet'),
      item('Pony (30 gp)', 'village'),
      item('Horse, draft (50 gp)', 'village'),
      item('Horse, riding (75 gp)', 'village'),
      item('Mastiff (25 gp)', 'village'),
      item('Warhorse (400 gp)', 'town'),
      item('Camel (50 gp)', 'city'),
      item('Elephant (200 gp)', 'metropolis'),
      item('Bit and bridle (2 gp)', 'hamlet'),
      item('Saddlebags (4 gp)', 'village'),
      item('Saddle, riding (10 gp)', 'village'),
      item('Saddle, military (20 gp)', 'town'),
      item('Saddle, exotic (60 gp)', 'city'),
      item('Cart (15 gp)', 'village'),
      item('Wagon (35 gp)', 'town'),
      item('Carriage (100 gp)', 'city'),
      item('Feed, per day (5 cp)', 'hamlet'),
    ] },
    { id: 'tannery', name: 'Tannery', category: 'shop', defaultWealthTierId: 'lower', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ["Leatherworker's Tools", 'Athletics'], jobTitlePool: ["Tanner's Apprentice", 'Hide Scraper'], itemPool: [
      item('Cured leather hide', 'hamlet'), item('Leather boots', 'hamlet'), item('Leatherworking (service)', 'hamlet'),
      item('Fur-lined gloves', 'village'),
      item('Dyed leather satchel', 'town'), item('Exotic beast hide', 'city'),
      item('Leather armor (10 gp)', 'hamlet'),
      item('Hide armor (10 gp)', 'hamlet'),
      item('Shield (10 gp)', 'village'),
      item('Cobbler\'s tools (5 gp)', 'village'),
      item('Waterskin (2 sp)', 'hamlet'),
      item('Sling (1 sp)', 'village'),
    ] },
    { id: 'carpenter', name: 'Carpenter', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'str', secondaryAbility: 'dex', proficiencyPool: ["Carpenter's Tools", 'Athletics'], jobTitlePool: ['Apprentice Carpenter', 'Sawyer'], itemPool: [
      item('Wooden stool', 'hamlet'), item('Repairs (service)', 'hamlet'),
      item('Storage chest', 'village'),
      item('Custom furniture (service)', 'town'),
      item('Fine oak wardrobe', 'city'), item('Ornately carved cabinet', 'metropolis'),
      item("Carpenter's tools (8 gp)", 'hamlet'),
      item('Ladder, 10-foot (1 sp)', 'village'),
      item('Barrel (2 gp)', 'village'),
      item('Cart (15 gp)', 'town'),
      item('Darkwood, per unit (100 gp)', 'city'),
      item('Spiritual Wood, per unit (250 gp)', 'metropolis')
    ] },
    { id: 'fishmonger', name: 'Fishmonger', category: 'shop', defaultWealthTierId: 'lower', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'con', secondaryAbility: 'str', proficiencyPool: ["Navigator's Tools", 'Survival'], jobTitlePool: ["Fishmonger's Hand", 'Net Mender'], itemPool: [
      item('Fresh catch of the day', 'hamlet'), item('Salted fish', 'hamlet'),
      item('Smoked eel', 'village'),
      item('Barrel of oysters', 'town'),
      item('Rare deep-sea delicacy', 'city'),
      item('Fishing tackle (1 gp)', 'hamlet'),
      item('Net (1 gp)', 'village'),
      item('Rowboat (50 gp)', 'town'),
      item('1 lb. fishing bait (5 cp)', 'hamlet'),
      item('Fresh fish, per lb. (6 sp)', 'hamlet'),
      item('Shellfish, per lb. (2 gp)', 'city'),
    ] },
    { id: 'mill', name: 'Mill', category: 'shop', defaultWealthTierId: 'lower', staffed: true, weight: 1, minSizeId: 'hamlet', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ['Athletics', 'Perception'], jobTitlePool: ["Miller's Hand", 'Sack Carrier'], itemPool: [
      item('Sack of flour', 'hamlet'), item('Milling (service)', 'hamlet'), item('Cornmeal', 'hamlet'),
      item('Fine-ground pastry flour', 'village'),
      item('Barley or rye, per lb. (2 cp)', 'hamlet'),
      item('Oats, per lb. (5 sp)', 'village'),
      item('Wheat, per lb. (1 sp)', 'hamlet'),
      item('Rice, per lb. (5 cp)', 'city'),
      item('Quinoa, per lb. (1 gp)', 'town'),
      item('Amaranth, per lb. (2 gp)', 'city'),
    ] },
    { id: 'brewery', name: 'Brewery', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'village', primaryAbility: 'con', secondaryAbility: 'wis', proficiencyPool: ["Brewer's Supplies", 'Perception'], jobTitlePool: ["Brewer's Apprentice", 'Cellar Hand'], itemPool: [
      item('Cask of ale', 'hamlet'), item('House brew', 'hamlet'),
      item('Spiced winter ale', 'village'),
      item('Barrel-aged stout', 'town'),
      item('Rare imported wine', 'city'),
      item('Brewer\'s supplies (20 gp)', 'village'),
    ] },
    // Added from the D&D Shop Catalog v2.0.2 (user-supplied, Downloads) —
    // shop categories that appeared in the catalog but had no matching
    // building type here yet. Sized/gated the same way as everything else:
    // weight/minSizeId reflect how plausible each is at a given settlement
    // size, not a hard requirement.
    { id: 'fletcher', name: 'Fletcher', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'dex', secondaryAbility: 'str', proficiencyPool: ["Woodcarver's Tools", 'Survival'], jobTitlePool: ['Apprentice Fletcher', 'String Winder'], itemPool: [
      item('Shortbow (25 gp)', 'hamlet'),
      item('Longbow (50 gp)', 'hamlet'),
      item('Crossbow, light (25 gp)', 'town'),
      item('Crossbow, heavy (50 gp)', 'village'),
      item('Crossbow, hand (75 gp)', 'city'),
      item('Arrows, 20 (1 gp)', 'hamlet'),
      item('Crossbow bolts, 20 (1 gp)', 'village'),
      item('Bowstring, 5 (2 gp)', 'hamlet'),
      item('Case, crossbow bolt (1 gp)', 'village'),
      item('Quiver (1 gp)', 'hamlet')
    ] },
    { id: 'adventuring-supplies', name: 'Adventuring Supplies', category: 'shop', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'wis', secondaryAbility: 'con', proficiencyPool: ['Survival', 'Investigation'], jobTitlePool: ['Outfitter', 'Quartermaster'], itemPool: [
      item('Backpack (2 gp)', 'hamlet'),
      item('Bedroll (1 gp)', 'hamlet'),
      item("Climber's kit (25 gp)", 'town'),
      item('Grappling hook (2 gp)', 'village'),
      item("Healer's kit (5 gp)", 'city'),
      item('Hunting trap (5 gp)', 'village'),
      item('Rations, 1 day (5 sp)', 'village'),
      item('Rope, hempen, 50 feet (1 gp)', 'hamlet'),
      item('Spyglass (1,000 gp)', 'city'),
      item('Tent, two-person (2 gp)', 'hamlet'),
      item('Tinderbox (5 sp)', 'hamlet'),
      item('Waterskin (2 sp)', 'hamlet'),
      item('Longbow (50 gp)', 'village'),
      item('Studded leather armor (45 gp)', 'city')
    ] },
    { id: 'market-stall', name: 'Market Stall', category: 'shop', defaultWealthTierId: 'lower', staffed: true, weight: 5, minSizeId: 'hamlet', primaryAbility: 'cha', secondaryAbility: 'int', proficiencyPool: ['Persuasion', 'Deception'], jobTitlePool: ['Stall Hand'], itemPool: [
      item('Assorted trinkets', 'hamlet'), item('Fresh produce', 'hamlet'), item('Secondhand tools', 'hamlet'),
      item('Cheap jewelry (likely fake)', 'village'), item("Traveler's odds and ends", 'village'),
      item('Fruit, in season (1 cp)', 'hamlet'),
      item('Fruit, out of season (5 cp)', 'town'),
      item('Cabbage or lettuce (2 cp)', 'hamlet'),
      item('Broccoli or cauliflower (3 cp)', 'hamlet'),
      item('Root vegetable (1 cp)', 'hamlet'),
      item('Cinnamon, per half ounce (1 sp)', 'village'),
      item('Pepper, per half ounce (5 cp)', 'hamlet'),
      item('Salt, per half ounce (6 cp)', 'hamlet'),
      item('Cup of coffee (5 cp)', 'village'),
      item('Goodberry "wine" (1 sp)', 'hamlet'),
    ] },
    {
      id: 'magic-item-shop',
      name: 'Magic Item Shop',
      category: 'shop',
      defaultWealthTierId: 'upper',
      staffed: true,
      // Rarer than the jeweler/bookshop it's tuned alongside (same weight,
      // same minSizeId) — soft-gated so a hamlet/village essentially never
      // rolls one, a town gets roughly one, and the count scales up with the
      // staffed-building budget (population / POPULATION_PER_STAFFED_BUILDING
      // — see settlementGenerator.ts) for city/metropolis, same mechanism as
      // every other building type here, no special-casing needed.
      weight: 1,
      minSizeId: 'town',
      primaryAbility: 'int',
      secondaryAbility: 'cha',
      proficiencyPool: ['Arcana', 'Investigation'],
      jobTitlePool: ['Apprentice', 'Appraiser'],
      // Prices are the user's own Kassoon-sourced official price list,
      // cross-referenced item-by-item against their provided item list
      // (Kassoon's numbers win on any conflict — confirmed with the user,
      // "official prices used where possible"). minSizeId is driven by
      // PRICE, not the item's nominal D&D rarity label — several nominally
      // "uncommon" items (Decanter of Endless Water, Immovable Rod) price
      // far above typical uncommon gear once you use real official numbers,
      // and gating by label alone would put something worth tens of
      // thousands of gp in a hamlet's shop. Bands: town = up to ~2,000 gp,
      // city = ~2,000-20,000 gp, metropolis = 20,000+ gp — directly
      // satisfies the user's explicit rule that a town shop "very likely
      // will not have legendary items or even very rare items."
      itemPool: [
        item('Spell Scroll Level 0 (10 gp)', 'town'),
        item('Potion of Healing (50 gp)', 'town'),
        item('Quaal\'s Feather Token Anchor (50 gp)', 'town'),
        item('Spell Scroll Level 1 (50 gp)', 'town'),
        item('Spellwrought Tattoo Cantrip (50 gp)', 'town'),
        item('Illuminator\'s Tattoo (60 gp)', 'town'),
        item('Masquerade Tattoo (60 gp)', 'town'),
        item('Philter of Love (90 gp)', 'town'),
        item('Ammunition +1 (10) (100 gp)', 'town'),
        item('Ammunition +2 (each) (100 gp)', 'town'),
        item('Dust of Disappearance (100 gp)', 'town'),
        item('Dust of Dryness (1 pellet) (100 gp)', 'town'),
        item('Keoghtom\'s Ointment (per dose) (100 gp)', 'town'),
        item('Potion of Water Breathing (100 gp)', 'town'),
        item('Ring of Warmth (100 gp)', 'town'),
        item('Wind Fan (100 gp)', 'town'),
        item('Elixir of Health (125 gp)', 'town'),
        item('Potion of Poison (125 gp)', 'town'),
        item('Potion of Fire Breath (150 gp)', 'town'),
        item('Spell Scroll Level 2 (150 gp)', 'town'),
        item('Alchemy Jug (200 gp)', 'town'),
        item('Oil of Slipperiness (200 gp)', 'town'),
        item('Potion of Animal Friendship (200 gp)', 'town'),
        item('Potion of Climbing (200 gp)', 'town'),
        item('Potion of Diminution (200 gp)', 'town'),
        item('Potion of Growth (200 gp)', 'town'),
        item('Potion of Heroism (200 gp)', 'town'),
        item('Potion of Invisibility (200 gp)', 'town'),
        item('Potion of Mind Reading (200 gp)', 'town'),
        item('Prosthetic Limb (200 gp)', 'town'),
        item('Quaal\'s Feather Token Fan (200 gp)', 'town'),
        item('Quaal\'s Feather Token Whip (200 gp)', 'town'),
        item('Universal Solvent (200 gp)', 'town'),
        item('Potion of Greater Healing (200 gp)', 'town'),
        item('Rope of Climbing (250 gp)', 'town'),
        item('Shield, +1 (300 gp)', 'town'),
        item('Weapon, +1 (300 gp)', 'town'),
        item('Ivory Goat (Travail) (300 gp)', 'town'),
        item('Necklace of Fireballs (One bead) (300 gp)', 'town'),
        item('Potion of Gaseous Form (300 gp)', 'town'),
        item('Potion of Resistance (300 gp)', 'town'),
        item('Potion of Speed (300 gp)', 'town'),
        item('Spell Scroll Level 3 (300 gp)', 'town'),
        item('Spellwrought Tattoo 1st Level (300 gp)', 'town'),
        item('Deck of Illusions (400 gp)', 'town'),
        item('Horn of Blasting (400 gp)', 'town'),
        item('Lantern of Revealing (400 gp)', 'town'),
        item('Necklace of Fireballs (Two beads) (400 gp)', 'town'),
        item('Sovereign Glue (400 gp)', 'town'),
        item('Ammunition +3 (each) (500 gp)', 'town'),
        item('Bag of Holding (500 gp)', 'town'),
        item('Dust of Sneezing and Choking (500 gp)', 'town'),
        item('Gloves of Thievery (500 gp)', 'town'),
        item('Golden Lion (each) (500 gp)', 'town'),
        item('Instrument of the Bards - Doss Lute (500 gp)', 'town'),
        item('Periapt of Wound Closure (500 gp)', 'town'),
        item('Pipes of Haunting (500 gp)', 'town'),
        item('Robe of useful items (500 gp)', 'town'),
        item('Barrier Tattoo, Uncommon (600 gp)', 'town'),
        item('Boots of Elvenkind (600 gp)', 'town'),
        item('Boots of Striding and Springing (600 gp)', 'town'),
        item('Broom of Flying (600 gp)', 'town'),
        item('Coiling Grasp Tattoo (600 gp)', 'town'),
        item('Eldritch Claw Tattoo (600 gp)', 'town'),
        item('Gem of Brightness (600 gp)', 'town'),
        item('Helm of Comprehending Languages (600 gp)', 'town'),
        item('Luckstone (600 gp)', 'town'),
        item('Medallion of Thoughts (600 gp)', 'town'),
        item('Pearl of Power (600 gp)', 'town'),
        item('Spell Scroll Level 4 (600 gp)', 'town'),
        item('Spellwrought Tattoo 2nd Level (600 gp)', 'town'),
        item('Arrow of Slaying (each) (700 gp)', 'town'),
        item('Driftglobe (700 gp)', 'town'),
        item('Gauntlets of Ogre Power (700 gp)', 'town'),
        item('Ring of Mind Shielding (700 gp)', 'town'),
        item('Wand of Secrets (750 gp)', 'town'),
        item('Cloak of Protection (800 gp)', 'town'),
        item('Elemental Gem (800 gp)', 'town'),
        item('Mithral Armor (800 gp)', 'town'),
        item('Necklace of Fireballs (Three beads) (800 gp)', 'town'),
        item('Trident of Fish Command (800 gp)', 'town'),
        item('Adamantine Armor (900 gp)', 'town'),
        item('Armor, +1 (1,000 gp)', 'town'),
        item('Cap of Water Breathing (1,000 gp)', 'town'),
        item('Circlet of Blasting (1,000 gp)', 'town'),
        item('Cloak of Elvenkind (1,000 gp)', 'town'),
        item('Eversmoking Bottle (1,000 gp)', 'town'),
        item('Ioun Stone Protection (1,000 gp)', 'town'),
        item('Ivory Goat (Traveling) (1,000 gp)', 'town'),
        item('Javelin of Lightning (1,000 gp)', 'town'),
        item('Mariner\'s Armor (1,000 gp)', 'town'),
        item('Necklace of Adaptation (1,000 gp)', 'town'),
        item('Potion of Clairvoyance (1,000 gp)', 'town'),
        item('Potion of Vitality (1,000 gp)', 'town'),
        item('Quiver of Ehlonna (1,000 gp)', 'town'),
        item('Spellwrought Tattoo 3rd Level (1,000 gp)', 'town'),
        item('Wand of Magic Missiles (1,000 gp)', 'town'),
        item('Wand of the War Mage +1 (1,000 gp)', 'town'),
        item('Weapon of Warning (1,000 gp)', 'town'),
        item('Wand of Magic Detection (1,200 gp)', 'town'),
        item('Scroll of Protection (1,500 gp)', 'town'),
        item('Spellwrought Tattoo 4th Level (1,500 gp)', 'town'),
        item('Potion of Superior Healing (2,000 gp)', 'town'),
        item('Alchemical Compendium (2,000 gp)', 'town'),
        item('All-Purpose Tool +1 (2,000 gp)', 'town'),
        item('Bell Branch (2,000 gp)', 'town'),
        item('Bracers of Archery (2,000 gp)', 'town'),
        item('Dancing Sword (2,000 gp)', 'town'),
        item('Eyes of Minute Seeing (2,000 gp)', 'town'),
        item('Flame Tongue (2,000 gp)', 'town'),
        item('Frost Brand (2,000 gp)', 'town'),
        item('Gloves of Swimming and Climbing (2,000 gp)', 'town'),
        item('Goggles of Night (2,000 gp)', 'town'),
        item('Guardian Emblem (2,000 gp)', 'town'),
        item('Ioun Stone Absorption (2,000 gp)', 'town'),
        item('Ioun Stone Agility (2,000 gp)', 'town'),
        item('Necklace of Fireballs (Four beads) (2,000 gp)', 'town'),
        item('Pipes of the Sewers (2,000 gp)', 'town'),
        item('Prayer Bead - Bless (2,000 gp)', 'town'),
        item('Prayer Bead - Smiting (2,000 gp)', 'town'),
        item('Ring of Swimming (2,000 gp)', 'town'),
        item('Ring of Water Walking (2,000 gp)', 'town'),
        item('Saddle of the Cavalier (2,000 gp)', 'town'),
        item('Sending Stones (2,000 gp)', 'town'),
        item('Staff of the Adder (2,000 gp)', 'town'),
        item('Staff of the Python (2,000 gp)', 'town'),
        item('Shield, +2 (3,000 gp)', 'city'),
        item('Astromancy Archive (3,000 gp)', 'city'),
        item('Dagger of Venom (3,000 gp)', 'city'),
        item('Dimensional Shackles (3,000 gp)', 'city'),
        item('Eyes of Charming (3,000 gp)', 'city'),
        item('Eyes of the Eagle (3,000 gp)', 'city'),
        item('Gloves of Missile Snaring (3,000 gp)', 'city'),
        item('Heart Weaver\'s Primer (3,000 gp)', 'city'),
        item('Ioun Stone Insight (3,000 gp)', 'city'),
        item('Ioun Stone Regeneration (3,000 gp)', 'city'),
        item('Ioun Stone Strength (3,000 gp)', 'city'),
        item('Libram of Lost Souls (3,000 gp)', 'city'),
        item('Moon Sickle +1 (3,000 gp)', 'city'),
        item('Necklace of Fireballs (Five beads) (3,000 gp)', 'city'),
        item('Oil of Etherealness (3,000 gp)', 'city'),
        item('Oil of Sharpness (3,000 gp)', 'city'),
        item('Quaal\'s Feather Token Bird (3,000 gp)', 'city'),
        item('Ring of Jumping (3,000 gp)', 'city'),
        item('Spellwrought Tattoo 5th Level (3,000 gp)', 'city'),
        item('Spell Scroll Level 5 (3,200 gp)', 'city'),
        item('Amulet of Health (4,000 gp)', 'city'),
        item('Boots of Speed (4,000 gp)', 'city'),
        item('Dragon Scale Mail (4,000 gp)', 'city'),
        item('Immovable Rod (4,000 gp)', 'city'),
        item('Periapt of Health (4,000 gp)', 'city'),
        item('Potion of Invulnerability (4,000 gp)', 'city'),
        item('Ring of X-Ray Vision (4,000 gp)', 'city'),
        item('Ring of the Ram (4,000 gp)', 'city'),
        item('Wand of Enemy Detection (4,000 gp)', 'city'),
        item('Wand of the War Mage +2 (4,000 gp)', 'city'),
        item('Amulet of the Devout +1 (5,000 gp)', 'city'),
        item('Arcane Grimoire +1 (5,000 gp)', 'city'),
        item('Atlas of Endless Horizons (5,000 gp)', 'city'),
        item('Bead of Force (5,000 gp)', 'city'),
        item('Bloodwell Vial +1 (5,000 gp)', 'city'),
        item('Cloak of Arachnida (5,000 gp)', 'city'),
        item('Cloak of the Manta Ray (5,000 gp)', 'city'),
        item('Duplicitous Manuscript (5,000 gp)', 'city'),
        item('Ghost Step Tattoo (5,000 gp)', 'city'),
        item('Glamoured Studded Leather (5,000 gp)', 'city'),
        item('Iron Bands of Bilarro (5,000 gp)', 'city'),
        item('Manual of Golems (5,000 gp)', 'city'),
        item('Planecaller\'s Codex (5,000 gp)', 'city'),
        item('Prayer Bead - Curing (5,000 gp)', 'city'),
        item('Rhythm-Maker\'s Drum +1 (5,000 gp)', 'city'),
        item('Ring of Animal Influence (5,000 gp)', 'city'),
        item('Rod of the Pact Keeper +1 (5,000 gp)', 'city'),
        item('Shield of Missile Attraction (5,000 gp)', 'city'),
        item('Silver Raven (5,000 gp)', 'city'),
        item('Slippers of Spider Climbing (5,000 gp)', 'city'),
        item('Tentacle Rod (5,000 gp)', 'city'),
        item('Armor, +2 (6,000 gp)', 'city'),
        item('Animated Shield (6,000 gp)', 'city'),
        item('Barrier Tattoo, Rare (6,000 gp)', 'city'),
        item('Bronze Griffon (6,000 gp)', 'city'),
        item('Far Realm Shard (6,000 gp)', 'city'),
        item('Fulminating Treatise (6,000 gp)', 'city'),
        item('Hat of Disguise (6,000 gp)', 'city'),
        item('Horseshoes of Speed (6,000 gp)', 'city'),
        item('Ioun Stone Awareness (6,000 gp)', 'city'),
        item('Ioun Stone Sustenance (6,000 gp)', 'city'),
        item('Marble Elephant (6,000 gp)', 'city'),
        item('Necklace of Fireballs (Six beads) (6,000 gp)', 'city'),
        item('Ring of Resistance (6,000 gp)', 'city'),
        item('Scimitar of Speed (6,000 gp)', 'city'),
        item('Shadowfell Brand Tattoo (6,000 gp)', 'city'),
        item('All-Purpose Tool +2 (7,000 gp)', 'city'),
        item('Belt of Dwarvenkind (7,000 gp)', 'city'),
        item('Cape of the Mountebank (7,000 gp)', 'city'),
        item('Censer of Controlling Air Elementals (7,000 gp)', 'city'),
        item('Dragon Slayer (7,000 gp)', 'city'),
        item('Ebony Fly (7,000 gp)', 'city'),
        item('Headband of Intellect (7,000 gp)', 'city'),
        item('Nine Lives Stealer (Fully Charged) (7,000 gp)', 'city'),
        item('Robe of Scintillating Colors (7,000 gp)', 'city'),
        item('Wand of Web (7,000 gp)', 'city'),
        item('Breastplate, +1 (7,500 gp)', 'city'),
        item('Ring of Feather Falling (7,500 gp)', 'city'),
        item('Rope of Entanglement (7,500 gp)', 'city'),
        item('Spell Scroll Level 6 (7,500 gp)', 'city'),
        item('Bowl of Commanding Water Elementals (8,000 gp)', 'city'),
        item('Brazier of Commanding Fire Elementals (8,000 gp)', 'city'),
        item('Brooch of Shielding (8,000 gp)', 'city'),
        item('Elemental Essence Shard (8,000 gp)', 'city'),
        item('Feywild Shard (8,000 gp)', 'city'),
        item('Giant Slayer (8,000 gp)', 'city'),
        item('Heward\'s Handy Haversack (8,000 gp)', 'city'),
        item('Mace of Smiting (8,000 gp)', 'city'),
        item('Moon Sickle +2 (8,000 gp)', 'city'),
        item('Serpentine Owl (8,000 gp)', 'city'),
        item('Shadowfell Shard (8,000 gp)', 'city'),
        item('Staff of Charming (8,000 gp)', 'city'),
        item('Stone of Controlling Earth Elementals (8,000 gp)', 'city'),
        item('Belt of hill giant strength (9,000 gp)', 'city'),
        item('Dwarven Plate (9,000 gp)', 'city'),
        item('Instrument of the Bards - Canaith Mandolin (9,000 gp)', 'city'),
        item('Potion of Flying (9,000 gp)', 'city'),
        item('Ring of Free Action (9,000 gp)', 'city'),
        item('Ring of Protection (9,000 gp)', 'city'),
        item('Rod of the Pact Keeper +2 (9,000 gp)', 'city'),
        item('Staff of Swarming Insects (9,000 gp)', 'city'),
        item('Winged Boots (9,000 gp)', 'city'),
        item('Amulet of the Devout +2 (10,000 gp)', 'city'),
        item('Apparatus of Kwalish (10,000 gp)', 'city'),
        item('Arcane Grimoire +2 (10,000 gp)', 'city'),
        item('Astral Shard (10,000 gp)', 'city'),
        item('Bloodwell Vial +2 (10,000 gp)', 'city'),
        item('Boots of the Winterlands (10,000 gp)', 'city'),
        item('Carpet of Flying (10,000 gp)', 'city'),
        item('Cube of Force (10,000 gp)', 'city'),
        item('Devotee\'s Censer (10,000 gp)', 'city'),
        item('Dwarven Thrower (10,000 gp)', 'city'),
        item('Helm of Telepathy (10,000 gp)', 'city'),
        item('Lifewell Tattoo (10,000 gp)', 'city'),
        item('Mace of Disruption (10,000 gp)', 'city'),
        item('Mirror of Life Trapping (10,000 gp)', 'city'),
        item('Nature\'s Mantle (10,000 gp)', 'city'),
        item('Potion of Longevity (10,000 gp)', 'city'),
        item('Protective Verses (10,000 gp)', 'city'),
        item('Reveler\'s Concertina (10,000 gp)', 'city'),
        item('Rhythm-Maker\'s Drum +2 (10,000 gp)', 'city'),
        item('Ring of Fire Elemental Command (10,000 gp)', 'city'),
        item('Ring of Invisibility (10,000 gp)', 'city'),
        item('Ring of Shooting Stars (10,000 gp)', 'city'),
        item('Spell Scroll Level 7 (10,000 gp)', 'city'),
        item('Sphere of Annihilation (10,000 gp)', 'city'),
        item('Staff of Fire (10,000 gp)', 'city'),
        item('Staff of Healing (10,000 gp)', 'city'),
        item('Staff of Thunder and Lightning (10,000 gp)', 'city'),
        item('Sun Blade (10,000 gp)', 'city'),
        item('Vicious Weapon (10,000 gp)', 'city'),
        item('Wand of Fear (10,000 gp)', 'city'),
        item('Cloak of the Bat (11,000 gp)', 'city'),
        item('Portable Hole (11,000 gp)', 'city'),
        item('Sword of Life-Stealing (11,000 gp)', 'city'),
        item('Wand of Binding (11,000 gp)', 'city'),
        item('Armor of Resistance (12,000 gp)', 'city'),
        item('Chime of Opening (12,000 gp)', 'city'),
        item('Elven Chain (12,000 gp)', 'city'),
        item('Mace of Terror (12,000 gp)', 'city'),
        item('Mantle of Spell Resistance (12,000 gp)', 'city'),
        item('Quaal\'s Feather Token Swan Boat (12,000 gp)', 'city'),
        item('Ring of Evasion (12,000 gp)', 'city'),
        item('Staff of Withering (12,000 gp)', 'city'),
        item('Wings of Flying (12,000 gp)', 'city'),
        item('Weapon, +2 (12,500 gp)', 'city'),
        item('Arrow-Catching Shield (13,000 gp)', 'city'),
        item('Bracers of Defense (13,000 gp)', 'city'),
        item('Ioun Stone Reserve (13,000 gp)', 'city'),
        item('Onyx Dog (14,000 gp)', 'city'),
        item('Boots of Levitation (15,000 gp)', 'city'),
        item('Folding Boat (15,000 gp)', 'city'),
        item('Outer Essence Shard (15,000 gp)', 'city'),
        item('Robe of Eyes (15,000 gp)', 'city'),
        item('Wand of Lightning Bolts (15,000 gp)', 'city'),
        item('Gem of Seeing (18,000 gp)', 'city'),
        item('Potion of Supreme Healing (20,000 gp)', 'city'),
        item('All-Purpose Tool +3 (20,000 gp)', 'city'),
        item('Amulet of Proof Against Detection and Location (20,000 gp)', 'city'),
        item('Armor of Invulnerability (20,000 gp)', 'city'),
        item('Defender (20,000 gp)', 'city'),
        item('Efreeti Chain (20,000 gp)', 'city'),
        item('Hammer of Thunderbolts (20,000 gp)', 'city'),
        item('Ioun Stone Greater Absorption (20,000 gp)', 'city'),
        item('Ivory Goat (Terror) (20,000 gp)', 'city'),
        item('Moon Sickle +3 (20,000 gp)', 'city'),
        item('Periapt of Proof Against Poison (20,000 gp)', 'city'),
        item('Ring of Spell Storing (20,000 gp)', 'city'),
        item('Ring of Water Elemental Command (20,000 gp)', 'city'),
        item('Robe of Stars (20,000 gp)', 'city'),
        item('Rod of Alertness (20,000 gp)', 'city'),
        item('Rod of Rulership (20,000 gp)', 'city'),
        item('Sentinel Shield (20,000 gp)', 'city'),
        item('Spell Scroll Level 8 (20,000 gp)', 'city'),
        item('Staff of Striking (20,000 gp)', 'city'),
        item('Sword of Wounding (20,000 gp)', 'city'),
        item('Talisman of the Sphere (20,000 gp)', 'city'),
        item('Vorpal Sword (20,000 gp)', 'city'),
        item('Wand of Paralysis (20,000 gp)', 'city'),
        item('Absorbing Tattoo (25,000 gp)', 'metropolis'),
        item('Horseshoes of a Zephyr (27,000 gp)', 'metropolis'),
        item('Armor, +3 (30,000 gp)', 'metropolis'),
        item('Shield, +3 (30,000 gp)', 'metropolis'),
        item('Amulet of the Devout +3 (30,000 gp)', 'metropolis'),
        item('Arcane Grimoire +3 (30,000 gp)', 'metropolis'),
        item('Barrier Tattoo, Very Rare (30,000 gp)', 'metropolis'),
        item('Blood Fury Tattoo (30,000 gp)', 'metropolis'),
        item('Bloodwell Vial +3 (30,000 gp)', 'metropolis'),
        item('Crystalline Chronicle (30,000 gp)', 'metropolis'),
        item('Instrument of the Bards - Cli Lyre (30,000 gp)', 'metropolis'),
        item('Instrument of the Bards - Fochulan Bandlore (30,000 gp)', 'metropolis'),
        item('Instrument of the Bards - Mac-Fuirmidh Cittern (30,000 gp)', 'metropolis'),
        item('Ioun Stone Leadership (30,000 gp)', 'metropolis'),
        item('Prayer Bead - Favor (30,000 gp)', 'metropolis'),
        item('Rhythm-Maker\'s Drum +3 (30,000 gp)', 'metropolis'),
        item('Ring of Earth Elemental Command (30,000 gp)', 'metropolis'),
        item('Ring of Spell Turning (30,000 gp)', 'metropolis'),
        item('Rod of Lordly Might (30,000 gp)', 'metropolis'),
        item('Rod of Security (30,000 gp)', 'metropolis'),
        item('Scarab of Protection (30,000 gp)', 'metropolis'),
        item('Staff of Frost (30,000 gp)', 'metropolis'),
        item('Wand of Polymorph (30,000 gp)', 'metropolis'),
        item('Crystal Ball (32,500 gp)', 'metropolis'),
        item('Nolzur\'s Marvelous Pigments (32,500 gp)', 'metropolis'),
        item('Helm of Brilliance (33,000 gp)', 'metropolis'),
        item('Amulet of the Planes (35,000 gp)', 'metropolis'),
        item('Silver Horn of Valhalla (35,000 gp)', 'metropolis'),
        item('Sword of Sharpness (36,000 gp)', 'metropolis'),
        item('Brass Horn of Valhalla (38,000 gp)', 'metropolis'),
        item('Bronze Horn of Valhalla (40,000 gp)', 'metropolis'),
        item('Cubic Gate (40,000 gp)', 'metropolis'),
        item('Ring of Air Elemental Command (40,000 gp)', 'metropolis'),
        item('Robe of the Archmagi (40,000 gp)', 'metropolis'),
        item('Rod of Absorption (40,000 gp)', 'metropolis'),
        item('Spellguard Shield (40,000 gp)', 'metropolis'),
        item('Staff of the Woodlands (40,000 gp)', 'metropolis'),
        item('Sword of Answering (40,000 gp)', 'metropolis'),
        item('Wand of Fireballs (40,000 gp)', 'metropolis'),
        item('Wand of the War Mage +3 (40,000 gp)', 'metropolis'),
        item('Efreeti Bottle (45,000 gp)', 'metropolis'),
        item('Ioun Stone Intellect (45,000 gp)', 'metropolis'),
        item('Iron Horn of Valhalla (45,000 gp)', 'metropolis'),
        item('Ioun Stone Fortitude (50,000 gp)', 'metropolis'),
        item('Oathbow (50,000 gp)', 'metropolis'),
        item('Plate Armor of Etherealness (50,000 gp)', 'metropolis'),
        item('Spell Scroll Level 9 (50,000 gp)', 'metropolis'),
        item('Talisman of Ultimate Evil (50,000 gp)', 'metropolis'),
        item('Tome of leadership and influence (55,000 gp)', 'metropolis'),
        item('Weapon, +3 (60,000 gp)', 'metropolis'),
        item('Cloak of Displacement (60,000 gp)', 'metropolis'),
        item('Lyre of Building (60,000 gp)', 'metropolis'),
        item('Ring of Regeneration (60,000 gp)', 'metropolis'),
        item('Rod of the Pact Keeper +3 (60,000 gp)', 'metropolis'),
        item('Helm of Teleportation (70,000 gp)', 'metropolis'),
        item('Daern\'s Instant Fortress (80,000 gp)', 'metropolis'),
        item('Ring of Telekinesis (80,000 gp)', 'metropolis'),
        item('Illusionist\'s Bracers (90,000 gp)', 'metropolis'),
        item('Ioun Stone Mastery (100,000 gp)', 'metropolis'),
        item('Staff of Power (100,000 gp)', 'metropolis'),
        item('Talisman of Pure Good (100,000 gp)', 'metropolis'),
        item('Decanter of Endless Water (110,000 gp)', 'metropolis'),
        item('Instrument of the Bards - Ollamh Harp (110,000 gp)', 'metropolis'),
        item('Obsidian Steed (110,000 gp)', 'metropolis'),
        item('Prayer Bead - Wind Walking (120,000 gp)', 'metropolis'),
        item('Instrument of the Bards - Anstruth Harp (130,000 gp)', 'metropolis'),
        item('Prayer Bead - Summons (140,000 gp)', 'metropolis'),
        item('Cauldron of Rebirth (150,000 gp)', 'metropolis'),
        item('Cloak of Invisibility (150,000 gp)', 'metropolis'),
        item('Holy Avenger (190,000 gp)', 'metropolis'),
      ]
    },
    {
      id: 'arcane-shop',
      name: 'Arcane Shop',
      category: 'shop',
      defaultWealthTierId: 'upper',
      staffed: true,
      weight: 1,
      minSizeId: 'town',
      primaryAbility: 'int',
      secondaryAbility: 'wis',
      proficiencyPool: ['Arcana', 'History'],
      jobTitlePool: ['Apprentice', 'Scribe'],
      itemPool: [
        item('Spellbook (50 gp)', 'town'),
        item('Component pouch (25 gp)', 'town'),
        item('Arcane focus, crystal (10 gp)', 'hamlet'),
        item('Arcane focus, orb (20 gp)', 'city'),
        item('Arcane focus, rod (10 gp)', 'village'),
        item('Arcane focus, staff (5 gp)', 'hamlet'),
        item('Arcane focus, wand (10 gp)', 'hamlet'),
        item('Robes (1 gp)', 'village'),
        item('Spell scroll, common, cantrip (50 gp)', 'hamlet'),
        item('Spell scroll, common, 1st level (100 gp)', 'village'),
        item('Spell scroll, uncommon, 2nd level (250 gp)', 'town'),
        item('Spell scroll, uncommon, 3rd level (500 gp)', 'city'),
        item('Spell scroll, rare, 4th level (2,500 gp)', 'city'),
        item('Spell scroll, rare, 5th level (5,000 gp)', 'metropolis'),
        item('Magic appraisal / Identify (service, 100 gp)', 'town')
      ]
    },
    {
      id: 'black-market',
      name: 'Black Market',
      category: 'shop',
      defaultWealthTierId: 'lower',
      staffed: true,
      // Needs urban anonymity to plausibly exist at all — gated to city
      // instead of town like most other shops here.
      weight: 1,
      minSizeId: 'city',
      primaryAbility: 'cha',
      secondaryAbility: 'dex',
      proficiencyPool: ['Deception', 'Sleight of Hand'],
      jobTitlePool: ['Fence', 'Lookout'],
      itemPool: [
        item("Thieves' tools (25 gp)", 'hamlet'),
        item("Poisoner's kit (50 gp)", 'hamlet'),
        item('Forgery kit (15 gp)', 'village'),
        item('Acid, vial (25 gp)', 'town'),
        item('Antitoxin, vial (50 gp)', 'town'),
        item('Caltrops, bag of 20 (1 gp)', 'town'),
        item('Poison, basic, vial (100 gp)', 'town'),
        item('Disguise kit (25 gp)', 'town'),
        item('Clothes, costume (5 gp)', 'city'),
        item('Manacles (2 gp)', 'city'),
        item('Portable ram (4 gp)', 'city'),
        item('Iron spikes, 10 (1 gp)', 'city')
      ]
    },
    {
      id: 'tattoo-shop',
      name: 'Tattoo Shop',
      category: 'shop',
      defaultWealthTierId: 'upper',
      staffed: true,
      weight: 1,
      minSizeId: 'town',
      primaryAbility: 'dex',
      secondaryAbility: 'cha',
      proficiencyPool: ["Tattooist's Tools", 'Persuasion'],
      jobTitlePool: ['Apprentice', 'Ink Mixer'],
      // Every entry here is a magical/service tattoo, not a plain decorative
      // one — prices straight from the catalog's Tattoo Shop table.
      itemPool: [
        item('Temporary ink, small (service, 50 gp)', 'hamlet'),
        item('Mark of the Anchor (service, 1,000 gp)', 'village'),
        item("Owner's Mark (service, 2,000 gp)", 'hamlet'),
        item('Mark of Melee (service, 2,000 gp)', 'village'),
        item('Venom Ward (service, 2,000 gp)', 'village'),
        item('Scar of Bravery (service, 2,000 gp)', 'village'),
        item('Eye of Darkvision (service, 2,000 gp)', 'town'),
        item('All Seeing Eye (service, 2,000 gp)', 'town'),
        item('Mark of Elvenkind (service, 4,000 gp)', 'town'),
        item('Tattoo of Luck (service, 4,000 gp)', 'town'),
        item('Mark of the Healer (service, 8,000 gp)', 'city'),
        item('Fortress Tattoo (service, 8,000 gp)', 'city'),
        item('Tattoo of Warding (service, 8,000 gp)', 'city'),
        item('Mark of the Death Walker (service, 16,000 gp)', 'metropolis'),
        item('Spirit of the Animal (service, 16,000 gp)', 'metropolis'),
        item('Wings of Ink (service, 16,000 gp)', 'metropolis')
      ]
    },
    // Civic
    // maxInstances: 1 — a settlement has exactly one seat of government,
    // never several Town Halls regardless of population/weight.
    { id: 'town-hall', name: 'Town Hall', category: 'civic', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'town', maxInstances: 1, primaryAbility: 'cha', secondaryAbility: 'wis', proficiencyPool: ['Persuasion', 'Insight'], jobTitlePool: ['Clerk', 'Scribe', 'Deputy'], notableTitle: 'Mayor', itemPool: noItems },
    { id: 'guard-house', name: 'Guard House', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'village', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ['Athletics', 'Intimidation'], jobTitlePool: ['Guard', 'Watch Recruit'], notableTitle: 'Captain of the Guard', itemPool: noItems },
    { id: 'guildhall', name: 'Guildhall', category: 'civic', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'cha', secondaryAbility: 'int', proficiencyPool: ['Persuasion', 'History'], jobTitlePool: ['Clerk', 'Aide'], notableTitle: 'Guildmaster', itemPool: noItems },
    { id: 'warehouse', name: 'Warehouse', category: 'civic', defaultWealthTierId: 'middle', staffed: false, weight: 2, minSizeId: 'village', ...none },
    { id: 'docks', name: 'Docks', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'village', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ['Athletics', "Navigator's Tools"], jobTitlePool: ['Dockhand', 'Loader'], notableTitle: 'Harbormaster', itemPool: noItems },
    { id: 'mine', name: 'Mine', category: 'civic', defaultWealthTierId: 'lower', staffed: true, weight: 1, minSizeId: 'village', primaryAbility: 'con', secondaryAbility: 'str', proficiencyPool: ["Mason's Tools", 'Athletics'], jobTitlePool: ['Miner', 'Cart Runner'], notableTitle: 'Mine Foreman', itemPool: noItems },
    { id: 'barracks', name: 'Barracks', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'str', secondaryAbility: 'con', proficiencyPool: ['Athletics', 'Intimidation'], jobTitlePool: ['Soldier', 'Recruit'], notableTitle: 'Garrison Captain', itemPool: noItems },
    // Added for the Entertainment/University districts (see
    // defaultDistrictsForSize below) — these needed something to boost.
    { id: 'theater', name: 'Theater', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'cha', secondaryAbility: 'dex', proficiencyPool: ['Performance', 'Persuasion'], jobTitlePool: ['Stagehand', 'Usher'], notableTitle: 'Theater Director', itemPool: noItems },
    { id: 'school', name: 'School', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'wis', secondaryAbility: 'int', proficiencyPool: ['Insight', 'History'], jobTitlePool: ['Tutor', 'Groundskeeper'], notableTitle: 'Headmaster', itemPool: noItems },
    { id: 'university', name: 'University', category: 'civic', defaultWealthTierId: 'upper', staffed: true, weight: 1, minSizeId: 'city', primaryAbility: 'int', secondaryAbility: 'wis', proficiencyPool: ['Arcana', 'History', 'Investigation'], jobTitlePool: ['Lecturer', 'Research Assistant'], notableTitle: 'Dean', itemPool: noItems },
    { id: 'library', name: 'Library', category: 'civic', defaultWealthTierId: 'middle', staffed: true, weight: 1, minSizeId: 'town', primaryAbility: 'int', secondaryAbility: 'wis', proficiencyPool: ['History', 'Investigation'], jobTitlePool: ['Archivist', 'Page'], notableTitle: 'Head Librarian', itemPool: noItems },
    // Religious
    { id: 'temple', name: 'Temple', category: 'religious', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'village', primaryAbility: 'wis', secondaryAbility: 'cha', proficiencyPool: ['Religion', 'Medicine', 'Insight'], jobTitlePool: ['Acolyte', 'Novice'], notableTitle: 'High Priest', itemPool: [
      item('Blessing (service)', 'hamlet'), item('Prayer candle', 'hamlet'),
      item('Holy water vial', 'village'), item('Healing rites (service)', 'village'),
      item('Consecrated relic replica', 'town'),
      item('Genuine minor relic', 'city'),
      item('Alms box (5 gp)', 'village'),
      item('Book of scripture (25 gp)', 'town'),
      item('Censer (5 gp)', 'village'),
      item('Healer\'s kit (5 gp)', 'town'),
      item('Holy symbol, amulet (5 gp)', 'hamlet'),
      item('Holy water, flask (25 gp)', 'hamlet'),
      item('Incense, 1 block (1 cp)', 'village'),
      item('Cure Wounds, 1st level (service, 10 gp)', 'hamlet'),
      item('Gentle Repose, 2nd level (service, 50 gp)', 'village'),
      item('Lesser Restoration, 2nd level (service, 50 gp)', 'hamlet'),
      item('Remove Curse, 3rd level (service, 100 gp)', 'village'),
      item('Revivify, 3rd level (service, 400 gp)', 'village'),
      item('Raise Dead, 5th level (service, 1,000 gp)', 'town'),
    ] },
    { id: 'shrine', name: 'Shrine', category: 'religious', defaultWealthTierId: 'lower', staffed: true, weight: 1, minSizeId: 'hamlet', primaryAbility: 'wis', secondaryAbility: 'cha', proficiencyPool: ['Religion', 'Insight'], jobTitlePool: ['Caretaker'], notableTitle: 'Shrine Keeper', itemPool: [
      item('Offering candle', 'hamlet'), item('Small carved idol', 'hamlet'), item('Quiet blessing (service)', 'hamlet'),
      item("Pilgrim's token", 'village'),
      item('Alms box (5 gp)', 'village'),
      item('Holy water, flask (25 gp)', 'village'),
      item('Incense, 1 block (1 cp)', 'hamlet'),
      item('Cure Wounds, 1st level (service, 10 gp)', 'hamlet'),
    ] },
    // Tavern
    { id: 'tavern', name: 'Tavern', category: 'tavern', defaultWealthTierId: 'middle', staffed: true, weight: 3, minSizeId: 'village', primaryAbility: 'cha', secondaryAbility: 'con', proficiencyPool: ['Performance', 'Persuasion', 'Insight'], jobTitlePool: ['Server', 'Cook', 'Bartender'], notableTitle: 'Proprietor', itemPool: [
      item('Mug of ale', 'hamlet'), item('Hot meal', 'hamlet'),
      item('Private table (service)', 'village'),
      item('Live music tonight (service)', 'town'),
      item('Reserved private room (service)', 'city'),
      item('Ham and cheese on rye (5 cp)', 'hamlet'),
      item('Bacon and egg sandwich (3 sp)', 'village'),
      item('Stockpot stew (4 cp)', 'hamlet'),
      item('Roast lamb and cheese (4 sp)', 'village'),
      item('Grilled salmon (6 sp)', 'village'),
      item('Rack of lamb (2 gp)', 'city'),
      item('Dragon turtle soup (4 gp)', 'metropolis'),
    ] },
    { id: 'inn', name: 'Inn', category: 'tavern', defaultWealthTierId: 'middle', staffed: true, weight: 2, minSizeId: 'town', primaryAbility: 'cha', secondaryAbility: 'wis', proficiencyPool: ['Persuasion', 'Insight'], jobTitlePool: ['Server', 'Stablehand', 'Housekeeper'], notableTitle: 'Innkeeper', itemPool: [
      item('A bed for the night (service)', 'village'), item('Hot bath (service)', 'village'),
      item('Stabling included (service)', 'town'),
      item('Private suite (service)', 'city'), item('The finest room in the house (service)', 'metropolis'),
      item('Room, commoner (poor) (2 sp)', 'hamlet'),
      item('Room, modest (1 gp)', 'village'),
      item('Room, merchant (comfortable) (2 gp)', 'town'),
      item('Room, wealthy (4 gp)', 'city'),
      item('Room, noble (aristocratic) (10 gp)', 'metropolis'),
    ] }
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
