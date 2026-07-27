import { useState, useRef, useEffect } from 'react'
import type { TreeEntry } from '../../../../common/types'
import { CREATE_PLACEHOLDERS, type CreateKind } from '../../../../common/noteTemplateDefaults'
import { useVaultStore } from '../../state/vaultStore'
import { useEditorStore } from '../../state/editorStore'
import { NewItemMenu } from './NewItemMenu'

// window.alert() is one of the few dialogs Electron actually implements
// (unlike window.prompt() — see InlineNameInput below), so a failed
// file-tree operation surfaces here instead of failing as a silent,
// invisible promise rejection.
function reportError(err: unknown): void {
  window.alert(err instanceof Error ? err.message : String(err))
}

// Electron does not implement window.prompt() (only alert/confirm are
// backed by native dialogs), so name entry has to be an inline text input
// rather than a prompt() call.
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

// Dragged paths are passed through dataTransfer under this custom type so a
// drop handler can tell "a row from this tree" apart from an OS-level file
// drag (which we don't support) without needing any component-level state.
const DRAG_MIME = 'application/x-vault-path'

function TreeNode({ entry, depth }: { entry: TreeEntry; depth: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const openNote = useEditorStore((s) => s.openNote)
  const closeNote = useEditorStore((s) => s.closeNote)
  const refreshTree = useVaultStore((s) => s.refreshTree)

  const handleDragStart = (e: React.DragEvent): void => {
    e.dataTransfer.setData(DRAG_MIME, entry.path)
    e.dataTransfer.effectAllowed = 'move'
  }

  // A folder can't be dropped into itself or into one of its own
  // descendants — fs.rename would fail anyway, but this avoids a confusing
  // error surfacing from a plainly invalid drop.
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDropTarget(false)
    const draggedPath = e.dataTransfer.getData(DRAG_MIME)
    if (!draggedPath || draggedPath === entry.path || entry.path.startsWith(`${draggedPath}/`)) return
    try {
      await window.vaultApi.moveNote(draggedPath, entry.path)
      await refreshTree()
    } catch (err) {
      reportError(err)
    }
  }

  const submitCreateFolder = async (name: string): Promise<void> => {
    setCreatingFolder(false)
    try {
      await window.vaultApi.createFolder(entry.path, name)
      await refreshTree()
    } catch (err) {
      reportError(err)
    }
  }

  const submitRename = async (next: string): Promise<void> => {
    setRenaming(false)
    const current = entry.name.replace(/\.md$/, '')
    if (next === current) return
    try {
      const { newPath } = await window.vaultApi.renameNote(entry.path, next)
      await refreshTree()

      // The editor pane holds the open note's path independently of the tree —
      // if we just renamed the note (or a folder containing it) out from under
      // the open editor, it has to follow the rename or it's left pointing at
      // a path that no longer exists.
      if (!entry.isDirectory) {
        if (activeNotePath === entry.path) await openNote(newPath)
      } else if (activeNotePath?.startsWith(`${entry.path}/`)) {
        await openNote(newPath + activeNotePath.slice(entry.path.length))
      }
    } catch (err) {
      reportError(err)
    }
  }

  const handleDelete = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!window.confirm(`Delete "${entry.name}"? It will be moved to the system trash.`)) return
    try {
      await window.vaultApi.deleteNote(entry.path)
      await refreshTree()

      // Otherwise the editor keeps showing a note that no longer exists on
      // disk until the user happens to open something else.
      const activeWasDeleted = entry.isDirectory
        ? activeNotePath === entry.path || activeNotePath?.startsWith(`${entry.path}/`)
        : activeNotePath === entry.path
      if (activeWasDeleted) closeNote()
    } catch (err) {
      reportError(err)
    }
  }

  const label = renaming ? (
    <InlineNameInput
      initialValue={entry.name.replace(/\.md$/, '')}
      onSubmit={(v) => void submitRename(v)}
      onCancel={() => setRenaming(false)}
    />
  ) : (
    <span className="tree-label">{entry.name.replace(/\.md$/, '')}</span>
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
        {expanded &&
          entry.children?.map((child) => <TreeNode key={child.path} entry={child} depth={depth + 1} />)}
      </div>
    )
  }

  return (
    <div
      className={`tree-row tree-row-file ${activeNotePath === entry.path ? 'active' : ''}`}
      style={{ paddingLeft: depth * 14 + 14 }}
      onClick={() => void openNote(entry.path)}
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

export function FileTree(): React.JSX.Element {
  const tree = useVaultStore((s) => s.tree)
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const refreshTree = useVaultStore((s) => s.refreshTree)
  const openNote = useEditorStore((s) => s.openNote)
  const [creating, setCreating] = useState<CreateKind | null>(null)
  const [isRootDropTarget, setIsRootDropTarget] = useState(false)

  const submitCreate = async (name: string): Promise<void> => {
    const kind = creating
    setCreating(null)
    if (!vaultPath || !kind) return
    try {
      if (kind === 'folder') {
        await window.vaultApi.createFolder(vaultPath, name)
        await refreshTree()
      } else {
        const note = await window.vaultApi.createNote(vaultPath, name, kind)
        await refreshTree()
        await openNote(note.path)
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
    const draggedPath = e.dataTransfer.getData(DRAG_MIME)
    if (!draggedPath || !vaultPath) return
    try {
      await window.vaultApi.moveNote(draggedPath, vaultPath)
      await refreshTree()
    } catch (err) {
      reportError(err)
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-toolbar">
        <NewItemMenu disabled={!vaultPath} onSelect={(kind) => setCreating(kind)} />
      </div>
      {creating && (
        <div className="tree-row tree-row-creating">
          <InlineNameInput
            initialValue=""
            placeholder={CREATE_PLACEHOLDERS[creating]}
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
        {tree.map((entry) => (
          <TreeNode key={entry.path} entry={entry} depth={0} />
        ))}
      </div>
    </div>
  )
}
