import { useState } from 'react'
import type { Combatant } from '../../../../common/initiative'

function HpDeltaControl({ onApply }: { onApply: (delta: number) => void }): React.JSX.Element {
  const [value, setValue] = useState('')

  const submit = (sign: 1 | -1): void => {
    const n = Number(value)
    if (!value.trim() || Number.isNaN(n) || n <= 0) return
    onApply(sign * n)
    setValue('')
  }

  return (
    <form
      className="initiative-hp-delta"
      onSubmit={(e) => {
        e.preventDefault()
        submit(-1)
      }}
    >
      <input type="number" min={0} placeholder="amount" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" title="Apply damage">
        − Dmg
      </button>
      <button type="button" title="Apply healing" onClick={() => submit(1)}>
        + Heal
      </button>
    </form>
  )
}

function ConditionInput({ onAdd }: { onAdd: (condition: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('')

  return (
    <form
      className="initiative-condition-input"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) {
          onAdd(value)
          setValue('')
        }
      }}
    >
      <input placeholder="+ condition" value={value} onChange={(e) => setValue(e.target.value)} />
    </form>
  )
}

export function CombatantRow({
  combatant,
  active,
  onReroll,
  onSetInitiative,
  onHpDelta,
  onAddCondition,
  onRemoveCondition,
  onRemove,
  onOpenSource
}: {
  combatant: Combatant
  active: boolean
  onReroll: () => void
  onSetInitiative: (value: number | null) => void
  onHpDelta: (delta: number) => void
  onAddCondition: (condition: string) => void
  onRemoveCondition: (condition: string) => void
  onRemove: () => void
  onOpenSource?: () => void
}): React.JSX.Element {
  return (
    <div className={active ? 'initiative-row initiative-row-active' : 'initiative-row'}>
      <div className="initiative-row-initiative">
        <input
          type="number"
          value={combatant.initiative ?? ''}
          placeholder="–"
          onChange={(e) => onSetInitiative(e.target.value === '' ? null : Number(e.target.value))}
        />
        <button className="initiative-reroll-button" onClick={onReroll} title="Reroll initiative">
          🎲
        </button>
      </div>

      <div className="initiative-row-name">
        <span>{combatant.name}</span>
        {combatant.isPc && <span className="initiative-row-pc-badge">PC</span>}
        {onOpenSource && (
          <button className="sheet-open-ref-button" onClick={onOpenSource}>
            Open ↗
          </button>
        )}
      </div>

      <div className="initiative-row-hp">
        <span>
          {combatant.currentHp} / {combatant.maxHp} HP · AC {combatant.ac}
        </span>
        <HpDeltaControl onApply={onHpDelta} />
      </div>

      <div className="initiative-row-conditions">
        {combatant.conditions.map((cond) => (
          <span key={cond} className="condition-tag">
            {cond}
            <button onClick={() => onRemoveCondition(cond)}>×</button>
          </span>
        ))}
        <ConditionInput onAdd={onAddCondition} />
      </div>

      <button className="initiative-remove-button" onClick={onRemove} title="Remove combatant">
        ✕
      </button>
    </div>
  )
}
