import { z } from 'zod'

export const classReferenceFrontmatterSchema = z
  .object({
    type: z.literal('class-reference'),
    tags: z.array(z.string()).catch([]),
    class: z.string().catch(''),
    subclass: z.string().catch('')
  })
  .passthrough()

export type ClassReferenceFrontmatter = z.infer<typeof classReferenceFrontmatterSchema>

export function defaultClassReferenceFrontmatter(): ClassReferenceFrontmatter {
  return classReferenceFrontmatterSchema.parse({ type: 'class-reference' })
}

export interface ClassReferenceLevel {
  level: number
  content: string
}

// Only "##" + "Level" + a number is required — whitespace around them is
// optional ("##Level 10" and "## Level 10" both match), and anything else
// on the line (": Extra Attack", " | Improved Critical", etc.) is allowed
// and ignored. A heading that didn't match used to silently fall through
// and get swallowed into whatever the previous recognized level was —
// exactly what happened with a real file mixing "## Level 7" and
// "##Level 10" (no space) headings.
const LEVEL_HEADING_RE = /^##\s*Level\s*(\d+)\b.*$/gim

/**
 * Convention: a "## Level N ..." heading starts that level's section;
 * everything up to the next "## Level" heading (or end of the note)
 * belongs to it. Deliberately simple (no sub-parsing of individual
 * feature names) so users can paste in whatever formatting they want
 * under each level.
 */
export function parseClassReferenceLevels(body: string): ClassReferenceLevel[] {
  const matches = [...body.matchAll(LEVEL_HEADING_RE)]
  const levels: ClassReferenceLevel[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const level = Number(match[1])
    const start = match.index! + match[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length
    levels.push({ level, content: body.slice(start, end).trim() })
  }

  return levels.sort((a, b) => a.level - b.level)
}
