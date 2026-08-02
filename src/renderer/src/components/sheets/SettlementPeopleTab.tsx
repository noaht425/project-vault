import { Fragment, useMemo, useState } from 'react'
import type { SettlementFrontmatter, SettlementResident } from '../../../../common/noteTypes/settlement'
import { buildPromotedNpcFrontmatter } from '../../../../common/settlementPromotion'
import { relationLabel } from '../../../../common/settlementGenerator'
import { raceLabel } from '../../../../common/settlementNames'
import type { NoteRefApi } from '../../lib/noteRefApi'

type SortKey = 'name' | 'race' | 'age' | 'gender' | 'wealth' | 'district' | 'notable' | 'profession'
type SortDir = 'asc' | 'desc'

// Rows rendered per page — a Metropolis-scale settlement can have tens of
// thousands of residents, and an unpaginated table (every row always in the
// DOM) is the actual cause of "clicking to expand a row feels slow", not
// anything happening in the click handler itself. Capping the DOM to one
// page's worth of rows fixes that regardless of settlement size.
const PAGE_SIZE = 50

function getSortValue(
  r: SettlementResident,
  key: SortKey,
  wealthTierRankById: Map<string, number>,
  districtNameById: Map<string, string>,
  buildingNameById: Map<string, string>,
  customRaces: SettlementFrontmatter['customRaces']
): string | number {
  switch (key) {
    case 'name':
      return r.name.toLowerCase()
    case 'race':
      return raceLabel(r.race, customRaces).toLowerCase()
    case 'age':
      return r.age
    case 'gender':
      return r.gender.toLowerCase()
    case 'wealth':
      // Rank by the wealth tier's position in the settlement's own list
      // (Upper/Middle/Lower order), not alphabetically — "Lower" < "Middle"
      // < "Upper" alphabetically would sort backwards from actual wealth.
      return wealthTierRankById.get(r.wealthTierId) ?? Number.MAX_SAFE_INTEGER
    case 'district':
      return (districtNameById.get(r.districtId) ?? '').toLowerCase()
    case 'notable':
      return r.notable ? 1 : 0
    case 'profession':
      return (r.professionBuildingId ? buildingNameById.get(r.professionBuildingId) ?? '' : '').toLowerCase()
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

export function SettlementPeopleTab({
  data,
  updateFrontmatter,
  noteRefApi
}: {
  data: SettlementFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [raceFilter, setRaceFilter] = useState('')
  const [wealthFilter, setWealthFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [notableOnly, setNotableOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [promoteError, setPromoteError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(0)
  const [pageJump, setPageJump] = useState('')

  // Memoized against data.residents (and the filter/sort controls) — without
  // this, expanding a row (setExpandedId) re-filtered and re-sorted the
  // entire resident array, which for a large settlement can be tens of
  // thousands of rows, even though neither the data nor the filters changed.
  const districtNameById = useMemo(() => new Map(data.districts.map((d) => [d.id, d.name])), [data.districts])
  const wealthTierNameById = useMemo(() => new Map(data.wealthTiers.map((t) => [t.id, t.name])), [data.wealthTiers])
  const wealthTierRankById = useMemo(() => new Map(data.wealthTiers.map((t, i) => [t.id, i])), [data.wealthTiers])
  const buildingNameById = useMemo(() => new Map(data.buildings.map((b) => [b.id, b.name])), [data.buildings])
  const races = useMemo(() => Array.from(new Set(data.residents.map((r) => r.race))).sort(), [data.residents])

  const filtered = useMemo(
    () =>
      data.residents.filter((r) => {
        if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase())) return false
        if (raceFilter && r.race !== raceFilter) return false
        if (wealthFilter && r.wealthTierId !== wealthFilter) return false
        if (districtFilter && r.districtId !== districtFilter) return false
        if (notableOnly && !r.notable) return false
        return true
      }),
    [data.residents, search, raceFilter, wealthFilter, districtFilter, notableOnly]
  )

  const sorted = useMemo(
    () =>
      sortKey
        ? [...filtered].sort((a, b) => {
            const va = getSortValue(a, sortKey, wealthTierRankById, districtNameById, buildingNameById, data.customRaces)
            const vb = getSortValue(b, sortKey, wealthTierRankById, districtNameById, buildingNameById, data.customRaces)
            const cmp =
              typeof va === 'string' && typeof vb === 'string'
                ? va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' })
                : va < vb ? -1 : va > vb ? 1 : 0
            return sortDir === 'asc' ? cmp : -cmp
          })
        : filtered,
    [filtered, sortKey, sortDir, wealthTierRankById, districtNameById, buildingNameById, data.customRaces]
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

  const promote = async (resident: SettlementResident): Promise<void> => {
    setPromotingId(resident.id)
    setPromoteError(null)
    try {
      const { frontmatter, body } = buildPromotedNpcFrontmatter(
        resident,
        districtNameById.get(resident.districtId) ?? '',
        wealthTierNameById.get(resident.wealthTierId) ?? ''
      )
      const created = await noteRefApi.createNote(resident.name, frontmatter, body)
      updateFrontmatter({
        residents: data.residents.map((r) => (r.id === resident.id ? { ...r, linkedNoteTitle: created.title } : r))
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
        <input
          placeholder="Search name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
        />
        <select
          value={raceFilter}
          onChange={(e) => {
            setRaceFilter(e.target.value)
            setPage(0)
          }}
        >
          <option value="">All races</option>
          {races.map((r) => (
            <option key={r} value={r}>
              {raceLabel(r, data.customRaces)}
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={notableOnly}
            onChange={(e) => {
              setNotableOnly(e.target.checked)
              setPage(0)
            }}
          />
          Notable only
        </label>
      </div>

      <p className="right-panel-note">
        {filtered.length} of {data.residents.length} residents
        {totalPages > 1 ? ` — page ${clampedPage + 1} of ${totalPages}` : ''}
      </p>
      {promoteError && <p className="right-panel-note">{promoteError}</p>}
      {data.residents.length === 0 && <p className="right-panel-note">No residents yet — use the Setup tab's Generate button.</p>}

      {pageItems.length > 0 && (
        <>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <SortableHeader label="Name" sortKeyValue="name" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Race" sortKeyValue="race" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Age" sortKeyValue="age" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Gender" sortKeyValue="gender" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Wealth" sortKeyValue="wealth" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="District" sortKeyValue="district" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Notable" sortKeyValue="notable" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Workplace" sortKeyValue="profession" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <Fragment key={r.id}>
                  <tr onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                    <td>{r.name}</td>
                    <td>{raceLabel(r.race, data.customRaces)}</td>
                    <td>{r.age}</td>
                    <td>{r.gender}</td>
                    <td>{wealthTierNameById.get(r.wealthTierId) ?? ''}</td>
                    <td>{districtNameById.get(r.districtId) ?? ''}</td>
                    <td>{r.notable ? '★' : ''}</td>
                    <td>{r.professionBuildingId ? buildingNameById.get(r.professionBuildingId) ?? '' : ''}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {r.linkedNoteTitle ? (
                        <button onClick={() => void noteRefApi.openByTitle(r.linkedNoteTitle!, 'npc')}>Open note →</button>
                      ) : (
                        <button disabled={promotingId === r.id} onClick={() => void promote(r)}>
                          {promotingId === r.id ? 'Promoting…' : 'Promote to NPC'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr>
                      <td colSpan={9} style={{ background: 'rgba(127,127,127,0.08)', padding: 8 }}>
                        {r.jobTitle && <div>{r.jobTitle}</div>}
                        {r.notable ? (
                          <>
                            <div>{r.personalityLine}</div>
                            <div>{r.goal ? `${r.name} ${r.goal}.` : ''}</div>
                            {r.stats && (
                              <div style={{ marginTop: 4 }}>
                                STR {r.stats.str} DEX {r.stats.dex} CON {r.stats.con} INT {r.stats.int} WIS {r.stats.wis} CHA {r.stats.cha}
                              </div>
                            )}
                            {r.proficiencies.length > 0 && <div style={{ marginTop: 4 }}>Proficient in: {r.proficiencies.join(', ')}</div>}
                            {r.appearance && (
                              <div style={{ marginTop: 4, whiteSpace: 'pre-line' }}>
                                <strong>Appearance</strong>
                                <br />
                                {r.appearance}
                              </div>
                            )}
                            {r.relatives.length > 0 && (
                              <div style={{ marginTop: 4 }}>
                                <strong>Family</strong>
                                <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                                  {r.relatives.map((rel) => (
                                    <li key={rel.id}>
                                      {relationLabel(rel.relation, r.gender)} {rel.name}{' '}
                                      {rel.livingStatus === 'deceased' ? '(deceased)' : `(${rel.age})`}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        ) : (
                          <div>{r.flavorTag}</div>
                        )}
                        <div className="right-panel-note" style={{ marginTop: 4 }}>
                          {r.employmentStatus === 'unemployed' && !r.notable ? 'Unemployed. ' : ''}
                          {r.homeless ? 'Homeless. ' : ''}
                          {r.religion ? `Follows ${r.religion}.` : ''}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
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
