import type { CalendarFrontmatter } from '../../../../common/noteTypes/calendar'
import { arrayMove } from '../../../../common/arrayMove'

// Order matters here (day-of-year math walks this list in sequence, same as
// worldDate.ts's findMonth), so — unlike most list editors elsewhere in this
// codebase — every row gets up/down move buttons, not just add/remove.
export function CalendarMonthsTab({
  data,
  updateFrontmatter
}: {
  data: CalendarFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const totalDays = data.months.reduce((sum, m) => sum + m.days, 0)

  return (
    <div>
      <p className="right-panel-note">
        Total: {totalDays} day{totalDays === 1 ? '' : 's'}/year, across {data.months.length} month
        {data.months.length === 1 ? '' : 's'}. Order matters — it determines day-of-year numbering.
      </p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Name</th>
            <th>Days</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.months.map((m, i) => (
            <tr key={m.id}>
              <td>
                <input
                  style={{ minWidth: 120 }}
                  value={m.name}
                  onChange={(e) => updateFrontmatter({ months: data.months.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  style={{ width: 60 }}
                  value={m.days}
                  onChange={(e) => updateFrontmatter({ months: data.months.map((x) => (x.id === m.id ? { ...x, days: Number(e.target.value) } : x)) })}
                />
              </td>
              <td>
                <button disabled={i === 0} onClick={() => updateFrontmatter({ months: arrayMove(data.months, i, 'up') })}>
                  ↑
                </button>
                <button disabled={i === data.months.length - 1} onClick={() => updateFrontmatter({ months: arrayMove(data.months, i, 'down') })}>
                  ↓
                </button>
                <button onClick={() => updateFrontmatter({ months: data.months.filter((x) => x.id !== m.id) })}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        style={{ marginTop: 6 }}
        onClick={() =>
          updateFrontmatter({ months: [...data.months, { id: crypto.randomUUID(), name: 'New Month', days: 30 }] })
        }
      >
        + Add month
      </button>
    </div>
  )
}
