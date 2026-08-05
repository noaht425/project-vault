import { useEffect, useMemo, useRef, useState } from 'react'
import { segmentDistance, type Point } from '../../../../common/mapGeometry'
import { pinDisplayLabel, type LineType, type MapLandmass, type MapLine, type MapPin, type MapZone, type TerrainType } from '../../../../common/noteTypes/map'

export type MapCanvasMode = 'view' | 'calibrate' | 'paint-zone' | 'draw-line' | 'paint-landmass' | 'draw-trip' | 'place-pin'

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
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
  imageUrl: string
  imageWidth: number
  imageHeight: number
  zones: MapZone[]
  lines: MapLine[]
  landmasses: MapLandmass[]
  pins: MapPin[]
  terrainTypes: TerrainType[]
  lineTypes: LineType[]
  mode: MapCanvasMode
  onCalibrate: (pixelDistance: number) => void
  onZoneDrawn: (points: Point[]) => void
  onLineDrawn: (points: Point[]) => void
  onLandmassDrawn: (points: Point[]) => void
  onTripDrawn: (points: Point[]) => void
  onPinPlaced: (point: Point) => void
  onPinClick: (pin: MapPin) => void
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
  mode,
  onCalibrate,
  onZoneDrawn,
  onLineDrawn,
  onLandmassDrawn,
  onTripDrawn,
  onPinPlaced,
  onPinClick,
  highlightedPinIds,
  tripPath,
  equatorY
}: MapCanvasProps): React.JSX.Element {
  const [viewBox, setViewBox] = useState<ViewBox>({ x: 0, y: 0, w: imageWidth, h: imageHeight })
  const [calibrationStart, setCalibrationStart] = useState<Point | null>(null)
  const [zoneDraft, setZoneDraft] = useState<Point[]>([])
  const [lineDraft, setLineDraft] = useState<Point[]>([])
  const [landmassDraft, setLandmassDraft] = useState<Point[]>([])
  const [tripDraft, setTripDraft] = useState<Point[]>([])
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

  const terrainTypesById = useMemo(() => new Map(terrainTypes.map((t) => [t.id, t])), [terrainTypes])
  const lineTypesById = useMemo(() => new Map(lineTypes.map((t) => [t.id, t])), [lineTypes])
  const pinRadius = Math.max(6, Math.min(imageWidth, imageHeight) * 0.01)
  const equatorStrokeWidth = Math.max(2, Math.min(imageWidth, imageHeight) * 0.003)

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
    setTripDraft([])
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
      } else if (mode === 'draw-trip') {
        if (e.key === 'Enter' && tripDraft.length >= 2) {
          onTripDrawn(tripDraft)
          setTripDraft([])
        } else if (e.key === 'Escape') {
          setTripDraft([])
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, zoneDraft, onZoneDrawn, lineDraft, onLineDrawn, landmassDraft, onLandmassDrawn, tripDraft, onTripDrawn])

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
    } else if (mode === 'draw-trip') {
      setTripDraft((pts) => [...pts, point])
    } else if (mode === 'place-pin') {
      onPinPlaced(point)
    }
  }

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>): void => {
    e.preventDefault()
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return

    setViewBox((vb) => {
      const before = getViewportTransform(rect, vb)
      const px = vb.x + (e.clientX - rect.left - before.offsetX) / before.scale
      const py = vb.y + (e.clientY - rect.top - before.offsetY) / before.scale

      const scaleFactor = e.deltaY < 0 ? 0.9 : 1.1
      const newW = Math.min(imageWidth * 3, Math.max(50, vb.w * scaleFactor))
      const newH = vb.h * (newW / vb.w)

      // Keep the point under the cursor stationary — recomputed against the
      // *new* viewBox's own scale/offset, not the old one, since zooming
      // changes how much screen space the same viewBox unit covers.
      const after = getViewportTransform(rect, { x: vb.x, y: vb.y, w: newW, h: newH })
      const newMx = e.clientX - rect.left - after.offsetX
      const newMy = e.clientY - rect.top - after.offsetY
      return { x: px - newMx / after.scale, y: py - newMy / after.scale, w: newW, h: newH }
    })
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
  }, [viewBox.w, viewBox.h, mode, calibrationStart, zoneDraft, lineDraft, landmassDraft, tripDraft])

  return (
    <svg
      ref={svgRef}
      className="graph-svg"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      style={{ cursor: mode === 'view' ? 'grab' : 'crosshair' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
    >
      <image href={imageUrl} x={0} y={0} width={imageWidth} height={imageHeight} />

      <g>
        {/* Landmass boundaries render underneath terrain zones/lines — they're
            a land/water backdrop, not a paintable region themselves, so a
            dashed outline with near-zero fill keeps whatever's drawn inside
            (or the base map image) fully legible. */}
        {landmassElements}
      </g>

      <g>{zoneElements}</g>

      <g>{lineElements}</g>

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

      {mode === 'draw-trip' && tripDraft.length > 0 && (
        <g>
          <polyline points={tripDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={4} />
          <polyline points={tripDraft.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#fff" strokeDasharray="4,2" strokeWidth={2} />
          {tripDraft.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke="#000" strokeWidth={1.5} />
          ))}
        </g>
      )}

      {mode === 'calibrate' && calibrationStart && (
        <circle cx={calibrationStart.x} cy={calibrationStart.y} r={6} fill="#fff" stroke="#000" strokeWidth={2} />
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
          {tripPath.map(
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
          )}
        </g>
      )}

      <g>
        {pins.map((pin) => (
          <g
            key={pin.id}
            transform={`translate(${pin.x}, ${pin.y})`}
            onMouseDown={(e) => e.stopPropagation()}
            // Stopping propagation on mousedown means the SVG's own
            // drag/click tracking (dragRef, see the window mouseup handler
            // below) never sees a click that starts on a pin — this is the
            // only path such a click gets handled at all. In view mode that
            // should open the pin's note as always, but in every drawing
            // mode (paint-zone, draw-line, draw-trip, etc.) it needs to
            // register as an ordinary point instead, so you can start a
            // road/route right at an existing city's pin without it
            // navigating away to the note mid-draw.
            onClick={() => (mode === 'view' ? onPinClick(pin) : handleClickAt({ x: pin.x, y: pin.y }))}
            style={{ cursor: mode === 'view' && pin.locationTitle ? 'pointer' : mode === 'view' ? 'default' : 'crosshair' }}
          >
            {highlightedPinIds?.has(pin.id) && (
              <circle r={pinRadius + 5} fill="none" stroke="#7c8cff" strokeWidth={3} />
            )}
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
        ))}
      </g>
    </svg>
  )
}
