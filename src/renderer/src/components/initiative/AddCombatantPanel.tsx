import { useEffect, useState } from 'react'
import { parseNote } from '../../../../common/frontmatter'
import { npcFrontmatterSchema } from '../../../../common/noteTypes/npc'
import { pcFrontmatterSchema } from '../../../../common/noteTypes/pc'
import { abilityModifier } from '../../../../common/noteTypes/creatureStats'
import type { NewCombatantInput } from '../../../../common/initiative'

const DEBOUNCE_MS = 200

interface TitleMatch {
  path: string
  title: string
  kind: 'pc' | 'npc'
}

interface Preview {
  ac: number
  maxHp: number
  startingHp: number
  initiativeBonus: number
}

function formatBonus(bonus: number): string {
  return bonus >= 0 ? `+${bonus}` : `${bonus}`
}

/**
 * Two ways to add a combatant: search an existing pc/npc note (copies a
 * snapshot of its ac/hp/DEX-derived initiative bonus — never links back to
 * mutate the note), or an ad-hoc one-off with hand-entered stats for a
 * monster that doesn't warrant a whole note. Both support a quantity count
 * for adding several identical copies at once (auto-numbered by
 * buildCombatants when count > 1).
 */
export function AddCombatantPanel({ onAdd }: { onAdd: (input: NewCombatantInput) => void }): React.JSX.Element {
  const [mode, setMode] = useState<'note' | 'adhoc'>('note')
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<TitleMatch[]>([])
  const [selected, setSelected] = useState<TitleMatch | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [count, setCount] = useState(1)

  const [adhocName, setAdhocName] = useState('')
  const [adhocAc, setAdhocAc] = useState(10)
  const [adhocHp, setAdhocHp] = useState(10)
  const [adhocBonus, setAdhocBonus] = useState(0)
  const [adhocIsPc, setAdhocIsPc] = useState(false)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setMatches([])
      return
    }
    const timer = setTimeout(() => {
      void Promise.all([
        window.vaultApi.searchTitles(trimmed, 'pc'),
        window.vaultApi.searchTitles(trimmed, 'npc')
      ]).then(([pcs, npcs]) => {
        setMatches([
          ...pcs.map((m) => ({ ...m, kind: 'pc' as const })),
          ...npcs.map((m) => ({ ...m, kind: 'npc' as const }))
        ])
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const selectMatch = async (match: TitleMatch): Promise<void> => {
    setSelected(match)
    setMatches([])
    const note = await window.vaultApi.readNote(match.path)
    const { frontmatter } = parseNote(note.content)
    const data =
      match.kind === 'npc' ? npcFrontmatterSchema.parse(frontmatter) : pcFrontmatterSchema.parse(frontmatter)
    setPreview({
      ac: data.ac,
      maxHp: data.maxHp,
      startingHp: data.hp,
      initiativeBonus: abilityModifier(data.stats.dex)
    })
  }

  const resetNoteForm = (): void => {
    setQuery('')
    setMatches([])
    setSelected(null)
    setPreview(null)
    setCount(1)
  }

  const addFromNote = (): void => {
    if (!selected || !preview) return
    onAdd({
      name: selected.title,
      sourceNoteTitle: selected.title,
      ac: preview.ac,
      maxHp: preview.maxHp,
      startingHp: preview.startingHp,
      initiativeBonus: preview.initiativeBonus,
      isPc: selected.kind === 'pc',
      count
    })
    resetNoteForm()
  }

  const addAdhoc = (): void => {
    if (!adhocName.trim()) return
    onAdd({
      name: adhocName.trim(),
      sourceNoteTitle: null,
      ac: adhocAc,
      maxHp: adhocHp,
      initiativeBonus: adhocBonus,
      isPc: adhocIsPc,
      count
    })
    setAdhocName('')
    setAdhocAc(10)
    setAdhocHp(10)
    setAdhocBonus(0)
    setAdhocIsPc(false)
    setCount(1)
  }

  return (
    <div className="initiative-add-panel">
      <div className="initiative-add-tabs">
        <button className={mode === 'note' ? 'active' : ''} onClick={() => setMode('note')}>
          From PC/NPC note
        </button>
        <button className={mode === 'adhoc' ? 'active' : ''} onClick={() => setMode('adhoc')}>
          Ad-hoc
        </button>
      </div>

      {mode === 'note' ? (
        <div className="initiative-add-row">
          <input
            placeholder="Search PC/NPC notes…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
              setPreview(null)
            }}
          />
          {!selected && matches.length > 0 && (
            <div className="initiative-add-matches">
              {matches.map((m) => (
                <button key={`${m.kind}-${m.path}`} onClick={() => void selectMatch(m)}>
                  {m.title} <span className="initiative-add-match-kind">{m.kind}</span>
                </button>
              ))}
            </div>
          )}
          {selected && preview && (
            <>
              <span className="initiative-add-preview">
                AC {preview.ac} · HP {preview.startingHp}/{preview.maxHp} · Init {formatBonus(preview.initiativeBonus)}
              </span>
              <label className="initiative-add-count">
                ×
                <input
                  type="number"
                  min={1}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
                />
              </label>
              <button onClick={addFromNote}>Add</button>
            </>
          )}
        </div>
      ) : (
        <div className="initiative-add-row">
          <input placeholder="Name" value={adhocName} onChange={(e) => setAdhocName(e.target.value)} />
          <label className="initiative-add-narrow">
            AC
            <input type="number" value={adhocAc} onChange={(e) => setAdhocAc(Number(e.target.value))} />
          </label>
          <label className="initiative-add-narrow">
            HP
            <input type="number" value={adhocHp} onChange={(e) => setAdhocHp(Number(e.target.value))} />
          </label>
          <label className="initiative-add-narrow">
            Init bonus
            <input type="number" value={adhocBonus} onChange={(e) => setAdhocBonus(Number(e.target.value))} />
          </label>
          <label className="initiative-add-checkbox">
            <input type="checkbox" checked={adhocIsPc} onChange={(e) => setAdhocIsPc(e.target.checked)} />
            PC
          </label>
          <label className="initiative-add-count">
            ×
            <input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} />
          </label>
          <button onClick={addAdhoc}>Add</button>
        </div>
      )}
    </div>
  )
}
