import { useEffect, useMemo, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { mapFrontmatterSchema } from '../../../../common/noteTypes/map'
import type { LineType, MapLandmass, MapLine, MapPin, MapZone, TerrainType } from '../../../../common/noteTypes/map'
import {
  crossingTime,
  deriveEquatorY,
  deriveScaleFromLatitudeSpan,
  foldDrawnPathAtWraps,
  pointInPolygon,
  type Point
} from '../../../../common/mapGeometry'
import { defaultSettlementFrontmatter } from '../../../../common/noteTypes/settlement'
import { presetFieldsFromPreset, settlementPresetFrontmatterSchema } from '../../../../common/noteTypes/settlementPreset'
import { generateSettlement } from '../../../../common/settlementGenerator'
import { NAME_INSPIRATION_SOURCES } from '../../../../common/settlementNames'
import { PHONETIC_PROFILES } from '../../../../common/phoneticNames'
import { generatePlaceName, resolvePlaceNameStyle, PLACE_NAME_STYLES } from '../../../../common/placeNames'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { useTravelModesStore, EMPTY_TRAVEL_MODES } from '../../state/travelModesStore'
import { MapCanvas, type MapCanvasMode } from './MapCanvas'
import { MapGenerationPanel } from './MapGenerationPanel'
import { MapTripCalculator } from './MapTripCalculator'
import { MapTimeline } from './MapTimeline'
import { TravelModesEditor } from './TravelModesEditor'

function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Failed to load the uploaded image'))
    img.src = url
  })
}

export function MapSheet({
  noteName,
  content,
  onContentChange,
  noteRefApi
}: {
  // This map note's own title — needed for Phase 6 (multi-scale
  // drilldown): a child map created from a selected region stamps
  // generation.parentMapTitle with noteName, and "Parent map" navigation
  // resolves data.generation.parentMapTitle back to a note by title.
  noteName: string
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  // Memoized on content — same reasoning as SettlementSheet.tsx: without
  // this, the zod parse re-ran on every render, including every local UI
  // state change in this component (drawing a zone/line, typing in a form
  // field), not just on real edits to the map. It also kept `data` (and
  // e.g. `data.pins`) a fresh reference every render, which defeated
  // MapTripCalculator's own memoization of the trip path/geometry sweep.
  const { frontmatter, body } = useMemo(() => parseNote(content), [content])
  const data = useMemo(() => mapFrontmatterSchema.parse(frontmatter), [frontmatter])

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const [mode, setMode] = useState<MapCanvasMode>('view')
  const [uploading, setUploading] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [pendingPixelDistance, setPendingPixelDistance] = useState<number | null>(null)
  const [realDistanceInput, setRealDistanceInput] = useState('')
  const [unitInput, setUnitInput] = useState(data.scale?.unit ?? 'miles')

  // Shared by both the zone- and line-confirmation forms below — only one
  // of pendingZonePoints/pendingLinePoints is ever non-null at a time
  // (gated by `mode`), so there's no risk of them colliding.
  const [terrainChoice, setTerrainChoice] = useState('')
  const [newTerrainName, setNewTerrainName] = useState('')
  const [newTerrainColor, setNewTerrainColor] = useState('#4caf6e')
  const [newTerrainMultiplier, setNewTerrainMultiplier] = useState(1)

  const [pendingZonePoints, setPendingZonePoints] = useState<Point[] | null>(null)

  const [pendingLinePoints, setPendingLinePoints] = useState<Point[] | null>(null)
  const [lineWidthInput, setLineWidthInput] = useState(20)

  const [pendingLandmassPoints, setPendingLandmassPoints] = useState<Point[] | null>(null)
  const [newLandmassName, setNewLandmassName] = useState('')

  // Generation boundary (Phase 5 — augment/drilldown): constrains every
  // "Generate ___" action to inside a boundary instead of the whole canvas,
  // either an existing landmass (hand-drawn or previously generated) or a
  // freshly-drawn custom region — see the map generation plan's core design
  // decision #6 ("augment my hand-drawn map" and "drill into a region" are
  // the same masked-generation mechanism). Lives here (not inside
  // MapGenerationPanel) because selecting a custom region needs to drive
  // this component's own `mode`/MapCanvas, same reason every other
  // draw-a-shape flow's state lives here.
  const [boundarySource, setBoundarySource] = useState<'whole-map' | 'landmass' | 'custom'>('whole-map')
  const [selectedLandmassId, setSelectedLandmassId] = useState<string | null>(null)
  const [customBoundaryMask, setCustomBoundaryMask] = useState<Point[] | null>(null)

  const [pendingPinPoint, setPendingPinPoint] = useState<Point | null>(null)
  const [pinQuery, setPinQuery] = useState('')
  const [pinResults, setPinResults] = useState<{ title: string }[]>([])

  const [generatingSettlementPinId, setGeneratingSettlementPinId] = useState<string | null>(null)
  const [settlementGenError, setSettlementGenError] = useState<string | null>(null)

  // Lifted up from the Timeline section (below) so MapCanvas, which renders
  // above it, can ring the pins for whatever events are currently revealed.
  const [highlightedPinIds, setHighlightedPinIds] = useState<Set<string>>(new Set())

  // Lifted up from the Trip Calculator section (below) for the same reason —
  // MapCanvas renders above it but owns the actual overlay drawing.
  // drawnTripPath is the raw hand-drawn route (see MapCanvas's 'draw-trip'
  // mode); tripOverlayPath is whichever route (drawn, straight pin-to-pin, or
  // wrapped) is currently shown on the map, as 1-3 legs (see MapCanvas's
  // tripPath prop) — shown independently of whether a route has been drawn.
  const [drawnTripPath, setDrawnTripPath] = useState<Point[] | null>(null)
  const [tripOverlayPath, setTripOverlayPath] = useState<Point[][] | null>(null)

  // Only for the line form's crossing-time preview below — travel modes
  // are otherwise entirely TravelModesEditor's/MapTripCalculator's concern.
  const travelModesNoteId = useTravelModesStore((s) => s.noteId)
  const travelModesLoading = useTravelModesStore((s) => s.loading)
  const travelModes = useTravelModesStore((s) => s.frontmatter?.modes ?? EMPTY_TRAVEL_MODES)
  const loadTravelModes = useTravelModesStore((s) => s.load)
  useEffect(() => {
    if (!travelModesNoteId && !travelModesLoading) void loadTravelModes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!data.image) {
      setImageUrl(null)
      return
    }
    // Branches on noteRefApi.isCloud the same way SettlementSheet.tsx gates
    // its own Cloud-only bulk-data offload — see
    // docs/plans/2026-08-04-cloud-to-local-copy.md Phase 3. Previously this
    // unconditionally called window.cloudApi even for a note opened in the
    // Local Vault (harmless before Local had no map notes to open at all,
    // but wrong now that it does).
    const getUrl = noteRefApi.isCloud ? window.cloudApi.getMapImageUrl : window.vaultApi.getLocalImageUrl
    getUrl(data.image.path)
      .then((url) => !cancelled && setImageUrl(url))
      .catch(() => !cancelled && setImageUrl(null))
    return () => {
      cancelled = true
    }
  }, [data.image?.path, noteRefApi.isCloud])

  useEffect(() => {
    if (!pendingPinPoint || !pinQuery.trim()) {
      setPinResults([])
      return
    }
    let cancelled = false
    noteRefApi.searchTitles(pinQuery, 'location').then((results) => !cancelled && setPinResults(results))
    return () => {
      cancelled = true
    }
  }, [pinQuery, pendingPinPoint, noteRefApi])

  const handleUploadImage = async (): Promise<void> => {
    setUploading(true)
    setUploadError(null)
    try {
      const result = noteRefApi.isCloud
        ? await window.cloudApi.pickAndUploadMapImage()
        : await window.vaultApi.pickAndSaveLocalImage()
      if (!result) return // user cancelled the file picker
      const url = noteRefApi.isCloud
        ? await window.cloudApi.getMapImageUrl(result.path)
        : await window.vaultApi.getLocalImageUrl(result.path)
      const dims = await loadImageDimensions(url)
      // Replacing an existing image leaves the old file behind (Supabase
      // Storage on Cloud, .attachments/ locally) — acceptable for a
      // personal single-user tool, not worth a cleanup pass in v1.
      updateFrontmatter({ image: { path: result.path, width: dims.width, height: dims.height } })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  const confirmCalibration = (): void => {
    const real = Number(realDistanceInput)
    if (pendingPixelDistance === null || !Number.isFinite(real) || real <= 0) return
    updateFrontmatter({ scale: { pixelDistance: pendingPixelDistance, realDistance: real, unit: unitInput.trim() || 'miles' } })
    setPendingPixelDistance(null)
    setRealDistanceInput('')
    setMode('view')
  }
  const cancelCalibration = (): void => {
    setPendingPixelDistance(null)
    setRealDistanceInput('')
    setMode('view')
  }

  // Builds a fresh TerrainType/LineType from the "+ New…" mini-form if
  // that's what's selected, or resolves the chosen existing one from
  // whichever pool the caller passes — shared by confirmZone (terrainTypes)
  // and confirmLine (lineTypes). Returns null if the form isn't ready to
  // submit (name required for a new type).
  const resolveType = (pool: TerrainType[]): TerrainType | null => {
    if (terrainChoice === '__new__') {
      if (!newTerrainName.trim()) return null
      return { id: crypto.randomUUID(), name: newTerrainName.trim(), color: newTerrainColor, speedMultiplier: newTerrainMultiplier, climateElevationOverride: null }
    }
    return pool.find((t) => t.id === terrainChoice) ?? null
  }
  // Live preview only — unlike resolveType, doesn't require a name yet, so
  // the crossing-time preview updates as soon as a multiplier is entered.
  const previewMultiplier = terrainChoice === '__new__' ? newTerrainMultiplier : data.lineTypes.find((t) => t.id === terrainChoice)?.speedMultiplier
  const resetPendingTerrainForm = (): void => {
    setTerrainChoice('')
    setNewTerrainName('')
  }

  const confirmZone = (): void => {
    if (!pendingZonePoints) return
    const terrainType = resolveType(data.terrainTypes)
    if (!terrainType) return
    const zone: MapZone = { id: crypto.randomUUID(), terrainTypeId: terrainType.id, points: pendingZonePoints, generated: false }
    // Terrain type + zone are written in one patch when it's a new terrain
    // type — data.terrainTypes read here is a snapshot from this render, so
    // a second separate updateFrontmatter call for the zone would silently
    // drop the new terrain type (stale closure), not merge with it.
    const isNewTerrainType = terrainChoice === '__new__'
    updateFrontmatter(
      isNewTerrainType
        ? { terrainTypes: [...data.terrainTypes, terrainType], zones: [...data.zones, zone] }
        : { zones: [...data.zones, zone] }
    )
    setPendingZonePoints(null)
    resetPendingTerrainForm()
    setMode('view')
  }
  const cancelZone = (): void => {
    setPendingZonePoints(null)
    resetPendingTerrainForm()
    setMode('view')
  }

  const confirmLine = (): void => {
    if (!pendingLinePoints) return
    const widthPixels = Number(lineWidthInput)
    if (!Number.isFinite(widthPixels) || widthPixels <= 0) return
    const lineType = resolveType(data.lineTypes)
    if (!lineType) return
    const line: MapLine = { id: crypto.randomUUID(), lineTypeId: lineType.id, points: pendingLinePoints, widthPixels, generated: false }
    const isNewLineType = terrainChoice === '__new__'
    updateFrontmatter(
      isNewLineType ? { lineTypes: [...data.lineTypes, lineType], lines: [...data.lines, line] } : { lines: [...data.lines, line] }
    )
    setPendingLinePoints(null)
    resetPendingTerrainForm()
    setMode('view')
  }
  const cancelLine = (): void => {
    setPendingLinePoints(null)
    resetPendingTerrainForm()
    setMode('view')
  }

  const confirmLandmass = (): void => {
    if (!pendingLandmassPoints) return
    const landmass: MapLandmass = { id: crypto.randomUUID(), name: newLandmassName.trim(), points: pendingLandmassPoints, generated: false }
    updateFrontmatter({ landmasses: [...data.landmasses, landmass] })
    setPendingLandmassPoints(null)
    setNewLandmassName('')
    setMode('view')
  }
  const cancelLandmass = (): void => {
    setPendingLandmassPoints(null)
    setNewLandmassName('')
    setMode('view')
  }

  const confirmPin = (title: string): void => {
    if (!pendingPinPoint) return
    updateFrontmatter({
      pins: [...data.pins, { id: crypto.randomUUID(), x: pendingPinPoint.x, y: pendingPinPoint.y, locationTitle: title, label: '' }]
    })
    setPendingPinPoint(null)
    setMode('view')
  }
  // Places a pin with just a typed label, no linked location note — for
  // marking a spot to measure distance to/from without first creating a
  // full note for it.
  const confirmFreehandPin = (): void => {
    if (!pendingPinPoint || !pinQuery.trim()) return
    updateFrontmatter({
      pins: [...data.pins, { id: crypto.randomUUID(), x: pendingPinPoint.x, y: pendingPinPoint.y, locationTitle: null, label: pinQuery.trim() }]
    })
    setPendingPinPoint(null)
    setMode('view')
  }
  const cancelPin = (): void => {
    setPendingPinPoint(null)
    setMode('view')
  }

  const renamePin = (id: string, label: string): void => updateFrontmatter({ pins: data.pins.map((p) => (p.id === id ? { ...p, label } : p)) })
  const assignPinNamingStyle = (id: string, namingStyleId: string | null): void =>
    updateFrontmatter({ pins: data.pins.map((p) => (p.id === id ? { ...p, namingStyleId } : p)) })
  // A pin's own namingStyleId wins if set; otherwise it inherits whichever
  // territory polygon it falls inside (also settable in the Generate
  // panel's Civilizations section); otherwise a random style each roll.
  const resolveEffectivePlaceNameStyle = (pin: MapPin) => {
    if (pin.namingStyleId) return resolvePlaceNameStyle(pin.namingStyleId)
    const territory = data.territories.find((t) => pointInPolygon({ x: pin.x, y: pin.y }, t.points))
    return resolvePlaceNameStyle(territory?.namingStyleId ?? null)
  }
  const regeneratePinName = (pin: MapPin): void => renamePin(pin.id, generatePlaceName(resolveEffectivePlaceNameStyle(pin)))

  // "Generate settlement from pin" (map generation plan, Phase 4): a
  // generated-but-unlinked pin (a placeholder city name dropped by the
  // Civilizations generator) becomes a real Settlement note. Which
  // settlement-preset note to generate FROM is resolved from whichever
  // territory polygon this pin falls inside — see the Civilizations
  // section's per-territory preset picker in MapGenerationPanel.tsx, which
  // is exactly what feeds presetNoteTitle here. Ported from MapForm.tsx's
  // fetch-based version, using noteRefApi's title-resolution/createNote
  // instead of direct API calls.
  const generateSettlementFromPin = async (pin: MapPin): Promise<void> => {
    setSettlementGenError(null)
    const territory = data.territories.find((t) => pointInPolygon({ x: pin.x, y: pin.y }, t.points))
    if (!territory?.presetNoteTitle) {
      setSettlementGenError(
        `"${pin.label}" isn't inside a territory with a settlement preset assigned yet — assign one in the Generate panel's Civilizations section.`
      )
      return
    }
    setGeneratingSettlementPinId(pin.id)
    try {
      const frontmatter = await noteRefApi.readFrontmatterByTitle(territory.presetNoteTitle, 'settlement-preset')
      if (!frontmatter) throw new Error(`Settlement preset "${territory.presetNoteTitle}" no longer exists.`)
      const parsed = settlementPresetFrontmatterSchema.safeParse(frontmatter)
      if (!parsed.success) throw new Error(`"${territory.presetNoteTitle}" doesn't look like a valid settlement preset.`)

      // presetFieldsFromPreset carries targetPopulation (the preset's own
      // field name) but generateSettlement's GenerationOptions calls the
      // same concept population — split it out rather than leaning on
      // spread's excess-property leniency.
      const presetFields = presetFieldsFromPreset(parsed.data)
      const { targetPopulation, ...forGeneration } = presetFields
      const result = generateSettlement({
        ...forGeneration,
        population: targetPopulation,
        inspirationSources: NAME_INSPIRATION_SOURCES,
        phoneticProfiles: PHONETIC_PROFILES
      })

      const created = await noteRefApi.createNote(pin.label.trim() || 'Generated Settlement', {
        ...defaultSettlementFrontmatter(),
        ...presetFields,
        buildings: result.buildings,
        residents: result.residents,
        factions: result.factions
      })

      updateFrontmatter({ pins: data.pins.map((p) => (p.id === pin.id ? { ...p, locationTitle: created.title } : p)) })
    } catch (err) {
      setSettlementGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setGeneratingSettlementPinId(null)
    }
  }

  const updateTerrainType = (id: string, patch: Partial<TerrainType>): void =>
    updateFrontmatter({ terrainTypes: data.terrainTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const updateLineType = (id: string, patch: Partial<LineType>): void =>
    updateFrontmatter({ lineTypes: data.lineTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const removeZone = (id: string): void => updateFrontmatter({ zones: data.zones.filter((z) => z.id !== id) })
  const removeLine = (id: string): void => updateFrontmatter({ lines: data.lines.filter((l) => l.id !== id) })
  const removeLandmass = (id: string): void => updateFrontmatter({ landmasses: data.landmasses.filter((l) => l.id !== id) })
  const removeTerrainType = (id: string): void =>
    updateFrontmatter({
      terrainTypes: data.terrainTypes.filter((t) => t.id !== id),
      // Clear a dangling water-terrain reference so the picker below falls
      // back to "None" instead of pointing at a terrain type that no longer
      // exists.
      waterTerrainTypeId: data.waterTerrainTypeId === id ? null : data.waterTerrainTypeId
    })
  const removeLineType = (id: string): void => updateFrontmatter({ lineTypes: data.lineTypes.filter((t) => t.id !== id) })
  const removePin = (id: string): void => updateFrontmatter({ pins: data.pins.filter((p) => p.id !== id) })

  const terrainNameById = new Map(data.terrainTypes.map((t) => [t.id, t.name]))
  const lineTypeNameById = new Map(data.lineTypes.map((t) => [t.id, t.name]))

  // 'manual' mode uses data.scale (the clicked calibration) directly, same
  // as always. 'latitude' mode derives its own scale fresh every render from
  // topLatitude/bottomLatitude/planetCircumference instead — deliberately
  // NOT written back into data.scale, so switching modes back and forth to
  // compare never overwrites either mode's own settings (a manual
  // calibration survives a detour through 'latitude' mode, and vice versa).
  // Both null/None until all three latitude-mode inputs are filled in.
  // Working canvas dimensions, independent of whether there's an uploaded
  // raster: an uploaded image is still the source of truth for size when
  // present (unchanged behavior), but a purely-generated map with no image
  // falls back to canvasSize instead — see map.ts's canvasSize field.
  const workingDims = data.image ? { width: data.image.width, height: data.image.height } : data.canvasSize
  // True once there's something to actually draw a canvas over: an image
  // that's finished loading its signed/local URL, or a generated-only
  // canvas size (which needs no async load at all).
  const canvasReady = workingDims !== null && (!data.image || imageUrl !== null)

  const derivedScale =
    data.scaleMode === 'latitude' && data.topLatitude !== null && data.bottomLatitude !== null && data.planetCircumference && workingDims
      ? deriveScaleFromLatitudeSpan(data.topLatitude, data.bottomLatitude, data.planetCircumference, workingDims.height, data.latitudeUnit)
      : null
  const derivedEquatorY =
    data.scaleMode === 'latitude' && data.topLatitude !== null && data.bottomLatitude !== null
      ? deriveEquatorY(data.topLatitude, data.bottomLatitude, workingDims?.height ?? 0)
      : null
  // The scale actually used everywhere else (Trip Calculator, the
  // line-drawing crossing-time preview, etc.) — threaded through explicitly
  // rather than having every consumer read data.scale directly, since in
  // 'latitude' mode the real scale is derived, not stored.
  const effectiveScale = data.scaleMode === 'latitude' ? derivedScale : data.scale

  const activeBoundaryMask: Point[] | null =
    boundarySource === 'landmass' ? (data.landmasses.find((l) => l.id === selectedLandmassId)?.points ?? null) : boundarySource === 'custom' ? customBoundaryMask : null

  const [showLandmasses, setShowLandmasses] = useState(true)
  const [showZones, setShowZones] = useState(true)
  const [showLines, setShowLines] = useState(true)
  const [showPins, setShowPins] = useState(true)
  const [showClimateZones, setShowClimateZones] = useState(true)
  const [showTerritories, setShowTerritories] = useState(true)
  const [canvasWidthInput, setCanvasWidthInput] = useState('1000')
  const [canvasHeightInput, setCanvasHeightInput] = useState('1000')

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={() => void handleUploadImage()} disabled={uploading}>
          {uploading ? 'Uploading…' : data.image ? 'Replace image' : 'Upload image'}
        </button>
        {uploadError && <span className="right-panel-note">{uploadError}</span>}
      </div>

      {/* A map doesn't need an uploaded raster at all — this is the entry
          point for a purely-generated map (see the procedural map generation
          plan). Only offered while there's neither an image nor a canvas
          size yet; once canvasSize is set, the rest of the editor treats it
          exactly like an image-backed map (see workingDims/canvasReady). */}
      {!data.image && !data.canvasSize && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
          <label className="sheet-field">
            Width (px)
            <input type="number" value={canvasWidthInput} onChange={(e) => setCanvasWidthInput(e.target.value)} style={{ width: 90 }} />
          </label>
          <label className="sheet-field">
            Height (px)
            <input type="number" value={canvasHeightInput} onChange={(e) => setCanvasHeightInput(e.target.value)} style={{ width: 90 }} />
          </label>
          <button
            onClick={() => {
              const width = Number(canvasWidthInput)
              const height = Number(canvasHeightInput)
              if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
                updateFrontmatter({ canvasSize: { width, height } })
              }
            }}
          >
            Start blank map (no image)
          </button>
          <p className="right-panel-note" style={{ flexBasis: '100%' }}>
            For a map you&apos;ll fill in with the generator instead of an uploaded image.
          </p>
        </div>
      )}

      {canvasReady && workingDims && (
        <>
          <div className="editor-toolbar">
            <button className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>
              View
            </button>
            {data.scaleMode === 'manual' && (
              <button className={mode === 'calibrate' ? 'active' : ''} onClick={() => setMode('calibrate')}>
                Calibrate Scale
              </button>
            )}
            <button className={mode === 'paint-zone' ? 'active' : ''} onClick={() => setMode('paint-zone')}>
              Paint Terrain
            </button>
            <button className={mode === 'draw-line' ? 'active' : ''} onClick={() => setMode('draw-line')}>
              Draw Line
            </button>
            <button className={mode === 'paint-landmass' ? 'active' : ''} onClick={() => setMode('paint-landmass')}>
              Draw Landmass
            </button>
            <button className={mode === 'place-pin' ? 'active' : ''} onClick={() => setMode('place-pin')}>
              Place Pin
            </button>
          </div>

          <div className="sheet-row" style={{ alignItems: 'center', marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={data.wrapsHorizontally}
                onChange={(e) => updateFrontmatter({ wrapsHorizontally: e.target.checked })}
              />
              Wraps left/right edge
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={data.wrapsVertically}
                onChange={(e) => updateFrontmatter({ wrapsVertically: e.target.checked })}
              />
              Wraps top/bottom edge
            </label>
            {(data.wrapsHorizontally || data.wrapsVertically) && (
              <span className="right-panel-note">
                The trip calculator will consider going off a wrapping edge and reappearing on the opposite one, if that's shorter.
                You can also draw your own route across a wrapping edge — pan/zoom out past the edge in "Draw custom route" and
                place points out there; the trip calculator folds them back onto the opposite edge automatically.
              </span>
            )}
          </div>

          {/* Two independent, switchable scale systems rather than one
              system with optional extra fields — 'manual' is exactly the
              original click-to-calibrate flow (no latitude concept at all,
              for anyone who doesn't want the extra complexity), 'latitude'
              replaces both Calibrate Scale and manually placing the equator
              with three plain numbers that derive everything else. Switching
              between them never destroys either mode's own settings, so
              it's safe to toggle back and forth to compare. */}
          <div className="editor-toolbar" style={{ marginBottom: 8 }}>
            <button
              className={data.scaleMode === 'manual' ? 'active' : ''}
              onClick={() => {
                updateFrontmatter({ scaleMode: 'manual' })
                if (mode === 'calibrate') setMode('view')
              }}
            >
              Simple scale
            </button>
            <button className={data.scaleMode === 'latitude' ? 'active' : ''} onClick={() => updateFrontmatter({ scaleMode: 'latitude' })}>
              Realistic (latitude-based) scale
            </button>
          </div>

          {data.scaleMode === 'latitude' && (
            <>
              <div className="sheet-row" style={{ alignItems: 'center', marginBottom: 8 }}>
                <label className="sheet-field sheet-field-narrow">
                  Top edge latitude
                  <input
                    type="number"
                    value={data.topLatitude ?? ''}
                    onChange={(e) => updateFrontmatter({ topLatitude: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="e.g. 65"
                  />
                </label>
                <label className="sheet-field sheet-field-narrow">
                  Bottom edge latitude
                  <input
                    type="number"
                    value={data.bottomLatitude ?? ''}
                    onChange={(e) => updateFrontmatter({ bottomLatitude: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="e.g. 10"
                  />
                </label>
                <label className="sheet-field">
                  Planet circumference ({data.latitudeUnit})
                  <input
                    type="number"
                    value={data.planetCircumference ?? ''}
                    onChange={(e) =>
                      updateFrontmatter({ planetCircumference: e.target.value === '' ? null : Number(e.target.value) })
                    }
                    placeholder="e.g. 24901"
                  />
                </label>
                <label className="sheet-field sheet-field-narrow">
                  Unit
                  <input
                    value={data.latitudeUnit}
                    onChange={(e) => updateFrontmatter({ latitudeUnit: e.target.value || 'miles' })}
                    placeholder="miles"
                  />
                </label>
              </div>
              <div className="sheet-row" style={{ alignItems: 'center', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={data.accountForLatitudeDistortion}
                    disabled={derivedEquatorY === null || !data.planetCircumference}
                    onChange={(e) => updateFrontmatter({ accountForLatitudeDistortion: e.target.checked })}
                  />
                  Account for planet curvature
                </label>
              </div>
              {(data.topLatitude === null || data.bottomLatitude === null || !data.planetCircumference) && (
                <p className="right-panel-note">
                  Set the latitude at this image's top and bottom edges, plus the planet's circumference, to derive scale and
                  the equator's position automatically — works the same whether this image depicts the whole world (e.g. 90 /
                  -90) or just one region (e.g. 65 / 10), no separate toggle needed. Once all three are set, the curvature
                  option above becomes available: it approximates how a flat map exaggerates east-west distance away from the
                  equator (same reason Greenland looks continent-sized on real-world flat maps). North-south distance and
                  every terrain/road/river you've already drawn are unaffected either way.
                </p>
              )}
            </>
          )}

          {mode === 'calibrate' && pendingPixelDistance === null && (
            <p className="right-panel-note">Click two points a known real-world distance apart.</p>
          )}
          {mode === 'paint-zone' && !pendingZonePoints && (
            <p className="right-panel-note">Click to add vertices, press Enter to finish (3+ points), Escape to cancel.</p>
          )}
          {mode === 'draw-line' && !pendingLinePoints && (
            <p className="right-panel-note">
              Click to add points along a road, path, or river, press Enter to finish (2+ points), Escape to cancel.
            </p>
          )}
          {mode === 'paint-landmass' && !pendingLandmassPoints && (
            <p className="right-panel-note">
              Click to trace a continent or island's outline, press Enter to finish (3+ points), Escape to cancel. Anything outside
              every landmass is treated as water.
            </p>
          )}
          {mode === 'draw-trip' && (
            <p className="right-panel-note">
              Click to trace the actual route you'd travel — it doesn't need to be straight, and doesn't need to start/end on a pin
              (e.g. walk to a dock, cross the water, walk again). Press Enter to finish (2+ points), Escape to cancel.
            </p>
          )}
          {mode === 'place-pin' && !pendingPinPoint && <p className="right-panel-note">Click a spot on the map to place a pin.</p>}
          {mode === 'select-region' && (
            <p className="right-panel-note">Click to trace the region to constrain generation to, press Enter to finish (3+ points), Escape to cancel.</p>
          )}

          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showLandmasses} onChange={(e) => setShowLandmasses(e.target.checked)} />
              Landmasses
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />
              Terrain
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
              Lines
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showPins} onChange={(e) => setShowPins(e.target.checked)} />
              Pins
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showClimateZones} onChange={(e) => setShowClimateZones(e.target.checked)} />
              Climate
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={showTerritories} onChange={(e) => setShowTerritories(e.target.checked)} />
              Territories
            </label>
          </div>

          <div style={{ position: 'relative', height: 864, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <MapCanvas
              imageUrl={imageUrl ?? undefined}
              imageWidth={workingDims.width}
              imageHeight={workingDims.height}
              zones={data.zones}
              lines={data.lines}
              landmasses={data.landmasses}
              pins={data.pins}
              terrainTypes={data.terrainTypes}
              lineTypes={data.lineTypes}
              climateZones={data.climateZones}
              climateTypes={data.climateTypes}
              territories={data.territories}
              mode={mode}
              onCalibrate={setPendingPixelDistance}
              onZoneDrawn={setPendingZonePoints}
              onLineDrawn={setPendingLinePoints}
              onLandmassDrawn={setPendingLandmassPoints}
              onTripDrawn={(points) => {
                setDrawnTripPath(points)
                // Drawing a route implies showing it — no reason to hide what
                // you just traced. Folded the same way MapTripCalculator does
                // (see its effectiveLegs) rather than shown as one raw
                // connected leg — otherwise a route that strays past a
                // wrapping edge would render as a single line trailing off
                // into blank space until the Trip Calculator happened to
                // recompute it.
                const legs =
                  data.wrapsHorizontally || data.wrapsVertically
                    ? foldDrawnPathAtWraps(points, {
                        mapWidth: workingDims.width,
                        mapHeight: workingDims.height,
                        wrapsHorizontally: data.wrapsHorizontally,
                        wrapsVertically: data.wrapsVertically
                      })
                    : [points]
                setTripOverlayPath(legs)
                setMode('view')
              }}
              onPinPlaced={(point) => {
                setPendingPinPoint(point)
                setPinQuery('')
                setPinResults([])
              }}
              onPinClick={(pin) => pin.locationTitle && void noteRefApi.openByTitle(pin.locationTitle, 'location')}
              onRegionDrawn={(points) => {
                setCustomBoundaryMask(points)
                setBoundarySource('custom')
                setMode('view')
              }}
              boundaryMask={activeBoundaryMask}
              highlightedPinIds={highlightedPinIds}
              tripPath={tripOverlayPath}
              equatorY={derivedEquatorY}
              wrapsHorizontally={data.wrapsHorizontally}
              wrapsVertically={data.wrapsVertically}
              showLandmasses={showLandmasses}
              showZones={showZones}
              showLines={showLines}
              showPins={showPins}
              showClimateZones={showClimateZones}
              showTerritories={showTerritories}
            />
          </div>

          {pendingPixelDistance !== null && (
            <div className="sheet-row" style={{ marginTop: 8 }}>
              <label className="sheet-field sheet-field-narrow">
                Real distance
                <input type="number" value={realDistanceInput} onChange={(e) => setRealDistanceInput(e.target.value)} autoFocus />
              </label>
              <label className="sheet-field sheet-field-narrow">
                Unit
                <input value={unitInput} onChange={(e) => setUnitInput(e.target.value)} placeholder="miles" />
              </label>
              <button className="sheet-open-ref-button" onClick={confirmCalibration}>
                Set scale
              </button>
              <button className="sheet-open-ref-button" onClick={cancelCalibration}>
                Cancel
              </button>
            </div>
          )}

          {pendingZonePoints && (
            <div className="sheet-row" style={{ marginTop: 8 }}>
              <label className="sheet-field">
                Terrain type
                <select value={terrainChoice} onChange={(e) => setTerrainChoice(e.target.value)}>
                  <option value="">Choose…</option>
                  {data.terrainTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value="__new__">+ New terrain type…</option>
                </select>
              </label>
              {terrainChoice === '__new__' && (
                <>
                  <label className="sheet-field">
                    Name
                    <input value={newTerrainName} onChange={(e) => setNewTerrainName(e.target.value)} placeholder="Forest" />
                  </label>
                  <label className="sheet-field sheet-field-narrow">
                    Color
                    <input type="color" value={newTerrainColor} onChange={(e) => setNewTerrainColor(e.target.value)} />
                  </label>
                  <label className="sheet-field sheet-field-narrow">
                    Speed x
                    <input type="number" step="0.1" value={newTerrainMultiplier} onChange={(e) => setNewTerrainMultiplier(Number(e.target.value))} />
                  </label>
                </>
              )}
              <button className="sheet-open-ref-button" onClick={confirmZone}>
                Add zone
              </button>
              <button className="sheet-open-ref-button" onClick={cancelZone}>
                Cancel
              </button>
            </div>
          )}

          {pendingLinePoints && (
            <div style={{ marginTop: 8 }}>
              <div className="sheet-row">
                <label className="sheet-field">
                  Line type
                  <select value={terrainChoice} onChange={(e) => setTerrainChoice(e.target.value)}>
                    <option value="">Choose…</option>
                    {data.lineTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                    <option value="__new__">+ New line type…</option>
                  </select>
                </label>
                {terrainChoice === '__new__' && (
                  <>
                    <label className="sheet-field">
                      Name
                      <input value={newTerrainName} onChange={(e) => setNewTerrainName(e.target.value)} placeholder="Road" />
                    </label>
                    <label className="sheet-field sheet-field-narrow">
                      Color
                      <input type="color" value={newTerrainColor} onChange={(e) => setNewTerrainColor(e.target.value)} />
                    </label>
                    <label className="sheet-field sheet-field-narrow">
                      Speed x
                      <input type="number" step="0.1" value={newTerrainMultiplier} onChange={(e) => setNewTerrainMultiplier(Number(e.target.value))} />
                    </label>
                  </>
                )}
                <label className="sheet-field sheet-field-narrow">
                  Width (px)
                  <input type="number" value={lineWidthInput} onChange={(e) => setLineWidthInput(Number(e.target.value))} />
                </label>
                <button className="sheet-open-ref-button" onClick={confirmLine}>
                  Add line
                </button>
                <button className="sheet-open-ref-button" onClick={cancelLine}>
                  Cancel
                </button>
              </div>

              {effectiveScale && previewMultiplier !== undefined && travelModes.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <span className="right-panel-note">Approx. time to cross this width, per travel mode:</span>
                  <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
                    <tbody>
                      {travelModes.map((mode) => {
                        const time = crossingTime(lineWidthInput, effectiveScale, previewMultiplier, mode)
                        const normal = crossingTime(lineWidthInput, effectiveScale, 1, mode)
                        const delta = time - normal
                        return (
                          <tr key={mode.id}>
                            <td style={{ paddingRight: 12 }}>{mode.name}</td>
                            <td style={{ paddingRight: 12 }}>{time === Infinity ? 'impassable' : `${time.toFixed(1)} ${mode.timeUnitLabel}`}</td>
                            <td>
                              {time === Infinity
                                ? ''
                                : `(${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ${mode.timeUnitLabel} vs. normal ground)`}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!effectiveScale && (
                <p className="right-panel-note">
                  {data.scaleMode === 'latitude' ? 'Fill in the latitude/circumference fields above' : "Calibrate this map's scale"}{' '}
                  to preview crossing times.
                </p>
              )}
            </div>
          )}

          {pendingLandmassPoints && (
            <div className="sheet-row" style={{ marginTop: 8 }}>
              <label className="sheet-field">
                Name (optional)
                <input value={newLandmassName} onChange={(e) => setNewLandmassName(e.target.value)} placeholder="The Old Continent" autoFocus />
              </label>
              <button className="sheet-open-ref-button" onClick={confirmLandmass}>
                Add landmass
              </button>
              <button className="sheet-open-ref-button" onClick={cancelLandmass}>
                Cancel
              </button>
            </div>
          )}

          {pendingPinPoint && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input
                value={pinQuery}
                onChange={(e) => setPinQuery(e.target.value)}
                placeholder="Search existing location notes, or type any label…"
                autoFocus
              />
              {pinResults.map((r) => (
                <button key={r.title} onClick={() => confirmPin(r.title)} style={{ textAlign: 'left' }}>
                  {r.title} (linked note)
                </button>
              ))}
              <button onClick={confirmFreehandPin} disabled={!pinQuery.trim()} style={{ textAlign: 'left' }}>
                Just place a pin here labeled "{pinQuery.trim() || '…'}" (no note)
              </button>
              <p className="right-panel-note">A freehand pin has no linked note — it still works in the trip calculator, just nothing to open.</p>
              <button onClick={cancelPin}>Cancel</button>
            </div>
          )}

          <MapGenerationPanel
            data={data}
            noteName={noteName}
            workingDims={workingDims}
            updateFrontmatter={updateFrontmatter}
            noteRefApi={noteRefApi}
            boundarySource={boundarySource}
            setBoundarySource={setBoundarySource}
            selectedLandmassId={selectedLandmassId}
            setSelectedLandmassId={setSelectedLandmassId}
            activeBoundaryMask={activeBoundaryMask}
            onStartDrawingRegion={() => setMode('select-region')}
            onClearCustomRegion={() => {
              setCustomBoundaryMask(null)
              if (boundarySource === 'custom') setBoundarySource('whole-map')
            }}
          />
        </>
      )}

      {data.terrainTypes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Terrain types</strong>
          <p className="right-panel-note">
            For painted regions (Paint Terrain) — edit anytime, including the seeded Mountains/Forest defaults.
          </p>
          {data.terrainTypes.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              <input type="color" value={t.color} onChange={(e) => updateTerrainType(t.id, { color: e.target.value })} />
              <input style={{ flex: 2 }} value={t.name} onChange={(e) => updateTerrainType(t.id, { name: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                Speed x
                <input
                  style={{ width: 60 }}
                  type="number"
                  step="0.1"
                  value={t.speedMultiplier}
                  onChange={(e) => updateTerrainType(t.id, { speedMultiplier: Number(e.target.value) })}
                />
              </label>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                title="Treats any zone painted with this terrain type as real, known-elevated ground when generating climate — informs the alpine gate and rain-shadow moisture instead of inventing unrelated elevation from noise."
              >
                <input
                  type="checkbox"
                  checked={t.climateElevationOverride !== null}
                  onChange={(e) => updateTerrainType(t.id, { climateElevationOverride: e.target.checked ? 0.85 : null })}
                />
                Elevated
              </label>
              {t.climateElevationOverride !== null && (
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  style={{ width: 60 }}
                  value={t.climateElevationOverride}
                  onChange={(e) => updateTerrainType(t.id, { climateElevationOverride: Number(e.target.value) })}
                  title="Elevation (0-1) — 0.72+ reads as alpine; lower values still inform rain-shadow moisture without crossing that gate."
                />
              )}
              <button onClick={() => removeTerrainType(t.id)} title="Delete terrain type">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {data.lineTypes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Line types</strong>
          <p className="right-panel-note">
            For roads, paths, and rivers (Draw Line) — edit anytime, including the seeded Road/Path/River defaults.
          </p>
          {data.lineTypes.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <input type="color" value={t.color} onChange={(e) => updateLineType(t.id, { color: e.target.value })} />
              <input style={{ flex: 2 }} value={t.name} onChange={(e) => updateLineType(t.id, { name: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                Speed x
                <input
                  style={{ width: 60 }}
                  type="number"
                  step="0.1"
                  value={t.speedMultiplier}
                  onChange={(e) => updateLineType(t.id, { speedMultiplier: Number(e.target.value) })}
                />
              </label>
              <button onClick={() => removeLineType(t.id)} title="Delete line type">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {data.zones.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Terrain zones ({data.zones.length})</summary>
          {data.zones.map((zone) => (
            <div key={zone.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: data.terrainTypes.find((t) => t.id === zone.terrainTypeId)?.color ?? '#888'
                }}
              />
              <span>{terrainNameById.get(zone.terrainTypeId) ?? 'Unknown terrain'}</span>
              <button onClick={() => removeZone(zone.id)}>✕</button>
            </div>
          ))}
        </details>
      )}

      {data.lines.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Lines (roads, paths, rivers) ({data.lines.length})</summary>
          {data.lines.map((line) => (
            <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: data.lineTypes.find((t) => t.id === line.lineTypeId)?.color ?? '#888'
                }}
              />
              <span>
                {lineTypeNameById.get(line.lineTypeId) ?? 'Unknown line type'} ({line.widthPixels}px wide)
              </span>
              <button onClick={() => removeLine(line.id)}>✕</button>
            </div>
          ))}
        </details>
      )}

      {data.landmasses.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Landmasses (continents/islands) ({data.landmasses.length})</summary>
          <p className="right-panel-note">
            Anything outside every landmass boundary below is treated as water, using the "Water terrain" pick below (or normal
            1x speed if none is set) — unless it's covered by its own painted zone or line.
          </p>
          {data.landmasses.map((landmass) => (
            <div key={landmass.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span
                style={{ width: 10, height: 10, borderRadius: '50%', border: '2px dashed #2a6f97' }}
              />
              <span>{landmass.name || 'Unnamed landmass'}</span>
              <button onClick={() => removeLandmass(landmass.id)}>✕</button>
            </div>
          ))}
          <label className="sheet-field" style={{ marginTop: 6, maxWidth: 260 }}>
            Water terrain
            <select
              value={data.waterTerrainTypeId ?? ''}
              onChange={(e) => updateFrontmatter({ waterTerrainTypeId: e.target.value || null })}
            >
              <option value="">None (water = normal 1x speed)</option>
              {data.terrainTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {!data.waterTerrainTypeId && (
            <p className="right-panel-note">
              Don't see the terrain you want (e.g. "Ocean")? Use Paint Terrain to draw one small zone with a "+ New terrain
              type…" (anywhere, even somewhere you'll delete afterward) — the terrain type itself stays available here even
              after you remove that zone.
            </p>
          )}
        </details>
      )}

      {data.pins.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Pins ({data.pins.length})</summary>
          {data.pins.map((pin) =>
            pin.locationTitle ? (
              <div key={pin.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <button onClick={() => void noteRefApi.openByTitle(pin.locationTitle!, 'location')} style={{ textAlign: 'left' }}>
                  {pin.locationTitle}
                </button>
                <button onClick={() => removePin(pin.id)}>✕</button>
              </div>
            ) : (
              <div key={pin.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input style={{ width: 144 }} value={pin.label} onChange={(e) => renamePin(pin.id, e.target.value)} placeholder="(no note)" />
                {pin.generated && (
                  <>
                    <select
                      value={pin.namingStyleId ?? ''}
                      onChange={(e) => assignPinNamingStyle(pin.id, e.target.value || null)}
                      title="Naming style for this pin — overrides its territory's style"
                    >
                      <option value="">Inherit territory&apos;s style</option>
                      {PLACE_NAME_STYLES.map((style) => (
                        <option key={style.id} value={style.id}>
                          {style.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => regeneratePinName(pin)} title="Regenerate this pin's name">
                      🎲
                    </button>
                    <button disabled={generatingSettlementPinId === pin.id} onClick={() => void generateSettlementFromPin(pin)}>
                      {generatingSettlementPinId === pin.id ? 'Generating…' : 'Generate settlement'}
                    </button>
                  </>
                )}
                <button onClick={() => removePin(pin.id)}>✕</button>
              </div>
            )
          )}
          {settlementGenError && <p className="right-panel-note">{settlementGenError}</p>}
        </details>
      )}

      <details style={{ marginTop: 12 }}>
        <summary>Trip calculator</summary>
        <MapTripCalculator
          pins={data.pins}
          zones={data.zones}
          lines={data.lines}
          terrainTypes={data.terrainTypes}
          lineTypes={data.lineTypes}
          landmasses={data.landmasses}
          waterTerrainTypeId={data.waterTerrainTypeId}
          scale={effectiveScale}
          image={workingDims}
          wrapsHorizontally={data.wrapsHorizontally}
          wrapsVertically={data.wrapsVertically}
          equatorY={derivedEquatorY}
          planetCircumference={data.planetCircumference}
          accountForLatitudeDistortion={data.accountForLatitudeDistortion}
          drawnPath={drawnTripPath}
          onClearDrawnPath={() => {
            setDrawnTripPath(null)
            setTripOverlayPath(null)
          }}
          onStartDrawing={() => setMode('draw-trip')}
          onShowPathChange={setTripOverlayPath}
        />
      </details>

      <details style={{ marginTop: 8 }} onToggle={(e) => !e.currentTarget.open && setHighlightedPinIds(new Set())}>
        <summary>Timeline</summary>
        <MapTimeline
          pins={data.pins}
          zones={data.zones}
          lines={data.lines}
          terrainTypes={data.terrainTypes}
          lineTypes={data.lineTypes}
          landmasses={data.landmasses}
          waterTerrainTypeId={data.waterTerrainTypeId}
          scale={effectiveScale}
          noteRefApi={noteRefApi}
          onHighlightChange={setHighlightedPinIds}
        />
      </details>

      <details style={{ marginTop: 8 }}>
        <summary>Travel modes (shared across all maps)</summary>
        <TravelModesEditor />
      </details>
    </div>
  )
}
