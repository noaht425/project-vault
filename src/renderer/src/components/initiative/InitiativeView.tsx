import { useEffect, useState } from 'react'
import {
  sortedTurnOrder,
  advanceTurn,
  endEncounter,
  applyHpDelta,
  addCondition,
  removeCondition,
  removeCombatant,
  rollInitiativeFor,
  buildCombatants,
  type Encounter,
  type Combatant,
  type NewCombatantInput
} from '../../../../common/initiative'
import { AddCombatantPanel } from './AddCombatantPanel'
import { CombatantRow } from './CombatantRow'

/**
 * Resolves a combatant's sourceNoteTitle to a real note path the same way
 * noteRefApi.openByTitle does (exact, case-insensitive match against
 * searchTitles), duplicated locally rather than reusing noteRefApi because
 * that hook's public interface intentionally doesn't expose a path/ref for
 * its own callers (PcSheet etc. never need one — they navigate directly).
 * This view needs the path so it can also switch mainView back to 'editor',
 * which is App.tsx's job via the onOpenSourceNote callback.
 */
async function resolveNotePath(title: string, kind: 'pc' | 'npc'): Promise<string | null> {
  const matches = await window.vaultApi.searchTitles(title, kind)
  const exact = matches.find((m) => m.title.toLowerCase() === title.toLowerCase())
  return exact?.path ?? null
}

export function InitiativeView({
  onOpenSourceNote
}: {
  onOpenSourceNote: (path: string) => void
}): React.JSX.Element {
  const [encounter, setEncounter] = useState<Encounter | null>(null)

  useEffect(() => {
    // Without a .catch, a rejected IPC call left encounter stuck at null
    // forever — "Loading…" with no way out.
    window.vaultApi
      .getCurrentEncounter()
      .then(setEncounter)
      .catch((err) => console.error('Failed to load encounter:', err))
  }, [])

  const persist = (next: Encounter): void => {
    setEncounter(next)
    window.vaultApi.saveCurrentEncounter(next).catch((err) => console.error('Failed to save encounter:', err))
  }

  if (encounter === null) {
    return <div className="initiative-view initiative-empty">Loading…</div>
  }

  const order = sortedTurnOrder(encounter.combatants)

  const updateCombatant = (id: string, updater: (c: Combatant) => Combatant): void => {
    persist({ ...encounter, combatants: encounter.combatants.map((c) => (c.id === id ? updater(c) : c)) })
  }

  const handleAdd = (input: NewCombatantInput): void => {
    persist({ ...encounter, combatants: [...encounter.combatants, ...buildCombatants(input)] })
  }

  const rollAll = (): void => {
    persist({ ...encounter, combatants: encounter.combatants.map((c) => ({ ...c, initiative: rollInitiativeFor(c) })) })
  }

  const openSource = (combatant: Combatant): void => {
    if (!combatant.sourceNoteTitle) return
    resolveNotePath(combatant.sourceNoteTitle, combatant.isPc ? 'pc' : 'npc')
      .then((path) => {
        if (path) onOpenSourceNote(path)
        else window.alert(`No note titled "${combatant.sourceNoteTitle}" yet.`)
      })
      .catch((err) => console.error('Failed to resolve source note:', err))
  }

  return (
    <div className="initiative-view">
      <div className="initiative-header">
        <h2>Initiative Tracker</h2>
        <span className="initiative-round">Round {encounter.round}</span>
        <div className="initiative-controls">
          <button onClick={rollAll} disabled={encounter.combatants.length === 0}>
            Roll All Initiative
          </button>
          <button onClick={() => persist(advanceTurn(encounter))} disabled={encounter.combatants.length === 0}>
            Next Turn
          </button>
          <button
            onClick={() => {
              if (window.confirm('End this encounter? NPCs/monsters are removed — PCs (and their HP) carry over.')) {
                persist(endEncounter(encounter))
              }
            }}
            disabled={encounter.combatants.length === 0}
          >
            End Encounter
          </button>
        </div>
      </div>

      <AddCombatantPanel onAdd={handleAdd} />

      {order.length === 0 ? (
        <p className="right-panel-note">No combatants yet — add PCs/NPCs above to start tracking a fight.</p>
      ) : (
        <div className="initiative-list">
          {order.map((c) => (
            <CombatantRow
              key={c.id}
              combatant={c}
              active={c.id === encounter.activeCombatantId}
              onReroll={() => updateCombatant(c.id, (combatant) => ({ ...combatant, initiative: rollInitiativeFor(combatant) }))}
              onSetInitiative={(value) => updateCombatant(c.id, (combatant) => ({ ...combatant, initiative: value }))}
              onHpDelta={(delta) => updateCombatant(c.id, (combatant) => applyHpDelta(combatant, delta))}
              onAddCondition={(condition) => updateCombatant(c.id, (combatant) => addCondition(combatant, condition))}
              onRemoveCondition={(condition) => updateCombatant(c.id, (combatant) => removeCondition(combatant, condition))}
              onRemove={() => persist(removeCombatant(encounter, c.id))}
              onOpenSource={c.sourceNoteTitle ? () => openSource(c) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
