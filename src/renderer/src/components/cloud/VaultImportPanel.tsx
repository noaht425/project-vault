import { useState } from 'react'
import { importVaultIntoCloud, type MigrationProgress } from '../../lib/vaultCloudMigration'
import { useVaultStore } from '../../state/vaultStore'
import { useCloudStore } from '../../state/cloudStore'

export function VaultImportPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const refreshCloudTree = useCloudStore((s) => s.refreshTree)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [running, setRunning] = useState(false)

  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      // window.vaultApi/cloudApi structurally satisfy the migration's
      // narrower Migration*Api interfaces — no adapter needed.
      const result = await importVaultIntoCloud(window.vaultApi, window.cloudApi, setProgress)
      setProgress(result)
      await refreshCloudTree()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="banner" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Import Local Vault into Cloud Workspace</strong>
        <button onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {!vaultPath ? (
        <p className="right-panel-note">Open a local vault first (File → Open Vault), then come back here to import it.</p>
      ) : (
        <>
          <p className="right-panel-note">
            Copies every note and folder from your local vault into this Cloud Workspace. Safe to run more than
            once — anything already imported (matched by name and location) is skipped, never duplicated.
          </p>
          <button onClick={() => void run()} disabled={running}>
            {running ? 'Importing…' : progress ? 'Run again' : 'Start import'}
          </button>

          {progress && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <progress value={progress.done} max={Math.max(progress.total, 1)} style={{ width: '100%' }} />
              <span className="right-panel-note">
                {progress.done} / {progress.total} notes
                {running && progress.currentName ? ` — ${progress.currentName}` : ''}
                {!running ? `. ${progress.errors.length} failed.` : ''}
              </span>
              {progress.errors.length > 0 && (
                <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {progress.errors.map((err, i) => (
                    <div key={i}>
                      <strong>{err.name}</strong>: {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
