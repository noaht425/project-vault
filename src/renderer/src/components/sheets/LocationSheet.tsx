import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { locationFrontmatterSchema, LOCATION_KINDS } from '../../../../common/noteTypes/location'

export function LocationSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = locationFrontmatterSchema.parse(frontmatter)

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field sheet-field-date">
          Type
          <select value={data.locationType} onChange={(e) => updateFrontmatter({ locationType: e.target.value })}>
            {LOCATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind[0].toUpperCase() + kind.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>
    </div>
  )
}
