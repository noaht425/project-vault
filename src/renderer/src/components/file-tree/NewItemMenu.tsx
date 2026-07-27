import { useEffect, useRef, useState } from 'react'
import { CREATABLE_NOTE_KINDS, CREATE_LABELS, type CreateKind } from '../../../../common/noteTemplateDefaults'

// Replaces what used to be a row of 12 separate "+ Note"/"+ PC"/.../"+ Folder"
// buttons (wrapping across several lines in the sidebar) with a single
// dropdown — same set of choices, far less visual noise. Shared by the
// local FileTree and CloudFileTree, which only differ in what happens
// after a kind is picked.
export function NewItemMenu({
  onSelect,
  disabled
}: {
  onSelect: (kind: CreateKind) => void
  disabled?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onOutsideClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onOutsideClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onOutsideClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const select = (kind: CreateKind): void => {
    setOpen(false)
    onSelect(kind)
  }

  return (
    <div className="new-item-menu" ref={containerRef}>
      <button disabled={disabled} onClick={() => setOpen((o) => !o)} className={open ? 'active' : ''}>
        New ▾
      </button>
      {open && (
        <div className="new-item-menu-dropdown">
          {CREATABLE_NOTE_KINDS.map((kind) => (
            <button key={kind} className="new-item-menu-option" onClick={() => select(kind)}>
              {CREATE_LABELS[kind]}
            </button>
          ))}
          <div className="new-item-menu-divider" />
          <button className="new-item-menu-option" onClick={() => select('folder')}>
            {CREATE_LABELS.folder}
          </button>
        </div>
      )}
    </div>
  )
}
