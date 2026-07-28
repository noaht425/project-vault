import { z } from 'zod'

// Storage design: mirrors settlement.ts's "one note, lightweight config" —
// a calendar note holds its entire structured definition (eras, months,
// week, day/time precision, moons) as arrays/fields in ONE note's
// frontmatter, edited via a multi-tab sheet (see
// docs/plans/2026-07-28-calendar-timeline-system.md, build step 2).
// A vault can define as many calendar notes as it wants; which one(s)
// format a given displayed date is a separate "active calendars" concern
// (build step 6), not part of this schema.

// An era is a named span of years with a counting direction — e.g. "Age of
// the Many" (abbreviation "AM") counts up like CE, "Age of the Few" ("AF")
// counts down like BCE. Two eras sharing the same year-zero point is the
// common case (matches the user's own calendar, and real-world CE/BCE) but
// nothing here enforces exactly two — a calendar can define just one
// always-counting-up era, or several.
export const calendarEraSchema = z.object({
  id: z.string(),
  name: z.string(),
  abbreviation: z.string().catch(''),
  direction: z.enum(['up', 'down']).catch('up')
})
export type CalendarEra = z.infer<typeof calendarEraSchema>

// A month's length in days. Fixed-length calendars (every month the same)
// and variable-length ones (like Krotaphos's 30/29/28/27/26/25 repeating
// pattern) both just enumerate every month explicitly here — no separate
// "uniform length" shortcut, since a generic editor can't assume regularity.
export const calendarMonthSchema = z.object({
  id: z.string(),
  name: z.string(),
  days: z.coerce.number().catch(30)
})
export type CalendarMonth = z.infer<typeof calendarMonthSchema>

// Adds `extraDays` to `monthId`'s length (or, if `monthId` is null, inserts
// `extraDays` as standalone intercalary day(s) belonging to no month) in any
// year that matches `intervalYears` and doesn't match `exceptionEveryYears`,
// unless it ALSO matches `exceptionToExceptionEveryYears` — the same nested
// interval/exception/exception-to-the-exception shape as the real-world
// Gregorian rule (every 4 years, except every 100, except every 400), generic
// enough to express "no leap years at all" (leapYearRule: null, true of both
// of the user's own calendars) up through Gregorian-style nesting.
export const leapYearRuleSchema = z.object({
  intervalYears: z.coerce.number().catch(4),
  exceptionEveryYears: z.coerce.number().nullable().catch(null),
  exceptionToExceptionEveryYears: z.coerce.number().nullable().catch(null),
  extraDays: z.coerce.number().catch(1),
  monthId: z.string().nullable().catch(null)
})
export type LeapYearRule = z.infer<typeof leapYearRuleSchema>

// A named moon with its own cycle length, independent of the calendar's own
// day/month/year structure (a moon's cycle rarely divides evenly into a
// custom calendar's months, same as real-world lunar months not dividing
// evenly into the Gregorian year). phaseOffsetDays shifts when a fresh cycle
// starts relative to canonical day 0, so multiple moons don't have to share
// a new-moon date.
export const calendarMoonSchema = z.object({
  id: z.string(),
  name: z.string(),
  cycleDays: z.coerce.number().catch(30),
  phaseOffsetDays: z.coerce.number().catch(0)
})
export type CalendarMoon = z.infer<typeof calendarMoonSchema>

export const calendarFrontmatterSchema = z
  .object({
    type: z.literal('calendar'),
    tags: z.array(z.string()).catch([]),
    // Overview tab.
    summary: z.string().catch(''),
    // Years/Eras tab.
    eras: z.array(calendarEraSchema).catch([]),
    leapYearRule: leapYearRuleSchema.nullable().catch(null),
    // Months tab.
    months: z.array(calendarMonthSchema).catch(() => defaultMonths()),
    // Week tab.
    weekDays: z.array(z.string()).catch(() => defaultWeekDays()),
    // Days tab — sub-day precision, built now per the user even though no
    // vault content uses it yet (see the plan doc's "Recovered calendar
    // data" section).
    hoursPerDay: z.coerce.number().catch(24),
    minutesPerHour: z.coerce.number().catch(60),
    // Moons tab.
    moons: z.array(calendarMoonSchema).catch([]),
    // Settings tab. Which era a bare year with no written suffix belongs to
    // — generalizes worldDate.ts's existing hardcoded "no AM/AF suffix
    // defaults to AM" behavior (see that file's header comment) to a
    // calendar with any number of eras, not just two. Null = no eras
    // defined yet, or none chosen as the default.
    defaultEraId: z.string().nullable().catch(null)
  })
  .passthrough()

export type CalendarFrontmatter = z.infer<typeof calendarFrontmatterSchema>

// Generic placeholder shape, not tied to any specific published setting —
// same spirit as settlement.ts's defaultBuildingTypes()/defaultWealthTiers().
// A brand-new calendar note starts as a plain 12×30 year with a 7-day week
// and no moons/leap years, all fully renameable/addable/removable via the
// editor.
function defaultMonths(): CalendarMonth[] {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `month-${i + 1}`,
    name: `Month ${i + 1}`,
    days: 30
  }))
}

function defaultWeekDays(): string[] {
  return ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7']
}

export function defaultCalendarFrontmatter(): CalendarFrontmatter {
  return calendarFrontmatterSchema.parse({ type: 'calendar' })
}
