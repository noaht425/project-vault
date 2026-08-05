import { useState } from 'react'
import { extractFrontmatterType } from '../../../../common/frontmatter'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { PcSheet } from './PcSheet'
import { NpcSheet } from './NpcSheet'
import { ClassReferenceSheet } from './ClassReferenceSheet'
import { SessionSheet } from './SessionSheet'
import { EventSheet } from './EventSheet'
import { FactionSheet } from './FactionSheet'
import { ItemSheet } from './ItemSheet'
import { LocationSheet } from './LocationSheet'
import { LanguageSheet } from './LanguageSheet'
import { FamilyTreeSheet } from './FamilyTreeSheet'
import { MapSheet } from './MapSheet'
import { SettlementSheet } from './SettlementSheet'
import { SettlementPresetSheet } from './SettlementPresetSheet'
import { CalendarSheet } from './CalendarSheet'
import { ClimateSheet } from './ClimateSheet'

const SHEET_COLLAPSED_KEY = 'sheetCollapsed'

function loadSheetCollapsed(): boolean {
  return localStorage.getItem(SHEET_COLLAPSED_KEY) === 'true'
}

export function SheetView({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  /** Only PcSheet (class-reference lookup), EventSheet (location field), MapSheet
   *  (pin placement), FamilyTreeSheet (click-to-open diagram nodes), SettlementSheet
   *  (religion-note picker), ClimateSheet (calendar picker), and LocationSheet
   *  (climate-note picker) need this — everything else is a plain form with no
   *  note-to-note resolution. */
  noteRefApi: NoteRefApi
}): React.JSX.Element | null {
  // extractFrontmatterType, not parseNote — this used to do a full
  // parseNote(content) memoized on [content], which looked like caching
  // but wasn't: `content` changes on every keystroke, so this "memo" never
  // actually hit, and for a large Settlement note (residents/buildings
  // stay inline, no size limit locally) that's a full YAML parse — 1.4+
  // seconds, measured directly — on every single edit, just to read this
  // one field. Confirmed regression: this ran regardless of anything
  // SettlementSheet.tsx itself optimized internally, since this component
  // sits above it and always parsed first. `type` never changes during a
  // normal editing session, so a cheap, targeted string extraction is all
  // that's needed here (no useMemo — it's a bounded regex scan now, not a
  // full parse, so there's nothing worth memoizing against a dependency
  // that changes every keystroke anyway) — every per-type child below
  // still does its own real parseNote/schema.parse of the fields it
  // actually needs.
  const type = extractFrontmatterType(content)
  // A collapse toggle, not per-note — a sheet that runs long (a Language
  // note's dictionary, a big Settlement) can squeeze the raw-markdown
  // editor down to its bare min-height (see .cm-container/.preview-pane in
  // styles.css); this lets that space be reclaimed on demand. Kept as one
  // app-wide preference rather than persisted per note, same as
  // sidebarWidth in App.tsx, since it's a density preference more than a
  // per-note setting.
  const [collapsed, setCollapsed] = useState(loadSheetCollapsed)

  let sheet: React.JSX.Element | null
  switch (type) {
    case 'pc':
      sheet = <PcSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
      break
    case 'npc':
      sheet = <NpcSheet content={content} onContentChange={onContentChange} />
      break
    case 'class-reference':
      sheet = <ClassReferenceSheet content={content} onContentChange={onContentChange} />
      break
    case 'session':
      sheet = <SessionSheet content={content} onContentChange={onContentChange} />
      break
    case 'event':
      sheet = <EventSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
      break
    case 'faction':
      sheet = <FactionSheet content={content} onContentChange={onContentChange} />
      break
    case 'item':
      sheet = <ItemSheet content={content} onContentChange={onContentChange} />
      break
    case 'location':
      sheet = <LocationSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
      break
    case 'language':
      sheet = <LanguageSheet content={content} onContentChange={onContentChange} />
      break
    case 'family-tree':
      sheet = <FamilyTreeSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
      break
    case 'map':
      sheet = <MapSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
      break
    case 'settlement':
      sheet = <SettlementSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
      break
    case 'settlement-preset':
      sheet = <SettlementPresetSheet content={content} />
      break
    case 'calendar':
      sheet = <CalendarSheet content={content} onContentChange={onContentChange} />
      break
    case 'climate':
      sheet = <ClimateSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
      break
    default:
      sheet = null
  }

  if (!sheet) return null

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      localStorage.setItem(SHEET_COLLAPSED_KEY, String(!c))
      return !c
    })
  }

  return (
    <div className={collapsed ? 'sheet-collapsible sheet-collapsed' : 'sheet-collapsible'}>
      <button type="button" className="sheet-collapse-toggle" onClick={toggleCollapsed}>
        {collapsed ? '▸' : '▾'} Sheet
      </button>
      <div className="sheet-collapsible-body" style={{ display: collapsed ? 'none' : undefined }}>
        {sheet}
      </div>
    </div>
  )
}
