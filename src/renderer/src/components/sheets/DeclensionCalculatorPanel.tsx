import { useMemo, useState } from 'react'
import {
  parseGrammarRules,
  parseWordEntries,
  type GrammarRule,
  type WordEntry
} from '../../../../common/noteTypes/language'
import {
  parseNounParadigm,
  parseVerbParadigm,
  parsePronounParadigm,
  parseVowelCombinationRules,
  declineNoun,
  conjugateVerb,
  type NounParadigm,
  type VerbParadigm,
  type PronounParadigm,
  type VowelCombinationRules
} from '../../../../common/noteTypes/languageParadigms'

function findRuleContent(rules: GrammarRule[], name: string): string | null {
  return rules.find((r) => r.name.toLowerCase() === name.toLowerCase())?.content ?? null
}

// Pulls the bit in parentheses after the prefix as a mood label — "Verbs
// (Active, Indicative)" with prefix "Verbs (Active" gives "Indicative". A
// rule with no qualifier at all ("Verbs (Active)") has nothing to pull out,
// so it's labeled "Default" instead of an empty string.
function extractMoodLabel(ruleName: string, prefix: string): string {
  const rest = ruleName
    .slice(prefix.length)
    .replace(/^,\s*/, '')
    .replace(/\)\s*$/, '')
    .trim()
  return rest || 'Default'
}

// "Verbs (Active)" started out as the one and only active-voice rule, then
// became "Verbs (Active, Indicative)" once a mood qualifier was added, and
// may eventually sit alongside a separate "Verbs (Active, Subjunctive)" —
// collect every rule matching the prefix (not just the first) so each mood
// stays independently selectable instead of the newest one silently hiding
// the others.
function collectVerbParadigmsByMood(rules: GrammarRule[], prefix: string): Record<string, VerbParadigm> {
  const result: Record<string, VerbParadigm> = {}
  for (const rule of rules) {
    if (!rule.name.toLowerCase().startsWith(prefix.toLowerCase())) continue
    const paradigm = parseVerbParadigm(rule.content)
    if (paradigm) result[extractMoodLabel(rule.name, prefix)] = paradigm
  }
  return result
}

// A dictionary entry's Gender line is freeform ("Neuter", "Neuter (irregular
// in nominative singular)", etc.) — match it against the paradigm's own
// gender labels by prefix rather than requiring an exact string, so
// parenthetical notes on the entry don't break the lookup.
function resolveGenderKey(paradigm: NounParadigm, rawGender: string | null): string | null {
  if (!rawGender) return null
  const normalized = rawGender.trim().toLowerCase()
  return Object.keys(paradigm.genders).find((g) => normalized.startsWith(g.toLowerCase())) ?? null
}

// Gender isn't a free choice here the way case/number are — it's a fixed
// property of whichever word you typed, already recorded on that word's own
// dictionary entry. Forcing a separate gender selector would just be asking
// the user to repeat information the note already has.
function NounCalculator({
  paradigm,
  nouns,
  vowelRules
}: {
  paradigm: NounParadigm
  nouns: WordEntry[]
  vowelRules: VowelCombinationRules | null
}): React.JSX.Element {
  const [word, setWord] = useState('')
  const matchedEntry = useMemo(() => nouns.find((n) => n.word === word.trim()), [nouns, word])
  const gender = resolveGenderKey(paradigm, matchedEntry?.gender ?? null)

  const cases = gender ? Object.keys(paradigm.genders[gender] ?? {}) : []
  const [caseChoice, setCaseChoice] = useState('')
  const caseName = cases.includes(caseChoice) ? caseChoice : cases[0]

  const numbers = gender && caseName ? Object.keys(paradigm.genders[gender]?.[caseName] ?? {}) : []
  const [numberChoice, setNumberChoice] = useState('')
  const number = numbers.includes(numberChoice) ? numberChoice : numbers[0]

  const result =
    word.trim() && gender && caseName && number
      ? declineNoun(paradigm, word.trim(), gender, caseName, number, vowelRules)
      : null

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
            <option key={n.word} value={n.word} />
          ))}
        </datalist>
        {gender ? (
          <span className="calc-gender-badge">{gender}</span>
        ) : (
          word.trim() && (
            <span className="calc-note">
              No gender on file for "{word.trim()}" — add a "Gender:" line to its dictionary entry.
            </span>
          )
        )}
        {gender && (
          <>
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
          </>
        )}
      </div>
      {result && (
        <div className="calc-result">
          {result.form}
          {result.irregular && <span className="calc-note"> (irregular — ending attached directly)</span>}
        </div>
      )}
    </div>
  )
}

function VerbCalculator({
  activeParadigms,
  passiveParadigms,
  verbs,
  vowelRules
}: {
  activeParadigms: Record<string, VerbParadigm>
  passiveParadigms: Record<string, VerbParadigm>
  verbs: string[]
  vowelRules: VowelCombinationRules | null
}): React.JSX.Element {
  const [word, setWord] = useState('')

  const hasPassive = Object.keys(passiveParadigms).length > 0
  const [voiceChoice, setVoiceChoice] = useState('Active')
  const voice = voiceChoice === 'Passive' && hasPassive ? 'Passive' : 'Active'
  const moodParadigms = voice === 'Passive' ? passiveParadigms : activeParadigms
  const moods = Object.keys(moodParadigms)

  const [moodChoice, setMoodChoice] = useState('')
  const mood = moods.includes(moodChoice) ? moodChoice : moods[0]
  const paradigm = moodParadigms[mood]

  // The root is always found via an active-voice infinitive marker — a
  // language's infinitive shouldn't vary by mood, so any active paradigm
  // works for this regardless of which mood is currently selected.
  const rootParadigm = Object.values(activeParadigms)[0]

  const tenses = paradigm ? Object.keys(paradigm.tenses) : []
  const [tenseChoice, setTenseChoice] = useState('')
  const tense = tenses.includes(tenseChoice) ? tenseChoice : tenses[0]

  const persons = paradigm ? Object.keys(paradigm.tenses[tense] ?? {}) : []
  const [personChoice, setPersonChoice] = useState('')
  const person = persons.includes(personChoice) ? personChoice : persons[0]

  const numbers = paradigm ? Object.keys(paradigm.tenses[tense]?.[person] ?? {}) : []
  const [numberChoice, setNumberChoice] = useState('')
  const number = numbers.includes(numberChoice) ? numberChoice : numbers[0]

  const result =
    word.trim() && paradigm && tense && person && number
      ? conjugateVerb(rootParadigm, paradigm, word.trim(), tense, person, number, vowelRules)
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
        {hasPassive && (
          <select value={voice} onChange={(e) => setVoiceChoice(e.target.value)}>
            <option value="Active">Active</option>
            <option value="Passive">Passive</option>
          </select>
        )}
        {moods.length > 1 && (
          <select value={mood} onChange={(e) => setMoodChoice(e.target.value)}>
            {moods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
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

  const verbActiveParadigms = useMemo(() => collectVerbParadigmsByMood(rules, 'Verbs (Active'), [rules])
  const verbPassiveParadigms = useMemo(() => collectVerbParadigmsByMood(rules, 'Verbs (Passive'), [rules])

  const vowelRules = useMemo(() => {
    const content = findRuleContent(rules, 'Vowel Combinations')
    return content ? parseVowelCombinationRules(content) : null
  }, [rules])

  const pronounSubject = useMemo(() => {
    const content = findRuleContent(rules, 'Pronouns (Subject)')
    return content ? parsePronounParadigm(content) : null
  }, [rules])

  const pronounObject = useMemo(() => {
    const content = findRuleContent(rules, 'Pronouns (Object)')
    return content ? parsePronounParadigm(content) : null
  }, [rules])

  const nouns = useMemo(() => entries.filter((e) => e.partOfSpeech?.toLowerCase() === 'noun'), [entries])
  const verbs = useMemo(
    () => entries.filter((e) => e.partOfSpeech?.toLowerCase() === 'verb').map((e) => e.word),
    [entries]
  )

  const hasVerbs = Object.keys(verbActiveParadigms).length > 0

  if (!nounParadigm && !hasVerbs && !pronounSubject && !pronounObject) return null

  return (
    <div className="word-dictionary">
      <h3>Calculator</h3>
      {nounParadigm && (
        <div className="word-entry">
          <div className="word-entry-word">Noun Declension</div>
          <NounCalculator paradigm={nounParadigm} nouns={nouns} vowelRules={vowelRules} />
        </div>
      )}
      {hasVerbs && (
        <div className="word-entry">
          <div className="word-entry-word">Verb Conjugation</div>
          <VerbCalculator
            activeParadigms={verbActiveParadigms}
            passiveParadigms={verbPassiveParadigms}
            verbs={verbs}
            vowelRules={vowelRules}
          />
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
