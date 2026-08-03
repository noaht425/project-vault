import type { SettlementFrontmatter } from '../../../../common/noteTypes/settlement'

// Read-only view of the last Generate's factions output — editing what
// factions exist/how big they are happens in the Setup tab's Factions
// section, same "Setup configures, this tab shows the result" split as
// People/Buildings. No pagination/sorting like those two need: factions are
// inherently few (bounded by FACTION_NAME_POOL's size plus however many
// custom ones exist), never thousands.
export function SettlementFactionsTab({ data }: { data: SettlementFrontmatter }): React.JSX.Element {
  if (data.factions.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <p className="right-panel-note">
          No factions yet — configure custom/random factions in the Setup tab, then click Generate.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: 12 }}>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Max members</th>
          </tr>
        </thead>
        <tbody>
          {data.factions.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.memberCount.toLocaleString()}</td>
              <td>{f.maxMembers.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
