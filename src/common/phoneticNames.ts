// A different name-generation mechanism from settlementNames.ts's whole-name
// pools: instead of picking a pre-written name, a PhoneticProfile weights
// which small syllable chunks get combined into one, letting a custom race
// have a distinctive INVENTED sound (e.g. "elves lean on f/s/sh sounds")
// without hand-writing a name list for every conceivable fantasy race. This
// is a proof-of-concept sized bank (~54 syllables, 2 contrasting profiles)
// meant to be iterated on — confirmed with the user as a starting point, not
// a finished feature. Deliberately a separate, third option alongside
// baseline races and inspiration-source pooling (see CustomRaceDef in
// noteTypes/settlement.ts) rather than combinable with either — keeps
// "pick from a list" and "synthesize from sound" from tangling together.

export const PHONETIC_MANNER_TAGS = ['fricative', 'plosive', 'nasal', 'liquid', 'sibilant', 'affricate'] as const
export const PHONETIC_PLACE_TAGS = ['front-of-mouth', 'back-of-mouth', 'guttural'] as const
export const PHONETIC_VOWEL_TAGS = ['long-vowel', 'short-vowel'] as const
export const PHONETIC_TAGS = [...PHONETIC_MANNER_TAGS, ...PHONETIC_PLACE_TAGS, ...PHONETIC_VOWEL_TAGS] as const
export type PhoneticTag = (typeof PHONETIC_TAGS)[number]

export type SyllablePosition = 'start' | 'middle' | 'end'

export interface PhoneticSyllable {
  text: string
  position: SyllablePosition
  tags: PhoneticTag[]
}

export interface PhoneticProfile {
  id: string
  name: string
  description: string
  // Missing tags default to a small flat weight (see TAG_DEFAULT_WEIGHT) so
  // no syllable is ever literally unreachable — a profile just makes some
  // sounds much more likely than others, not exclusive.
  tagWeights: Partial<Record<PhoneticTag, number>>
  syllableMin: number
  syllableMax: number
}

// ~18 syllables per position. Tags are a game-flavor approximation of real
// phonetics, not a linguistics-accurate IPA breakdown — good enough to make
// two profiles sound clearly distinct, which is the actual goal.
export const SYLLABLE_BANK: PhoneticSyllable[] = [
  // start
  { text: 'Fae', position: 'start', tags: ['fricative', 'front-of-mouth', 'long-vowel'] },
  { text: 'Sil', position: 'start', tags: ['fricative', 'sibilant', 'front-of-mouth', 'short-vowel'] },
  { text: 'Shae', position: 'start', tags: ['fricative', 'sibilant', 'front-of-mouth', 'long-vowel'] },
  { text: 'Vel', position: 'start', tags: ['fricative', 'front-of-mouth', 'short-vowel'] },
  { text: 'Thal', position: 'start', tags: ['fricative', 'front-of-mouth', 'short-vowel'] },
  { text: 'El', position: 'start', tags: ['liquid', 'front-of-mouth', 'short-vowel'] },
  { text: 'Lu', position: 'start', tags: ['liquid', 'front-of-mouth', 'short-vowel'] },
  { text: 'Mi', position: 'start', tags: ['nasal', 'front-of-mouth', 'short-vowel'] },
  { text: 'Nae', position: 'start', tags: ['nasal', 'front-of-mouth', 'long-vowel'] },
  { text: 'Grak', position: 'start', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'Kor', position: 'start', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'Gor', position: 'start', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'Bru', position: 'start', tags: ['plosive', 'front-of-mouth', 'short-vowel'] },
  { text: 'Dra', position: 'start', tags: ['plosive', 'front-of-mouth', 'short-vowel'] },
  { text: 'Khaz', position: 'start', tags: ['plosive', 'guttural', 'back-of-mouth', 'short-vowel'] },
  { text: 'Ug', position: 'start', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'Hra', position: 'start', tags: ['fricative', 'guttural', 'back-of-mouth', 'short-vowel'] },
  { text: 'Cha', position: 'start', tags: ['affricate', 'front-of-mouth', 'short-vowel'] },
  // middle
  { text: 'wen', position: 'middle', tags: ['nasal', 'front-of-mouth', 'short-vowel'] },
  { text: 'riel', position: 'middle', tags: ['liquid', 'front-of-mouth', 'long-vowel'] },
  { text: 'shi', position: 'middle', tags: ['fricative', 'sibilant', 'front-of-mouth', 'short-vowel'] },
  { text: 'vash', position: 'middle', tags: ['fricative', 'sibilant', 'front-of-mouth', 'short-vowel'] },
  { text: 'thil', position: 'middle', tags: ['fricative', 'front-of-mouth', 'short-vowel'] },
  { text: 'lora', position: 'middle', tags: ['liquid', 'front-of-mouth', 'long-vowel'] },
  { text: 'mira', position: 'middle', tags: ['nasal', 'front-of-mouth', 'long-vowel'] },
  { text: 'nel', position: 'middle', tags: ['nasal', 'front-of-mouth', 'short-vowel'] },
  { text: 'gor', position: 'middle', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'dun', position: 'middle', tags: ['plosive', 'front-of-mouth', 'short-vowel'] },
  { text: 'krag', position: 'middle', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'thok', position: 'middle', tags: ['fricative', 'plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'zul', position: 'middle', tags: ['fricative', 'sibilant', 'back-of-mouth', 'short-vowel'] },
  { text: 'grim', position: 'middle', tags: ['plosive', 'front-of-mouth', 'short-vowel'] },
  { text: 'khor', position: 'middle', tags: ['plosive', 'guttural', 'back-of-mouth', 'short-vowel'] },
  { text: 'vor', position: 'middle', tags: ['fricative', 'back-of-mouth', 'short-vowel'] },
  { text: 'essa', position: 'middle', tags: ['fricative', 'sibilant', 'front-of-mouth', 'short-vowel'] },
  { text: 'aeli', position: 'middle', tags: ['liquid', 'front-of-mouth', 'long-vowel'] },
  // end
  { text: 'wyn', position: 'end', tags: ['nasal', 'front-of-mouth', 'short-vowel'] },
  { text: 'iel', position: 'end', tags: ['liquid', 'front-of-mouth', 'long-vowel'] },
  { text: 'ara', position: 'end', tags: ['liquid', 'front-of-mouth', 'long-vowel'] },
  { text: 'esh', position: 'end', tags: ['fricative', 'sibilant', 'front-of-mouth', 'short-vowel'] },
  { text: 'ith', position: 'end', tags: ['fricative', 'front-of-mouth', 'short-vowel'] },
  { text: 'or', position: 'end', tags: ['liquid', 'back-of-mouth', 'short-vowel'] },
  { text: 'oth', position: 'end', tags: ['fricative', 'back-of-mouth', 'short-vowel'] },
  { text: 'ak', position: 'end', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'ug', position: 'end', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'ash', position: 'end', tags: ['fricative', 'sibilant', 'front-of-mouth', 'short-vowel'] },
  { text: 'aan', position: 'end', tags: ['nasal', 'front-of-mouth', 'long-vowel'] },
  { text: 'eth', position: 'end', tags: ['fricative', 'front-of-mouth', 'short-vowel'] },
  { text: 'orn', position: 'end', tags: ['nasal', 'back-of-mouth', 'short-vowel'] },
  { text: 'und', position: 'end', tags: ['nasal', 'plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'gnar', position: 'end', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'zog', position: 'end', tags: ['plosive', 'back-of-mouth', 'short-vowel'] },
  { text: 'vyn', position: 'end', tags: ['fricative', 'nasal', 'front-of-mouth', 'short-vowel'] },
  { text: 'aelle', position: 'end', tags: ['liquid', 'front-of-mouth', 'long-vowel'] }
]

// Proof-of-concept pair chosen to sound clearly different from each other —
// matches the user's own example ("elves lean on f/s/sh sounds") against an
// opposite, harsher profile. Iterate/add more once these are reviewed.
export const PHONETIC_PROFILES: PhoneticProfile[] = [
  {
    id: 'elvish-leaning',
    name: 'Elvish-leaning (soft, flowing)',
    description: 'Favors fricative/sibilant sounds (f, s, sh, th), front-of-mouth articulation, and long vowels.',
    tagWeights: {
      fricative: 4,
      sibilant: 4,
      'front-of-mouth': 3,
      'long-vowel': 3,
      liquid: 2,
      nasal: 1,
      affricate: 0.5,
      plosive: 0.3,
      'back-of-mouth': 0.3,
      guttural: 0.1,
      'short-vowel': 1
    },
    syllableMin: 2,
    syllableMax: 3
  },
  {
    id: 'harsh-guttural',
    name: 'Harsh / Guttural (heavy, grinding)',
    description: 'Favors plosive/guttural sounds (k, g, kh), back-of-mouth articulation, and short vowels.',
    tagWeights: {
      plosive: 4,
      guttural: 4,
      'back-of-mouth': 3,
      'short-vowel': 3,
      nasal: 1,
      affricate: 0.5,
      liquid: 0.5,
      fricative: 0.5,
      sibilant: 0.3,
      'front-of-mouth': 0.3,
      'long-vowel': 0.2
    },
    syllableMin: 2,
    syllableMax: 3
  }
]

const TAG_DEFAULT_WEIGHT = 0.2
const BASE_SYLLABLE_WEIGHT = 0.2

function syllableScore(syllable: PhoneticSyllable, profile: PhoneticProfile): number {
  return BASE_SYLLABLE_WEIGHT + syllable.tags.reduce((sum, tag) => sum + (profile.tagWeights[tag] ?? TAG_DEFAULT_WEIGHT), 0)
}

function pickSyllable(position: SyllablePosition, profile: PhoneticProfile, rng: () => number): string {
  const pool = SYLLABLE_BANK.filter((s) => s.position === position)
  if (pool.length === 0) return ''
  const total = pool.reduce((sum, s) => sum + syllableScore(s, profile), 0)
  let roll = rng() * total
  for (const syllable of pool) {
    roll -= syllableScore(syllable, profile)
    if (roll <= 0) return syllable.text
  }
  return pool[pool.length - 1].text
}

// "Reality check" so raw syllable concatenation can't produce something
// unpronounceable — caught in practice on "Shae" + "essa" + "wyn" ->
// "Shaeessawyn" (a-e-e triple-vowel pileup at the seam, 11 characters).
// Deliberately simple heuristics, not real phonotactics: long consecutive
// runs of vowels or consonants, a tripled letter, or excess length are the
// actual failure modes seen in testing, not subtler pronounceability rules.
const MAX_WORD_LENGTH = 10
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

function isPronounceable(word: string): boolean {
  if (word.length === 0 || word.length > MAX_WORD_LENGTH) return false
  if (/(.)\1\1/i.test(word)) return false // any letter tripled in a row ("sss", "aaa")

  let vowelRun = 0
  let consonantRun = 0
  for (const ch of word.toLowerCase()) {
    if (VOWELS.has(ch)) {
      vowelRun++
      consonantRun = 0
      if (vowelRun >= 3) return false
    } else {
      consonantRun++
      vowelRun = 0
      if (consonantRun >= 4) return false
    }
  }
  return true
}

// Regenerating a few times and keeping the first pronounceable result reads
// better than filtering the syllable bank itself — the same syllable is
// fine in most combinations and only occasionally seams badly with its
// neighbor, so retrying the combination (not the syllable choice) is the
// right level to fix this at.
const MAX_SYNTHESIS_ATTEMPTS = 8

function synthesizeWord(profile: PhoneticProfile, rng: () => number): string {
  let fallback = ''
  for (let attempt = 0; attempt < MAX_SYNTHESIS_ATTEMPTS; attempt++) {
    const count = Math.floor(rng() * (profile.syllableMax - profile.syllableMin + 1)) + profile.syllableMin
    const parts: string[] = []
    for (let i = 0; i < count; i++) {
      const position: SyllablePosition = i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'
      parts.push(pickSyllable(position, profile, rng))
    }
    const word = parts.join('')
    if (attempt === 0) fallback = word
    if (isPronounceable(word)) return capitalize(word)
  }
  // Every attempt failed the reality check (rare, e.g. a profile paired with
  // a near-empty syllable bank) — better to return something than nothing.
  return capitalize(fallback)
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Synthesizes a "First Last" name from a phonetic profile — two
 * independently-generated words, same as every other race in this app
 * producing a first+last pair. Not gendered in v1 (the profile describes a
 * SOUND, not a gender split) — flag if that turns out to matter once this
 * is in use.
 */
export function generateSyntheticName(profile: PhoneticProfile, rng: () => number = Math.random): string {
  return `${synthesizeWord(profile, rng)} ${synthesizeWord(profile, rng)}`
}
