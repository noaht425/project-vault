// Pure weather-generation engine for climate notes (noteTypes/climate.ts) —
// same weighted-pool philosophy as settlementGenerator.ts/settlementNames.ts
// (pickWeighted), but seeded from the exact calendar date instead of an
// injectable rng() — confirmed with the user: revisiting the same day must
// always show the same weather (session-prep continuity), without
// persisting a rolled result anywhere. No randomness library, no stored
// state: the date IS the seed.

import type { CalendarFrontmatter } from './noteTypes/calendar'
import type { ClimateFrontmatter, WeatherCondition } from './noteTypes/climate'
import { fromCanonicalMinutes } from './calendarMath'

/**
 * Maps any integer (including negative, for a day before canonical epoch)
 * to a stable fraction in [0, 1) — the same integer always produces the
 * same fraction. A small dependency-free integer hash (splitmix32-style:
 * xor-shift + Math.imul multiplies), not a general-purpose PRNG — this only
 * ever needs one fraction per seed, never a stream of them.
 */
export function deterministicFraction(seed: number): number {
  let x = seed | 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = (x ^ (x >>> 16)) >>> 0
  return x / 4294967296
}

/** Weighted pick from a precomputed `fraction` (same weighted-selection math as
 * settlementNames.ts's pickWeighted, just fed a fraction instead of calling rng() itself —
 * higher `.weight` means more likely, but nothing is ever impossible as long as weight > 0. */
export function pickWeightedCondition<T extends { weight: number }>(items: T[], fraction: number): T | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0)
  if (items.length === 0 || total <= 0) return items[items.length - 1] ?? null
  let roll = fraction * total
  for (const item of items) {
    const weight = Math.max(0, item.weight)
    // Skip zero-weight items entirely rather than subtracting 0 — at
    // fraction exactly 0, `roll` starts at 0, and a zero subtraction would
    // never bring it below the `<= 0` check, letting a leading zero-weight
    // item win despite having no chance of being picked.
    if (weight <= 0) continue
    roll -= weight
    if (roll <= 0) return item
  }
  return items[items.length - 1]
}

export interface WeatherResult {
  seasonName: string
  condition: WeatherCondition
}

/**
 * Deterministic weather for one instant, or null if this climate has no
 * season covering that month (or that season has no conditions defined) —
 * same "harmless when data's missing" fallback as everywhere else in this
 * app, not an error. Seeded from the whole-day index (not the raw minute
 * value) so weather is stable across a full day, not just one instant.
 */
export function computeWeatherForDate(climate: ClimateFrontmatter, calendar: CalendarFrontmatter, totalMinutes: number): WeatherResult | null {
  const parts = fromCanonicalMinutes(calendar, totalMinutes)
  if (!parts) return null

  const season = climate.seasons.find((s) => s.monthIds.includes(parts.monthId))
  if (!season || season.conditions.length === 0) return null

  const minutesPerDay = calendar.hoursPerDay * calendar.minutesPerHour
  if (minutesPerDay <= 0) return null
  const totalDays = Math.floor(totalMinutes / minutesPerDay)

  const condition = pickWeightedCondition(season.conditions, deterministicFraction(totalDays))
  if (!condition) return null

  return { seasonName: season.name, condition }
}
