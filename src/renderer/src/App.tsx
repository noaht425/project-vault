import { useEffect, useRef, useState } from 'react'
import { useVaultStore } from './state/vaultStore'
import { useEditorStore } from './state/editorStore'
import { FileTree } from './components/file-tree/FileTree'
import { Editor } from './components/editor/Editor'
import { ConflictBanner } from './components/conflicts/ConflictBanner'
import { RightPanel } from './components/layout/RightPanel'
import { TimelineView } from './components/timeline/TimelineView'
import { SearchView } from './components/search/SearchView'

const SIDEBAR_WIDTH_KEY = 'sidebarWidth'
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 560

function loadSidebarWidth(): number {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  return stored >= SIDEBAR_MIN && stored <= SIDEBAR_MAX ? stored : 260
}

export default function App(): React.JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const openVault = useVaultStore((s) => s.openVault)
  const hydrateFromCurrent = useVaultStore((s) => s.hydrateFromCurrent)
  const setTree = useVaultStore((s) => s.setTree)
  const saveNow = useEditorStore((s) => s.saveNow)
  const markExternalChangePending = useEditorStore((s) => s.markExternalChangePending)
  const openNote = useEditorStore((s) => s.openNote)
  const [mainView, setMainView] = useState<'editor' | 'timeline'>('editor')
  const [searchQuery, setSearchQuery] = useState('')
  const effectiveView = searchQuery.trim() ? 'search' : mainView
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const resizing = useRef(false)

  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      if (!resizing.current) return
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX)))
    }
    const onMouseUp = (): void => {
      if (!resizing.current) return
      resizing.current = false
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [sidebarWidth])

  useEffect(() => {
    void hydrateFromCurrent()
  }, [hydrateFromCurrent])

  useEffect(() => {
    const offTree = window.vaultApi.onTreeUpdated((tree) => setTree(tree))
    const offExternal = window.vaultApi.onExternalChange((event) => {
      if (event.kind !== 'unlink') markExternalChangePending(event.path)
    })
    return () => {
      offTree()
      offExternal()
    }
  }, [setTree, markExternalChangePending])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void saveNow()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveNow])

  return (
    <div className="app-shell">
      <div className="title-bar">
        <button onClick={() => void openVault()}>Open Vault…</button>
        <span className="vault-path">{vaultPath ?? 'No vault open'}</span>
        <input
          className="search-input"
          type="search"
          placeholder="Search notes…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchQuery('')
              e.currentTarget.blur()
            }
          }}
          disabled={!vaultPath}
        />
        <span className="title-bar-spacer" />
        <button
          className={mainView === 'timeline' ? 'active' : ''}
          onClick={() => setMainView((v) => (v === 'timeline' ? 'editor' : 'timeline'))}
          disabled={!vaultPath}
        >
          Timeline
        </button>
      </div>
      <div className="app-body" style={{ gridTemplateColumns: `${sidebarWidth}px 5px 1fr 280px` }}>
        <FileTree />
        <div
          className="sidebar-resize-handle"
          onMouseDown={(e) => {
            e.preventDefault()
            resizing.current = true
          }}
        />
        {effectiveView === 'search' ? (
          <SearchView
            query={searchQuery}
            onOpenResult={(path) => {
              void openNote(path)
              setSearchQuery('')
            }}
          />
        ) : effectiveView === 'timeline' ? (
          <TimelineView
            onOpenSession={(path) => {
              void openNote(path)
              setMainView('editor')
            }}
          />
        ) : (
          <>
            <div className="editor-column">
              <ConflictBanner />
              <Editor />
            </div>
            <RightPanel />
          </>
        )}
      </div>
    </div>
  )
}
