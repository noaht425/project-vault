import { z } from 'zod'

// Deliberately not part of NoteTemplate/CREATABLE_NOTE_KINDS (see
// noteTemplateDefaults.ts) — that list is shared with the local vault's
// note creation, and a "map" note only makes sense in the Cloud Workspace
// (MapSheet talks to window.cloudApi directly for image storage). Map notes
// get their own dedicated creation entry point in CloudFileTree.tsx instead.

const pointSchema = z.object({ x: z.number(), y: z.number() })

const mapImageSchema = z.object({
  path: z.string(),
  width: z.number(),
  height: z.number()
})

const mapScaleSchema = z.object({
  pixelDistance: z.number(),
  realDistance: z.number(),
  unit: z.string().catch('miles')
})

export const terrainTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().catch('#4caf6e'),
  // Multiplies a travel mode's base speed while crossing this terrain — 1 is
  // normal, <1 slower, >1 faster, 0 impassable (see mapGeometry.calculateTrip).
  speedMultiplier: z.coerce.number().catch(1)
})

export const mapZoneSchema = z.object({
  id: z.string(),
  terrainTypeId: z.string(),
  // Simple single-ring polygon — no holes, no multi-part regions (v1).
  points: z.array(pointSchema)
})

// Same shape as a terrain type, kept as a separate name/pool since lines
// (roads, paths, rivers) and zones (painted regions) are two distinct
// concepts to the user, with their own dropdown/editor UI — a road isn't a
// "terrain" you'd paint as a region, and a mountain range isn't a line you'd
// trace. Reusing the schema shape, not the list, avoids duplicating the
// {id, name, color, speedMultiplier} definition.
export const lineTypeSchema = terrainTypeSchema

export const mapLineSchema = z.object({
  id: z.string(),
  lineTypeId: z.string(),
  // An open polyline (not closed like a zone) — a road, path, or river.
  points: z.array(pointSchema),
  // How wide a corridor around this line counts as "on/crossing it", in map
  // image pixels — judge it by eye against the map's own detail level.
  widthPixels: z.coerce.number().catch(20)
})

export const mapPinSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  // References a location note by title, matching this app's existing
  // [[wiki-link]] convention (see FamilyTreeSheet) rather than an id-based
  // scheme that doesn't exist anywhere else in the codebase. Null for a
  // freehand pin with no linked note — old pins (from before freehand pins
  // existed) always have this set, so they need no migration here.
  locationTitle: z.string().nullable().catch(null),
  // Display text for a freehand pin (locationTitle === null) — unused/empty
  // when locationTitle is set, since the linked note's own title is shown
  // instead. See pinDisplayLabel() below.
  label: z.string().catch('')
})

export function pinDisplayLabel(pin: { locationTitle: string | null; label: string }): string {
  return pin.locationTitle ?? pin.label
}

export const mapFrontmatterSchema = z
  .object({
    type: z.literal('map'),
    tags: z.array(z.string()).catch([]),
    summary: z.string().catch(''),
    image: mapImageSchema.nullable().catch(null),
    scale: mapScaleSchema.nullable().catch(null),
    terrainTypes: z.array(terrainTypeSchema).catch([]),
    lineTypes: z.array(lineTypeSchema).catch([]),
    zones: z.array(mapZoneSchema).catch([]),
    lines: z.array(mapLineSchema).catch([]),
    pins: z.array(mapPinSchema).catch([])
  })
  .passthrough()

export type MapFrontmatter = z.infer<typeof mapFrontmatterSchema>
export type MapImage = z.infer<typeof mapImageSchema>
export type MapScale = z.infer<typeof mapScaleSchema>
export type TerrainType = z.infer<typeof terrainTypeSchema>
export type LineType = z.infer<typeof lineTypeSchema>
export type MapZone = z.infer<typeof mapZoneSchema>
export type MapLine = z.infer<typeof mapLineSchema>
export type MapPin = z.infer<typeof mapPinSchema>

// Seeded on every new map — generic real-world-ish starting points, not
// tied to any specific published ruleset (same spirit as
// travelModes.ts's DEFAULT_TRAVEL_MODES). Multipliers are relative to a
// travel mode's normal (1x) speed.
export function defaultTerrainTypes(): TerrainType[] {
  return [
    { id: 'mountains', name: 'Mountains', color: '#8a7a6d', speedMultiplier: 0.33 },
    { id: 'forest', name: 'Forest', color: '#3f7a4e', speedMultiplier: 0.5 }
  ]
}

// Roads/paths/rivers are thin, winding features that are impractical to
// paint as a filled region — see mapGeometry.ts's zonesIncludingLines for
// how a drawn line still factors into the same distance/time math as a zone.
export function defaultLineTypes(): LineType[] {
  return [
    { id: 'road', name: 'Road', color: '#c9a24d', speedMultiplier: 1.5 },
    { id: 'path', name: 'Path', color: '#a68a5b', speedMultiplier: 1.2 },
    // ~5x slower — assumes fording on foot. Flip above 1x instead if a
    // river represents traveling *by boat along* it rather than crossing
    // it, or set to 0 to make it a hard barrier without a bridge/boat.
    { id: 'river', name: 'River', color: '#3c8fe0', speedMultiplier: 0.2 }
  ]
}

export function defaultMapFrontmatter(): MapFrontmatter {
  return mapFrontmatterSchema.parse({ type: 'map', terrainTypes: defaultTerrainTypes(), lineTypes: defaultLineTypes() })
}
