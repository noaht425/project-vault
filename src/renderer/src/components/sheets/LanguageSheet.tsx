import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { languageFrontmatterSchema } from '../../../../common/noteTypes/language'
import { WordDictionaryPanel } from './WordDictionaryPanel'
import { GrammarRulesPanel } from './GrammarRulesPanel'

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
        Add a "## Word: word" heading in the body below for each dictionary entry. Optional
        "Meaning: ...", "POS: ...", and "Gender: ..." lines underneath give it a structured English
        gloss, part of speech, and grammatical gender (useful if you want a sentence translated
        later) — anything else you write underneath is shown as freeform notes. Mention another
        language with a [[wiki-link]] (e.g. "Evolved from [[Draconic]]") to link them — it'll show
        up on that language's Backlinks panel automatically.
      </p>
      <p className="right-panel-note">
        Add a "## Grammar: name" heading (e.g. "## Grammar: Word Order") for each named rule —
        sentence structure, tense/case marking, pluralization, whatever governs how words combine.
        Plain "## Grammar Notes" style headings (no colon) still work as ordinary prose sections.
        Markdown tables work anywhere in the body (e.g. a verb's endings by person/number, or a
        noun's forms by case) — a line of dashes under the header row is what makes it a table:
      </p>
      <pre className="right-panel-note right-panel-example">
        {'| Person | Singular | Plural |\n| --- | --- | --- |\n| 1st | -o | -mos |\n| 2nd | -as | -is |'}
      </pre>
      <WordDictionaryPanel body={body} />
      <GrammarRulesPanel body={body} />
    </div>
  )
}
