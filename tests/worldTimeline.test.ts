import { describe, it, expect } from 'vitest'
import { extractHistoryFacts, extractBornDiedFacts, extractInlineTimelineFacts } from '../src/common/worldTimeline'

describe('extractHistoryFacts', () => {
  it('extracts dated bullets from a ## History section', () => {
    const body = `
Some intro prose.

## History
- 56 Morcaela, 2 AM: Founded
- 56 Morcaela, 2 AM: Genasi becomes king
`
    expect(extractHistoryFacts(body)).toEqual([
      { date: '56 Morcaela, 2 AM', description: 'Founded' },
      { date: '56 Morcaela, 2 AM', description: 'Genasi becomes king' }
    ])
  })

  it('stops at the next heading', () => {
    const body = `
## History
- 1 Aucaela, 3 AM: Founded

## Geography
- Not a date: this should not be picked up
`
    expect(extractHistoryFacts(body)).toEqual([{ date: '1 Aucaela, 3 AM', description: 'Founded' }])
  })

  it('returns nothing when there is no History heading', () => {
    expect(extractHistoryFacts('Just some notes, no headings.')).toEqual([])
  })

  it('ignores bullets that are not date-shaped (no ": " separator)', () => {
    const body = `## History\n- Just a plain bullet with no colon-space\n`
    expect(extractHistoryFacts(body)).toEqual([])
  })

  it('is case-insensitive and tolerates extra whitespace in the heading', () => {
    const body = '##   history   \n- 5 Auctera, 325 AM: Dies\n'
    expect(extractHistoryFacts(body)).toEqual([{ date: '5 Auctera, 325 AM', description: 'Dies' }])
  })
})

describe('extractBornDiedFacts', () => {
  it('extracts a bare Born:/Died: line with no trailing sentence', () => {
    const body = 'Son of Genasi\nHome Realm: Arenis\n\nBorn: 98 Aucaela, 6 AM\nDied: 32 Auctera, 160 AM\n'
    expect(extractBornDiedFacts(body)).toEqual([
      { date: '98 Aucaela, 6 AM', description: 'Born' },
      { date: '32 Auctera, 160 AM', description: 'Died' }
    ])
  })

  it('folds a trailing sentence after the date into the description', () => {
    const body = 'Died: 33 Aucaela, 405 AM. Killed by [[Iras]].'
    expect(extractBornDiedFacts(body)).toEqual([
      { date: '33 Aucaela, 405 AM', description: 'Died: Killed by [[Iras]].' }
    ])
  })
})

describe('extractInlineTimelineFacts', () => {
  it('extracts a [[timeline: date: description]] mention anywhere in the body', () => {
    const body = 'The bridge held for years until [[timeline: 12 Harvestmoon, 1023 AM: Dragon attacks the village]] changed everything.'
    expect(extractInlineTimelineFacts(body)).toEqual([
      { date: '12 Harvestmoon, 1023 AM', description: 'Dragon attacks the village' }
    ])
  })

  it('extracts multiple mentions in order', () => {
    const body = '[[timeline: 1 AM: First]] then later [[timeline: 2 AM: Second]].'
    expect(extractInlineTimelineFacts(body)).toEqual([
      { date: '1 AM', description: 'First' },
      { date: '2 AM', description: 'Second' }
    ])
  })

  it('is case-insensitive on the timeline keyword', () => {
    const body = '[[Timeline: 1 AM: event]]'
    expect(extractInlineTimelineFacts(body)).toEqual([{ date: '1 AM', description: 'event' }])
  })

  it('ignores a mention without a colon-space split', () => {
    expect(extractInlineTimelineFacts('[[timeline: no colon here]]')).toEqual([])
  })

  it('returns nothing when there are no timeline mentions', () => {
    expect(extractInlineTimelineFacts('Just plain text with [[Alice]].')).toEqual([])
  })
})
