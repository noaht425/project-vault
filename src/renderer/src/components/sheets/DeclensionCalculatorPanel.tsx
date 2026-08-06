import { useMemo, useState } from 'react'
import { parseGrammarRules, parseWordEntries, type GrammarRule } from '../../../../common/noteTypes/language'
import {
  parseNounParadigm,
  parseVerbParadigm,
  parsePronounParadigm,
  declineNoun,
  conjugateVerb,
  type NounParadigm,
  type VerbParadigm,
  type PronounParadigm
} from '../../../../common/noteTypes/languageParadigms'

function findRuleContent(rules: GrammarRule[], name: string): string | null {
  return rules.find((r) => r.name.toLowerCase() === name.toLowerCase())?.content ?? null
}

function NounCalculator({ paradigm, nouns }: { paradigm: NounParadigm; nouns: string[] }): React.JSX.Element {
  const genders = Object.keys(paradigm.genders)
  const [word, setWord] = useState('')
  const [genderChoice, setGenderChoice] = useState('')
  const gender = genders.includes(genderChoice) ? genderChoice : genders[0]

  const cases = Object.keys(paradigm.genders[gender] ?? {})
  const [caseChoice, setCaseChoice] = useState('')
  const caseName = cases.includes(caseChoice) ? caseChoice : cases[0]

  const numbers = Object.keys(paradigm.genders[gender]?.[caseName] ?? {})
  const [numberChoice, setNumberChoice] = useState('')
  const number = numbers.includes(numberChoice) ? numberChoice : numbers[0]

  const result =
    word.trim() && gender && caseName && number ? declineNoun(paradigm, word.trim(), gender, caseName, number) : null

  return (
    <div className="calc-block">
      <div className="calc-row">
        <input
          className="calc-word-input"
          list="noun-calc-words"
          placeholder="word (citation form)"
          value={word}
          onChange={(e) => setWord(e.target.value)}
        />
        <datalist id="noun-calc-words">
          {nouns.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <select value={gender} onChange={(e) => setGenderChoice(e.target.value)}>
          {genders.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select value={caseName} onChange={(e) => setCaseChoice(e.target.value)}>
          {cases.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={number} onChange={(e) => setNumberChoice(e.target.value)}>
          {numbers.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {result && (
        <div className="calc-result">
          {result.form}
          {result.irregular && <span className="calc-note"> (irregular — ending appended directly)</span>}
        </div>
      )}
    </div>
  )
}

function VerbCalculator({
  active,
  passive,
  verbs
}: {
  active: VerbParadigm
  passive: VerbParadigm | null
  verbs: string[]
}): React.JSX.Element {
  const [word, setWord] = useState('')
  const [voiceChoice, setVoiceChoice] = useState('Active')
  const voice = voiceChoice === 'Passive' && passive ? 'Passive' : 'Active'
  const paradigm = voice === 'Passive' && passive ? passive : active

  const tenses = Object.keys(paradigm.tenses)
  const [tenseChoice, setTenseChoice] = useState('')
  const tense = tenses.includes(tenseChoice) ? tenseChoice : tenses[0]

  const persons = Object.keys(paradigm.tenses[tense] ?? {})
  const [personChoice, setPersonChoice] = useState('')
  const person = persons.includes(personChoice) ? personChoice : persons[0]

  const numbers = Object.keys(paradigm.tenses[tense]?.[person] ?? {})
  const [numberChoice, setNumberChoice] = useState('')
  const number = numbers.includes(numberChoice) ? numberChoice : numbers[0]

  const result =
    word.trim() && tense && person && number
      ? conjugateVerb(active, paradigm, word.trim(), tense, person, number)
      : null

  return (
    <div className="calc-block">
      <div className="calc-row">
        <input
          className="calc-word-input"
          list="verb-calc-words"
          placeholder="word (infinitive)"
          value={word}
          onChange={(e) => setWord(e.target.value)}
        />
        <datalist id="verb-calc-words">
          {verbs.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        {passive && (
          <select value={voice} onChange={(e) => setVoiceChoice(e.target.value)}>
            <option value="Active">Active</option>
            <option value="Passive">Passive</option>
          </select>
        )}
        <select value={tense} onChange={(e) => setTenseChoice(e.target.value)}>
          {tenses.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={person} onChange={(e) => setPersonChoice(e.target.value)}>
          {persons.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={number} onChange={(e) => setNumberChoice(e.target.value)}>
          {numbers.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {result && <div className="calc-result">{result}</div>}
    </div>
  )
}

function PronounTable({ label, paradigm }: { label: string; paradigm: PronounParadigm }): React.JSX.Element {
  const persons = Object.keys(paradigm.persons)
  const numbers = persons.length > 0 ? Object.keys(paradigm.persons[persons[0]]) : []
  return (
    <table className="calc-pronoun-table">
      <thead>
        <tr>
          <th>{label}</th>
          {numbers.map((n) => (
            <th key={n}>{n}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {persons.map((p) => (
          <tr key={p}>
            <td>{p}</td>
            {numbers.map((n) => (
              <td key={n}>{paradigm.persons[p][n]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Reads the same "## Grammar: Nouns" / "## Grammar: Verbs (Active/Passive)" /
// "## Grammar: Pronouns (Subject/Object)" tables GrammarRulesPanel already
// renders, but as structured paradigms — lets you pick a word (or type one
// not yet in the dictionary) plus case/tense/person/number and get the
// inflected form back, instead of reading it off the table by hand. Each
// sub-calculator only appears if the language note actually defines that
// paradigm, so a language with just a dictionary and no grammar tables yet
// renders nothing here.
export function DeclensionCalculatorPanel({ body }: { body: string }): React.JSX.Element | null {
  const rules = useMemo(() => parseGrammarRules(body), [body])
  const entries = useMemo(() => parseWordEntries(body), [body])

  const nounParadigm = useMemo(() => {
    const content = findRuleContent(rules, 'Nouns')
    return content ? parseNounParadigm(content) : null
  }, [rules])

  const verbActiveParadigm = useMemo(() => {
    const content = findRuleContent(rules, 'Verbs (Active)')
    return content ? parseVerbParadigm(content) : null
  }, [rules])

  const verbPassiveParadigm = useMemo(() => {
    const content = findRuleContent(rules, 'Verbs (Passive)')
    return content ? parseVerbParadigm(content) : null
  }, [rules])

  const pronounSubject = useMemo(() => {
    const content = findRuleContent(rules, 'Pronouns (Subject)')
    return content ? parsePronounParadigm(content) : null
  }, [rules])

  const pronounObject = useMemo(() => {
    const content = findRuleContent(rules, 'Pronouns (Object)')
    return content ? parsePronounParadigm(content) : null
  }, [rules])

  const nouns = useMemo(
    () => entries.filter((e) => e.partOfSpeech?.toLowerCase() === 'noun').map((e) => e.word),
    [entries]
  )
  const verbs = useMemo(
    () => entries.filter((e) => e.partOfSpeech?.toLowerCase() === 'verb').map((e) => e.word),
    [entries]
  )

  if (!nounParadigm && !verbActiveParadigm && !pronounSubject && !pronounObject) return null

  return (
    <div className="word-dictionary">
      <h3>Calculator</h3>
      {nounParadigm && (
        <div className="word-entry">
          <div className="word-entry-word">Noun Declension</div>
          <NounCalculator paradigm={nounParadigm} nouns={nouns} />
        </div>
      )}
      {verbActiveParadigm && (
        <div className="word-entry">
          <div className="word-entry-word">Verb Conjugation</div>
          <VerbCalculator active={verbActiveParadigm} passive={verbPassiveParadigm} verbs={verbs} />
        </div>
      )}
      {(pronounSubject || pronounObject) && (
        <div className="word-entry">
          <div className="word-entry-word">Pronouns</div>
          <div className="calc-row">
            {pronounSubject && <PronounTable label="Subject" paradigm={pronounSubject} />}
            {pronounObject && <PronounTable label="Object" paradigm={pronounObject} />}
          </div>
        </div>
      )}
    </div>
  )
}
