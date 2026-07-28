import { defaultNpcFrontmatter } from './noteTypes/npc'
import { defaultLocationFrontmatter } from './noteTypes/location'
import type { SettlementBuilding, SettlementResident } from './noteTypes/settlement'

// Maps a background settlement record to the frontmatter/body of a real
// npc/location note — the "promote" action's actual content, kept as pure
// functions (no note creation, no IPC) so it's testable without a vault or
// Cloud Workspace. See SettlementPeopleTab.tsx/SettlementBuildingsTab.tsx
// for where the result gets handed to NoteRefApi.createNote.

export interface PromotedNote {
  frontmatter: Record<string, unknown>
  body: string
}

/** `districtName`/`wealthTierName` are looked up by the caller (the sheet already has the id->name maps) since a resident only stores ids. */
export function buildPromotedNpcFrontmatter(resident: SettlementResident, districtName: string, wealthTierName: string): PromotedNote {
  const base = defaultNpcFrontmatter()
  const frontmatter = {
    ...base,
    role: resident.notable ? 'Notable' : 'Resident',
    stats: resident.stats ?? base.stats
  }

  const facts = [
    `${resident.race || 'Unknown race'}, age ${resident.age}${resident.gender ? `, ${resident.gender}` : ''}.`,
    districtName ? `Lives in ${districtName}.` : '',
    wealthTierName ? `${wealthTierName} class.` : '',
    resident.religion ? `Follows ${resident.religion}.` : ''
  ]
    .filter(Boolean)
    .join(' ')

  const flavor = resident.notable
    ? [resident.personalityLine ? `${resident.personalityLine}.` : '', resident.goal ? `${resident.name} ${resident.goal}.` : '']
        .filter(Boolean)
        .join(' ')
    : resident.flavorTag

  const proficiencies = resident.proficiencies.length > 0 ? `Proficient in: ${resident.proficiencies.join(', ')}.` : ''
  const appearance = resident.appearance ? `## Appearance\n${resident.appearance}` : ''

  return { frontmatter, body: [facts, flavor, proficiencies, appearance].filter(Boolean).join('\n\n') }
}

export function buildPromotedLocationFrontmatter(
  building: SettlementBuilding,
  buildingTypeName: string,
  districtName: string,
  wealthTierName: string
): PromotedNote {
  const frontmatter = {
    ...defaultLocationFrontmatter(),
    locationType: 'location',
    summary: [buildingTypeName || 'Building', districtName ? `in ${districtName}` : ''].filter(Boolean).join(' ')
  }

  const body = wealthTierName ? `${wealthTierName}-tier establishment.` : ''

  return { frontmatter, body }
}
