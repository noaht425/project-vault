import { describe, it, expect } from 'vitest'
import { parseWordEntries, parseGrammarRules, stripStructuredSections } from '../src/common/noteTypes/language'

describe('parseWordEntries', () => {
  it('splits content into word entries, sorted alphabetically', () => {
    const body = `
## Word: keth

water. Noun.

## Word: aro

fire. Noun.
`
    expect(parseWordEntries(body)).toEqual([
      { word: 'aro', meaning: null, partOfSpeech: null, gender: null, content: 'fire. Noun.' },
      { word: 'keth', meaning: null, partOfSpeech: null, gender: null, content: 'water. Noun.' }
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
    expect(entries).toEqual([{ word: 'keth', meaning: null, partOfSpeech: null, gender: null, content: 'water' }])
  })

  it('returns nothing for content with no word headings', () => {
    expect(parseWordEntries('just prose, no dictionary entries')).toEqual([])
  })

  it('does not require every word to have body content', () => {
    const body = '## Word: keth\n## Word: aro\n\nfire\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      { word: 'aro', meaning: null, partOfSpeech: null, gender: null, content: 'fire' },
      { word: 'keth', meaning: null, partOfSpeech: null, gender: null, content: '' }
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
      { word: 'aro', meaning: null, partOfSpeech: null, gender: null, content: 'fire' },
      { word: 'keth', meaning: null, partOfSpeech: null, gender: null, content: 'water' }
    ])
  })

  it('does not let an unrelated heading placed between two word entries bleed into either one', () => {
    const body = '## Word: keth\n\nwater\n\n## Grammar Notes\n\nverbs conjugate by tense\n\n## Word: aro\n\nfire\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      { word: 'aro', meaning: null, partOfSpeech: null, gender: null, content: 'fire' },
      { word: 'keth', meaning: null, partOfSpeech: null, gender: null, content: 'water' }
    ])
  })

  it('pulls out optional Meaning/POS lines into their own fields', () => {
    const body = '## Word: keth\n\nMeaning: water\nPOS: noun\n\nSacred to the river clans.\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      {
        word: 'keth',
        meaning: 'water',
        partOfSpeech: 'noun',
        gender: null,
        content: 'Sacred to the river clans.'
      }
    ])
  })

  it('accepts "Part of Speech:" as well as "POS:"', () => {
    const body = '## Word: keth\n\nMeaning: water\nPart of Speech: noun\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      { word: 'keth', meaning: 'water', partOfSpeech: 'noun', gender: null, content: '' }
    ])
  })

  it('works with only Meaning or only POS present', () => {
    const body = '## Word: keth\n\nMeaning: water\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([{ word: 'keth', meaning: 'water', partOfSpeech: null, gender: null, content: '' }])
  })

  it('pulls out an optional Gender line into its own field', () => {
    const body = '## Word: keth\n\nMeaning: water\nPOS: noun\nGender: feminine\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      { word: 'keth', meaning: 'water', partOfSpeech: 'noun', gender: 'feminine', content: '' }
    ])
  })

  it('works with Gender present but Meaning/POS absent', () => {
    const body = '## Word: keth\n\nGender: feminine\n\nSacred to the river clans.\n'
    const entries = parseWordEntries(body)
    expect(entries).toEqual([
      { word: 'keth', meaning: null, partOfSpeech: null, gender: 'feminine', content: 'Sacred to the river clans.' }
    ])
  })
})

describe('parseGrammarRules', () => {
  it('splits content into named grammar rules', () => {
    const body = '## Grammar: Word Order\n\nSubject-Object-Verb.\n\n## Grammar: Plural\n\nAdd -eth suffix.\n'
    expect(parseGrammarRules(body)).toEqual([
      { name: 'Word Order', content: 'Subject-Object-Verb.' },
      { name: 'Plural', content: 'Add -eth suffix.' }
    ])
  })

  it('requires the colon, so a plain "## Grammar Notes" heading is not treated as a rule', () => {
    const body = '## Grammar Notes\n\nVerbs conjugate by tense.\n'
    expect(parseGrammarRules(body)).toEqual([])
  })

  it('does not let word entries or other headings bleed into a grammar rule', () => {
    const body = '## Grammar: Word Order\n\nSOV.\n\n## Word: keth\n\nwater\n\n## Phonology\n\nnotes\n'
    expect(parseGrammarRules(body)).toEqual([{ name: 'Word Order', content: 'SOV.' }])
  })

  it('returns nothing for content with no grammar headings', () => {
    expect(parseGrammarRules('just prose, no rules')).toEqual([])
  })
})

describe('stripStructuredSections', () => {
  it('removes word-entry and grammar-rule sections but keeps everything else, in order', () => {
    const body =
      '## Word: keth\n\nwater\n\n## Grammar: Word Order\n\nSOV.\n\n## Phonology\n\nsome notes\n\n## Word: aro\n\nfire\n'
    expect(stripStructuredSections(body)).toBe('## Phonology\n\nsome notes\n\n')
  })

  it('returns the body unchanged when there are no structured sections', () => {
    const body = '## Phonology\n\nsome notes\n'
    expect(stripStructuredSections(body)).toBe(body)
  })

  it('returns an empty-ish string when the body is entirely structured sections', () => {
    const body = '## Word: keth\n\nwater\n\n## Grammar: Word Order\n\nSOV.\n'
    expect(stripStructuredSections(body).trim()).toBe('')
  })
})
