import { useMemo } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { sessionFrontmatterSchema } from '../../../../common/noteTypes/session'

export function SessionSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = useMemo(() => parseNote(content), [content])
  const data = useMemo(() => sessionFrontmatterSchema.parse(frontmatter), [frontmatter])

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field sheet-field-date">
          Date
          <input type="date" value={data.date} onChange={(e) => updateFrontmatter({ date: e.target.value })} />
        </label>
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>
      <p className="right-panel-note">
        Link NPCs and locations with [[wiki-links]] in the body below — they'll show up on those
        notes' Backlinks panel automatically.
      </p>
    </div>
  )
}
