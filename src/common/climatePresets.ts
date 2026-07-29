// Starting points for a new climate note, built from real-world climate
// classification (Köppen groups, NOAA's five-group breakdown, and common
// named archetypes like "Mediterranean" or "Tundra") — a curated set of 12
// recognizable types rather than every formal Köppen subtype (e.g. no
// separate Af/Am/Aw), since the point is a useful flavor starting point for
// a GM, not a scientifically exhaustive lookup. Each preset just pre-fills
// climate.ts's existing seasons/conditions shape — there's no separate
// "preset library" concept at runtime, so once applied the result is an
// ordinary climate note, editable the same as a hand-built one.
import type { ClimateSeason } from './noteTypes/climate'

export interface ClimatePresetCondition {
  name: string
  weight: number
}

export interface ClimatePresetSeason {
  name: string
  // Relative share of the year this season covers — the preset's fractions
  // don't need to sum to exactly 1 (applyClimatePreset normalizes), but are
  // written that way here for readability. Calendar months are assigned to
  // seasons in chronological order by cumulative fraction (see
  // applyClimatePreset) since an arbitrary fantasy calendar's month order
  // has no inherent tie to real-world seasons — there's no way to know
  // which of the user's months is "actually" winter.
  fractionOfYear: number
  conditions: ClimatePresetCondition[]
}

export interface ClimatePreset {
  id: string
  name: string
  koppenCodes: string // shown as a short reference tag in the picker, not used programmatically
  description: string
  seasons: ClimatePresetSeason[]
}

export const CLIMATE_PRESETS: ClimatePreset[] = [
  {
    id: 'tropical-rainforest',
    name: 'Tropical Rainforest',
    koppenCodes: 'Af, Am',
    description: 'Hot and humid year-round, rain most days, barely any seasonal variation.',
    seasons: [
      {
        name: 'Wet Season',
        fractionOfYear: 1,
        conditions: [
          { name: 'Afternoon thunderstorms', weight: 4 },
          { name: 'Heavy rain', weight: 3 },
          { name: 'Hot and humid, overcast', weight: 3 },
          { name: 'Clear and steamy', weight: 1 }
        ]
      }
    ]
  },
  {
    id: 'tropical-savanna',
    name: 'Tropical Savanna',
    koppenCodes: 'Aw',
    description: 'Hot year-round with one sharply defined wet season and one sharply defined dry season.',
    seasons: [
      {
        name: 'Wet Season',
        fractionOfYear: 0.5,
        conditions: [
          { name: 'Heavy downpour', weight: 4 },
          { name: 'Thunderstorms', weight: 3 },
          { name: 'Hot and humid', weight: 2 },
          { name: 'Brief clear spell', weight: 1 }
        ]
      },
      {
        name: 'Dry Season',
        fractionOfYear: 0.5,
        conditions: [
          { name: 'Clear and hot', weight: 5 },
          { name: 'Dusty haze', weight: 2 },
          { name: 'Scattered clouds', weight: 2 },
          { name: 'Rare shower', weight: 1 }
        ]
      }
    ]
  },
  {
    id: 'desert',
    name: 'Desert (Arid)',
    koppenCodes: 'BWh, BWk',
    description: 'Scorching days, huge day-night temperature swings, and almost no rain all year.',
    seasons: [
      {
        name: 'Scorching Season',
        fractionOfYear: 0.5,
        conditions: [
          { name: 'Clear and scorching', weight: 5 },
          { name: 'Clear and hot', weight: 3 },
          { name: 'Hazy heat shimmer', weight: 2 },
          { name: 'Sandstorm', weight: 1 }
        ]
      },
      {
        name: 'Cool Season',
        fractionOfYear: 0.5,
        conditions: [
          { name: 'Clear and mild', weight: 4 },
          { name: 'Clear and warm', weight: 3 },
          { name: 'Cold, biting wind', weight: 2 },
          { name: 'Rare shower', weight: 1 }
        ]
      }
    ]
  },
  {
    id: 'steppe',
    name: 'Semi-Arid (Steppe)',
    koppenCodes: 'BSh, BSk',
    description: 'Dry grassland climate — hotter and less extreme than true desert, with a modest rainy season.',
    seasons: [
      {
        name: 'Dry Season',
        fractionOfYear: 0.6,
        conditions: [
          { name: 'Clear and warm', weight: 4 },
          { name: 'Clear and hot', weight: 3 },
          { name: 'Dry wind', weight: 2 },
          { name: 'Dust haze', weight: 1 }
        ]
      },
      {
        name: 'Rainy Season',
        fractionOfYear: 0.4,
        conditions: [
          { name: 'Scattered showers', weight: 3 },
          { name: 'Thunderstorms', weight: 2 },
          { name: 'Clear and mild', weight: 3 },
          { name: 'Overcast', weight: 1 }
        ]
      }
    ]
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean',
    koppenCodes: 'Csa, Csb',
    description: 'Hot, dry summers and cool, wet winters.',
    seasons: [
      {
        name: 'Dry Summer',
        fractionOfYear: 0.5,
        conditions: [
          { name: 'Clear and hot', weight: 5 },
          { name: 'Clear and warm', weight: 3 },
          { name: 'Hazy sun', weight: 1 }
        ]
      },
      {
        name: 'Wet Winter',
        fractionOfYear: 0.5,
        conditions: [
          { name: 'Light rain', weight: 3 },
          { name: 'Clear and cool', weight: 3 },
          { name: 'Overcast', weight: 2 },
          { name: 'Coastal storm', weight: 1 }
        ]
      }
    ]
  },
  {
    id: 'humid-subtropical',
    name: 'Humid Subtropical',
    koppenCodes: 'Cfa, Cwa',
    description: 'Warm, humid summers with thunderstorms and mild winters — four true seasons.',
    seasons: [
      {
        name: 'Spring',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Mild and rainy', weight: 3 },
          { name: 'Thunderstorms', weight: 2 },
          { name: 'Clear and mild', weight: 3 }
        ]
      },
      {
        name: 'Summer',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Hot and humid', weight: 4 },
          { name: 'Thunderstorms', weight: 3 },
          { name: 'Clear and hot', weight: 2 }
        ]
      },
      {
        name: 'Fall',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Clear and mild', weight: 4 },
          { name: 'Cool breeze', weight: 2 },
          { name: 'Light rain', weight: 2 }
        ]
      },
      {
        name: 'Winter',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Cold and clear', weight: 3 },
          { name: 'Overcast and chilly', weight: 3 },
          { name: 'Cold rain', weight: 2 },
          { name: 'Rare frost', weight: 1 }
        ]
      }
    ]
  },
  {
    id: 'oceanic',
    name: 'Oceanic (Temperate Maritime)',
    koppenCodes: 'Cfb, Cfc',
    description: 'Cool summers, mild-but-damp winters, and steady rain nearly year-round.',
    seasons: [
      {
        name: 'Spring',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Overcast and mild', weight: 3 },
          { name: 'Light rain', weight: 3 },
          { name: 'Clear and cool', weight: 2 }
        ]
      },
      {
        name: 'Summer',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Clear and mild', weight: 3 },
          { name: 'Overcast', weight: 3 },
          { name: 'Light rain', weight: 2 }
        ]
      },
      {
        name: 'Fall',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Overcast and breezy', weight: 3 },
          { name: 'Steady rain', weight: 3 },
          { name: 'Clear and cool', weight: 2 }
        ]
      },
      {
        name: 'Winter',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Cold rain', weight: 3 },
          { name: 'Overcast and damp', weight: 3 },
          { name: 'Clear and frosty', weight: 2 },
          { name: 'Light snow', weight: 1 }
        ]
      }
    ]
  },
  {
    id: 'humid-continental',
    name: 'Humid Continental',
    koppenCodes: 'Dfa, Dfb, Dwa, Dwb',
    description: 'Warm-to-hot summers and cold, snowy winters — big swings between all four seasons.',
    seasons: [
      {
        name: 'Spring',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Cool and rainy', weight: 3 },
          { name: 'Clear and mild', weight: 3 },
          { name: 'Late frost', weight: 1 }
        ]
      },
      {
        name: 'Summer',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Hot and humid', weight: 3 },
          { name: 'Thunderstorms', weight: 3 },
          { name: 'Clear and warm', weight: 3 }
        ]
      },
      {
        name: 'Fall',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Crisp and clear', weight: 4 },
          { name: 'Cold rain', weight: 2 },
          { name: 'Early frost', weight: 2 }
        ]
      },
      {
        name: 'Winter',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Heavy snow', weight: 3 },
          { name: 'Bitter cold and clear', weight: 3 },
          { name: 'Snowstorm', weight: 2 },
          { name: 'Overcast and freezing', weight: 2 }
        ]
      }
    ]
  },
  {
    id: 'subarctic',
    name: 'Subarctic (Boreal)',
    koppenCodes: 'Dfc, Dfd, Dsc, Dwc',
    description: 'Extreme seasonal swings — a short, mild summer and a long, brutally cold winter.',
    seasons: [
      {
        name: 'Short Summer',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Cool and clear', weight: 4 },
          { name: 'Mild rain', weight: 2 },
          { name: 'Overcast', weight: 2 },
          { name: 'Cool and humid', weight: 1 }
        ]
      },
      {
        name: 'Long Winter',
        fractionOfYear: 0.75,
        conditions: [
          { name: 'Bitter cold and clear', weight: 4 },
          { name: 'Heavy snow', weight: 3 },
          { name: 'Blizzard', weight: 2 },
          { name: 'Deep freeze, dead still air', weight: 2 }
        ]
      }
    ]
  },
  {
    id: 'tundra',
    name: 'Tundra',
    koppenCodes: 'ET',
    description: 'Cold almost year-round with only a brief, cool thaw — ground stays frozen underneath.',
    seasons: [
      {
        name: 'Brief Thaw',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Cold and overcast', weight: 3 },
          { name: 'Cool and clear', weight: 3 },
          { name: 'Chilly drizzle', weight: 2 },
          { name: 'Fog', weight: 2 }
        ]
      },
      {
        name: 'Frozen Season',
        fractionOfYear: 0.75,
        conditions: [
          { name: 'Bitter cold and clear', weight: 3 },
          { name: 'Blizzard', weight: 3 },
          { name: 'Whiteout snow', weight: 2 },
          { name: 'Howling wind', weight: 2 }
        ]
      }
    ]
  },
  {
    id: 'ice-cap',
    name: 'Ice Cap (Polar)',
    koppenCodes: 'EF',
    description: 'Permanently below freezing — even the "warm" season rarely thaws anything.',
    seasons: [
      {
        name: 'Polar Summer',
        fractionOfYear: 0.2,
        conditions: [
          { name: 'Cold and clear', weight: 3 },
          { name: 'Overcast and windy', weight: 3 },
          { name: 'Light snow', weight: 2 },
          { name: 'Fog', weight: 2 }
        ]
      },
      {
        name: 'Polar Night',
        fractionOfYear: 0.8,
        conditions: [
          { name: 'Bitter cold and clear', weight: 3 },
          { name: 'Blizzard', weight: 3 },
          { name: 'Whiteout', weight: 2 },
          { name: 'Still, silent cold', weight: 2 }
        ]
      }
    ]
  },
  {
    id: 'highland',
    name: 'Highland (Alpine)',
    koppenCodes: 'H',
    description: 'Mountain microclimate — cooler and more volatile than the surrounding lowlands at every time of year.',
    seasons: [
      {
        name: 'Spring Thaw',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Melting snow, clear mornings', weight: 3 },
          { name: 'Sudden storm', weight: 2 },
          { name: 'Cool and crisp', weight: 3 }
        ]
      },
      {
        name: 'Summer',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Clear and cool', weight: 3 },
          { name: 'Afternoon thunderstorm', weight: 3 },
          { name: 'Chilly wind', weight: 2 }
        ]
      },
      {
        name: 'Fall',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Crisp and clear', weight: 3 },
          { name: 'Early snow', weight: 2 },
          { name: 'Cold wind', weight: 3 }
        ]
      },
      {
        name: 'Winter',
        fractionOfYear: 0.25,
        conditions: [
          { name: 'Heavy snow', weight: 4 },
          { name: 'Bitter cold and clear', weight: 3 },
          { name: 'Blizzard', weight: 2 },
          { name: 'Avalanche conditions', weight: 1 }
        ]
      }
    ]
  }
]

// Splits the referenced calendar's actual months into contiguous,
// chronological-order blocks sized by the preset's season fractions, and
// builds real ClimateSeason records from them. There's no way to know which
// of an arbitrary (possibly custom fantasy) calendar's months represents
// "winter" — the preset just claims the first fraction-sized block of
// months for its first season, and so on — so the result is a reasonable
// starting point, not a guaranteed-correct one; the existing month checkbox
// UI in ClimateSheet.tsx is exactly where a user re-assigns a month that
// landed in the wrong block.
export function applyClimatePreset(
  preset: ClimatePreset,
  months: { id: string }[],
  idFactory: () => string = () => crypto.randomUUID()
): ClimateSeason[] {
  const seasons: ClimateSeason[] = preset.seasons.map((s) => ({
    id: idFactory(),
    name: s.name,
    monthIds: [],
    conditions: s.conditions.map((c) => ({ id: idFactory(), name: c.name, weight: c.weight }))
  }))
  if (months.length === 0) return seasons

  const totalFraction = preset.seasons.reduce((sum, s) => sum + s.fractionOfYear, 0) || 1
  const cumulativeFractions = preset.seasons.reduce<number[]>((acc, s) => {
    acc.push((acc.at(-1) ?? 0) + s.fractionOfYear / totalFraction)
    return acc
  }, [])

  months.forEach((month, i) => {
    // The midpoint of this month's slot in [0, 1) — using the midpoint
    // rather than the start avoids a month landing in the wrong season
    // purely from floating-point rounding right at a boundary.
    const position = (i + 0.5) / months.length
    const seasonIndex = cumulativeFractions.findIndex((f) => position < f)
    seasons[seasonIndex === -1 ? seasons.length - 1 : seasonIndex].monthIds.push(month.id)
  })

  return seasons
}
