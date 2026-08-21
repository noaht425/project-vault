import { useEffect, useState } from 'react'
import { generateTerrain, generateRivers, generateClimate, generateCivilizations, generateRoads } from '../../../../common/mapGeneration/generateMap'
import type { WindDirection } from '../../../../common/mapGeneration/climate'
import { defaultLineTypes, defaultTerrainTypes, type LineType, type MapFrontmatter, type TerrainType } from '../../../../common/noteTypes/map'
import { generatePlaceName, resolvePlaceNameStyle, PLACE_NAME_STYLES } from '../../../../common/placeNames'
import { pointInPolygon, polygonCentroid, type Point } from '../../../../common/mapGeometry'
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
  const [generatingTerrain, setGeneratingTerrain] = useState(false)

  const [riverDensity, setRiverDensity] = useState(Number(savedParams.riverDensity ?? 0.5))
  const [generatingRivers, setGeneratingRivers] = useState(false)

  const [moistureScale, setMoistureScale] = useState(Number(savedParams.moistureScale ?? 0.4))
  const [prevailingWindDirection, setPrevailingWindDirection] = useState<WindDirection>((savedParams.prevailingWindDirection as WindDirection) ?? 'W')
  const [generatingClimate, setGeneratingClimate] = useState(false)

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

  // Every section merges its own params into the shared generation.params
  // record rather than replacing it wholesale — running just the Climate
  // section, say, shouldn't erase the record of what Terrain/Hydrology
  // params produced the rest of the map.
  const mergeGeneration = (sectionParams: Record<string, number | string>): NonNullable<MapFrontmatter['generation']> => ({
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
        boundaryMask: activeBoundaryMask
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
        generation: mergeGeneration({ landmassScale, seaLevel, mountainDensity, mountainRuggedness })
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
        boundaryMask: activeBoundaryMask
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

  const generateClimateNow = (): void => {
    if (!workingDims) return
    setGeneratingClimate(true)
    try {
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
        boundaryMask: activeBoundaryMask
      })
      const existingTypeIds = new Set(data.climateTypes.map((t) => t.id))
      const newTypes = result.climateTypes.filter((t) => !existingTypeIds.has(t.id))
      const keptZones = data.climateZones.filter((z) => !z.generated || !isInScope(z.points, activeBoundaryMask))
      updateFrontmatter({
        climateTypes: [...data.climateTypes, ...newTypes],
        climateZones: [...keptZones, ...result.climateZones],
        generation: mergeGeneration({ moistureScale, prevailingWindDirection })
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
        boundaryMask: activeBoundaryMask
      })
      // Territories are entirely generated content today (there's no
      // manual "paint a territory" tool), so unlike lines/zones there's no
      // hand-drawn territory to preserve — but with an active boundary
      // mask, a territory OUTSIDE it from a previous (whole-map or
      // differently-scoped) run must still survive; only ones inside the
      // current mask get replaced. Pins mix freely with hand-placed ones,
      // so those filter by generated:true AND scope, same as every other
      // section.
      const keptPins = data.pins.filter((p) => !p.generated || !isInScope([{ x: p.x, y: p.y }], activeBoundaryMask))
      const keptTerritories = data.territories.filter((t) => !isInScope(t.points, activeBoundaryMask))
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
          boundaryMask: activeBoundaryMask
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
          <button disabled={!workingDims || generatingClimate} onClick={generateClimateNow}>
            {generatingClimate ? 'Generating…' : 'Generate climate'}
          </button>
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
