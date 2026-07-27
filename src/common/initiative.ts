import { z } from 'zod'
import { rollDice } from './dice'

// A combatant is a SNAPSHOT taken from a pc/npc note at add-time, never a live
// link back to it — an NPC note's hp is a template ("a goblin has 7 hp"), not
// one specific goblin's remaining HP mid-fight. Running 4 goblins from one
// "Goblin" note means 4 combatants (see buildCombatants' count/quantity
// handling below), not 4 notes and not 4 edits to the same note. Combat only
// ever mutates the combatant, never `sourceNoteTitle`'s note.
export const combatantSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceNoteTitle: z.string().nullable().catch(null),
  ac: z.coerce.number().catch(10),
  maxHp: z.coerce.number().catch(10),
  currentHp: z.coerce.number().catch(10),
  // The flat modifier added to a 1d20 initiative roll — copied from a note's
  // DEX modifier at add-time for note-sourced combatants, or typed directly
  // for an ad-hoc one. Kept as a plain number (not re-derived from `stats`)
  // since ad-hoc combatants have no ability scores at all.
  initiativeBonus: z.coerce.number().catch(0),
  initiative: z.number().nullable().catch(null),
  // Freeform tags ("Prone", "Poisoned") rather than a fixed enum — matches
  // this app's ruleset-agnostic pattern elsewhere (dice notation, terrain
  // types, travel modes).
  conditions: z.array(z.string()).catch([]),
  // PCs carry over between encounters (HP included); NPCs/monsters don't —
  // see endEncounter.
  isPc: z.boolean().catch(false)
})
export type Combatant = z.infer<typeof combatantSchema>

export const encounterSchema = z
  .object({
    round: z.coerce.number().catch(1),
    combatants: z.array(combatantSchema).catch([]),
    activeCombatantId: z.string().nullable().catch(null)
  })
  .catch({ round: 1, combatants: [], activeCombatantId: null })
export type Encounter = z.infer<typeof encounterSchema>

/** Parses persisted encounter JSON, falling back to an empty encounter on any corruption/shape mismatch. */
export function parseEncounter(data: unknown): Encounter {
  return encounterSchema.parse(data)
}

export function defaultEncounter(): Encounter {
  return encounterSchema.parse({})
}

export interface NewCombatantInput {
  name: string
  sourceNoteTitle: string | null
  ac: number
  maxHp: number
  // Defaults to maxHp (a fresh ad-hoc monster starts at full health) — but a
  // note-sourced combatant should start at whatever "current" hp its note
  // actually lists (a recurring NPC's note may already record it as
  // wounded), not assume full health just because it's being added now.
  startingHp?: number
  initiativeBonus: number
  isPc: boolean
  // >1 creates that many combatants named "Name 1", "Name 2", ... (the
  // quantity shortcut for adding several of the same monster at once) — count
  // 1 keeps the name plain, no "1" suffix.
  count: number
}

/** `idFactory` is injectable so tests get deterministic ids, same spirit as rollDice's injectable rng. */
export function buildCombatants(
  input: NewCombatantInput,
  idFactory: () => string = () => crypto.randomUUID()
): Combatant[] {
  const count = Math.max(1, Math.floor(input.count))
  const startingHp = input.startingHp ?? input.maxHp
  return Array.from({ length: count }, (_, i) => ({
    id: idFactory(),
    name: count > 1 ? `${input.name} ${i + 1}` : input.name,
    sourceNoteTitle: input.sourceNoteTitle,
    ac: input.ac,
    maxHp: input.maxHp,
    currentHp: startingHp,
    initiativeBonus: input.initiativeBonus,
    initiative: null,
    conditions: [],
    isPc: input.isPc
  }))
}

/** `rng` is injectable so tests can get deterministic results, same as dice.ts's rollDice. */
export function rollInitiativeFor(combatant: Combatant, rng: () => number = Math.random): number {
  const expr = combatant.initiativeBonus >= 0 ? `1d20+${combatant.initiativeBonus}` : `1d20${combatant.initiativeBonus}`
  // Well-formed by construction (a plain integer modifier), so rollDice can't return null here.
  return rollDice(expr, rng)!.total
}

/**
 * Turn order: highest initiative first, ties broken by initiative bonus (the
 * more likely "would actually go first" reading), then name for full
 * determinism. Combatants with no roll yet sort after every rolled one.
 */
export function sortedTurnOrder(combatants: Combatant[]): Combatant[] {
  return [...combatants].sort((a, b) => {
    if (a.initiative === null && b.initiative === null) return a.name.localeCompare(b.name)
    if (a.initiative === null) return 1
    if (b.initiative === null) return -1
    if (b.initiative !== a.initiative) return b.initiative - a.initiative
    if (b.initiativeBonus !== a.initiativeBonus) return b.initiativeBonus - a.initiativeBonus
    return a.name.localeCompare(b.name)
  })
}

/** Advances to the next combatant in turn order, incrementing `round` on wraparound. No-op on an empty encounter. */
export function advanceTurn(encounter: Encounter): Encounter {
  const order = sortedTurnOrder(encounter.combatants)
  if (order.length === 0) return encounter

  const currentIndex = order.findIndex((c) => c.id === encounter.activeCombatantId)
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % order.length
  // Only a genuine wrap (we had an active combatant and landed back on the
  // first) counts as a new round — the very first "Next Turn" of a fresh
  // encounter (currentIndex === -1) starts round 1, it doesn't advance to 2.
  const wrapped = currentIndex !== -1 && nextIndex === 0

  return {
    ...encounter,
    round: wrapped ? encounter.round + 1 : encounter.round,
    activeCombatantId: order[nextIndex].id
  }
}

/**
 * Ends the current encounter. PCs carry over into the next one (HP and all)
 * per the user's own at-the-table workflow — back-to-back fights in one
 * session shouldn't require re-adding the party each time — but their
 * initiative and conditions reset, since those are specific to the fight
 * that just ended. NPCs/monsters are dropped entirely.
 */
export function endEncounter(encounter: Encounter): Encounter {
  const combatants = encounter.combatants
    .filter((c) => c.isPc)
    .map((c) => ({ ...c, initiative: null, conditions: [] }))
  return { round: 1, combatants, activeCombatantId: null }
}

export function applyHpDelta(combatant: Combatant, delta: number): Combatant {
  return { ...combatant, currentHp: Math.max(0, Math.min(combatant.maxHp, combatant.currentHp + delta)) }
}

export function addCondition(combatant: Combatant, condition: string): Combatant {
  const trimmed = condition.trim()
  if (!trimmed || combatant.conditions.includes(trimmed)) return combatant
  return { ...combatant, conditions: [...combatant.conditions, trimmed] }
}

export function removeCondition(combatant: Combatant, condition: string): Combatant {
  return { ...combatant, conditions: combatant.conditions.filter((c) => c !== condition) }
}

export function removeCombatant(encounter: Encounter, id: string): Encounter {
  const combatants = encounter.combatants.filter((c) => c.id !== id)
  return {
    ...encounter,
    combatants,
    activeCombatantId: encounter.activeCombatantId === id ? null : encounter.activeCombatantId
  }
}
