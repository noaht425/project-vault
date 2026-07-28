import { useEffect, useMemo, useState } from 'react'
import type { EventSummary, VaultSettings } from '../../../../common/types'
import { calendarFrontmatterSchema, type CalendarFrontmatter } from '../../../../common/noteTypes/calendar'
import { toCanonicalMinutes, fromCanonicalMinutes, formatCalendarDate } from '../../../../common/calendarMath'
import {
  computeFullWindow,
  windowForZoom,
  panWindow,
  placeEvents,
  MAX_ZOOM_LEVEL,
  type TimelinePlacement
} from '../../../../common/eventTimelinePlacement'
import { useLocalNoteRefApi } from '../../lib/noteRefApi'

interface PlacedEventData {
  event: EventSummary
  minutes: number
}

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
  // A callback ref, not a plain useRef + effect-on-mount — the track div
  // only exists once `events`/`calendars` finish loading (the initial
  // render shows the "Loading…" branch instead), so an effect with `[]`
  // deps would fire once against a still-null ref and never run again.
  // A callback ref fires exactly when the node actually attaches,
  // whichever render pass that happens on.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => {
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
    }
    void load()
    const off = window.vaultApi.onTreeUpdated(() => void load())
    return () => off()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!container) return
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width))
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

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

  const placements = useMemo<TimelinePlacement<EventSummary>[]>(
    () =>
      placeEvents(
        placedItems.map((i) => ({ minutes: i.minutes, data: i.event })),
        currentWindow,
        containerWidth
      ),
    [placedItems, currentWindow, containerWidth]
  )

  const activeCalendars = (settings?.activeCalendarNoteTitles ?? [])
    .map((title) => calendarByTitle.get(title))
    .filter((c): c is CalendarFrontmatter => c !== undefined)

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

  const toggleActiveCalendar = (title: string, active: boolean): void => {
    const current = settings?.activeCalendarNoteTitles ?? []
    const next = active ? [...current, title] : current.filter((t) => t !== title)
    void window.vaultApi.updateSettings({ activeCalendarNoteTitles: next }).then(setSettings)
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

      <div className="pill-timeline-track" ref={setContainer}>
        {placements.map((p, i) => (
          <div key={i} className="pill-anchor" style={{ left: `${p.positionFraction * 100}%` }}>
            {p.kind === 'cluster' ? (
              <button className="pill pill-cluster" onClick={() => zoomIn(p.minutes)} title="Zoom in on this cluster">
                {p.events.length}
              </button>
            ) : (
              <>
                <button className="pill" onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}>
                  {p.event.title}
                </button>
                {expandedIndex === i && (
                  <div className="pill-expanded">
                    <div className="pill-expanded-date">{formatDate(p.event, p.minutes)}</div>
                    <div className="pill-expanded-title">{p.event.title}</div>
                    {p.event.summary && <div className="pill-expanded-summary">{p.event.summary}</div>}
                    <button className="sheet-open-ref-button" onClick={() => onOpenEvent(p.event.path)}>
                      Open note ↗
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
