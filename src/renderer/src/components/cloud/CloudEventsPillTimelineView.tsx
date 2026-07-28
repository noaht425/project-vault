import { useEffect, useMemo, useRef, useState } from 'react'
import type { CloudEventSummary, CloudWorkspaceSettings } from '../../../../common/cloudTypes'
import { calendarFrontmatterSchema, type CalendarFrontmatter } from '../../../../common/noteTypes/calendar'
import { toCanonicalMinutes, fromCanonicalMinutes, formatCalendarDate } from '../../../../common/calendarMath'
import {
  computeFullWindow,
  windowForZoom,
  panWindow,
  placeEventsInLanes,
  computeAxisTicks,
  MAX_ZOOM_LEVEL,
  type LanePlacement
} from '../../../../common/eventTimelinePlacement'
import { useCloudNoteRefApi } from '../../lib/noteRefApi'

interface PlacedEventData {
  event: CloudEventSummary
  minutes: number
}

const LANE_HEIGHT = 30
const BASE_CONNECTOR_HEIGHT = 8
function estimatePillWidth(title: string): number {
  return Math.max(70, Math.min(220, title.length * 6.5 + 28))
}
const ZOOM_WHEEL_SENSITIVITY = 0.015

// Cloud counterpart of EventsPillTimelineView.tsx — same layout/logic,
// swapping vaultApi for cloudApi and path identity for id (see that file
// for the full design rationale, step 7 of
// docs/plans/2026-07-28-calendar-timeline-system.md).
export function CloudEventsPillTimelineView({ onOpenEvent }: { onOpenEvent: (id: string) => void }): React.JSX.Element {
  const noteRefApi = useCloudNoteRefApi()
  const [events, setEvents] = useState<CloudEventSummary[] | null>(null)
  const [calendars, setCalendars] = useState<{ title: string; frontmatter: CalendarFrontmatter }[] | null>(null)
  const [settings, setSettings] = useState<CloudWorkspaceSettings | null>(null)
  const [zoomLevel, setZoomLevel] = useState(0)
  const [center, setCenter] = useState<number | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  // Callback ref, not plain useRef — see EventsPillTimelineView.tsx's
  // identical comment for why (the track div only exists once loading
  // finishes, so an effect with `[]` deps would fire once against a
  // still-null ref and never run again).
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const [allEvents, calendarMatches, workspaceSettings] = await Promise.all([
          window.cloudApi.listEvents(),
          noteRefApi.searchTitles('', 'calendar'),
          // Falls back to "no active calendars" rather than letting a
          // failure here (e.g. the active_calendar_titles migration not
          // having been run yet against this Supabase project — see
          // docs/plans/2026-07-28-calendar-timeline-system.md's step 6
          // notes) reject the whole Promise.all and leave this view stuck
          // on "Loading…" forever, since nothing else here depends on it.
          window.cloudApi.getWorkspaceSettings().catch(() => ({ activeCalendarNoteTitles: [] }))
        ])
        setEvents(allEvents)
        setSettings(workspaceSettings)
        const defs = await Promise.all(
          calendarMatches.map(async (m) => {
            const fm = await noteRefApi.readFrontmatterByTitle(m.title, 'calendar')
            const parsed = fm ? calendarFrontmatterSchema.safeParse(fm) : null
            return parsed?.success ? { title: m.title, frontmatter: parsed.data } : null
          })
        )
        setCalendars(defs.filter((d): d is { title: string; frontmatter: CalendarFrontmatter } => d !== null))
      } catch (err) {
        // Any other failure (e.g. listEvents/searchTitles itself) still
        // shouldn't leave this view stuck on "Loading…" forever — fall
        // back to empty rather than hang indefinitely.
        console.error('Failed to load pill timeline data:', err)
        setEvents((prev) => prev ?? [])
        setCalendars((prev) => prev ?? [])
      }
    }
    void load()
    const off = window.cloudApi.onTreeUpdated(() => void load())
    return () => off()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const calendarByTitle = useMemo(() => new Map((calendars ?? []).map((c) => [c.title, c.frontmatter])), [calendars])

  const placedItems = useMemo<PlacedEventData[]>(() => {
    if (!events) return []
    const items: PlacedEventData[] = []
    for (const event of events) {
      if (event.noteType !== 'event' || !event.structuredDate) continue
      const calendar = calendarByTitle.get(event.structuredDate.calendarNoteTitle)
      if (!calendar) continue
      const minutes = toCanonicalMinutes(calendar, event.structuredDate)
      if (minutes !== null) items.push({ event, minutes })
    }
    return items
  }, [events, calendarByTitle])

  const fullWindow = useMemo(() => computeFullWindow(placedItems.map((i) => i.minutes)), [placedItems])
  const effectiveCenter = center ?? (fullWindow.start + fullWindow.end) / 2
  const currentWindow = windowForZoom(fullWindow, zoomLevel, effectiveCenter)

  const activeCalendars = (settings?.activeCalendarNoteTitles ?? [])
    .map((title) => calendarByTitle.get(title))
    .filter((c): c is CalendarFrontmatter => c !== undefined)
  const tickCalendar = activeCalendars[0] ?? null

  const placements = useMemo<LanePlacement<CloudEventSummary>[]>(
    () =>
      placeEventsInLanes(
        placedItems.map((i) => ({ minutes: i.minutes, data: i.event, widthPx: estimatePillWidth(i.event.name) })),
        currentWindow,
        containerWidth
      ),
    [placedItems, currentWindow, containerWidth]
  )

  const ticks = useMemo(() => computeAxisTicks(tickCalendar, currentWindow), [tickCalendar, currentWindow])

  const formatDate = (event: CloudEventSummary, minutes: number): string => {
    if (activeCalendars.length === 0) return event.date || 'Undated'
    const labels = activeCalendars
      .map((cal) => {
        const parts = fromCanonicalMinutes(cal, minutes)
        return parts ? formatCalendarDate(cal, parts) : null
      })
      .filter((label): label is string => label !== null)
    return labels.length > 0 ? labels.join(' / ') : event.date || 'Undated'
  }

  const toggleActiveCalendar = (title: string, active: boolean): void => {
    const current = settings?.activeCalendarNoteTitles ?? []
    const next = active ? [...current, title] : current.filter((t) => t !== title)
    void window.cloudApi.updateWorkspaceSettings({ activeCalendarNoteTitles: next }).then(setSettings)
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
        setCenter(c)
        setZoomLevel((z) => Math.min(MAX_ZOOM_LEVEL, Math.max(0, z - e.deltaY * ZOOM_WHEEL_SENSITIVITY)))
      } else {
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
        {/* Two flat passes, not one nested pass per event — see
            EventsPillTimelineView.tsx's identical comment: .pill-anchor's
            translateX(-50%) creates its own stacking context, which
            traps z-index comparisons inside one event's own pill+
            connector pair and can't reach across to a DIFFERENT event's
            anchor. Rendering every connector before every pill makes
            plain paint order (not z-index) guarantee pills stay on top. */}
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
              {p.event.name}
            </button>
            {expandedIndex === i && (
              <div className="pill-expanded">
                <div className="pill-expanded-date">{formatDate(p.event, p.minutes)}</div>
                <div className="pill-expanded-title">{p.event.name}</div>
                {p.event.summary && <div className="pill-expanded-summary">{p.event.summary}</div>}
                <button className="sheet-open-ref-button" onClick={() => onOpenEvent(p.event.id)}>
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
