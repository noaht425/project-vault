// Canonical-timestamp conversion for user-defined calendar notes (see
// docs/plans/2026-07-28-calendar-timeline-system.md, build step 3). The
// architecture decision that doc confirms: a single continuous integer
// (minutes since an arbitrary shared epoch) is the substrate every dated
// thing is actually stored as, with each calendar note acting as a pure
// formatter/parser layer on top — same principle a Julian day number plays
// for real-world Gregorian/Islamic/Hebrew conversion. This file is that
// layer: canonical minutes <-> a specific calendar's (era, year, month, day,
// hour, minute) representation.
//
// "Epoch" here means canonical minute 0 = the instant a calendar's first
// `direction: 'up'` era's year 1, month[0], day 1, hour 0, minute 0 begins.
// A `direction: 'down'` era's year 1 is the year immediately BEFORE that
// (no year zero — same convention real-world BCE/CE uses, and the same one
// worldDate.ts's existing epoch() already encodes for AM/AF). Two calendars
// that both anchor their own year-1 to this same point (true of the user's
// own Age of the Many/Few + Krotaphos, which the plan doc confirms share
// year numbering) automatically end up mutually convertible with no extra
// alignment field needed.
//
// If a calendar defines more than one 'up' era (or more than one 'down'
// era) — unusual, but the schema doesn't forbid it — the FIRST one in
// `eras` order is used when going canonical-minutes -> calendar date. This
// is a deliberate, simple tie-break, not an oversight.

import type { CalendarFrontmatter, CalendarEra, LeapYearRule } from './noteTypes/calendar'

export interface CalendarDateParts {
  eraId: string
  year: number // 1-based, never 0 — matches real-world BCE/CE convention
  monthId: string
  day: number // 1-based
  hour: number
  minute: number
}

function baseYearLengthDays(calendar: CalendarFrontmatter): number {
  return calendar.months.reduce((sum, m) => sum + m.days, 0)
}

function minutesPerDay(calendar: CalendarFrontmatter): number {
  return calendar.hoursPerDay * calendar.minutesPerHour
}

// True if `year` (a 1-based year number within whichever era it belongs to
// — the rule doesn't distinguish era, only the numeral) is a leap year per
// `rule`'s Gregorian-style interval/exception/exception-to-the-exception
// shape (see noteTypes/calendar.ts's leapYearRuleSchema comment).
export function isLeapYear(rule: LeapYearRule | null, year: number): boolean {
  if (!rule || rule.intervalYears <= 0) return false
  if (year % rule.intervalYears !== 0) return false
  if (rule.exceptionEveryYears && year % rule.exceptionEveryYears === 0) {
    return rule.exceptionToExceptionEveryYears !== null && year % rule.exceptionToExceptionEveryYears === 0
  }
  return true
}

export function yearLengthDays(calendar: CalendarFrontmatter, year: number): number {
  const base = baseYearLengthDays(calendar)
  return isLeapYear(calendar.leapYearRule, year) ? base + calendar.leapYearRule!.extraDays : base
}

/**
 * How many days `monthId` actually has in `year` — its base length, plus the
 * leap rule's extraDays if this specific month is the leap rule's target AND
 * `year` is a leap year. Returns null if `monthId` doesn't exist on this
 * calendar. Needed because toCanonicalMinutes doesn't validate day-in-range
 * itself (see its own comment) — a recurring event landing on, e.g., Feb 29
 * needs this to know that day doesn't exist in a non-leap year, rather than
 * silently spilling into March's date range for that year.
 */
export function daysInMonthForYear(calendar: CalendarFrontmatter, monthId: string, year: number): number | null {
  const month = calendar.months.find((m) => m.id === monthId)
  if (!month) return null
  const leap = isLeapYear(calendar.leapYearRule, year)
  const extra = leap && calendar.leapYearRule?.monthId === monthId ? calendar.leapYearRule.extraDays : 0
  return month.days + extra
}

// Total leap days contributed by every leap year in [1, year-1] — closed
// form, no loop, the exact same "floor division" trick real Gregorian
// day-count algorithms use (days = 365y + floor(y/4) - floor(y/100) +
// floor(y/400)), generalized to arbitrary interval/exception/exception-to-
// exception values and an extraDays multiplier instead of a fixed +1.
function extraLeapDaysBeforeYear(rule: LeapYearRule | null, year: number): number {
  if (!rule || rule.intervalYears <= 0 || year <= 1) return 0
  const upTo = year - 1
  const div = (n: number, d: number): number => Math.floor(n / d)
  let count = div(upTo, rule.intervalYears)
  if (rule.exceptionEveryYears) {
    count -= div(upTo, rule.exceptionEveryYears)
    if (rule.exceptionToExceptionEveryYears) {
      count += div(upTo, rule.exceptionToExceptionEveryYears)
    }
  }
  return count * rule.extraDays
}

// 0-based day-of-year each month starts on, within the specific `year`
// given (so a leap day inserted into an earlier month shifts every later
// month's offset for THAT year only). A standalone leap day (`monthId:
// null` on the rule) isn't part of any month, so it doesn't appear here —
// it only ever affects yearLengthDays/cross-year math, never a month's own
// day range.
function monthStartOffsets(calendar: CalendarFrontmatter, year: number): number[] {
  const leap = isLeapYear(calendar.leapYearRule, year)
  const leapMonthId = leap ? calendar.leapYearRule?.monthId ?? null : null
  const extraDays = calendar.leapYearRule?.extraDays ?? 0
  const offsets: number[] = []
  let running = 0
  for (const month of calendar.months) {
    offsets.push(running)
    running += month.days + (leapMonthId === month.id ? extraDays : 0)
  }
  return offsets
}

// 0-based signed index of `year` within `era`'s direction, relative to
// canonical epoch (era-agnostic: up year 1 -> 0, up year 2 -> 1, ...; down
// year 1 -> -1, down year 2 -> -2, ...).
function absoluteYearIndex(era: CalendarEra, year: number): number {
  return era.direction === 'up' ? year - 1 : -year
}

// Closed-form total days from canonical epoch (day 0) to the START of the
// year at `index` — handles both directions symmetrically by translating
// each back into "how many full years of real year-numbers separate this
// from epoch," then summing base-length-times-count plus the exact leap-day
// contribution via extraLeapDaysBeforeYear (no iteration either direction).
function daysFromEpochToYearStart(calendar: CalendarFrontmatter, index: number): number {
  const base = baseYearLengthDays(calendar)
  if (index >= 0) {
    return index * base + extraLeapDaysBeforeYear(calendar.leapYearRule, index + 1)
  }
  const m = -index
  return -(m * base + extraLeapDaysBeforeYear(calendar.leapYearRule, m + 1))
}

/** Converts a calendar-specific date into canonical minutes, or null if the
 * era/month don't exist on this calendar. */
export function toCanonicalMinutes(calendar: CalendarFrontmatter, parts: CalendarDateParts): number | null {
  const era = calendar.eras.find((e) => e.id === parts.eraId)
  if (!era) return null
  const monthIndex = calendar.months.findIndex((m) => m.id === parts.monthId)
  if (monthIndex === -1) return null

  const index = absoluteYearIndex(era, parts.year)
  const daysToYearStart = daysFromEpochToYearStart(calendar, index)
  const dayOfYear0 = monthStartOffsets(calendar, parts.year)[monthIndex] + (parts.day - 1)
  const totalDays = daysToYearStart + dayOfYear0

  return totalDays * minutesPerDay(calendar) + parts.hour * calendar.minutesPerHour + parts.minute
}

/** Converts canonical minutes into this calendar's date, or null if the
 * calendar has no era covering that direction (e.g. only a 'down' era
 * defined, but the timestamp falls at/after epoch). */
export function fromCanonicalMinutes(calendar: CalendarFrontmatter, totalMinutes: number): CalendarDateParts | null {
  const perDay = minutesPerDay(calendar)
  if (perDay <= 0 || calendar.months.length === 0) return null

  let totalDays = Math.floor(totalMinutes / perDay)
  let minuteOfDay = totalMinutes - totalDays * perDay
  const hour = Math.floor(minuteOfDay / calendar.minutesPerHour)
  const minute = minuteOfDay - hour * calendar.minutesPerHour

  const era = calendar.eras.find((e) => (totalDays >= 0 ? e.direction === 'up' : e.direction === 'down'))
  if (!era) return null

  // Estimate which year `totalDays` falls in from the average year length,
  // then correct with a small bounded loop — leap adjustments are always
  // tiny relative to a year's base length, so this converges in at most a
  // couple of steps in practice. Same "estimate then correct" shape as
  // standard civil-calendar day-count algorithms use for the same reason
  // (no closed-form inverse exists once a leap rule makes year length
  // irregular).
  const base = baseYearLengthDays(calendar)
  let index = Math.trunc(totalDays / base)
  for (let guard = 0; guard < 64; guard++) {
    const yearStart = daysFromEpochToYearStart(calendar, index)
    if (totalDays < yearStart) {
      index--
      continue
    }
    const nextYearStart = daysFromEpochToYearStart(calendar, index + 1)
    if (totalDays >= nextYearStart) {
      index++
      continue
    }
    break
  }

  const year = era.direction === 'up' ? index + 1 : -index
  const dayOfYear0 = totalDays - daysFromEpochToYearStart(calendar, index)

  const offsets = monthStartOffsets(calendar, year)
  let monthIndex = offsets.length - 1
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > dayOfYear0) {
      monthIndex = i - 1
      break
    }
  }
  const day = dayOfYear0 - offsets[monthIndex] + 1

  return { eraId: era.id, year, monthId: calendar.months[monthIndex].id, day, hour, minute }
}

/** Human-readable rendering of a calendar date, e.g. "15 Aucaela, 42 AM" or
 * "3 Blython, 12 AF, 14:30" once hour/minute are non-zero. */
export function formatCalendarDate(calendar: CalendarFrontmatter, parts: CalendarDateParts): string {
  const era = calendar.eras.find((e) => e.id === parts.eraId)
  const month = calendar.months.find((m) => m.id === parts.monthId)
  const eraLabel = era ? era.abbreviation || era.name : ''
  const monthLabel = month?.name ?? '?'
  let result = `${parts.day} ${monthLabel}, ${parts.year}${eraLabel ? ` ${eraLabel}` : ''}`
  if (parts.hour !== 0 || parts.minute !== 0) {
    result += `, ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  }
  return result
}
