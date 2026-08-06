// Turns the GFM tables already living inside a language note's
// "## Grammar: Nouns" / "## Grammar: Verbs (Active/Passive)" /
// "## Grammar: Pronouns (Subject/Object)" sections into structured paradigm
// data, then applies that data to actually decline a noun or conjugate a
// verb. No new authoring format — these are the exact tables a language
// author already writes for GrammarRulesPanel to render; this just also
// reads them as data.

export interface ParsedTable {
  // The nearest preceding non-blank line before the table, trailing colon
  // stripped (e.g. "Masculine:" -> "Masculine") — null if the table is the
  // first thing in its section, as with a bare pronoun table.
  label: string | null
  columns: string[]
  rows: Record<string, string[]>
}

const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/
const SEPARATOR_CELL_RE = /^:?-{1,}:?$/

function splitRow(line: string): string[] {
  const match = line.match(TABLE_ROW_RE)
  if (!match) return []
  return match[1].split('|').map((cell) => cell.trim())
}

function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell))
}

export function parseMarkdownTables(content: string): ParsedTable[] {
  const lines = content.split('\n')
  const tables: ParsedTable[] = []
  let pendingLabel: string | null = null

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const headerCells = splitRow(line)
    const isHeader = headerCells.length > 0 && i + 1 < lines.length && isSeparatorRow(lines[i + 1])

    if (isHeader) {
      const columns = headerCells.slice(1)
      const rows: Record<string, string[]> = {}
      let j = i + 2
      while (j < lines.length) {
        const cells = splitRow(lines[j])
        if (cells.length === 0) break
        rows[cells[0]] = cells.slice(1)
        j++
      }
      tables.push({ label: pendingLabel, columns, rows })
      pendingLabel = null
      i = j
      continue
    }

    if (line.trim().length > 0) {
      pendingLabel = line.trim().replace(/:\s*$/, '')
    }
    i++
  }

  return tables
}

// Endings are written "-is", "-um", etc. in the markdown — the leading
// hyphen is a notational "this is a suffix" marker, not a literal
// character that belongs in the concatenated word.
function stripLeadingHyphen(value: string): string {
  return value.replace(/^-/, '')
}

function tableToNestedRecord(table: ParsedTable): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  for (const [rowKey, values] of Object.entries(table.rows)) {
    const byColumn: Record<string, string> = {}
    table.columns.forEach((column, idx) => {
      if (values[idx] !== undefined) byColumn[column] = stripLeadingHyphen(values[idx])
    })
    result[rowKey] = byColumn
  }
  return result
}

export interface NounParadigm {
  // gender label (as given, e.g. "Masculine") -> case -> number -> ending
  genders: Record<string, Record<string, Record<string, string>>>
}

export function parseNounParadigm(grammarRuleContent: string): NounParadigm | null {
  const genders: NounParadigm['genders'] = {}
  for (const table of parseMarkdownTables(grammarRuleContent)) {
    if (!table.label) continue
    genders[table.label] = tableToNestedRecord(table)
  }
  return Object.keys(genders).length > 0 ? { genders } : null
}

export interface VerbParadigm {
  infinitive: string
  // tense label (e.g. "Present") -> person -> number -> ending
  tenses: Record<string, Record<string, Record<string, string>>>
}

const INFINITIVE_LINE_RE = /^Infinitive:\s*(\S+)/im

export function parseVerbParadigm(grammarRuleContent: string): VerbParadigm | null {
  const infMatch = grammarRuleContent.match(INFINITIVE_LINE_RE)
  if (!infMatch) return null

  const tenses: VerbParadigm['tenses'] = {}
  for (const table of parseMarkdownTables(grammarRuleContent)) {
    if (!table.label) continue
    tenses[table.label.replace(/\s*Tense$/i, '')] = tableToNestedRecord(table)
  }
  if (Object.keys(tenses).length === 0) return null
  return { infinitive: stripLeadingHyphen(infMatch[1].trim()), tenses }
}

export interface PronounParadigm {
  // person -> number -> pronoun
  persons: Record<string, Record<string, string>>
}

export function parsePronounParadigm(grammarRuleContent: string): PronounParadigm | null {
  const [table] = parseMarkdownTables(grammarRuleContent)
  if (!table) return null
  return { persons: tableToNestedRecord(table) }
}

export interface DeclineResult {
  form: string
  // True when the citation form didn't end in the expected nominative
  // singular suffix for its gender — per "Grammar: Irregular Nouns," the
  // target ending is appended straight onto the given form instead of
  // replacing a stripped suffix, unless the form already ends with the
  // target ending (in which case nothing changes).
  irregular: boolean
}

/**
 * gender must be whatever the word's own dictionary entry declares (an
 * irregular noun's entry is expected to already say "Neuter" per the
 * language's own irregular-noun rule) — this function detects irregularity
 * by checking whether the citation form actually carries that gender's
 * regular nominative-singular ending, it doesn't re-derive gender itself.
 */
export function declineNoun(
  paradigm: NounParadigm,
  citationForm: string,
  gender: string,
  targetCase: string,
  targetNumber: string
): DeclineResult | null {
  const cases = paradigm.genders[gender]
  if (!cases) return null
  const nominativeSingular = cases['Nominative']?.['Singular']
  const targetEnding = cases[targetCase]?.[targetNumber]
  if (!nominativeSingular || targetEnding === undefined) return null

  if (citationForm.endsWith(nominativeSingular)) {
    const stem = citationForm.slice(0, -nominativeSingular.length)
    return { form: stem + targetEnding, irregular: false }
  }

  if (citationForm.endsWith(targetEnding)) {
    return { form: citationForm, irregular: true }
  }
  return { form: citationForm + targetEnding, irregular: true }
}

/**
 * Always strips the ACTIVE infinitive marker to find the root, even when
 * conjugating the passive — dictionary entries are given in active
 * infinitive form (e.g. "Fasilis"), not "Fasilissa", so that's the only
 * marker that's actually present on the word being looked up.
 */
export function conjugateVerb(
  activeParadigm: VerbParadigm,
  targetParadigm: VerbParadigm,
  citationForm: string,
  tense: string,
  person: string,
  number: string
): string | null {
  if (!citationForm.endsWith(activeParadigm.infinitive)) return null
  const root = citationForm.slice(0, -activeParadigm.infinitive.length)
  const ending = targetParadigm.tenses[tense]?.[person]?.[number]
  if (ending === undefined) return null
  return root + ending
}
