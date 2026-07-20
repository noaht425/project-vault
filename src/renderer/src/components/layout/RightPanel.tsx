import { useEffect, useState } from 'react'
import { useEditorStore } from '../../state/editorStore'
import type { Backlink } from '../../../../common/types'

export function RightPanel(): React.JSX.Element {
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const dirty = useEditorStore((s) => s.dirty)
  const openNote = useEditorStore((s) => s.openNote)
  const [backlinks, setBacklinks] = useState<Backlink[]>([])

  useEffect(() => {
    if (!activeNotePath) {
      setBacklinks([])
      return
    }

    let cancelled = false
    const load = async (): Promise<void> => {
      const result = await window.vaultApi.getBacklinks(activeNotePath)
      if (!cancelled) setBacklinks(result)
    }
    void load()

    // Links can change on ANY note's save (someone else may now link to
    // this one), not just this note's own — the tree-updated push already
    // fires after every save/create/rename/delete, so it's a convenient
    // signal to re-check rather than adding a dedicated links-changed event.
    const off = window.vaultApi.onTreeUpdated(() => void load())
    return () => {
      cancelled = true
      off()
    }
  }, [activeNotePath])

  if (!activeNotePath) {
    return <div className="right-panel right-panel-empty">No note open.</div>
  }

  return (
    <div className="right-panel">
      <h3>Note info</h3>
      <div className="right-panel-path">{activeNotePath}</div>
      <div className="right-panel-status">{dirty ? 'Unsaved changes…' : 'Saved'}</div>

      <h3>Backlinks</h3>
      {backlinks.length === 0 ? (
        <p className="right-panel-note">No notes link here yet.</p>
      ) : (
        <ul className="backlink-list">
          {backlinks.map((b) => (
            <li key={b.sourcePath}>
              <button className="backlink-item" onClick={() => void openNote(b.sourcePath)}>
                {b.sourceTitle}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="right-panel-note">Structured sheet fields land here in a later phase.</p>
    </div>
  )
}
