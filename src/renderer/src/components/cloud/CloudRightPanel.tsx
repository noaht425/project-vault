import { useEffect, useState } from 'react'
import { useCloudEditorStore } from '../../state/cloudEditorStore'
import type { CloudBacklink } from '../../../../common/cloudTypes'

// Cloud counterpart of RightPanel.tsx — same "note info + backlinks"
// layout, swapping vaultApi for cloudApi and path identity for id.
export function CloudRightPanel(): React.JSX.Element {
  const activeNote = useCloudEditorStore((s) => s.activeNote)
  const dirty = useCloudEditorStore((s) => s.dirty)
  const openNote = useCloudEditorStore((s) => s.openNote)
  const [backlinks, setBacklinks] = useState<CloudBacklink[]>([])

  useEffect(() => {
    if (!activeNote) {
      setBacklinks([])
      return
    }

    let cancelled = false
    const load = async (): Promise<void> => {
      const result = await window.cloudApi.getBacklinks(activeNote.id)
      if (!cancelled) setBacklinks(result)
    }
    void load()

    // Same rationale as the local RightPanel: any note's save can add a
    // link to this one, not just this note's own, so the tree-updated push
    // (already fired after every cloud save/create/rename/delete/move) is a
    // convenient re-check signal instead of a dedicated links-changed event.
    const off = window.cloudApi.onTreeUpdated(() => void load())
    return () => {
      cancelled = true
      off()
    }
  }, [activeNote?.id])

  if (!activeNote) {
    return <div className="right-panel right-panel-empty">No note open.</div>
  }

  return (
    <div className="right-panel">
      <h3>Note info</h3>
      <div className="right-panel-path">{activeNote.name}</div>
      <div className="right-panel-status">{dirty ? 'Unsaved changes…' : 'Saved'}</div>

      <h3>Backlinks</h3>
      {backlinks.length === 0 ? (
        <p className="right-panel-note">No notes link here yet.</p>
      ) : (
        <ul className="backlink-list">
          {backlinks.map((b) => (
            <li key={b.sourceId}>
              <button className="backlink-item" onClick={() => void openNote(b.sourceId)}>
                {b.sourceName}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="right-panel-note">Structured sheet fields aren't wired up for cloud notes yet.</p>
    </div>
  )
}
