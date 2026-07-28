import { z } from 'zod'

// An event's date expressed against a specific `calendar` note (see
// noteTypes/calendar.ts + common/calendarMath.ts, build step 4 of
// docs/plans/2026-07-28-calendar-timeline-system.md) — ADDS TO the
// existing free-text `date` field below rather than replacing it, so no
// existing event note's date is ever silently lost. `date` stays the
// source of truth until a future migration step (build step 5, not done
// yet) populates `structuredDate` from it; until then this is null on
// every existing event.
export const eventStructuredDateSchema = z.object({
  // A calendar note's title — same "note title reference" convention as
  // this file's own `location` field below, not a stored path/id.
  calendarNoteTitle: z.string(),
  eraId: z.string(),
  year: z.coerce.number(),
  monthId: z.string(),
  day: z.coerce.number().catch(1),
  hour: z.coerce.number().catch(0),
  minute: z.coerce.number().catch(0)
})
export type EventStructuredDate = z.infer<typeof eventStructuredDateSchema>

export const eventFrontmatterSchema = z
  .object({
    type: z.literal('event'),
    tags: z.array(z.string()).catch([]),
    // Free text, not a real calendar date — these are in-world/fictional
    // history, so there's no ISO date to default to or validate against.
    date: z.string().catch(''),
    structuredDate: eventStructuredDateSchema.nullable().catch(null),
    summary: z.string().catch(''),
    // A location note's title, same convention as mapPinSchema.locationTitle
    // — lets the Map×Timeline crossover place this event on a map by
    // matching against that map's own pins. Optional: most events won't tie
    // to a single point on a map, and that's fine.
    location: z.string().nullable().catch(null)
  })
  .passthrough()

export type EventFrontmatter = z.infer<typeof eventFrontmatterSchema>

export function defaultEventFrontmatter(): EventFrontmatter {
  return eventFrontmatterSchema.parse({ type: 'event' })
}
