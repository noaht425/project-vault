import { useState } from 'react'
import { runContradictionCheck, type FactSource } from '../../lib/contradictionCheckRunner'
import { useLocalNoteRefApi, useCloudNoteRefApi } from '../../lib/noteRefApi'

// The check logic (src/common/contradictionCheck.ts) and its runner
// (lib/contradictionCheckRunner.ts) are backend-agnostic; this component just
// picks the local-vault or Cloud-Workspace note API + event list.
export function ContradictionsView({
  source
}: {
  source: 'local' | 'cloud'
}): React.JSX.Element {
  const localRef = useLocalNoteRefApi()
  const cloudRef = useCloudNoteRefApi()
  const noteRefApi = source === 'cloud' ? cloudRef : localRef
  const listFacts: () => Promise<FactSource[]> =
    source === 'cloud'
      ? async () =>
          (await window.cloudApi.listEvents()).map((e) => ({ title: e.name, date: e.date, summary: e.summary }))
      : () => window.vaultApi.listEvents()

  const [status, setStatus] = useState<'idle' | 'checking' | 'done'>('idle')
  const [contradictions, setContradictions] = useState<Awaited<ReturnType<typeof runContradictionCheck>>>([])

  const runCheck = (): void => {
    setStatus('checking')
    void runContradictionCheck(listFacts, noteRefApi).then((result) => {
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
