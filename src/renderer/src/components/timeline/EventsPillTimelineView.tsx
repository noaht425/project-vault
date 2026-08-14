import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventSummary, VaultSettings } from '../../../../common/types'
import { calendarFrontmatterSchema, type CalendarFrontmatter } from '../../../../common/noteTypes/calendar'
import { toCanonicalMinutes, fromCanonicalMinutes, formatCalendarDate, computeMoonPhase } from '../../../../common/calendarMath'
import {
  computeFullWindow,
  windowForZoom,
  panWindow,
  placeEventsInLanes,
  computeAxisTicks,
  expandAnnualRecurrence,
  MAX_ZOOM_LEVEL,
  type LanePlacement
} from '../../../../common/eventTimelinePlacement'
import { useLocalNoteRefApi } from '../../lib/noteRefApi'

interface PlacedEventData {
  event: EventSummary
  minutes: number
}

const LANE_HEIGHT = 30
const BASE_CONNECTOR_HEIGHT = 8
// listEvents() reads and parses every note in the vault — onTreeUpdated
// fires once per save, so a burst of several saves in quick succession
// (e.g. bulk-editing a few notes) would otherwise trigger that same
// full-vault re-scan once per save instead of once for the whole burst.
const RELOAD_DEBOUNCE_MS = 400
// No live DOM measurement in this pure-data pipeline — a rough estimate
// from title length keeps lane-stacking from either over-stacking short
// titles or overlapping long ones. Padding/clamped to a sane pixel range.
function estimatePillWidth(title: string): number {
  return Math.max(70, Math.min(220, title.length * 6.5 + 28))
}
// Trackpad pinch (reported as wheel events with ctrlKey set) delivers many
// small deltaY ticks over the course of one gesture — this converts a
// single tick into a small fraction of a zoom level so a full pinch
// gesture feels smooth and continuous rather than jumping levels.
const ZOOM_WHEEL_SENSITIVITY = 0.015

// Step 7 of docs/plans/2026-07-28-calendar-timeline-system.md — a scaled,
// zoomable/pannable horizontal axis, distinct from EventsTimelineView's
// plain sorted list (that view stays as the default; this is a sibling,
// see EventsSection.tsx for the toggle between them). Only dedicated
// `event` notes with a RESOLVED structuredDate can be placed here — a
// free-text-only date (or a History-bullet/Born-Died fact, which has no
// structuredDate concept at all) has no numeric position to plot, so
// those stay list-only.
export function EventsPillTimelineView({ onOpenEvent }: { onOpenEvent: (path: string) => void }): React.JSX.Element {
  const noteRefApi = useLocalNoteRefApi()
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  const [calendars, setCalendars] = useState<{ title: string; frontmatter: CalendarFrontmatter }[] | null>(null)
  const [settings, setSettings] = useState<VaultSettings | null>(null)
  const [zoomLevel, setZoomLevel] = useState(0)
  const [center, setCenter] = useState<number | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  // Callback ref, not plain useRef — the track div only exists once
  // `events`/`calendars` finish loading (the initial render shows the
  // "Loading…" branch instead), so an effect with `[]` deps would fire
  // once against a still-null ref and never run again. A callback ref
  // fires exactly when the node actually attaches, whichever render pass
  // that happens on.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const [allEvents, calendarMatches, vaultSettings] = await Promise.all([
          window.vaultApi.listEvents(),
          noteRefApi.searchTitles('', 'calendar'),
          window.vaultApi.getSettings()
        ])
        setEvents(allEvents)
        setSettings(vaultSettings)
        const defs = await Promise.all(
          calendarMatches.map(async (m) => {
            const fm = await noteRefApi.readFrontmatterByTitle(m.title, 'calendar')
            const parsed = fm ? calendarFrontmatterSchema.safeParse(fm) : null
            return parsed?.success ? { title: m.title, frontmatter: parsed.data } : null
          })
        )
        setCalendars(defs.filter((d): d is { title: string; frontmatter: CalendarFrontmatter } => d !== null))
      } catch (err) {
        // Never leave this view stuck on "Loading…" forever over a
        // transient IPC failure — fall back to empty rather than hang.
        console.error('Failed to load pill timeline data:', err)
        setEvents((prev) => prev ?? [])
        setCalendars((prev) => prev ?? [])
      }
    }
    void load()
    let reloadTimer: ReturnType<typeof setTimeout> | undefined
    const off = window.vaultApi.onTreeUpdated(() => {
      clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => void load(), RELOAD_DEBOUNCE_MS)
    })
    return () => {
      off()
      clearTimeout(reloadTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const calendarByTitle = useMemo(() => new Map((calendars ?? []).map((c) => [c.title, c.frontmatter])), [calendars])

  const anchorItems = useMemo<PlacedEventData[]>(() => {
    if (!events) return []
    const items: PlacedEventData[] = []
    for (const event of events) {
      if (!event.structuredDate) continue
      const calendar = calendarByTitle.get(event.structuredDate.calendarNoteTitle)
      if (!calendar) continue
      const minutes = toCanonicalMinutes(calendar, event.structuredDate)
      if (minutes !== null) items.push({ event, minutes })
    }
    return items
  }, [events, calendarByTitle])

  // Computed from anchors only — never from a recurring event's own
  // generated occurrences below — so recurrence expansion is bounded by
  // this window rather than able to grow it (see eventTimelinePlacement.ts's
  // expandAnnualRecurrence comment for why that ordering matters).
  const fullWindow = useMemo(() => computeFullWindow(anchorItems.map((i) => i.minutes)), [anchorItems])

  const placedItems = useMemo<PlacedEventData[]>(() => {
    const items: PlacedEventData[] = []
    for (const item of anchorItems) {
      if (!item.event.structuredDate?.annualRecurrence) {
        items.push(item)
        continue
      }
      const calendar = calendarByTitle.get(item.event.structuredDate.calendarNoteTitle)
      if (!calendar) continue
      for (const minutes of expandAnnualRecurrence(calendar, item.event.structuredDate, fullWindow)) {
        items.push({ event: item.event, minutes })
      }
    }
    return items
  }, [anchorItems, calendarByTitle, fullWindow])
  const effectiveCenter = center ?? (fullWindow.start + fullWindow.end) / 2
  const currentWindow = windowForZoom(fullWindow, zoomLevel, effectiveCenter)

  const activeCalendars = (settings?.activeCalendarNoteTitles ?? [])
    .map((title) => calendarByTitle.get(title))
    .filter((c): c is CalendarFrontmatter => c !== undefined)
  const tickCalendar = activeCalendars[0] ?? null

  const placements = useMemo<LanePlacement<EventSummary>[]>(
    () =>
      placeEventsInLanes(
        placedItems.map((i) => ({ minutes: i.minutes, data: i.event, widthPx: estimatePillWidth(i.event.title) })),
        currentWindow,
        containerWidth
      ),
    [placedItems, currentWindow, containerWidth]
  )

  const ticks = useMemo(() => computeAxisTicks(tickCalendar, currentWindow), [tickCalendar, currentWindow])

  const formatDate = (event: EventSummary, minutes: number): string => {
    if (activeCalendars.length === 0) return event.date || 'Undated'
    const labels = activeCalendars
      .map((cal) => {
        const parts = fromCanonicalMinutes(cal, minutes)
        return parts ? formatCalendarDate(cal, parts) : null
      })
      .filter((label): label is string => label !== null)
    return labels.length > 0 ? labels.join(' / ') : event.date || 'Undated'
  }

  // Every active calendar's own moons (a calendar with none contributes
  // nothing) — cycleDays/phaseOffsetDays are calendar-agnostic (see
  // calendarMoonSchema's comment), so a moon shared conceptually across
  // calendars would just need re-declaring per calendar, same as everything
  // else calendar-scoped in this app.
  const formatMoonPhases = (minutes: number): string | null => {
    const labels = activeCalendars.flatMap((cal) =>
      cal.moons.map((moon) => {
        const phase = computeMoonPhase(cal, moon, minutes)
        return `${phase.emoji} ${moon.name}: ${phase.name}`
      })
    )
    return labels.length > 0 ? labels.join(' · ') : null
  }

  const toggleActiveCalendar = (title: string, active: boolean): void => {
    const current = settings?.activeCalendarNoteTitles ?? []
    const next = active ? [...current, title] : current.filter((t) => t !== title)
    window.vaultApi
      .updateSettings({ activeCalendarNoteTitles: next })
      .then(setSettings)
      .catch((err) => console.error('Failed to update active calendars:', err))
  }

  const zoomIn = (atCenter: number): void => {
    setCenter(atCenter)
    setZoomLevel((z) => Math.min(MAX_ZOOM_LEVEL, z + 1))
  }
  const zoomOut = (): void => setZoomLevel((z) => Math.max(0, z - 1))
  const pan = (fraction: number): void => {
    const panned = panWindow(currentWindow, fraction)
    setCenter((panned.start + panned.end) / 2)
  }

  // Wheel handling needs the LATEST window/center/width inside a listener
  // that's only attached once per container node — a ref updated every
  // render (not a dependency-tracked effect) is what lets the one
  // long-lived listener always read fresh values instead of a stale
  // closure from whichever render first attached it.
  const liveRef = useRef({ currentWindow, effectiveCenter, containerWidth })
  liveRef.current = { currentWindow, effectiveCenter, containerWidth }

  useEffect(() => {
    if (!container) return
    const handleWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const { currentWindow: win, effectiveCenter: c, containerWidth: width } = liveRef.current
      if (e.ctrlKey) {
        // Trackpad pinch (Chromium reports this as ctrl+wheel) or an
        // actual Ctrl+scroll — zoom continuously, centered where the
        // cursor already is.
        setCenter(c)
        setZoomLevel((z) => Math.min(MAX_ZOOM_LEVEL, Math.max(0, z - e.deltaY * ZOOM_WHEEL_SENSITIVITY)))
      } else {
        // Plain scroll (trackpad two-finger swipe, or a mouse wheel) —
        // pan. Prefer horizontal delta; vertical is the common case for a
        // plain mouse wheel over a horizontal timeline.
        const pixelDelta = e.deltaX !== 0 ? e.deltaX : e.deltaY
        if (width <= 0) return
        const span = win.end - win.start
        setCenter(c + (pixelDelta / width) * span)
      }
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [container])

  useEffect(() => {
    if (!container) return
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width))
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

  // For an arbitrary point on the axis (a window edge, not a specific
  // event) there's no free-text fallback — null means "no active
  // calendar to format this with."
  const formatWindowEdge = (minutes: number): string | null => {
    if (activeCalendars.length === 0) return null
    const cal = activeCalendars[0]
    const parts = fromCanonicalMinutes(cal, minutes)
    return parts ? formatCalendarDate(cal, parts) : null
  }

  if (events === null || calendars === null) {
    return <div className="timeline-view timeline-empty">Loading…</div>
  }

  if (placedItems.length === 0) {
    return (
      <div className="timeline-view timeline-empty">
        No events with a structured date yet — set one in an Event note's "Also set a structured date" section, or
        wait for the automatic migration to match one against a calendar note.
      </div>
    )
  }

  const maxLane = placements.reduce((max, p) => Math.max(max, p.lane), 0)
  const trackHeight = LANE_HEIGHT * (maxLane + 1) + BASE_CONNECTOR_HEIGHT + 24

  return (
    <div className="timeline-view pill-timeline-view">
      <h2>Timeline</h2>

      {calendars.length > 0 && (
        <div className="pill-timeline-calendar-toggles">
          <span className="right-panel-note">Show dates in:</span>
          {calendars.map((c) => (
            <label key={c.title} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={(settings?.activeCalendarNoteTitles ?? []).includes(c.title)}
                onChange={(e) => toggleActiveCalendar(c.title, e.target.checked)}
              />
              {c.title}
            </label>
          ))}
        </div>
      )}

      <div className="pill-timeline-toolbar">
        <button onClick={() => pan(-0.4)}>← Pan</button>
        <button onClick={() => pan(0.4)}>Pan →</button>
        <button onClick={zoomOut} disabled={zoomLevel === 0}>
          Zoom out
        </button>
        <button onClick={() => zoomIn(effectiveCenter)} disabled={zoomLevel === MAX_ZOOM_LEVEL}>
          Zoom in
        </button>
        {zoomLevel > 0 && (
          <button
            onClick={() => {
              setZoomLevel(0)
              setCenter(null)
            }}
          >
            Reset zoom
          </button>
        )}
      </div>

      <p className="right-panel-note pill-timeline-range">
        {activeCalendars.length === 0
          ? 'Check a calendar above to see dates here — otherwise this shows only bare pill titles.'
          : `Viewing: ${formatWindowEdge(currentWindow.start)} → ${formatWindowEdge(currentWindow.end)}`}
        {' — scroll/two-finger-swipe to pan, pinch (or Ctrl+scroll) to zoom.'}
      </p>

      <div className="pill-timeline-track" ref={setContainer} style={{ height: trackHeight }}>
        {/* Two flat passes, not one nested pass per event — every connector
            line renders (and so paints, and so stacks) BEFORE every pill,
            guaranteeing pills always sit on top regardless of which event's
            data drives them. A per-event wrapper can't do this: .pill-anchor's
            translateX(-50%) creates its own stacking context, which isolates
            z-index comparisons to within ONE event's own pill+connector pair
            and can never reach across to a DIFFERENT event's anchor — which
            is exactly the case that needs fixing (one event's tall connector
            crossing behind a different, lower-lane event's pill). */}
        {placements.map((p, i) => (
          <div
            key={`connector-${i}`}
            className="pill-connector"
            style={{ left: `${p.positionFraction * 100}%`, height: p.lane * LANE_HEIGHT + BASE_CONNECTOR_HEIGHT }}
          />
        ))}
        {placements.map((p, i) => (
          <div
            key={`pill-${i}`}
            className="pill-anchor"
            style={{ left: `${p.positionFraction * 100}%`, bottom: p.lane * LANE_HEIGHT + BASE_CONNECTOR_HEIGHT }}
          >
            <button className="pill" onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}>
              {p.event.structuredDate?.annualRecurrence && <span title="Recurs annually">↻ </span>}
              {p.event.title}
            </button>
            {expandedIndex === i && (
              <div className="pill-expanded">
                <div className="pill-expanded-date">
                  {formatDate(p.event, p.minutes)}
                  {p.event.structuredDate?.annualRecurrence && ' (recurs annually)'}
                </div>
                <div className="pill-expanded-title">{p.event.title}</div>
                {formatMoonPhases(p.minutes) && <div className="pill-expanded-moons">{formatMoonPhases(p.minutes)}</div>}
                {p.event.summary && <div className="pill-expanded-summary">{p.event.summary}</div>}
                <button className="sheet-open-ref-button" onClick={() => onOpenEvent(p.event.path)}>
                  Open note ↗
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="pill-timeline-ticks">
        {ticks.map((t, i) => (
          <div key={i} className="pill-tick" style={{ left: `${t.positionFraction * 100}%` }}>
            <div className="pill-tick-mark" />
            <div className="pill-tick-label">{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
