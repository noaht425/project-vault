import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CONDITIONS } from '../../../../common/conditions'

/** Quick-add popover for the standard conditions, each shown with a one-line reminder of its effect — same popover idiom as DiceRoller. */
export function ConditionPicker({ onAdd }: { onAdd: (condition: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  return (
    <div className="condition-picker" ref={panelRef}>
      <button type="button" className={open ? 'active' : ''} onClick={() => setOpen((v) => !v)}>
        + Condition
      </button>
      {open && (
        <div className="condition-picker-menu">
          {DEFAULT_CONDITIONS.map((c) => (
            <button
              key={c.name}
              type="button"
              className="condition-picker-option"
              onClick={() => {
                onAdd(c.name)
                setOpen(false)
              }}
            >
              <span className="condition-picker-name">{c.name}</span>
              <span className="condition-picker-description">{c.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
