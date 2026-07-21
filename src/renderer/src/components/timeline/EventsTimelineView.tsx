import { useEffect, useState } from 'react'
import type { EventSummary } from '../../../../common/types'

export function EventsTimelineView({
  onOpenEvent
}: {
  onOpenEvent: (path: string) => void
}): React.JSX.Element {
  const [events, setEvents] = useState<EventSummary[] | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => setEvents(await window.vaultApi.listEvents())
    void load()
    const off = window.vaultApi.onTreeUpdated(() => void load())
    return () => off()
  }, [])

  if (events === null) {
    return <div className="timeline-view timeline-empty">Loading…</div>
  }

  if (events.length === 0) {
    return (
      <div className="timeline-view timeline-empty">
        No world-history events yet — create one with "+ Event" in the sidebar.
      </div>
    )
  }

  return (
    <div className="timeline-view">
      <h2>Events</h2>
      <div className="timeline-list">
        {events.map((e) => (
          <button key={e.path} className="timeline-entry" onClick={() => onOpenEvent(e.path)}>
            <div className="timeline-entry-date">{e.date || 'Undated'}</div>
            <div className="timeline-entry-body">
              <div className="timeline-entry-title">{e.title}</div>
              {e.summary && <div className="timeline-entry-summary">{e.summary}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
