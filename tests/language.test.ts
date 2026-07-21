import { describe, it, expect } from 'vitest'
import { parseWordEntries, stripWordEntries } from '../src/common/noteTypes/language'

describe('parseWordEntries', () => {
  it('splits content into word entries, sorted alphabetically', () => {
    const body = `
## Word: keth

Meaning: water. Noun.

## Word: aro

Meaning: fire. Noun.
`
    expect(parseWordEntries(body)).toEqual([
      { word: 'aro', content: 'Meaning: fire. Noun.' },
      { word: 'keth', content: 'Meaning: water. Noun.' }
    ])
  })

  it('matches with no space between ## and Word, and no colon (regression from the class-reference bug)', () => {
    const body = '##Word keth\n\nwater\n\n## Word:aro\n\nfire\n'
    const entries = parseWordEntries(body)
    expect(entries.map((e) => e.word)).toEqual(['aro', 'keth'])
  })

  it('does not treat ordinary headings as dictionary entries', () => {
    const body = '## Phonology\n\nSome notes about sounds.\n\n## Word: keth\n\nwater\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([{ word: 'keth', content: 'water' }])
  })

  it('returns nothing for content with no word headings', () => {
    expect(parseWordEntries('just prose, no dictionary entries')).toEqual([])
  })

  it('does not require every word to have body content', () => {
    const body = '## Word: keth\n## Word: aro\n\nfire\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      { word: 'aro', content: 'fire' },
      { word: 'keth', content: '' }
    ])
  })

  it('does not let an unrelated heading placed after a word entry get absorbed into it (regression)', () => {
    const body = `
## Word: keth

water

## Word: aro

fire

## Phonology

Soft consonants, first syllable is rarely stressed.
`
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      { word: 'aro', content: 'fire' },
      { word: 'keth', content: 'water' }
    ])
  })

  it('does not let an unrelated heading placed between two word entries bleed into either one', () => {
    const body = '## Word: keth\n\nwater\n\n## Grammar Notes\n\nverbs conjugate by tense\n\n## Word: aro\n\nfire\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      { word: 'aro', content: 'fire' },
      { word: 'keth', content: 'water' }
    ])
  })
})

describe('stripWordEntries', () => {
  it('removes word-entry sections but keeps everything else, in order', () => {
    const body = '## Word: keth\n\nwater\n\n## Phonology\n\nsome notes\n\n## Word: aro\n\nfire\n'
    expect(stripWordEntries(body)).toBe('## Phonology\n\nsome notes\n\n')
  })

  it('returns the body unchanged when there are no word entries', () => {
    const body = '## Phonology\n\nsome notes\n'
    expect(stripWordEntries(body)).toBe(body)
  })

  it('returns an empty-ish string when the body is entirely word entries', () => {
    const body = '## Word: keth\n\nwater\n\n## Word: aro\n\nfire\n'
    expect(stripWordEntries(body).trim()).toBe('')
  })
})
