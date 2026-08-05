import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { useEditorStore } from '../../state/editorStore'
import { useLocalNoteRefApi } from '../../lib/noteRefApi'
import { PreviewPane } from './PreviewPane'
import { wikiLinkCompletionSource } from './wikiLinkCompletion'
import { SheetView } from '../sheets/SheetView'

// CodeMirror's base theme hardcodes the cursor to a solid black border and
// the selection to a light-blue highlight — both assume a light background,
// so both are invisible/wrong against this app's dark one. This is the
// minimal fix (cursor + selection only), not a full syntax-highlighting
// theme.
export const darkCursorTheme = EditorView.theme(
  {
    '.cm-content': { caretColor: 'var(--text-normal)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-normal)' },
    // rgba of --accent (#7c8cff) at low opacity, since CodeMirror needs a
    // real color here (var() inside rgba()'s color-mix isn't worth the
    // complexity for one rule) and this keeps it visually tied to --accent
    // rather than an unrelated invented blue.
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(124, 140, 255, 0.35) !important'
    }
  },
  { dark: true }
)

export function Editor(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const revision = useEditorStore((s) => s.revision)
  const content = useEditorStore((s) => s.content)
  const setContent = useEditorStore((s) => s.setContent)
  const setContentExternal = useEditorStore((s) => s.setContentExternal)
  const noteRefApi = useLocalNoteRefApi()
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  // `revision` bumps on setContentExternal (a SheetView-driven edit) but
  // NOT on setContent (the user's own typing here) — see editorStore.ts.
  // syncedRevision tracks which revision the mounted CodeMirror buffer
  // currently reflects; latestRevision/latestContent (refs, not state) let
  // resyncIfStale below always see the current values without needing to
  // be in the mount effect's dependency array.
  const syncedRevision = useRef(revision)
  const latestRevision = useRef(revision)
  const latestContent = useRef(content)
  latestRevision.current = revision
  latestContent.current = content

  // Mounts CodeMirror once per note/mode, NOT on every SheetView edit — see
  // resyncIfStale for how the buffer catches up to those instead, only
  // when the raw editor is actually about to be used. Recreating
  // EditorState/EditorView on every keystroke elsewhere used to be how
  // this stayed in sync ("revision" was in this effect's own dependency
  // array), but for a large Settlement note (residents/buildings stay
  // inline, no size limit locally) that's tens of MB of markdown —
  // measured directly: EditorState.create() ALONE takes 2+ seconds at that
  // scale, before even mounting the DOM view. A real reported bug: typing
  // in an unrelated Settlement form field froze the app for 5+ seconds per
  // character, with keystrokes visibly batching up and landing all at
  // once once the renderer caught up — consistent with this exact
  // recreation blocking the main thread on every single edit.
  useEffect(() => {
    if (mode !== 'edit' || !containerRef.current) return

    const state = EditorState.create({
      doc: latestContent.current,
      extensions: [
        history(),
        autocompletion({ override: [wikiLinkCompletionSource] }),
        keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.lineWrapping,
        darkCursorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setContent(update.state.doc.toString())
          }
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
  }, [mode, activeNotePath])

  // Catches the CodeMirror buffer up to any SheetView edits made since it
  // was last shown — called when the raw editor is about to be used
  // (focused) instead of eagerly on every edit anywhere else in the sheet.
  // Comparing `revision` numbers (not doc content) is what makes this
  // cheap: it only bumps on a SheetView edit, never on typing here, so
  // "unequal" reliably means "stale," with no need to stringify/compare a
  // potentially tens-of-MB document just to check.
  //
  // Trade-off worth knowing about: watching the raw markdown update live
  // WHILE typing in a form field elsewhere (without ever clicking into the
  // raw editor) no longer happens — it catches up the moment you focus it
  // instead. Deliberate: keeping that live-watch behavior is what forced
  // the expensive recreation on every keystroke in the first place, for a
  // niche case (actively watching raw YAML while not interacting with it)
  // far less important than the sheet form staying responsive.
  const resyncIfStale = (): void => {
    const view = viewRef.current
    if (!view || syncedRevision.current === latestRevision.current) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: latestContent.current } })
    syncedRevision.current = latestRevision.current
  }

  if (!activeNotePath) {
    return <div className="editor-empty">Select or create a note to start writing.</div>
  }

  const title = activeNotePath
    .split(/[/\\]/)
    .pop()!
    .replace(/\.md$/, '')

  return (
    <div className="editor-pane">
      <div className="editor-title">{title}</div>
      <SheetView content={content} onContentChange={setContentExternal} noteRefApi={noteRefApi} />
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
        <PreviewPane content={content} noteRefApi={noteRefApi} />
      )}
    </div>
  )
}
