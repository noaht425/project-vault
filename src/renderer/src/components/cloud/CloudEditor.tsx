import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { stringifyNote, parseNote } from '../../../../common/frontmatter'
import { useCloudEditorStore } from '../../state/cloudEditorStore'
import { useCloudNoteRefApi } from '../../lib/noteRefApi'
import { cloudWikiLinkCompletionSource } from './cloudWikiLinkCompletion'
import { darkCursorTheme } from '../editor/Editor'
import { SheetView } from '../sheets/SheetView'

// Cloud counterpart of Editor.tsx. No Edit/Preview toggle or PreviewPane
// yet (not asked for) — but SheetView's 10 per-note-type forms are reused
// as-is via a small shim: cloud notes already store frontmatter/body
// separately, so a "content" string is synthesized just to hand SheetView
// the shape it expects, then unpacked back into the two fields on change.
export function CloudEditor(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeNote = useCloudEditorStore((s) => s.activeNote)
  const revision = useCloudEditorStore((s) => s.revision)
  const body = useCloudEditorStore((s) => s.body)
  const frontmatter = useCloudEditorStore((s) => s.frontmatter)
  const setBody = useCloudEditorStore((s) => s.setBody)
  const setFrontmatter = useCloudEditorStore((s) => s.setFrontmatter)
  const conflict = useCloudEditorStore((s) => s.conflict)
  const retrySaveWithLatestVersion = useCloudEditorStore((s) => s.retrySaveWithLatestVersion)
  const discardAndReloadFromConflict = useCloudEditorStore((s) => s.discardAndReloadFromConflict)
  const noteRefApi = useCloudNoteRefApi()
  const [saving, setSaving] = useState(false)

  const sheetContent = stringifyNote({ frontmatter, body })
  const handleSheetContentChange = (newContent: string): void => {
    const parsed = parseNote(newContent)
    setFrontmatter(parsed.frontmatter)
    // Every sheet's updateFrontmatter passes the same `body` it was given
    // straight through unchanged, so this only actually differs from the
    // current body in some future edge case — cheap to handle correctly
    // rather than assume the invariant holds forever.
    if (parsed.body !== body) setBody(parsed.body)
  }

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
      <SheetView content={sheetContent} onContentChange={handleSheetContentChange} noteRefApi={noteRefApi} />
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
