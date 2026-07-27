import { useEffect, useMemo, useState } from 'react'
import { calculateTrip } from '../../../../common/mapGeometry'
import { pinDisplayLabel, type LineType, type MapLine, type MapPin, type MapScale, type MapZone, type TerrainType } from '../../../../common/noteTypes/map'
import { useTravelModesStore, EMPTY_TRAVEL_MODES } from '../../state/travelModesStore'

export function MapTripCalculator({
  pins,
  zones,
  lines,
  terrainTypes,
  lineTypes,
  scale
}: {
  pins: MapPin[]
  zones: MapZone[]
  lines: MapLine[]
  terrainTypes: TerrainType[]
  lineTypes: LineType[]
  scale: MapScale | null
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
  const [modeId, setModeId] = useState('')

  const from = pins.find((p) => p.id === fromId) ?? pins[0]
  const to = pins.find((p) => p.id === toId) ?? pins[1]
  const travelMode = modes.find((m) => m.id === modeId) ?? modes[0]

  const trip = useMemo(() => {
    if (!from || !to || !travelMode || !scale || from.id === to.id) return null
    return calculateTrip(from, to, zones, lines, terrainTypes, lineTypes, scale, travelMode)
  }, [from, to, travelMode, scale, zones, lines, terrainTypes, lineTypes])

  // A segment's terrainTypeId may resolve against either pool — see
  // calculateTrip's own comment on why zones and line-derived corridors
  // share one id space here.
  const terrainNameById = new Map([...terrainTypes, ...lineTypes].map((t) => [t.id, t.name]))

  if (!scale) return <p className="right-panel-note">Calibrate this map's scale first (Calibrate mode) to enable the trip calculator.</p>
  if (pins.length < 2) return <p className="right-panel-note">Place at least two pins to calculate a trip between them.</p>
  if (!loading && modes.length === 0) return <p className="right-panel-note">Add at least one travel mode below first.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
        <label className="sheet-field">
          Travel mode
          <select value={travelMode?.id ?? ''} onChange={(e) => setModeId(e.target.value)}>
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {from && to && from.id === to.id && <p className="right-panel-note">Choose two different pins.</p>}

      {trip && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong>
            {trip.totalRealDistance.toFixed(1)} {scale.unit} —{' '}
            {trip.totalTime === Infinity ? 'no route (impassable terrain)' : `${trip.totalTime.toFixed(1)} ${travelMode.timeUnitLabel}`}
          </strong>
          <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              {trip.segments.map((seg, i) => (
                <tr key={i}>
                  <td style={{ paddingRight: 12 }}>{seg.terrainTypeId ? (terrainNameById.get(seg.terrainTypeId) ?? 'Unknown') : 'Unpainted'}</td>
                  <td style={{ paddingRight: 12 }}>
                    {seg.realDistance.toFixed(1)} {scale.unit}
                  </td>
                  <td>{seg.time === Infinity ? '—' : `${seg.time.toFixed(1)} ${travelMode.timeUnitLabel}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
