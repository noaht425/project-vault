// Sorts free-text in-world dates (see noteTypes/event.ts — there's no real
// ISO date to anchor these to, since these are fictional dates) into
// chronological order. Two calendars are in use, sharing the same AF
// (counts down like BCE) / AM (counts up like CE) year numbering: the main
// one (Aucaela/Auctera/Morcaela/Mortera, 100 days each) and the Kingdom of
// Krotaphos's own 12-month calendar (variable month lengths, used only in
// dates about that kingdom). An omitted AM/AF suffix (seen on a few dates
// that follow an already-AM date) defaults to AM.
//
// Parsing is best-effort: this is freeform author text, not a validated
// format, so anything that doesn't match a recognized shape returns null
// and the caller should leave the entry undated rather than guess.

const MAIN_MONTHS = ['Aucaela', 'Auctera', 'Morcaela', 'Mortera']
const MAIN_MONTH_LENGTH = 100
const MAIN_YEAR_LENGTH = MAIN_MONTHS.length * MAIN_MONTH_LENGTH // 400

const KROTAPHOS_MONTHS: [name: string, days: number][] = [
  ['Blython', 30],
  ['Neemon', 29],
  ['Veriton', 28],
  ['Pavlon', 27],
  ['Themon', 26],
  ['Gwenon', 25],
  ['Belphala', 30],
  ['Abala', 29],
  ['Tiyala', 28],
  ['Lukala', 27],
  ['Archala', 26],
  ['Lilia', 25]
]
const KROTAPHOS_YEAR_LENGTH = KROTAPHOS_MONTHS.reduce((sum, [, days]) => sum + days, 0) // 330

interface MonthPosition {
  dayOfYear: number // 1-based
  yearLength: number
}

function findMonth(monthName: string, day: number): MonthPosition | null {
  const lower = monthName.toLowerCase()

  let offset = 0
  for (const m of MAIN_MONTHS) {
    if (m.toLowerCase() === lower) return { dayOfYear: offset + day, yearLength: MAIN_YEAR_LENGTH }
    offset += MAIN_MONTH_LENGTH
  }

  offset = 0
  for (const [m, days] of KROTAPHOS_MONTHS) {
    if (m.toLowerCase() === lower) return { dayOfYear: offset + day, yearLength: KROTAPHOS_YEAR_LENGTH }
    offset += days
  }

  return null
}

interface WorldPoint {
  era: 'AM' | 'AF'
  year: number
  dayOfYear: number // 1-based, scaled onto MAIN_YEAR_LENGTH regardless of source calendar
}

// "<day> <Month>, <year> [AM|AF]" — the era suffix is optional (defaults to AM).
const FULL_DATE_RE = /(\d+)\s+([A-Za-z]+),?\s*(\d[\d,]*)\s*(AM|AF)?/i
// Bare "<year> [AM|AF]", for dates with no month/day given.
const BARE_YEAR_RE = /(\d[\d,]*)\s*(AM|AF)?/i
// Compact range shorthand like "39-10 AF" — two bare years sharing one era suffix.
const COMPACT_RANGE_RE = /^(\d[\d,]*)-(\d[\d,]*)\s*(AM|AF)/i
const RANGE_SPLIT_RE = /\s[–—-]\s/

function parsePoint(text: string): WorldPoint | null {
  const full = text.match(FULL_DATE_RE)
  if (full) {
    const day = Number(full[1])
    const year = Number(full[3].replace(/,/g, ''))
    const era = (full[4]?.toUpperCase() as 'AM' | 'AF' | undefined) ?? 'AM'
    const found = findMonth(full[2], day)
    if (found) {
      // Scale onto the main calendar's day count so a Krotaphos date (a
      // different number of days per year) still compares sensibly against
      // one from the main calendar — both represent the same span of real
      // time, just divided into months differently.
      const scaledDay = Math.round(((found.dayOfYear - 1) / found.yearLength) * MAIN_YEAR_LENGTH) + 1
      return { era, year, dayOfYear: scaledDay }
    }
    // Month name didn't match either calendar (typo, or one this parser
    // doesn't know) — the day/month regex still isolated a real year and
    // era, so use those at coarse (start-of-year) precision instead of
    // treating the whole date as unparseable and dropping it to the end
    // of the timeline.
    return { era, year, dayOfYear: 1 }
  }

  const bare = text.match(BARE_YEAR_RE)
  if (bare) {
    const year = Number(bare[1].replace(/,/g, ''))
    const era = (bare[2]?.toUpperCase() as 'AM' | 'AF' | undefined) ?? 'AM'
    return { era, year, dayOfYear: 1 }
  }

  return null
}

function epoch(point: WorldPoint): number {
  return point.era === 'AM'
    ? (point.year - 1) * MAIN_YEAR_LENGTH + (point.dayOfYear - 1)
    : -(point.year * MAIN_YEAR_LENGTH) + (point.dayOfYear - 1)
}

/**
 * Returns a sortable number for the START of a date (ranges sort by when
 * they begin), or null if the text doesn't match a recognized shape.
 */
export function parseWorldDateStart(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const rangeParts = trimmed.split(RANGE_SPLIT_RE)
  if (rangeParts.length > 1) {
    const point = parsePoint(rangeParts[0])
    return point ? epoch(point) : null
  }

  const compact = trimmed.match(COMPACT_RANGE_RE)
  if (compact) {
    const year = Number(compact[1].replace(/,/g, ''))
    const era = compact[3].toUpperCase() as 'AM' | 'AF'
    return epoch({ era, year, dayOfYear: 1 })
  }

  const point = parsePoint(trimmed)
  return point ? epoch(point) : null
}

/**
 * Comparator for sorting entries by their free-text world date. Entries
 * that parse successfully sort chronologically (ties broken by the raw
 * string so identical dates stay stably ordered); entries that don't parse
 * (empty, or a shape this parser doesn't recognize) sort after every dated
 * entry, then alphabetically among themselves.
 */
export function compareWorldDates(a: string, b: string): number {
  const ea = parseWorldDateStart(a)
  const eb = parseWorldDateStart(b)
  if (ea !== null && eb !== null) return ea - eb || a.localeCompare(b)
  if (ea !== null) return -1
  if (eb !== null) return 1
  return a.localeCompare(b)
}

export interface WorldDateRawComponents {
  // Absent (not just typo'd) whenever the text gave no month at all (a
  // bare year, or the compact "39-10 AF" range shorthand) — a typo'd month
  // name that matched neither calendar still comes through here as-is
  // (unlike parsePoint's dayOfYear, which silently falls back to 1 in that
  // case): the calendar/timeline migration (see
  // docs/plans/2026-07-28-calendar-timeline-system.md, build step 5) needs
  // the RAW name to attempt a match against a user-defined calendar note's
  // own month list, not this file's hardcoded MAIN_MONTHS/KROTAPHOS_MONTHS.
  monthName: string | null
  day: number | null
  year: number
  era: 'AM' | 'AF'
}

/**
 * Same parsing as parseWorldDateStart, but returns the raw month name/day
 * instead of a scaled/sorted epoch number — for the calendar/timeline
 * migration, which needs to look an actual month up by name in a
 * user-defined calendar note, not just sort against this file's own
 * hardcoded calendars. Returns null under the same conditions
 * parseWorldDateStart does (empty text, or a shape this parser doesn't
 * recognize at all).
 */
export function parseWorldDateRaw(text: string): WorldDateRawComponents | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const rangeParts = trimmed.split(RANGE_SPLIT_RE)
  const candidate = rangeParts.length > 1 ? rangeParts[0] : trimmed

  const full = candidate.match(FULL_DATE_RE)
  if (full) {
    return {
      monthName: full[2],
      day: Number(full[1]),
      year: Number(full[3].replace(/,/g, '')),
      era: (full[4]?.toUpperCase() as 'AM' | 'AF' | undefined) ?? 'AM'
    }
  }

  const compact = candidate.match(COMPACT_RANGE_RE)
  if (compact) {
    return { monthName: null, day: null, year: Number(compact[1].replace(/,/g, '')), era: compact[3].toUpperCase() as 'AM' | 'AF' }
  }

  const bare = candidate.match(BARE_YEAR_RE)
  if (bare) {
    return {
      monthName: null,
      day: null,
      year: Number(bare[1].replace(/,/g, '')),
      era: (bare[2]?.toUpperCase() as 'AM' | 'AF' | undefined) ?? 'AM'
    }
  }

  return null
}
