import { describe, it, expect } from 'vitest'
import { generateSyntheticName, PHONETIC_PROFILES, SYLLABLE_BANK, type PhoneticProfile } from '../src/common/phoneticNames'

function seededRng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('SYLLABLE_BANK', () => {
  it('has syllables in every position with at least one tag each', () => {
    for (const position of ['start', 'middle', 'end'] as const) {
      const pool = SYLLABLE_BANK.filter((s) => s.position === position)
      expect(pool.length, `${position} pool`).toBeGreaterThan(0)
      expect(pool.every((s) => s.tags.length > 0)).toBe(true)
    }
  })
})

describe('PHONETIC_PROFILES', () => {
  it('ships exactly the 2 proof-of-concept profiles', () => {
    expect(PHONETIC_PROFILES.map((p) => p.id).sort()).toEqual(['elvish-leaning', 'harsh-guttural'])
  })
})

describe('generateSyntheticName', () => {
  it('produces a capitalized "First Last" pair', () => {
    const name = generateSyntheticName(PHONETIC_PROFILES[0], seededRng(1))
    const parts = name.split(' ')
    expect(parts).toHaveLength(2)
    for (const part of parts) {
      expect(part[0]).toBe(part[0].toUpperCase())
    }
  })

  it('is deterministic given the same rng', () => {
    const a = generateSyntheticName(PHONETIC_PROFILES[0], seededRng(99))
    const b = generateSyntheticName(PHONETIC_PROFILES[0], seededRng(99))
    expect(a).toBe(b)
  })

  it('produces names within the profile\'s syllable count range', () => {
    const shortProfile: PhoneticProfile = { ...PHONETIC_PROFILES[0], syllableMin: 2, syllableMax: 2 }
    // 2 fixed syllables (start + end, no middle) — every generated word
    // should be short since it's built from exactly 2 syllable chunks.
    const rng = seededRng(5)
    for (let i = 0; i < 20; i++) {
      const name = generateSyntheticName(shortProfile, rng)
      for (const word of name.split(' ')) {
        expect(word.length).toBeGreaterThan(0)
        expect(word.length).toBeLessThanOrEqual(10)
      }
    }
  })

  it('never produces a word with 3+ consecutive vowels, 4+ consecutive consonants, a tripled letter, or over 10 characters', () => {
    // Regression coverage for the reported bad case: "Shae" + "essa" + "wyn"
    // -> "Shaeessawyn" (a-e-e triple-vowel seam, 11 characters).
    const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])
    const isPronounceable = (word: string): boolean => {
      if (word.length > 10) return false
      if (/(.)\1\1/i.test(word)) return false
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

    const rng = seededRng(7)
    for (const profile of PHONETIC_PROFILES) {
      for (let i = 0; i < 300; i++) {
        const name = generateSyntheticName(profile, rng)
        for (const word of name.split(' ')) {
          expect(isPronounceable(word), `${profile.id}: "${word}" (from "${name}")`).toBe(true)
        }
      }
    }
  })

  it('the two proof-of-concept profiles produce audibly different sound palettes over many draws', () => {
    // Elvish-leaning heavily favors fricative/sibilant sounds (f, s, sh, th, v, z);
    // harsh-guttural favors plosive/guttural sounds (k, g, kh, b, d, p, t).
    const fricativeChars = /[fsvz]|th|sh/i
    const plosiveChars = /[kgbdpt]/i

    const countMatches = (profile: PhoneticProfile, pattern: RegExp): number => {
      const rng = seededRng(42)
      let count = 0
      for (let i = 0; i < 200; i++) {
        if (pattern.test(generateSyntheticName(profile, rng))) count++
      }
      return count
    }

    const elvish = PHONETIC_PROFILES.find((p) => p.id === 'elvish-leaning')!
    const harsh = PHONETIC_PROFILES.find((p) => p.id === 'harsh-guttural')!

    const elvishFricative = countMatches(elvish, fricativeChars)
    const harshFricative = countMatches(harsh, fricativeChars)
    const elvishPlosive = countMatches(elvish, plosiveChars)
    const harshPlosive = countMatches(harsh, plosiveChars)

    expect(elvishFricative).toBeGreaterThan(harshFricative)
    expect(harshPlosive).toBeGreaterThan(elvishPlosive)
  })
})
