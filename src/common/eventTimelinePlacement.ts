// Pure axis/zoom/lane/tick math for the pill timeline view (build step 7
// of docs/plans/2026-07-28-calendar-timeline-system.md). Deliberately does
// NOT render anything or know about React/IPC — it only turns "events at
// canonical-minute positions" + "a visible window" + "a pixel width" into
// where each pill and axis tick should sit. `computeAxisTicks` DOES know
// about calendars (it needs one to generate real date labels), everything
// else here is calendar-agnostic.
//
// Design rationale for the zoom approach (the plan doc explicitly calls
// this out as a real design question, not to hand-wave): a fixed linear
// axis over a vault's ENTIRE event history would make a single day-long
// event centuries ago an invisible sliver next to a millennium-spanning
// gap. The fix used here is the same one real timeline tools use — never
// render the whole range at once. The user views a WINDOW (a span of
// canonical minutes) at a given zoom level, computed as a fraction of the
// full data range (not an absolute constant, since a vault's actual event
// spread could be a few years or several millennia), and pans/zooms into
// whatever region they care about.

import type { CalendarFrontmatter } from './noteTypes/calendar'
import { daysInMonthForYear, fromCanonicalMinutes, toCanonicalMinutes, type CalendarDateParts } from './calendarMath'

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

// A recurring event never needs the user to configure "repeat until when" —
// it's bounded to whatever full date range the vault's OTHER events already
// establish (computeFullWindow above, computed from real anchor dates only,
// never from a recurring event's own generated instances — that ordering
// matters, see EventsPillTimelineView.tsx's placedItems for how the two
// stay decoupled). MAX_RECURRENCE_STEPS is a defensive cap per direction
// against a malformed calendar where advancing a year somehow doesn't move
// canonical minutes forward — not a limit expected to matter in practice.
const MAX_RECURRENCE_STEPS = 1000

/**
 * Expands one annually-recurring event's anchor date into every yearly
 * occurrence (same era/month/day/hour/minute, year advancing by exactly 1
 * within the same era — no era-crossing recurrence in v1) whose canonical
 * minutes fall within `window`. The anchor occurrence itself is always
 * included. A year whose target day doesn't exist for this calendar (e.g.
 * Feb 29 in a non-leap year — see calendarMath.ts's daysInMonthForYear,
 * since toCanonicalMinutes doesn't validate day-in-range) is skipped for
 * that year only; stepping continues to the next year rather than stopping,
 * since one invalid year doesn't mean recurrence has run out.
 */
export function expandAnnualRecurrence(calendar: CalendarFrontmatter, anchor: CalendarDateParts, window: TimelineWindow): number[] {
  const anchorMinutes = toCanonicalMinutes(calendar, anchor)
  if (anchorMinutes === null) return []

  const occurrenceMinutes = (deltaYears: number): number | null => {
    const year = anchor.year + deltaYears
    const daysInTargetMonth = daysInMonthForYear(calendar, anchor.monthId, year)
    if (daysInTargetMonth === null || anchor.day > daysInTargetMonth) return null
    return toCanonicalMinutes(calendar, { ...anchor, year })
  }

  const results = [anchorMinutes]

  for (let delta = 1; delta <= MAX_RECURRENCE_STEPS; delta++) {
    const minutes = occurrenceMinutes(delta)
    if (minutes === null) continue // this year's target day doesn't exist — try the next one
    if (minutes > window.end) break // years only move further into the future from here
    if (minutes >= window.start) results.push(minutes)
  }

  for (let delta = -1; delta >= -MAX_RECURRENCE_STEPS; delta--) {
    const minutes = occurrenceMinutes(delta)
    if (minutes === null) continue
    if (minutes < window.start) break // years only move further into the past from here
    if (minutes <= window.end) results.push(minutes)
  }

  return results
}

// Each whole zoom level in is 3x narrower than the previous — arbitrary
// but reasonable granularity (finer than halving, coarser than order-of-
// magnitude jumps). `zoomLevel` itself is a continuous real number (not
// just integers) so wheel/pinch input can zoom smoothly — the toolbar's
// +/- buttons just step it by a whole level at a time. Expressed as a
// ratio of the FULL window's span, not an absolute minute count, so zoom
// levels always make sense regardless of how wide a given vault's actual
// event history is.
const ZOOM_STEP = 3
export const MAX_ZOOM_LEVEL = 14

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
  // Estimated rendered pixel width of this item's pill, used only to
  // decide lane stacking — no live DOM measurement happens in a pure
  // function, so callers pass their own estimate (e.g. from title
  // length). Defaults applied by placeEventsInLanes when omitted.
  widthPx?: number
}

export interface LanePlacement<T> {
  event: T
  minutes: number
  positionFraction: number // 0..1 across the window
  // 0 = sits directly on the axis; each increment stacks one row further
  // away, for events too close together (in pixel terms, at the CURRENT
  // window/pixel width) to render side by side without overlapping.
  lane: number
}

/**
 * Positions every item within `window` at its proportional pixel position,
 * then assigns each a LANE via the same greedy interval-scheduling
 * algorithm calendar UIs use to stack same-day overlapping meetings side
 * by side: sorted left to right, each item claims the first lane whose
 * last-placed item doesn't visually overlap it (comparing estimated pixel
 * footprints), else opens a new lane. Unlike a count-based cluster bubble,
 * every event stays individually visible and clickable — it just moves
 * up a row when the row below is occupied.
 */
export function placeEventsInLanes<T>(
  items: TimelineItem<T>[],
  window: TimelineWindow,
  pixelWidth: number,
  defaultWidthPx = 100
): LanePlacement<T>[] {
  const span = window.end - window.start
  if (span <= 0 || pixelWidth <= 0) return []

  const visible = items
    .filter((i) => i.minutes >= window.start && i.minutes <= window.end)
    .map((i) => ({ ...i, positionPx: ((i.minutes - window.start) / span) * pixelWidth }))
    .sort((a, b) => a.positionPx - b.positionPx)

  const laneEnds: number[] = [] // rightmost occupied pixel, per lane
  const placements: LanePlacement<T>[] = []

  for (const item of visible) {
    const halfWidth = (item.widthPx ?? defaultWidthPx) / 2
    const left = item.positionPx - halfWidth
    const right = item.positionPx + halfWidth

    let lane = laneEnds.findIndex((end) => end <= left)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(right)
    } else {
      laneEnds[lane] = right
    }

    placements.push({ event: item.data, minutes: item.minutes, positionFraction: item.positionPx / pixelWidth, lane })
  }

  return placements
}

// ---------------------------------------------------------------------
// Axis ticks — adaptive date labels along the bottom of the timeline,
// spaced by whichever calendar-native unit (hour/day/week/month/quarter/
// year/decade/...) best fits the current zoom level.
// ---------------------------------------------------------------------

type TickUnit = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' | 'multiYear'

interface TickStep {
  minutes: number
  unit: TickUnit
}

// Approximate: month/year steps use this calendar's AVERAGE month/year
// length in days rather than walking exact calendar boundaries (which
// would need era-aware month/year arithmetic across the AM/AF direction
// switch). Ticks are a visual reference, not stored data — landing a day
// or two off "the real 1st of the month" at these zoom levels is
// imperceptible, and this keeps the whole thing a simple, correct-enough
// closed-form ladder instead of a second calendar-walking implementation.
function tickLadder(calendar: CalendarFrontmatter): TickStep[] {
  const minutesPerDay = calendar.hoursPerDay * calendar.minutesPerHour
  const totalMonthDays = calendar.months.reduce((sum, m) => sum + m.days, 0)
  const avgMonthDays = calendar.months.length > 0 ? totalMonthDays / calendar.months.length : 30
  const yearDays = totalMonthDays > 0 ? totalMonthDays : 365

  const multiYearSteps = [5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000]

  return [
    { minutes: calendar.minutesPerHour, unit: 'hour' },
    { minutes: calendar.minutesPerHour * 6, unit: 'hour' },
    { minutes: minutesPerDay, unit: 'day' },
    { minutes: minutesPerDay * 7, unit: 'week' },
    { minutes: minutesPerDay * avgMonthDays, unit: 'month' },
    { minutes: minutesPerDay * avgMonthDays * 3, unit: 'quarter' },
    { minutes: minutesPerDay * yearDays, unit: 'year' },
    ...multiYearSteps.map((n) => ({ minutes: minutesPerDay * yearDays * n, unit: 'multiYear' as const }))
  ]
}

function formatTickLabel(calendar: CalendarFrontmatter, parts: NonNullable<ReturnType<typeof fromCanonicalMinutes>>, unit: TickUnit): string {
  const era = calendar.eras.find((e) => e.id === parts.eraId)
  const eraLabel = era ? era.abbreviation || era.name : ''
  const month = calendar.months.find((m) => m.id === parts.monthId)
  const yearLabel = `${parts.year}${eraLabel ? ` ${eraLabel}` : ''}`

  switch (unit) {
    case 'hour':
      return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
    case 'day':
    case 'week':
      return `${parts.day} ${month?.name ?? ''}`
    case 'month':
    case 'quarter':
      return `${month?.name ?? ''} ${yearLabel}`
    case 'year':
    case 'multiYear':
    default:
      return yearLabel
  }
}

export interface AxisTick {
  minutes: number
  positionFraction: number
  label: string
}

/**
 * Ticks spaced at whichever calendar-native unit keeps the tick count near
 * `targetTickCount` for the CURRENT window — zoomed all the way out over
 * millennia gets century/millennium ticks, zoomed into a single day gets
 * hour ticks, with every step in between. Returns [] if `calendar` is null
 * (no active calendar to format labels with — same "nothing to show
 * without one" fallback the rest of this view already uses).
 */
export function computeAxisTicks(calendar: CalendarFrontmatter | null, window: TimelineWindow, targetTickCount = 6): AxisTick[] {
  if (!calendar) return []
  const span = window.end - window.start
  if (span <= 0) return []

  const ladder = tickLadder(calendar)
  let step = ladder[ladder.length - 1]
  for (const candidate of ladder) {
    if (span / candidate.minutes <= targetTickCount) {
      step = candidate
      break
    }
  }

  const ticks: AxisTick[] = []
  const firstTick = Math.ceil(window.start / step.minutes) * step.minutes
  for (let m = firstTick; m <= window.end; m += step.minutes) {
    const parts = fromCanonicalMinutes(calendar, m)
    if (!parts) continue
    ticks.push({ minutes: m, positionFraction: (m - window.start) / span, label: formatTickLabel(calendar, parts, step.unit) })
  }
  return ticks
}
