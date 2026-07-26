import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { familyTreeFrontmatterSchema } from '../../../../common/noteTypes/familyTree'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { FamilyTreeDiagram } from './FamilyTreeDiagram'

export function FamilyTreeSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = familyTreeFrontmatterSchema.parse(frontmatter)

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
        Add a "## Relationships" heading in the body below, then list people with [[wiki-links]] —
        one per line: "- [[A]] parent of [[B]]", "- [[A]] child of [[B]]", "- [[A]] spouse of [[B]]",
        or "- [[A]] sibling of [[B]]".
      </p>
      <FamilyTreeDiagram body={body} onOpenWikiLink={(title) => noteRefApi.openByTitle(title)} />
    </div>
  )
}
