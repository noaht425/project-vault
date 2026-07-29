import { useEffect, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import {
  addRelationshipEdge,
  checkRelationshipPlausibility,
  familyTreeFrontmatterSchema,
  parseRelationships,
  removeRelationshipEdge,
  RELATION_DISPLAY_PHRASE,
  RELATION_PHRASES,
  type RelationPhrase,
  type RelationshipEdge
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
  const [personOptions, setPersonOptions] = useState<string[]>([])
  const [newA, setNewA] = useState('')
  const [newB, setNewB] = useState('')
  const [newPhrase, setNewPhrase] = useState<RelationPhrase>('parent of')

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const updateBody = (newBody: string): void => {
    onContentChange(stringifyNote({ frontmatter, body: newBody }))
  }

  const edges = parseRelationships(body)

  // No type filter — a family tree can connect any two notes (npc, pc,
  // location, whatever), same as the person names themselves being free
  // text below (a name doesn't need a matching note to exist yet).
  useEffect(() => {
    void noteRefApi.searchTitles('').then((matches) => setPersonOptions(matches.map((m) => m.title)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addRelationship = (): void => {
    const a = newA.trim()
    const b = newB.trim()
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) return
    updateBody(addRelationshipEdge(body, a, newPhrase, b))
    setNewA('')
    setNewB('')
  }

  const removeRelationship = (edge: RelationshipEdge): void => updateBody(removeRelationshipEdge(body, edge))

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
      {edges.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <strong style={{ fontSize: 13 }}>Relationships</strong>
          {edges.map((edge, i) => (
            <div key={`${edge.relation}-${edge.a}-${edge.b}-${i}`} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
              <span style={{ flex: 1, fontSize: 13.5 }}>
                {edge.a} <span style={{ color: 'var(--text-muted)' }}>{RELATION_DISPLAY_PHRASE[edge.relation]}</span> {edge.b}
              </span>
              <button onClick={() => removeRelationship(edge)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="sheet-row" style={{ marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="sheet-field" style={{ maxWidth: 180 }}>
          Person
          <input list="family-tree-person-options" value={newA} onChange={(e) => setNewA(e.target.value)} placeholder="e.g. Alice" />
        </label>
        <label className="sheet-field" style={{ maxWidth: 170 }}>
          Relation
          <select value={newPhrase} onChange={(e) => setNewPhrase(e.target.value as RelationPhrase)}>
            {RELATION_PHRASES.map((phrase) => (
              <option key={phrase} value={phrase}>
                {phrase}
              </option>
            ))}
          </select>
        </label>
        <label className="sheet-field" style={{ maxWidth: 180 }}>
          Person
          <input list="family-tree-person-options" value={newB} onChange={(e) => setNewB(e.target.value)} placeholder="e.g. Bob" />
        </label>
        <datalist id="family-tree-person-options">
          {personOptions.map((title) => (
            <option key={title} value={title} />
          ))}
        </datalist>
        <button type="button" onClick={addRelationship} disabled={!newA.trim() || !newB.trim()}>
          + Add relationship
        </button>
      </div>
      <p className="right-panel-note" style={{ marginTop: 6 }}>
        Either person can be picked from an existing note or typed fresh — a name doesn't need a
        note yet to appear in the diagram. Family/marriage ties (parent/child/spouse/sibling) render
        solid; social ties (friend/rival/enemy/romantic partner) render dotted, in their own color —
        see the legend below the diagram. You can also hand-edit the "## Relationships" section in
        the raw body below instead of using these controls, if you prefer.
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
