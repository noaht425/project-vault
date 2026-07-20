import { useEffect } from 'react'
import { useVaultStore } from './state/vaultStore'
import { useEditorStore } from './state/editorStore'
import { FileTree } from './components/file-tree/FileTree'
import { Editor } from './components/editor/Editor'
import { ConflictBanner } from './components/conflicts/ConflictBanner'
import { RightPanel } from './components/layout/RightPanel'

export default function App(): React.JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const openVault = useVaultStore((s) => s.openVault)
  const setTree = useVaultStore((s) => s.setTree)
  const saveNow = useEditorStore((s) => s.saveNow)
  const markExternalChangePending = useEditorStore((s) => s.markExternalChangePending)

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
      </div>
      <div className="app-body">
        <FileTree />
        <div className="editor-column">
          <ConflictBanner />
          <Editor />
        </div>
        <RightPanel />
      </div>
    </div>
  )
}
