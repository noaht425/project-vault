import { describe, it, expect } from 'vitest'
import {
  parseMarkdownTables,
  parseNounParadigm,
  parseVerbParadigm,
  parsePronounParadigm,
  parseVowelCombinationRules,
  declineNoun,
  conjugateVerb
} from '../src/common/noteTypes/languageParadigms'

// Fixtures are verbatim excerpts of the real Draconic.md grammar tables
// (as of this feature's introduction) — not synthetic examples — so a
// passing test here means the parser actually handles this language's
// real content, not just a simplified stand-in for it.

const NOUNS_CONTENT = `
Masculine:
| Case | Singular | Plural | Communal |
| --- | --- | --- | --- |
| Nominative | -os | -ωs | -ös |
| Accusative | -osh | -ωsh | -ösh |
| Dative | -och | -ωch | -öch |
| Vocative | -o | -ω | -ö |

Feminine:
| Case | Singular | Plural | Communal |
| --- | --- | --- | --- |
| Nominative | -u | -υ | -ü |
| Accusative | -ui | -υi | -üi |
| Dative | -um | -υm | -üm |
| Vocative | -ume | -υme | -üme |

Neuter
| Case | Singular | Plural | Communal |
| --- | --- | --- | --- |
| Nominative | -i | -ie | -im |
| Accusative | -is | -ies | -ims |
| Dative | -ish | -iesh | -imsh |
| Vocative | -ime | -ieme | -imme |
`

const VERBS_ACTIVE_CONTENT = `
Infinitive: -is

Present Tense:
| Person | Singular | Plural | Communal |
| --- | --- | --- | --- |
| 1st | -a | -e | -i |
| 2nd | -at | -et | -it |
| 3rd | -ath | -eth | -ith |

Future Tense:
| Person | Singular | Plural | Communal |
| --- | --- | --- | --- |
| 1st | -asa | -esa | -isa |
| 2nd | -asat | -esat | -isat |
| 3rd | -asath | -esath | -isath |

Past Tense:
| Person | Singular | Plural | Communal |
| --- | --- | --- | --- |
| 1st | -on | -oni | -oani |
| 2nd | -an | -ani | -aani |
| 3rd | -en | -eni | -eani |
`

const VERBS_PASSIVE_CONTENT = `
Infinitive: -issa

Present Tense:
| Person | Singular | Plural | Communal |
| --- | --- | --- | --- |
| 1st | -asa | -esa | -isa |
| 2nd | -asha | -esha | -isha |
| 3rd | -athsa | -ethsa | -ithsa |

Past Tense:
| Person | Singular | Plural | Communal |
| --- | --- | --- | --- |
| 1st | -onse | -onise | -osani |
| 2nd | -anse | -anise | -asani |
| 3rd | -ense | -enise | -esani |
`

// Synthetic — Draconic itself doesn't have prefix-attaching endings yet,
// this is exercising the mechanism ahead of a real language using it.
// Nominative stays a suffix ("-os"); Accusative is written with the hyphen
// trailing ("er-"), meaning it attaches at the front of the word instead.
const MIXED_DIRECTION_NOUNS_CONTENT = `
Testgender:
| Case | Singular |
| --- | --- |
| Nominative | -os |
| Accusative | er- |
`

// Verbatim from the real Draconic.md "Vowel Combinations" section.
const VOWEL_COMBINATIONS_CONTENT = `
If certain combinations of vowels would be put next to each other due to the addition of a prefix, suffix, stem, etc. the following transformations are applied

a + a = äa

a + o = ω

e + e = e

e + o = u

e + u = ü

i + i = y

o + o = oö

u + a = ü

u + u = u

When followed by a consonant, y changes to u
`

// Synthetic paradigm sized just to exercise a real vowel-combination rule:
// stripping "-a" from a citation form leaves a stem ending in "i", and the
// accusative ending starts with "i" too, so "i + i = y" (a real rule)
// should fire at the join, followed by the real "y before a consonant" rule.
const VOWEL_TRIGGER_NOUNS_CONTENT = `
Testgender:
| Case | Singular |
| --- | --- |
| Nominative | -a |
| Accusative | -is |
`

// Synthetic — the infinitive marker itself written as a prefix ("to-").
const PREFIX_INFINITIVE_VERB_CONTENT = `
Infinitive: to-

Present Tense:
| Person | Singular |
| --- | --- |
| 1st | -a |
`

const PRONOUNS_SUBJECT_CONTENT = `
| Person | Singular | Plural | Communal |
| --- | --- | --- | --- |
| 1st | Ha | Hon | Sha |
| 2nd | The | Ther | Tha |
| 3rd | Ash | Asher | Asha |
`

describe('parseMarkdownTables', () => {
  it('extracts each gender-labeled table from the Nouns section', () => {
    const tables = parseMarkdownTables(NOUNS_CONTENT)
    expect(tables.map((t) => t.label)).toEqual(['Masculine', 'Feminine', 'Neuter'])
    expect(tables[0].rows['Nominative']).toEqual(['-os', '-ωs', '-ös'])
  })

  it('handles a label with no trailing colon (Neuter)', () => {
    const tables = parseMarkdownTables(NOUNS_CONTENT)
    expect(tables[2].label).toBe('Neuter')
  })

  it('returns a table with a null label when nothing precedes it', () => {
    const tables = parseMarkdownTables(PRONOUNS_SUBJECT_CONTENT)
    expect(tables).toHaveLength(1)
    expect(tables[0].label).toBeNull()
  })
})

describe('parseNounParadigm', () => {
  it('builds gender -> case -> number -> ending from the real Nouns table, as suffix affixes', () => {
    const paradigm = parseNounParadigm(NOUNS_CONTENT)
    expect(paradigm?.genders['Neuter']['Accusative']['Singular']).toEqual({ kind: 'suffix', text: 'is' })
    expect(paradigm?.genders['Feminine']['Dative']['Singular']).toEqual({ kind: 'suffix', text: 'um' })
  })
})

describe('parseVerbParadigm', () => {
  it('reads the infinitive marker and tense tables from the real Verbs (Active) content, as suffix affixes', () => {
    const paradigm = parseVerbParadigm(VERBS_ACTIVE_CONTENT)
    expect(paradigm?.infinitive).toEqual({ kind: 'suffix', text: 'is' })
    expect(paradigm?.tenses['Past']['3rd']['Singular']).toEqual({ kind: 'suffix', text: 'en' })
  })

  it('normalizes "Present Tense" labels down to "Present"', () => {
    const paradigm = parseVerbParadigm(VERBS_ACTIVE_CONTENT)
    expect(paradigm?.tenses['Present']).toBeDefined()
    expect(paradigm?.tenses['Present Tense']).toBeUndefined()
  })
})

describe('parsePronounParadigm', () => {
  it('reads person -> number -> pronoun from a bare table with no label', () => {
    const paradigm = parsePronounParadigm(PRONOUNS_SUBJECT_CONTENT)
    expect(paradigm?.persons['3rd']['Singular']).toBe('Ash')
  })
})

describe('parseVowelCombinationRules', () => {
  it('parses the real "X + Y = Z" lines from the Vowel Combinations section', () => {
    const rules = parseVowelCombinationRules(VOWEL_COMBINATIONS_CONTENT)
    expect(rules?.pairs['a']['o']).toBe('ω')
    expect(rules?.pairs['i']['i']).toBe('y')
  })

  it('does not assume symmetry — "o + a" is not defined even though "a + o" is', () => {
    const rules = parseVowelCombinationRules(VOWEL_COMBINATIONS_CONTENT)
    expect(rules?.pairs['o']?.['a']).toBeUndefined()
  })

  it('parses the "before a consonant" follow-up rule', () => {
    const rules = parseVowelCombinationRules(VOWEL_COMBINATIONS_CONTENT)
    expect(rules?.beforeConsonant['y']).toBe('u')
  })
})

describe('vowel combination applied during declension', () => {
  const nounParadigm = parseNounParadigm(VOWEL_TRIGGER_NOUNS_CONTENT)!
  const vowelRules = parseVowelCombinationRules(VOWEL_COMBINATIONS_CONTENT)!

  it('combines vowels at the stem/ending join, then applies the before-consonant follow-up', () => {
    // "Testia" strips "-a" to stem "Testi"; the accusative ending "-is"
    // starts with "i", so "i + i = y" fires at the join giving "Testys" —
    // then "y before s (a consonant)" becomes "u", giving "Testus".
    expect(declineNoun(nounParadigm, 'Testia', 'Testgender', 'Accusative', 'Singular', vowelRules)).toEqual({
      form: 'Testus',
      irregular: false
    })
  })

  it('does not combine when vowelRules is omitted, even for the same input', () => {
    expect(declineNoun(nounParadigm, 'Testia', 'Testgender', 'Accusative', 'Singular')).toEqual({
      form: 'Testiis',
      irregular: false
    })
  })

  it('leaves non-colliding endings alone', () => {
    // No rule exists for "o + a" (only "a + o" is defined) — stem ends in
    // "o", ending starts with "a", stays a plain join
    const paradigm = parseNounParadigm(`
Testgender:
| Case | Singular |
| --- | --- |
| Nominative | -tos |
| Accusative | -as |
`)!
    expect(declineNoun(paradigm, 'Testotos', 'Testgender', 'Accusative', 'Singular', vowelRules)).toEqual({
      form: 'Testoas',
      irregular: false
    })
  })

  it('does not treat a vowel-combination result as a consonant for a later before-consonant rule', () => {
    // "ü" only ever appears as a combination *result* ("e + u = ü", "u + a
    // = ü") — never as a left/right key of a pair — so it's the case
    // knownVowels() missed before it also collected result characters.
    // Stem "Kelvy" (ends in "y") + ending "-ünda" (starts with "ü") has no
    // "y + ü" pair defined, so the join is a plain concatenation, and the
    // before-consonant scan is what's under test: "y" followed by the real
    // vowel "ü" must NOT trigger "y before a consonant -> u".
    const paradigm = parseNounParadigm(`
Testgender:
| Case | Singular |
| --- | --- |
| Nominative | -a |
| Accusative | -ünda |
`)!
    expect(declineNoun(paradigm, 'Kelvya', 'Testgender', 'Accusative', 'Singular', vowelRules)).toEqual({
      form: 'Kelvyünda',
      irregular: false
    })
  })
})

describe('affix direction (prefix vs suffix)', () => {
  it('parses a trailing-hyphen ending as a prefix', () => {
    const paradigm = parseNounParadigm(MIXED_DIRECTION_NOUNS_CONTENT)
    expect(paradigm?.genders['Testgender']['Accusative']['Singular']).toEqual({ kind: 'prefix', text: 'er' })
    expect(paradigm?.genders['Testgender']['Nominative']['Singular']).toEqual({ kind: 'suffix', text: 'os' })
  })

  it('declines a noun using a suffixed citation form but a prefixed target ending', () => {
    const paradigm = parseNounParadigm(MIXED_DIRECTION_NOUNS_CONTENT)!
    // "Testos" strips the suffixed nominative "-os" to the stem "Test", then
    // the prefixed accusative "er-" attaches at the front instead of the end.
    expect(declineNoun(paradigm, 'Testos', 'Testgender', 'Accusative', 'Singular')).toEqual({
      form: 'erTest',
      irregular: false
    })
  })

  it('parses a prefix infinitive marker and conjugates from it', () => {
    const paradigm = parseVerbParadigm(PREFIX_INFINITIVE_VERB_CONTENT)
    expect(paradigm?.infinitive).toEqual({ kind: 'prefix', text: 'to' })
  })

  it('conjugates a verb whose citation form uses a prefixed infinitive marker', () => {
    const paradigm = parseVerbParadigm(PREFIX_INFINITIVE_VERB_CONTENT)!
    // "toRun" strips the prefixed infinitive "to-" to the root "Run", then
    // the suffixed present 1st singular "-a" attaches normally at the end.
    expect(conjugateVerb(paradigm, paradigm, 'toRun', 'Present', '1st', 'Singular')).toBe('Runa')
  })

  it('returns null when a prefix infinitive marker is missing from the citation form', () => {
    const paradigm = parseVerbParadigm(PREFIX_INFINITIVE_VERB_CONTENT)!
    expect(conjugateVerb(paradigm, paradigm, 'Run', 'Present', '1st', 'Singular')).toBeNull()
  })
})

describe('declineNoun', () => {
  const paradigm = parseNounParadigm(NOUNS_CONTENT)!

  it('declines a regular neuter noun (Nerini "weapon" -> accusative singular)', () => {
    // Worked out by hand earlier in this conversation as "Nerinis"
    expect(declineNoun(paradigm, 'Nerini', 'Neuter', 'Accusative', 'Singular')).toEqual({
      form: 'Nerinis',
      irregular: false
    })
  })

  it('declines a regular feminine noun (Talthu "hoard" -> dative singular)', () => {
    // Worked out by hand as "Talthum"
    expect(declineNoun(paradigm, 'Talthu', 'Feminine', 'Dative', 'Singular')).toEqual({
      form: 'Talthum',
      irregular: false
    })
  })

  it('handles an irregular noun by appending the ending directly (Varil "gold" -> accusative singular)', () => {
    // Varil doesn't end in the neuter nominative singular "-i", so there's
    // nothing to strip — worked out by hand earlier as "Varilis"
    expect(declineNoun(paradigm, 'Varil', 'Neuter', 'Accusative', 'Singular')).toEqual({
      form: 'Varilis',
      irregular: true
    })
  })

  it('leaves an irregular noun unchanged when it already ends with the target ending', () => {
    expect(declineNoun(paradigm, 'Varilis', 'Neuter', 'Accusative', 'Singular')).toEqual({
      form: 'Varilis',
      irregular: true
    })
  })

  it('returns null for an unknown gender', () => {
    expect(declineNoun(paradigm, 'Nerini', 'Common', 'Accusative', 'Singular')).toBeNull()
  })
})

describe('conjugateVerb', () => {
  const active = parseVerbParadigm(VERBS_ACTIVE_CONTENT)!
  const passive = parseVerbParadigm(VERBS_PASSIVE_CONTENT)!

  it('conjugates active past 1st singular (Fasilis "create" -> "Fasilon")', () => {
    // Worked out by hand earlier in this conversation
    expect(conjugateVerb(active, active, 'Fasilis', 'Past', '1st', 'Singular')).toBe('Fasilon')
  })

  it('conjugates passive present 3rd singular using the active infinitive to find the root (Bathis "hold" -> "Bathathsa")', () => {
    // The dictionary form is "Bathis" (active infinitive), not "Bathissa" —
    // the root must come from stripping the active marker even when the
    // target paradigm is passive.
    expect(conjugateVerb(active, passive, 'Bathis', 'Present', '3rd', 'Singular')).toBe('Bathathsa')
  })

  it('returns null when the citation form does not carry the active infinitive marker', () => {
    expect(conjugateVerb(active, active, 'Fasil', 'Past', '1st', 'Singular')).toBeNull()
  })
})
