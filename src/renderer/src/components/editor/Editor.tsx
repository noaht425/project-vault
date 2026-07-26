import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { useEditorStore } from '../../state/editorStore'
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
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  // Re-sync the CodeMirror buffer whenever the note or its content was
  // replaced from outside user typing (open, reload-after-conflict).
  useEffect(() => {
    if (mode !== 'edit' || !containerRef.current) return

    const state = EditorState.create({
      doc: content,
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

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, mode])

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
      <SheetView content={content} onContentChange={setContentExternal} />
      <div className="editor-toolbar">
        <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
          Edit
        </button>
        <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
          Preview
        </button>
      </div>
      {mode === 'edit' ? (
        <div className="cm-container" ref={containerRef} />
      ) : (
        <PreviewPane content={content} />
      )}
    </div>
  )
}
