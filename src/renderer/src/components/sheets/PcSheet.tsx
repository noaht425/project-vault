import { useEffect, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { pcFrontmatterSchema } from '../../../../common/noteTypes/pc'
import type { AbilityKey } from '../../../../common/noteTypes/creatureStats'
import { AbilityScoreGrid } from './AbilityScoreGrid'
import { CommonCombatFields } from './CommonCombatFields'
import { ClassFeaturesPanel } from './ClassFeaturesPanel'

export function PcSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = pcFrontmatterSchema.parse(frontmatter)
  const [classRefOptions, setClassRefOptions] = useState<string[]>([])

  useEffect(() => {
    void window.vaultApi
      .searchTitles('', 'class-reference')
      .then((matches) => setClassRefOptions(matches.map((m) => m.title)))
  }, [])

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
      </div>
      <AbilityScoreGrid stats={data.stats} onChange={updateStat} />
      <ClassFeaturesPanel classRef={data.classRef} level={data.level} />
    </div>
  )
}
