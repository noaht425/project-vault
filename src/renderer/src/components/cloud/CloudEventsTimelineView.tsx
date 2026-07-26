import { useEffect, useState } from 'react'
import type { CloudEventSummary } from '../../../../common/cloudTypes'

// Cloud counterpart of EventsTimelineView.tsx — same layout, swapping
// vaultApi for cloudApi and path identity for id.
export function CloudEventsTimelineView({
  onOpenEvent
}: {
  onOpenEvent: (id: string) => void
}): React.JSX.Element {
  const [events, setEvents] = useState<CloudEventSummary[] | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => setEvents(await window.cloudApi.listEvents())
    void load()
    const off = window.cloudApi.onTreeUpdated(() => void load())
    return () => off()
  }, [])

  if (events === null) {
    return <div className="timeline-view timeline-empty">Loading…</div>
  }

  if (events.length === 0) {
    return (
      <div className="timeline-view timeline-empty">
        No world-history events yet — create one with "+ Event" in the sidebar, or add a "##
        History" section (or Born:/Died: lines) to any note.
      </div>
    )
  }

  return (
    <div className="timeline-view">
      <h2>Events</h2>
      <div className="timeline-list">
        {events.map((e, i) => (
          <button key={`${e.id}#${i}`} className="timeline-entry" onClick={() => onOpenEvent(e.id)}>
            <div className="timeline-entry-date">{e.date || 'Undated'}</div>
            <div className="timeline-entry-body">
              <div className="timeline-entry-title">
                {e.name}
                {e.noteType !== 'event' && <span className="timeline-entry-source"> · {e.noteType}</span>}
              </div>
              {e.summary && <div className="timeline-entry-summary">{e.summary}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
