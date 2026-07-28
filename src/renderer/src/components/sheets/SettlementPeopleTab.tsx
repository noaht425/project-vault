import { Fragment, useState } from 'react'
import type { SettlementFrontmatter, SettlementResident } from '../../../../common/noteTypes/settlement'
import { buildPromotedNpcFrontmatter } from '../../../../common/settlementPromotion'
import type { NoteRefApi } from '../../lib/noteRefApi'

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

  const districtNameById = new Map(data.districts.map((d) => [d.id, d.name]))
  const wealthTierNameById = new Map(data.wealthTiers.map((t) => [t.id, t.name]))
  const buildingNameById = new Map(data.buildings.map((b) => [b.id, b.name]))
  const races = Array.from(new Set(data.residents.map((r) => r.race))).sort()

  const filtered = data.residents.filter((r) => {
    if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase())) return false
    if (raceFilter && r.race !== raceFilter) return false
    if (wealthFilter && r.wealthTierId !== wealthFilter) return false
    if (districtFilter && r.districtId !== districtFilter) return false
    if (notableOnly && !r.notable) return false
    return true
  })

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
        <input placeholder="Search name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={raceFilter} onChange={(e) => setRaceFilter(e.target.value)}>
          <option value="">All races</option>
          {races.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select value={wealthFilter} onChange={(e) => setWealthFilter(e.target.value)}>
          <option value="">All wealth tiers</option>
          {data.wealthTiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}>
          <option value="">All districts</option>
          {data.districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <input type="checkbox" checked={notableOnly} onChange={(e) => setNotableOnly(e.target.checked)} />
          Notable only
        </label>
      </div>

      <p className="right-panel-note">
        {filtered.length} of {data.residents.length} residents
      </p>
      {promoteError && <p className="right-panel-note">{promoteError}</p>}
      {data.residents.length === 0 && <p className="right-panel-note">No residents yet — use the Setup tab's Generate button.</p>}

      {filtered.length > 0 && (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Name</th>
              <th>Race</th>
              <th>Age</th>
              <th>Gender</th>
              <th>Wealth</th>
              <th>District</th>
              <th>Notable</th>
              <th>Profession</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <Fragment key={r.id}>
                <tr onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                  <td>{r.name}</td>
                  <td>{r.race}</td>
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
                        </>
                      ) : (
                        <div>{r.flavorTag}</div>
                      )}
                      <div className="right-panel-note" style={{ marginTop: 4 }}>
                        {r.religion ? `Follows ${r.religion}.` : ''}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
