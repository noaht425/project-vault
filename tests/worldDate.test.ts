import { describe, it, expect } from 'vitest'
import { parseWorldDateStart, compareWorldDates, parseWorldDateRaw } from '../src/common/worldDate'

describe('parseWorldDateStart', () => {
  it('returns null for empty or unparseable text', () => {
    expect(parseWorldDateStart('')).toBeNull()
    expect(parseWorldDateStart('   ')).toBeNull()
    expect(parseWorldDateStart('sometime last week')).toBeNull()
  })

  it('parses a full day/month/year/era date', () => {
    expect(parseWorldDateStart('98 Aucaela, 6 AM')).not.toBeNull()
  })

  it('orders two full dates within the same year correctly', () => {
    const founded = parseWorldDateStart('1 Aucaela, 3 AM')! // month 1
    const later = parseWorldDateStart('1 Auctera, 3 AM')! // month 2
    expect(founded).toBeLessThan(later)
  })

  it('defaults a missing AM/AF suffix to AM', () => {
    expect(parseWorldDateStart('99 Morcaela, 427')).toBe(parseWorldDateStart('99 Morcaela, 427 AM'))
  })

  it('orders AM after AF, and larger AF years earlier (BCE-style countdown)', () => {
    const af50 = parseWorldDateStart('50 AF')!
    const af10 = parseWorldDateStart('10 AF')!
    const am1 = parseWorldDateStart('1 Aucaela, 1 AM')!
    expect(af50).toBeLessThan(af10)
    expect(af10).toBeLessThan(am1)
  })

  it('strips thousands-comma from years', () => {
    expect(parseWorldDateStart('3,096 AF')).toBe(parseWorldDateStart('3096 AF'))
  })

  it('orders two comma-formatted AF years correctly', () => {
    const division = parseWorldDateStart('3,097 AF')!
    const syzygy = parseWorldDateStart('3,096 AF')!
    expect(division).toBeLessThan(syzygy) // 3097 AF is further in the past than 3096 AF
  })

  it('sorts a spaced-dash range by its start date', () => {
    const start = parseWorldDateStart('1 Aucaela, 1 AM – 1 Auctera, 1 AM')
    expect(start).toBe(parseWorldDateStart('1 Aucaela, 1 AM'))
  })

  it('sorts a compact "39-10 AF" range by its first (earlier) year', () => {
    const start = parseWorldDateStart('39-10 AF')
    expect(start).toBe(parseWorldDateStart('39 AF'))
  })

  it('falls back to year-only precision when the month name is unrecognized, instead of dropping the date entirely (regression)', () => {
    // A typo'd month name ("Morcalea" instead of "Morcaela") should still
    // sort by its year, not get treated as undated and pushed to the end.
    const typo = parseWorldDateStart('97 Morcalea, 423 AM')
    expect(typo).not.toBeNull()
    expect(typo).toBe(parseWorldDateStart('423 AM'))
  })

  it('treats a Krotaphos-calendar date as the same rough position as a main-calendar date in the same year', () => {
    // Blython is Krotaphos's first month (30 days) — day 15 of it should
    // land in roughly the first quarter of the year, same as a main-
    // calendar date early in Aucaela.
    const krotaphos = parseWorldDateStart('15 Blython, 50 AM')!
    const earlyMain = parseWorldDateStart('1 Aucaela, 50 AM')!
    const lateMain = parseWorldDateStart('1 Mortera, 50 AM')!
    expect(krotaphos).toBeGreaterThan(earlyMain)
    expect(krotaphos).toBeLessThan(lateMain)
  })
})

describe('compareWorldDates', () => {
  it('sorts a mixed list chronologically', () => {
    const dates = ['50 AF', '1 Aucaela, 1 AM', '3,097 AF', '99 Morcaela, 427', '3,096 AF']
    const sorted = [...dates].sort(compareWorldDates)
    expect(sorted).toEqual(['3,097 AF', '3,096 AF', '50 AF', '1 Aucaela, 1 AM', '99 Morcaela, 427'])
  })

  it('pushes undated/unparseable entries to the end', () => {
    const dates = ['50 AF', '', '1 Aucaela, 1 AM', 'unknown']
    const sorted = [...dates].sort(compareWorldDates)
    expect(sorted).toEqual(['50 AF', '1 Aucaela, 1 AM', '', 'unknown'])
  })
})

describe('parseWorldDateRaw', () => {
  it('returns the raw month name/day, unscaled, for a full date', () => {
    expect(parseWorldDateRaw('15 Aucaela, 42 AM')).toEqual({ monthName: 'Aucaela', day: 15, year: 42, era: 'AM' })
  })

  it('defaults a missing suffix to AM, same as parseWorldDateStart', () => {
    expect(parseWorldDateRaw('99 Morcaela, 427')).toEqual({ monthName: 'Morcaela', day: 99, year: 427, era: 'AM' })
  })

  it('has no month name for a bare year', () => {
    expect(parseWorldDateRaw('50 AF')).toEqual({ monthName: null, day: null, year: 50, era: 'AF' })
  })

  it('has no month name for a compact range (takes the start year)', () => {
    expect(parseWorldDateRaw('39-10 AF')).toEqual({ monthName: null, day: null, year: 39, era: 'AF' })
  })

  it('takes the start of a spelled-out range', () => {
    expect(parseWorldDateRaw('1 Aucaela, 3 AM – 50 Auctera, 3 AM')).toEqual({ monthName: 'Aucaela', day: 1, year: 3, era: 'AM' })
  })

  it('still surfaces an unrecognized month name as-is, unlike parseWorldDateStart\'s silent year-only fallback', () => {
    expect(parseWorldDateRaw('5 Frobmonth, 10 AM')).toEqual({ monthName: 'Frobmonth', day: 5, year: 10, era: 'AM' })
  })

  it('returns null for empty or unparseable text', () => {
    expect(parseWorldDateRaw('')).toBeNull()
    expect(parseWorldDateRaw('sometime last week')).toBeNull()
  })
})
