import { useMemo } from 'react'
import { parseNote } from '../../../../common/frontmatter'
import { settlementPresetFrontmatterSchema } from '../../../../common/noteTypes/settlementPreset'
import { raceLabel } from '../../../../common/settlementNames'

// A settlement-preset note is normally created by SettlementSetupTab's
// "Save as preset" button and consumed by its "Apply preset" picker — this
// sheet exists so opening one directly from the file tree shows something
// useful (a summary of what's saved) instead of a blank pane, not as a full
// parallel editing form. Editing a preset's actual field values happens by
// re-saving a new one from a real settlement's Setup tab; deleting/renaming
// this note works the same as any other note via the file tree.
export function SettlementPresetSheet({ content }: { content: string }): React.JSX.Element {
  const data = useMemo(() => settlementPresetFrontmatterSchema.parse(parseNote(content).frontmatter), [content])

  const raceSummary = data.raceDistribution
    .filter((r) => r.percent > 0)
    .map((r) => `${raceLabel(r.race, data.customRaces)} ${r.percent}%`)
    .join(', ')
  const wealthSummary = data.wealthTiers.map((t) => `${t.name} ${t.percent}%`).join(', ')
  const genderSummary = data.genderDistribution
    .filter((g) => g.percent > 0)
    .map((g) => `${g.gender} ${g.percent}%`)
    .join(', ')
  const religionSummary = data.religionDistribution
    .filter((r) => r.percent > 0)
    .map((r) => `${r.religion} ${r.percent}%`)
    .join(', ')
  const activeSpecialtyNames = data.specialties
    .filter((s) => data.activeSpecialtyIds.includes(s.id))
    .map((s) => s.name)
    .join(', ')

  return (
    <div>
      <p className="right-panel-note">
        A Settlement Setup preset — apply it from any settlement's Setup tab to prefill these same generation
        settings. To change what's saved here, save a new preset from a settlement instead of editing this note
        directly.
      </p>

      <div className="sheet-row">
        <label className="sheet-field">
          Summary
          <input value={data.summary} readOnly />
        </label>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <strong>Size &amp; population:</strong> {data.sizeId} ({data.targetPopulation.toLocaleString()})
        </div>
        <div>
          <strong>Districts:</strong> {data.districts.map((d) => d.name).join(', ') || '—'}
        </div>
        <div>
          <strong>Race distribution:</strong> {raceSummary || '—'}
        </div>
        <div>
          <strong>Wealth tiers:</strong> {wealthSummary || '—'}
        </div>
        <div>
          <strong>Genders:</strong> {genderSummary || '—'}
        </div>
        <div>
          <strong>Religion distribution:</strong> {religionSummary || '—'}
        </div>
        <div>
          <strong>Religious workers:</strong> {data.religiousWorkerMultiplier}× · <strong>Practice religion:</strong>{' '}
          {data.religiousPracticePercent}%
        </div>
        <div>
          <strong>Education:</strong>{' '}
          {data.customEducation ? `Custom (${data.educatedWealthTierIds.length} tier(s))` : 'Automatic (top half of wealth tiers)'}
        </div>
        <div>
          <strong>Building types:</strong> {data.buildingTypes.length.toLocaleString()}
        </div>
        <div>
          <strong>Active specialties:</strong> {activeSpecialtyNames || '—'}
        </div>
      </div>
    </div>
  )
}
