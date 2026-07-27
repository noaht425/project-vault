import { useEffect, useMemo, useState } from 'react'
import { calculateTrip } from '../../../../common/mapGeometry'
import { matchEventsToPins, countUnplacedEvents } from '../../../../common/mapTimeline'
import { pinDisplayLabel, type LineType, type MapLine, type MapPin, type MapScale, type MapZone, type TerrainType } from '../../../../common/noteTypes/map'
import type { EventSummary } from '../../../../common/types'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { useTravelModesStore, EMPTY_TRAVEL_MODES } from '../../state/travelModesStore'

function pluralEvents(n: number): string {
  return `${n} event${n === 1 ? '' : 's'}`
}

/**
 * Steps chronologically through this map's location-tagged events, one
 * reveal at a time (an index-based slider, not one scaled to real elapsed
 * time — unevenly-spaced events would otherwise make the slider jump past
 * several at once or sit idle for a long stretch). Revealing an event rings
 * its pin on the map (via onHighlightChange, lifted up to MapSheet) and
 * shows the trip distance/time from the previously revealed event, reusing
 * the same calculateTrip the Trip Calculator uses.
 */
export function MapTimeline({
  pins,
  zones,
  lines,
  terrainTypes,
  lineTypes,
  scale,
  noteRefApi,
  onHighlightChange
}: {
  pins: MapPin[]
  zones: MapZone[]
  lines: MapLine[]
  terrainTypes: TerrainType[]
  lineTypes: LineType[]
  scale: MapScale | null
  noteRefApi: NoteRefApi
  onHighlightChange: (ids: Set<string>) => void
}): React.JSX.Element {
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  const [revealedCount, setRevealedCount] = useState(0)
  const [modeId, setModeId] = useState('')

  const travelModesNoteId = useTravelModesStore((s) => s.noteId)
  const travelModesLoading = useTravelModesStore((s) => s.loading)
  const modes = useTravelModesStore((s) => s.frontmatter?.modes ?? EMPTY_TRAVEL_MODES)
  const loadTravelModes = useTravelModesStore((s) => s.load)
  useEffect(() => {
    if (!travelModesNoteId && !travelModesLoading) void loadTravelModes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const travelMode = modes.find((m) => m.id === modeId) ?? modes[0]

  useEffect(() => {
    const load = async (): Promise<void> => setEvents(await window.vaultApi.listEvents())
    void load()
    const off = window.vaultApi.onTreeUpdated(() => void load())
    return () => off()
  }, [])

  const matched = useMemo(() => matchEventsToPins(events ?? [], pins), [events, pins])
  const unplacedCount = useMemo(() => countUnplacedEvents(events ?? [], pins), [events, pins])

  // Clamp whenever the matched set shrinks (a pin got removed, an event lost
  // its location) so the slider can't point past the end.
  useEffect(() => {
    setRevealedCount((n) => Math.min(n, matched.length))
  }, [matched.length])

  useEffect(() => {
    onHighlightChange(new Set(matched.slice(0, revealedCount).map((m) => m.pin.id)))
    // Collapsing this section (unmount) shouldn't leave a stale ring on the map.
    return () => onHighlightChange(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, revealedCount])

  if (events === null) return <p className="right-panel-note">Loading events…</p>

  if (matched.length === 0) {
    return (
      <p className="right-panel-note">
        No events with a location placed on this map yet — set an Event note's Location field to a place pinned here.
        {unplacedCount > 0 && ` (${pluralEvents(unplacedCount)} elsewhere, not on this map.)`}
      </p>
    )
  }

  const revealed = matched.slice(0, revealedCount)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="sheet-row">
        <label className="sheet-field" style={{ flex: 2 }}>
          Reveal up to
          <input
            type="range"
            min={0}
            max={matched.length}
            value={revealedCount}
            onChange={(e) => setRevealedCount(Number(e.target.value))}
          />
        </label>
        {modes.length > 0 && (
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
        )}
      </div>

      <p className="right-panel-note">
        {revealedCount} of {matched.length} events revealed
        {unplacedCount > 0 && ` · ${pluralEvents(unplacedCount)} elsewhere, not on this map`}
      </p>

      {revealed.length === 0 ? (
        <p className="right-panel-note">Drag the slider to start revealing events chronologically.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {revealed.map((entry, i) => {
            const prev = i > 0 ? revealed[i - 1] : null
            const trip =
              prev && scale && travelMode && prev.pin.id !== entry.pin.id
                ? calculateTrip(prev.pin, entry.pin, zones, lines, terrainTypes, lineTypes, scale, travelMode)
                : null
            return (
              <div key={`${entry.event.path}-${i}`}>
                {trip && (
                  <div className="right-panel-note" style={{ paddingLeft: 4 }}>
                    ↓{' '}
                    {trip.totalTime === Infinity
                      ? 'no route (impassable terrain)'
                      : `${trip.totalRealDistance.toFixed(1)} ${scale!.unit}, ${trip.totalTime.toFixed(1)} ${travelMode!.timeUnitLabel}`}
                  </div>
                )}
                <button
                  onClick={() => void noteRefApi.openByTitle(entry.event.title, 'event')}
                  style={{ textAlign: 'left', width: '100%' }}
                >
                  <strong>{entry.event.date || 'Undated'}</strong> — {entry.event.title}
                  <span className="right-panel-note"> at {pinDisplayLabel(entry.pin)}</span>
                  {entry.event.summary && <div className="right-panel-note">{entry.event.summary}</div>}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
