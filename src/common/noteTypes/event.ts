import { z } from 'zod'

export const eventFrontmatterSchema = z
  .object({
    type: z.literal('event'),
    tags: z.array(z.string()).catch([]),
    // Free text, not a real calendar date — these are in-world/fictional
    // history, so there's no ISO date to default to or validate against.
    date: z.string().catch(''),
    summary: z.string().catch('')
  })
  .passthrough()

export type EventFrontmatter = z.infer<typeof eventFrontmatterSchema>

export function defaultEventFrontmatter(): EventFrontmatter {
  return eventFrontmatterSchema.parse({ type: 'event' })
}
