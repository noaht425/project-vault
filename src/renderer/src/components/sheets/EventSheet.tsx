import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { eventFrontmatterSchema } from '../../../../common/noteTypes/event'

export function EventSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = eventFrontmatterSchema.parse(frontmatter)

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field sheet-field-date">
          Date
          {/* Free text, not a native date picker — this is an in-world/
              fictional date, not a real calendar date. */}
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
      <p className="right-panel-note">
        Link factions, locations, and characters with [[wiki-links]] in the body below — they'll
        show up on those notes' Backlinks panel automatically.
      </p>
    </div>
  )
}
