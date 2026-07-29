import { describe, it, expect } from 'vitest'
import { migrateFreeTextDate, computeDateMigration, type CalendarCandidate } from '../src/common/dateMigration'
import { calendarFrontmatterSchema } from '../src/common/noteTypes/calendar'

function mainCalendar(): CalendarCandidate {
  return {
    noteTitle: 'Age of the Many',
    frontmatter: calendarFrontmatterSchema.parse({
      type: 'calendar',
      eras: [
        { id: 'am', name: 'Age of the Many', abbreviation: 'AM', direction: 'up' },
        { id: 'af', name: 'Age of the Few', abbreviation: 'AF', direction: 'down' }
      ],
      months: [
        { id: 'aucaela', name: 'Aucaela', days: 100 },
        { id: 'auctera', name: 'Auctera', days: 100 },
        { id: 'morcaela', name: 'Morcaela', days: 100 },
        { id: 'mortera', name: 'Mortera', days: 100 }
      ],
      defaultEraId: 'am'
    })
  }
}

function krotaphosCalendar(): CalendarCandidate {
  return {
    noteTitle: 'Kingdom of Krotaphos',
    frontmatter: calendarFrontmatterSchema.parse({
      type: 'calendar',
      eras: [
        { id: 'am', name: 'Age of the Many', abbreviation: 'AM', direction: 'up' },
        { id: 'af', name: 'Age of the Few', abbreviation: 'AF', direction: 'down' }
      ],
      months: [
        { id: 'blython', name: 'Blython', days: 30 },
        { id: 'neemon', name: 'Neemon', days: 29 }
      ],
      defaultEraId: 'am'
    })
  }
}

describe('migrateFreeTextDate', () => {
  it('matches a full date against the calendar whose months know that name', () => {
    const result = migrateFreeTextDate('15 Aucaela, 42 AM', [mainCalendar(), krotaphosCalendar()])
    expect(result).toEqual({
      calendarNoteTitle: 'Age of the Many',
      eraId: 'am',
      year: 42,
      monthId: 'aucaela',
      day: 15,
      hour: 0,
      minute: 0,
      annualRecurrence: false
    })
  })

  it('picks the Krotaphos calendar when the month name only exists there', () => {
    const result = migrateFreeTextDate('10 Blython, 5 AM', [mainCalendar(), krotaphosCalendar()])
    expect(result?.calendarNoteTitle).toBe('Kingdom of Krotaphos')
    expect(result?.monthId).toBe('blython')
  })

  it('uses the first calendar\'s first month for a bare year (no month given)', () => {
    const result = migrateFreeTextDate('50 AF', [mainCalendar(), krotaphosCalendar()])
    expect(result).toEqual({
      calendarNoteTitle: 'Age of the Many',
      eraId: 'af',
      year: 50,
      monthId: 'aucaela',
      day: 1,
      hour: 0,
      minute: 0,
      annualRecurrence: false
    })
  })

  it('falls back to defaultEraId when no AM/AF suffix is present', () => {
    const result = migrateFreeTextDate('99 Morcaela, 427', [mainCalendar()])
    expect(result?.eraId).toBe('am')
  })

  it('returns null when no calendar knows the month name', () => {
    expect(migrateFreeTextDate('5 Frobmonth, 10 AM', [mainCalendar(), krotaphosCalendar()])).toBeNull()
  })

  it('returns null for unparseable text', () => {
    expect(migrateFreeTextDate('sometime last week', [mainCalendar()])).toBeNull()
  })

  it('returns null when given no calendars at all', () => {
    expect(migrateFreeTextDate('15 Aucaela, 42 AM', [])).toBeNull()
  })
})

describe('computeDateMigration', () => {
  it('migrates only events with a parseable date and no existing structuredDate', () => {
    const events = [
      { path: '/a.md', date: '15 Aucaela, 42 AM', hasStructuredDate: false },
      { path: '/b.md', date: '10 Blython, 5 AM', hasStructuredDate: true }, // already migrated -- skip
      { path: '/c.md', date: '', hasStructuredDate: false }, // no date at all -- skip
      { path: '/d.md', date: 'sometime vague', hasStructuredDate: false } // unparseable -- skip, stays undated
    ]
    const updates = computeDateMigration(events, [mainCalendar(), krotaphosCalendar()])
    expect(updates).toEqual([
      {
        path: '/a.md',
        structuredDate: {
          calendarNoteTitle: 'Age of the Many',
          eraId: 'am',
          year: 42,
          monthId: 'aucaela',
          day: 15,
          hour: 0,
          minute: 0,
          annualRecurrence: false
        }
      }
    ])
  })

  it('is a no-op when there are no calendars defined yet', () => {
    const events = [{ path: '/a.md', date: '15 Aucaela, 42 AM', hasStructuredDate: false }]
    expect(computeDateMigration(events, [])).toEqual([])
  })
})
