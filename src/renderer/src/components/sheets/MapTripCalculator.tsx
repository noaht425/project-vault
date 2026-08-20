import { useEffect, useMemo, useState } from 'react'
import {
  calculateTrip,
  foldDrawnPathAtWraps,
  mergeTripResults,
  wrapLegs,
  type LatitudeDistortionConfig,
  type Point
} from '../../../../common/mapGeometry'
import {
  pinDisplayLabel,
  type LineType,
  type MapLandmass,
  type MapLine,
  type MapPin,
  type MapScale,
  type MapZone,
  type TerrainType
} from '../../../../common/noteTypes/map'
import { useTravelModesStore, EMPTY_TRAVEL_MODES } from '../../state/travelModesStore'

export function MapTripCalculator({
  pins,
  zones,
  lines,
  terrainTypes,
  lineTypes,
  landmasses,
  waterTerrainTypeId,
  scale,
  image,
  wrapsHorizontally,
  wrapsVertically,
  equatorY,
  planetCircumference,
  accountForLatitudeDistortion,
  drawnPath,
  onClearDrawnPath,
  onStartDrawing,
  onShowPathChange
}: {
  pins: MapPin[]
  zones: MapZone[]
  lines: MapLine[]
  terrainTypes: TerrainType[]
  lineTypes: LineType[]
  landmasses: MapLandmass[]
  waterTerrainTypeId: string | null
  scale: MapScale | null
  // Only width/height are ever read here (wrap-around geometry) — accepting
  // just that shape instead of a full MapImage lets this work equally for a
  // purely-generated map (canvasSize) with no uploaded raster at all.
  image: { width: number; height: number } | null
  wrapsHorizontally: boolean
  wrapsVertically: boolean
  equatorY: number | null
  planetCircumference: number | null
  accountForLatitudeDistortion: boolean
  // A route hand-drawn on the map (see MapCanvas's 'draw-trip' mode) — when
  // set, it's used as the trip's path instead of the straight line between
  // the From/To pins below, so a journey that isn't a straight shot (walk to
  // a dock, cross by boat, walk again) can be timed accurately. When
  // wrapping is enabled, effectiveLegs below still folds a drawn route that
  // crosses a wrapping edge (foldDrawnPathAtWraps) — same "jumps to the
  // opposite edge" treatment a straight-line route gets.
  drawnPath: Point[] | null
  onClearDrawnPath: () => void
  onStartDrawing: () => void
  // Pushes whichever route (straight, wrapped, or drawn) should render as an
  // overlay on the map up to MapSheet, which owns the canvas. Each entry is
  // one contiguous leg — more than one only when a wrapped route crosses a
  // map edge, so the canvas can draw each leg separately instead of
  // connecting them with a line straight across the whole map. Null clears it.
  onShowPathChange: (legs: Point[][] | null) => void
}): React.JSX.Element {
  const noteId = useTravelModesStore((s) => s.noteId)
  const loading = useTravelModesStore((s) => s.loading)
  const modes = useTravelModesStore((s) => s.frontmatter?.modes ?? EMPTY_TRAVEL_MODES)
  const load = useTravelModesStore((s) => s.load)

  useEffect(() => {
    if (!noteId && !loading) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [landModeId, setLandModeId] = useState('')
  const [waterModeId, setWaterModeId] = useState('')

  const from = pins.find((p) => p.id === fromId) ?? pins[0]
  const to = pins.find((p) => p.id === toId) ?? pins[1]
  // Alphabetical by display label for the From/To dropdowns below — pins
  // themselves stay in their original (insertion) order everywhere else,
  // this is purely a display-order convenience for finding a place in a
  // long list.
  const sortedPins = useMemo(() => [...pins].sort((a, b) => pinDisplayLabel(a).localeCompare(pinDisplayLabel(b))), [pins])
  const landTravelMode = modes.find((m) => m.id === landModeId) ?? modes[0]
  // Only meaningfully distinct once the map has landmasses — with none, the
  // whole map counts as land (see isLandAt), so a separate water mode picker
  // would be dead UI. Defaults to the land mode so a map without a dedicated
  // "Sailing"/"Boat" mode set up yet still behaves exactly as before.
  const waterTravelMode = (landmasses.length > 0 && modes.find((m) => m.id === waterModeId)) || landTravelMode

  // Memoized on from/to (themselves stable across renders unless `pins`
  // actually changes, e.g. a drag or fromId/toId edit) — without this,
  // `[from, to]` was a fresh array literal every render, which defeated the
  // `trip` useMemo below (effectiveLegs was always "new") and re-ran the
  // full geometry sweep on every unrelated re-render of this component (e.g.
  // any keystroke elsewhere in the map editor). Depending on `from`/`to`
  // rather than just their ids keeps this correct if a pin's position moves
  // without its id changing.
  //
  // A straight pin-to-pin trip is normally one leg, but wrapLegs may split it
  // into 2-3 if the shortest path crosses a wrapping edge. A drawn route
  // normally comes back as one leg per pair of hand-placed points, but
  // foldDrawnPathAtWraps can split any of those further if the user panned/
  // zoomed past a wrapping edge and placed a point out there on purpose
  // (see MapCanvas — that's already reachable today, just not folded back
  // into the map's real bounds until now).
  const effectiveLegs: Point[][] | null = useMemo(() => {
    if (drawnPath) {
      if (!image || (!wrapsHorizontally && !wrapsVertically)) return [drawnPath]
      return foldDrawnPathAtWraps(drawnPath, { mapWidth: image.width, mapHeight: image.height, wrapsHorizontally, wrapsVertically })
    }
    if (!from || !to || from.id === to.id) return null
    if (!image || (!wrapsHorizontally && !wrapsVertically)) return [[from, to]]
    return wrapLegs(from, to, { mapWidth: image.width, mapHeight: image.height, wrapsHorizontally, wrapsVertically })
  }, [drawnPath, from, to, image, wrapsHorizontally, wrapsVertically])

  // Only takes effect once both inputs it needs are actually set — otherwise
  // the checkbox is disabled in the UI (see MapSheet), but a stale "on" value
  // from before one of them was cleared shouldn't silently reactivate here.
  // Memoized on the primitive values (not a bare `{equatorY, planetCircumference}`
  // literal) for the same reason effectiveLegs is above — a fresh object every
  // render would defeat the `trip` useMemo below entirely.
  const latitudeDistortion: LatitudeDistortionConfig | null = useMemo(
    () => (accountForLatitudeDistortion && equatorY !== null && planetCircumference ? { equatorY, planetCircumference } : null),
    [accountForLatitudeDistortion, equatorY, planetCircumference]
  )

  const trip = useMemo(() => {
    if (!effectiveLegs || !landTravelMode || !waterTravelMode || !scale) return null
    const results = effectiveLegs.map((leg) =>
      calculateTrip(
        leg,
        zones,
        lines,
        terrainTypes,
        lineTypes,
        landmasses,
        waterTerrainTypeId,
        scale,
        landTravelMode,
        waterTravelMode,
        latitudeDistortion
      )
    )
    return mergeTripResults(results)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveLegs,
    landTravelMode,
    waterTravelMode,
    scale,
    zones,
    lines,
    terrainTypes,
    lineTypes,
    landmasses,
    waterTerrainTypeId,
    latitudeDistortion
  ])

  // True when the route actually crossed a wrapping edge — for a straight
  // pin-to-pin trip that means wrapLegs found a shorter route around the
  // edge; for a drawn route it means at least one hand-placed segment got
  // folded by foldDrawnPathAtWraps. Comparing leg count against the
  // *original* segment count (not just "> 1") matters here specifically
  // because a drawn route can already have several legs with zero wrapping
  // involved (e.g. "walk to a dock, cross by boat, walk again") — only an
  // increase in leg count means folding actually happened. Worth telling the
  // user either way, since the route shown on the map jumps between opposite
  // edges rather than crossing the middle.
  const originalSegmentCount = drawnPath ? Math.max(drawnPath.length - 1, 0) : 1
  const usedWrap = (effectiveLegs?.length ?? 0) > originalSegmentCount

  // A segment's terrainTypeId may resolve against either pool — see
  // calculateTrip's own comment on why zones and line-derived corridors
  // share one id space here.
  const terrainNameById = new Map([...terrainTypes, ...lineTypes].map((t) => [t.id, t.name]))
  // Falls back to a generic "Water" label when a landmass boundary exists
  // but no water terrain type has been picked yet.
  const waterLabel = (waterTerrainTypeId && terrainNameById.get(waterTerrainTypeId)) || 'Water'
  const mixedUnits =
    trip !== null && landTravelMode.timeUnitLabel !== waterTravelMode.timeUnitLabel && trip.segments.some((s) => !s.isLand)

  if (!scale) return <p className="right-panel-note">Calibrate this map's scale first (Calibrate mode) to enable the trip calculator.</p>
  if (pins.length < 2 && !drawnPath) {
    return <p className="right-panel-note">Place at least two pins, or use "Draw custom route" below, to calculate a trip.</p>
  }
  if (!loading && modes.length === 0) return <p className="right-panel-note">Add at least one travel mode below first.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {drawnPath ? (
        <div className="sheet-row" style={{ alignItems: 'center' }}>
          <span className="right-panel-note">Using your hand-drawn route ({drawnPath.length} points) — From/To below is ignored.</span>
          <button className="sheet-open-ref-button" onClick={onClearDrawnPath}>
            Clear drawn route
          </button>
        </div>
      ) : (
        pins.length >= 2 && (
          <div className="sheet-row">
            <label className="sheet-field">
              From
              <select value={from?.id ?? ''} onChange={(e) => setFromId(e.target.value)}>
                {sortedPins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {pinDisplayLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="sheet-field">
              To
              <select value={to?.id ?? ''} onChange={(e) => setToId(e.target.value)}>
                {sortedPins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {pinDisplayLabel(p)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )
      )}

      <div className="sheet-row">
        <label className="sheet-field">
          {landmasses.length > 0 ? 'Land mode' : 'Travel mode'}
          <select value={landTravelMode?.id ?? ''} onChange={(e) => setLandModeId(e.target.value)}>
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {landmasses.length > 0 && (
          <label className="sheet-field">
            Water mode
            <select value={waterTravelMode?.id ?? ''} onChange={(e) => setWaterModeId(e.target.value)}>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="sheet-row">
        <button className="sheet-open-ref-button" onClick={onStartDrawing}>
          Draw custom route
        </button>
        <button className="sheet-open-ref-button" onClick={() => onShowPathChange(effectiveLegs)} disabled={!effectiveLegs}>
          Show on map
        </button>
        <button className="sheet-open-ref-button" onClick={() => onShowPathChange(null)}>
          Hide from map
        </button>
      </div>

      {!drawnPath && from && to && from.id === to.id && <p className="right-panel-note">Choose two different pins.</p>}

      {usedWrap && (
        <p className="right-panel-note">
          {drawnPath ? 'This route crosses a wrapping edge' : 'Shortest path wraps around the map edge'} — the route shown on
          the map jumps between opposite edges rather than crossing the middle.
        </p>
      )}

      {trip && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong>
            {trip.totalRealDistance.toFixed(1)} {scale.unit} —{' '}
            {trip.totalTime === Infinity ? 'no route (impassable terrain)' : `${trip.totalTime.toFixed(1)} ${landTravelMode.timeUnitLabel}`}
          </strong>
          {mixedUnits && (
            <span className="right-panel-note">
              Land mode uses "{landTravelMode.timeUnitLabel}" and water mode uses "{waterTravelMode.timeUnitLabel}" — the total above
              just sums the raw numbers, so treat it as approximate until both modes share a time unit.
            </span>
          )}
          <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              {trip.segments.map((seg, i) => {
                const segMode = seg.isLand ? landTravelMode : waterTravelMode
                return (
                  <tr key={i}>
                    <td style={{ paddingRight: 12 }}>
                      {seg.terrainTypeId
                        ? (terrainNameById.get(seg.terrainTypeId) ?? 'Unknown')
                        : seg.isLand
                          ? 'Unpainted'
                          : waterLabel}
                    </td>
                    <td style={{ paddingRight: 12 }}>
                      {seg.realDistance.toFixed(1)} {scale.unit}
                    </td>
                    <td>{seg.time === Infinity ? '—' : `${seg.time.toFixed(1)} ${segMode.timeUnitLabel}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
