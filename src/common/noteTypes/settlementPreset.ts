import { z } from 'zod'
import {
  districtSchema,
  raceShareSchema,
  customRaceDefSchema,
  raceLifeStageSchema,
  wealthTierSchema,
  religionShareSchema,
  genderShareSchema,
  buildingTypeDefSchema,
  specialtyDefSchema,
  defaultDistricts,
  defaultRaceLifeStages,
  defaultWealthTiers,
  defaultBuildingTypes,
  defaultSpecialties,
  defaultGenderDistribution,
  type SettlementFrontmatter
} from './settlement'

// Holds exactly the Settlement Setup tab's generation-INPUT fields (see
// SettlementSetupTab.tsx) — everything except summary/climateNoteTitle
// (per-settlement flavor, not a reusable "kind of settlement" trait) and,
// obviously, buildings/residents (generated output, never an input). Saved
// from one settlement's current Setup tab via "Save as preset", then
// applied to prefill another settlement's Setup tab via "Apply preset" — a
// preset is its own note (not a setting buried in app config) so it can be
// named, browsed, renamed, and reused like anything else in the vault, and
// gets Cloud Workspace parity for free the same way Map/Settlement did.
export const settlementPresetFrontmatterSchema = z
  .object({
    type: z.literal('settlement-preset'),
    tags: z.array(z.string()).catch([]),
    summary: z.string().catch(''),
    sizeId: z.string().catch('village'),
    targetPopulation: z.coerce.number().catch(300),
    districts: z.array(districtSchema).catch(() => defaultDistricts()),
    raceDistribution: z.array(raceShareSchema).catch([]),
    customRaces: z.array(customRaceDefSchema).catch([]),
    raceLifeStages: z.array(raceLifeStageSchema).catch(() => defaultRaceLifeStages()),
    wealthTiers: z.array(wealthTierSchema).catch(() => defaultWealthTiers()),
    religionDistribution: z.array(religionShareSchema).catch([]),
    genderDistribution: z.array(genderShareSchema).catch(() => defaultGenderDistribution()),
    buildingTypes: z.array(buildingTypeDefSchema).catch(() => defaultBuildingTypes()),
    specialties: z.array(specialtyDefSchema).catch(() => defaultSpecialties()),
    activeSpecialtyIds: z.array(z.string()).catch([]),
    religiousWorkerMultiplier: z.coerce.number().catch(1),
    religiousPracticePercent: z.coerce.number().catch(90),
    customEducation: z.boolean().catch(false),
    educatedWealthTierIds: z.array(z.string()).catch([])
  })
  .passthrough()

export type SettlementPresetFrontmatter = z.infer<typeof settlementPresetFrontmatterSchema>

export function defaultSettlementPresetFrontmatter(): SettlementPresetFrontmatter {
  return settlementPresetFrontmatterSchema.parse({ type: 'settlement-preset' })
}

export type SettlementPresetFields = Pick<
  SettlementFrontmatter,
  | 'sizeId'
  | 'targetPopulation'
  | 'districts'
  | 'raceDistribution'
  | 'customRaces'
  | 'raceLifeStages'
  | 'wealthTiers'
  | 'religionDistribution'
  | 'genderDistribution'
  | 'buildingTypes'
  | 'specialties'
  | 'activeSpecialtyIds'
  | 'religiousWorkerMultiplier'
  | 'religiousPracticePercent'
  | 'customEducation'
  | 'educatedWealthTierIds'
>

/** Pulls just the reusable Setup-tab fields out of a real settlement's frontmatter — the "Save as preset" action's job. */
export function extractPresetFields(data: SettlementFrontmatter): SettlementPresetFields {
  return {
    sizeId: data.sizeId,
    targetPopulation: data.targetPopulation,
    districts: data.districts,
    raceDistribution: data.raceDistribution,
    customRaces: data.customRaces,
    raceLifeStages: data.raceLifeStages,
    wealthTiers: data.wealthTiers,
    religionDistribution: data.religionDistribution,
    genderDistribution: data.genderDistribution,
    buildingTypes: data.buildingTypes,
    specialties: data.specialties,
    activeSpecialtyIds: data.activeSpecialtyIds,
    religiousWorkerMultiplier: data.religiousWorkerMultiplier,
    religiousPracticePercent: data.religiousPracticePercent,
    customEducation: data.customEducation,
    educatedWealthTierIds: data.educatedWealthTierIds
  }
}

/** Same extraction, from a saved preset note's own frontmatter — the "Apply preset" action's job, prefilling another settlement's Setup tab. */
export function presetFieldsFromPreset(preset: SettlementPresetFrontmatter): SettlementPresetFields {
  return {
    sizeId: preset.sizeId,
    targetPopulation: preset.targetPopulation,
    districts: preset.districts,
    raceDistribution: preset.raceDistribution,
    customRaces: preset.customRaces,
    raceLifeStages: preset.raceLifeStages,
    wealthTiers: preset.wealthTiers,
    religionDistribution: preset.religionDistribution,
    genderDistribution: preset.genderDistribution,
    buildingTypes: preset.buildingTypes,
    specialties: preset.specialties,
    activeSpecialtyIds: preset.activeSpecialtyIds,
    religiousWorkerMultiplier: preset.religiousWorkerMultiplier,
    religiousPracticePercent: preset.religiousPracticePercent,
    customEducation: preset.customEducation,
    educatedWealthTierIds: preset.educatedWealthTierIds
  }
}
