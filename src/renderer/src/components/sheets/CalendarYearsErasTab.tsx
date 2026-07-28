import type { CalendarFrontmatter } from '../../../../common/noteTypes/calendar'

export function CalendarYearsErasTab({
  data,
  updateFrontmatter
}: {
  data: CalendarFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const updateEra = (id: string, patch: Record<string, unknown>): void =>
    updateFrontmatter({ eras: data.eras.map((e) => (e.id === id ? { ...e, ...patch } : e)) })

  return (
    <div>
      <div>
        <strong>Eras</strong>
        <p className="right-panel-note">
          A named span of years, counting up (like CE) or down (like BCE). Most settings need at least one
          "counts up" era; add a second "counts down" one only if the calendar has a before/after split like the
          user's own Age of the Many / Age of the Few.
        </p>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Name</th>
              <th>Abbreviation</th>
              <th>Direction</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.eras.map((era) => (
              <tr key={era.id}>
                <td>
                  <input style={{ minWidth: 140 }} value={era.name} onChange={(e) => updateEra(era.id, { name: e.target.value })} />
                </td>
                <td>
                  <input style={{ width: 70 }} value={era.abbreviation} onChange={(e) => updateEra(era.id, { abbreviation: e.target.value })} />
                </td>
                <td>
                  <select value={era.direction} onChange={(e) => updateEra(era.id, { direction: e.target.value })}>
                    <option value="up">Counts up</option>
                    <option value="down">Counts down</option>
                  </select>
                </td>
                <td>
                  <button onClick={() => updateFrontmatter({ eras: data.eras.filter((e) => e.id !== era.id) })}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          style={{ marginTop: 6 }}
          onClick={() =>
            updateFrontmatter({
              eras: [...data.eras, { id: crypto.randomUUID(), name: 'New Era', abbreviation: '', direction: 'up' }]
            })
          }
        >
          + Add era
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Leap years</strong>
        <p className="right-panel-note">
          Optional. Adds extra day(s) to a chosen month (or as standalone day(s) belonging to no month) on a
          recurring year interval, with up to two levels of exception — the same shape as the real Gregorian rule
          (every 4 years, except every 100, except every 400).
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={data.leapYearRule !== null}
            onChange={(e) =>
              updateFrontmatter({
                leapYearRule: e.target.checked
                  ? { intervalYears: 4, exceptionEveryYears: null, exceptionToExceptionEveryYears: null, extraDays: 1, monthId: null }
                  : null
              })
            }
          />
          This calendar has leap years
        </label>
        {data.leapYearRule && (
          <div className="sheet-row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <label className="sheet-field" style={{ maxWidth: 150 }}>
              Every N years
              <input
                type="number"
                value={data.leapYearRule.intervalYears}
                onChange={(e) => updateFrontmatter({ leapYearRule: { ...data.leapYearRule, intervalYears: Number(e.target.value) } })}
              />
            </label>
            <label className="sheet-field" style={{ maxWidth: 170 }}>
              Except every N years
              <input
                type="number"
                placeholder="none"
                value={data.leapYearRule.exceptionEveryYears ?? ''}
                onChange={(e) =>
                  updateFrontmatter({
                    leapYearRule: { ...data.leapYearRule, exceptionEveryYears: e.target.value === '' ? null : Number(e.target.value) }
                  })
                }
              />
            </label>
            <label className="sheet-field" style={{ maxWidth: 190 }}>
              Except THAT every N years
              <input
                type="number"
                placeholder="none"
                disabled={data.leapYearRule.exceptionEveryYears === null}
                value={data.leapYearRule.exceptionToExceptionEveryYears ?? ''}
                onChange={(e) =>
                  updateFrontmatter({
                    leapYearRule: {
                      ...data.leapYearRule,
                      exceptionToExceptionEveryYears: e.target.value === '' ? null : Number(e.target.value)
                    }
                  })
                }
              />
            </label>
            <label className="sheet-field" style={{ maxWidth: 130 }}>
              Extra days
              <input
                type="number"
                value={data.leapYearRule.extraDays}
                onChange={(e) => updateFrontmatter({ leapYearRule: { ...data.leapYearRule, extraDays: Number(e.target.value) } })}
              />
            </label>
            <label className="sheet-field" style={{ maxWidth: 180 }}>
              Added to month
              <select
                value={data.leapYearRule.monthId ?? ''}
                onChange={(e) => updateFrontmatter({ leapYearRule: { ...data.leapYearRule, monthId: e.target.value === '' ? null : e.target.value } })}
              >
                <option value="">(standalone day, no month)</option>
                {data.months.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
