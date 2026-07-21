import { parseNote } from '../../../../common/frontmatter'
import { PcSheet } from './PcSheet'
import { NpcSheet } from './NpcSheet'
import { ClassReferenceSheet } from './ClassReferenceSheet'
import { SessionSheet } from './SessionSheet'
import { EventSheet } from './EventSheet'
import { FactionSheet } from './FactionSheet'
import { ItemSheet } from './ItemSheet'
import { LocationSheet } from './LocationSheet'

export function SheetView({
  content,
  onContentChange
}: {
  content: string
  onContentChange: (content: string) => void
}): React.JSX.Element | null {
  const { frontmatter } = parseNote(content)
  const type = typeof frontmatter.type === 'string' ? frontmatter.type : undefined

  switch (type) {
    case 'pc':
      return <PcSheet content={content} onContentChange={onContentChange} />
    case 'npc':
      return <NpcSheet content={content} onContentChange={onContentChange} />
    case 'class-reference':
      return <ClassReferenceSheet content={content} onContentChange={onContentChange} />
    case 'session':
      return <SessionSheet content={content} onContentChange={onContentChange} />
    case 'event':
      return <EventSheet content={content} onContentChange={onContentChange} />
    case 'faction':
      return <FactionSheet content={content} onContentChange={onContentChange} />
    case 'item':
      return <ItemSheet content={content} onContentChange={onContentChange} />
    case 'location':
      return <LocationSheet content={content} onContentChange={onContentChange} />
    default:
      return null
  }
}
