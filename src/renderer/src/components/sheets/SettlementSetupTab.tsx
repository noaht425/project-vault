import { BUILDING_CATEGORIES, SETTLEMENT_SIZE_IDS, type SettlementFrontmatter } from '../../../../common/noteTypes/settlement'
import { SETTLEMENT_SIZE_PRESETS, generateSettlement } from '../../../../common/settlementGenerator'
import { NAME_INSPIRATION_SOURCES } from '../../../../common/settlementNames'
import { PHONETIC_PROFILES } from '../../../../common/phoneticNames'

// All the generation-input editors, mirroring GenerationOptions field for
// field, plus the Generate button. Every "+ Add" button inserts a row with
// an editable placeholder rather than staging a separate mini-form first
// (unlike MapSheet's "+ New terrain type" flow) — simpler state, and these
// rows are cheap to fix up after adding, unlike a terrain type that gets
// used immediately by a zone.
export function SettlementSetupTab({
  data,
  updateFrontmatter
}: {
  data: SettlementFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
}): React.JSX.Element {
  const updateBuildingType = (id: string, patch: Record<string, unknown>): void =>
    updateFrontmatter({ buildingTypes: data.buildingTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const updateCustomRace = (id: string, patch: Record<string, unknown>): void =>
    updateFrontmatter({ customRaces: data.customRaces.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  const raceTotal = data.raceDistribution.reduce((sum, r) => sum + r.percent, 0)
  const wealthTotal = data.wealthTiers.reduce((sum, t) => sum + t.percent, 0)
  const religionTotal = data.religionDistribution.reduce((sum, r) => sum + r.percent, 0)

  const handleGenerate = (): void => {
    if (data.buildings.length > 0 || data.residents.length > 0) {
      const proceed = window.confirm(
        'Regenerate this settlement? Promoted (linked) residents and buildings are kept — everything else is replaced.'
      )
      if (!proceed) return
    }
    const result = generateSettlement(
      {
        population: data.targetPopulation,
        sizeId: data.sizeId,
        districts: data.districts,
        raceDistribution: data.raceDistribution,
        customRaces: data.customRaces,
        inspirationSources: NAME_INSPIRATION_SOURCES,
        phoneticProfiles: PHONETIC_PROFILES,
        wealthTiers: data.wealthTiers,
        religionDistribution: data.religionDistribution,
        buildingTypes: data.buildingTypes,
        specialties: data.specialties,
        activeSpecialtyIds: data.activeSpecialtyIds,
        raceLifeStages: data.raceLifeStages
      },
      { buildings: data.buildings, residents: data.residents },
      Math.random,
      () => crypto.randomUUID()
    )
    updateFrontmatter({ buildings: result.buildings, residents: result.residents })
  }

  return (
    <div>
      <div className="sheet-row">
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Size &amp; population</strong>
        <div className="sheet-row" style={{ flexWrap: 'wrap', marginTop: 4 }}>
          {SETTLEMENT_SIZE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={data.sizeId === preset.id ? 'active' : ''}
              onClick={() =>
                updateFrontmatter({
                  sizeId: preset.id,
                  targetPopulation: Math.round((preset.minPopulation + preset.maxPopulation) / 2)
                })
              }
            >
              {preset.name}
            </button>
          ))}
          <label className="sheet-field sheet-field-narrow">
            Population
            <input
              type="number"
              value={data.targetPopulation}
              onChange={(e) => updateFrontmatter({ targetPopulation: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Specialties</strong>
        <p className="right-panel-note">Zero or more — each boosts the odds of its related building types during Generate.</p>
        <div className="sheet-row" style={{ flexWrap: 'wrap' }}>
          {data.specialties.map((specialty) => (
            <label key={specialty.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={data.activeSpecialtyIds.includes(specialty.id)}
                onChange={(e) =>
                  updateFrontmatter({
                    activeSpecialtyIds: e.target.checked
                      ? [...data.activeSpecialtyIds, specialty.id]
                      : data.activeSpecialtyIds.filter((id) => id !== specialty.id)
                  })
                }
              />
              {specialty.name}
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Districts</strong>
        {data.districts.map((d) => (
          <div key={d.id} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <input
              style={{ flex: 1 }}
              value={d.name}
              onChange={(e) => updateFrontmatter({ districts: data.districts.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)) })}
            />
            <button onClick={() => updateFrontmatter({ districts: data.districts.filter((x) => x.id !== d.id) })}>✕</button>
          </div>
        ))}
        <button
          style={{ marginTop: 4 }}
          onClick={() => updateFrontmatter({ districts: [...data.districts, { id: crypto.randomUUID(), name: 'New District' }] })}
        >
          + Add district
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Race distribution</strong>{' '}
        <span className="right-panel-note">
          Total: {raceTotal}%{raceTotal !== 100 ? ' (should total 100)' : ''}
        </span>
        {data.raceDistribution.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <input
              style={{ flex: 1 }}
              value={r.race}
              placeholder="human, elf, or any custom race id…"
              onChange={(e) =>
                updateFrontmatter({ raceDistribution: data.raceDistribution.map((x, xi) => (xi === i ? { ...x, race: e.target.value } : x)) })
              }
            />
            <input
              type="number"
              style={{ width: 60 }}
              value={r.percent}
              onChange={(e) =>
                updateFrontmatter({
                  raceDistribution: data.raceDistribution.map((x, xi) => (xi === i ? { ...x, percent: Number(e.target.value) } : x))
                })
              }
            />
            %
            <button onClick={() => updateFrontmatter({ raceDistribution: data.raceDistribution.filter((_, xi) => xi !== i) })}>✕</button>
          </div>
        ))}
        <button style={{ marginTop: 4 }} onClick={() => updateFrontmatter({ raceDistribution: [...data.raceDistribution, { race: 'human', percent: 0 }] })}>
          + Add race
        </button>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Race life stages ({data.raceLifeStages.length})</summary>
        <p className="right-panel-note">
          Per-race adulthood/old-age/max-age, used to generate believable ages — fully yours to edit (e.g. a shorter- or
          longer-lived elf variant than the seeded default).
        </p>
        {data.raceLifeStages.map((stage, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <input
              style={{ flex: 1 }}
              value={stage.race}
              placeholder="race id"
              onChange={(e) =>
                updateFrontmatter({ raceLifeStages: data.raceLifeStages.map((x, xi) => (xi === i ? { ...x, race: e.target.value } : x)) })
              }
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
              Adulthood
              <input
                type="number"
                style={{ width: 70 }}
                value={stage.adulthood}
                onChange={(e) =>
                  updateFrontmatter({
                    raceLifeStages: data.raceLifeStages.map((x, xi) => (xi === i ? { ...x, adulthood: Number(e.target.value) } : x))
                  })
                }
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
              Old age
              <input
                type="number"
                style={{ width: 70 }}
                value={stage.oldAge}
                onChange={(e) =>
                  updateFrontmatter({
                    raceLifeStages: data.raceLifeStages.map((x, xi) => (xi === i ? { ...x, oldAge: Number(e.target.value) } : x))
                  })
                }
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
              Max age
              <input
                type="number"
                style={{ width: 70 }}
                value={stage.maxAge}
                onChange={(e) =>
                  updateFrontmatter({
                    raceLifeStages: data.raceLifeStages.map((x, xi) => (xi === i ? { ...x, maxAge: Number(e.target.value) } : x))
                  })
                }
              />
            </label>
            <button onClick={() => updateFrontmatter({ raceLifeStages: data.raceLifeStages.filter((_, xi) => xi !== i) })}>✕</button>
          </div>
        ))}
        <button
          style={{ marginTop: 4 }}
          onClick={() =>
            updateFrontmatter({ raceLifeStages: [...data.raceLifeStages, { race: 'new-race', adulthood: 18, oldAge: 70, maxAge: 90 }] })
          }
        >
          + Add race life stage
        </button>
      </details>

      <div style={{ marginTop: 12 }}>
        <strong>Wealth tiers</strong>{' '}
        <span className="right-panel-note">
          Total: {wealthTotal}%{wealthTotal !== 100 ? ' (should total 100)' : ''}
        </span>
        {data.wealthTiers.map((t) => (
          <div key={t.id} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <input
              style={{ flex: 1 }}
              value={t.name}
              onChange={(e) => updateFrontmatter({ wealthTiers: data.wealthTiers.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)) })}
            />
            <input
              type="number"
              style={{ width: 60 }}
              value={t.percent}
              onChange={(e) =>
                updateFrontmatter({ wealthTiers: data.wealthTiers.map((x) => (x.id === t.id ? { ...x, percent: Number(e.target.value) } : x)) })
              }
            />
            %
            <button onClick={() => updateFrontmatter({ wealthTiers: data.wealthTiers.filter((x) => x.id !== t.id) })}>✕</button>
          </div>
        ))}
        <button
          style={{ marginTop: 4 }}
          onClick={() => updateFrontmatter({ wealthTiers: [...data.wealthTiers, { id: crypto.randomUUID(), name: 'New Tier', percent: 0 }] })}
        >
          + Add wealth tier
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Religion distribution</strong>{' '}
        <span className="right-panel-note">
          Total: {religionTotal}%{religionTotal !== 100 ? ' (should total 100)' : ''}
        </span>
        {data.religionDistribution.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <input
              style={{ flex: 1 }}
              value={r.religion}
              onChange={(e) =>
                updateFrontmatter({
                  religionDistribution: data.religionDistribution.map((x, xi) => (xi === i ? { ...x, religion: e.target.value } : x))
                })
              }
            />
            <input
              type="number"
              style={{ width: 60 }}
              value={r.percent}
              onChange={(e) =>
                updateFrontmatter({
                  religionDistribution: data.religionDistribution.map((x, xi) => (xi === i ? { ...x, percent: Number(e.target.value) } : x))
                })
              }
            />
            %
            <button onClick={() => updateFrontmatter({ religionDistribution: data.religionDistribution.filter((_, xi) => xi !== i) })}>✕</button>
          </div>
        ))}
        <button
          style={{ marginTop: 4 }}
          onClick={() => updateFrontmatter({ religionDistribution: [...data.religionDistribution, { religion: 'New Religion', percent: 0 }] })}
        >
          + Add religion
        </button>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Custom races ({data.customRaces.length})</summary>
        <p className="right-panel-note">
          Each custom race uses EITHER real-world name-inspiration sources OR a phonetic profile, never both — picking one clears the other.
        </p>
        {data.customRaces.map((cr) => (
          <div key={cr.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input style={{ flex: 1 }} value={cr.name} onChange={(e) => updateCustomRace(cr.id, { name: e.target.value })} />
              <span className="right-panel-note">id: {cr.id}</span>
              <button onClick={() => updateFrontmatter({ customRaces: data.customRaces.filter((x) => x.id !== cr.id) })}>✕</button>
            </div>
            <div className="sheet-row" style={{ marginTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <input
                  type="radio"
                  checked={!cr.phoneticProfileId}
                  onChange={() => updateCustomRace(cr.id, { phoneticProfileId: null })}
                />
                Real-world inspiration sources
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <input
                  type="radio"
                  checked={!!cr.phoneticProfileId}
                  onChange={() => updateCustomRace(cr.id, { phoneticProfileId: PHONETIC_PROFILES[0].id, inspirationSourceIds: [] })}
                />
                Phonetic profile
              </label>
            </div>
            {!cr.phoneticProfileId ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {NAME_INSPIRATION_SOURCES.map((source) => (
                  <label key={source.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={cr.inspirationSourceIds.includes(source.id)}
                      onChange={(e) =>
                        updateCustomRace(cr.id, {
                          inspirationSourceIds: e.target.checked
                            ? [...cr.inspirationSourceIds, source.id]
                            : cr.inspirationSourceIds.filter((id) => id !== source.id)
                        })
                      }
                    />
                    {source.name}
                  </label>
                ))}
              </div>
            ) : (
              <select
                style={{ marginTop: 4 }}
                value={cr.phoneticProfileId}
                onChange={(e) => updateCustomRace(cr.id, { phoneticProfileId: e.target.value })}
              >
                {PHONETIC_PROFILES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
        <button
          style={{ marginTop: 6 }}
          onClick={() =>
            updateFrontmatter({
              customRaces: [...data.customRaces, { id: crypto.randomUUID(), name: 'New Race', inspirationSourceIds: [], phoneticProfileId: null }]
            })
          }
        >
          + Add custom race
        </button>
      </details>

      <details style={{ marginTop: 8 }}>
        <summary>Building types ({data.buildingTypes.length})</summary>
        {data.buildingTypes.map((bt) => (
          <div key={bt.id} style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <input style={{ flex: 1, minWidth: 100 }} value={bt.name} onChange={(e) => updateBuildingType(bt.id, { name: e.target.value })} />
            <select value={bt.category} onChange={(e) => updateBuildingType(bt.id, { category: e.target.value })}>
              {BUILDING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={bt.defaultWealthTierId} onChange={(e) => updateBuildingType(bt.id, { defaultWealthTierId: e.target.value })}>
              <option value="">(no default tier)</option>
              {data.wealthTiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
              Staffed
              <input type="checkbox" checked={bt.staffed} onChange={(e) => updateBuildingType(bt.id, { staffed: e.target.checked })} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
              Weight
              <input
                type="number"
                style={{ width: 50 }}
                value={bt.weight}
                onChange={(e) => updateBuildingType(bt.id, { weight: Number(e.target.value) })}
              />
            </label>
            <select value={bt.minSizeId} onChange={(e) => updateBuildingType(bt.id, { minSizeId: e.target.value })}>
              {SETTLEMENT_SIZE_IDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button onClick={() => updateFrontmatter({ buildingTypes: data.buildingTypes.filter((x) => x.id !== bt.id) })}>✕</button>
          </div>
        ))}
        <button
          style={{ marginTop: 6 }}
          onClick={() =>
            updateFrontmatter({
              buildingTypes: [
                ...data.buildingTypes,
                { id: crypto.randomUUID(), name: 'New Building', category: 'shop', defaultWealthTierId: '', staffed: false, weight: 1, minSizeId: 'hamlet' }
              ]
            })
          }
        >
          + Add building type
        </button>
      </details>

      <div style={{ marginTop: 16 }}>
        <button className="sheet-open-ref-button" onClick={handleGenerate}>
          Generate
        </button>
      </div>
    </div>
  )
}
