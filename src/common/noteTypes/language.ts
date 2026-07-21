import { z } from 'zod'

export const languageFrontmatterSchema = z
  .object({
    type: z.literal('language'),
    tags: z.array(z.string()).catch([]),
    summary: z.string().catch('')
  })
  .passthrough()

export type LanguageFrontmatter = z.infer<typeof languageFrontmatterSchema>

export function defaultLanguageFrontmatter(): LanguageFrontmatter {
  return languageFrontmatterSchema.parse({ type: 'language' })
}

export interface WordEntry {
  word: string
  content: string
}

// "## Word: <word>" marks a dictionary entry. Requiring the literal "Word:"
// prefix (not bare "##") — same reasoning as the class-reference
// "## Level N" convention — means the rest of the note can still use
// ordinary "## Phonology" / "## Grammar Notes" style headings without them
// being mistaken for dictionary entries. Whitespace around "Word"/":" is
// optional so "##Word:keth" and "## Word: keth" both work (a real bug hit
// with the class-reference version of this pattern).
const HEADING_RE = /^##\s*(.*)$/gim
const WORD_HEADING_TEXT_RE = /^Word:?\s*(.+)$/i

interface Heading {
  index: number
  lineEnd: number
  word: string | null // non-null only if this heading is itself a "## Word: ..." heading
}

function findHeadings(body: string): Heading[] {
  return [...body.matchAll(HEADING_RE)].map((m) => {
    const wordMatch = m[1].trim().match(WORD_HEADING_TEXT_RE)
    return { index: m.index!, lineEnd: m.index! + m[0].length, word: wordMatch ? wordMatch[1].trim() : null }
  })
}

/**
 * A word entry's content runs up to the NEXT heading of any kind, not just
 * the next "## Word:" heading — otherwise an unrelated section placed
 * between (or after) dictionary entries, like "## Phonology", would get
 * silently absorbed into the previous word's definition instead of being
 * its own section.
 */
export function parseWordEntries(body: string): WordEntry[] {
  const headings = findHeadings(body)
  const entries: WordEntry[] = []

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    if (heading.word === null || !heading.word) continue
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length
    entries.push({ word: heading.word, content: body.slice(heading.lineEnd, end).trim() })
  }

  return entries.sort((a, b) => a.word.localeCompare(b.word))
}

/** The complement of parseWordEntries — the body with every "## Word: ..."
 *  section removed, leaving everything else (prose, other headings) in
 *  place. Used so Preview doesn't show the same dictionary entries twice:
 *  once in the structured Dictionary panel, once as raw headings. */
export function stripWordEntries(body: string): string {
  const headings = findHeadings(body)
  let result = ''
  let cursor = 0

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    if (heading.word === null || !heading.word) continue
    result += body.slice(cursor, heading.index)
    cursor = i + 1 < headings.length ? headings[i + 1].index : body.length
  }
  result += body.slice(cursor)
  return result
}
