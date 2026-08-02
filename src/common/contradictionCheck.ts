// A deterministic, mechanical sanity pass over data the app already has —
// NOT an AI critique of the world's content, same spirit and phrasing as
// noteTypes/familyTree.ts's checkRelationshipPlausibility (which this is a
// sibling to, not a replacement for: that one checks a single family tree's
// declared relationships against each person's numeric `age` field; this one
// cross-references Born:/Died: world-date facts — pulled from common/
// worldTimeline.ts's existing whole-vault scan — against event dates and
// family-tree parent/child pairs, which catches cases a bare `age` field
// can't (a long-dead ancestor with no "current age" concept, only Born/Died
// text). Every check here is a plain date comparison over structure that
// already exists in the notes — nothing generated, nothing inferred beyond
// what's literally written.

import { parseWorldDateStart, compareWorldDates } from './worldDate'

export interface BornDied {
  born: string | null
  died: string | null
}

/**
 * Builds a title -> {born, died} lookup from the same flat fact list
 * common/worldTimeline.ts's extractBornDiedFacts already produces across
 * the whole vault (via vaultApi.listEvents()/cloudApi.listEvents(), which
 * already run that extraction over every note) — reuses that existing scan
 * instead of a second one. Only ever reads facts whose description is
 * exactly "Born"/"Died" or starts with "Born:"/"Died:" (extractBornDiedFacts'
 * own output shape), so a dedicated Event note's unrelated summary text
 * can't be mistaken for one. The first Born/Died fact for a given title
 * wins if a note has more than one (rare, but not worth erroring over).
 */
export function bornDiedByTitle(facts: { title: string; date: string; summary: string }[]): Map<string, BornDied> {
  const map = new Map<string, BornDied>()
  for (const fact of facts) {
    const isBorn = fact.summary === 'Born' || fact.summary.startsWith('Born:')
    const isDied = fact.summary === 'Died' || fact.summary.startsWith('Died:')
    if (!isBorn && !isDied) continue

    const existing = map.get(fact.title) ?? { born: null, died: null }
    if (isBorn && existing.born === null) existing.born = fact.date
    if (isDied && existing.died === null) existing.died = fact.date
    map.set(fact.title, existing)
  }
  return map
}

export interface Contradiction {
  message: string
  noteATitle: string
  noteBTitle: string
}

/** Only ever compares two dates that BOTH actually parsed — an unparseable date silently skips the check rather than risking a false positive from compareWorldDates' own "unparseable sorts last" fallback. */
function bothParse(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && parseWorldDateStart(a) !== null && parseWorldDateStart(b) !== null
}

export interface EventForCheck {
  title: string
  date: string
  linkedTitles: string[]
}

/**
 * Flags an event that wiki-links a person marked Died: before the event's
 * own date — e.g. an NPC attending, or otherwise referenced in, an event
 * that (per the note text) happens after they died.
 */
export function checkEventDeathContradictions(events: EventForCheck[], bornDied: Map<string, BornDied>): Contradiction[] {
  const contradictions: Contradiction[] = []
  for (const event of events) {
    if (!event.date.trim()) continue
    for (const linkedTitle of event.linkedTitles) {
      const died = bornDied.get(linkedTitle)?.died ?? null
      if (!bothParse(died, event.date)) continue
      if (compareWorldDates(died!, event.date) < 0) {
        contradictions.push({
          message: `${linkedTitle} is marked Died: ${died} — before "${event.title}"'s own date (${event.date}).`,
          noteATitle: event.title,
          noteBTitle: linkedTitle
        })
      }
    }
  }
  return contradictions
}

export interface ParentChildForCheck {
  parent: string
  child: string
  sourceTreeTitle: string
}

/**
 * Flags a family tree's declared parent/child pair whose own Born:/Died:
 * facts contradict that pairing — a child born before (or in the same
 * instant as) their recorded parent, or a parent who died before the child
 * was even born. Complements (doesn't replace) checkRelationshipPlausibility
 * in noteTypes/familyTree.ts, which checks the numeric `age` field instead —
 * this catches the same class of mistake for people whose notes only have
 * Born:/Died: text and no filled-in `age`.
 */
export function checkFamilyTreeDateContradictions(edges: ParentChildForCheck[], bornDied: Map<string, BornDied>): Contradiction[] {
  const contradictions: Contradiction[] = []
  for (const { parent, child, sourceTreeTitle } of edges) {
    const parentInfo = bornDied.get(parent)
    const childInfo = bornDied.get(child)

    const parentBorn = parentInfo?.born ?? null
    const childBorn = childInfo?.born ?? null
    if (bothParse(parentBorn, childBorn) && compareWorldDates(parentBorn!, childBorn!) >= 0) {
      contradictions.push({
        message: `In "${sourceTreeTitle}": ${child} is recorded Born: ${childBorn}, not after ${parent}'s own Born: ${parentBorn} — a parent should be born first.`,
        noteATitle: parent,
        noteBTitle: child
      })
    }

    const parentDied = parentInfo?.died ?? null
    if (bothParse(parentDied, childBorn) && compareWorldDates(parentDied!, childBorn!) < 0) {
      contradictions.push({
        message: `In "${sourceTreeTitle}": ${parent} is marked Died: ${parentDied} — before ${child}'s own Born: ${childBorn}.`,
        noteATitle: parent,
        noteBTitle: child
      })
    }
  }
  return contradictions
}
