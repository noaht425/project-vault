import type { EventSummary } from './types'
import type { MapPin } from './noteTypes/map'

export interface MapTimelineEntry {
  event: EventSummary
  pin: MapPin
}

/**
 * Events of type 'event' whose `location` matches one of this map's own
 * pins, in chronological order. `events` is assumed already sorted by
 * compareWorldDates (true of vaultApi.listEvents()'s result) — filtering
 * preserves that relative order among survivors, so this doesn't re-sort.
 * History-section-derived facts (noteType !== 'event') never have a
 * `location` field, so they're never included here regardless of what
 * other note type they came from.
 */
export function matchEventsToPins(events: EventSummary[], pins: MapPin[]): MapTimelineEntry[] {
  const pinByTitle = new Map(pins.filter((p) => p.locationTitle).map((p) => [p.locationTitle as string, p]))
  const entries: MapTimelineEntry[] = []
  for (const event of events) {
    if (event.noteType !== 'event' || !event.location) continue
    const pin = pinByTitle.get(event.location)
    if (pin) entries.push({ event, pin })
  }
  return entries
}

/** Events with a location set but no pin placed for it on THIS particular map — a nudge, not something to auto-fix. */
export function countUnplacedEvents(events: EventSummary[], pins: MapPin[]): number {
  const placedTitles = new Set(pins.filter((p) => p.locationTitle).map((p) => p.locationTitle as string))
  return events.filter((e) => e.noteType === 'event' && e.location && !placedTitles.has(e.location)).length
}
