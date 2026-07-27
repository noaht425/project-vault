import { useEffect, useState } from 'react'
import { parseNote, stringifyNote } from '../../../../common/frontmatter'
import { eventFrontmatterSchema } from '../../../../common/noteTypes/event'
import type { NoteRefApi } from '../../lib/noteRefApi'

export function EventSheet({
  content,
  onContentChange,
  noteRefApi
}: {
  content: string
  onContentChange: (content: string) => void
  noteRefApi: NoteRefApi
}): React.JSX.Element {
  const { frontmatter, body } = parseNote(content)
  const data = eventFrontmatterSchema.parse(frontmatter)
  const [locationOptions, setLocationOptions] = useState<string[]>([])

  useEffect(() => {
    void noteRefApi.searchTitles('', 'location').then((matches) => setLocationOptions(matches.map((m) => m.title)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateFrontmatter = (patch: Record<string, unknown>): void => {
    onContentChange(stringifyNote({ frontmatter: { ...frontmatter, ...patch }, body }))
  }

  const openLocation = async (): Promise<void> => {
    if (!data.location?.trim()) return
    await noteRefApi.openByTitle(data.location.trim(), 'location')
  }

  return (
    <div className="sheet-view">
      <div className="sheet-row">
        <label className="sheet-field sheet-field-date">
          Date
          {/* Free text, not a native date picker — this is an in-world/
              fictional date, not a real calendar date. */}
          <input
            value={data.date}
            onChange={(e) => updateFrontmatter({ date: e.target.value })}
            placeholder="e.g. Year 12 of the Third Age"
          />
        </label>
        <label className="sheet-field">
          Summary
          <input value={data.summary} onChange={(e) => updateFrontmatter({ summary: e.target.value })} />
        </label>
      </div>
      <div className="sheet-row">
        <label className="sheet-field">
          Location
          {/* Optional — a location note's title, matching a Map note's pins.
              Set this to place the event on that map's Timeline (see
              MapSheet's Timeline section). Most events won't need it. */}
          <input
            list="event-location-options"
            value={data.location ?? ''}
            onChange={(e) => updateFrontmatter({ location: e.target.value || null })}
            placeholder="e.g. Townsville"
          />
          <datalist id="event-location-options">
            {locationOptions.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className="sheet-open-ref-button"
          onClick={() => void openLocation()}
          disabled={!data.location?.trim()}
        >
          Open ↗
        </button>
      </div>
      <p className="right-panel-note">
        Link factions, locations, and characters with [[wiki-links]] in the body below — they'll
        show up on those notes' Backlinks panel automatically.
      </p>
    </div>
  )
}
