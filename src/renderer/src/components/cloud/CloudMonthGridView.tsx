import { useEffect, useMemo, useState, useRef } from 'react'
import { z } from 'zod'
import type { CloudEventSummary, CloudWorkspaceSettings } from '../../../../common/cloudTypes'
import { calendarFrontmatterSchema, type CalendarFrontmatter } from '../../../../common/noteTypes/calendar'
import { climateFrontmatterSchema, type ClimateFrontmatter } from '../../../../common/noteTypes/climate'
import { toCanonicalMinutes, fromCanonicalMinutes, formatCalendarDate, computeMoonPhase } from '../../../../common/calendarMath'
import { computeWeatherForDate } from '../../../../common/weatherGeneration'
import { computeFullWindow, expandAnnualRecurrence } from '../../../../common/eventTimelinePlacement'
import { buildMonthGrid, stepMonth, monthRefForMinutes, bucketByDay, type MonthRef, type MonthGrid } from '../../../../common/monthGrid'
import { useCloudNoteRefApi } from '../../lib/noteRefApi'

// A minimal shape for reading just `climateNoteTitle` off a location or
// settlement note — same as EventSheet.tsx's identical local schema.
const placeClimateRefSchema = z.object({ climateNoteTitle: z.string().nullable().catch(null) }).passthrough()

interface ClimateRosterEntry {
  placeTitle: string
  climate: ClimateFrontmatter
}

const MAX_EVENT_CHIPS_PER_DAY = 3
const UPCOMING_COUNT = 5

function resolveInitialMonthRef(
  calendar: CalendarFrontmatter,
  calendarTitle: string,
  settings: CloudWorkspaceSettings,
  events: CloudEventSummary[]
): MonthRef {
  if (settings.campaignDate?.calendarNoteTitle === calendarTitle) {
    const minutes = toCanonicalMinutes(calendar, { ...settings.campaignDate, hour: 0, minute: 0 })
    const ref = minutes !== null ? monthRefForMinutes(calendar, minutes) : null
    if (ref) return ref
  }
  const latestMinutes = events
    .filter((e) => e.noteType === 'event' && e.structuredDate?.calendarNoteTitle === calendarTitle)
    .map((e) => toCanonicalMinutes(calendar, e.structuredDate!))
    .filter((m): m is number => m !== null)
    .sort((a, b) => b - a)[0]
  if (latestMinutes !== undefined) {
    const ref = monthRefForMinutes(calendar, latestMinutes)
    if (ref) return ref
  }
  return { eraId: calendar.eras[0]?.id ?? '', year: 1, monthId: calendar.months[0]?.id ?? '' }
}

// Cloud counterpart of MonthGridView.tsx — same layout/logic, swapping
// vaultApi for cloudApi and path identity for id (see that file for the
// full design rationale, docs/plans/2026-07-29-month-grid-campaign-date.md).
export function CloudMonthGridView({ onOpenEvent }: { onOpenEvent: (id: string) => void }): React.JSX.Element {
  const noteRefApi = useCloudNoteRefApi()
  const [events, setEvents] = useState<CloudEventSummary[] | null>(null)
  const [calendars, setCalendars] = useState<{ title: string; frontmatter: CalendarFrontmatter }[] | null>(null)
  const [settings, setSettings] = useState<CloudWorkspaceSettings | null>(null)
  const [climateRoster, setClimateRoster] = useState<ClimateRosterEntry[] | null>(null)
  const [selectedCalendarTitle, setSelectedCalendarTitle] = useState<string | null>(null)
  const [monthRef, setMonthRef] = useState<MonthRef | null>(null)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const [allEvents, calendarMatches, workspaceSettings, locationMatches, settlementMatches] = await Promise.all([
          window.cloudApi.listEvents(),
          noteRefApi.searchTitles('', 'calendar'),
          window.cloudApi.getWorkspaceSettings().catch(() => ({ activeCalendarNoteTitles: [], campaignDate: null })),
          noteRefApi.searchTitles('', 'location'),
          noteRefApi.searchTitles('', 'settlement')
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

        const roster = await Promise.all(
          [...locationMatches, ...settlementMatches].map(async (m): Promise<ClimateRosterEntry | null> => {
            const placeFm = await noteRefApi.readFrontmatterByTitle(m.title)
            const climateTitle = placeFm ? placeClimateRefSchema.parse(placeFm).climateNoteTitle : null
            if (!climateTitle) return null
            const climateFm = await noteRefApi.readFrontmatterByTitle(climateTitle, 'climate')
            const parsed = climateFm ? climateFrontmatterSchema.safeParse(climateFm) : null
            return parsed?.success ? { placeTitle: m.title, climate: parsed.data } : null
          })
        )
        setClimateRoster(roster.filter((r): r is ClimateRosterEntry => r !== null))
      } catch (err) {
        console.error('Failed to load month-grid data:', err)
        setEvents((prev) => prev ?? [])
        setCalendars((prev) => prev ?? [])
        setClimateRoster((prev) => prev ?? [])
      }
    }
    void load()
    const off = window.cloudApi.onTreeUpdated(() => void load())
    return () => off()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const calendarByTitle = useMemo(() => new Map((calendars ?? []).map((c) => [c.title, c.frontmatter])), [calendars])
  const selectedCalendar = selectedCalendarTitle ? (calendarByTitle.get(selectedCalendarTitle) ?? null) : null

  useEffect(() => {
    if (initialized.current || !events || !calendars || !settings || calendars.length === 0) return
    initialized.current = true
    const initialTitle =
      (settings.campaignDate && calendarByTitle.has(settings.campaignDate.calendarNoteTitle) ? settings.campaignDate.calendarNoteTitle : null) ??
      settings.activeCalendarNoteTitles.find((t) => calendarByTitle.has(t)) ??
      calendars[0].title
    setSelectedCalendarTitle(initialTitle)
    const cal = calendarByTitle.get(initialTitle)!
    setMonthRef(resolveInitialMonthRef(cal, initialTitle, settings, events))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, calendars, settings])

  const changeCalendar = (title: string): void => {
    setSelectedCalendarTitle(title)
    setSelectedDay(null)
    const cal = calendarByTitle.get(title)
    if (cal && settings && events) setMonthRef(resolveInitialMonthRef(cal, title, settings, events))
  }

  const grid: MonthGrid | null = useMemo(
    () => (selectedCalendar && monthRef ? buildMonthGrid(selectedCalendar, monthRef) : null),
    [selectedCalendar, monthRef]
  )

  const dayBuckets = useMemo(() => {
    if (!grid || !selectedCalendar || !events) return new Map<number, CloudEventSummary[]>()
    const window = { start: grid.firstStartMinutes, end: grid.firstStartMinutes + grid.daysInMonth * grid.minutesPerDay }
    const items: { minutes: number; data: CloudEventSummary }[] = []
    for (const event of events) {
      if (event.noteType !== 'event' || !event.structuredDate) continue
      if (event.structuredDate.calendarNoteTitle !== selectedCalendarTitle) continue
      if (event.structuredDate.annualRecurrence) {
        for (const minutes of expandAnnualRecurrence(selectedCalendar, event.structuredDate, window)) {
          items.push({ minutes, data: event })
        }
        continue
      }
      const minutes = toCanonicalMinutes(selectedCalendar, event.structuredDate)
      if (minutes !== null) items.push({ minutes, data: event })
    }
    return bucketByDay(grid, items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, selectedCalendar, selectedCalendarTitle, events])

  const upcoming = useMemo(() => {
    if (!events || !settings?.campaignDate) return []
    const campaignCalendar = calendarByTitle.get(settings.campaignDate.calendarNoteTitle)
    if (!campaignCalendar) return []
    const campaignMinutes = toCanonicalMinutes(campaignCalendar, { ...settings.campaignDate, hour: 0, minute: 0 })
    if (campaignMinutes === null) return []

    const anchorItems: { event: CloudEventSummary; minutes: number }[] = []
    for (const event of events) {
      if (event.noteType !== 'event' || !event.structuredDate) continue
      const cal = calendarByTitle.get(event.structuredDate.calendarNoteTitle)
      if (!cal) continue
      const minutes = toCanonicalMinutes(cal, event.structuredDate)
      if (minutes !== null) anchorItems.push({ event, minutes })
    }
    const fullWindow = computeFullWindow(anchorItems.map((i) => i.minutes))

    const allItems: { event: CloudEventSummary; minutes: number }[] = []
    for (const item of anchorItems) {
      if (!item.event.structuredDate?.annualRecurrence) {
        allItems.push(item)
        continue
      }
      const cal = calendarByTitle.get(item.event.structuredDate.calendarNoteTitle)!
      for (const minutes of expandAnnualRecurrence(cal, item.event.structuredDate, fullWindow)) {
        allItems.push({ event: item.event, minutes })
      }
    }

    return allItems
      .filter((i) => i.minutes >= campaignMinutes)
      .sort((a, b) => a.minutes - b.minutes)
      .slice(0, UPCOMING_COUNT)
  }, [events, settings, calendarByTitle])

  const activeCalendars = (settings?.activeCalendarNoteTitles ?? [])
    .map((title) => calendarByTitle.get(title))
    .filter((c): c is CalendarFrontmatter => c !== undefined)

  const formatDate = (minutes: number): string => {
    const cals = activeCalendars.length > 0 ? activeCalendars : selectedCalendar ? [selectedCalendar] : []
    const labels = cals
      .map((cal) => {
        const parts = fromCanonicalMinutes(cal, minutes)
        return parts ? formatCalendarDate(cal, parts) : null
      })
      .filter((l): l is string => l !== null)
    return labels.join(' / ')
  }

  const setAsCampaignDate = (day: number): void => {
    if (!selectedCalendarTitle || !monthRef) return
    void window.cloudApi
      .updateWorkspaceSettings({
        campaignDate: { calendarNoteTitle: selectedCalendarTitle, eraId: monthRef.eraId, year: monthRef.year, monthId: monthRef.monthId, day }
      })
      .then(setSettings)
  }

  const jumpToToday = (): void => {
    if (!selectedCalendar || !settings?.campaignDate || settings.campaignDate.calendarNoteTitle !== selectedCalendarTitle) return
    setMonthRef({ eraId: settings.campaignDate.eraId, year: settings.campaignDate.year, monthId: settings.campaignDate.monthId })
    setSelectedDay(settings.campaignDate.day)
  }

  if (events === null || calendars === null) {
    return <div className="timeline-view timeline-empty">Loading…</div>
  }

  if (calendars.length === 0) {
    return (
      <div className="timeline-view timeline-empty">
        No calendar notes yet — create one (or check its frontmatter) to use the Calendar view.
      </div>
    )
  }

  if (!selectedCalendar || !monthRef || !grid) {
    return <div className="timeline-view timeline-empty">Loading…</div>
  }

  const monthName = selectedCalendar.months.find((m) => m.id === monthRef.monthId)?.name ?? monthRef.monthId
  const era = selectedCalendar.eras.find((e) => e.id === monthRef.eraId)
  const eraLabel = era ? era.abbreviation || era.name : ''
  const isCampaignMonth =
    settings?.campaignDate?.calendarNoteTitle === selectedCalendarTitle &&
    settings.campaignDate.eraId === monthRef.eraId &&
    settings.campaignDate.year === monthRef.year &&
    settings.campaignDate.monthId === monthRef.monthId
  const selectedCell = selectedDay !== null ? grid.weeks.flat().find((c) => c?.day === selectedDay) : null
  const matchingClimates = (climateRoster ?? []).filter((r) => r.climate.calendarNoteTitle === selectedCalendarTitle)

  return (
    <div className="timeline-view month-grid-view">
      <h2>Calendar</h2>

      <div className="pill-timeline-toolbar">
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Calendar
          <select value={selectedCalendarTitle ?? ''} onChange={(e) => changeCalendar(e.target.value)}>
            {calendars.map((c) => (
              <option key={c.title} value={c.title}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setMonthRef((r) => (r ? stepMonth(selectedCalendar, r, -1) : r))}>◀</button>
        <button onClick={() => setMonthRef((r) => (r ? stepMonth(selectedCalendar, r, 1) : r))}>▶</button>
        {settings?.campaignDate?.calendarNoteTitle === selectedCalendarTitle && (
          <button onClick={jumpToToday} disabled={isCampaignMonth}>
            Today
          </button>
        )}
      </div>

      <h3 style={{ margin: '8px 0' }}>
        {monthName} {monthRef.year} {eraLabel}
      </h3>

      <div className="month-grid">
        {selectedCalendar.weekDays.map((wd) => (
          <div key={wd} className="month-grid-weekday">
            {wd}
          </div>
        ))}
        {grid.weeks.flat().map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} className="month-grid-cell month-grid-cell-empty" />
          const dayEvents = dayBuckets.get(cell.day) ?? []
          const isToday = isCampaignMonth && settings?.campaignDate?.day === cell.day
          return (
            <button
              key={cell.day}
              type="button"
              className={`month-grid-cell${isToday ? ' month-grid-cell-today' : ''}${selectedDay === cell.day ? ' active' : ''}`}
              onClick={() => setSelectedDay(cell.day)}
            >
              <div className="month-grid-cell-header">
                <span>{cell.day}</span>
                {selectedCalendar.moons.length > 0 && (
                  <span title={selectedCalendar.moons.map((m) => `${m.name}: ${computeMoonPhase(selectedCalendar, m, cell.startMinutes).name}`).join(', ')}>
                    {selectedCalendar.moons.map((m) => computeMoonPhase(selectedCalendar, m, cell.startMinutes).emoji).join('')}
                  </span>
                )}
              </div>
              {dayEvents.slice(0, MAX_EVENT_CHIPS_PER_DAY).map((e, ei) => (
                <div key={`${e.id}-${ei}`} className="month-grid-event-chip">
                  {e.structuredDate?.annualRecurrence && '↻ '}
                  {e.name}
                </div>
              ))}
              {dayEvents.length > MAX_EVENT_CHIPS_PER_DAY && (
                <div className="month-grid-event-chip month-grid-event-overflow">+{dayEvents.length - MAX_EVENT_CHIPS_PER_DAY} more</div>
              )}
            </button>
          )
        })}
      </div>

      {selectedCell && (
        <div className="month-grid-day-detail">
          <strong>{formatDate(selectedCell.startMinutes)}</strong>
          {selectedCalendar.moons.length > 0 && (
            <p className="right-panel-note">
              {selectedCalendar.moons
                .map((m) => {
                  const phase = computeMoonPhase(selectedCalendar, m, selectedCell.startMinutes)
                  return `${phase.emoji} ${m.name}: ${phase.name}`
                })
                .join(' · ')}
            </p>
          )}
          {matchingClimates.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>Weather</summary>
              <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
                {matchingClimates.map((entry) => {
                  const weather = computeWeatherForDate(entry.climate, selectedCalendar, selectedCell.startMinutes)
                  return (
                    <li key={entry.placeTitle}>
                      {entry.placeTitle}: {weather ? `${weather.condition.name} (${weather.seasonName})` : 'No weather defined for this month'}
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
          {(dayBuckets.get(selectedCell.day) ?? []).length > 0 && (
            <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
              {(dayBuckets.get(selectedCell.day) ?? []).map((e, i) => (
                <li key={`${e.id}-${i}`}>
                  <button className="link-button" onClick={() => onOpenEvent(e.id)}>
                    {e.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="sheet-open-ref-button" onClick={() => setAsCampaignDate(selectedCell.day)}>
            Set as campaign date
          </button>
        </div>
      )}

      {settings?.campaignDate && (
        <div style={{ marginTop: 12 }}>
          <strong>Upcoming</strong>
          {upcoming.length === 0 ? (
            <p className="right-panel-note">Nothing recorded after the campaign date yet.</p>
          ) : (
            <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
              {upcoming.map((item, i) => (
                <li key={`${item.event.id}-${i}`}>
                  <button className="link-button" onClick={() => onOpenEvent(item.event.id)}>
                    {item.event.structuredDate?.annualRecurrence && '↻ '}
                    {item.event.name}
                  </button>{' '}
                  — {formatDate(item.minutes)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
