import { useState } from 'react'
import { importCloudIntoVault, type MigrationProgress } from '../../lib/vaultCloudMigration'
import { translateCloudNoteForLocal } from '../../lib/migrationNoteTypeHooks'
import { useVaultStore } from '../../state/vaultStore'
import { useCloudStore } from '../../state/cloudStore'

// Local Vault counterpart to cloud/VaultImportPanel.tsx (Local -> Cloud) —
// see docs/plans/2026-08-04-cloud-to-local-copy.md Phase 5. Reuses the same
// progress-streaming layout, extended with a warnings list (design decision
// #8) and a plan-then-confirm step before any write happens: since this
// direction can genuinely overwrite an existing note (when the source is
// confirmed newer), "Start import" first runs a dryRun pass (real reads/
// comparisons, zero writes) and shows a summary — nothing is actually
// written until the user confirms it.
function transformCloudNote(note: { frontmatter: Record<string, unknown>; body: string }): Promise<{
  frontmatter: Record<string, unknown>
  body: string
}> {
  return translateCloudNoteForLocal(note, {
    getMapImageUrl: window.cloudApi.getMapImageUrl,
    getSettlementBulkData: window.cloudApi.getSettlementBulkData,
    saveLocalImageBytes: window.vaultApi.saveLocalImageBytes,
    fetchBytes: (url) => fetch(url).then((r) => r.arrayBuffer())
  })
}

function ProgressSummary({ progress, running }: { progress: MigrationProgress; running: boolean }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <progress value={progress.done} max={Math.max(progress.total, 1)} style={{ width: '100%' }} />
      <span className="right-panel-note">
        {progress.done} / {progress.total} notes
        {running && progress.currentName ? ` — ${progress.currentName}` : ''}
        {!running ? `. ${progress.errors.length} failed, ${progress.warnings.length} skipped as conflicts.` : ''}
      </span>
      {progress.errors.length > 0 && (
        <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong>Errors</strong>
          {progress.errors.map((err, i) => (
            <div key={i}>
              <strong>{err.name}</strong>: {err.message}
            </div>
          ))}
        </div>
      )}
      {progress.warnings.length > 0 && (
        <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong>Skipped — needs your review</strong>
          {progress.warnings.map((warning, i) => (
            <div key={i}>
              <strong>{warning.name}</strong>: {warning.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CloudImportPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const refreshLocalTree = useVaultStore((s) => s.refreshTree)
  const checkingSession = useCloudStore((s) => s.checkingSession)
  const signedIn = useCloudStore((s) => s.signedIn)
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState<MigrationProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MigrationProgress | null>(null)

  const startPlan = async (): Promise<void> => {
    if (!vaultPath) return
    setResult(null)
    setPlanning(true)
    try {
      const p = await importCloudIntoVault(window.cloudApi, window.vaultApi, vaultPath, () => {}, transformCloudNote, true)
      setPlan(p)
    } finally {
      setPlanning(false)
    }
  }

  const confirmRun = async (): Promise<void> => {
    if (!vaultPath) return
    setPlan(null)
    setRunning(true)
    try {
      const r = await importCloudIntoVault(window.cloudApi, window.vaultApi, vaultPath, setResult, transformCloudNote)
      setResult(r)
      await refreshLocalTree()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="banner" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Import Cloud Workspace into Local Vault</strong>
        <button onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {!vaultPath ? (
        <p className="right-panel-note">Open a local vault first (File → Open Vault), then come back here to import into it.</p>
      ) : checkingSession ? (
        <p className="right-panel-note">Checking Cloud Workspace session…</p>
      ) : !signedIn ? (
        <p className="right-panel-note">Sign in to your Cloud Workspace first, then come back here to import from it.</p>
      ) : (
        <>
          <p className="right-panel-note">
            Copies every note and folder from your Cloud Workspace into this local vault. Safe to run more than once —
            a note that already exists here only gets overwritten if the cloud copy is strictly newer; otherwise it's
            left untouched and listed for you to review. Nothing is written until you confirm the summary below.
          </p>

          {!plan && (
            <button onClick={() => void startPlan()} disabled={planning || running}>
              {planning ? 'Checking…' : result ? 'Run again' : 'Start import'}
            </button>
          )}

          {plan && (
            <div className="right-panel-note" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>
                <strong>{plan.toCreate}</strong> note{plan.toCreate === 1 ? '' : 's'} will be created,{' '}
                <strong>{plan.toUpdate}</strong> updated, <strong>{plan.warnings.length}</strong> skipped as conflicts
                {plan.errors.length > 0 ? `, ${plan.errors.length} unreadable` : ''}. Proceed?
              </span>
              {plan.warnings.length > 0 && (
                <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong>Would be skipped</strong>
                  {plan.warnings.map((warning, i) => (
                    <div key={i}>
                      <strong>{warning.name}</strong>: {warning.message}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void confirmRun()}>Confirm — start writing</button>
                <button onClick={() => setPlan(null)}>Cancel</button>
              </div>
            </div>
          )}

          {result && <ProgressSummary progress={result} running={running} />}
        </>
      )}
    </div>
  )
}
