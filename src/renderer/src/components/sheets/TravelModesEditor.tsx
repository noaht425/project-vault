import { useEffect } from 'react'
import { useTravelModesStore, EMPTY_TRAVEL_MODES } from '../../state/travelModesStore'
import type { TravelMode } from '../../../../common/noteTypes/travelModes'

// Global across every map — see travelModesStore.ts. Rendered as a
// collapsible section inside MapSheet, the only place it's needed in v1.
export function TravelModesEditor(): React.JSX.Element {
  const noteId = useTravelModesStore((s) => s.noteId)
  const loading = useTravelModesStore((s) => s.loading)
  const modes = useTravelModesStore((s) => s.frontmatter?.modes ?? EMPTY_TRAVEL_MODES)
  const load = useTravelModesStore((s) => s.load)
  const save = useTravelModesStore((s) => s.save)

  useEffect(() => {
    if (!noteId && !loading) void load()
    // Only ever needs to run once per app session — the store itself is the
    // cache, this just seeds it the first time this section mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateMode = (id: string, patch: Partial<TravelMode>): void => {
    void save(modes.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  const removeMode = (id: string): void => {
    void save(modes.filter((m) => m.id !== id))
  }

  const addMode = (): void => {
    void save([...modes, { id: crypto.randomUUID(), name: 'New mode', speed: 1, timeUnitLabel: 'hours' }])
  }

  if (loading || !noteId) {
    return <p className="right-panel-note">Loading travel modes…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {modes.length > 0 && (
        // Column headers — without these, a bare number next to a bare
        // "hours" text doesn't read as "N per hour" at a glance (see the
        // inline "per" below too, which does the same job row-by-row).
        <div style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ flex: 2 }}>Name</span>
          <span style={{ flex: 1, minWidth: 60 }}>Speed</span>
          <span style={{ width: 24, textAlign: 'center' }} />
          <span style={{ flex: 1, minWidth: 70 }}>Per</span>
          <span style={{ width: 24 }} />
        </div>
      )}
      {modes.map((mode) => (
        <div key={mode.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input style={{ flex: 2 }} value={mode.name} onChange={(e) => updateMode(mode.id, { name: e.target.value })} />
          <input
            style={{ flex: 1, minWidth: 60 }}
            type="number"
            value={mode.speed}
            onChange={(e) => updateMode(mode.id, { speed: Number(e.target.value) })}
          />
          <span style={{ width: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>per</span>
          <input
            style={{ flex: 1, minWidth: 70 }}
            value={mode.timeUnitLabel}
            onChange={(e) => updateMode(mode.id, { timeUnitLabel: e.target.value })}
            placeholder="hours"
          />
          <button onClick={() => removeMode(mode.id)} title="Remove">
            ✕
          </button>
        </div>
      ))}
      <button onClick={addMode}>+ Add travel mode</button>
      <p className="right-panel-note">
        Speed is distance-per-time-unit, in whatever real-world unit each map's own scale uses (e.g. miles) — so
        "Walking, 3, per hours" means 3 map-units per hour. These are placeholders; edit freely.
      </p>
    </div>
  )
}
