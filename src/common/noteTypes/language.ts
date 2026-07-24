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
  meaning: string | null
  partOfSpeech: string | null
  gender: string | null
  content: string
}

export interface GrammarRule {
  name: string
  content: string
}

// "## Word: <word>" marks a dictionary entry, and "## Grammar: <name>" marks
// a named grammar rule — same reasoning as the class-reference "## Level N"
// convention: requiring the literal prefix (not bare "##") means the rest of
// the note can still use ordinary "## Phonology" / "## Grammar Notes" style
// headings without them being mistaken for structured entries. Whitespace
// around "Word"/":" is optional so "##Word:keth" and "## Word: keth" both
// work (a real bug hit with the class-reference version of this pattern).
// "Grammar:" requires the colon (unlike "Word:") specifically so a plain
// "## Grammar Notes" heading — already promised elsewhere to work as an
// ordinary heading — doesn't get misread as a rule named "Notes".
const HEADING_RE = /^##\s*(.*)$/gim
const WORD_HEADING_TEXT_RE = /^Word:?\s*(.+)$/i
const GRAMMAR_HEADING_TEXT_RE = /^Grammar:\s*(.+)$/i

// Optional sub-lines inside a "## Word:" entry's content that give a
// translator (human or Claude, reading the note directly) a structured
// English gloss, part of speech, and grammatical gender to key off, instead
// of having to parse free-text prose. All stay optional — entries without
// them behave exactly as before.
const MEANING_LINE_RE = /^Meaning:\s*(.+)$/im
const POS_LINE_RE = /^(?:POS|Part of Speech):\s*(.+)$/im
const GENDER_LINE_RE = /^Gender:\s*(.+)$/im

interface Heading {
  index: number
  lineEnd: number
  word: string | null // non-null only if this heading is itself a "## Word: ..." heading
  grammar: string | null // non-null only if this heading is itself a "## Grammar: ..." heading
}

function findHeadings(body: string): Heading[] {
  return [...body.matchAll(HEADING_RE)].map((m) => {
    const text = m[1].trim()
    const wordMatch = text.match(WORD_HEADING_TEXT_RE)
    const grammarMatch = text.match(GRAMMAR_HEADING_TEXT_RE)
    return {
      index: m.index!,
      lineEnd: m.index! + m[0].length,
      word: wordMatch ? wordMatch[1].trim() : null,
      grammar: grammarMatch ? grammarMatch[1].trim() : null
    }
  })
}

/**
 * A word entry's content runs up to the NEXT heading of any kind, not just
 * the next "## Word:" heading — otherwise an unrelated section placed
 * between (or after) dictionary entries, like "## Phonology", would get
 * silently absorbed into the previous word's definition instead of being
 * its own section. "Meaning:" and "POS:" sub-lines, if present anywhere in
 * that content, are pulled out into their own fields and removed from the
 * remaining free-text content so they aren't shown twice.
 */
export function parseWordEntries(body: string): WordEntry[] {
  const headings = findHeadings(body)
  const entries: WordEntry[] = []

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    if (heading.word === null || !heading.word) continue
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length
    const raw = body.slice(heading.lineEnd, end).trim()

    const meaningMatch = raw.match(MEANING_LINE_RE)
    const posMatch = raw.match(POS_LINE_RE)
    const genderMatch = raw.match(GENDER_LINE_RE)
    const content = raw
      .replace(MEANING_LINE_RE, '')
      .replace(POS_LINE_RE, '')
      .replace(GENDER_LINE_RE, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    entries.push({
      word: heading.word,
      meaning: meaningMatch ? meaningMatch[1].trim() : null,
      partOfSpeech: posMatch ? posMatch[1].trim() : null,
      gender: genderMatch ? genderMatch[1].trim() : null,
      content
    })
  }

  return entries.sort((a, b) => a.word.localeCompare(b.word))
}

/**
 * Same shape as parseWordEntries but for "## Grammar: <name>" sections —
 * freeform rules (word order, tense/case marking, pluralization, whatever
 * the author wants) named and looked up the same way dictionary words are.
 */
export function parseGrammarRules(body: string): GrammarRule[] {
  const headings = findHeadings(body)
  const rules: GrammarRule[] = []

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    if (heading.grammar === null || !heading.grammar) continue
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length
    rules.push({ name: heading.grammar, content: body.slice(heading.lineEnd, end).trim() })
  }

  return rules
}

/** The complement of parseWordEntries/parseGrammarRules — the body with
 *  every "## Word: ..." and "## Grammar: ..." section removed, leaving
 *  everything else (prose, other headings) in place. Used so Preview
 *  doesn't show the same entries twice: once in a structured panel, once
 *  as raw headings. */
export function stripStructuredSections(body: string): string {
  const headings = findHeadings(body)
  let result = ''
  let cursor = 0

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    if ((heading.word === null || !heading.word) && (heading.grammar === null || !heading.grammar)) continue
    result += body.slice(cursor, heading.index)
    cursor = i + 1 < headings.length ? headings[i + 1].index : body.length
  }
  result += body.slice(cursor)
  return result
}
