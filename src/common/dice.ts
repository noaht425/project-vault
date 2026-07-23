export interface DiceGroup {
  sign: 1 | -1
  count: number
  sides: number
  keep?: { mode: 'kh' | 'kl'; n: number }
  rolls: number[] // every die rolled in this group, before keep-filtering
  kept: number[] // the dice from this group actually summed
}

export interface DiceRollResult {
  id: string
  notation: string
  groups: DiceGroup[] // one per dice term, in the order they appeared
  modifier: number // sum of all flat +/-N terms
  total: number
  rolledAt: number // epoch ms
}

interface ParsedDiceTerm {
  type: 'dice'
  sign: 1 | -1
  count: number
  sides: number
  keep?: { mode: 'kh' | 'kl'; n: number }
}

interface ParsedModifierTerm {
  type: 'modifier'
  sign: 1 | -1
  value: number
}

type ParsedTerm = ParsedDiceTerm | ParsedModifierTerm

const MAX_DICE = 100
const MAX_SIDES = 1000
const MAX_TERMS = 20

// Matches one signed term at a time: a dice group ("2d6", "2d20kh1") or a
// flat number ("3"). Used repeatedly to walk the whole expression left to
// right so "1d12+1d10", "2d6+1d4+3", "4d6kh3-1d4+2" etc. all parse as a
// sequence of terms rather than assuming a single die type.
const TERM_RE = /([+-]?)(\d*d\d+(?:(?:kh|kl)\d+)?|\d+)/gi
const DICE_TERM_RE = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i

function parseDiceExpression(input: string): ParsedTerm[] | null {
  // Only collapse whitespace directly touching a +/- operator ("1d12 + 1d10"
  // -> "1d12+1d10"). Blanket-stripping ALL whitespace would let two terms
  // separated by a bare space but no operator ("1d12 1d10") merge into one
  // malformed token instead of correctly failing to parse.
  const cleaned = input.trim().replace(/\s*([+-])\s*/g, '$1')
  if (!cleaned) return null

  const terms: ParsedTerm[] = []
  let consumedUpTo = 0
  TERM_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = TERM_RE.exec(cleaned))) {
    // A gap between the previous match and this one means there's a
    // character TERM_RE couldn't make sense of — reject rather than
    // silently skip it.
    if (match.index !== consumedUpTo) return null
    consumedUpTo = TERM_RE.lastIndex

    const sign: 1 | -1 = match[1] === '-' ? -1 : 1
    const body = match[2]

    if (/d/i.test(body)) {
      const diceMatch = body.match(DICE_TERM_RE)
      if (!diceMatch) return null
      const count = diceMatch[1] ? parseInt(diceMatch[1], 10) : 1
      const sides = parseInt(diceMatch[2], 10)
      if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) return null
      const keep = diceMatch[3]
        ? { mode: diceMatch[3].toLowerCase() as 'kh' | 'kl', n: parseInt(diceMatch[4], 10) }
        : undefined
      if (keep && (keep.n < 1 || keep.n > count)) return null
      terms.push({ type: 'dice', sign, count, sides, keep })
    } else {
      terms.push({ type: 'modifier', sign, value: parseInt(body, 10) })
    }

    if (terms.length > MAX_TERMS) return null
  }

  if (consumedUpTo !== cleaned.length || terms.length === 0) return null
  return terms
}

/** `rng` is injectable so tests can get deterministic results. */
export function rollDice(input: string, rng: () => number = Math.random): DiceRollResult | null {
  const terms = parseDiceExpression(input)
  if (!terms) return null

  const groups: DiceGroup[] = []
  let modifier = 0
  let total = 0

  for (const term of terms) {
    if (term.type === 'modifier') {
      modifier += term.sign * term.value
      total += term.sign * term.value
      continue
    }

    const rolls = Array.from({ length: term.count }, () => Math.floor(rng() * term.sides) + 1)
    let kept = rolls
    if (term.keep) {
      const sorted = [...rolls].sort((a, b) => b - a)
      kept = term.keep.mode === 'kh' ? sorted.slice(0, term.keep.n) : sorted.slice(-term.keep.n)
    }
    total += term.sign * kept.reduce((sum, r) => sum + r, 0)
    groups.push({ sign: term.sign, count: term.count, sides: term.sides, keep: term.keep, rolls, kept })
  }

  return {
    id: `${Date.now()}-${Math.floor(rng() * 1e9)}`,
    notation: input.trim(),
    groups,
    modifier,
    total,
    rolledAt: Date.now()
  }
}

// Fenced code blocks or inline code spans, captured so bare-dice wrapping
// below can skip over them — imported/scraped notes have no code spans at
// all, but hand-written ones may already wrap dice in backticks, and we
// must never double-wrap those or reach inside a code block.
const CODE_SPAN_RE = /(```[\s\S]*?```|`[^`\n]*`)/g

// A dice-shaped token sitting in plain prose, e.g. "10d12" in a stat block
// pasted/scraped without backticks. The leading \b keeps this from matching
// mid-token (won't fire inside "and20"). The trailing side uses a
// not-followed-by-a-digit lookahead rather than \b, since scraped text
// routinely pluralizes dice ("3d6s of poison damage") — a trailing \b would
// never match there because "6" and "s" are both word characters. The real
// gate against false positives is handing every candidate to rollDice below
// — anything that doesn't round-trip through the same parser used for real
// rolls is left as plain text.
const BARE_DICE_RE = /\b\d{0,3}d\d{1,4}(?:kh\d{1,2}|kl\d{1,2})?(?:\s*[+-]\s*\d{1,4})*(?!\d)/gi

/**
 * Finds dice notation written as plain text (no backticks) and wraps it in
 * backticks so the preview's inline-code renderer picks it up as a
 * clickable roll — without touching text that's already inside a code span.
 */
export function wrapBareDiceInBackticks(text: string): string {
  return text
    .split(CODE_SPAN_RE)
    .map((chunk, i) => {
      // Odd indices are the code spans captured by CODE_SPAN_RE's group —
      // leave those exactly as written.
      if (i % 2 === 1) return chunk
      return chunk.replace(BARE_DICE_RE, (match) => (rollDice(match) ? `\`${match}\`` : match))
    })
    .join('')
}
