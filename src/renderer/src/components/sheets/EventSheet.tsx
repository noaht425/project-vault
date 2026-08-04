import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { eventFrontmatterSchema, type EventStructuredDate } from '../../../../common/noteTypes/event'
import { calendarFrontmatterSchema, type CalendarFrontmatter } from '../../../../common/noteTypes/calendar'
import { climateFrontmatterSchema, type ClimateFrontmatter } from '../../../../common/noteTypes/climate'
import { computeMoonPhase, toCanonicalMinutes } from '../../../../common/calendarMath'
import { computeWeatherForDate } from '../../../../common/weatherGeneration'
import type { NoteRefApi } from '../../lib/noteRefApi'

// A minimal shape for reading just `climateNoteTitle` off whatever note
// `data.location` points at — it could be a `location` or `settlement` note
// (either can carry a climate reference), and this sheet doesn't otherwise
// need either one's full schema, just this one field.
const placeClimateRefSchema = z.object({ climateNoteTitle: z.string().nullable().catch(null) }).passthrough()

export function EventSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = useMemo(() => parseNote(content), [content])
  const data = useMemo(() => eventFrontmatterSchema.parse(frontmatter), [frontmatter])
  const [locationOptions, setLocationOptions] = useState<string[]>([])
  const [calendarOptions, setCalendarOptions] = useState<string[]>([])
  // The referenced calendar note's OWN structured definition (eras/months/
  // etc), fetched separately since noteRefApi only returns a title/body by
  // default — this sheet needs the frontmatter to populate the era/month
  // dropdowns. Refetched whenever structuredDate.calendarNoteTitle changes.
  const [calendarDef, setCalendarDef] = useState<CalendarFrontmatter | null>(null)
  // Two-hop lookup — data.location (a location or settlement note's title)
  // -> that note's own optional climateNoteTitle -> the actual climate
  // note's frontmatter. Same cross-note lookup mechanism as calendarDef
  // above, just chained once since a climate isn't referenced directly by
  // the event, only indirectly through wherever it happens.
  const [climateDef, setClimateDef] = useState<ClimateFrontmatter | null>(null)

  useEffect(() => {
    void noteRefApi.searchTitles('', 'location').then((matches) => setLocationOptions(matches.map((m) => m.title)))
    void noteRefApi.searchTitles('', 'calendar').then((matches) => setCalendarOptions(matches.map((m) => m.title)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const title = data.structuredDate?.calendarNoteTitle
    if (!title) {
      setCalendarDef(null)
      return
    }
    void noteRefApi.readFrontmatterByTitle(title, 'calendar').then((fm) => {
      setCalendarDef(fm ? calendarFrontmatterSchema.parse(fm) : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.structuredDate?.calendarNoteTitle])

  useEffect(() => {
    const locationTitle = data.location?.trim()
    if (!locationTitle) {
      setClimateDef(null)
      return
    }
    let cancelled = false
    // No type filter — the location field can point at either a `location`
    // or `settlement` note, either of which can carry climateNoteTitle.
    void noteRefApi.readFrontmatterByTitle(locationTitle).then(async (placeFm) => {
      if (cancelled) return
      const climateTitle = placeFm ? placeClimateRefSchema.parse(placeFm).climateNoteTitle : null
      if (!climateTitle) {
        setClimateDef(null)
        return
      }
      const climateFm = await noteRefApi.readFrontmatterByTitle(climateTitle, 'climate')
      if (!cancelled) setClimateDef(climateFm ? climateFrontmatterSchema.parse(climateFm) : null)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.location])

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const updateStructuredDate = (patch: Partial<EventStructuredDate>): void =>
    updateFrontmatter({ structuredDate: { ...data.structuredDate, ...patch } })

  const openLocation = async (): Promise<void> => {
    if (!data.location?.trim()) return
    await noteRefApi.openByTitle(data.location.trim(), 'location')
  }

  // Shared by both the moon-phase and weather displays below — computed
  // once here rather than duplicating the calendarDef/structuredDate
  // null-check in two separate inline blocks.
  const structuredMinutes = calendarDef && data.structuredDate ? toCanonicalMinutes(calendarDef, data.structuredDate) : null
  const weather = climateDef && calendarDef && structuredMinutes !== null ? computeWeatherForDate(climateDef, calendarDef, structuredMinutes) : null

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field sheet-field-date">
          Date
          {/* Free text, not a native date picker — this is an in-world/
              fictional date, not a real calendar date. Kept as the source
              of truth even once a structured date (below) is also set. */}
          <input
            value={data.date}
            onChange={(e) => updateFrontmatter({ date: e.target.value })}
            placeholder="e.g. Year 12 of the Third Age"
          />
        </label>
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>

      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={data.structuredDate !== null}
            onChange={(e) =>
              updateFrontmatter({
                structuredDate: e.target.checked
                  ? {
                      calendarNoteTitle: calendarOptions[0] ?? '',
                      eraId: '',
                      year: 1,
                      monthId: '',
                      day: 1,
                      hour: 0,
                      minute: 0,
                      annualRecurrence: false
                    }
                  : null
              })
            }
          />
          Also set a structured date (for the calendar/timeline system)
        </label>
        {data.structuredDate && (
          <div className="sheet-row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <label className="sheet-field" style={{ maxWidth: 200 }}>
              Calendar
              <input
                list="event-calendar-options"
                value={data.structuredDate.calendarNoteTitle}
                onChange={(e) => updateStructuredDate({ calendarNoteTitle: e.target.value, eraId: '', monthId: '' })}
                placeholder="e.g. Age of the Many"
              />
              <datalist id="event-calendar-options">
                {calendarOptions.map((title) => (
                  <option key={title} value={title} />
                ))}
              </datalist>
            </label>
            {calendarDef ? (
              <>
                <label className="sheet-field" style={{ maxWidth: 150 }}>
                  Era
                  <select value={data.structuredDate.eraId} onChange={(e) => updateStructuredDate({ eraId: e.target.value })}>
                    <option value="">(choose)</option>
                    {calendarDef.eras.map((era) => (
                      <option key={era.id} value={era.id}>
                        {era.name} {era.abbreviation && `(${era.abbreviation})`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sheet-field" style={{ maxWidth: 100 }}>
                  Year
                  <input
                    type="number"
                    value={data.structuredDate.year}
                    onChange={(e) => updateStructuredDate({ year: Number(e.target.value) })}
                  />
                </label>
                <label className="sheet-field" style={{ maxWidth: 150 }}>
                  Month
                  <select value={data.structuredDate.monthId} onChange={(e) => updateStructuredDate({ monthId: e.target.value })}>
                    <option value="">(choose)</option>
                    {calendarDef.months.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sheet-field" style={{ maxWidth: 80 }}>
                  Day
                  <input type="number" value={data.structuredDate.day} onChange={(e) => updateStructuredDate({ day: Number(e.target.value) })} />
                </label>
                <label className="sheet-field" style={{ maxWidth: 80 }}>
                  Hour
                  <input type="number" value={data.structuredDate.hour} onChange={(e) => updateStructuredDate({ hour: Number(e.target.value) })} />
                </label>
                <label className="sheet-field" style={{ maxWidth: 80 }}>
                  Minute
                  <input
                    type="number"
                    value={data.structuredDate.minute}
                    onChange={(e) => updateStructuredDate({ minute: Number(e.target.value) })}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexBasis: '100%', marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={data.structuredDate.annualRecurrence}
                    onChange={(e) => updateStructuredDate({ annualRecurrence: e.target.checked })}
                  />
                  Recurs annually (e.g. "Winter Solstice, every year")
                </label>
                {data.structuredDate.annualRecurrence && (
                  <p className="right-panel-note" style={{ flexBasis: '100%' }}>
                    Shows once per year, in the same era/month/day/time, across whatever date range your other
                    events already span on the pill Timeline — no separate end date needed.
                  </p>
                )}
                {calendarDef.moons.length > 0 && structuredMinutes !== null && (
                  <p className="right-panel-note" style={{ flexBasis: '100%' }}>
                    {calendarDef.moons
                      .map((moon) => {
                        const phase = computeMoonPhase(calendarDef, moon, structuredMinutes)
                        return `${phase.emoji} ${moon.name}: ${phase.name}`
                      })
                      .join(' · ')}
                  </p>
                )}
                {weather && (
                  <p className="right-panel-note" style={{ flexBasis: '100%' }}>
                    Weather ({weather.seasonName}): {weather.condition.name}
                  </p>
                )}
              </>
            ) : (
              data.structuredDate.calendarNoteTitle && (
                <p className="right-panel-note">No calendar note titled "{data.structuredDate.calendarNoteTitle}" found yet.</p>
              )
            )}
          </div>
        )}
      </div>

      <div className="sheet-row" style={{ marginTop: 8 }}>
        <label className="sheet-field">
          Location
          {/* Optional — a location note's title, matching a Map note's pins.
              Set this to place the event on that map's Timeline (see
              MapSheet's Timeline section). Also drives the generated
              Weather line above (once both this and a structured date are
              set) if the referenced location/settlement has a climate.
              Most events won't need it. */}
          <input
            list="event-location-options"
            value={data.location ?? ''}
            onChange={(e) => updateFrontmatter({ location: e.target.value || null })}
            placeholder="e.g. Townsville"
          />
          <datalist id="event-location-options">
            {locationOptions.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className="sheet-open-ref-button"
          onClick={() => void openLocation()}
          disabled={!data.location?.trim()}
        >
          Open ↗
        </button>
      </div>
      <p className="right-panel-note">
        Link factions, locations, and characters with [[wiki-links]] in the body below — they'll
        show up on those notes' Backlinks panel automatically.
      </p>
    </div>
  )
}
