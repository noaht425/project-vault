// Notable-only appearance prose (same cost/scope lever as stats/goal/
// personality — stub residents never get this). Generic per-race content
// pools, same "mechanism not content" spirit as everything else seeded in
// this feature; a first pass meant to be iterated on, not a finished
// linguistics-grade generator.

export interface AppearanceProfile {
  // Dragonborn have scales, not hair — hasHair:false swaps the opening line
  // for a scale-color one and skips the separate skin-tone line entirely
  // (the scale color already covers it).
  hasHair: boolean
  hairColors: string[]
  scaleColors: string[]
  eyeColors: string[]
  skinTones: string[]
  canGrowFacialHair: boolean
  // Race-specific traits (tusks, horns, tattoos, ...) — empty for races
  // with nothing distinctive beyond skin/hair/eyes.
  specialFeatures: string[]
  heightRangeCm: [number, number]
}

const BUILDS = ['skinny', 'slim', 'athletic', 'average', 'stocky', 'muscular', 'heavyset']
const HAIR_LENGTHS = ['short', 'medium-length', 'long', 'very long', 'shoulder-length', 'closely-cropped']
const HAIR_TEXTURES = ['straight', 'wavy', 'curly', 'thick', 'fine', 'braided']
const HAIR_MODIFIERS = ['that is beginning to thin', 'streaked with gray', 'tied back in a tight knot', 'kept in a single braid']
const FACIAL_HAIR_STYLES = ['a short beard', 'a long beard', 'a thick mustache', 'stubble', 'a neatly trimmed goatee', 'thick sideburns']
const DEFAULT_EYE_COLORS = ['blue', 'green', 'brown', 'hazel', 'gray', 'amber', 'blue-gray', 'green-gray', 'dark brown', 'black']

const APPEARANCE_PROFILES: Record<string, AppearanceProfile> = {
  human: {
    hasHair: true,
    hairColors: ['black', 'brown', 'dark brown', 'auburn', 'red', 'orange', 'blonde', 'sandy blonde', 'gray', 'white'],
    scaleColors: [],
    eyeColors: DEFAULT_EYE_COLORS,
    skinTones: ['pale', 'fair', 'light tan', 'olive', 'tan', 'brown', 'dark brown', 'deep brown'],
    canGrowFacialHair: true,
    specialFeatures: [],
    heightRangeCm: [150, 195]
  },
  elf: {
    hasHair: true,
    hairColors: ['silver', 'white', 'black', 'golden blonde', 'copper', 'pale blonde'],
    scaleColors: [],
    eyeColors: [...DEFAULT_EYE_COLORS, 'violet'],
    skinTones: ['pale', 'fair', 'light golden', 'light brown', 'bronze'],
    canGrowFacialHair: false,
    specialFeatures: [],
    heightRangeCm: [155, 190]
  },
  dwarf: {
    hasHair: true,
    hairColors: ['black', 'brown', 'red', 'auburn', 'gray', 'white', 'iron-gray'],
    scaleColors: [],
    eyeColors: DEFAULT_EYE_COLORS,
    skinTones: ['ruddy', 'tan', 'brown', 'pale', 'deep tan'],
    canGrowFacialHair: true,
    specialFeatures: [],
    heightRangeCm: [122, 145]
  },
  halfling: {
    hasHair: true,
    hairColors: ['brown', 'black', 'sandy blonde', 'auburn'],
    scaleColors: [],
    eyeColors: DEFAULT_EYE_COLORS,
    skinTones: ['tan', 'light brown', 'ruddy', 'fair'],
    canGrowFacialHair: true,
    specialFeatures: [],
    heightRangeCm: [85, 110]
  },
  dragonborn: {
    hasHair: false,
    hairColors: [],
    scaleColors: ['red', 'gold', 'bronze', 'copper', 'black', 'white', 'blue', 'green', 'brass', 'silver'],
    eyeColors: ['gold', 'amber', 'red', 'black', 'yellow'],
    skinTones: [],
    canGrowFacialHair: false,
    specialFeatures: ['small horn ridges above the brow', 'a faint crest running down the back of the neck'],
    heightRangeCm: [180, 220]
  },
  tiefling: {
    hasHair: true,
    hairColors: ['black', 'dark red', 'deep purple', 'white', 'blue-black'],
    scaleColors: [],
    eyeColors: ['solid red', 'solid black', 'gold', 'violet', 'silver'],
    skinTones: ['deep red', 'maroon', 'dark purple', 'ashen gray', 'deep blue'],
    canGrowFacialHair: true,
    specialFeatures: ['small curved horns', 'a thin tail that flicks when they get tense'],
    heightRangeCm: [160, 195]
  },
  orc: {
    hasHair: true,
    hairColors: ['black', 'dark brown', 'gray'],
    scaleColors: [],
    eyeColors: [...DEFAULT_EYE_COLORS, 'red', 'yellow'],
    skinTones: ['dark green', 'olive green', 'gray-green', 'dark pink', 'ashen gray'],
    canGrowFacialHair: true,
    specialFeatures: ['small tusks', 'medium-sized broken tusks', 'large tusks'],
    heightRangeCm: [170, 200]
  },
  goliath: {
    hasHair: true,
    hairColors: ['black', 'dark brown', 'gray', 'white'],
    scaleColors: [],
    eyeColors: DEFAULT_EYE_COLORS,
    skinTones: ['gray', 'pale gray-blue', 'stone gray', 'light gray with dark speckles'],
    canGrowFacialHair: true,
    specialFeatures: ['ritual tattoos across the shoulders', 'pale birthmark-like patterns across the skin'],
    heightRangeCm: [195, 230]
  }
}

const FALLBACK_APPEARANCE_PROFILE: AppearanceProfile = APPEARANCE_PROFILES.human

function resolveAppearanceProfile(race: string): AppearanceProfile {
  return APPEARANCE_PROFILES[race] ?? FALLBACK_APPEARANCE_PROFILE
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]
}

function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function cmToFeetInches(cm: number): string {
  const totalInches = cm / 2.54
  const feet = Math.floor(totalInches / 12)
  const inches = Math.round(totalInches % 12)
  return `${feet}′ ${inches}″`
}

export function generateAppearance(race: string, gender: string, rng: () => number = Math.random): string {
  const profile = resolveAppearanceProfile(race)
  const lines: string[] = []

  if (profile.hasHair) {
    const length = pick(HAIR_LENGTHS, rng)
    const texture = pick(HAIR_TEXTURES, rng)
    const color = pick(profile.hairColors, rng)
    const modifier = rng() < 0.2 ? `, ${pick(HAIR_MODIFIERS, rng)}` : ''
    lines.push(`Has ${length}, ${texture} ${color} hair${modifier}, and ${pick(profile.eyeColors, rng)} eyes.`)
  } else {
    lines.push(`Has ${pick(profile.scaleColors, rng)} scales, and ${pick(profile.eyeColors, rng)} eyes.`)
  }

  if (profile.canGrowFacialHair && gender === 'Male') {
    lines.push(rng() < 0.6 ? `Has ${pick(FACIAL_HAIR_STYLES, rng)}.` : 'Is clean shaven.')
  }

  if (profile.specialFeatures.length > 0 && rng() < 0.7) {
    lines.push(`Has ${pick(profile.specialFeatures, rng)}.`)
  }

  if (profile.hasHair) {
    lines.push(`Has ${pick(profile.skinTones, rng)} skin.`)
  }

  const heightCm = randomInt(profile.heightRangeCm[0], profile.heightRangeCm[1], rng)
  const build = pick(BUILDS, rng)
  const article = /^[aeiou]/i.test(build) ? 'an' : 'a'
  lines.push(`Stands ${heightCm}cm (${cmToFeetInches(heightCm)}) tall and has ${article} ${build} build.`)

  return lines.join('\n')
}
