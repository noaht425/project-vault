import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { languageFrontmatterSchema } from '../../../../common/noteTypes/language'
import { WordDictionaryPanel } from './WordDictionaryPanel'

export function LanguageSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = languageFrontmatterSchema.parse(frontmatter)

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
        Add a "## Word: word" heading in the body below for each dictionary entry — meaning, part
        of speech, notes, whatever you want underneath it. Mention another language with a
        [[wiki-link]] (e.g. "Evolved from [[Draconic]]") to link them — it'll show up on that
        language's Backlinks panel automatically.
      </p>
      <WordDictionaryPanel body={body} />
    </div>
  )
}
