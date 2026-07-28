import type { CalendarFrontmatter } from '../../../../common/noteTypes/calendar'

export function CalendarDaysTab({
  data,
  updateFrontmatter
}: {
  data: CalendarFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  return (
    <div>
      <p className="right-panel-note">
        Sub-day precision — not required for anything in the vault yet, but future events/timeline entries can use
        it once set.
      </p>
      <div className="sheet-row">
        <label className="sheet-field" style={{ maxWidth: 160 }}>
          Hours per day
          <input
            type="number"
            value={data.hoursPerDay}
            onChange={(e) => updateFrontmatter({ hoursPerDay: Number(e.target.value) })}
          />
        </label>
        <label className="sheet-field" style={{ maxWidth: 160 }}>
          Minutes per hour
          <input
            type="number"
            value={data.minutesPerHour}
            onChange={(e) => updateFrontmatter({ minutesPerHour: Number(e.target.value) })}
          />
        </label>
      </div>
    </div>
  )
}
