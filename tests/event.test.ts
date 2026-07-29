import { describe, it, expect } from 'vitest'
import { eventFrontmatterSchema, defaultEventFrontmatter } from '../src/common/noteTypes/event'

describe('defaultEventFrontmatter', () => {
  it('has no structured date by default (only the existing free-text date)', () => {
    const fm = defaultEventFrontmatter()
    expect(fm.date).toBe('')
    expect(fm.structuredDate).toBeNull()
  })
})

describe('eventFrontmatterSchema', () => {
  it('keeps the free-text date alongside a structured date, neither replacing the other', () => {
    const fm = eventFrontmatterSchema.parse({
      type: 'event',
      date: 'Year 12 of the Third Age',
      structuredDate: {
        calendarNoteTitle: 'Age of the Many',
        eraId: 'am',
        year: 42,
        monthId: 'aucaela',
        day: 15,
        hour: 0,
        minute: 0
      }
    })

    expect(fm.date).toBe('Year 12 of the Third Age')
    expect(fm.structuredDate).toEqual({
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

  it('falls back to null for a malformed structuredDate rather than throwing', () => {
    const fm = eventFrontmatterSchema.parse({ type: 'event', structuredDate: 'not an object' })
    expect(fm.structuredDate).toBeNull()
  })
})
