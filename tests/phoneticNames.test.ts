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
  it('ships the 2 proof-of-concept profiles plus the 6 expansion profiles (8 total)', () => {
    expect(PHONETIC_PROFILES.map((p) => p.id).sort()).toEqual([
      'aquatic',
      'celestial-ethereal',
      'draconic',
      'elvish-leaning',
      'fey-whimsical',
      'harsh-guttural',
      'insectoid-alien',
      'stony-giant-kin'
    ])
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

  it('draconic sounds distinct from harsh-guttural despite both leaning plosive/guttural — long vowels vs short', () => {
    // Both favor plosive/guttural consonants (so a generic plosive/guttural
    // character check wouldn't discriminate them), but draconic was built
    // specifically to differ from harsh-guttural on vowel LENGTH (weighty/
    // drawn-out vs clipped) — see phoneticNames.ts's syllable-bank comment
    // for the guttural+long-vowel syllables (Khaa/Vraa/graa/graun) added
    // specifically to back this profile up, since the original bank had
    // none. "aa"/"au" is the open-long-vowel spelling those (and a couple of
    // other long-vowel syllables in the bank) use; harsh-guttural's
    // short-vowel syllables (Khaz, Hra, khor, ak, ug, gnar, zog, ...) never
    // spell a vowel doubled/diphthonged this way.
    const longVowelMarkers = /aa|au/i

    const countMatches = (profile: PhoneticProfile, pattern: RegExp): number => {
      const rng = seededRng(11)
      let count = 0
      for (let i = 0; i < 300; i++) {
        if (pattern.test(generateSyntheticName(profile, rng))) count++
      }
      return count
    }

    const draconic = PHONETIC_PROFILES.find((p) => p.id === 'draconic')!
    const harsh = PHONETIC_PROFILES.find((p) => p.id === 'harsh-guttural')!

    expect(countMatches(draconic, longVowelMarkers)).toBeGreaterThan(countMatches(harsh, longVowelMarkers))
  })

  it('fey-whimsical favors nasal/liquid/long sounds far more than harsh-guttural', () => {
    const feyMarkers = /nyo|lae|loon|lyoo/i
    const countMatches = (profile: PhoneticProfile, pattern: RegExp): number => {
      const rng = seededRng(12)
      let count = 0
      for (let i = 0; i < 300; i++) {
        if (pattern.test(generateSyntheticName(profile, rng))) count++
      }
      return count
    }
    const fey = PHONETIC_PROFILES.find((p) => p.id === 'fey-whimsical')!
    const harsh = PHONETIC_PROFILES.find((p) => p.id === 'harsh-guttural')!
    expect(countMatches(fey, feyMarkers)).toBeGreaterThan(countMatches(harsh, feyMarkers))
  })

  it('aquatic favors sibilant+liquid+long sounds far more than stony-giant-kin', () => {
    const aquaticMarkers = /zhae|zhoo|shaal/i
    const countMatches = (profile: PhoneticProfile, pattern: RegExp): number => {
      const rng = seededRng(13)
      let count = 0
      for (let i = 0; i < 300; i++) {
        if (pattern.test(generateSyntheticName(profile, rng))) count++
      }
      return count
    }
    const aquatic = PHONETIC_PROFILES.find((p) => p.id === 'aquatic')!
    const stony = PHONETIC_PROFILES.find((p) => p.id === 'stony-giant-kin')!
    expect(countMatches(aquatic, aquaticMarkers)).toBeGreaterThan(countMatches(stony, aquaticMarkers))
  })

  it('stony-giant-kin favors plosive/nasal/short sounds far more than elvish-leaning or celestial-ethereal', () => {
    const plosiveChars = /[kgbdpt]/i
    const countMatches = (profile: PhoneticProfile, pattern: RegExp): number => {
      const rng = seededRng(14)
      let count = 0
      for (let i = 0; i < 200; i++) {
        if (pattern.test(generateSyntheticName(profile, rng))) count++
      }
      return count
    }
    const stony = PHONETIC_PROFILES.find((p) => p.id === 'stony-giant-kin')!
    const elvish = PHONETIC_PROFILES.find((p) => p.id === 'elvish-leaning')!
    const celestial = PHONETIC_PROFILES.find((p) => p.id === 'celestial-ethereal')!
    expect(countMatches(stony, plosiveChars)).toBeGreaterThan(countMatches(elvish, plosiveChars))
    expect(countMatches(stony, plosiveChars)).toBeGreaterThan(countMatches(celestial, plosiveChars))
  })

  it('celestial-ethereal favors fricative/liquid/long sounds far more than harsh-guttural', () => {
    const fricativeChars = /[fsvz]|th|sh/i
    const countMatches = (profile: PhoneticProfile, pattern: RegExp): number => {
      const rng = seededRng(15)
      let count = 0
      for (let i = 0; i < 200; i++) {
        if (pattern.test(generateSyntheticName(profile, rng))) count++
      }
      return count
    }
    const celestial = PHONETIC_PROFILES.find((p) => p.id === 'celestial-ethereal')!
    const harsh = PHONETIC_PROFILES.find((p) => p.id === 'harsh-guttural')!
    expect(countMatches(celestial, fricativeChars)).toBeGreaterThan(countMatches(harsh, fricativeChars))
  })

  it('insectoid-alien favors affricate/sibilant/short "clicking" sounds far more than elvish-leaning or fey-whimsical', () => {
    const insectoidMarkers = /tzi|tza|chik|tik|chiss/i
    const countMatches = (profile: PhoneticProfile, pattern: RegExp): number => {
      const rng = seededRng(16)
      let count = 0
      for (let i = 0; i < 300; i++) {
        if (pattern.test(generateSyntheticName(profile, rng))) count++
      }
      return count
    }
    const insectoid = PHONETIC_PROFILES.find((p) => p.id === 'insectoid-alien')!
    const elvish = PHONETIC_PROFILES.find((p) => p.id === 'elvish-leaning')!
    const fey = PHONETIC_PROFILES.find((p) => p.id === 'fey-whimsical')!
    expect(countMatches(insectoid, insectoidMarkers)).toBeGreaterThan(countMatches(elvish, insectoidMarkers))
    expect(countMatches(insectoid, insectoidMarkers)).toBeGreaterThan(countMatches(fey, insectoidMarkers))
  })
})
