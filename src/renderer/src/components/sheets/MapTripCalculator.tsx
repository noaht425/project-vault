import { useEffect, useMemo, useState } from 'react'
import { calculateTrip, type Point } from '../../../../common/mapGeometry'
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
  // A route hand-drawn on the map (see MapCanvas's 'draw-trip' mode) — when
  // set, it's used as the trip's path instead of the straight line between
  // the From/To pins below, so a journey that isn't a straight shot (walk to
  // a dock, cross by boat, walk again) can be timed accurately.
  drawnPath: Point[] | null
  onClearDrawnPath: () => void
  onStartDrawing: () => void
  // Pushes whichever path (straight or drawn) should render as an overlay
  // on the map up to MapSheet, which owns the canvas. Null clears it.
  onShowPathChange: (path: Point[] | null) => void
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
  const landTravelMode = modes.find((m) => m.id === landModeId) ?? modes[0]
  // Only meaningfully distinct once the map has landmasses — with none, the
  // whole map counts as land (see isLandAt), so a separate water mode picker
  // would be dead UI. Defaults to the land mode so a map without a dedicated
  // "Sailing"/"Boat" mode set up yet still behaves exactly as before.
  const waterTravelMode = (landmasses.length > 0 && modes.find((m) => m.id === waterModeId)) || landTravelMode

  // Memoized on from/to (themselves stable across renders unless `pins`
  // actually changes, e.g. a drag or fromId/toId edit) — without this,
  // `[from, to]` was a fresh array literal every render, which defeated the
  // `trip` useMemo below (effectivePath was always "new") and re-ran the
  // full geometry sweep on every unrelated re-render of this component (e.g.
  // any keystroke elsewhere in the map editor). Depending on `from`/`to`
  // rather than just their ids keeps this correct if a pin's position moves
  // without its id changing.
  const effectivePath: Point[] | null = useMemo(
    () => drawnPath ?? (from && to && from.id !== to.id ? [from, to] : null),
    [drawnPath, from, to]
  )

  const trip = useMemo(() => {
    if (!effectivePath || effectivePath.length < 2 || !landTravelMode || !waterTravelMode || !scale) return null
    return calculateTrip(effectivePath, zones, lines, terrainTypes, lineTypes, landmasses, waterTerrainTypeId, scale, landTravelMode, waterTravelMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePath, landTravelMode, waterTravelMode, scale, zones, lines, terrainTypes, lineTypes, landmasses, waterTerrainTypeId])

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
                {pins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {pinDisplayLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="sheet-field">
              To
              <select value={to?.id ?? ''} onChange={(e) => setToId(e.target.value)}>
                {pins.map((p) => (
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
        <button className="sheet-open-ref-button" onClick={() => onShowPathChange(effectivePath)} disabled={!effectivePath}>
          Show on map
        </button>
        <button className="sheet-open-ref-button" onClick={() => onShowPathChange(null)}>
          Hide from map
        </button>
      </div>

      {!drawnPath && from && to && from.id === to.id && <p className="right-panel-note">Choose two different pins.</p>}

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
