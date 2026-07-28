import { parseNote } from '../../../../common/frontmatter'
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
import { CalendarSheet } from './CalendarSheet'

export function SheetView({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  /** Only PcSheet (class-reference lookup), EventSheet (location field), MapSheet
   *  (pin placement), and FamilyTreeSheet (click-to-open diagram nodes) need this —
   *  everything else is a plain form with no note-to-note resolution. */
  noteRefApi: NoteRefApi
}): React.JSX.Element | null {
  const { frontmatter } = parseNote(content)
  const type = typeof frontmatter.type === 'string' ? frontmatter.type : undefined

  switch (type) {
    case 'pc':
      return <PcSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
    case 'npc':
      return <NpcSheet content={content} onContentChange={onContentChange} />
    case 'class-reference':
      return <ClassReferenceSheet content={content} onContentChange={onContentChange} />
    case 'session':
      return <SessionSheet content={content} onContentChange={onContentChange} />
    case 'event':
      return <EventSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
    case 'faction':
      return <FactionSheet content={content} onContentChange={onContentChange} />
    case 'item':
      return <ItemSheet content={content} onContentChange={onContentChange} />
    case 'location':
      return <LocationSheet content={content} onContentChange={onContentChange} />
    case 'language':
      return <LanguageSheet content={content} onContentChange={onContentChange} />
    case 'family-tree':
      return <FamilyTreeSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
    case 'map':
      return <MapSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
    case 'settlement':
      return <SettlementSheet content={content} onContentChange={onContentChange} noteRefApi={noteRefApi} />
    case 'calendar':
      return <CalendarSheet content={content} onContentChange={onContentChange} />
    default:
      return null
  }
}
