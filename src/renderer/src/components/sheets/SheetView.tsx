import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { pcFrontmatterSchema } from '../../../../common/noteTypes/pc'
import { npcFrontmatterSchema } from '../../../../common/noteTypes/npc'
import type { AbilityKey } from '../../../../common/noteTypes/creatureStats'
import { AbilityScoreGrid } from './AbilityScoreGrid'

export function SheetView({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element | null {
  const { frontmatter, body } = parseNote(content)
  const type = typeof frontmatter.type === 'string' ? frontmatter.type : undefined
  if (type !== 'pc' && type !== 'npc') return null

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const updateStat = (key: AbilityKey, value: number): void => {
    const currentStats = (frontmatter.stats as Record<string, number> | undefined) ?? {}
    updateFrontmatter({ stats: { ...currentStats, [key]: value } })
  }

  const commonFields = (data: { ac: number; hp: number; maxHp: number }): React.JSX.Element => (
    <>
      <label className="sheet-field sheet-field-narrow">
        AC
        <input type="number" value={data.ac} onChange={(e) => updateFrontmatter({ ac: Number(e.target.value) })} />
      </label>
      <label className="sheet-field sheet-field-narrow">
        HP
        <input type="number" value={data.hp} onChange={(e) => updateFrontmatter({ hp: Number(e.target.value) })} />
      </label>
      <label className="sheet-field sheet-field-narrow">
        Max HP
        <input
          type="number"
          value={data.maxHp}
          onChange={(e) => updateFrontmatter({ maxHp: Number(e.target.value) })}
        />
      </label>
    </>
  )

  if (type === 'pc') {
    const data = pcFrontmatterSchema.parse(frontmatter)
    return (
      <div className="sheet-view">
        <div className="sheet-row">
          <label className="sheet-field">
            Class
            <input value={data.class} onChange={(e) => updateFrontmatter({ class: e.target.value })} />
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
          {commonFields(data)}
        </div>
        <AbilityScoreGrid stats={data.stats} onChange={updateStat} />
      </div>
    )
  }

  const data = npcFrontmatterSchema.parse(frontmatter)
  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field">
          Role
          <input value={data.role} onChange={(e) => updateFrontmatter({ role: e.target.value })} />
        </label>
        <label className="sheet-field sheet-field-narrow">
          CR
          <input value={data.cr} onChange={(e) => updateFrontmatter({ cr: e.target.value })} />
        </label>
        {commonFields(data)}
      </div>
      <AbilityScoreGrid stats={data.stats} onChange={updateStat} />
    </div>
  )
}
