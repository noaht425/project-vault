import { useEffect, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import {
  checkRelationshipPlausibility,
  familyTreeFrontmatterSchema,
  parseRelationships
} from '../../../../common/noteTypes/familyTree'
import { npcFrontmatterSchema } from '../../../../common/noteTypes/npc'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { FamilyTreeDiagram } from './FamilyTreeDiagram'

export function FamilyTreeSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = familyTreeFrontmatterSchema.parse(frontmatter)
  const [ageByTitle, setAgeByTitle] = useState<Map<string, number>>(new Map())

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const edges = parseRelationships(body)

  // Ages live on real npc notes (npcFrontmatterSchema's optional `age`
  // field), not on this family-tree note itself — same cross-note
  // frontmatter lookup EventSheet.tsx already uses for its calendar-note
  // fetch. A name with no matching npc note (a PC, or no note at all yet)
  // just never gets an entry, and checkRelationshipPlausibility silently
  // skips any pair missing an age, same as everywhere else in this app.
  useEffect(() => {
    const names = [...new Set(edges.flatMap((e) => [e.a, e.b]))]
    let cancelled = false
    void Promise.all(
      names.map(async (name) => {
        const fm = await noteRefApi.readFrontmatterByTitle(name, 'npc')
        if (!fm) return null
        const age = npcFrontmatterSchema.parse(fm).age
        return age === null ? null : ([name, age] as const)
      })
    ).then((results) => {
      if (cancelled) return
      setAgeByTitle(new Map(results.filter((r): r is readonly [string, number] => r !== null)))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body])

  const warnings = checkRelationshipPlausibility(edges, ageByTitle)

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>
      <p className="right-panel-note">
        Add a "## Relationships" heading in the body below, then list people with [[wiki-links]] —
        one per line. Family/marriage: "- [[A]] parent of [[B]]", "- [[A]] child of [[B]]",
        "- [[A]] spouse of [[B]]", "- [[A]] sibling of [[B]]". Social (rendered as dotted lines,
        see the legend below the diagram): "- [[A]] friend of [[B]]", "- [[A]] rival of [[B]]",
        "- [[A]] enemy of [[B]]", "- [[A]] romantic partner of [[B]]".
      </p>
      <FamilyTreeDiagram body={body} onOpenWikiLink={(title) => noteRefApi.openByTitle(title)} />
      {warnings.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p className="right-panel-note">
            Worth double-checking (set each person's Age on their npc note to enable this):
          </p>
          <ul className="right-panel-note" style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.map((w) => (
              <li key={`${w.relation}-${w.a}-${w.b}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
