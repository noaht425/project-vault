// Step 5 of docs/plans/2026-07-28-calendar-timeline-system.md — converts an
// event's existing free-text date into a structuredDate (see
// noteTypes/event.ts) by matching it against whichever `calendar` notes
// actually exist. Kept pure/backend-agnostic (no file/DB access) so it can
// be unit-tested directly and reused verbatim by both the local vault
// (src/main/vault/session.ts) and a project-vault-cloud API route — those
// two do the actual note reading/writing and call these functions with
// already-loaded data.

import { parseWorldDateRaw } from './worldDate'
import type { CalendarFrontmatter } from './noteTypes/calendar'
import type { EventStructuredDate } from './noteTypes/event'

export interface CalendarCandidate {
  noteTitle: string
  frontmatter: CalendarFrontmatter
}

/**
 * Attempts to convert one event's free-text date into a structured date by
 * matching worldDate.ts's parsed month name against an ACTUAL calendar
 * note's own months list (not this app's hardcoded AM/AF calendars), and
 * its AM/AF era suffix (or, absent a suffix, that calendar's own
 * defaultEraId) against that calendar's eras list. `calendars` is checked
 * in order, first full match wins. Returns null if the text doesn't parse,
 * or parses but matches no given calendar's vocabulary — callers should
 * leave the event undated in that case (confirmed with the user: keep the
 * free text, don't guess), same escape hatch worldDate.ts's own callers
 * already use for unparseable text.
 */
export function migrateFreeTextDate(freeText: string, calendars: CalendarCandidate[]): EventStructuredDate | null {
  const raw = parseWorldDateRaw(freeText)
  if (!raw) return null

  for (const { noteTitle, frontmatter } of calendars) {
    const month = raw.monthName
      ? frontmatter.months.find((m) => m.name.toLowerCase() === raw.monthName!.toLowerCase())
      : frontmatter.months[0] // bare year/compact range: no month given at all — same coarse "start of year" precision parseWorldDateStart itself falls back to.
    if (!month) continue

    const era =
      frontmatter.eras.find((e) => e.abbreviation.toUpperCase() === raw.era) ??
      frontmatter.eras.find((e) => e.id === frontmatter.defaultEraId)
    if (!era) continue

    return {
      calendarNoteTitle: noteTitle,
      eraId: era.id,
      year: raw.year,
      monthId: month.id,
      day: raw.day ?? 1,
      hour: 0,
      minute: 0,
      annualRecurrence: false
    }
  }

  return null
}

export interface EventDateToMigrate {
  path: string
  date: string
  hasStructuredDate: boolean
}

export interface EventDateMigrationResult {
  path: string
  structuredDate: EventStructuredDate
}

/**
 * Pure orchestration over already-loaded event summaries — no I/O. Skips
 * any event that already has a structuredDate (this IS the migration's
 * idempotency: re-running it on every vault/workspace open is always safe,
 * since already-migrated events are never revisited) or has no free-text
 * date to migrate from.
 */
export function computeDateMigration(events: EventDateToMigrate[], calendars: CalendarCandidate[]): EventDateMigrationResult[] {
  const results: EventDateMigrationResult[] = []
  for (const event of events) {
    if (event.hasStructuredDate || !event.date.trim()) continue
    const structuredDate = migrateFreeTextDate(event.date, calendars)
    if (structuredDate) results.push({ path: event.path, structuredDate })
  }
  return results
}
