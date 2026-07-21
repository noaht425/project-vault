import { useEffect, useState } from 'react'
import type { SessionSummary } from '../../../../common/types'

export function TimelineView({ onOpenSession }: { onOpenSession: (path: string) => void }): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => setSessions(await window.vaultApi.listSessions())
    void load()
    const off = window.vaultApi.onTreeUpdated(() => void load())
    return () => off()
  }, [])

  if (sessions === null) {
    return <div className="timeline-view timeline-empty">Loading…</div>
  }

  if (sessions.length === 0) {
    return (
      <div className="timeline-view timeline-empty">
        No session logs yet — create one with "+ Session" in the sidebar.
      </div>
    )
  }

  return (
    <div className="timeline-view">
      <h2>Sessions</h2>
      <div className="timeline-list">
        {sessions.map((s) => (
          <button key={s.path} className="timeline-entry" onClick={() => onOpenSession(s.path)}>
            <div className="timeline-entry-date">{s.date || 'Undated'}</div>
            <div className="timeline-entry-body">
              <div className="timeline-entry-title">{s.title}</div>
              {s.summary && <div className="timeline-entry-summary">{s.summary}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
