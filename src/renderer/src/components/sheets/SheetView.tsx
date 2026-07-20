import { parseNote } from '../../../../common/frontmatter'
import { PcSheet } from './PcSheet'
import { NpcSheet } from './NpcSheet'
import { ClassReferenceSheet } from './ClassReferenceSheet'

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
    default:
      return null
  }
}
