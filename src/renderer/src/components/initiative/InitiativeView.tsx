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
 * The four IO operations the tracker needs, so it works against either the
 * local vault (window.vaultApi + an encounter file in userData) or a Cloud
 * Workspace (window.cloudApi + the encounter in browser localStorage, the
 * same choice the web app made). `openNote` takes a path for local, an id
 * for cloud — App.tsx wires the right one.
 */
export interface InitiativeBackend {
  isCloud: boolean
  searchTitles(query: string, type: string): Promise<{ ref: string; title: string }[]>
  loadEncounter(): Promise<Encounter>
  saveEncounter(e: Encounter): Promise<void>
  openNote(ref: string): void
}

export function InitiativeView({ backend }: { backend: InitiativeBackend }): React.JSX.Element {
  const [encounter, setEncounter] = useState<Encounter | null>(null)

  useEffect(() => {
    backend
      .loadEncounter()
      .then(setEncounter)
      .catch((err) => console.error('Failed to load encounter:', err))
    // re-load when the backend switches (local <-> cloud)
  }, [backend])

  const persist = (next: Encounter): void => {
    setEncounter(next)
    backend.saveEncounter(next).catch((err) => console.error('Failed to save encounter:', err))
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
    const kind = combatant.isPc ? 'pc' : 'npc'
    backend
      .searchTitles(combatant.sourceNoteTitle, kind)
      .then((matches) => {
        const exact = matches.find((m) => m.title.toLowerCase() === combatant.sourceNoteTitle!.toLowerCase())
        if (exact) backend.openNote(exact.ref)
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
