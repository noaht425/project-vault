import { useState } from 'react'
import { runContradictionCheck } from '../../lib/contradictionCheckRunner'
import { useLocalNoteRefApi } from '../../lib/noteRefApi'

// Local-vault-only for v1 — same rollout precedent as Initiative Tracker
// and Map×Timeline (see docs/plans/2026-07-27-initiative-timeline-settlement.md,
// 2026-07-27's Map×Timeline commit): no Cloud Workspace parity yet, add it
// later if wanted rather than blocking this on it now. The actual check
// logic (src/common/contradictionCheck.ts) and its runner
// (lib/contradictionCheckRunner.ts) are already backend-agnostic, so
// wiring Cloud in later is just this component's own IPC call and note-
// opening, not a rewrite.
export function ContradictionsView(): React.JSX.Element {
  const noteRefApi = useLocalNoteRefApi()
  const [status, setStatus] = useState<'idle' | 'checking' | 'done'>('idle')
  const [contradictions, setContradictions] = useState<Awaited<ReturnType<typeof runContradictionCheck>>>([])

  const runCheck = (): void => {
    setStatus('checking')
    void runContradictionCheck(() => window.vaultApi.listEvents(), noteRefApi).then((result) => {
      setContradictions(result)
      setStatus('done')
    })
  }

  return (
    <div style={{ padding: 16, maxWidth: 760, overflowY: 'auto' }}>
      <div className="sheet-row" style={{ alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Contradiction Check</h2>
        <button className="sheet-open-ref-button" onClick={runCheck} disabled={status === 'checking'}>
          {status === 'checking' ? 'Checking…' : 'Run Check'}
        </button>
      </div>
      <p className="right-panel-note">
        A mechanical pass over Born:/Died: facts, event dates, and family-tree parent/child pairs your notes already
        have — not an AI reading of your world's content, just the same kind of check a spreadsheet's data-validation
        rules would run against structure that already exists.
      </p>

      {status === 'done' && contradictions.length === 0 && <p>No contradictions found.</p>}

      {contradictions.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contradictions.map((c, i) => (
            <li key={i} style={{ border: '1px solid var(--border-color, #444)', borderRadius: 6, padding: 10 }}>
              <div>{c.message}</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <button onClick={() => void noteRefApi.openByTitle(c.noteATitle)} style={{ textAlign: 'left' }}>
                  Open {c.noteATitle}
                </button>
                {c.noteBTitle !== c.noteATitle && (
                  <button onClick={() => void noteRefApi.openByTitle(c.noteBTitle)} style={{ textAlign: 'left' }}>
                    Open {c.noteBTitle}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
