import { useEffect, useRef, useState } from 'react'
import { useDiceStore } from '../../state/diceStore'
import type { DiceRollResult } from '../../../../common/dice'

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100]

function formatBreakdown(result: DiceRollResult): string {
  const groupParts = result.groups.map((g) => {
    const rollsText = `[${g.rolls.join(', ')}]`
    const keepText = g.kept.length !== g.rolls.length ? ` keep ${g.kept.join(', ')}` : ''
    return `${g.sign < 0 ? '-' : ''}${rollsText}${keepText}`
  })
  if (result.modifier !== 0) {
    groupParts.push(`${result.modifier > 0 ? '+' : ''}${result.modifier}`)
  }
  return groupParts.join(' ')
}

export function DiceRoller(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [notation, setNotation] = useState('')
  const [error, setError] = useState(false)
  const history = useDiceStore((s) => s.history)
  const roll = useDiceStore((s) => s.roll)
  const clearHistory = useDiceStore((s) => s.clearHistory)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const doRoll = (n: string): void => {
    const result = roll(n)
    setError(result === null)
  }

  return (
    <div className="dice-roller" ref={panelRef}>
      <button className={open ? 'active' : ''} onClick={() => setOpen((v) => !v)} title="Dice roller">
        🎲
      </button>
      {open && (
        <div className="dice-panel">
          <div className="dice-quick-row">
            {QUICK_DICE.map((sides) => (
              <button key={sides} onClick={() => doRoll(`1d${sides}`)}>
                d{sides}
              </button>
            ))}
          </div>
          <div className="dice-quick-row">
            <button onClick={() => doRoll('2d20kh1')}>Advantage</button>
            <button onClick={() => doRoll('2d20kl1')}>Disadvantage</button>
          </div>
          <form
            className="dice-custom-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (notation.trim()) doRoll(notation)
            }}
          >
            <input
              value={notation}
              onChange={(e) => {
                setNotation(e.target.value)
                setError(false)
              }}
              placeholder="2d6+3"
              className={error ? 'dice-input-error' : ''}
            />
            <button type="submit">Roll</button>
          </form>
          {error && <div className="dice-error">Couldn't parse that — try something like 2d6+3.</div>}

          <div className="dice-history">
            {history.length === 0 ? (
              <p className="right-panel-note">No rolls yet.</p>
            ) : (
              <>
                <div className="dice-history-header">
                  <span>History</span>
                  <button className="dice-clear-button" onClick={clearHistory}>
                    Clear
                  </button>
                </div>
                {history.map((r) => (
                  <div key={r.id} className="dice-history-entry">
                    <span className="dice-history-notation">{r.notation}</span>
                    <span className="dice-history-breakdown">{formatBreakdown(r)}</span>
                    <span className="dice-history-total">{r.total}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
