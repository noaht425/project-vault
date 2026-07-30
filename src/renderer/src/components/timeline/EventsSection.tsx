import { useState } from 'react'
import { EventsTimelineView } from './EventsTimelineView'
import { EventsPillTimelineView } from './EventsPillTimelineView'
import { MonthGridView } from './MonthGridView'

// Wraps the three Events sibling views — the original plain sorted list
// (EventsTimelineView, unchanged), the scaled pill timeline (build step 7 of
// docs/plans/2026-07-28-calendar-timeline-system.md), and the month-grid
// Calendar view (a real "look at the month of Aucaela" page, distinct from
// both — see docs/plans/2026-07-29-month-grid-campaign-date.md) — behind a
// List/Timeline/Calendar toggle, so the existing view stays the default and
// nothing about today's behavior changes unless the user opts into another.
export function EventsSection({ onOpenEvent }: { onOpenEvent: (path: string) => void }): React.JSX.Element {
  const [tab, setTab] = useState<'list' | 'timeline' | 'grid'>('list')

  return (
    <div className="events-section">
      <div className="editor-toolbar events-section-toolbar">
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
          List
        </button>
        <button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>
          Timeline
        </button>
        <button className={tab === 'grid' ? 'active' : ''} onClick={() => setTab('grid')}>
          Calendar
        </button>
      </div>
      {tab === 'list' && <EventsTimelineView onOpenEvent={onOpenEvent} />}
      {tab === 'timeline' && <EventsPillTimelineView onOpenEvent={onOpenEvent} />}
      {tab === 'grid' && <MonthGridView onOpenEvent={onOpenEvent} />}
    </div>
  )
}
