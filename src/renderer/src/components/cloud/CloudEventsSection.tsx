import { useState } from 'react'
import { CloudEventsTimelineView } from './CloudEventsTimelineView'
import { CloudEventsPillTimelineView } from './CloudEventsPillTimelineView'

// Cloud counterpart of EventsSection.tsx — see that file for the toggle
// rationale (build step 7 of docs/plans/2026-07-28-calendar-timeline-system.md).
export function CloudEventsSection({ onOpenEvent }: { onOpenEvent: (id: string) => void }): React.JSX.Element {
  const [tab, setTab] = useState<'list' | 'timeline'>('list')

  return (
    <div className="events-section">
      <div className="editor-toolbar events-section-toolbar">
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
          List
        </button>
        <button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>
          Timeline
        </button>
      </div>
      {tab === 'list' ? (
        <CloudEventsTimelineView onOpenEvent={onOpenEvent} />
      ) : (
        <CloudEventsPillTimelineView onOpenEvent={onOpenEvent} />
      )}
    </div>
  )
}
