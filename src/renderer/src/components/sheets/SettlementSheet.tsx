import { useEffect, useMemo, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { settlementFrontmatterSchema, type SettlementBuilding, type SettlementResident } from '../../../../common/noteTypes/settlement'
import { shouldOffloadBulkData } from '../../../../common/settlementBulkData'
import type { NoteRefApi } from '../../lib/noteRefApi'
import { SettlementSetupTab } from './SettlementSetupTab'
import { SettlementPeopleTab } from './SettlementPeopleTab'
import { SettlementBuildingsTab } from './SettlementBuildingsTab'
import { SettlementFactionsTab } from './SettlementFactionsTab'

type SettlementTab = 'setup' | 'people' | 'buildings' | 'factions'

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
  // Memoized on content — a settlement's residents array can be tens of
  // thousands of entries, and without this the zod parse re-ran on every
  // render, including switching tabs (setTab), not just on real edits.
  const { frontmatter, body } = useMemo(() => parseNote(content), [content])
  const rawData = useMemo(() => settlementFrontmatterSchema.parse(frontmatter), [frontmatter])

  // See docs/plans/2026-08-03-cloud-settlement-storage-offload.md. When
  // rawData.bulkDataStoragePath is set (Cloud Workspace only — Local Vault
  // never sets it, see settlement.ts's own comment), rawData.residents/
  // buildings are stale placeholders ([]) and the REAL arrays live in
  // Supabase Storage. bulkData.path lets the effect below skip a redundant
  // fetch right after this component itself just wrote that path (see
  // uploadBulkAware below) — without it, Generate/Promote on a huge
  // settlement would immediately re-download the tens of MB it just
  // uploaded, doubling the wait for no reason.
  const [bulkData, setBulkData] = useState<{
    path: string
    residents: SettlementResident[]
    buildings: SettlementBuilding[]
  } | null>(null)
  const [bulkFetching, setBulkFetching] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  useEffect(() => {
    const path = rawData.bulkDataStoragePath
    if (!noteRefApi.isCloud || !path || bulkData?.path === path) return
    let cancelled = false
    setBulkFetching(true)
    setBulkError(null)
    window.cloudApi
      .getSettlementBulkData(path)
      .then((result) => {
        if (!cancelled) setBulkData({ path, ...result })
      })
      .catch((err) => {
        if (!cancelled) setBulkError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setBulkFetching(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData.bulkDataStoragePath, noteRefApi.isCloud])

  const data = useMemo(() => {
    if (rawData.bulkDataStoragePath && bulkData && bulkData.path === rawData.bulkDataStoragePath) {
      return { ...rawData, residents: bulkData.residents, buildings: bulkData.buildings }
    }
    return rawData
  }, [rawData, bulkData])

  const commitFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  // Storage-aware wrapper: a patch that touches residents/buildings on a
  // Cloud Workspace note decides, by size, whether they belong inline (small
  // settlement — today's behavior, no Storage round-trip) or in Supabase
  // Storage (large settlement — see shouldOffloadBulkData). Local Vault
  // (noteRefApi.isCloud false) always falls straight through to
  // commitFrontmatter unchanged — it has no size limit to work around.
  // Every call site that touches residents/buildings (Setup tab's Generate,
  // People/Buildings tabs' Promote) is a discrete button click, never a
  // per-keystroke edit, so re-uploading the full arrays on each one is fine.
  const updateFrontmatter = async (patch: Record<string, unknown>): Promise<void> => {
    const touchesBulkData = 'residents' in patch || 'buildings' in patch
    if (!noteRefApi.isCloud || !touchesBulkData) {
      commitFrontmatter(patch)
      return
    }

    const nextResidents = ('residents' in patch ? patch.residents : data.residents) as SettlementResident[]
    const nextBuildings = ('buildings' in patch ? patch.buildings : data.buildings) as SettlementBuilding[]
    const rest = { ...patch }
    delete rest.residents
    delete rest.buildings

    if (!shouldOffloadBulkData(nextResidents, nextBuildings)) {
      // Small enough to stay (or go back to being) inline — clears a stale
      // pointer if a previous Generate had offloaded a larger population.
      commitFrontmatter({ ...rest, residents: nextResidents, buildings: nextBuildings, bulkDataStoragePath: null })
      setBulkData(null)
      return
    }

    setBulkSaving(true)
    setBulkError(null)
    try {
      const { path } = await window.cloudApi.uploadSettlementBulkData(nextResidents, nextBuildings)
      setBulkData({ path, residents: nextResidents, buildings: nextBuildings })
      commitFrontmatter({ ...rest, residents: [], buildings: [], bulkDataStoragePath: path })
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setBulkSaving(false)
    }
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
        <button className={tab === 'factions' ? 'active' : ''} onClick={() => setTab('factions')}>
          Factions ({data.factions.length})
        </button>
      </div>

      {bulkFetching && <p className="right-panel-note">Loading residents/buildings…</p>}
      {bulkSaving && <p className="right-panel-note">Saving residents/buildings…</p>}
      {bulkError && <p className="right-panel-note">{bulkError}</p>}

      {tab === 'setup' && <SettlementSetupTab data={data} updateFrontmatter={updateFrontmatter} noteRefApi={noteRefApi} />}
      {tab === 'people' && <SettlementPeopleTab data={data} updateFrontmatter={updateFrontmatter} noteRefApi={noteRefApi} />}
      {tab === 'buildings' && <SettlementBuildingsTab data={data} updateFrontmatter={updateFrontmatter} noteRefApi={noteRefApi} />}
      {tab === 'factions' && <SettlementFactionsTab data={data} />}
    </div>
  )
}
