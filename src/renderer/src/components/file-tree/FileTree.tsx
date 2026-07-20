import { useState, useRef, useEffect } from 'react'
import type { TreeEntry } from '../../../../common/types'
import { useVaultStore } from '../../state/vaultStore'
import { useEditorStore } from '../../state/editorStore'

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

function TreeNode({ entry, depth }: { entry: TreeEntry; depth: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const openNote = useEditorStore((s) => s.openNote)
  const closeNote = useEditorStore((s) => s.closeNote)
  const refreshTree = useVaultStore((s) => s.refreshTree)

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
          className="tree-row tree-row-folder"
          style={{ paddingLeft: depth * 14 }}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
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
  const [creating, setCreating] = useState<'note' | 'pc' | 'npc' | 'folder' | null>(null)

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

  return (
    <div className="sidebar">
      <div className="sidebar-toolbar">
        <button onClick={() => setCreating('note')} disabled={!vaultPath}>
          + Note
        </button>
        <button onClick={() => setCreating('pc')} disabled={!vaultPath}>
          + PC
        </button>
        <button onClick={() => setCreating('npc')} disabled={!vaultPath}>
          + NPC
        </button>
        <button onClick={() => setCreating('folder')} disabled={!vaultPath}>
          + Folder
        </button>
      </div>
      {creating && (
        <div className="tree-row tree-row-creating">
          <InlineNameInput
            initialValue=""
            placeholder={
              creating === 'folder'
                ? 'Folder name…'
                : creating === 'pc'
                  ? 'Character name…'
                  : creating === 'npc'
                    ? 'NPC name…'
                    : 'Note name…'
            }
            onSubmit={(v) => void submitCreate(v)}
            onCancel={() => setCreating(null)}
          />
        </div>
      )}
      <div className="tree">
        {tree.map((entry) => (
          <TreeNode key={entry.path} entry={entry} depth={0} />
        ))}
      </div>
    </div>
  )
}
