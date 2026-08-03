import { Fragment, useMemo, useState } from 'react'
import type { SettlementBuilding, SettlementFrontmatter, SettlementResident } from '../../../../common/noteTypes/settlement'
import { buildPromotedLocationFrontmatter } from '../../../../common/settlementPromotion'
import type { NoteRefApi } from '../../lib/noteRefApi'

type SortKey = 'name' | 'type' | 'wealth' | 'district'
type SortDir = 'asc' | 'desc'

// Same reasoning as SettlementPeopleTab.tsx: an unpaginated table is the
// actual cause of "clicking feels slow" for a large settlement, not the
// click handler itself.
const PAGE_SIZE = 50
const EMPTY_RESIDENTS: SettlementResident[] = []

function getSortValue(
  b: SettlementBuilding,
  key: SortKey,
  buildingTypeNameById: Map<string, string>,
  wealthTierRankById: Map<string, number>,
  districtNameById: Map<string, string>
): string | number {
  switch (key) {
    case 'name':
      return b.name.toLowerCase()
    case 'type':
      return (buildingTypeNameById.get(b.buildingTypeId) ?? b.buildingTypeId).toLowerCase()
    case 'wealth':
      return wealthTierRankById.get(b.wealthTierId) ?? Number.MAX_SAFE_INTEGER
    case 'district':
      return (districtNameById.get(b.districtId) ?? '').toLowerCase()
  }
}

function SortableHeader({
  label,
  sortKeyValue,
  activeSortKey,
  sortDir,
  onSort
}: {
  label: string
  sortKeyValue: SortKey
  activeSortKey: SortKey | null
  sortDir: SortDir
  onSort: (key: SortKey) => void
}): React.JSX.Element {
  const active = activeSortKey === sortKeyValue
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKeyValue)}>
      {label} {active && (sortDir === 'asc' ? '▲' : '▼')}
    </th>
  )
}

export function SettlementBuildingsTab({
  data,
  updateFrontmatter,
  noteRefApi
}: {
  data: SettlementFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => Promise<void>
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const [typeFilter, setTypeFilter] = useState('')
  const [wealthFilter, setWealthFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [promoteError, setPromoteError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(0)
  const [pageJump, setPageJump] = useState('')

  // Same reasoning as SettlementPeopleTab.tsx's identical memoization: without
  // it, any local state change (e.g. expanding a row) re-filtered/re-sorted
  // the whole buildings array, and residentsByBuildingId below re-scanned the
  // entire (potentially tens-of-thousands-long) residents array once per
  // visible row on every render, not just when a row was actually expanded.
  const districtNameById = useMemo(() => new Map(data.districts.map((d) => [d.id, d.name])), [data.districts])
  const wealthTierNameById = useMemo(() => new Map(data.wealthTiers.map((t) => [t.id, t.name])), [data.wealthTiers])
  const wealthTierRankById = useMemo(() => new Map(data.wealthTiers.map((t, i) => [t.id, i])), [data.wealthTiers])
  const buildingTypeById = useMemo(() => new Map(data.buildingTypes.map((t) => [t.id, t])), [data.buildingTypes])
  const buildingTypeNameById = useMemo(() => new Map(data.buildingTypes.map((t) => [t.id, t.name])), [data.buildingTypes])

  const residentsByBuildingId = useMemo(() => {
    const map = new Map<string, SettlementResident[]>()
    for (const r of data.residents) {
      for (const buildingId of new Set([r.homeBuildingId, r.professionBuildingId])) {
        if (!buildingId) continue
        const list = map.get(buildingId)
        if (list) list.push(r)
        else map.set(buildingId, [r])
      }
    }
    return map
  }, [data.residents])

  const filtered = useMemo(
    () =>
      data.buildings.filter((b) => {
        if (typeFilter && b.buildingTypeId !== typeFilter) return false
        if (wealthFilter && b.wealthTierId !== wealthFilter) return false
        if (districtFilter && b.districtId !== districtFilter) return false
        return true
      }),
    [data.buildings, typeFilter, wealthFilter, districtFilter]
  )

  const sorted = useMemo(
    () =>
      sortKey
        ? [...filtered].sort((a, b) => {
            const va = getSortValue(a, sortKey, buildingTypeNameById, wealthTierRankById, districtNameById)
            const vb = getSortValue(b, sortKey, buildingTypeNameById, wealthTierRankById, districtNameById)
            const cmp =
              typeof va === 'string' && typeof vb === 'string'
                ? va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' })
                : va < vb ? -1 : va > vb ? 1 : 0
            return sortDir === 'asc' ? cmp : -cmp
          })
        : filtered,
    [filtered, sortKey, sortDir, buildingTypeNameById, wealthTierRankById, districtNameById]
  )

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages - 1)
  const pageItems = useMemo(
    () => sorted.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE),
    [sorted, clampedPage]
  )

  const goToPage = (): void => {
    const n = Number(pageJump)
    if (Number.isFinite(n) && n >= 1) setPage(Math.min(totalPages, Math.max(1, Math.round(n))) - 1)
    setPageJump('')
  }

  const toggleSort = (key: SortKey): void => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(0)
  }

  const promote = async (building: SettlementBuilding): Promise<void> => {
    setPromotingId(building.id)
    setPromoteError(null)
    try {
      const buildingType = buildingTypeById.get(building.buildingTypeId)
      const { frontmatter, body } = buildPromotedLocationFrontmatter(
        building,
        buildingType?.name ?? '',
        districtNameById.get(building.districtId) ?? '',
        wealthTierNameById.get(building.wealthTierId) ?? ''
      )
      const created = await noteRefApi.createNote(building.name, frontmatter, body)
      await updateFrontmatter({
        buildings: data.buildings.map((b) => (b.id === building.id ? { ...b, linkedNoteTitle: created.title } : b))
      })
    } catch (err) {
      setPromoteError(err instanceof Error ? err.message : String(err))
    } finally {
      setPromotingId(null)
    }
  }

  return (
    <div>
      <div className="sheet-row" style={{ flexWrap: 'wrap' }}>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value)
            setPage(0)
          }}
        >
          <option value="">All building types</option>
          {data.buildingTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={wealthFilter}
          onChange={(e) => {
            setWealthFilter(e.target.value)
            setPage(0)
          }}
        >
          <option value="">All wealth tiers</option>
          {data.wealthTiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={districtFilter}
          onChange={(e) => {
            setDistrictFilter(e.target.value)
            setPage(0)
          }}
        >
          <option value="">All districts</option>
          {data.districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <p className="right-panel-note">
        {filtered.length} of {data.buildings.length} buildings
        {totalPages > 1 ? ` — page ${clampedPage + 1} of ${totalPages}` : ''}
      </p>
      {promoteError && <p className="right-panel-note">{promoteError}</p>}
      {data.buildings.length === 0 && <p className="right-panel-note">No buildings yet — use the Setup tab's Generate button.</p>}

      {pageItems.length > 0 && (
        <>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <SortableHeader label="Name" sortKeyValue="name" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Type" sortKeyValue="type" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Wealth" sortKeyValue="wealth" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="District" sortKeyValue="district" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((b) => {
                const residentsHere = residentsByBuildingId.get(b.id) ?? EMPTY_RESIDENTS
                return (
                  <Fragment key={b.id}>
                    <tr onClick={() => setExpandedId(expandedId === b.id ? null : b.id)} style={{ cursor: 'pointer' }}>
                      <td>{b.name}</td>
                      <td>{buildingTypeById.get(b.buildingTypeId)?.name ?? b.buildingTypeId}</td>
                      <td>{wealthTierNameById.get(b.wealthTierId) ?? ''}</td>
                      <td>{districtNameById.get(b.districtId) ?? ''}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {b.linkedNoteTitle ? (
                          <button onClick={() => void noteRefApi.openByTitle(b.linkedNoteTitle!, 'location')}>Open note →</button>
                        ) : (
                          <button disabled={promotingId === b.id} onClick={() => void promote(b)}>
                            {promotingId === b.id ? 'Promoting…' : 'Promote to Location'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === b.id && (
                      <tr>
                        <td colSpan={5} style={{ background: 'rgba(127,127,127,0.08)', padding: 8 }}>
                          {residentsHere.length === 0 ? (
                            <div className="right-panel-note">No residents live or work here.</div>
                          ) : (
                            residentsHere.map((r) => {
                              const roles: string[] = []
                              if (r.homeBuildingId === b.id) roles.push('lives here')
                              if (r.professionBuildingId === b.id) roles.push(r.jobTitle ? r.jobTitle.toLowerCase() : 'works here')
                              return (
                                <div key={r.id}>
                                  {r.name} <span className="right-panel-note">({roles.join(', ')})</span>
                                </div>
                              )
                            })
                          )}
                          {b.inventory.length > 0 && (
                            <div style={{ marginTop: residentsHere.length > 0 ? 8 : 0 }}>
                              <strong>In stock</strong>
                              <div className="right-panel-note">{b.inventory.join(', ')}</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="sheet-row" style={{ marginTop: 8, alignItems: 'center' }}>
              <button disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>
                ← Prev
              </button>
              <span className="right-panel-note">
                Page {clampedPage + 1} of {totalPages}
              </span>
              <button disabled={clampedPage >= totalPages - 1} onClick={() => setPage(clampedPage + 1)}>
                Next →
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                Go to page
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  style={{ width: 70 }}
                  value={pageJump}
                  placeholder={String(clampedPage + 1)}
                  onChange={(e) => setPageJump(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && goToPage()}
                />
              </label>
              <button onClick={goToPage}>Go</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
