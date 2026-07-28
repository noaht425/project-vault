import type { CalendarFrontmatter } from '../../../../common/noteTypes/calendar'

export function CalendarMoonsTab({
  data,
  updateFrontmatter
}: {
  data: CalendarFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const updateMoon = (id: string, patch: Record<string, unknown>): void =>
    updateFrontmatter({ moons: data.moons.map((m) => (m.id === id ? { ...m, ...patch } : m)) })

  return (
    <div>
      <p className="right-panel-note">
        Zero or more moons, each with its own cycle length in days (rarely a clean divisor of this calendar's
        months, same as real lunar months not dividing evenly into a Gregorian year) and a phase offset so moons
        don't have to share a new-moon date.
      </p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Name</th>
            <th>Cycle (days)</th>
            <th>Phase offset (days)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.moons.map((moon) => (
            <tr key={moon.id}>
              <td>
                <input style={{ minWidth: 120 }} value={moon.name} onChange={(e) => updateMoon(moon.id, { name: e.target.value })} />
              </td>
              <td>
                <input
                  type="number"
                  style={{ width: 70 }}
                  value={moon.cycleDays}
                  onChange={(e) => updateMoon(moon.id, { cycleDays: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  style={{ width: 70 }}
                  value={moon.phaseOffsetDays}
                  onChange={(e) => updateMoon(moon.id, { phaseOffsetDays: Number(e.target.value) })}
                />
              </td>
              <td>
                <button onClick={() => updateFrontmatter({ moons: data.moons.filter((m) => m.id !== moon.id) })}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        style={{ marginTop: 6 }}
        onClick={() =>
          updateFrontmatter({ moons: [...data.moons, { id: crypto.randomUUID(), name: 'New Moon', cycleDays: 30, phaseOffsetDays: 0 }] })
        }
      >
        + Add moon
      </button>
    </div>
  )
}
