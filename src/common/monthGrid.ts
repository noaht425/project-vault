// Pure month-grid math for the Events section's Calendar view — turns a
// (calendar, era, year, month) reference into rows of day cells laid out by
// weekday column, plus month-stepping and per-day event bucketing. No React,
// no IPC — same common/-vs-renderer/ split as eventTimelinePlacement.ts.
//
// Weekday convention comes from CalendarWeekTab.tsx's own UI text: "day 1 of
// the calendar's epoch falls on" the FIRST weekDays entry — so a day's
// weekday is simply its whole-day index from epoch, positive-mod the week
// length. No weekday math existed anywhere before this file.

import type { CalendarFrontmatter } from './noteTypes/calendar'
import { daysInMonthForYear, fromCanonicalMinutes, toCanonicalMinutes } from './calendarMath'

export interface MonthRef {
  eraId: string
  year: number
  monthId: string
}

export interface DayCell {
  day: number // 1-based day of month
  startMinutes: number // canonical minutes at 00:00 of this day
  endMinutes: number // exclusive — 00:00 of the next day
  weekdayIndex: number
}

export interface MonthGrid {
  weeks: (DayCell | null)[][] // null = leading/trailing pad cell outside the month
  daysInMonth: number
  firstStartMinutes: number
  minutesPerDay: number
}

function minutesPerDay(calendar: CalendarFrontmatter): number {
  return calendar.hoursPerDay * calendar.minutesPerHour
}

/** Weekday column (0-based into `weekDays`) for the day containing `dayStartMinutes` — positive
 * mod, so pre-epoch days cycle correctly too. 0 when the calendar has no week days defined. */
export function weekdayIndex(calendar: CalendarFrontmatter, dayStartMinutes: number): number {
  const n = calendar.weekDays.length
  const perDay = minutesPerDay(calendar)
  if (n === 0 || perDay <= 0) return 0
  const dayIdx = Math.floor(dayStartMinutes / perDay)
  return ((dayIdx % n) + n) % n
}

/**
 * The full grid for one month: rows of `weekDays.length` cells, padded with
 * nulls before day 1 (to its starting weekday) and after the last day. Leap-
 * aware via daysInMonthForYear, so a leap-rule-targeted month grows in leap
 * years. Null if the era/month don't resolve on this calendar.
 */
export function buildMonthGrid(calendar: CalendarFrontmatter, ref: MonthRef): MonthGrid | null {
  const daysInMonth = daysInMonthForYear(calendar, ref.monthId, ref.year)
  if (daysInMonth === null || daysInMonth <= 0) return null
  const firstStart = toCanonicalMinutes(calendar, { eraId: ref.eraId, year: ref.year, monthId: ref.monthId, day: 1, hour: 0, minute: 0 })
  if (firstStart === null) return null
  const perDay = minutesPerDay(calendar)
  if (perDay <= 0) return null

  const columns = Math.max(1, calendar.weekDays.length)
  const weeks: (DayCell | null)[][] = []
  let row: (DayCell | null)[] = Array.from({ length: weekdayIndex(calendar, firstStart) }, () => null)

  for (let day = 1; day <= daysInMonth; day++) {
    const startMinutes = firstStart + (day - 1) * perDay
    row.push({ day, startMinutes, endMinutes: startMinutes + perDay, weekdayIndex: weekdayIndex(calendar, startMinutes) })
    if (row.length === columns) {
      weeks.push(row)
      row = []
    }
  }
  if (row.length > 0) {
    while (row.length < columns) row.push(null)
    weeks.push(row)
  }

  return { weeks, daysInMonth, firstStartMinutes: firstStart, minutesPerDay: perDay }
}

/**
 * The next/previous month's reference, stepped through canonical minutes so
 * year rollover AND the up/down era boundary both work with zero special-
 * casing — the epoch math already handles both directions. Null when there's
 * nowhere to go (e.g. stepping back past epoch on a calendar with no 'down'
 * era). The small forward loop covers a standalone intercalary leap day
 * (leap rule with monthId: null) sitting after the last month — landing on
 * it folds back into the same month, so keep stepping a day at a time until
 * the month actually changes.
 */
export function stepMonth(calendar: CalendarFrontmatter, ref: MonthRef, delta: 1 | -1): MonthRef | null {
  const firstStart = toCanonicalMinutes(calendar, { eraId: ref.eraId, year: ref.year, monthId: ref.monthId, day: 1, hour: 0, minute: 0 })
  if (firstStart === null) return null
  const perDay = minutesPerDay(calendar)
  if (perDay <= 0) return null

  if (delta === -1) {
    const parts = fromCanonicalMinutes(calendar, firstStart - perDay)
    return parts ? { eraId: parts.eraId, year: parts.year, monthId: parts.monthId } : null
  }

  const daysInMonth = daysInMonthForYear(calendar, ref.monthId, ref.year)
  if (daysInMonth === null) return null
  let minutes = firstStart + daysInMonth * perDay
  for (let guard = 0; guard < 64; guard++) {
    const parts = fromCanonicalMinutes(calendar, minutes)
    if (!parts) return null
    if (parts.monthId !== ref.monthId || parts.year !== ref.year || parts.eraId !== ref.eraId) {
      return { eraId: parts.eraId, year: parts.year, monthId: parts.monthId }
    }
    minutes += perDay
  }
  return null
}

/** Which month a canonical-minute instant falls in — for opening the grid on the campaign date or the latest event. */
export function monthRefForMinutes(calendar: CalendarFrontmatter, minutes: number): MonthRef | null {
  const parts = fromCanonicalMinutes(calendar, minutes)
  return parts ? { eraId: parts.eraId, year: parts.year, monthId: parts.monthId } : null
}

/**
 * Groups timestamped items into the grid's days by 1-based day number.
 * Anything outside the month's range (e.g. a recurring event's out-of-month
 * anchor, which expandAnnualRecurrence always includes) simply lands in no
 * bucket — no pre-filtering needed by callers.
 */
export function bucketByDay<T>(grid: MonthGrid, items: { minutes: number; data: T }[]): Map<number, T[]> {
  const buckets = new Map<number, T[]>()
  for (const item of items) {
    const day = Math.floor((item.minutes - grid.firstStartMinutes) / grid.minutesPerDay) + 1
    if (day < 1 || day > grid.daysInMonth) continue
    const list = buckets.get(day) ?? []
    list.push(item.data)
    buckets.set(day, list)
  }
  return buckets
}
