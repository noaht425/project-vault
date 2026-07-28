import { useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { calendarFrontmatterSchema } from '../../../../common/noteTypes/calendar'
import { CalendarOverviewTab } from './CalendarOverviewTab'
import { CalendarMonthsTab } from './CalendarMonthsTab'
import { CalendarWeekTab } from './CalendarWeekTab'
import { CalendarDaysTab } from './CalendarDaysTab'
import { CalendarYearsErasTab } from './CalendarYearsErasTab'
import { CalendarMoonsTab } from './CalendarMoonsTab'
import { CalendarSettingsTab } from './CalendarSettingsTab'

type CalendarTab = 'overview' | 'months' | 'week' | 'days' | 'years-eras' | 'moons' | 'settings'

// Same button-row tab pattern as SettlementSheet.tsx (no real tab UI
// primitive exists in this codebase) — 7 tabs mirroring the reference
// "Time System Editor" site's own tab list (see
// docs/plans/2026-07-28-calendar-timeline-system.md).
export function CalendarSheet({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = calendarFrontmatterSchema.parse(frontmatter)

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const [tab, setTab] = useState<CalendarTab>('overview')

  return (
    <div className="sheet-view">
      <div className="editor-toolbar">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={tab === 'months' ? 'active' : ''} onClick={() => setTab('months')}>
          Months ({data.months.length})
        </button>
        <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>
          Week ({data.weekDays.length})
        </button>
        <button className={tab === 'days' ? 'active' : ''} onClick={() => setTab('days')}>
          Days
        </button>
        <button className={tab === 'years-eras' ? 'active' : ''} onClick={() => setTab('years-eras')}>
          Years &amp; Eras ({data.eras.length})
        </button>
        <button className={tab === 'moons' ? 'active' : ''} onClick={() => setTab('moons')}>
          Moons ({data.moons.length})
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Settings
        </button>
      </div>

      {tab === 'overview' && <CalendarOverviewTab data={data} updateFrontmatter={updateFrontmatter} />}
      {tab === 'months' && <CalendarMonthsTab data={data} updateFrontmatter={updateFrontmatter} />}
      {tab === 'week' && <CalendarWeekTab data={data} updateFrontmatter={updateFrontmatter} />}
      {tab === 'days' && <CalendarDaysTab data={data} updateFrontmatter={updateFrontmatter} />}
      {tab === 'years-eras' && <CalendarYearsErasTab data={data} updateFrontmatter={updateFrontmatter} />}
      {tab === 'moons' && <CalendarMoonsTab data={data} updateFrontmatter={updateFrontmatter} />}
      {tab === 'settings' && <CalendarSettingsTab data={data} updateFrontmatter={updateFrontmatter} />}
    </div>
  )
}
