import { useState } from 'react'
import { importVaultIntoCloud, type MigrationProgress } from '../../lib/vaultCloudMigration'
import { translateLocalNoteForCloud } from '../../lib/migrationNoteTypeHooks'
import { shouldOffloadBulkData } from '../../../../common/settlementBulkData'
import { useVaultStore } from '../../state/vaultStore'
import { useCloudStore } from '../../state/cloudStore'

// See file-tree/CloudImportPanel.tsx (the mirror direction) for the shared
// plan-then-confirm design: "Start import" first runs a dryRun pass (real
// reads/comparisons, zero writes) and shows a summary — nothing is actually
// written until the user confirms it, since this direction can genuinely
// overwrite an existing cloud note (when the local copy is confirmed
// newer). See docs/plans/2026-08-04-cloud-to-local-copy.md design
// decision #6 ("both buttons behave identically... just mirrored in
// direction").
function transformLocalNote(note: { frontmatter: Record<string, unknown>; body: string }): Promise<{
  frontmatter: Record<string, unknown>
  body: string
}> {
  return translateLocalNoteForCloud(
    note,
    {
      getLocalImageUrl: window.vaultApi.getLocalImageUrl,
      uploadSettlementBulkData: window.cloudApi.uploadSettlementBulkData,
      uploadLocalMapImage: window.cloudApi.uploadLocalMapImage
    },
    shouldOffloadBulkData
  )
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

export function VaultImportPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const refreshCloudTree = useCloudStore((s) => s.refreshTree)
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState<MigrationProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MigrationProgress | null>(null)
  // Without a catch, a thrown initial tree fetch (network drop, auth expiry)
  // left "Start import" silently reset with zero feedback — same class of
  // bug SearchView.tsx's own .catch was added for.
  const [error, setError] = useState<string | null>(null)

  const startPlan = async (): Promise<void> => {
    setResult(null)
    setError(null)
    setPlanning(true)
    try {
      const p = await importVaultIntoCloud(window.vaultApi, window.cloudApi, () => {}, transformLocalNote, true)
      setPlan(p)
    } catch (err) {
      console.error('Failed to plan Local -> Cloud import:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPlanning(false)
    }
  }

  const confirmRun = async (): Promise<void> => {
    setPlan(null)
    setError(null)
    setRunning(true)
    try {
      const r = await importVaultIntoCloud(window.vaultApi, window.cloudApi, setResult, transformLocalNote)
      setResult(r)
      await refreshCloudTree()
    } catch (err) {
      console.error('Failed to run Local -> Cloud import:', err)
      setError(err instanceof Error ? err.message : String(err))
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
            once — a note that already exists here only gets overwritten if the local copy is strictly newer;
            otherwise it's left untouched and listed for you to review. Nothing is written until you confirm the
            summary below.
          </p>

          {!plan && (
            <button onClick={() => void startPlan()} disabled={planning || running}>
              {planning ? 'Checking…' : result ? 'Run again' : 'Start import'}
            </button>
          )}

          {error && (
            <p className="right-panel-note" style={{ color: '#e5484d' }}>
              {error}
            </p>
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
