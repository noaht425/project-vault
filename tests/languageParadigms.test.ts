import { describe, it, expect } from 'vitest'
import {
  parseMarkdownTables,
  parseNounParadigm,
  parseVerbParadigm,
  parsePronounParadigm,
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
  it('builds gender -> case -> number -> ending from the real Nouns table, with the notational leading hyphen stripped', () => {
    const paradigm = parseNounParadigm(NOUNS_CONTENT)
    expect(paradigm?.genders['Neuter']['Accusative']['Singular']).toBe('is')
    expect(paradigm?.genders['Feminine']['Dative']['Singular']).toBe('um')
  })
})

describe('parseVerbParadigm', () => {
  it('reads the infinitive marker and tense tables from the real Verbs (Active) content, hyphen stripped', () => {
    const paradigm = parseVerbParadigm(VERBS_ACTIVE_CONTENT)
    expect(paradigm?.infinitive).toBe('is')
    expect(paradigm?.tenses['Past']['3rd']['Singular']).toBe('en')
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
