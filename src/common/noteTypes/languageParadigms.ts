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

// A hyphen's position, not its mere presence, says which end of the word an
// ending attaches to: "-re" (hyphen first) attaches at the end — a suffix.
// "re-" (hyphen last) attaches at the start — a prefix. A value with a
// hyphen on both ends, or neither, has no clear direction and falls back to
// a suffix, matching every ending written before this convention existed.
export interface Affix {
  kind: 'prefix' | 'suffix'
  text: string
}

function parseAffix(raw: string): Affix {
  const leading = raw.startsWith('-')
  const trailing = raw.length > 1 && raw.endsWith('-')
  if (trailing && !leading) return { kind: 'prefix', text: raw.slice(0, -1) }
  return { kind: 'suffix', text: leading ? raw.slice(1) : raw }
}

function stripAffix(word: string, affix: Affix): string | null {
  if (affix.kind === 'suffix') {
    return word.endsWith(affix.text) ? word.slice(0, word.length - affix.text.length) : null
  }
  return word.startsWith(affix.text) ? word.slice(affix.text.length) : null
}

// "## Grammar: Vowel Combinations" describes what happens when an
// attachment puts two vowels next to each other — e.g. "a + o = ω" — plus
// contextual follow-up rules like "When followed by a consonant, y changes
// to u". Both are plain prose lines, not tables, so they're parsed
// separately from parseMarkdownTables.
export interface VowelCombinationRules {
  // left vowel -> right vowel -> combined result. Order matters — "a + o"
  // and "o + a" are independent entries, not automatically symmetric.
  pairs: Record<string, Record<string, string>>
  // vowel -> replacement, applied only when that vowel is immediately
  // followed by a consonant (anything not in the derived vowel set below).
  beforeConsonant: Record<string, string>
}

const VOWEL_PAIR_LINE_RE = /^(\S+)\s*\+\s*(\S+)\s*=\s*(\S+)\s*$/gm
const BEFORE_CONSONANT_RE = /When followed by a consonant,\s*(\S+)\s*changes to\s*(\S+)/gi

export function parseVowelCombinationRules(grammarRuleContent: string): VowelCombinationRules | null {
  const pairs: VowelCombinationRules['pairs'] = {}
  for (const [, left, right, result] of grammarRuleContent.matchAll(VOWEL_PAIR_LINE_RE)) {
    pairs[left] ??= {}
    pairs[left][right] = result
  }

  const beforeConsonant: VowelCombinationRules['beforeConsonant'] = {}
  for (const [, from, to] of grammarRuleContent.matchAll(BEFORE_CONSONANT_RE)) {
    beforeConsonant[from] = to
  }

  if (Object.keys(pairs).length === 0 && Object.keys(beforeConsonant).length === 0) return null
  return { pairs, beforeConsonant }
}

// "Vowel" here means "known to the rules," derived from the rules
// themselves rather than a hardcoded a/e/i/o/u — a language isn't
// restricted to those five symbols.
function knownVowels(rules: VowelCombinationRules): Set<string> {
  const vowels = new Set<string>()
  for (const [left, rightMap] of Object.entries(rules.pairs)) {
    vowels.add(left)
    for (const right of Object.keys(rightMap)) vowels.add(right)
  }
  for (const vowel of Object.keys(rules.beforeConsonant)) vowels.add(vowel)
  return vowels
}

// Only the single character on either side of the join is checked — these
// rules describe what happens where two pieces meet, not a general
// phonological rewrite of the whole word.
function joinWithVowelCombination(left: string, right: string, rules: VowelCombinationRules | null): string {
  if (!rules || left.length === 0 || right.length === 0) return left + right
  const combined = rules.pairs[left[left.length - 1]]?.[right[0]]
  if (combined === undefined) return left + right
  return left.slice(0, -1) + combined + right.slice(1)
}

function applyBeforeConsonantRules(word: string, rules: VowelCombinationRules): string {
  if (Object.keys(rules.beforeConsonant).length === 0) return word
  const vowels = knownVowels(rules)
  let result = ''
  for (let i = 0; i < word.length; i++) {
    const next = word[i + 1]
    const replacement = rules.beforeConsonant[word[i]]
    result += replacement !== undefined && next !== undefined && !vowels.has(next) ? replacement : word[i]
  }
  return result
}

function finalizeForm(form: string, vowelRules: VowelCombinationRules | null): string {
  return vowelRules ? applyBeforeConsonantRules(form, vowelRules) : form
}

function attachAffix(stem: string, affix: Affix, vowelRules: VowelCombinationRules | null = null): string {
  return affix.kind === 'suffix'
    ? joinWithVowelCombination(stem, affix.text, vowelRules)
    : joinWithVowelCombination(affix.text, stem, vowelRules)
}

function hasAffix(word: string, affix: Affix): boolean {
  return affix.kind === 'suffix' ? word.endsWith(affix.text) : word.startsWith(affix.text)
}

function tableToNestedRecord(table: ParsedTable): Record<string, Record<string, Affix>> {
  const result: Record<string, Record<string, Affix>> = {}
  for (const [rowKey, values] of Object.entries(table.rows)) {
    const byColumn: Record<string, Affix> = {}
    table.columns.forEach((column, idx) => {
      if (values[idx] !== undefined) byColumn[column] = parseAffix(values[idx])
    })
    result[rowKey] = byColumn
  }
  return result
}

function tableToPlainNestedRecord(table: ParsedTable): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  for (const [rowKey, values] of Object.entries(table.rows)) {
    const byColumn: Record<string, string> = {}
    table.columns.forEach((column, idx) => {
      if (values[idx] !== undefined) byColumn[column] = values[idx]
    })
    result[rowKey] = byColumn
  }
  return result
}

export interface NounParadigm {
  // gender label (as given, e.g. "Masculine") -> case -> number -> ending
  genders: Record<string, Record<string, Record<string, Affix>>>
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
  infinitive: Affix
  // tense label (e.g. "Present") -> person -> number -> ending
  tenses: Record<string, Record<string, Record<string, Affix>>>
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
  return { infinitive: parseAffix(infMatch[1].trim()), tenses }
}

export interface PronounParadigm {
  // person -> number -> pronoun (plain text, not an Affix — a pronoun is a
  // whole word, not something attached to one)
  persons: Record<string, Record<string, string>>
}

export function parsePronounParadigm(grammarRuleContent: string): PronounParadigm | null {
  const [table] = parseMarkdownTables(grammarRuleContent)
  if (!table) return null
  return { persons: tableToPlainNestedRecord(table) }
}

export interface DeclineResult {
  form: string
  // True when the citation form didn't carry the expected nominative
  // singular marker for its gender — per "Grammar: Irregular Nouns," the
  // target ending is attached straight onto the given form instead of
  // replacing a stripped one, unless the form already carries the target
  // ending (in which case nothing changes).
  irregular: boolean
}

/**
 * gender must be whatever the word's own dictionary entry declares (an
 * irregular noun's entry is expected to already say "Neuter" per the
 * language's own irregular-noun rule) — this function detects irregularity
 * by checking whether the citation form actually carries that gender's
 * regular nominative-singular marker, it doesn't re-derive gender itself.
 * The nominative-singular marker and the target case/number's marker are
 * each independently a prefix or suffix — a language can strip a suffixed
 * citation form and attach a prefixed ending, or any other combination.
 * vowelRules, if given, is applied at the stem/ending join and as a final
 * pass over the result (for contextual follow-up rules like "y before a
 * consonant becomes u") — omit it to get the plain concatenation.
 */
export function declineNoun(
  paradigm: NounParadigm,
  citationForm: string,
  gender: string,
  targetCase: string,
  targetNumber: string,
  vowelRules: VowelCombinationRules | null = null
): DeclineResult | null {
  const cases = paradigm.genders[gender]
  if (!cases) return null
  const nominativeSingular = cases['Nominative']?.['Singular']
  const targetEnding = cases[targetCase]?.[targetNumber]
  if (!nominativeSingular || targetEnding === undefined) return null

  const stem = stripAffix(citationForm, nominativeSingular)
  if (stem !== null) {
    return { form: finalizeForm(attachAffix(stem, targetEnding, vowelRules), vowelRules), irregular: false }
  }

  if (hasAffix(citationForm, targetEnding)) {
    return { form: citationForm, irregular: true }
  }
  return {
    form: finalizeForm(attachAffix(citationForm, targetEnding, vowelRules), vowelRules),
    irregular: true
  }
}

/**
 * Always strips the ACTIVE infinitive marker to find the root, even when
 * conjugating the passive — dictionary entries are given in active
 * infinitive form (e.g. "Fasilis"), not "Fasilissa", so that's the only
 * marker that's actually present on the word being looked up. vowelRules
 * behaves the same as in declineNoun.
 */
export function conjugateVerb(
  activeParadigm: VerbParadigm,
  targetParadigm: VerbParadigm,
  citationForm: string,
  tense: string,
  person: string,
  number: string,
  vowelRules: VowelCombinationRules | null = null
): string | null {
  const root = stripAffix(citationForm, activeParadigm.infinitive)
  if (root === null) return null
  const ending = targetParadigm.tenses[tense]?.[person]?.[number]
  if (ending === undefined) return null
  return finalizeForm(attachAffix(root, ending, vowelRules), vowelRules)
}
