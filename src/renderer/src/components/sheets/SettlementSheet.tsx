import { useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { settlementFrontmatterSchema } from '../../../../common/noteTypes/settlement'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { SettlementSetupTab } from './SettlementSetupTab'
import { SettlementPeopleTab } from './SettlementPeopleTab'
import { SettlementBuildingsTab } from './SettlementBuildingsTab'

type SettlementTab = 'setup' | 'people' | 'buildings'

// Same "content string IS the state" pattern as every other sheet (see
// MapSheet.tsx) — no local store for the settlement data itself, only for
// ephemeral UI state (active tab, table filters) inside the 3 tab
// components below. No tab UI primitive exists anywhere in this codebase;
// this button-row + `active` class is the same local pattern MapSheet uses
// for its own mode switcher.
export function SettlementSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = settlementFrontmatterSchema.parse(frontmatter)

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const [tab, setTab] = useState<SettlementTab>('setup')

  return (
    <div className="sheet-view">
      <div className="editor-toolbar">
        <button className={tab === 'setup' ? 'active' : ''} onClick={() => setTab('setup')}>
          Setup
        </button>
        <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
          People ({data.residents.length})
        </button>
        <button className={tab === 'buildings' ? 'active' : ''} onClick={() => setTab('buildings')}>
          Buildings ({data.buildings.length})
        </button>
      </div>

      {tab === 'setup' && <SettlementSetupTab data={data} updateFrontmatter={updateFrontmatter} />}
      {tab === 'people' && <SettlementPeopleTab data={data} updateFrontmatter={updateFrontmatter} noteRefApi={noteRefApi} />}
      {tab === 'buildings' && <SettlementBuildingsTab data={data} updateFrontmatter={updateFrontmatter} noteRefApi={noteRefApi} />}
    </div>
  )
}
