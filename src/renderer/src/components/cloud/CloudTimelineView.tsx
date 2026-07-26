import { useEffect, useState } from 'react'
import type { CloudSessionSummary } from '../../../../common/cloudTypes'

// Cloud counterpart of TimelineView.tsx — same layout, swapping vaultApi
// for cloudApi and path identity for id.
export function CloudTimelineView({
  onOpenSession
}: {
  onOpenSession: (id: string) => void
}): React.JSX.Element {
  const [sessions, setSessions] = useState<CloudSessionSummary[] | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => setSessions(await window.cloudApi.listSessions())
    void load()
    const off = window.cloudApi.onTreeUpdated(() => void load())
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
          <button key={s.id} className="timeline-entry" onClick={() => onOpenSession(s.id)}>
            <div className="timeline-entry-date">{s.date || 'Undated'}</div>
            <div className="timeline-entry-body">
              <div className="timeline-entry-title">{s.name}</div>
              {s.summary && <div className="timeline-entry-summary">{s.summary}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
