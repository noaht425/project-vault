import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { useCloudEditorStore } from '../../state/cloudEditorStore'
import { cloudWikiLinkCompletionSource } from './cloudWikiLinkCompletion'
import { darkCursorTheme } from '../editor/Editor'

// Cloud counterpart of Editor.tsx — scoped to plain body text for now (no
// SheetView/PreviewPane/note-type frontmatter forms yet, since cloud notes
// only just got a full CRUD surface; those can follow once this is real
// enough to depend on daily).
export function CloudEditor(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeNote = useCloudEditorStore((s) => s.activeNote)
  const revision = useCloudEditorStore((s) => s.revision)
  const body = useCloudEditorStore((s) => s.body)
  const setBody = useCloudEditorStore((s) => s.setBody)
  const conflict = useCloudEditorStore((s) => s.conflict)
  const retrySaveWithLatestVersion = useCloudEditorStore((s) => s.retrySaveWithLatestVersion)
  const discardAndReloadFromConflict = useCloudEditorStore((s) => s.discardAndReloadFromConflict)
  const [saving, setSaving] = useState(false)

  // Re-sync the CodeMirror buffer whenever the note or its body was
  // replaced from outside user typing (open, discard-after-conflict).
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: body,
      extensions: [
        history(),
        autocompletion({ override: [cloudWikiLinkCompletionSource] }),
        keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.lineWrapping,
        darkCursorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) setBody(update.state.doc.toString())
        })
      ]
    })

    const view = new EditorView({ state, parent: containerRef.current })
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  if (!activeNote) {
    return <div className="editor-empty">Select or create a cloud note to start writing.</div>
  }

  return (
    <div className="editor-pane">
      <div className="editor-title">{activeNote.name}</div>
      {conflict && (
        <div className="right-panel-note" style={{ padding: 8 }}>
          Someone/something else changed this note in the meantime (it's now at version {conflict.version}). Your
          edit here is still safe, just not saved yet.
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              disabled={saving}
              onClick={() => {
                setSaving(true)
                void retrySaveWithLatestVersion().finally(() => setSaving(false))
              }}
            >
              Save my version anyway
            </button>
            <button onClick={discardAndReloadFromConflict}>Discard my edit, load latest</button>
          </div>
        </div>
      )}
      <div className="cm-container" ref={containerRef} />
    </div>
  )
}
