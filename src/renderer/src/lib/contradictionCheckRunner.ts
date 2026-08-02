// Orchestrates the pure checks in common/contradictionCheck.ts against
// whichever backend (local vault or Cloud Workspace) is active — this file
// is the async/IO glue; the actual comparison logic lives in the pure
// module so it stays trivially unit-testable without a vault or network.
import {
  bornDiedByTitle,
  checkEventDeathContradictions,
  checkFamilyTreeDateContradictions,
  type Contradiction,
  type EventForCheck,
  type ParentChildForCheck
} from '../../../common/contradictionCheck'
import { parseRelationships } from '../../../common/noteTypes/familyTree'
import { extractWikiLinkTitles } from '../../../common/wikiLinks'
import type { NoteRefApi } from './noteRefApi'

export interface FactSource {
  title: string
  date: string
  summary: string
}

/**
 * `listFacts` is window.vaultApi.listEvents/window.cloudApi.listEvents —
 * both already scan every note for "## History" bullets and bare
 * "Born:"/"Died:" lines (see common/worldTimeline.ts), so this reuses that
 * existing whole-vault pass instead of a second one just for Born/Died data.
 * Event and family-tree note lists come from noteRefApi.searchTitles with
 * an empty query (a type-filtered empty search returns every note of that
 * type — see session.ts's SEARCH_TITLES_LIMIT/its cloud counterpart), then
 * each note's body/frontmatter is read individually since listFacts doesn't
 * carry body text or declared relationships.
 */
export async function runContradictionCheck(listFacts: () => Promise<FactSource[]>, noteRefApi: NoteRefApi): Promise<Contradiction[]> {
  const [facts, eventMatches, familyTreeMatches] = await Promise.all([
    listFacts(),
    noteRefApi.searchTitles('', 'event'),
    noteRefApi.searchTitles('', 'family-tree')
  ])
  const bornDied = bornDiedByTitle(facts)

  const events: EventForCheck[] = await Promise.all(
    eventMatches.map(async (match): Promise<EventForCheck> => {
      const [frontmatter, body] = await Promise.all([
        noteRefApi.readFrontmatterByTitle(match.title, 'event'),
        noteRefApi.readBodyByTitle(match.title, 'event')
      ])
      return {
        title: match.title,
        date: typeof frontmatter?.date === 'string' ? frontmatter.date : '',
        linkedTitles: extractWikiLinkTitles(body ?? '')
      }
    })
  )

  const edgeLists = await Promise.all(
    familyTreeMatches.map(async (match): Promise<ParentChildForCheck[]> => {
      const body = await noteRefApi.readBodyByTitle(match.title, 'family-tree')
      return parseRelationships(body ?? '')
        .filter((edge) => edge.relation === 'parent')
        .map((edge) => ({ parent: edge.a, child: edge.b, sourceTreeTitle: match.title }))
    })
  )

  return [...checkEventDeathContradictions(events, bornDied), ...checkFamilyTreeDateContradictions(edgeLists.flat(), bornDied)]
}
