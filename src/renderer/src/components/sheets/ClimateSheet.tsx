import { useEffect, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { climateFrontmatterSchema, type ClimateSeason } from '../../../../common/noteTypes/climate'
import { calendarFrontmatterSchema, type CalendarFrontmatter } from '../../../../common/noteTypes/calendar'
import type { NoteRefApi } from '../../lib/noteRefApi'

// Mirrors SettlementSetupTab.tsx's shape throughout: districts' building-type
// boost checkboxes -> a season's month-membership checkboxes; the religion-
// distribution name+percent rows -> a season's condition name+weight rows.
export function ClimateSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = climateFrontmatterSchema.parse(frontmatter)
  const [calendarOptions, setCalendarOptions] = useState<string[]>([])
  // The referenced calendar's own month list — same cross-note frontmatter
  // fetch EventSheet.tsx already uses for its own Calendar field.
  const [calendarDef, setCalendarDef] = useState<CalendarFrontmatter | null>(null)

  useEffect(() => {
    void noteRefApi.searchTitles('', 'calendar').then((matches) => setCalendarOptions(matches.map((m) => m.title)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!data.calendarNoteTitle) {
      setCalendarDef(null)
      return
    }
    void noteRefApi.readFrontmatterByTitle(data.calendarNoteTitle, 'calendar').then((fm) => {
      setCalendarDef(fm ? calendarFrontmatterSchema.parse(fm) : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.calendarNoteTitle])

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const updateSeason = (id: string, patch: Partial<ClimateSeason>): void =>
    updateFrontmatter({ seasons: data.seasons.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="sheet-field" style={{ maxWidth: 220 }}>
          Calendar
          <input
            list="climate-calendar-options"
            value={data.calendarNoteTitle}
            onChange={(e) => updateFrontmatter({ calendarNoteTitle: e.target.value })}
            placeholder="e.g. Age of the Many"
          />
          <datalist id="climate-calendar-options">
            {calendarOptions.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>
        </label>
        <p className="right-panel-note">
          Seasons below match this calendar's own months — pick a calendar first, since a season is a set of that
          calendar's months, not a generic date range.
        </p>
        {data.calendarNoteTitle && !calendarDef && (
          <p className="right-panel-note">No calendar note titled "{data.calendarNoteTitle}" found yet.</p>
        )}
      </div>

      {calendarDef && (
        <div style={{ marginTop: 12 }}>
          <strong>Seasons</strong>
          {data.seasons.map((season) => (
            <div key={season.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input style={{ flex: 1 }} value={season.name} onChange={(e) => updateSeason(season.id, { name: e.target.value })} />
                <button onClick={() => updateFrontmatter({ seasons: data.seasons.filter((s) => s.id !== season.id) })}>✕</button>
              </div>

              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 12, cursor: 'pointer' }}>Months ({season.monthIds.length})</summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, paddingLeft: 8 }}>
                  {calendarDef.months.map((month) => (
                    <label key={month.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={season.monthIds.includes(month.id)}
                        onChange={(e) =>
                          updateSeason(season.id, {
                            monthIds: e.target.checked
                              ? [...season.monthIds, month.id]
                              : season.monthIds.filter((id) => id !== month.id)
                          })
                        }
                      />
                      {month.name}
                    </label>
                  ))}
                </div>
              </details>

              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Conditions — relative weight, higher rolls more often (nothing is ever impossible above weight 0)
                </span>
                {season.conditions.map((cond, i) => (
                  <div key={cond.id} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    <input
                      style={{ flex: 1 }}
                      value={cond.name}
                      onChange={(e) =>
                        updateSeason(season.id, {
                          conditions: season.conditions.map((c, ci) => (ci === i ? { ...c, name: e.target.value } : c))
                        })
                      }
                    />
                    <input
                      type="number"
                      style={{ width: 60 }}
                      value={cond.weight}
                      onChange={(e) =>
                        updateSeason(season.id, {
                          conditions: season.conditions.map((c, ci) => (ci === i ? { ...c, weight: Number(e.target.value) } : c))
                        })
                      }
                    />
                    <button onClick={() => updateSeason(season.id, { conditions: season.conditions.filter((_, ci) => ci !== i) })}>
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  style={{ marginTop: 4 }}
                  onClick={() =>
                    updateSeason(season.id, {
                      conditions: [...season.conditions, { id: crypto.randomUUID(), name: 'New condition', weight: 1 }]
                    })
                  }
                >
                  + Add condition
                </button>
              </div>
            </div>
          ))}
          <button
            style={{ marginTop: 8 }}
            onClick={() =>
              updateFrontmatter({ seasons: [...data.seasons, { id: crypto.randomUUID(), name: 'New Season', monthIds: [], conditions: [] }] })
            }
          >
            + Add season
          </button>
        </div>
      )}
    </div>
  )
}
