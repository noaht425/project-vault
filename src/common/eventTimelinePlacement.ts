// Pure axis/zoom/clustering math for the pill timeline view (build step 7
// of docs/plans/2026-07-28-calendar-timeline-system.md). Deliberately does
// NOT render anything or know about calendars/formatting — it only turns
// "events at canonical-minute positions" + "a visible window" + "a pixel
// width" into where each pill (or cluster of pills) should sit. Kept
// generic over T (the caller's own event data) so this has zero dependency
// on note types, React, or IPC.
//
// Design rationale for the zoom/clustering approach (the plan doc
// explicitly calls this out as a real design question, not to hand-wave):
// a fixed linear axis over a vault's ENTIRE event history would make a
// single day-long event centuries ago an invisible sliver next to a
// millennium-spanning gap. The fix used here is the same one real timeline
// tools use — never render the whole range at once. The user views a
// WINDOW (a span of canonical minutes) at a given zoom level, computed as
// a fraction of the full data range (not an absolute constant, since a
// vault's actual event spread could be a few years or several millennia),
// and pans/zooms into whatever region they care about. At any single zoom
// level the window is always a normal linear scale, so nothing is ever
// squished to invisibility. Events still close enough together to overlap
// visually at the CURRENT window/pixel width get merged into one cluster
// pill (same idea as map marker-clustering) rather than drawn on top of
// each other.

export interface TimelineWindow {
  start: number // canonical minutes
  end: number
}

/** The full extent of the visible timeline at zoom level 0 — the actual
 * min/max of the given events' canonical minutes, padded 5% on each side
 * so edge events aren't flush against the axis border. A single point (or
 * empty input) gets a small fixed window so the axis is never zero-width. */
export function computeFullWindow(canonicalMinutes: number[]): TimelineWindow {
  if (canonicalMinutes.length === 0) return { start: 0, end: 1 }
  const min = Math.min(...canonicalMinutes)
  const max = Math.max(...canonicalMinutes)
  if (min === max) return { start: min - 1, end: max + 1 }
  const pad = (max - min) * 0.05
  return { start: min - pad, end: max + pad }
}

// Each zoom level in is 3x narrower than the previous — arbitrary but
// reasonable granularity (finer than halving, coarser than order-of-
// magnitude jumps). Expressed as a ratio of the FULL window's span, not an
// absolute minute count, so zoom levels always make sense regardless of
// how wide a given vault's actual event history is.
const ZOOM_STEP = 3
export const MAX_ZOOM_LEVEL = 8

/** The window for a given zoom level (0 = full extent, higher = narrower),
 * centered on `center` (canonical minutes) — e.g. where the user clicked,
 * or the window's own current center when just changing zoom in place. */
export function windowForZoom(fullWindow: TimelineWindow, zoomLevel: number, center: number): TimelineWindow {
  const fullSpan = fullWindow.end - fullWindow.start
  const span = fullSpan / Math.pow(ZOOM_STEP, Math.max(0, zoomLevel))
  const half = span / 2
  return { start: center - half, end: center + half }
}

/** Shifts a window left/right by a fraction of its own current span (e.g.
 * 0.5 pans forward by half a screen), keeping the same zoom/span. Panning
 * past the full data range is allowed (just shows empty space) rather than
 * clamped — simpler, and the user can always zoom out to re-orient. */
export function panWindow(window: TimelineWindow, fractionOfSpan: number): TimelineWindow {
  const span = window.end - window.start
  const shift = span * fractionOfSpan
  return { start: window.start + shift, end: window.end + shift }
}

export interface TimelineItem<T> {
  minutes: number
  data: T
}

export interface PlacedEvent<T> {
  kind: 'event'
  event: T
  minutes: number
  positionFraction: number // 0..1 across the window
}

export interface PlacedCluster<T> {
  kind: 'cluster'
  events: T[]
  minutes: number // mean of the cluster's members, for its own position/label
  positionFraction: number
}

export type TimelinePlacement<T> = PlacedEvent<T> | PlacedCluster<T>

/**
 * Positions every item that falls within `window` at its proportional
 * pixel position across `pixelWidth`, then greedily merges consecutive
 * items whose pixel positions are closer than `minPillSpacingPx` into one
 * cluster pill — same "chain nearby points together" approach real point-
 * clustering algorithms use, so a dense run of events collapses into a
 * single cluster even though each individual adjacent PAIR is what's being
 * compared, not the cluster's total width.
 */
export function placeEvents<T>(
  items: TimelineItem<T>[],
  window: TimelineWindow,
  pixelWidth: number,
  minPillSpacingPx = 24
): TimelinePlacement<T>[] {
  const span = window.end - window.start
  if (span <= 0 || pixelWidth <= 0) return []

  const visible = items
    .filter((i) => i.minutes >= window.start && i.minutes <= window.end)
    .map((i) => ({ ...i, positionPx: ((i.minutes - window.start) / span) * pixelWidth }))
    .sort((a, b) => a.positionPx - b.positionPx)

  const placements: TimelinePlacement<T>[] = []
  let bucket: typeof visible = []

  const flush = (): void => {
    if (bucket.length === 0) return
    if (bucket.length === 1) {
      const item = bucket[0]
      placements.push({ kind: 'event', event: item.data, minutes: item.minutes, positionFraction: item.positionPx / pixelWidth })
    } else {
      const meanMinutes = bucket.reduce((sum, i) => sum + i.minutes, 0) / bucket.length
      const meanPositionPx = bucket.reduce((sum, i) => sum + i.positionPx, 0) / bucket.length
      placements.push({
        kind: 'cluster',
        events: bucket.map((i) => i.data),
        minutes: meanMinutes,
        positionFraction: meanPositionPx / pixelWidth
      })
    }
    bucket = []
  }

  let lastPx: number | null = null
  for (const item of visible) {
    if (lastPx !== null && item.positionPx - lastPx < minPillSpacingPx) {
      bucket.push(item)
    } else {
      flush()
      bucket = [item]
    }
    lastPx = item.positionPx
  }
  flush()

  return placements
}
