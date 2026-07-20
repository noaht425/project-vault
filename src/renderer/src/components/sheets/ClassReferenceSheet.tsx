import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { classReferenceFrontmatterSchema } from '../../../../common/noteTypes/classReference'

export function ClassReferenceSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = classReferenceFrontmatterSchema.parse(frontmatter)

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field">
          Class
          <input value={data.class} onChange={(e) => updateFrontmatter({ class: e.target.value })} />
        </label>
        <label className="sheet-field">
          Subclass
          <input value={data.subclass} onChange={(e) => updateFrontmatter({ subclass: e.target.value })} />
        </label>
      </div>
      <p className="right-panel-note">
        Add a "## Level N" heading in the body below for each level, and put that level's features
        underneath it. Any PC whose Class Reference field matches this note's title exactly (not case
        sensitive) will show those levels, filtered down to their own current level.
      </p>
    </div>
  )
}
