import { describe, it, expect } from 'vitest'
import { climateFrontmatterSchema, defaultClimateFrontmatter } from '../src/common/noteTypes/climate'

describe('defaultClimateFrontmatter', () => {
  it('produces a climate note with no calendar or seasons yet', () => {
    const fm = defaultClimateFrontmatter()
    expect(fm.type).toBe('climate')
    expect(fm.calendarNoteTitle).toBe('')
    expect(fm.seasons).toEqual([])
  })
})

describe('climateFrontmatterSchema', () => {
  it('parses a fully populated climate note', () => {
    const fm = climateFrontmatterSchema.parse({
      type: 'climate',
      calendarNoteTitle: 'Age of the Many',
      seasons: [
        {
          id: 'winter',
          name: 'Winter',
          monthIds: ['dec', 'jan', 'feb'],
          conditions: [
            { id: 'clear', name: 'Clear skies', weight: 3 },
            { id: 'snow', name: 'Snow', weight: 2 }
          ]
        }
      ]
    })
    expect(fm.seasons).toHaveLength(1)
    expect(fm.seasons[0].conditions).toHaveLength(2)
  })

  it('falls back to empty arrays for malformed seasons/conditions rather than throwing', () => {
    const fm = climateFrontmatterSchema.parse({ type: 'climate', seasons: 'not an array' })
    expect(fm.seasons).toEqual([])
  })
})
