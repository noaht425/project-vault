import { useState } from 'react'
import {
  BUILDING_CATEGORIES,
  SETTLEMENT_SIZE_IDS,
  defaultDistrictsForSize,
  defaultRaceLifeStages,
  type SettlementFrontmatter
} from '../../../../common/noteTypes/settlement'
import { SETTLEMENT_SIZE_PRESETS, generateSettlement, resolveGatingSizeId } from '../../../../common/settlementGenerator'
import { BASELINE_RACES, NAME_INSPIRATION_SOURCES, raceLabel } from '../../../../common/settlementNames'
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
  const [lastGenerated, setLastGenerated] = useState<string | null>(null)

  const updateBuildingType = (id: string, patch: Record<string, unknown>): void =>
    updateFrontmatter({ buildingTypes: data.buildingTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })

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
    setLastGenerated(`Generated ${result.residents.length.toLocaleString()} residents across ${result.buildings.length.toLocaleString()} buildings.`)
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
                  targetPopulation: preset.averagePopulation
                })
              }
            >
              {preset.name}
            </button>
          ))}
          <label className="sheet-field" style={{ flex: '0 0 120px' }}>
            Population
            {/* .sheet-field-narrow is 64px — clips a 6-digit population
                (the Metropolis preset averages 60,000, and a hand-typed
                custom value can run well past that) behind the number
                input's spinner arrows, same bug class as initiative-add-
                count's 60px fix. 120px comfortably fits 6 digits + spinner. */}
            <input
              type="number"
              style={{ width: '100%' }}
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
        <p className="right-panel-note">
          Each district can optionally boost which building types get placed there — a "Religious District" only
          skews toward temples/shrines if you check them below. Soft bias, not exclusive: a boosted district gets
          MOST of that type, not all of it.
        </p>
        {data.districts.map((d) => (
          <div key={d.id} style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                style={{ flex: 1 }}
                value={d.name}
                onChange={(e) => updateFrontmatter({ districts: data.districts.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)) })}
              />
              <button onClick={() => updateFrontmatter({ districts: data.districts.filter((x) => x.id !== d.id) })}>✕</button>
            </div>
            <details style={{ marginTop: 2 }}>
              <summary style={{ fontSize: 12, cursor: 'pointer' }}>
                Boosts ({d.buildingTypeBoosts.length})
              </summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, paddingLeft: 8 }}>
                {data.buildingTypes.map((bt) => {
                  const boost = d.buildingTypeBoosts.find((b) => b.buildingTypeId === bt.id)
                  const setBoosts = (boosts: SettlementFrontmatter['districts'][number]['buildingTypeBoosts']): void =>
                    updateFrontmatter({ districts: data.districts.map((x) => (x.id === d.id ? { ...x, buildingTypeBoosts: boosts } : x)) })
                  return (
                    <label key={bt.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={!!boost}
                        onChange={(e) =>
                          setBoosts(
                            e.target.checked
                              ? [...d.buildingTypeBoosts, { buildingTypeId: bt.id, multiplier: 2 }]
                              : d.buildingTypeBoosts.filter((b) => b.buildingTypeId !== bt.id)
                          )
                        }
                      />
                      {bt.name}
                      {boost && (
                        <input
                          type="number"
                          style={{ width: 42 }}
                          step={0.5}
                          value={boost.multiplier}
                          onChange={(e) =>
                            setBoosts(
                              d.buildingTypeBoosts.map((b) => (b.buildingTypeId === bt.id ? { ...b, multiplier: Number(e.target.value) } : b))
                            )
                          }
                        />
                      )}
                    </label>
                  )
                })}
              </div>
            </details>
          </div>
        ))}
        <div className="sheet-row" style={{ marginTop: 4 }}>
          <button
            onClick={() =>
              updateFrontmatter({ districts: [...data.districts, { id: crypto.randomUUID(), name: 'New District', buildingTypeBoosts: [] }] })
            }
          >
            + Add district
          </button>
          <button
            onClick={() => {
              const sizeName = SETTLEMENT_SIZE_PRESETS.find((p) => p.id === data.sizeId)?.name ?? data.sizeId
              const proceed = window.confirm(
                `Replace all ${data.districts.length} current district(s) with the default set for a ${sizeName}? This can't be undone.`
              )
              if (proceed) updateFrontmatter({ districts: defaultDistrictsForSize(resolveGatingSizeId(data.sizeId)) })
            }}
          >
            Reset to defaults for this size
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Races</strong>{' '}
        <span className="right-panel-note">
          Total: {raceTotal}%{raceTotal !== 100 ? ' (should total 100)' : ''}
        </span>
        <p className="right-panel-note">
          Percent share, age milestones, and (for custom races) name-source config all live together per race now —
          no more editing the same race in separate places.
        </p>
        {data.raceDistribution.map((_, i) => (
          <RaceCard key={i} data={data} updateFrontmatter={updateFrontmatter} index={i} />
        ))}
        <button
          style={{ marginTop: 6 }}
          onClick={() => {
            const usedIds = new Set(data.raceDistribution.map((r) => r.race))
            const nextBaseline = BASELINE_RACES.find((id) => !usedIds.has(id)) ?? 'human'
            const seededStage = defaultRaceLifeStages().find((s) => s.race === nextBaseline)
            updateFrontmatter({
              raceDistribution: [...data.raceDistribution, { race: nextBaseline, percent: 0 }],
              raceLifeStages: data.raceLifeStages.some((s) => s.race === nextBaseline)
                ? data.raceLifeStages
                : [...data.raceLifeStages, seededStage ?? { race: nextBaseline, adulthood: 18, oldAge: 70, maxAge: 90 }]
            })
          }}
        >
          + Add race
        </button>
      </div>

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

      <details style={{ marginTop: 8 }}>
        <summary>Building types ({data.buildingTypes.length})</summary>
        <p className="right-panel-note">
          <strong>Weight</strong> is how often this type shows up relative to other types in the same category — a
          House at weight 40 vs. a Manor at weight 5 means far more houses get built. <strong>Min. size</strong> is a
          soft floor: below that settlement size this type is heavily deprioritized (not forbidden) — a Hamlet can
          still roll a Guildhall, just rarely. <strong>Max %</strong> is an optional hard ceiling on how much of the
          whole staffed-building budget this type can ever claim, no matter how high its weight is — leave blank for
          unlimited. Useful when you want a type to show up MUCH more often (e.g. cranking Temple's weight way up for
          a religious city) without it swallowing the entire settlement.
        </p>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Name</th>
              <th>Category</th>
              <th>Default wealth tier</th>
              <th>Staffed</th>
              <th>Weight</th>
              <th>Min. size</th>
              <th>Max %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.buildingTypes.map((bt) => (
              <tr key={bt.id}>
                <td>
                  <input style={{ minWidth: 100 }} value={bt.name} onChange={(e) => updateBuildingType(bt.id, { name: e.target.value })} />
                </td>
                <td>
                  <select value={bt.category} onChange={(e) => updateBuildingType(bt.id, { category: e.target.value })}>
                    {BUILDING_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={bt.defaultWealthTierId} onChange={(e) => updateBuildingType(bt.id, { defaultWealthTierId: e.target.value })}>
                    <option value="">(none)</option>
                    {data.wealthTiers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={bt.staffed} onChange={(e) => updateBuildingType(bt.id, { staffed: e.target.checked })} />
                </td>
                <td>
                  <input
                    type="number"
                    style={{ width: 55 }}
                    value={bt.weight}
                    onChange={(e) => updateBuildingType(bt.id, { weight: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <select value={bt.minSizeId} onChange={(e) => updateBuildingType(bt.id, { minSizeId: e.target.value })}>
                    {SETTLEMENT_SIZE_IDS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    style={{ width: 55 }}
                    placeholder="none"
                    value={bt.maxSharePercent ?? ''}
                    onChange={(e) => updateBuildingType(bt.id, { maxSharePercent: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </td>
                <td>
                  <button onClick={() => updateFrontmatter({ buildingTypes: data.buildingTypes.filter((x) => x.id !== bt.id) })}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        {lastGenerated && <p className="right-panel-note">{lastGenerated}</p>}
      </div>
    </div>
  )
}

// One card per race in `raceDistribution` — percent share, age milestones
// (raceLifeStages, matched by the `race` string), and — only when this race
// id also matches a customRaces entry — its name-source config, all
// together. Previously these lived in 3 separate sections keyed by the same
// string with no structural link between them, which is exactly what made
// them easy to accidentally drift out of sync (add a race to the
// distribution, forget its life stage, or typo the id differently in each
// place). Changing which race this row represents (the <select>) now
// renames the matching life-stage entry in the same update rather than
// leaving an orphaned one behind.
function RaceCard({
  data,
  updateFrontmatter,
  index
}: {
  data: SettlementFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
  index: number
}): React.JSX.Element {
  const row = data.raceDistribution[index]
  const customRace = data.customRaces.find((cr) => cr.id === row.race)
  const lifeStage = data.raceLifeStages.find((s) => s.race === row.race)
  const stage = lifeStage ?? { adulthood: 18, oldAge: 70, maxAge: 90 }

  const renameLifeStage = (newRace: string): SettlementFrontmatter['raceLifeStages'] =>
    lifeStage
      ? data.raceLifeStages.map((s) => (s.race === row.race ? { ...s, race: newRace } : s))
      : [...data.raceLifeStages, { race: newRace, adulthood: 18, oldAge: 70, maxAge: 90 }]

  const handleRaceIdChange = (newRaceId: string): void => {
    if (newRaceId === '__new_custom__') {
      const newId = crypto.randomUUID()
      updateFrontmatter({
        customRaces: [...data.customRaces, { id: newId, name: 'New Race', inspirationSourceIds: [], phoneticProfileIds: [] }],
        raceDistribution: data.raceDistribution.map((x, xi) => (xi === index ? { ...x, race: newId } : x)),
        raceLifeStages: renameLifeStage(newId)
      })
      return
    }
    updateFrontmatter({
      raceDistribution: data.raceDistribution.map((x, xi) => (xi === index ? { ...x, race: newRaceId } : x)),
      raceLifeStages: renameLifeStage(newRaceId)
    })
  }

  const updatePercent = (percent: number): void =>
    updateFrontmatter({ raceDistribution: data.raceDistribution.map((x, xi) => (xi === index ? { ...x, percent } : x)) })

  const updateLifeStageField = (patch: Record<string, unknown>): void =>
    updateFrontmatter({
      raceLifeStages: lifeStage
        ? data.raceLifeStages.map((s) => (s.race === row.race ? { ...s, ...patch } : s))
        : [...data.raceLifeStages, { race: row.race, adulthood: 18, oldAge: 70, maxAge: 90, ...patch }]
    })

  const updateCustomRaceField = (patch: Record<string, unknown>): void =>
    updateFrontmatter({ customRaces: data.customRaces.map((cr) => (cr.id === row.race ? { ...cr, ...patch } : cr)) })

  const removeRace = (): void =>
    updateFrontmatter({
      raceDistribution: data.raceDistribution.filter((_, xi) => xi !== index),
      raceLifeStages: data.raceLifeStages.filter((s) => s.race !== row.race),
      customRaces: data.customRaces.filter((cr) => cr.id !== row.race)
    })

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={row.race} onChange={(e) => handleRaceIdChange(e.target.value)}>
          {BASELINE_RACES.map((id) => (
            <option key={id} value={id}>
              {raceLabel(id)}
            </option>
          ))}
          {data.customRaces
            .filter((cr) => cr.id === row.race || !data.raceDistribution.some((r) => r.race === cr.id))
            .map((cr) => (
              <option key={cr.id} value={cr.id}>
                {cr.name} (custom)
              </option>
            ))}
          <option value="__new_custom__">+ New custom race…</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          Percent
          <input type="number" style={{ width: 60 }} value={row.percent} onChange={(e) => updatePercent(Number(e.target.value))} />%
        </label>
        <button onClick={removeRace} title="Remove this race (and its age/name-source settings) from the settlement">
          ✕
        </button>
      </div>

      {customRace && (
        <label className="sheet-field" style={{ maxWidth: 220, marginTop: 6 }}>
          Custom race name
          <input value={customRace.name} onChange={(e) => updateCustomRaceField({ name: e.target.value })} />
        </label>
      )}

      <div className="sheet-row" style={{ marginTop: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
          Adulthood
          <input
            type="number"
            style={{ width: 70 }}
            value={stage.adulthood}
            onChange={(e) => updateLifeStageField({ adulthood: Number(e.target.value) })}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
          Old age
          <input
            type="number"
            style={{ width: 70 }}
            value={stage.oldAge}
            onChange={(e) => updateLifeStageField({ oldAge: Number(e.target.value) })}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
          Max age
          <input
            type="number"
            style={{ width: 70 }}
            value={stage.maxAge}
            onChange={(e) => updateLifeStageField({ maxAge: Number(e.target.value) })}
          />
        </label>
      </div>

      {customRace && (
        <div style={{ marginTop: 6 }}>
          <div className="sheet-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
              <input
                type="radio"
                checked={customRace.phoneticProfileIds.length === 0}
                onChange={() => updateCustomRaceField({ phoneticProfileIds: [] })}
              />
              Real-world inspiration sources
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
              <input
                type="radio"
                checked={customRace.phoneticProfileIds.length > 0}
                onChange={() => updateCustomRaceField({ phoneticProfileIds: [PHONETIC_PROFILES[0].id], inspirationSourceIds: [] })}
              />
              Phonetic profile(s)
            </label>
          </div>
          {customRace.phoneticProfileIds.length === 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {NAME_INSPIRATION_SOURCES.map((source) => (
                <label key={source.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={customRace.inspirationSourceIds.includes(source.id)}
                    onChange={(e) =>
                      updateCustomRaceField({
                        inspirationSourceIds: e.target.checked
                          ? [...customRace.inspirationSourceIds, source.id]
                          : customRace.inspirationSourceIds.filter((id) => id !== source.id)
                      })
                    }
                  />
                  {source.name}
                </label>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {PHONETIC_PROFILES.map((profile) => (
                <label key={profile.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={customRace.phoneticProfileIds.includes(profile.id)}
                    onChange={(e) =>
                      updateCustomRaceField({
                        phoneticProfileIds: e.target.checked
                          ? [...customRace.phoneticProfileIds, profile.id]
                          : customRace.phoneticProfileIds.filter((id) => id !== profile.id)
                      })
                    }
                  />
                  {profile.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
