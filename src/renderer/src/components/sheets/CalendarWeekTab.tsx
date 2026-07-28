import type { CalendarFrontmatter } from '../../../../common/noteTypes/calendar'
import { arrayMove } from '../../../../common/arrayMove'

export function CalendarWeekTab({
  data,
  updateFrontmatter
}: {
  data: CalendarFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const updateDay = (i: number, name: string): void =>
    updateFrontmatter({ weekDays: data.weekDays.map((d, di) => (di === i ? name : d)) })

  return (
    <div>
      <p className="right-panel-note">
        {data.weekDays.length}-day week. Order is the day-of-week cycle — day 1 of the calendar's epoch falls on
        whichever day is listed first.
      </p>
      {data.weekDays.map((day, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <span style={{ width: 20, fontSize: 12, color: 'var(--text-muted)' }}>{i + 1}</span>
          <input style={{ flex: 1 }} value={day} onChange={(e) => updateDay(i, e.target.value)} />
          <button disabled={i === 0} onClick={() => updateFrontmatter({ weekDays: arrayMove(data.weekDays, i, 'up') })}>
            ↑
          </button>
          <button
            disabled={i === data.weekDays.length - 1}
            onClick={() => updateFrontmatter({ weekDays: arrayMove(data.weekDays, i, 'down') })}
          >
            ↓
          </button>
          <button onClick={() => updateFrontmatter({ weekDays: data.weekDays.filter((_, di) => di !== i) })}>✕</button>
        </div>
      ))}
      <button style={{ marginTop: 6 }} onClick={() => updateFrontmatter({ weekDays: [...data.weekDays, `Day ${data.weekDays.length + 1}`] })}>
        + Add day
      </button>
    </div>
  )
}
