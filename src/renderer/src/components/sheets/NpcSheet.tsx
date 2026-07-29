import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { npcFrontmatterSchema } from '../../../../common/noteTypes/npc'
import type { AbilityKey } from '../../../../common/noteTypes/creatureStats'
import { AbilityScoreGrid } from './AbilityScoreGrid'
import { CommonCombatFields } from './CommonCombatFields'

export function NpcSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = npcFrontmatterSchema.parse(frontmatter)

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
          Role
          <input value={data.role} onChange={(e) => updateFrontmatter({ role: e.target.value })} />
        </label>
        <label className="sheet-field sheet-field-narrow">
          CR
          <input value={data.cr} onChange={(e) => updateFrontmatter({ cr: e.target.value })} />
        </label>
        <label className="sheet-field" style={{ width: 90 }}>
          {/* Optional — feeds Family Tree's relationship plausibility checks
              (familyTree.ts) when set. Blank means "unknown," not 0 — explicit
              90px width, not .sheet-field-narrow's 64px default, which has
              clipped a number input's spinner arrows at least 3 times before
              in this app. */}
          Age
          <input
            type="number"
            placeholder="unknown"
            value={data.age ?? ''}
            onChange={(e) => updateFrontmatter({ age: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
        <CommonCombatFields ac={data.ac} hp={data.hp} maxHp={data.maxHp} onChange={updateFrontmatter} />
      </div>
      <AbilityScoreGrid stats={data.stats} onChange={updateStat} />
    </div>
  )
}
