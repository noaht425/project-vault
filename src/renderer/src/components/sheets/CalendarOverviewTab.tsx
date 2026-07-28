import type { CalendarFrontmatter } from '../../../../common/noteTypes/calendar'

export function CalendarOverviewTab({
  data,
  updateFrontmatter
}: {
  data: CalendarFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const totalYearDays = data.months.reduce((sum, m) => sum + m.days, 0)

  return (
    <div>
      <div className="sheet-row">
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>
      <p className="right-panel-note">
        {data.months.length} month{data.months.length === 1 ? '' : 's'} ({totalYearDays} days/year),{' '}
        {data.weekDays.length}-day week, {data.eras.length} era{data.eras.length === 1 ? '' : 's'},{' '}
        {data.moons.length} moon{data.moons.length === 1 ? '' : 's'}
        {data.leapYearRule && ' — has a leap-year rule'}. Edit the details in the other tabs.
      </p>
    </div>
  )
}
