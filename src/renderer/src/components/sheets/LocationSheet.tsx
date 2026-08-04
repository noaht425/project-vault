import { useEffect, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { locationFrontmatterSchema, LOCATION_KINDS } from '../../../../common/noteTypes/location'
import { settlementFrontmatterSchema, defaultSettlementFrontmatter } from '../../../../common/noteTypes/settlement'
import type { NoteRefApi } from '../../lib/noteRefApi'

export function LocationSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = locationFrontmatterSchema.parse(frontmatter)
  const [climateOptions, setClimateOptions] = useState<string[]>([])

  useEffect(() => {
    void noteRefApi.searchTitles('', 'climate').then((matches) => setClimateOptions(matches.map((m) => m.title)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const openClimate = async (): Promise<void> => {
    if (!data.climateNoteTitle?.trim()) return
    await noteRefApi.openByTitle(data.climateNoteTitle.trim(), 'climate')
  }

  // Converts this note in place — same title, same file — rather than
  // creating a separate settlement note. Every existing reference to this
  // location (map pins' locationTitle, events' location, other notes'
  // climateNoteTitle) is a title string, not an id, so nothing needs to be
  // re-pointed; SheetView picks SettlementSheet on the very next render
  // once frontmatter.type says 'settlement'. Only the four fields Location
  // and Settlement actually share (tags/summary/climateNoteTitle, plus
  // type itself) carry over — locationType has no Settlement equivalent
  // and is dropped, same as a brand-new settlement note's starter
  // districts/wealthTiers/buildingTypes/specialties/raceLifeStages (see
  // defaultSettlementFrontmatter) apply here too, so this lands in exactly
  // the same state as using "New > Settlement" would.
  const promoteToSettlement = (): void => {
    const proceed = window.confirm(
      "Convert this location into a settlement note? It gains population/district/building/resident tools that a plain location doesn't have — this can't be undone."
    )
    if (!proceed) return
    const settlementFrontmatter = settlementFrontmatterSchema.parse({
      ...defaultSettlementFrontmatter(),
      tags: data.tags,
      summary: data.summary,
      climateNoteTitle: data.climateNoteTitle
    })
    onContentChange(stringifyNote({ frontmatter: settlementFrontmatter, body }))
  }

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field sheet-field-date">
          Type
          <select value={data.locationType} onChange={(e) => updateFrontmatter({ locationType: e.target.value })}>
            {LOCATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind[0].toUpperCase() + kind.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>
      <div className="sheet-row" style={{ marginTop: 8 }}>
        <label className="sheet-field">
          Climate
          {/* Optional — a climate note's title (see the pill Timeline's Event
              sheet, which shows generated weather once both this and a
              structured date are set). Most locations won't need it. */}
          <input
            list="location-climate-options"
            value={data.climateNoteTitle ?? ''}
            onChange={(e) => updateFrontmatter({ climateNoteTitle: e.target.value || null })}
            placeholder="e.g. Arctic Tundra"
          />
          <datalist id="location-climate-options">
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

      {data.locationType === 'city' && (
        <div className="sheet-row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button type="button" className="sheet-open-ref-button" onClick={promoteToSettlement}>
            Promote to Settlement
          </button>
          <span className="right-panel-note">
            Turns this into a full settlement note (population, districts, buildings, residents) — same title, so every
            map pin/event/reference pointing here keeps working.
          </span>
        </div>
      )}
    </div>
  )
}
