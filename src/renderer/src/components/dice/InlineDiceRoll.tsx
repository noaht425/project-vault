import { useState } from 'react'
import { useDiceStore } from '../../state/diceStore'

/** A clickable inline-code dice expression (e.g. `` `3d6+7` `` in a monster
 *  stat block) — rolls it via the shared dice store (so it lands in the
 *  same history as the popover) and shows the result right next to it. */
export function InlineDiceRoll({ notation }: { notation: string }): React.JSX.Element {
  const roll = useDiceStore((s) => s.roll)
  const [total, setTotal] = useState<number | null>(null)

  const doRoll = (): void => {
    const result = roll(notation)
    setTotal(result?.total ?? null)
  }

  return (
    <span className="inline-dice-roll">
      <code
        role="button"
        tabIndex={0}
        title="Click to roll"
        onClick={doRoll}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            doRoll()
          }
        }}
      >
        🎲 {notation}
      </code>
      {total !== null && <span className="inline-dice-result">→ {total}</span>}
    </span>
  )
}
