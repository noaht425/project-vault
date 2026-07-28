import { useState } from 'react'
import { EventsTimelineView } from './EventsTimelineView'
import { EventsPillTimelineView } from './EventsPillTimelineView'

// Wraps the two Events sibling views — the original plain sorted list
// (EventsTimelineView, unchanged) and the new scaled pill timeline (build
// step 7 of docs/plans/2026-07-28-calendar-timeline-system.md) — behind a
// List/Timeline toggle, so the existing view stays the default and nothing
// about today's behavior changes unless the user opts into Timeline.
export function EventsSection({ onOpenEvent }: { onOpenEvent: (path: string) => void }): React.JSX.Element {
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
      {tab === 'list' ? <EventsTimelineView onOpenEvent={onOpenEvent} /> : <EventsPillTimelineView onOpenEvent={onOpenEvent} />}
    </div>
  )
}
