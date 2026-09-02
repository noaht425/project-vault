import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clampViewBoxWidth,
  foldDrawnPathAtWraps,
  foldPoint,
  lodForZoom,
  polygonCentroid,
  segmentDistance,
  viewZoom,
  type MapLod,
  type Point,
  type WrapConfig
} from '../../../../common/mapGeometry'
import {
  pinDisplayLabel,
  type CityBoundary,
  type ClimateType,
  type ClimateZone,
  type LineType,
  type MapLandmass,
  type MapLine,
  type MapPin,
  type MapZone,
  type TerrainType,
  type Territory
} from '../../../../common/noteTypes/map'

export type MapCanvasMode =
  | 'view'
  | 'calibrate'
  | 'paint-zone'
  | 'draw-line'
  | 'paint-landmass'
  | 'draw-trip'
  | 'place-pin'
  | 'select-region'
  | 'paint-territory'

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

// The live pan/zoom state, handed to onViewChange and the cityLayer render
// prop (Phase 7.0). `zoom` is image-width / viewBox-width (1 = whole image
// fits, larger = closer in); `lod` is the derived far/mid/near bucket a
// city-scale layer uses to decide how much to draw (silhouettes when far,
// building footprints and street labels only when near). See mapGeometry's
// viewZoom / lodForZoom.
export interface MapCanvasView {
  zoom: number
  lod: MapLod
  viewBox: ViewBox
}

// Button/keyboard zoom step — one notch multiplies the viewBox size by this
// (zoom out) or its inverse (zoom in). The wheel uses its own gentler 0.9/
// 1.1, so it isn't quantised to this.
const ZOOM_STEP = 1.25

// Footprint tint by the building type's category (Phase 7.4) — the same
// "each type gets a colour" idea terrain types use, keyed off the five
// settlement building categories.
const BUILDING_CATEGORY_COLORS: Record<string, string> = {
  residence: '#a98d6b',
  shop: '#c99b52',
  civic: '#6f8fb0',
  religious: '#9a7bb0',
  tavern: '#c9793c'
}

// Below this many screen pixels of movement, a mousedown+mouseup is treated
// as a click (place a point / open a pin) rather than a pan drag — lets
// panning and click-to-place share the same background without a separate
// "pan mode" toggle.
const CLICK_MOVEMENT_THRESHOLD = 4

// The SVG's default preserveAspectRatio ("xMidYMid meet") scales the
// viewBox uniformly to fit inside the element's rendered box and centers
// it — whenever that box's aspect ratio doesn't match the viewBox's (near
// -guaranteed here, since the container is a fixed-height panel but the
// viewBox tracks the uploaded image's own dimensions), that leaves a
// letterboxed margin on two sides. A naive clientX/rect.width * viewBox.w
// conversion ignores that margin entirely, so every click lands offset
// from the cursor by however wide the margin is. This computes the actual
// on-screen scale and margin so click/pan/zoom math can subtract it out —
// deliberately not "fixed" by setting preserveAspectRatio="none" instead,
// since that would stretch the map image itself to fill the box.
function getViewportTransform(rect: DOMRect, viewBox: ViewBox): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h)
  return {
    scale,
    offsetX: (rect.width - viewBox.w * scale) / 2,
    offsetY: (rect.height - viewBox.h * scale) / 2
  }
}

export interface MapCanvasProps {
  // Empty/absent for a purely-generated map with no uploaded raster — the
  // <image> element is skipped entirely in that case, but the SVG's
  // coordinate space (driven by imageWidth/imageHeight) still applies, so
  // zones/lines/landmasses/pins render exactly as they would over a raster.
  // See MapSheet's dimension resolution (data.canvasSize ?? data.image).
  imageUrl?: string
  imageWidth: number
  imageHeight: number
  zones: MapZone[]
  lines: MapLine[]
  landmasses: MapLandmass[]
  pins: MapPin[]
  terrainTypes: TerrainType[]
  lineTypes: LineType[]
  climateZones?: ClimateZone[]
  climateTypes?: ClimateType[]
  territories?: Territory[]
  mode: MapCanvasMode
  onCalibrate: (pixelDistance: number) => void
  onZoneDrawn: (points: Point[]) => void
  onLineDrawn: (points: Point[]) => void
  onLandmassDrawn: (points: Point[]) => void
  // 'paint-territory' mode — a hand-drawn national/civilization border,
  // same multi-point click/Enter/Escape flow as paint-landmass. Optional
  // since callers that predate this mode never pass it.
  onTerritoryDrawn?: (points: Point[]) => void
  onTripDrawn: (points: Point[]) => void
  onPinPlaced: (point: Point) => void
  onPinClick: (pin: MapPin) => void
  // "select-region" mode's own drawn boundary (Phase 5 — augment/drilldown
  // boundary selection) — same multi-point click/Finish/Clear flow as
  // paint-landmass, just producing a boundaryMask instead of a real
  // landmass. Optional since most callers (nothing pre-Phase-5) never use
  // this mode.
  onRegionDrawn?: (points: Point[]) => void
  // The CURRENTLY ACTIVE boundary constraint (from an existing landmass or
  // a confirmed select-region draft) — rendered as a persistent highlighted
  // overlay whenever set, regardless of mode, so it's clear what area
  // "Generate" is about to be scoped to even after leaving select-region
  // mode. Distinct from the in-progress regionDraft (which only renders
  // while mode === 'select-region').
  boundaryMask?: Point[] | null
  // Pin ids to ring in an accent color — used by the Timeline section to
  // show which locations have a revealed event as the slider moves.
  // Optional since only that one caller needs it.
  highlightedPinIds?: Set<string>
  // The Trip Calculator's currently active route (straight pin-to-pin, a
  // hand-drawn path, or a wrapped route) — rendered as an overlay regardless
  // of the current drawing mode, so it stays visible while you keep working
  // the map. Each entry is one contiguous leg, drawn as its own polyline —
  // a wrapped route has 2-3 legs (see mapGeometry.ts's wrapLegs) that jump
  // between opposite edges and must NOT be connected by a line straight
  // across the map. Null when nothing's being shown.
  tripPath?: Point[][] | null
  // Where latitude 0 currently is, in 'latitude' scale mode — derived from
  // topLatitude/bottomLatitude (see mapGeometry.ts's deriveEquatorY), not
  // set by clicking on the canvas. Drawn as a thin persistent reference line
  // whenever set, regardless of drawing mode. Null/undefined in 'manual'
  // scale mode, where no latitude concept exists at all.
  equatorY?: number | null
  // Whether the map's edges wrap — used only by 'draw-trip' mode here, to
  // fold the in-progress draft as it's drawn and preview where an
  // off-canvas cursor position would land before the user commits to a
  // click (see the ghost-preview rendering below). The actual trip math
  // lives in MapTripCalculator; this is purely visual feedback so drawing
  // a route across a wrapping edge isn't a guessing game.
  wrapsHorizontally?: boolean
  wrapsVertically?: boolean
  // Per-layer visibility — all default to visible, so every existing caller
  // (nothing passes these yet) renders identically to before. Added for the
  // procedural map generation feature's "toggle a layer on/off" panel; see
  // the plan's Phase 0. showClimateZones added in Phase 2, showTerritories
  // in Phase 3, each alongside its own layer.
  showLandmasses?: boolean
  showZones?: boolean
  showLines?: boolean
  showPins?: boolean
  showClimateZones?: boolean
  showTerritories?: boolean
  // The city-scale street map's outer footprint (Phase 7.1) — rendered as a
  // wall line when `walled`, a soft edge otherwise. Null / absent on every
  // non-city map. Later sub-phases render streets/buildings via cityLayer;
  // this is just the boundary itself.
  cityBoundary?: CityBoundary | null
  // District polygons for the linked settlement's own districts[] (Phase
  // 7.2) — rendered the same way territories are (tinted fill + name
  // label). The parent resolves these from the linked Settlement note;
  // empty/absent on every non-city map.
  cityDistricts?: { id: string; name: string; points: Point[]; color?: string }[]
  // Building footprints for the linked settlement's own buildings[] (Phase
  // 7.4) — small rotated rectangles tinted by the building type's category.
  // Only mounted at the closest LOD (a city has hundreds of them). The
  // parent resolves category from the settlement's buildingTypes[].
  cityBuildings?: { id: string; footprint: { x: number; y: number; width: number; height: number; rotationDegrees: number }; category: string }[]
  // Fired when a building footprint is clicked in view mode (Phase 7.5) —
  // the parent opens a detail panel for that building id.
  onBuildingClick?: (buildingId: string) => void
  // Fired whenever the view pans or zooms, with the derived zoom factor and
  // level-of-detail bucket (Phase 7.0). Optional — only the city-scale
  // street-map UI reacts to zoom; every existing caller ignores it.
  onViewChange?: (view: MapCanvasView) => void
  // Extra SVG content rendered above the base layers and below the pins /
  // draft overlays, given the live view so it can do its own level-of-
  // detail gating (district silhouettes when `view.lod` is "far", building
  // footprints and street labels only at "near"). The Phase 7.1+ city
  // layers plug in here, keeping MapCanvas ignorant of settlement/street
  // schemas.
  cityLayer?: (view: MapCanvasView) => React.ReactNode
}

export function MapCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  zones,
  lines,
  landmasses,
  pins,
  terrainTypes,
  lineTypes,
  climateZones = [],
  climateTypes = [],
  territories = [],
  mode,
  onCalibrate,
  onZoneDrawn,
  onLineDrawn,
  onLandmassDrawn,
  onTerritoryDrawn,
  onTripDrawn,
  onPinPlaced,
  onPinClick,
  onRegionDrawn,
  boundaryMask,
  highlightedPinIds,
  tripPath,
  equatorY,
  wrapsHorizontally = false,
  wrapsVertically = false,
  showLandmasses = true,
  showZones = true,
  showLines = true,
  showPins = true,
  showClimateZones = true,
  showTerritories = true,
  cityBoundary,
  cityDistricts = [],
  cityBuildings = [],
  onBuildingClick,
  onViewChange,
  cityLayer
}: MapCanvasProps): React.JSX.Element {
  const [viewBox, setViewBox] = useState<ViewBox>({ x: 0, y: 0, w: imageWidth, h: imageHeight })
  const [calibrationStart, setCalibrationStart] = useState<Point | null>(null)
  const [zoneDraft, setZoneDraft] = useState<Point[]>([])
  const [lineDraft, setLineDraft] = useState<Point[]>([])
  const [landmassDraft, setLandmassDraft] = useState<Point[]>([])
  const [territoryDraft, setTerritoryDraft] = useState<Point[]>([])
  const [tripDraft, setTripDraft] = useState<Point[]>([])
  const [regionDraft, setRegionDraft] = useState<Point[]>([])
  // Live cursor position while in 'draw-trip' mode — only used to preview
  // where an off-canvas point would land once folded (see the ghost marker
  // below); cleared on every mode change and whenever the cursor leaves the
  // canvas, same reasoning as the old equator-hover preview this replaces.
  const [drawHoverPoint, setDrawHoverPoint] = useState<Point | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  // The window-level mousemove/mouseup listeners below are only rebound
  // when viewBox.w/h change (not x/y — see that effect's comment), so a
  // handler invoked after a pure pan (x/y-only change) would otherwise
  // still be closed over the pre-pan viewBox. Reading through this ref
  // instead of the `viewBox` variable directly keeps clientToSvgPoint
  // correct regardless of when the listener closure was created, since the
  // ref's current value is always up to date at call time.
  const viewBoxRef = useRef(viewBox)
  useEffect(() => {
    viewBoxRef.current = viewBox
  }, [viewBox])

  // Same ref-for-a-closed-over-value trick as viewBoxRef above, but for a
  // different reason: pinElements below is memoized against [pins, mode,
  // highlightedPinIds, pinRadius] so hovering the map in draw-trip mode
  // (which updates drawHoverPoint every mousemove tick, see
  // handleMouseMoveForDrawTrip) doesn't rebuild every pin's JSX on every
  // tick — but handleClickAt/onPinClick would otherwise have to be in that
  // dep list too (they're fresh closures every render), which would defeat
  // the memo entirely. Reading them through a ref keeps the click handlers
  // correct without that.
  const handleClickAtRef = useRef<(point: Point) => void>(() => {})
  const onPinClickRef = useRef(onPinClick)
  onPinClickRef.current = onPinClick
  const onBuildingClickRef = useRef(onBuildingClick)
  onBuildingClickRef.current = onBuildingClick

  // Derived pan/zoom state (Phase 7.0). `zoom`/`lod` update on every pan or
  // zoom tick; `view` is memoised so its identity only changes when a field
  // actually does, keeping the onViewChange effect and cityLayer from
  // re-firing on unrelated renders.
  const zoom = viewZoom(imageWidth, viewBox.w)
  const lod = lodForZoom(zoom)
  const view = useMemo<MapCanvasView>(() => ({ zoom, lod, viewBox }), [zoom, lod, viewBox])

  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  useEffect(() => {
    onViewChangeRef.current?.(view)
  }, [view])

  // Zoom the view by `factor` (>1 zooms out, <1 zooms in), keeping the
  // point under (screenX, screenY) — the viewport centre when omitted —
  // stationary, the same "anchor a point under the gesture" math the wheel
  // path uses. Shared by the wheel handler, the on-canvas +/−/Fit buttons,
  // and the keyboard shortcuts so they can't diverge.
  const zoomBy = (factor: number, screenX?: number, screenY?: number): void => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = screenX ?? rect.left + rect.width / 2
    const sy = screenY ?? rect.top + rect.height / 2
    setViewBox((vb) => {
      const before = getViewportTransform(rect, vb)
      const px = vb.x + (sx - rect.left - before.offsetX) / before.scale
      const py = vb.y + (sy - rect.top - before.offsetY) / before.scale
      const newW = clampViewBoxWidth(vb.w * factor, imageWidth)
      const newH = vb.h * (newW / vb.w)
      const after = getViewportTransform(rect, { x: vb.x, y: vb.y, w: newW, h: newH })
      const newMx = sx - rect.left - after.offsetX
      const newMy = sy - rect.top - after.offsetY
      return { x: px - newMx / after.scale, y: py - newMy / after.scale, w: newW, h: newH }
    })
  }
  const resetView = (): void => setViewBox({ x: 0, y: 0, w: imageWidth, h: imageHeight })

  const zoomByRef = useRef(zoomBy)
  zoomByRef.current = zoomBy
  const resetViewRef = useRef(resetView)
  resetViewRef.current = resetView

  // Keyboard zoom (Phase 7.0) — +/= in, -/_ out, 0 to fit. Ignored while a
  // form field is focused so typing "-" or "0" into the calibration/latitude
  // inputs doesn't jump the map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      )
        return
      if (e.key === '+' || e.key === '=') zoomByRef.current(1 / ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') zoomByRef.current(ZOOM_STEP)
      else if (e.key === '0') resetViewRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const terrainTypesById = useMemo(() => new Map(terrainTypes.map((t) => [t.id, t])), [terrainTypes])
  const lineTypesById = useMemo(() => new Map(lineTypes.map((t) => [t.id, t])), [lineTypes])
  const climateTypesById = useMemo(() => new Map(climateTypes.map((t) => [t.id, t])), [climateTypes])
  const pinRadius = Math.max(6, Math.min(imageWidth, imageHeight) * 0.01)
  const equatorStrokeWidth = Math.max(2, Math.min(imageWidth, imageHeight) * 0.003)
  const wrapConfig: WrapConfig = { mapWidth: imageWidth, mapHeight: imageHeight, wrapsHorizontally, wrapsVertically }
  const isPastWrappingEdge = (p: Point): boolean =>
    (wrapsHorizontally && (p.x < 0 || p.x > imageWidth)) || (wrapsVertically && (p.y < 0 || p.y > imageHeight))

  // The in-progress draft, folded the same way the final route is (see
  // MapTripCalculator's effectiveLegs) — so as soon as a point is placed
  // past a wrapping edge, the draft itself immediately shows the split/
  // folded interpretation instead of one raw line trailing off-canvas.
  const foldedTripDraft = useMemo(() => {
    if (tripDraft.length < 2) return []
    if (!wrapsHorizontally && !wrapsVertically) return [tripDraft]
    return foldDrawnPathAtWraps(tripDraft, wrapConfig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripDraft, wrapsHorizontally, wrapsVertically, imageWidth, imageHeight])

  const drawTripGhost =
    mode === 'draw-trip' && (wrapsHorizontally || wrapsVertically) && drawHoverPoint && isPastWrappingEdge(drawHoverPoint)
      ? foldPoint(drawHoverPoint, wrapConfig)
      : null

  // This component re-renders on every mousemove tick while panning and
  // every wheel event while zooming (both just update viewBox). Without
  // memoizing these, a map with a lot of drawn detail (many zones/lines,
  // each with many points) re-ran a `.map().join(' ')` point-string build
  // for every polygon/polyline on every one of those ticks, even though
  // panning/zooming never changes the underlying shapes — only the SVG's
  // viewBox, which the browser already remaps for free.
  const landmassElements = useMemo(
    () =>
      landmasses.map((landmass) => (
        <polygon
          key={landmass.id}
          points={landmass.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="#2a6f97"
          fillOpacity={0.06}
          stroke="#2a6f97"
          strokeOpacity={0.8}
          strokeWidth={2}
          strokeDasharray="6,4"
        />
      )),
    [landmasses]
  )

  // Renders BELOW terrain zones (landmasses -> climate -> territories ->
  // terrain -> lines -> pins) — a climate zone is a broad background biome
  // tint, while a terrain zone is a more specific painted region that
  // should still read clearly on top of it. Higher fillOpacity than a
  // terrain zone (0.35) since climate zones are typically much larger and
  // would otherwise barely register at the same faintness.
  const climateZoneElements = useMemo(
    () =>
      climateZones.map((zone) => (
        <polygon
          key={zone.id}
          points={zone.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={climateTypesById.get(zone.climateTypeId)?.color ?? '#888'}
          fillOpacity={0.45}
          stroke="none"
        />
      )),
    [climateZones, climateTypesById]
  )

  // Renders on top of climate (so borders stay visible regardless of the
  // biome tint underneath) but below terrain zones — a national border is
  // a political fact, not a physical feature, so it shouldn't visually
  // compete with an actually-painted terrain region.
  const territoryElements = useMemo(
    () =>
      territories.map((territory) => (
        <polygon
          key={territory.id}
          points={territory.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={territory.color}
          fillOpacity={0.18}
          stroke={territory.color}
          strokeOpacity={0.9}
          strokeWidth={2.5}
        />
      )),
    [territories]
  )

  // City districts (Phase 7.2) — same visual language as territories (tinted
  // fill + centred name label), hue cycled by index so adjacent districts
  // read apart. A district carries its own `color` only if the caller
  // assigned one; otherwise it's derived here.
  const cityDistrictElements = useMemo(
    () =>
      cityDistricts
        .filter((d) => d.points.length >= 3)
        .map((district, i) => {
          const color = district.color ?? `hsl(${Math.round((360 / Math.max(1, cityDistricts.length)) * i)}, 45%, 45%)`
          const centre = polygonCentroid(district.points)
          return (
            <g key={district.id}>
              <polygon
                points={district.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={color}
                fillOpacity={0.16}
                stroke={color}
                strokeOpacity={0.75}
                strokeWidth={2}
              />
              <text x={centre.x} y={centre.y} textAnchor="middle" fill={color} style={{ fontWeight: 600 }}>
                {district.name}
              </text>
            </g>
          )
        }),
    [cityDistricts]
  )

  const zoneElements = useMemo(
    () =>
      zones.map((zone) => (
        <polygon
          key={zone.id}
          points={zone.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={terrainTypesById.get(zone.terrainTypeId)?.color ?? '#888'}
          fillOpacity={0.35}
          stroke={terrainTypesById.get(zone.terrainTypeId)?.color ?? '#888'}
          strokeWidth={2}
        />
      )),
    [zones, terrainTypesById]
  )

  const lineElements = useMemo(
    () =>
      lines.map((line) => (
        <polyline
          key={line.id}
          points={line.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={lineTypesById.get(line.lineTypeId)?.color ?? '#888'}
          strokeOpacity={0.6}
          strokeWidth={line.widthPixels}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )),
    [lines, lineTypesById]
  )

  // Building footprints (Phase 7.4) — a small rectangle per placed
  // building, rotated about its own centre, tinted by category, and only at
  // the closest LOD (a city has hundreds). This is the LOD's primary job:
  // bounding the *rendered* element count, not just the generated one.
  // Clickable in view mode (Phase 7.5), same opt-out-of-pan-tracking
  // pattern as a pin; in a drawing mode a click places a point there.
  const cityBuildingElements = useMemo(() => {
    if (lod !== 'near') return []
    return cityBuildings.map(({ id, footprint: f, category }) => (
      <rect
        key={`bld-${id}`}
        x={f.x - f.width / 2}
        y={f.y - f.height / 2}
        width={f.width}
        height={f.height}
        transform={`rotate(${f.rotationDegrees}, ${f.x}, ${f.y})`}
        fill={BUILDING_CATEGORY_COLORS[category] ?? BUILDING_CATEGORY_COLORS.shop}
        fillOpacity={0.9}
        stroke="#3a3128"
        strokeOpacity={0.55}
        strokeWidth={0.5}
        style={{ cursor: mode === 'view' ? 'pointer' : 'crosshair' }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (mode === 'view' ? onBuildingClickRef.current?.(id) : handleClickAtRef.current({ x: f.x, y: f.y }))}
      />
    ))
  }, [cityBuildings, lod, mode])

  // Street name labels (Phase 7.3) — only lines with a `name` (city
  // streets; rivers/roads leave it null), and only at the closest LOD, so
  // a zoomed-out city isn't a wall of text. Rotated along the street, with
  // a white halo so they read over any block fill.
  const streetLabelElements = useMemo(() => {
    if (lod !== 'near') return []
    return lines
      .filter((line) => line.name && line.points.length >= 2)
      .map((line) => {
        const midIndex = Math.floor(line.points.length / 2)
        const mid = line.points[midIndex]
        const prev = line.points[Math.max(0, midIndex - 1)]
        let angle = (Math.atan2(mid.y - prev.y, mid.x - prev.x) * 180) / Math.PI
        if (angle > 90) angle -= 180
        if (angle < -90) angle += 180
        return (
          <text
            key={`street-label-${line.id}`}
            x={mid.x}
            y={mid.y}
            textAnchor="middle"
            transform={`rotate(${angle}, ${mid.x}, ${mid.y})`}
            fill={lineTypesById.get(line.lineTypeId)?.color ?? '#6a5a44'}
            style={{ fontSize: 10, fontWeight: 600, paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, strokeLinejoin: 'round' }}
          >
            {line.name}
          </text>
        )
      })
  }, [lines, lineTypesById, lod])

  // Same reasoning as landmassElements/zoneElements/lineElements above, but
  // for pins — without this, entering draw-trip mode and just moving the
  // mouse around (handleMouseMoveForDrawTrip updates drawHoverPoint on every
  // tick) rebuilds every pin's JSX every tick even though the pins
  // themselves haven't changed. Click handlers read through the refs set up
  // above instead of closing over handleClickAt/onPinClick directly, so
  // those don't have to be in the dep list (they're fresh every render).
  const pinElements = useMemo(
    () =>
      pins.map((pin) => (
        <g
          key={pin.id}
          transform={`translate(${pin.x}, ${pin.y})`}
          onMouseDown={(e) => e.stopPropagation()}
          // Stopping propagation on mousedown means the SVG's own
          // drag/click tracking (dragRef, see the window mouseup handler
          // above) never sees a click that starts on a pin — this is the
          // only path such a click gets handled at all. In view mode that
          // should open the pin's note as always, but in every drawing
          // mode (paint-zone, draw-line, draw-trip, etc.) it needs to
          // register as an ordinary point instead, so you can start a
          // road/route right at an existing city's pin without it
          // navigating away to the note mid-draw.
          onClick={() => (mode === 'view' ? onPinClickRef.current(pin) : handleClickAtRef.current({ x: pin.x, y: pin.y }))}
          style={{ cursor: mode === 'view' && pin.locationTitle ? 'pointer' : mode === 'view' ? 'default' : 'crosshair' }}
        >
          {highlightedPinIds?.has(pin.id) && <circle r={pinRadius + 5} fill="none" stroke="#7c8cff" strokeWidth={3} />}
          {/* Freehand pins (no linked note) get a dashed outline and a
              muted fill — same "not a real note yet" visual language as
              the graph view's phantom nodes. */}
          <circle
            r={pinRadius}
            fill={pin.locationTitle ? '#e08a3c' : '#888'}
            stroke="#fff"
            strokeWidth={2}
            strokeDasharray={pin.locationTitle ? undefined : '3,2'}
          />
          <text y={-pinRadius - 6} textAnchor="middle" fill="#fff">
            {pinDisplayLabel(pin)}
          </text>
        </g>
      )),
    [pins, mode, highlightedPinIds, pinRadius]
  )

  const tripPathElements = useMemo(
    () =>
      tripPath?.map(
        (leg, legIndex) =>
          leg.length > 1 && (
            <g key={legIndex}>
              <polyline
                points={leg.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#000"
                strokeWidth={6}
                strokeLinecap="round"
              />
              <polyline
                points={leg.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#ffd60a"
                strokeWidth={3}
                strokeDasharray="10,6"
                strokeLinecap="round"
              />
              {leg.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={5} fill="#ffd60a" stroke="#000" strokeWidth={1.5} />
              ))}
            </g>
          )
      ),
    [tripPath]
  )

  // A freshly (re)loaded image gets a fresh full-image view; switching modes
  // discards any in-progress calibration/zone draft so it can't leak in
  // half-finished.
  useEffect(() => {
    setViewBox({ x: 0, y: 0, w: imageWidth, h: imageHeight })
  }, [imageWidth, imageHeight, imageUrl])

  useEffect(() => {
    setCalibrationStart(null)
    setZoneDraft([])
    setLineDraft([])
    setLandmassDraft([])
    setTerritoryDraft([])
    setTripDraft([])
    setRegionDraft([])
    setDrawHoverPoint(null)
  }, [mode])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (mode === 'paint-zone') {
        if (e.key === 'Enter' && zoneDraft.length >= 3) {
          onZoneDrawn(zoneDraft)
          setZoneDraft([])
        } else if (e.key === 'Escape') {
          setZoneDraft([])
        }
      } else if (mode === 'draw-line') {
        if (e.key === 'Enter' && lineDraft.length >= 2) {
          onLineDrawn(lineDraft)
          setLineDraft([])
        } else if (e.key === 'Escape') {
          setLineDraft([])
        }
      } else if (mode === 'paint-landmass') {
        if (e.key === 'Enter' && landmassDraft.length >= 3) {
          onLandmassDrawn(landmassDraft)
          setLandmassDraft([])
        } else if (e.key === 'Escape') {
          setLandmassDraft([])
        }
      } else if (mode === 'paint-territory') {
        if (e.key === 'Enter' && territoryDraft.length >= 3) {
          onTerritoryDrawn?.(territoryDraft)
          setTerritoryDraft([])
        } else if (e.key === 'Escape') {
          setTerritoryDraft([])
        }
      } else if (mode === 'draw-trip') {
        if (e.key === 'Enter' && tripDraft.length >= 2) {
          onTripDrawn(tripDraft)
          setTripDraft([])
        } else if (e.key === 'Escape') {
          setTripDraft([])
        }
      } else if (mode === 'select-region') {
        if (e.key === 'Enter' && regionDraft.length >= 3) {
          onRegionDrawn?.(regionDraft)
          setRegionDraft([])
        } else if (e.key === 'Escape') {
          setRegionDraft([])
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    mode,
    zoneDraft,
    onZoneDrawn,
    lineDraft,
    onLineDrawn,
    landmassDraft,
    onLandmassDrawn,
    territoryDraft,
    onTerritoryDrawn,
    tripDraft,
    onTripDrawn,
    regionDraft,
    onRegionDrawn
  ])

  const clientToSvgPoint = (clientX: number, clientY: number): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    const vb = viewBoxRef.current
    const { scale, offsetX, offsetY } = getViewportTransform(rect, vb)
    return {
      x: vb.x + (clientX - rect.left - offsetX) / scale,
      y: vb.y + (clientY - rect.top - offsetY) / scale
    }
  }

  const handleClickAt = (point: Point): void => {
    if (mode === 'calibrate') {
      if (!calibrationStart) {
        setCalibrationStart(point)
      } else {
        onCalibrate(segmentDistance(calibrationStart, point))
        setCalibrationStart(null)
      }
    } else if (mode === 'paint-zone') {
      setZoneDraft((pts) => [...pts, point])
    } else if (mode === 'draw-line') {
      setLineDraft((pts) => [...pts, point])
    } else if (mode === 'paint-landmass') {
      setLandmassDraft((pts) => [...pts, point])
    } else if (mode === 'paint-territory') {
      setTerritoryDraft((pts) => [...pts, point])
    } else if (mode === 'draw-trip') {
      setTripDraft((pts) => [...pts, point])
    } else if (mode === 'place-pin') {
      onPinPlaced(point)
    } else if (mode === 'select-region') {
      setRegionDraft((pts) => [...pts, point])
    }
  }
  handleClickAtRef.current = handleClickAt

  // Only active in 'draw-trip' mode — tracks the cursor so the ghost
  // preview below can show where an off-canvas point would land before the
  // user commits to a click. A plain React handler (not a window-level
  // listener like panning uses) is enough since this doesn't need to keep
  // firing once the pointer leaves the SVG.
  const handleMouseMoveForDrawTrip = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (mode !== 'draw-trip') return
    const point = clientToSvgPoint(e.clientX, e.clientY)
    if (point) setDrawHoverPoint(point)
  }

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>): void => {
    e.preventDefault()
    // Anchor the point under the cursor while zooming — see zoomBy, which
    // the +/−/Fit buttons and keyboard shortcuts share.
    zoomBy(e.deltaY < 0 ? 0.9 : 1.1, e.clientX, e.clientY)
  }

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>): void => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: viewBox.x, origY: viewBox.y, moved: false }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      const drag = dragRef.current
      const rect = svgRef.current?.getBoundingClientRect()
      if (!drag || !rect) return
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > CLICK_MOVEMENT_THRESHOLD) {
        drag.moved = true
      }
      if (!drag.moved) return
      const { scale } = getViewportTransform(rect, viewBoxRef.current)
      const dxUser = (e.clientX - drag.startX) / scale
      const dyUser = (e.clientY - drag.startY) / scale
      setViewBox((vb) => ({ ...vb, x: drag.origX - dxUser, y: drag.origY - dyUser }))
    }
    const handleMouseUp = (e: MouseEvent): void => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || drag.moved) return
      const point = clientToSvgPoint(e.clientX, e.clientY)
      if (point) handleClickAt(point)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // Deliberately omits viewBox.x/y and handleClickAt's other closed-over
    // values from the dep list — only re-binding on the values above (same
    // as CloudGraphView's identical pattern) avoids tearing down and
    // rebuilding these window listeners on every pan tick.
  }, [viewBox.w, viewBox.h, mode, calibrationStart, zoneDraft, lineDraft, landmassDraft, territoryDraft, tripDraft, regionDraft])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        className="graph-svg"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        style={{ cursor: mode === 'view' ? 'grab' : 'crosshair' }}
        onWheel={handleWheel}
        onMouseMove={handleMouseMoveForDrawTrip}
        onMouseLeave={() => setDrawHoverPoint(null)}
        onMouseDown={handleMouseDown}
      >
        {imageUrl && <image href={imageUrl} x={0} y={0} width={imageWidth} height={imageHeight} />}

        {showLandmasses && (
          <g>
            {/* Landmass boundaries render underneath terrain zones/lines — they're
                a land/water backdrop, not a paintable region themselves, so a
                dashed outline with near-zero fill keeps whatever's drawn inside
                (or the base map image) fully legible. */}
            {landmassElements}
          </g>
        )}

        {showClimateZones && <g>{climateZoneElements}</g>}

        {showTerritories && <g>{territoryElements}</g>}

        {showZones && <g>{zoneElements}</g>}

        {showLines && <g>{lineElements}</g>}

        {/* The city footprint (Phase 7.1). A walled town draws a heavy wall
            line (dark base + light coping stroke); an unwalled one a soft
            dashed edge with a faint fill. Renders under cityLayer so later
            districts/streets/buildings sit on top of it. */}
        {cityBoundary &&
          cityBoundary.points.length >= 3 &&
          (cityBoundary.walled ? (
            <g>
              <polygon
                points={cityBoundary.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="#000"
                fillOpacity={0.03}
                stroke="#3d2b1f"
                strokeWidth={6}
                strokeLinejoin="round"
              />
              <polygon
                points={cityBoundary.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#d8c3a5"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            </g>
          ) : (
            <polygon
              points={cityBoundary.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="#c9a24d"
              fillOpacity={0.05}
              stroke="#c9a24d"
              strokeOpacity={0.85}
              strokeWidth={3}
              strokeDasharray="10,7"
              strokeLinejoin="round"
            />
          ))}

        {/* City districts (Phase 7.2), inside the boundary. */}
        {cityDistrictElements.length > 0 && <g>{cityDistrictElements}</g>}

        {/* Building footprints (Phase 7.4) — above districts/streets, below
            the pins and street labels; near-LOD only. */}
        {cityBuildingElements.length > 0 && <g>{cityBuildingElements}</g>}

        {/* Phase 7.3+ city-scale layers (streets / building footprints) —
            mounted above the base map, below the pins and draft overlays,
            with their own level-of-detail gating driven by `view.lod`. */}
        {cityLayer && <g>{cityLayer(view)}</g>}

        {mode === 'paint-zone' && zoneDraft.length > 0 && (
          <g>
            {/* Black-outline-then-white-dash layering keeps this visible
                regardless of the underlying map's colors — a flat white line
                disappears entirely on a light background. */}
            <polyline points={zoneDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={4} />
            <polyline points={zoneDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#fff" strokeDasharray="4,2" strokeWidth={2} />
            {zoneDraft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke="#000" strokeWidth={1.5} />
            ))}
          </g>
        )}

        {mode === 'draw-line' && lineDraft.length > 0 && (
          <g>
            <polyline points={lineDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={4} />
            <polyline points={lineDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#fff" strokeDasharray="4,2" strokeWidth={2} />
            {lineDraft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke="#000" strokeWidth={1.5} />
            ))}
          </g>
        )}

        {mode === 'paint-landmass' && landmassDraft.length > 0 && (
          <g>
            <polyline points={landmassDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={4} />
            <polyline points={landmassDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#fff" strokeDasharray="4,2" strokeWidth={2} />
            {landmassDraft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke="#000" strokeWidth={1.5} />
            ))}
          </g>
        )}

        {mode === 'paint-territory' && territoryDraft.length > 0 && (
          <g>
            <polyline points={territoryDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={4} />
            <polyline points={territoryDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#7c8cff" strokeDasharray="4,2" strokeWidth={2} />
            {territoryDraft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="#7c8cff" stroke="#000" strokeWidth={1.5} />
            ))}
          </g>
        )}

        {mode === 'draw-trip' && tripDraft.length > 0 && (
          <g>
            {/* The connecting line(s) use the FOLDED interpretation (see
                foldedTripDraft above), not the raw clicked points — so the
                moment a point past a wrapping edge is placed, the draft
                already shows the split/folded route instead of one line
                running straight through blank space. The small circles below
                still mark the literal click positions (which can legitimately
                be off-canvas), so you can see exactly what you clicked as
                well as how it's being interpreted. */}
            {foldedTripDraft.map((leg, legIndex) => (
              <g key={legIndex}>
                <polyline points={leg.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={4} />
                <polyline points={leg.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#fff" strokeDasharray="4,2" strokeWidth={2} />
              </g>
            ))}
            {tripDraft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke="#000" strokeWidth={1.5} />
            ))}
          </g>
        )}

        {/* Ghost preview while drawing — shows where the cursor's CURRENT
            position would land once folded, before the user commits with a
            click, so drawing a route across a wrapping edge isn't a guessing
            game. Only shown once the cursor has actually strayed past a
            wrapping edge; an in-bounds cursor needs no ghost since it already
            is its own landing spot. */}
        {drawTripGhost && (
          <g>
            <circle cx={drawTripGhost.x} cy={drawTripGhost.y} r={pinRadius} fill="none" stroke="#ff8800" strokeWidth={2} strokeDasharray="4,3" />
            <text x={drawTripGhost.x} y={drawTripGhost.y - pinRadius - 6} textAnchor="middle" fill="#ff8800">
              lands here
            </text>
          </g>
        )}

        {mode === 'select-region' && regionDraft.length > 0 && (
          <g>
            <polyline points={regionDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={4} />
            <polyline points={regionDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e0a83c" strokeDasharray="4,2" strokeWidth={2} />
            {regionDraft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="#e0a83c" stroke="#000" strokeWidth={1.5} />
            ))}
          </g>
        )}

        {mode === 'calibrate' && calibrationStart && (
          <circle cx={calibrationStart.x} cy={calibrationStart.y} r={6} fill="#fff" stroke="#000" strokeWidth={2} />
        )}

        {/* The CONFIRMED active boundary mask (Phase 5) — a persistent
            highlighted overlay independent of mode, so "what's about to be
            generated inside" stays visible while adjusting Generate panel
            sliders, not just while actively drawing it. */}
        {boundaryMask && boundaryMask.length >= 3 && (
          <polygon
            points={boundaryMask.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="#e0a83c"
            fillOpacity={0.08}
            stroke="#e0a83c"
            strokeOpacity={0.9}
            strokeWidth={3}
            strokeDasharray="10,5"
          />
        )}

        {/* The equator, in 'latitude' scale mode — a thin reference line
            spanning the current view's full width (not just the image), since
            it's derived from topLatitude/bottomLatitude (see MapSheet) and can
            legitimately fall outside the image bounds for a map that doesn't
            depict the equator (a kingdom far to the north, say). Purely
            informational now — position comes from the two latitude fields,
            not from clicking on the canvas. */}
        {equatorY != null && (
          <g>
            <line
              x1={viewBox.x}
              x2={viewBox.x + viewBox.w}
              y1={equatorY}
              y2={equatorY}
              stroke="#000"
              strokeOpacity={0.4}
              strokeWidth={equatorStrokeWidth + 1.5}
            />
            <line
              x1={viewBox.x}
              x2={viewBox.x + viewBox.w}
              y1={equatorY}
              y2={equatorY}
              stroke="#2ec4b6"
              strokeWidth={equatorStrokeWidth}
              strokeDasharray={`${equatorStrokeWidth * 5},${equatorStrokeWidth * 3}`}
            />
            <text x={viewBox.x + 8} y={equatorY - 8} fill="#2ec4b6">
              Equator
            </text>
          </g>
        )}

        {tripPath && tripPath.length > 0 && (
          <g>
            {/* The active trip route — a straight pin-to-pin preview, a
                hand-drawn path, or a wrapped route's legs, either way rendered
                the same way so there's one visual language for "this is the
                route being timed" regardless of how it was produced. Each leg
                is drawn separately (never connected to the next) so a wrapped
                route reads as "jumps to the opposite edge" rather than a line
                straight across the map. High-contrast gold against the black
                outline reads over any terrain color underneath. */}
            {tripPathElements}
          </g>
        )}

        {showLines && streetLabelElements.length > 0 && <g>{streetLabelElements}</g>}

        {showPins && <g>{pinElements}</g>}
      </svg>

      {/* On-canvas zoom controls (Phase 7.0) — pan is drag, but a discrete
          zoom-in/out/fit is handy on a trackpad and needed for the
          city-scale map's deeper zoom range. Keyboard equivalents: +/-, and
          0 to fit. */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 4
        }}
      >
        <button aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1 / ZOOM_STEP)}>
          +
        </button>
        <button aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(ZOOM_STEP)}>
          −
        </button>
        <button aria-label="Fit map to view" title="Fit map to view (0)" onClick={resetView}>
          Fit
        </button>
        <span
          style={{
            fontSize: 10,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
            userSelect: 'none'
          }}
        >
          {zoom.toFixed(1)}×
        </span>
      </div>
    </div>
  )
}
