import { useMemo } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { itemFrontmatterSchema } from '../../../../common/noteTypes/item'

export function ItemSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = useMemo(() => parseNote(content), [content])
  const data = useMemo(() => itemFrontmatterSchema.parse(frontmatter), [frontmatter])

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
    </div>
  )
}
