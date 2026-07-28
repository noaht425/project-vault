import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { calendarFrontmatterSchema } from '../../../../common/noteTypes/calendar'

// Placeholder only — build step 2 (see
// docs/plans/2026-07-28-calendar-timeline-system.md) replaces this with the
// real Overview/Months/Week/Days/Years-Eras/Moons tabbed editor. This just
// keeps a calendar note from rendering blank in the meantime, same "summary
// field + explanatory note" shape as a brand-new note type's first pass.
export function CalendarSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = calendarFrontmatterSchema.parse(frontmatter)

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>
      <p className="right-panel-note">
        {data.months.length} months, {data.weekDays.length}-day week, {data.eras.length} era
        {data.eras.length === 1 ? '' : 's'}, {data.moons.length} moon{data.moons.length === 1 ? '' : 's'} defined.
        The full calendar editor (Months/Week/Days/Years-Eras/Moons tabs) is coming in a later build step —
        this note's structured data is already saved and ready for that editor.
      </p>
    </div>
  )
}
