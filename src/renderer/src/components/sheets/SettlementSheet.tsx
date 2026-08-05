import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { parseNote, stringifyNoteCached, createFieldStringifyCache } from '../../../../common/frontmatter'
import {
  settlementFrontmatterSchema,
  settlementResidentSchema,
  settlementBuildingSchema,
  type SettlementBuilding,
  type SettlementResident
} from '../../../../common/noteTypes/settlement'
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
  // Remembers the exact {content, frontmatter, body} THIS component itself
  // last produced (via commitFrontmatter below) — lets the parse below be
  // skipped entirely when `content` is unchanged from what we just wrote
  // ourselves, and doubles as the "did something external touch content"
  // signal commitFrontmatter uses to know when its own field-stringify
  // cache needs resetting. See commitFrontmatter's own comment for why
  // this exists: parseNote(content) always allocates brand new residents/
  // buildings objects, even when byte-identical — without this, EVERY
  // keystroke re-parsed the full settlement from scratch regardless of any
  // other optimization, which was still enough on its own to freeze/crash
  // the renderer for a large imported settlement (real reported bug, twice).
  const lastOwn = useRef<{ content: string; frontmatter: Record<string, unknown>; body: string } | null>(null)
  const fieldCache = useRef(createFieldStringifyCache())

  const { frontmatter, body } = useMemo(() => {
    if (lastOwn.current && lastOwn.current.content === content) {
      return { frontmatter: lastOwn.current.frontmatter, body: lastOwn.current.body }
    }
    // content changed from something other than our own last write (initial
    // load, switching notes, a raw markdown hand-edit, an external file
    // change) — a real parse is needed, and the stringify cache's own
    // "unchanged since last write" assumption no longer holds either.
    fieldCache.current = createFieldStringifyCache()
    return parseNote(content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // Validates residents/buildings separately from the rest of the
  // frontmatter, memoized on THEIR OWN references rather than the whole
  // frontmatter object — commitFrontmatter's `{...frontmatter, ...patch}`
  // spread always creates a new top-level frontmatter object on every
  // edit (by design, so patches compose correctly), which would otherwise
  // make a single `settlementFrontmatterSchema.parse(frontmatter)` call
  // re-validate a settlement's entire residents/buildings arrays — tens of
  // thousands of entries — on every keystroke in an unrelated field like
  // Summary, even with the parse-skip and stringify-cache fixes above
  // (confirmed directly: ~140ms for 20k residents + 5k buildings, and
  // that's before accounting for a "Metropolis"-scale settlement).
  // frontmatter.residents/buildings DO keep a stable reference across
  // edits that don't touch them (thanks to the parse-skip above), so this
  // memo correctly skips re-validating them in that case.
  const bulkFields = useMemo(
    () => ({
      residents: z.array(settlementResidentSchema).catch([]).parse(frontmatter.residents),
      buildings: z.array(settlementBuildingSchema).catch([]).parse(frontmatter.buildings)
    }),
    [frontmatter.residents, frontmatter.buildings]
  )
  const rawData = useMemo(() => {
    // residents/buildings stubbed to [] here — cheap to validate, and
    // overwritten by the separately-validated (and cached) bulkFields
    // right after. Produces the identical overall shape a single
    // settlementFrontmatterSchema.parse(frontmatter) call would.
    const cheapFields = settlementFrontmatterSchema.parse({ ...frontmatter, residents: [], buildings: [] })
    return { ...cheapFields, ...bulkFields }
  }, [frontmatter, bulkFields])

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

  // stringifyNoteCached, not a plain stringifyNote — see its own comment.
  // Every keystroke in a field like Summary calls this, and a local
  // settlement's residents/buildings stay inline with no size bound (no
  // offload locally); re-serializing them on every keystroke regardless of
  // whether THIS patch touched them froze — and once crashed — the
  // renderer for a large imported settlement (real reported bug). Also
  // records `lastOwn` (see its declaration above) so the NEXT render's
  // parse-skip and this function's own next cache-reset check both have an
  // accurate "what did we just write" baseline.
  const commitFrontmatter = (patch: Record<string, unknown>): void => {
    const cacheKeys = ['residents', 'buildings']
    const unchangedKeys = cacheKeys.filter((key) => !(key in patch))
    const nextFrontmatter = { ...frontmatter, ...patch }
    const nextContent = stringifyNoteCached({ frontmatter: nextFrontmatter, body }, cacheKeys, unchangedKeys, fieldCache.current)

    lastOwn.current = { content: nextContent, frontmatter: nextFrontmatter, body }
    onContentChange(nextContent)
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
