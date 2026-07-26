import { useEffect, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { pcFrontmatterSchema } from '../../../../common/noteTypes/pc'
import type { AbilityKey } from '../../../../common/noteTypes/creatureStats'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { AbilityScoreGrid } from './AbilityScoreGrid'
import { CommonCombatFields } from './CommonCombatFields'
import { ClassFeaturesPanel } from './ClassFeaturesPanel'

export function PcSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = pcFrontmatterSchema.parse(frontmatter)
  const [classRefOptions, setClassRefOptions] = useState<string[]>([])

  useEffect(() => {
    void noteRefApi.searchTitles('', 'class-reference').then((matches) => setClassRefOptions(matches.map((m) => m.title)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openClassReference = async (): Promise<void> => {
    const trimmed = data.classRef.trim()
    if (!trimmed) return
    await noteRefApi.openByTitle(trimmed, 'class-reference')
  }

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const updateStat = (key: AbilityKey, value: number): void => {
    updateFrontmatter({ stats: { ...data.stats, [key]: value } })
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
        <label className="sheet-field sheet-field-narrow">
          Level
          <input
            type="number"
            value={data.level}
            onChange={(e) => updateFrontmatter({ level: Number(e.target.value) })}
          />
        </label>
        <label className="sheet-field">
          Race
          <input value={data.race} onChange={(e) => updateFrontmatter({ race: e.target.value })} />
        </label>
        <CommonCombatFields ac={data.ac} hp={data.hp} maxHp={data.maxHp} onChange={updateFrontmatter} />
      </div>
      <div className="sheet-row">
        <label className="sheet-field">
          Class Reference
          <input
            list="class-ref-options"
            value={data.classRef}
            onChange={(e) => updateFrontmatter({ classRef: e.target.value })}
            placeholder="e.g. Fighter — Champion"
          />
          <datalist id="class-ref-options">
            {classRefOptions.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className="sheet-open-ref-button"
          onClick={() => void openClassReference()}
          disabled={!data.classRef.trim()}
        >
          Open ↗
        </button>
      </div>
      <AbilityScoreGrid stats={data.stats} onChange={updateStat} />
      <ClassFeaturesPanel classRef={data.classRef} level={data.level} noteRefApi={noteRefApi} />
    </div>
  )
}
