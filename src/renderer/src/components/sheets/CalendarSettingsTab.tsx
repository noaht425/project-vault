import type { CalendarFrontmatter } from '../../../../common/noteTypes/calendar'

export function CalendarSettingsTab({
  data,
  updateFrontmatter
}: {
  data: CalendarFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  return (
    <div>
      <label className="sheet-field" style={{ maxWidth: 260 }}>
        Default era
        <select
          value={data.defaultEraId ?? ''}
          onChange={(e) => updateFrontmatter({ defaultEraId: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">(none)</option>
          {data.eras.map((era) => (
            <option key={era.id} value={era.id}>
              {era.name} {era.abbreviation && `(${era.abbreviation})`}
            </option>
          ))}
        </select>
      </label>
      <p className="right-panel-note">
        Which era a bare year with no written suffix is assumed to belong to — e.g. a date written just "150" is
        read as 150 of this era. Only matters once this calendar has 2+ eras.
      </p>
    </div>
  )
}
