import { useState, useRef, useEffect } from 'react'
import type { CloudTreeNode } from '../../../../common/cloudTypes'
import { useCloudStore } from '../../state/cloudStore'
import { useCloudEditorStore } from '../../state/cloudEditorStore'

// window.alert() is one of the few dialogs Electron actually implements
// (unlike window.prompt() — see InlineNameInput below), so a failed
// tree operation surfaces here instead of failing as a silent, invisible
// promise rejection. Same convention as the local FileTree.
function reportError(err: unknown): void {
  window.alert(err instanceof Error ? err.message : String(err))
}

// Every note id nested anywhere under this entry (including itself if it's
// a note) — used to tell whether deleting a folder is about to take the
// currently-open note down with it, the same way the local FileTree checks
// activeNotePath.startsWith(entry.path).
function collectNoteIds(entry: CloudTreeNode): string[] {
  if (!entry.isDirectory) return [entry.id]
  return (entry.children ?? []).flatMap(collectNoteIds)
}

function InlineNameInput({
  initialValue,
  placeholder,
  onSubmit,
  onCancel
}: {
  initialValue: string
  placeholder?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const settle = (action: () => void): void => {
    if (settledRef.current) return
    settledRef.current = true
    action()
  }

  return (
    <input
      ref={inputRef}
      className="tree-inline-input"
      defaultValue={initialValue}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const value = inputRef.current?.value.trim()
          settle(() => (value ? onSubmit(value) : onCancel()))
        } else if (e.key === 'Escape') {
          settle(onCancel)
        }
      }}
      onBlur={() => {
        const value = inputRef.current?.value.trim()
        settle(() => (value ? onSubmit(value) : onCancel()))
      }}
    />
  )
}

interface DragPayload {
  id: string
  isDirectory: boolean
}

// Dragged nodes are passed through dataTransfer as JSON under this custom
// type, mirroring the local tree's DRAG_MIME but carrying isDirectory too
// (needed to route a drop to moveNote vs. moveFolder — the cloud API keeps
// those as two separate id spaces, unlike the local filesystem's uniform
// path).
const DRAG_MIME = 'application/x-cloud-node'

function TreeNode({ entry, depth }: { entry: CloudTreeNode; depth: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const activeNoteId = useCloudEditorStore((s) => s.activeNote?.id ?? null)
  const openNote = useCloudEditorStore((s) => s.openNote)
  const closeNote = useCloudEditorStore((s) => s.closeNote)
  const refreshTree = useCloudStore((s) => s.refreshTree)

  const handleDragStart = (e: React.DragEvent): void => {
    const payload: DragPayload = { id: entry.id, isDirectory: entry.isDirectory }
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDropTarget(false)
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    const dragged = JSON.parse(raw) as DragPayload
    if (dragged.id === entry.id) return
    try {
      if (dragged.isDirectory) {
        await window.cloudApi.moveFolder(dragged.id, entry.id)
      } else {
        const note = await window.cloudApi.getNote(dragged.id)
        await window.cloudApi.moveNote(dragged.id, entry.id, note.version)
      }
      await refreshTree()
    } catch (err) {
      reportError(err)
    }
  }

  const submitCreateFolder = async (name: string): Promise<void> => {
    setCreatingFolder(false)
    try {
      await window.cloudApi.createFolder(name, entry.id)
      await refreshTree()
    } catch (err) {
      reportError(err)
    }
  }

  const submitRename = async (next: string): Promise<void> => {
    setRenaming(false)
    if (next === entry.name) return
    try {
      if (entry.isDirectory) {
        await window.cloudApi.renameFolder(entry.id, next)
      } else {
        // entry.version always exists for a note (see project-vault-cloud's
        // /api/tree) — folders don't have one, hence the isDirectory branch.
        await window.cloudApi.renameNote(entry.id, next, entry.version!)
      }
      await refreshTree()

      // The editor pane holds its own cached copy of the open note — if we
      // just renamed it (or a folder containing it) out from under the
      // editor, that cache goes stale until re-fetched.
      if (collectNoteIds(entry).includes(activeNoteId ?? '')) {
        await openNote(activeNoteId!)
      }
    } catch (err) {
      reportError(err)
    }
  }

  const handleDelete = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const noun = entry.isDirectory ? 'folder and everything in it' : 'note'
    if (!window.confirm(`Delete "${entry.name}"? This ${noun} cannot be recovered.`)) return
    try {
      const affectedIds = collectNoteIds(entry)
      if (entry.isDirectory) {
        await window.cloudApi.deleteFolder(entry.id)
      } else {
        await window.cloudApi.deleteNote(entry.id)
      }
      await refreshTree()
      if (activeNoteId && affectedIds.includes(activeNoteId)) closeNote()
    } catch (err) {
      reportError(err)
    }
  }

  const label = renaming ? (
    <InlineNameInput initialValue={entry.name} onSubmit={(v) => void submitRename(v)} onCancel={() => setRenaming(false)} />
  ) : (
    <span className="tree-label">{entry.name}</span>
  )

  if (entry.isDirectory) {
    return (
      <div>
        <div
          className={`tree-row tree-row-folder ${isDropTarget ? 'tree-row-drop-target' : ''}`}
          style={{ paddingLeft: depth * 14 }}
          onClick={() => setExpanded((v) => !v)}
          draggable
          onDragStart={handleDragStart}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDropTarget(true)
          }}
          onDragLeave={() => setIsDropTarget(false)}
          onDrop={(e) => void handleDrop(e)}
        >
          <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
          {label}
          <span className="tree-actions">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setCreatingFolder(true)
              }}
              title="New folder inside"
            >
              📁+
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(true)
              }}
              title="Rename"
            >
              ✎
            </button>
            <button onClick={handleDelete} title="Delete">
              🗑
            </button>
          </span>
        </div>
        {creatingFolder && (
          <div className="tree-row tree-row-creating" style={{ paddingLeft: (depth + 1) * 14 }}>
            <InlineNameInput
              initialValue=""
              placeholder="Folder name…"
              onSubmit={(v) => void submitCreateFolder(v)}
              onCancel={() => setCreatingFolder(false)}
            />
          </div>
        )}
        {expanded && entry.children?.map((child) => <TreeNode key={child.id} entry={child} depth={depth + 1} />)}
      </div>
    )
  }

  return (
    <div
      className={`tree-row tree-row-file ${activeNoteId === entry.id ? 'active' : ''}`}
      style={{ paddingLeft: depth * 14 + 14 }}
      onClick={() => void openNote(entry.id)}
      draggable
      onDragStart={handleDragStart}
    >
      {label}
      <span className="tree-actions">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setRenaming(true)
          }}
          title="Rename"
        >
          ✎
        </button>
        <button onClick={handleDelete} title="Delete">
          🗑
        </button>
      </span>
    </div>
  )
}

function CloudSignInForm(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const signIn = useCloudStore((s) => s.signIn)
  const signInError = useCloudStore((s) => s.signInError)

  return (
    <div className="sidebar" style={{ padding: 16, gap: 8, display: 'flex', flexDirection: 'column' }}>
      <p className="right-panel-note">Sign in to your cloud workspace.</p>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button onClick={() => void signIn(email, password)}>Sign in</button>
      {signInError && <p className="right-panel-note">{signInError}</p>}
    </div>
  )
}

export function CloudFileTree(): React.JSX.Element {
  const checkingSession = useCloudStore((s) => s.checkingSession)
  const signedIn = useCloudStore((s) => s.signedIn)
  const tree = useCloudStore((s) => s.tree)
  const refreshTree = useCloudStore((s) => s.refreshTree)
  const openNote = useCloudEditorStore((s) => s.openNote)
  const [creating, setCreating] = useState<'note' | 'folder' | null>(null)
  const [isRootDropTarget, setIsRootDropTarget] = useState(false)

  if (checkingSession) return <div className="sidebar" style={{ padding: 16 }}>Checking session…</div>
  if (!signedIn) return <CloudSignInForm />

  const submitCreate = async (name: string): Promise<void> => {
    const kind = creating
    setCreating(null)
    if (!kind) return
    try {
      if (kind === 'folder') {
        await window.cloudApi.createFolder(name, null)
        await refreshTree()
      } else {
        const note = await window.cloudApi.createNote({ name, frontmatter: { type: 'note' } })
        await refreshTree()
        await openNote(note.id)
      }
    } catch (err) {
      reportError(err)
    }
  }

  // Lets a note or folder be dragged back out to the top level — folder
  // rows call stopPropagation() in their own onDrop, so this only fires
  // when the drop lands on empty tree space, not on a nested folder.
  const handleRootDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setIsRootDropTarget(false)
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    const dragged = JSON.parse(raw) as DragPayload
    try {
      if (dragged.isDirectory) {
        await window.cloudApi.moveFolder(dragged.id, null)
      } else {
        const note = await window.cloudApi.getNote(dragged.id)
        await window.cloudApi.moveNote(dragged.id, null, note.version)
      }
      await refreshTree()
    } catch (err) {
      reportError(err)
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-toolbar">
        <button onClick={() => setCreating('note')}>+ Note</button>
        <button onClick={() => setCreating('folder')}>+ Folder</button>
      </div>
      {creating && (
        <div className="tree-row tree-row-creating">
          <InlineNameInput
            initialValue=""
            placeholder={creating === 'folder' ? 'Folder name…' : 'Note name…'}
            onSubmit={(v) => void submitCreate(v)}
            onCancel={() => setCreating(null)}
          />
        </div>
      )}
      <div
        className={`tree ${isRootDropTarget ? 'tree-drop-target' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={(e) => {
          e.preventDefault()
          setIsRootDropTarget(true)
        }}
        onDragLeave={() => setIsRootDropTarget(false)}
        onDrop={(e) => void handleRootDrop(e)}
      >
        {(tree ?? []).map((entry) => (
          <TreeNode key={entry.id} entry={entry} depth={0} />
        ))}
      </div>
    </div>
  )
}
