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
import { EventsSection } from './components/timeline/EventsSection'
import { GraphView } from './components/graph/GraphView'
import { InitiativeView } from './components/initiative/InitiativeView'
import { ContradictionsView } from './components/contradictions/ContradictionsView'
import { SearchView } from './components/search/SearchView'
import { DiceRoller } from './components/dice/DiceRoller'
import { CloudFileTree } from './components/cloud/CloudFileTree'
import { CloudEditor } from './components/cloud/CloudEditor'
import { CloudRightPanel } from './components/cloud/CloudRightPanel'
import { CloudSearchView } from './components/cloud/CloudSearchView'
import { CloudGraphView } from './components/cloud/CloudGraphView'
import { CloudTimelineView } from './components/cloud/CloudTimelineView'
import { CloudEventsSection } from './components/cloud/CloudEventsSection'

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
  const dirty = useEditorStore((s) => s.dirty)
  const markExternalChangePending = useEditorStore((s) => s.markExternalChangePending)
  const openNote = useEditorStore((s) => s.openNote)
  const checkCloudSession = useCloudStore((s) => s.checkSession)
  const onCloudSessionRestored = useCloudStore((s) => s.onSessionRestored)
  const setCloudTree = useCloudStore((s) => s.setTree)
  const loadCachedCloudTree = useCloudStore((s) => s.loadCachedTree)
  const refreshCloudTree = useCloudStore((s) => s.refreshTree)
  const signedIn = useCloudStore((s) => s.signedIn)
  const cloudOpenNote = useCloudEditorStore((s) => s.openNote)
  const cloudSaveNow = useCloudEditorStore((s) => s.saveNow)
  const cloudDirty = useCloudEditorStore((s) => s.dirty)
  const saving = useEditorStore((s) => s.saving)
  const saveError = useEditorStore((s) => s.saveError)
  const cloudSaving = useCloudEditorStore((s) => s.saving)
  const cloudSaveError = useCloudEditorStore((s) => s.saveError)
  const [workspaceSource, setWorkspaceSource] = useState<'local' | 'cloud'>('local')
  const [mainView, setMainView] = useState<'editor' | 'sessions' | 'events' | 'graph' | 'initiative' | 'contradictions'>('editor')
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
  // Also runs the calendar/timeline date migration here — the cloud
  // equivalent of the local vault's automatic-on-open hook in
  // main/vault/session.ts's openVault, since there's no single main-process
  // "cloud workspace opened" choke point to hook instead (see
  // docs/plans/2026-07-28-calendar-timeline-system.md's Step 5 notes).
  // Errors are swallowed — an enhancement, not required for the workspace
  // to be usable, and idempotent by construction so a failed attempt here
  // just gets retried next time signedIn flips true.
  useEffect(() => {
    if (signedIn) {
      void refreshCloudTree()
      void window.cloudApi.migrateDates().catch((err) => console.error('Event date migration failed:', err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  // Saves whichever of the two independent editor stores (local vault,
  // Cloud Workspace) is actually dirty — each saveNow() is already a no-op
  // when its own store isn't dirty, so this is safe to call unconditionally
  // regardless of which workspaceSource is currently displayed. This is
  // the app's own explicit "save everything that's pending" action — an
  // always-available manual trigger, not dependent on the passive
  // debounced autosave noticing a change.
  const saveAll = async (): Promise<void> => {
    await Promise.allSettled([saveNow(), cloudSaveNow()])
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void saveAll()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveNow, cloudSaveNow])

  // Quitting the app (see main/index.ts's before-quit handler) now waits
  // on this instead of trusting the passive autosave debounce to have
  // already fired — flushes whichever editor (local or cloud) is actually
  // dirty, then acks so the main process can proceed. If a save genuinely
  // fails (e.g. a dropped network request in Cloud mode), asks before
  // letting the app quit and lose it, rather than silently discarding it.
  useEffect(() => {
    const unsubscribe = window.appApi.onFlushBeforeQuit(() => {
      void (async () => {
        await Promise.allSettled([useEditorStore.getState().saveNow(), useCloudEditorStore.getState().saveNow()])
        const stillDirty = useEditorStore.getState().dirty || useCloudEditorStore.getState().dirty
        if (stillDirty && !window.confirm('A note could not be saved. Quit anyway and lose the unsaved changes?')) {
          window.appApi.cancelQuit()
          return
        }
        window.appApi.flushComplete()
      })()
    })
    return unsubscribe
  }, [])

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
          <button
            className={mainView === 'contradictions' ? 'active' : ''}
            onClick={() => setMainView((v) => (v === 'contradictions' ? 'editor' : 'contradictions'))}
            disabled={workspaceSource === 'cloud' || !vaultPath}
            title={workspaceSource === 'cloud' ? 'Contradiction Check is local-vault only for now' : undefined}
          >
            Contradictions
          </button>
        </div>
        <div className="title-bar-group">
          <button
            onClick={() => void saveAll()}
            disabled={saving || cloudSaving || (!dirty && !cloudDirty)}
            title="Save now (⌘S) — the currently open local and/or Cloud note"
          >
            {saving || cloudSaving ? 'Saving…' : dirty || cloudDirty ? 'Save*' : 'Save'}
          </button>
          {(saveError || cloudSaveError) && (
            <span style={{ color: '#c0392b', fontSize: 12 }} title={saveError ?? cloudSaveError ?? undefined}>
              Save failed: {saveError ?? cloudSaveError}
            </span>
          )}
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
            <CloudEventsSection
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
          <EventsSection
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
        ) : effectiveView === 'contradictions' ? (
          <ContradictionsView />
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
