import { z } from 'zod'

export const eventFrontmatterSchema = z
  .object({
    type: z.literal('event'),
    tags: z.array(z.string()).catch([]),
    // Free text, not a real calendar date — these are in-world/fictional
    // history, so there's no ISO date to default to or validate against.
    date: z.string().catch(''),
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
