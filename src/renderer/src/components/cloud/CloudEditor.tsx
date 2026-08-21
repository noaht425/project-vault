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
import { PreviewPane } from '../editor/PreviewPane'

// Cloud counterpart of Editor.tsx. SheetView's 10 per-note-type forms are
// reused as-is via a small shim: cloud notes already store frontmatter/body
// separately, so a "content" string is synthesized just to hand SheetView
// the shape it expects, then unpacked back into the two fields on change.
// PreviewPane is reused the same way, given the same synthesized content.
export function CloudEditor(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
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
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

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

  // `revision` bumps on setFrontmatter/setBody but NOT on the user's own
  // typing here (the updateListener below calls setBody directly, not via
  // a path that bumps revision) — see cloudEditorStore.ts. syncedRevision
  // tracks which revision the mounted CodeMirror buffer currently
  // reflects; latestRevision/latestBody (refs, not state) let
  // resyncIfStale below always see current values without needing to be
  // in the mount effect's dependency array.
  const syncedRevision = useRef(revision)
  const latestRevision = useRef(revision)
  const latestBody = useRef(body)
  latestRevision.current = revision
  latestBody.current = body

  // Mounts CodeMirror once per note/mode, NOT on every SheetView edit —
  // mirrors Editor.tsx's own fix (see its comment for the full reasoning
  // and the measured cost this avoids for a large note). This editor's
  // buffer only ever shows `body` (frontmatter, where a Settlement's
  // residents/buildings actually live, never appears in Cloud's raw
  // editor at all — see this component's own top comment), so the
  // absolute worst case here is bounded by a note's body text length
  // rather than its bulk data, but the same unnecessary-recreation-on-
  // every-edit inefficiency applies regardless of how bounded it happens
  // to be today.
  useEffect(() => {
    if (mode !== 'edit' || !containerRef.current) return

    const state = EditorState.create({
      doc: latestBody.current,
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
    viewRef.current = view
    syncedRevision.current = latestRevision.current

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeNote?.id])

  // Catches the CodeMirror buffer up to any SheetView edits made since it
  // was last shown — see Editor.tsx's resyncIfStale for the full reasoning
  // (identical pattern, mirrored here).
  const resyncIfStale = (): void => {
    const view = viewRef.current
    if (!view || syncedRevision.current === latestRevision.current) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: latestBody.current } })
    syncedRevision.current = latestRevision.current
  }

  if (!activeNote) {
    return <div className="editor-empty">Select or create a cloud note to start writing.</div>
  }

  return (
    <div className="editor-pane">
      <div className="editor-title">{activeNote.name}</div>
      <SheetView noteName={activeNote.name} content={sheetContent} onContentChange={handleSheetContentChange} noteRefApi={noteRefApi} />
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
      <div className="editor-toolbar">
        <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
          Edit
        </button>
        <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
          Preview
        </button>
      </div>
      {mode === 'edit' ? (
        <div className="cm-container" ref={containerRef} onFocus={resyncIfStale} />
      ) : (
        <PreviewPane content={sheetContent} noteRefApi={noteRefApi} />
      )}
    </div>
  )
}
