import { useEffect, useState } from 'react'
import { z } from 'zod'
import { generateTerrain, generateRivers, generateClimate, generateCivilizations, generateRoads } from '../../../../common/mapGeneration/generateMap'
import { BIOME_DEFINITIONS, type ClimateAnchor, type WindDirection } from '../../../../common/mapGeneration/climate'
import { defaultLineTypes, defaultMapFrontmatter, defaultTerrainTypes, type LineType, type MapFrontmatter, type MapLandmass, type MapPin, type TerrainType } from '../../../../common/noteTypes/map'
import { generatePlaceName, resolvePlaceNameStyle, PLACE_NAME_STYLES } from '../../../../common/placeNames'
import { boundingBoxOf, deriveEquatorY, deriveScaleFromLatitudeSpan, latitudeRadiansAt, pointInPolygon, polygonCentroid, type Point } from '../../../../common/mapGeometry'
import { hashSeed } from '../../../../common/rng'
import type { NoteRefApi } from '../../lib/noteRefApi'

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000)
}

// Finds this map's "Mountains" terrain type by id first (matches
// defaultTerrainTypes()'s seeded id, the common case), falling back to a
// case-insensitive name match (covers a map whose seeded type was
// recreated under a different id), and only creates a new one if neither
// is found — never silently duplicates a terrain type the user already has.
function resolveMountainTerrainType(terrainTypes: TerrainType[]): { id: string; newType: TerrainType | null } {
  const byId = terrainTypes.find((t) => t.id === 'mountains')
  if (byId) return { id: byId.id, newType: null }
  const byName = terrainTypes.find((t) => t.name.trim().toLowerCase() === 'mountains')
  if (byName) return { id: byName.id, newType: null }
  const seeded = defaultTerrainTypes().find((t) => t.id === 'mountains')!
  return { id: seeded.id, newType: seeded }
}

// Same resolution strategy as resolveMountainTerrainType, for the "River"
// line type instead.
function resolveRiverLineType(lineTypes: LineType[]): { id: string; newType: LineType | null } {
  const byId = lineTypes.find((t) => t.id === 'river')
  if (byId) return { id: byId.id, newType: null }
  const byName = lineTypes.find((t) => t.name.trim().toLowerCase() === 'river')
  if (byName) return { id: byName.id, newType: null }
  const seeded = defaultLineTypes().find((t) => t.id === 'river')!
  return { id: seeded.id, newType: seeded }
}

// Same resolution strategy again, for the "Road" line type.
function resolveRoadLineType(lineTypes: LineType[]): { id: string; newType: LineType | null } {
  const byId = lineTypes.find((t) => t.id === 'road')
  if (byId) return { id: byId.id, newType: null }
  const byName = lineTypes.find((t) => t.name.trim().toLowerCase() === 'road')
  if (byName) return { id: byName.id, newType: null }
  const seeded = defaultLineTypes().find((t) => t.id === 'road')!
  return { id: seeded.id, newType: seeded }
}

const WIND_DIRECTIONS: WindDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

const KNOWN_BIOME_IDS = new Set<string>(BIOME_DEFINITIONS.map((b) => b.id))

// A Location or Settlement note's own climateNoteTitle field — read via a
// minimal passthrough schema (not the full location/settlement frontmatter
// schema) since only this one field is needed and a pin's linked note
// could be either type.
const placeClimateRefSchema = z.object({ climateNoteTitle: z.string().nullable().catch(null) }).passthrough()

// Climate anchors: resolves every pin already linked to a real note,
// follows its climateNoteTitle to a climate note, and reads that note's own
// biomeId (see noteTypes/climate.ts) — a settlement/kingdom whose climate
// the user already researched becomes a ground-truth point the procedural
// climate generator blends toward (see mapGeneration/climate.ts's
// blendTowardAnchors) instead of picking one at random. A pin with no
// linked note, a note with no climateNoteTitle, or a climate note with no
// biomeId set simply contributes no anchor — this is opt-in per pin, with
// zero effect on a map that doesn't use it.
async function resolveClimateAnchors(pins: MapPin[], noteRefApi: NoteRefApi): Promise<ClimateAnchor[]> {
  const anchors: ClimateAnchor[] = []
  for (const pin of pins) {
    if (!pin.locationTitle) continue
    const placeFrontmatter = await noteRefApi.readFrontmatterByTitle(pin.locationTitle).catch(() => null)
    if (!placeFrontmatter) continue
    const parsedPlace = placeClimateRefSchema.safeParse(placeFrontmatter)
    const climateNoteTitle = parsedPlace.success ? parsedPlace.data.climateNoteTitle : null
    if (!climateNoteTitle) continue
    const climateFrontmatter = await noteRefApi.readFrontmatterByTitle(climateNoteTitle, 'climate').catch(() => null)
    if (!climateFrontmatter) continue
    const biomeId = typeof climateFrontmatter.biomeId === 'string' ? climateFrontmatter.biomeId : null
    if (!biomeId || !KNOWN_BIOME_IDS.has(biomeId)) continue
    anchors.push({ x: pin.x, y: pin.y, biomeId: biomeId as ClimateAnchor['biomeId'] })
  }
  return anchors
}

// Whether a previously-generated shape (given as its own points, zone/
// landmass/territory polygon or line) should be treated as "inside the area
// this run is regenerating" and therefore replaceable. No active mask means
// the whole canvas is in scope — the original, pre-Phase-5 behavior (every
// generated entry of the right kind gets replaced). With a mask, only
// entries whose representative point (a plain average — see
// mapGeometry.ts's polygonCentroid) falls inside it are in scope; anything
// generated OUTSIDE the mask is left alone, which is what makes "augment
// just this region" actually non-destructive toward previously generated
// content elsewhere on the map, not just toward hand-drawn content.
function isInScope(points: Point[], boundaryMask: Point[] | null): boolean {
  if (!boundaryMask) return true
  return pointInPolygon(polygonCentroid(points), boundaryMask)
}

export function MapGenerationPanel({
  data,
  noteName,
  workingDims,
  updateFrontmatter,
  noteRefApi,
  boundarySource,
  setBoundarySource,
  selectedLandmassId,
  setSelectedLandmassId,
  activeBoundaryMask,
  onStartDrawingRegion,
  onClearCustomRegion
}: {
  data: MapFrontmatter
  // This map's own title — see MapSheet.tsx's comment on the same prop.
  // Used here for Phase 6 (multi-scale drilldown): stamping a created
  // child map's generation.parentMapTitle, and looking up this map's own
  // parent/children by title.
  noteName: string
  workingDims: { width: number; height: number } | null
  updateFrontmatter: (patch: Record<string, unknown>) => void
  noteRefApi: NoteRefApi
  // Phase 5 (augment/drilldown boundary) — owned by MapSheet since custom
  // region selection needs to drive its own `mode`/MapCanvas, same as every
  // other draw-a-shape flow's state. This panel just consumes the resolved
  // mask and renders the picker UI for it.
  boundarySource: 'whole-map' | 'landmass' | 'custom'
  setBoundarySource: (source: 'whole-map' | 'landmass' | 'custom') => void
  selectedLandmassId: string | null
  setSelectedLandmassId: (id: string | null) => void
  activeBoundaryMask: Point[] | null
  onStartDrawingRegion: () => void
  onClearCustomRegion: () => void
}): React.JSX.Element {
  const savedParams = (data.generation?.params ?? {}) as Record<string, number | string>
  const [seed, setSeed] = useState(data.generation?.seed ?? randomSeed())

  const [landmassScale, setLandmassScale] = useState(Number(savedParams.landmassScale ?? 0.35))
  const [seaLevel, setSeaLevel] = useState(Number(savedParams.seaLevel ?? 0.5))
  const [mountainDensity, setMountainDensity] = useState(Number(savedParams.mountainDensity ?? 0.35))
  const [mountainRuggedness, setMountainRuggedness] = useState(Number(savedParams.mountainRuggedness ?? 0.5))
  // "This map is a whole world" (see mapGeneration/elevation.ts's
  // edgesAreOcean/continentCount) — off by default so every map generated
  // before this existed keeps behaving exactly as it always has (land can
  // run off any edge, appropriate for a map depicting just a cropped
  // section of a larger landmass).
  const [edgesAreOcean, setEdgesAreOcean] = useState(Boolean(savedParams.edgesAreOcean ?? false))
  const [continentCount, setContinentCount] = useState(Number(savedParams.continentCount ?? 1))
  const [generatingTerrain, setGeneratingTerrain] = useState(false)

  const [riverDensity, setRiverDensity] = useState(Number(savedParams.riverDensity ?? 0.5))
  const [generatingRivers, setGeneratingRivers] = useState(false)

  const [moistureScale, setMoistureScale] = useState(Number(savedParams.moistureScale ?? 0.4))
  const [prevailingWindDirection, setPrevailingWindDirection] = useState<WindDirection>((savedParams.prevailingWindDirection as WindDirection) ?? 'W')
  const [anchorRadiusFraction, setAnchorRadiusFraction] = useState(Number(savedParams.anchorRadiusFraction ?? 0.15))
  const [generatingClimate, setGeneratingClimate] = useState(false)
  const [climateAnchorError, setClimateAnchorError] = useState<string | null>(null)

  const [civilizationCount, setCivilizationCount] = useState(Number(savedParams.civilizationCount ?? 3))
  const [settlementCount, setSettlementCount] = useState(Number(savedParams.settlementCount ?? 9))
  const [generatingCivilizations, setGeneratingCivilizations] = useState(false)

  const [roadDensity, setRoadDensity] = useState(Number(savedParams.roadDensity ?? 0.3))
  const [generatingRoads, setGeneratingRoads] = useState(false)

  // Settlement-preset notes, for assigning a civilization "flavor" to a
  // generated territory — see settlementPreset.ts: a civilization here is
  // just a name, a shape, and which preset note its cities should draw
  // from, not a second parallel schema. Fetched once territories actually
  // exist to assign one to.
  const [presetTitles, setPresetTitles] = useState<string[]>([])
  useEffect(() => {
    if (data.territories.length === 0) return
    let cancelled = false
    noteRefApi
      .searchTitles('', 'settlement-preset')
      .then((matches) => !cancelled && setPresetTitles(matches.map((m) => m.title)))
      .catch(() => !cancelled && setPresetTitles([]))
    return () => {
      cancelled = true
    }
  }, [data.territories.length, noteRefApi])

  // Phase 6 (multi-scale drilldown) — this map's own children, found by
  // their generation.parentMapTitle pointing back at noteName. There's no
  // frontmatter query support in the local vault's SQLite index (only
  // path/title/type/mtime — see db.ts), unlike the cloud app's Postgres
  // jsonb filter, so this lists every map note and reads each one's own
  // frontmatter to check — an O(n) scan acceptable for a personal vault's
  // map-note count. Refetches whenever a new child is created below.
  const [childMaps, setChildMaps] = useState<string[]>([])
  const [childMapsRefreshKey, setChildMapsRefreshKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      const all = await noteRefApi.searchTitles('', 'map').catch(() => [])
      const matches: string[] = []
      for (const { title } of all) {
        if (title.toLowerCase() === noteName.toLowerCase()) continue
        const fm = await noteRefApi.readFrontmatterByTitle(title, 'map').catch(() => null)
        const parentTitle = (fm?.generation as { parentMapTitle?: string | null } | null | undefined)?.parentMapTitle
        if (parentTitle && parentTitle.toLowerCase() === noteName.toLowerCase()) matches.push(title)
      }
      if (!cancelled) setChildMaps(matches)
    })()
    return () => {
      cancelled = true
    }
  }, [noteName, noteRefApi, childMapsRefreshKey])

  // This map's own parent, resolved by title (data.generation.parentMapTitle)
  // — just an existence check (searchTitles + exact match), since
  // noteRefApi.openByTitle re-resolves the title itself when the link is
  // clicked. No reset branch for the no-parent case, same reasoning as
  // presetTitles above — parentMapExists is only ever rendered alongside a
  // truthy parentMapTitle.
  const [parentMapExists, setParentMapExists] = useState(false)
  const parentMapTitle = data.generation?.parentMapTitle ?? null
  useEffect(() => {
    if (!parentMapTitle) return
    let cancelled = false
    noteRefApi
      .searchTitles(parentMapTitle, 'map')
      .then((matches) => !cancelled && setParentMapExists(matches.some((m) => m.title.toLowerCase() === parentMapTitle.toLowerCase())))
      .catch(() => !cancelled && setParentMapExists(false))
    return () => {
      cancelled = true
    }
  }, [parentMapTitle, noteRefApi])

  const [detailMultiplier, setDetailMultiplier] = useState(2)
  const [creatingChildMap, setCreatingChildMap] = useState(false)
  const [childMapError, setChildMapError] = useState<string | null>(null)

  // "Create child map" (map generation plan, Phase 6): spins the currently
  // selected boundary (a landmass or a custom drawn region — same mask
  // every "Generate ___" action above already respects, see design decision
  // #6) off into a brand-new Map note, pre-seeded with that boundary
  // reprojected into the child's own local coordinate space as a fixed
  // (non-generated) landmass — the coastline every generator on the child
  // map must then respect, exactly like an augmented region's boundary mask
  // does on this map. detailMultiplier upscales the child's canvas beyond a
  // literal 1:1 crop, so drilling in actually buys more pixels (and thus
  // room for finer detail) for the same real-world area, not just the same
  // pixels re-framed.
  const createChildMap = async (): Promise<void> => {
    if (!activeBoundaryMask || !workingDims) return
    const bbox = boundingBoxOf(activeBoundaryMask)
    if (bbox.width <= 0 || bbox.height <= 0) {
      setChildMapError('Selected boundary has no area.')
      return
    }
    setCreatingChildMap(true)
    setChildMapError(null)
    try {
      const reproject = (p: Point): Point => ({ x: (p.x - bbox.x) * detailMultiplier, y: (p.y - bbox.y) * detailMultiplier })

      const boundaryLandmass: MapLandmass = {
        id: crypto.randomUUID(),
        name: `${noteName} (region)`,
        points: activeBoundaryMask.map(reproject),
        generated: false
      }
      // Carries over pins that fall inside the selected region (both
      // linked and freehand) so existing settlements/locations already
      // placed at the parent's scale stay visible at the child's scale too
      // — the same city legitimately appears on both a world map and a
      // zoomed-in regional map of a real atlas. Everything else generated
      // (zones/lines/climateZones/territories) is deliberately NOT carried
      // over: those are the "new detail" this drilldown exists to generate
      // fresh, at the child's own resolution, inside the cropped boundary.
      const childPins: MapPin[] = data.pins
        .filter((p) => pointInPolygon({ x: p.x, y: p.y }, activeBoundaryMask))
        .map((p) => ({ ...p, id: crypto.randomUUID(), ...reproject({ x: p.x, y: p.y }) }))

      const childSeed = hashSeed(data.generation?.seed ?? 0, Math.round(bbox.x), Math.round(bbox.y), Math.round(bbox.width), Math.round(bbox.height))

      // Derives the child's own scale from this map's, over just the
      // cropped region — 'latitude' mode re-expresses the crop's own
      // top/bottom edges as latitudes (via this map's already-derived scale
      // + equator row), so the child inherits accurate real-world sizing
      // instead of an unset/default scale; 'manual' mode scales
      // pixelDistance by detailMultiplier to keep the same real-distance-
      // per-pixel ratio once the crop is upscaled.
      let childScaleFields: Record<string, unknown> = {}
      if (data.scaleMode === 'latitude' && data.topLatitude !== null && data.bottomLatitude !== null && data.planetCircumference) {
        const parentScale = deriveScaleFromLatitudeSpan(data.topLatitude, data.bottomLatitude, data.planetCircumference, workingDims.height, data.latitudeUnit)
        const equatorY = deriveEquatorY(data.topLatitude, data.bottomLatitude, workingDims.height)
        if (equatorY !== null) {
          const latConfig = { equatorY, planetCircumference: data.planetCircumference }
          childScaleFields = {
            scaleMode: 'latitude',
            topLatitude: (latitudeRadiansAt(bbox.y, parentScale, latConfig) * 180) / Math.PI,
            bottomLatitude: (latitudeRadiansAt(bbox.y + bbox.height, parentScale, latConfig) * 180) / Math.PI,
            planetCircumference: data.planetCircumference,
            latitudeUnit: data.latitudeUnit,
            accountForLatitudeDistortion: data.accountForLatitudeDistortion
          }
        }
      } else if (data.scale) {
        childScaleFields = { scale: { pixelDistance: data.scale.pixelDistance * detailMultiplier, realDistance: data.scale.realDistance, unit: data.scale.unit } }
      }

      const childFrontmatter = {
        ...defaultMapFrontmatter(),
        ...childScaleFields,
        canvasSize: { width: Math.round(bbox.width * detailMultiplier), height: Math.round(bbox.height * detailMultiplier) },
        landmasses: [boundaryLandmass],
        pins: childPins,
        generation: {
          seed: childSeed,
          params: {},
          parentMapTitle: noteName,
          parentBounds: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height }
        }
      }

      const created = await noteRefApi.createNote(`${noteName} (detail)`, childFrontmatter)
      setChildMapsRefreshKey((k) => k + 1)
      await noteRefApi.openByTitle(created.title, 'map')
    } catch (err) {
      setChildMapError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreatingChildMap(false)
    }
  }

  const openMapNote = (title: string): void => {
    void noteRefApi.openByTitle(title, 'map')
  }

  // Every section merges its own params into the shared generation.params
  // record rather than replacing it wholesale — running just the Climate
  // section, say, shouldn't erase the record of what Terrain/Hydrology
  // params produced the rest of the map.
  const mergeGeneration = (sectionParams: Record<string, number | string | boolean>): NonNullable<MapFrontmatter['generation']> => ({
    seed,
    params: { ...savedParams, ...sectionParams },
    parentMapTitle: data.generation?.parentMapTitle ?? null,
    parentBounds: data.generation?.parentBounds ?? null
  })

  const generateTerrainNow = (): void => {
    if (!workingDims) return
    setGeneratingTerrain(true)
    try {
      const { id: mountainTerrainTypeId, newType } = resolveMountainTerrainType(data.terrainTypes)
      const result = generateTerrain({
        seed,
        widthPixels: workingDims.width,
        heightPixels: workingDims.height,
        landmassScale,
        seaLevel,
        mountainDensity,
        mountainRuggedness,
        mountainTerrainTypeId,
        boundaryMask: activeBoundaryMask,
        edgesAreOcean,
        continentCount
      })
      // Only ever replaces content THIS generator previously produced
      // (generated:true) — anything hand-drawn survives untouched — AND,
      // with an active boundary mask, only the portion of that generated
      // content actually inside the mask (see isInScope) — so "augment just
      // this region" never wipes out generated content elsewhere on the map.
      const keptLandmasses = data.landmasses.filter((l) => !l.generated || !isInScope(l.points, activeBoundaryMask))
      const keptZones = data.zones.filter((z) => !z.generated || !isInScope(z.points, activeBoundaryMask))
      updateFrontmatter({
        landmasses: [...keptLandmasses, ...result.landmasses],
        zones: [...keptZones, ...result.mountainZones],
        terrainTypes: newType ? [...data.terrainTypes, newType] : data.terrainTypes,
        generation: mergeGeneration({ landmassScale, seaLevel, mountainDensity, mountainRuggedness, edgesAreOcean, continentCount })
      })
    } finally {
      setGeneratingTerrain(false)
    }
  }

  const generateRiversNow = (): void => {
    if (!workingDims) return
    setGeneratingRivers(true)
    try {
      const { id: riverLineTypeId, newType } = resolveRiverLineType(data.lineTypes)
      // Your own hand-drawn (non-generated) landmasses — read fresh every
      // run for the same reason climate's elevatedZones/anchors are — so
      // rivers respect the actual drawn coastline instead of an invented one.
      // Only on a whole-map run (no active boundary mask): a scoped augment/
      // drilldown run is explicitly inventing land in a region no existing
      // landmass covers yet, and this would otherwise make that whole region
      // read as water (every existing landmass elsewhere on the map failing
      // to cover it). See landmassPolygons's own doc comment in hydrology.ts.
      const landmassPolygons = activeBoundaryMask === null ? data.landmasses.filter((l) => !l.generated).map((l) => l.points) : []
      const rivers = generateRivers({
        seed,
        widthPixels: workingDims.width,
        heightPixels: workingDims.height,
        landmassScale,
        seaLevel,
        mountainDensity,
        mountainRuggedness,
        riverDensity,
        riverLineTypeId,
        boundaryMask: activeBoundaryMask,
        edgesAreOcean,
        continentCount,
        landmassPolygons
      })
      // Scoped to riverLineTypeId, not just "!generated" — roads are also
      // generated lines sharing this same array, and regenerating rivers
      // must never wipe out a previously-generated road (or vice versa in
      // generateRoadsNow below). Also scoped to the active boundary mask —
      // see isInScope.
      const keptLines = data.lines.filter((l) => !l.generated || l.lineTypeId !== riverLineTypeId || !isInScope(l.points, activeBoundaryMask))
      updateFrontmatter({
        lines: [...keptLines, ...rivers],
        lineTypes: newType ? [...data.lineTypes, newType] : data.lineTypes,
        generation: mergeGeneration({ riverDensity })
      })
    } finally {
      setGeneratingRivers(false)
    }
  }

  const generateClimateNow = async (): Promise<void> => {
    if (!workingDims) return
    setGeneratingClimate(true)
    setClimateAnchorError(null)
    try {
      // Resolved fresh on every run (not memoized against data.pins) since
      // a settlement's own climate note — or its biomeId — can change
      // between generation runs, and this only ever costs a handful of
      // note reads for pins that are actually linked.
      const anchors = await resolveClimateAnchors(data.pins, noteRefApi).catch((err) => {
        setClimateAnchorError(err instanceof Error ? err.message : String(err))
        return []
      })
      const anchorRadiusPixels = anchors.length > 0 ? anchorRadiusFraction * Math.min(workingDims.width, workingDims.height) : 0
      // Your own hand-painted Mountains/Hills zones (any terrain type with
      // climateElevationOverride set) — read fresh every run for the same
      // reason anchors are, and passed straight through as plain polygon +
      // elevation pairs so generateClimate stays decoupled from the note
      // schema.
      const terrainTypeById = new Map(data.terrainTypes.map((t) => [t.id, t]))
      const elevatedZones = data.zones.flatMap((zone) => {
        const elevation = terrainTypeById.get(zone.terrainTypeId)?.climateElevationOverride
        return elevation !== null && elevation !== undefined ? [{ points: zone.points, elevation }] : []
      })
      // Your own hand-drawn (non-generated) landmasses — same idea as
      // elevatedZones above, but for the coastline itself rather than
      // painted terrain: land/water for this run comes straight from your
      // drawn shapes, not this call's own freshly-invented elevation field.
      // Only on a whole-map run — see the identical comment in
      // generateRiversNow above and landmassPolygons's own doc comment in
      // climate.ts.
      const landmassPolygons = activeBoundaryMask === null ? data.landmasses.filter((l) => !l.generated).map((l) => l.points) : []
      const result = generateClimate({
        seed,
        widthPixels: workingDims.width,
        heightPixels: workingDims.height,
        landmassScale,
        seaLevel,
        mountainDensity,
        mountainRuggedness,
        moistureScale,
        prevailingWindDirection,
        topLatitude: data.scaleMode === 'latitude' ? data.topLatitude : null,
        bottomLatitude: data.scaleMode === 'latitude' ? data.bottomLatitude : null,
        boundaryMask: activeBoundaryMask,
        anchors,
        anchorRadiusPixels,
        elevatedZones,
        landmassPolygons,
        edgesAreOcean,
        continentCount
      })
      const existingTypeIds = new Set(data.climateTypes.map((t) => t.id))
      const newTypes = result.climateTypes.filter((t) => !existingTypeIds.has(t.id))
      const keptZones = data.climateZones.filter((z) => !z.generated || !isInScope(z.points, activeBoundaryMask))
      updateFrontmatter({
        climateTypes: [...data.climateTypes, ...newTypes],
        climateZones: [...keptZones, ...result.climateZones],
        generation: mergeGeneration({ moistureScale, prevailingWindDirection, anchorRadiusFraction })
      })
    } finally {
      setGeneratingClimate(false)
    }
  }

  const generateCivilizationsNow = (): void => {
    if (!workingDims) return
    setGeneratingCivilizations(true)
    try {
      const result = generateCivilizations({
        seed,
        widthPixels: workingDims.width,
        heightPixels: workingDims.height,
        landmassScale,
        seaLevel,
        mountainDensity,
        mountainRuggedness,
        civilizationCount,
        settlementCount,
        boundaryMask: activeBoundaryMask,
        edgesAreOcean,
        continentCount
      })
      // Territories can now be hand-drawn too (Draw Territory, MapSheet.tsx),
      // so — same as every other layer — only ever replaces entries this
      // generator itself previously produced (generated:true) AND that fall
      // inside the active boundary mask; a hand-drawn territory, or a
      // generated one outside the current mask from a previous run, always
      // survives.
      const keptPins = data.pins.filter((p) => !p.generated || !isInScope([{ x: p.x, y: p.y }], activeBoundaryMask))
      const keptTerritories = data.territories.filter((t) => !t.generated || !isInScope(t.points, activeBoundaryMask))
      updateFrontmatter({
        pins: [...keptPins, ...result.pins],
        territories: [...keptTerritories, ...result.territories],
        generation: mergeGeneration({ civilizationCount, settlementCount })
      })
    } finally {
      setGeneratingCivilizations(false)
    }
  }

  const generatedSettlementPoints = data.pins.filter((p) => p.generated).map((p) => ({ x: p.x, y: p.y }))

  const generateRoadsNow = (): void => {
    if (!workingDims || generatedSettlementPoints.length < 2) return
    setGeneratingRoads(true)
    try {
      const { id: roadLineTypeId, newType } = resolveRoadLineType(data.lineTypes)
      const roads = generateRoads(
        {
          seed,
          widthPixels: workingDims.width,
          heightPixels: workingDims.height,
          landmassScale,
          seaLevel,
          mountainDensity,
          mountainRuggedness,
          roadDensity,
          roadLineTypeId,
          boundaryMask: activeBoundaryMask,
          edgesAreOcean,
          continentCount
        },
        generatedSettlementPoints
      )
      const keptLines = data.lines.filter((l) => !l.generated || l.lineTypeId !== roadLineTypeId || !isInScope(l.points, activeBoundaryMask))
      updateFrontmatter({
        lines: [...keptLines, ...roads],
        lineTypes: newType ? [...data.lineTypes, newType] : data.lineTypes,
        generation: mergeGeneration({ roadDensity })
      })
    } finally {
      setGeneratingRoads(false)
    }
  }

  const renameTerritory = (territoryId: string, name: string): void => {
    updateFrontmatter({ territories: data.territories.map((t) => (t.id === territoryId ? { ...t, name } : t)) })
  }

  const assignNamingStyle = (territoryId: string, namingStyleId: string | null): void => {
    updateFrontmatter({ territories: data.territories.map((t) => (t.id === territoryId ? { ...t, namingStyleId } : t)) })
  }

  const regenerateTerritoryName = (territory: MapFrontmatter['territories'][number]): void => {
    const style = resolvePlaceNameStyle(territory.namingStyleId)
    renameTerritory(territory.id, `Kingdom of ${generatePlaceName(style)}`)
  }

  const assignPreset = (territoryId: string, presetNoteTitle: string | null): void => {
    updateFrontmatter({
      territories: data.territories.map((t) => (t.id === territoryId ? { ...t, presetNoteTitle } : t))
    })
  }

  return (
    <details open={data.generation !== null} style={{ marginTop: 12 }}>
      <summary>Generate</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420, marginTop: 8 }}>
        <p className="right-panel-note">
          Procedurally generates map content from a seed — deterministic, not AI-written content. Each section below only ever replaces what
          it previously generated itself; anything you&apos;ve drawn by hand is never touched.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label className="sheet-field">
            Seed (shared by every section below)
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 160 }} />
          </label>
          <button onClick={() => setSeed(randomSeed())}>Randomize</button>
        </div>

        {!workingDims && <p className="right-panel-note">Upload an image or start a blank map above first, so there&apos;s a canvas to generate onto.</p>}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Boundary</strong>
          <p className="right-panel-note">
            Constrain every section below to inside a boundary instead of the whole canvas — for augmenting just part of your own hand-drawn map,
            or drilling into a region. Generated content outside the boundary is left untouched by any of the actions below.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(['whole-map', 'landmass', 'custom'] as const).map((source) => (
              <button key={source} className={boundarySource === source ? 'active' : ''} onClick={() => setBoundarySource(source)}>
                {source === 'whole-map' ? 'Whole map' : source === 'landmass' ? 'Inside a landmass' : 'Custom region'}
              </button>
            ))}
          </div>
          {boundarySource === 'landmass' && (
            <label className="sheet-field">
              Landmass (hand-drawn or previously generated)
              <select value={selectedLandmassId ?? ''} onChange={(e) => setSelectedLandmassId(e.target.value || null)}>
                <option value="">Choose…</option>
                {data.landmasses.map((l, i) => (
                  <option key={l.id} value={l.id}>
                    {l.name || `Landmass ${i + 1}`}
                    {l.generated ? ' (generated)' : ''}
                  </option>
                ))}
              </select>
              {data.landmasses.length === 0 && <span className="right-panel-note">No landmasses yet — draw one (Draw Landmass) or run Terrain generation first.</span>}
            </label>
          )}
          {boundarySource === 'custom' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <button onClick={onStartDrawingRegion}>{activeBoundaryMask ? 'Redraw region' : 'Draw region'}</button>
              {activeBoundaryMask && <button onClick={onClearCustomRegion}>Clear region</button>}
            </div>
          )}
          {activeBoundaryMask ? (
            <p className="right-panel-note">Boundary active (shown highlighted on the map) — every section below only affects this area.</p>
          ) : boundarySource !== 'whole-map' ? (
            <p className="right-panel-note">No boundary selected yet — generation below still runs across the whole map until one is set.</p>
          ) : null}

          {activeBoundaryMask && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
              <span style={{ fontWeight: 600 }}>Drill into this boundary</span>
              <p className="right-panel-note">
                Spins the boundary above off into a brand-new, more detailed Map note — this map&apos;s coastline there becomes a fixed region on
                the new map, ready for its own Terrain/Hydrology/Climate/Civilizations/Roads generation at a finer scale. This map itself is left
                untouched.
              </p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Detail multiplier ({detailMultiplier}x pixels for the same real-world area)</span>
                <input type="range" min={1} max={8} step={1} value={detailMultiplier} onChange={(e) => setDetailMultiplier(Number(e.target.value))} />
              </label>
              <button disabled={creatingChildMap} onClick={() => void createChildMap()}>
                {creatingChildMap ? 'Creating…' : 'Create child map from this boundary'}
              </button>
              {childMapError && <p className="right-panel-note" style={{ color: 'var(--danger, #c0392b)' }}>{childMapError}</p>}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Linked maps</strong>
          {parentMapTitle && (
            <p className="right-panel-note">
              Drilled down from:{' '}
              {parentMapExists ? (
                <button type="button" onClick={() => openMapNote(parentMapTitle)} style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
                  {parentMapTitle}
                </button>
              ) : (
                `${parentMapTitle} (not found)`
              )}
            </p>
          )}
          {childMaps.length > 0 ? (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 18, margin: 0 }}>
              {childMaps.map((title) => (
                <li key={title}>
                  <button type="button" onClick={() => openMapNote(title)} style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
                    {title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="right-panel-note">No child maps yet — select a boundary above and use &quot;Create child map&quot; to drill into it.</p>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Terrain</strong>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Landmass scale ({landmassScale.toFixed(2)}) — smaller means more, smaller landmasses; larger means fewer, bigger ones.</span>
            <input type="range" min={0.05} max={1} step={0.01} value={landmassScale} onChange={(e) => setLandmassScale(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Sea level ({seaLevel.toFixed(2)}) — higher means more ocean, less land.</span>
            <input type="range" min={0} max={1} step={0.01} value={seaLevel} onChange={(e) => setSeaLevel(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Mountain density ({mountainDensity.toFixed(2)}) — how much of already-high land becomes mountainous.</span>
            <input type="range" min={0} max={1} step={0.01} value={mountainDensity} onChange={(e) => setMountainDensity(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Mountain ruggedness ({mountainRuggedness.toFixed(2)}) — how jagged the mountain ranges are.</span>
            <input type="range" min={0} max={1} step={0.01} value={mountainRuggedness} onChange={(e) => setMountainRuggedness(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={edgesAreOcean} onChange={(e) => setEdgesAreOcean(e.target.checked)} />
            This map is a whole world (surrounded by ocean)
          </label>
          <p className="right-panel-note">
            {edgesAreOcean
              ? 'Land is pulled toward ocean near every canvas edge, so this reads as a self-contained world instead of an arbitrary crop of a bigger continent.'
              : 'Off (default): land can run off any edge — pick this if the map is meant to depict just a section of a larger landmass.'}
          </p>
          {edgesAreOcean && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Continents ({continentCount}) — a strong bias toward this many separate landmasses, not an exact guarantee.</span>
              <input type="range" min={1} max={8} step={1} value={continentCount} onChange={(e) => setContinentCount(Number(e.target.value))} />
            </label>
          )}
          <button disabled={!workingDims || generatingTerrain} onClick={generateTerrainNow}>
            {generatingTerrain ? 'Generating…' : data.generation ? 'Regenerate terrain' : 'Generate terrain'}
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Hydrology</strong>
          <p className="right-panel-note">
            Uses the Terrain section&apos;s current landmass/sea-level/mountain settings above — run Terrain first for the coastline these
            rivers will respect.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>River density ({riverDensity.toFixed(2)}) — higher means more, longer rivers.</span>
            <input type="range" min={0} max={1} step={0.01} value={riverDensity} onChange={(e) => setRiverDensity(Number(e.target.value))} />
          </label>
          <button disabled={!workingDims || generatingRivers} onClick={generateRiversNow}>
            {generatingRivers ? 'Generating…' : 'Generate rivers'}
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Climate</strong>
          <p className="right-panel-note">
            {data.scaleMode === 'latitude' && data.topLatitude !== null && data.bottomLatitude !== null
              ? "Uses this map's own latitude settings for temperature."
              : 'This map has no latitude set (see the scale section above) — temperature falls back to warmest at the vertical center, coldest at the top/bottom edges.'}
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Moisture pattern scale ({moistureScale.toFixed(2)}) — relative size of wet/dry regions.</span>
            <input type="range" min={0.05} max={1} step={0.01} value={moistureScale} onChange={(e) => setMoistureScale(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Prevailing wind direction — the side of a mountain range facing away from this stays drier (rain shadow).</span>
            <select value={prevailingWindDirection} onChange={(e) => setPrevailingWindDirection(e.target.value as WindDirection)}>
              {WIND_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>
              Climate anchor influence ({Math.round(anchorRadiusFraction * 100)}% of the map&apos;s size) — any pin linked to a note whose own
              climate note has a Map biome set becomes a known-correct point nearby generation blends toward, fading smoothly into the
              procedural climate further away. Pins with no such link have no effect.
            </span>
            <input type="range" min={0} max={0.5} step={0.01} value={anchorRadiusFraction} onChange={(e) => setAnchorRadiusFraction(Number(e.target.value))} />
          </label>
          <button disabled={!workingDims || generatingClimate} onClick={() => void generateClimateNow()}>
            {generatingClimate ? 'Generating…' : 'Generate climate'}
          </button>
          {climateAnchorError && <p className="right-panel-note" style={{ color: 'var(--danger, #c0392b)' }}>Couldn&apos;t resolve some climate anchors: {climateAnchorError}</p>}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Civilizations</strong>
          <p className="right-panel-note">
            Places settlements (favoring coasts, rivers, and flat land) and grows national territories outward from each civilization&apos;s
            capital — a mountain range naturally tends to become a slow, contested border rather than being crossed for free.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Civilizations ({civilizationCount})</span>
            <input type="range" min={1} max={8} step={1} value={civilizationCount} onChange={(e) => setCivilizationCount(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Total settlements ({settlementCount}, including each capital)</span>
            <input type="range" min={civilizationCount} max={30} step={1} value={settlementCount} onChange={(e) => setSettlementCount(Number(e.target.value))} />
          </label>
          <button disabled={!workingDims || generatingCivilizations} onClick={generateCivilizationsNow}>
            {generatingCivilizations ? 'Generating…' : 'Generate civilizations'}
          </button>

          {data.territories.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <span className="right-panel-note">Name each nation, pick a naming style for it and its cities, and assign a settlement preset (for the &quot;generate a real settlement&quot; pin action):</span>
              {data.territories.map((t) => (
                <div key={t.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, backgroundColor: t.color }} />
                  <input style={{ flex: 1, minWidth: '10rem' }} value={t.name} onChange={(e) => renameTerritory(t.id, e.target.value)} />
                  <select value={t.namingStyleId ?? ''} onChange={(e) => assignNamingStyle(t.id, e.target.value || null)} title="Naming style for this nation and (by default) its cities">
                    <option value="">Random / Mixed style</option>
                    {PLACE_NAME_STYLES.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => regenerateTerritoryName(t)} title="Regenerate this nation's name">
                    🎲
                  </button>
                  <select value={t.presetNoteTitle ?? ''} onChange={(e) => assignPreset(t.id, e.target.value || null)}>
                    <option value="">No preset</option>
                    {presetTitles.map((title) => (
                      <option key={title} value={title}>
                        {title}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {presetTitles.length === 0 && <p className="right-panel-note">No settlement-preset notes found yet — create one to assign it here.</p>}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Roads</strong>
          <p className="right-panel-note">
            Connects the Civilizations section&apos;s generated settlements with real terrain-following roads — run Civilizations first.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Road density ({roadDensity.toFixed(2)}) — 0 is a bare minimum network, 1 adds a denser mesh of extra connections.</span>
            <input type="range" min={0} max={1} step={0.01} value={roadDensity} onChange={(e) => setRoadDensity(Number(e.target.value))} />
          </label>
          <button disabled={!workingDims || generatingRoads || generatedSettlementPoints.length < 2} onClick={generateRoadsNow}>
            {generatingRoads ? 'Generating…' : 'Generate roads'}
          </button>
          {generatedSettlementPoints.length < 2 && <p className="right-panel-note">Needs at least 2 generated settlements — run Civilizations first.</p>}
        </div>
      </div>
    </details>
  )
}
