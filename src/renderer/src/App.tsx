import { useEffect, useRef, useState } from 'react'
import { useVaultStore } from './state/vaultStore'
import { useEditorStore } from './state/editorStore'
import { useCloudStore } from './state/cloudStore'
import { useCloudEditorStore } from './state/cloudEditorStore'
import { FileTree } from './components/file-tree/FileTree'
import { Editor } from './components/editor/Editor'
import { ConflictBanner } from './components/conflicts/ConflictBanner'
import { RightPanel } from './components/layout/RightPanel'
import { TimelineView } from './components/timeline/TimelineView'
import { EventsTimelineView } from './components/timeline/EventsTimelineView'
import { GraphView } from './components/graph/GraphView'
import { InitiativeView } from './components/initiative/InitiativeView'
import { SearchView } from './components/search/SearchView'
import { DiceRoller } from './components/dice/DiceRoller'
import { CloudFileTree } from './components/cloud/CloudFileTree'
import { CloudEditor } from './components/cloud/CloudEditor'
import { CloudRightPanel } from './components/cloud/CloudRightPanel'
import { CloudSearchView } from './components/cloud/CloudSearchView'
import { CloudGraphView } from './components/cloud/CloudGraphView'
import { CloudTimelineView } from './components/cloud/CloudTimelineView'
import { CloudEventsTimelineView } from './components/cloud/CloudEventsTimelineView'

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
  const checkCloudSession = useCloudStore((s) => s.checkSession)
  const onCloudSessionRestored = useCloudStore((s) => s.onSessionRestored)
  const setCloudTree = useCloudStore((s) => s.setTree)
  const loadCachedCloudTree = useCloudStore((s) => s.loadCachedTree)
  const refreshCloudTree = useCloudStore((s) => s.refreshTree)
  const signedIn = useCloudStore((s) => s.signedIn)
  const cloudOpenNote = useCloudEditorStore((s) => s.openNote)
  const [workspaceSource, setWorkspaceSource] = useState<'local' | 'cloud'>('local')
  const [mainView, setMainView] = useState<'editor' | 'sessions' | 'events' | 'graph' | 'initiative'>('editor')
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

  // Cloud session/tree wiring runs unconditionally at mount, same as the
  // local vault above — it shouldn't matter whether the cloud workspace is
  // the visible one right now, only that it's ready the moment it becomes so.
  useEffect(() => {
    void checkCloudSession()
    void loadCachedCloudTree()
    const offSession = window.cloudApi.onSessionRestored(onCloudSessionRestored)
    const offTree = window.cloudApi.onTreeUpdated((tree) => setCloudTree(tree))
    return () => {
      offSession()
      offTree()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fires once signed-in becomes true, from whichever path got there first
  // (an already-resumed session found by checkSession, or a slightly later
  // cloud:sessionRestored push) — pulls a fresh tree over the network since
  // the cached one loaded above may be stale or from a previous session.
  useEffect(() => {
    if (signedIn) void refreshCloudTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

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
        <div className="title-bar-group">
          <button onClick={() => void openVault()}>Open Vault…</button>
          <span className="vault-path">{vaultPath ?? 'No vault open'}</span>
        </div>
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
          disabled={workspaceSource === 'local' && !vaultPath}
        />
        <span className="title-bar-spacer" />
        <div className="title-bar-group">
          <button
            className={workspaceSource === 'local' ? 'active' : ''}
            onClick={() => setWorkspaceSource('local')}
            title="Notes stored in this vault's local files"
          >
            Local Vault
          </button>
          <button
            className={workspaceSource === 'cloud' ? 'active' : ''}
            onClick={() => setWorkspaceSource('cloud')}
            title="Notes stored in project-vault-cloud"
          >
            Cloud Workspace
          </button>
        </div>
        <div className="title-bar-group">
          <button
            className={mainView === 'sessions' ? 'active' : ''}
            onClick={() => setMainView((v) => (v === 'sessions' ? 'editor' : 'sessions'))}
            disabled={workspaceSource === 'local' && !vaultPath}
          >
            Sessions
          </button>
          <button
            className={mainView === 'events' ? 'active' : ''}
            onClick={() => setMainView((v) => (v === 'events' ? 'editor' : 'events'))}
            disabled={workspaceSource === 'local' && !vaultPath}
          >
            Events
          </button>
          <button
            className={mainView === 'graph' ? 'active' : ''}
            onClick={() => setMainView((v) => (v === 'graph' ? 'editor' : 'graph'))}
            disabled={workspaceSource === 'local' && !vaultPath}
          >
            Graph
          </button>
          <button
            className={mainView === 'initiative' ? 'active' : ''}
            onClick={() => setMainView((v) => (v === 'initiative' ? 'editor' : 'initiative'))}
            disabled={workspaceSource === 'cloud' || !vaultPath}
            title={workspaceSource === 'cloud' ? 'Initiative Tracker is local-vault only for now' : undefined}
          >
            Initiative
          </button>
        </div>
        <div className="title-bar-group">
          <DiceRoller />
        </div>
      </div>
      <div className="app-body" style={{ gridTemplateColumns: `${sidebarWidth}px 5px 1fr 280px` }}>
        {workspaceSource === 'cloud' ? <CloudFileTree /> : <FileTree />}
        <div
          className="sidebar-resize-handle"
          onMouseDown={(e) => {
            e.preventDefault()
            resizing.current = true
          }}
        />
        {workspaceSource === 'cloud' ? (
          effectiveView === 'search' ? (
            <CloudSearchView
              query={searchQuery}
              onOpenResult={(id) => {
                void cloudOpenNote(id)
                setSearchQuery('')
              }}
            />
          ) : mainView === 'graph' ? (
            <CloudGraphView
              onOpenNode={(id) => {
                void cloudOpenNote(id)
                setMainView('editor')
              }}
            />
          ) : mainView === 'sessions' ? (
            <CloudTimelineView
              onOpenSession={(id) => {
                void cloudOpenNote(id)
                setMainView('editor')
              }}
            />
          ) : mainView === 'events' ? (
            <CloudEventsTimelineView
              onOpenEvent={(id) => {
                void cloudOpenNote(id)
                setMainView('editor')
              }}
            />
          ) : (
            <>
              <div className="editor-column">
                <CloudEditor />
              </div>
              <CloudRightPanel />
            </>
          )
        ) : effectiveView === 'search' ? (
          <SearchView
            query={searchQuery}
            onOpenResult={(path) => {
              void openNote(path)
              setSearchQuery('')
            }}
          />
        ) : effectiveView === 'sessions' ? (
          <TimelineView
            onOpenSession={(path) => {
              void openNote(path)
              setMainView('editor')
            }}
          />
        ) : effectiveView === 'events' ? (
          <EventsTimelineView
            onOpenEvent={(path) => {
              void openNote(path)
              setMainView('editor')
            }}
          />
        ) : effectiveView === 'graph' ? (
          <GraphView
            onOpenNode={(path) => {
              void openNote(path)
              setMainView('editor')
            }}
          />
        ) : effectiveView === 'initiative' ? (
          <InitiativeView
            onOpenSourceNote={(path) => {
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
