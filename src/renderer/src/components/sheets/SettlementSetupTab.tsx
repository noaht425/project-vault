import { useEffect, useState } from 'react'
import {
  BUILDING_CATEGORIES,
  SETTLEMENT_SIZE_IDS,
  defaultDistrictsForSize,
  defaultRaceLifeStages,
  resolveEducatedWealthTierIds,
  type SettlementFrontmatter
} from '../../../../common/noteTypes/settlement'
import { SETTLEMENT_SIZE_PRESETS, generateSettlement, resolveGatingSizeId } from '../../../../common/settlementGenerator'
import { BASELINE_RACES, NAME_INSPIRATION_SOURCES, raceLabel } from '../../../../common/settlementNames'
import { PHONETIC_PROFILES } from '../../../../common/phoneticNames'
import { feetAndInchesToInches, inchesToFeetAndInches } from '../../../../common/settlementAppearance'
import {
  defaultSettlementPresetFrontmatter,
  extractPresetFields,
  presetFieldsFromPreset,
  settlementPresetFrontmatterSchema
} from '../../../../common/noteTypes/settlementPreset'
import type { NoteRefApi } from '../../lib/noteRefApi'

// Worshippers tab's "Amount of religious workers" dropdown — a pure UI
// convenience over the one real stored number (religiousWorkerMultiplier).
// Picking a preset sets that number directly; typing any other value into
// the multiplier field itself just shows as "Custom" (see the dropdown's
// value below, computed by matching against this list) rather than needing
// a separate stored "mode" field.
const RELIGIOUS_WORKER_PRESETS = [
  { id: 'none', label: 'None', multiplier: 0 },
  { id: 'fewer', label: 'Fewer than normal', multiplier: 0.5 },
  { id: 'normal', label: 'Normal, based on size', multiplier: 1 },
  { id: 'more', label: 'More than normal', multiplier: 2 }
] as const

// All the generation-input editors, mirroring GenerationOptions field for
// field, plus the Generate button. Every "+ Add" button inserts a row with
// an editable placeholder rather than staging a separate mini-form first
// (unlike MapSheet's "+ New terrain type" flow) — simpler state, and these
// rows are cheap to fix up after adding, unlike a terrain type that gets
// used immediately by a zone.
export function SettlementSetupTab({
  data,
  updateFrontmatter,
  noteRefApi
}: {
  data: SettlementFrontmatter
  updateFrontmatter: (patch: Record<string, unknown>) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const [lastGenerated, setLastGenerated] = useState<string | null>(null)
  const [religionNoteOptions, setReligionNoteOptions] = useState<string[]>([])
  const [folderPathOptions, setFolderPathOptions] = useState<string[]>([])
  const [newReligionNote, setNewReligionNote] = useState('')
  const [religionFolder, setReligionFolder] = useState('')
  const [lastFolderAdd, setLastFolderAdd] = useState<string | null>(null)
  const [climateOptions, setClimateOptions] = useState<string[]>([])
  const [presetOptions, setPresetOptions] = useState<string[]>([])
  const [newPresetName, setNewPresetName] = useState('')
  const [presetSaveError, setPresetSaveError] = useState<string | null>(null)
  const [lastPresetSaved, setLastPresetSaved] = useState<string | null>(null)
  const [presetToApply, setPresetToApply] = useState('')
  const [presetApplyError, setPresetApplyError] = useState<string | null>(null)

  const refreshPresetOptions = (): void => {
    void noteRefApi.searchTitles('', 'settlement-preset').then((matches) => setPresetOptions(matches.map((m) => m.title)))
  }

  useEffect(() => {
    // No type filter — a religion's source note could be any note type (an
    // npc for a deity, a faction for a pantheon, etc.), unlike EventSheet's
    // Location field which only ever points at a 'location' note.
    void noteRefApi.searchTitles('').then((matches) => setReligionNoteOptions(matches.map((m) => m.title)))
    void noteRefApi.listFolderPaths().then(setFolderPathOptions)
    void noteRefApi.searchTitles('', 'climate').then((matches) => setClimateOptions(matches.map((m) => m.title)))
    refreshPresetOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const savePreset = async (): Promise<void> => {
    const name = newPresetName.trim()
    if (!name) return
    setPresetSaveError(null)
    try {
      await noteRefApi.createNote(name, { ...defaultSettlementPresetFrontmatter(), ...extractPresetFields(data) })
      setNewPresetName('')
      setLastPresetSaved(`Saved preset "${name}".`)
      refreshPresetOptions()
    } catch (err) {
      setPresetSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const applyPreset = async (): Promise<void> => {
    const name = presetToApply.trim()
    if (!name) return
    setPresetApplyError(null)

    const frontmatter = await noteRefApi.readFrontmatterByTitle(name, 'settlement-preset')
    if (!frontmatter) {
      setPresetApplyError(`No preset named "${name}" yet.`)
      return
    }
    const parsed = settlementPresetFrontmatterSchema.safeParse(frontmatter)
    if (!parsed.success) {
      setPresetApplyError(`"${name}" doesn't look like a valid settlement preset.`)
      return
    }

    if (data.buildings.length > 0 || data.residents.length > 0) {
      const proceed = window.confirm(
        `Apply preset "${name}"? This replaces this settlement's current Setup fields (race/wealth/religion/building/specialty ` +
          'settings) — already-generated people and buildings are untouched until you regenerate.'
      )
      if (!proceed) return
    }
    updateFrontmatter(presetFieldsFromPreset(parsed.data))
  }

  const openClimate = async (): Promise<void> => {
    if (!data.climateNoteTitle?.trim()) return
    await noteRefApi.openByTitle(data.climateNoteTitle.trim(), 'climate')
  }

  const existingReligionNames = new Set(data.religionDistribution.map((r) => r.religion))

  const addReligionFromNote = (): void => {
    const title = newReligionNote.trim()
    if (!title || existingReligionNames.has(title)) return
    updateFrontmatter({ religionDistribution: [...data.religionDistribution, { religion: title, percent: 0 }] })
    setNewReligionNote('')
  }

  const addReligionsFromFolder = async (): Promise<void> => {
    const folderPath = religionFolder.trim()
    if (!folderPath) return
    const notes = await noteRefApi.listNotesInFolder(folderPath)
    // Safe to re-run: skip any note whose title is already present, same
    // "dedupe by name" spirit as vaultCloudMigration.ts's indexKey check —
    // re-clicking after adding a new note to the folder only adds the new one.
    const toAdd = notes.filter((n) => !existingReligionNames.has(n.title))
    if (toAdd.length > 0) {
      updateFrontmatter({
        religionDistribution: [...data.religionDistribution, ...toAdd.map((n) => ({ religion: n.title, percent: 0 }))]
      })
    }
    setLastFolderAdd(
      toAdd.length > 0
        ? `Added ${toAdd.length.toLocaleString()} religion(s) from "${folderPath}".`
        : `No new notes found in "${folderPath}" (or none — already added).`
    )
  }

  const updateBuildingType = (id: string, patch: Record<string, unknown>): void =>
    updateFrontmatter({ buildingTypes: data.buildingTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })

  const raceTotal = data.raceDistribution.reduce((sum, r) => sum + r.percent, 0)
  const wealthTotal = data.wealthTiers.reduce((sum, t) => sum + t.percent, 0)
  const religionTotal = data.religionDistribution.reduce((sum, r) => sum + r.percent, 0)
  const genderTotal = data.genderDistribution.reduce((sum, g) => sum + g.percent, 0)
  const educatedTierIds = resolveEducatedWealthTierIds(data.wealthTiers, data.customEducation, data.educatedWealthTierIds)

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

      <div className="sheet-row" style={{ marginTop: 8 }}>
        <label className="sheet-field">
          Climate
          {/* Optional — a climate note's title. Set this to see generated
              weather on any Event note whose Location points at this
              settlement. */}
          <input
            list="settlement-climate-options"
            value={data.climateNoteTitle ?? ''}
            onChange={(e) => updateFrontmatter({ climateNoteTitle: e.target.value || null })}
            placeholder="e.g. Arctic Tundra"
          />
          <datalist id="settlement-climate-options">
            {climateOptions.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className="sheet-open-ref-button"
          onClick={() => void openClimate()}
          disabled={!data.climateNoteTitle?.trim()}
        >
          Open ↗
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Presets</strong>
        <p className="right-panel-note" style={{ marginTop: 2 }}>
          Save this settlement's Setup fields (size, districts, race/wealth/religion distribution, building types,
          specialties) as a reusable preset, then apply it from another settlement to skip re-configuring a similar
          one from scratch. Saving never overwrites an existing preset with the same name — pick a new name, or
          delete the old one from the file tree first.
        </p>
        <div className="sheet-row" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <label className="sheet-field" style={{ flex: '0 0 220px' }}>
            Save as preset
            <input value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder="e.g. Coastal Human Village" />
          </label>
          <button type="button" className="sheet-open-ref-button" onClick={() => void savePreset()} disabled={!newPresetName.trim()}>
            Save
          </button>
        </div>
        {presetSaveError && <p className="right-panel-note">{presetSaveError}</p>}
        {lastPresetSaved && !presetSaveError && <p className="right-panel-note">{lastPresetSaved}</p>}

        <div className="sheet-row" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <label className="sheet-field" style={{ flex: '0 0 220px' }}>
            Apply preset
            <input
              list="settlement-preset-options"
              value={presetToApply}
              onChange={(e) => setPresetToApply(e.target.value)}
              placeholder="Pick a saved preset…"
            />
            <datalist id="settlement-preset-options">
              {presetOptions.map((title) => (
                <option key={title} value={title} />
              ))}
            </datalist>
          </label>
          <button type="button" className="sheet-open-ref-button" onClick={() => void applyPreset()} disabled={!presetToApply.trim()}>
            Apply
          </button>
        </div>
        {presetApplyError && <p className="right-panel-note">{presetApplyError}</p>}
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
        <strong>Genders</strong>{' '}
        <span className="right-panel-note">
          Total: {genderTotal}%{genderTotal !== 100 ? ' (should total 100)' : ''}
        </span>
        <p className="right-panel-note">
          "Male" and "Female" specifically get gendered first names from each race's name bank — any other label
          (including a renamed one) draws from the combined pool instead.
        </p>
        {data.genderDistribution.map((g) => (
          <div key={g.id} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            <input
              style={{ flex: 1 }}
              value={g.gender}
              onChange={(e) =>
                updateFrontmatter({ genderDistribution: data.genderDistribution.map((x) => (x.id === g.id ? { ...x, gender: e.target.value } : x)) })
              }
            />
            <input
              type="number"
              style={{ width: 60 }}
              value={g.percent}
              onChange={(e) =>
                updateFrontmatter({
                  genderDistribution: data.genderDistribution.map((x) => (x.id === g.id ? { ...x, percent: Number(e.target.value) } : x))
                })
              }
            />
            %
            <button onClick={() => updateFrontmatter({ genderDistribution: data.genderDistribution.filter((x) => x.id !== g.id) })}>✕</button>
          </div>
        ))}
        <button
          style={{ marginTop: 4 }}
          onClick={() =>
            updateFrontmatter({ genderDistribution: [...data.genderDistribution, { id: crypto.randomUUID(), gender: 'New Gender', percent: 0 }] })
          }
        >
          + Add gender
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
        <strong>Education</strong>
        <p className="right-panel-note" style={{ marginTop: 2 }}>
          Which wealth tiers count as educated. Off (the default), the top half of your wealth tiers (by the order
          they're listed above) are educated automatically. Turn on "Custom education" to pick exactly which tiers
          count, including none at all.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={data.customEducation}
            onChange={(e) => updateFrontmatter({ customEducation: e.target.checked })}
          />
          Custom education
        </label>
        <div className="sheet-row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
          {data.wealthTiers.map((t) => {
            const checked = educatedTierIds.has(t.id)
            const toggle = (): void => {
              if (!data.customEducation) return
              updateFrontmatter({
                educatedWealthTierIds: checked ? data.educatedWealthTierIds.filter((id) => id !== t.id) : [...data.educatedWealthTierIds, t.id]
              })
            }
            return (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: data.customEducation ? 1 : 0.5 }}>
                <input type="checkbox" checked={checked} disabled={!data.customEducation} onChange={toggle} />
                {t.name}
              </label>
            )
          })}
        </div>
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
            {/* Always shown, same as EventSheet.tsx's Location field — no upfront
                check for whether r.religion matches a real note. openByTitle
                already handles "no note titled X yet" itself. */}
            <button
              type="button"
              className="sheet-open-ref-button"
              onClick={() => void noteRefApi.openByTitle(r.religion.trim())}
              disabled={!r.religion.trim()}
            >
              Open ↗
            </button>
            <button onClick={() => updateFrontmatter({ religionDistribution: data.religionDistribution.filter((_, xi) => xi !== i) })}>✕</button>
          </div>
        ))}
        <button
          style={{ marginTop: 4 }}
          onClick={() => updateFrontmatter({ religionDistribution: [...data.religionDistribution, { religion: 'New Religion', percent: 0 }] })}
        >
          + Add religion
        </button>

        <div className="sheet-row" style={{ marginTop: 8 }}>
          <label className="sheet-field" style={{ maxWidth: 220 }}>
            Add from note
            <input
              list="religion-note-options"
              value={newReligionNote}
              onChange={(e) => setNewReligionNote(e.target.value)}
              placeholder="e.g. Abaddon"
            />
            <datalist id="religion-note-options">
              {religionNoteOptions.map((title) => (
                <option key={title} value={title} />
              ))}
            </datalist>
          </label>
          <button type="button" onClick={addReligionFromNote} disabled={!newReligionNote.trim()}>
            + Add
          </button>
        </div>

        <div className="sheet-row" style={{ marginTop: 6 }}>
          <label className="sheet-field" style={{ maxWidth: 220 }}>
            Add all from folder
            <input
              list="religion-folder-options"
              value={religionFolder}
              onChange={(e) => setReligionFolder(e.target.value)}
              placeholder="e.g. NPCs/Archangels"
            />
            <datalist id="religion-folder-options">
              {folderPathOptions.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
          </label>
          <button type="button" onClick={() => void addReligionsFromFolder()} disabled={!religionFolder.trim()}>
            Add all from folder
          </button>
        </div>
        {lastFolderAdd && <p className="right-panel-note">{lastFolderAdd}</p>}
        <p className="right-panel-note">
          Pointing a religion at a real note (by name or by folder) links it to that note's lore — an "Open ↗" button
          appears next to it above, and a promoted resident's "Follows" line becomes a [[wiki-link]] back to it.
          Folder-add is a one-time snapshot, safe to re-run: it skips any note already added, and picks up notes in
          subfolders too.
        </p>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Worshippers</strong>
        <div className="sheet-row" style={{ marginTop: 4 }}>
          <label className="sheet-field" style={{ maxWidth: 260 }}>
            Amount of religious workers
            <select
              value={RELIGIOUS_WORKER_PRESETS.find((p) => p.multiplier === data.religiousWorkerMultiplier)?.id ?? 'custom'}
              onChange={(e) => {
                const preset = RELIGIOUS_WORKER_PRESETS.find((p) => p.id === e.target.value)
                if (preset) updateFrontmatter({ religiousWorkerMultiplier: preset.multiplier })
              }}
            >
              {RELIGIOUS_WORKER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom" disabled>
                Custom
              </option>
            </select>
          </label>
          <label className="sheet-field" style={{ maxWidth: 140 }}>
            Multiplier
            <input
              type="number"
              step={0.1}
              min={0}
              value={data.religiousWorkerMultiplier}
              onChange={(e) => updateFrontmatter({ religiousWorkerMultiplier: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="right-panel-note" style={{ marginTop: 2 }}>
          Scales how many religious buildings (and their staff) get built, relative to their normal weight against
          every other shop/civic/tavern building type — 0 means none at all, 1 is normal, 2 is double. Picking a
          preset sets the multiplier for you; typing any other value shows as "Custom" above.
        </p>

        <div className="sheet-row" style={{ marginTop: 8 }}>
          <label className="sheet-field" style={{ maxWidth: 220 }}>
            Percentage of people who practice religion
            <input
              type="number"
              min={0}
              max={100}
              value={data.religiousPracticePercent}
              onChange={(e) => updateFrontmatter({ religiousPracticePercent: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="right-panel-note" style={{ marginTop: 2 }}>
          The religion distribution above describes the split among practitioners, not the whole population — the
          rest of the population gets no religion at all.
        </p>
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
        customRaces: [
          ...data.customRaces,
          { id: newId, name: 'New Race', inspirationSourceIds: [], phoneticProfileIds: [], heightRangeInches: [59, 75], specialFeatures: [] }
        ],
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

      {customRace && (
        <div style={{ marginTop: 6 }}>
          <div className="sheet-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              Height range
              {([0, 1] as const).map((boundIndex) => {
                const { feet, inches } = inchesToFeetAndInches(customRace.heightRangeInches[boundIndex])
                const setBound = (nextFeet: number, nextInches: number): void => {
                  const nextRange = [...customRace.heightRangeInches] as [number, number]
                  nextRange[boundIndex] = feetAndInchesToInches(nextFeet, nextInches)
                  updateCustomRaceField({ heightRangeInches: nextRange })
                }
                return (
                  <span key={boundIndex} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {boundIndex === 1 && <span style={{ margin: '0 4px' }}>to</span>}
                    <input type="number" style={{ width: 50 }} value={feet} onChange={(e) => setBound(Number(e.target.value), inches)} />
                    ft
                    <input type="number" style={{ width: 50 }} value={inches} onChange={(e) => setBound(feet, Number(e.target.value))} />
                    in
                  </span>
                )
              })}
            </label>
          </div>

          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Special features — distinctive traits (horns, scales, tusks, ...) a Notable NPC of this race might have
            </span>
            {customRace.specialFeatures.map((feature, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                <input
                  style={{ flex: 1 }}
                  value={feature}
                  onChange={(e) =>
                    updateCustomRaceField({
                      specialFeatures: customRace.specialFeatures.map((f, fi) => (fi === i ? e.target.value : f))
                    })
                  }
                />
                <button
                  onClick={() =>
                    updateCustomRaceField({ specialFeatures: customRace.specialFeatures.filter((_, fi) => fi !== i) })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              style={{ marginTop: 4 }}
              onClick={() => updateCustomRaceField({ specialFeatures: [...customRace.specialFeatures, 'New trait'] })}
            >
              + Add trait
            </button>
          </div>
        </div>
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
