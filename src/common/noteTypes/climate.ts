import { z } from 'zod'

// A climate note defines seasonal weather for one calendar (see
// noteTypes/calendar.ts), reused by any number of location/settlement notes
// via their own optional `climateNoteTitle` field — same "note holds a
// reusable definition, other notes reference it by title" convention this
// app already uses for calendar notes themselves (see EventStructuredDate's
// calendarNoteTitle). Kept as its own note type, not folded into the
// calendar note, because the whole point is per-region variation: two
// climates ("Arctic tundra" vs. "Tropical coast") can share the same
// calendar's months while rolling completely different weather.

export const weatherConditionSchema = z.object({
  id: z.string(),
  name: z.string(), // e.g. "Clear skies", "Light rain", "Blizzard"
  // Relative frequency within its season — same weighted-pool concept as
  // settlement.ts's itemPool/proficiencyPool, just for weather instead of
  // goods/skills.
  weight: z.coerce.number().catch(1)
})
export type WeatherCondition = z.infer<typeof weatherConditionSchema>

export const climateSeasonSchema = z.object({
  id: z.string(),
  name: z.string(), // e.g. "Winter"
  // Which of the referenced calendar's months belong to this season —
  // explicit membership, not a start/end range, since a custom calendar's
  // months aren't guaranteed to be in a simple contiguous "spring order."
  monthIds: z.array(z.string()).catch([]),
  conditions: z.array(weatherConditionSchema).catch([])
})
export type ClimateSeason = z.infer<typeof climateSeasonSchema>

export const climateFrontmatterSchema = z
  .object({
    type: z.literal('climate'),
    tags: z.array(z.string()).catch([]),
    summary: z.string().catch(''),
    // A calendar note's title — same convention as EventStructuredDate's
    // calendarNoteTitle. Empty until the user picks one; seasons are
    // meaningless without a calendar to resolve month ids against.
    calendarNoteTitle: z.string().catch(''),
    seasons: z.array(climateSeasonSchema).catch([]),
    // One of mapGeneration/climate.ts's fixed BiomeId values (e.g.
    // 'desert', 'tundra') — optional, null until set. Kept as a plain
    // string here (not an imported literal union) so this note-types
    // module doesn't depend on the map generation lib, same "resolved by
    // lookup, not an enum" convention as terrainTypeId/climateTypeId
    // elsewhere in noteTypes/map.ts. Lets a settlement/kingdom's own
    // already-researched climate note act as a ground-truth anchor when
    // the map's own procedural climate layer is generated near it — every
    // existing climate note has this null, with zero effect until a map
    // generation run actually resolves a pin to it.
    biomeId: z.string().nullable().catch(null)
  })
  .passthrough()

export type ClimateFrontmatter = z.infer<typeof climateFrontmatterSchema>

export function defaultClimateFrontmatter(): ClimateFrontmatter {
  return climateFrontmatterSchema.parse({ type: 'climate' })
}
