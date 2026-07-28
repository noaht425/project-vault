import { useState } from 'react'
import type { SettlementBuilding, SettlementFrontmatter } from '../../../../common/noteTypes/settlement'
import { buildPromotedLocationFrontmatter } from '../../../../common/settlementPromotion'
import type { NoteRefApi } from '../../lib/noteRefApi'

export function SettlementBuildingsTab({
  data,
  updateFrontmatter,
  noteRefApi
}: {
  data: SettlementFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const [typeFilter, setTypeFilter] = useState('')
  const [wealthFilter, setWealthFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [promoteError, setPromoteError] = useState<string | null>(null)

  const districtNameById = new Map(data.districts.map((d) => [d.id, d.name]))
  const wealthTierNameById = new Map(data.wealthTiers.map((t) => [t.id, t.name]))
  const buildingTypeById = new Map(data.buildingTypes.map((t) => [t.id, t]))

  const filtered = data.buildings.filter((b) => {
    if (typeFilter && b.buildingTypeId !== typeFilter) return false
    if (wealthFilter && b.wealthTierId !== wealthFilter) return false
    if (districtFilter && b.districtId !== districtFilter) return false
    return true
  })

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
      updateFrontmatter({
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
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All building types</option>
          {data.buildingTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
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
      </div>

      <p className="right-panel-note">
        {filtered.length} of {data.buildings.length} buildings
      </p>
      {promoteError && <p className="right-panel-note">{promoteError}</p>}
      {data.buildings.length === 0 && <p className="right-panel-note">No buildings yet — use the Setup tab's Generate button.</p>}

      {filtered.length > 0 && (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Name</th>
              <th>Type</th>
              <th>Wealth</th>
              <th>District</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td>{buildingTypeById.get(b.buildingTypeId)?.name ?? b.buildingTypeId}</td>
                <td>{wealthTierNameById.get(b.wealthTierId) ?? ''}</td>
                <td>{districtNameById.get(b.districtId) ?? ''}</td>
                <td>
                  {b.linkedNoteTitle ? (
                    <button onClick={() => void noteRefApi.openByTitle(b.linkedNoteTitle!, 'location')}>Open note →</button>
                  ) : (
                    <button disabled={promotingId === b.id} onClick={() => void promote(b)}>
                      {promotingId === b.id ? 'Promoting…' : 'Promote to Location'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
