import { describe, it, expect } from 'vitest'
import { parseClassReferenceLevels } from '../src/common/noteTypes/classReference'

describe('parseClassReferenceLevels', () => {
  it('splits content into level sections', () => {
    const body = `
## Level 1

Fighting Style, Second Wind

## Level 2

Action Surge
`
    const levels = parseClassReferenceLevels(body)
    expect(levels).toEqual([
      { level: 1, content: 'Fighting Style, Second Wind' },
      { level: 2, content: 'Action Surge' }
    ])
  })

  it('sorts out-of-order headings by level', () => {
    const body = `## Level 3\n\nThird\n\n## Level 1\n\nFirst\n`
    const levels = parseClassReferenceLevels(body)
    expect(levels.map((l) => l.level)).toEqual([1, 3])
  })

  it('returns nothing for content with no level headings', () => {
    expect(parseClassReferenceLevels('just some notes, no headings')).toEqual([])
  })

  it('is case-insensitive and tolerates extra whitespace', () => {
    const body = '##   level   5   \n\nFeature text\n'
    const levels = parseClassReferenceLevels(body)
    expect(levels).toEqual([{ level: 5, content: 'Feature text' }])
  })

  it('recognizes headings with trailing text instead of swallowing them into the previous level', () => {
    const body = `
## Level 1

First

## Level 3: Extra Attack

Third

## Level 5 (Champion)

Fifth
`
    const levels = parseClassReferenceLevels(body)
    expect(levels).toEqual([
      { level: 1, content: 'First' },
      { level: 3, content: 'Third' },
      { level: 5, content: 'Fifth' }
    ])
  })

  it('does not require every level to be present', () => {
    const body = '## Level 7\n\nSubclass feature that only kicks in at 7\n'
    const levels = parseClassReferenceLevels(body)
    expect(levels).toEqual([{ level: 7, content: 'Subclass feature that only kicks in at 7' }])
  })

  it('matches headings with no space between ## and Level (regression)', () => {
    const body = `
## Level 3 | Improved Critical

Score a critical hit on 19 or 20.

## Level 7 | Remarkable Athlete

Add half your proficiency bonus to certain checks.

##Level 10 | Additional Fighting Style

Choose a second Fighting Style.

##Level 15 | Superior Critical

Score a critical hit on 18-20.

##Level 18 | Survivor

Regain hit points at the start of your turn.
`
    const levels = parseClassReferenceLevels(body)
    expect(levels.map((l) => l.level)).toEqual([3, 7, 10, 15, 18])
    expect(levels.find((l) => l.level === 10)?.content).toContain('second Fighting Style')
    expect(levels.find((l) => l.level === 7)?.content).not.toContain('Fighting Style')
  })
})
