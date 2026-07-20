import { z } from 'zod'
import { abilityScoresSchema } from './creatureStats'

export const pcFrontmatterSchema = z
  .object({
    type: z.literal('pc'),
    tags: z.array(z.string()).catch([]),
    class: z.string().catch(''),
    subclass: z.string().catch(''),
    // Title of a `class-reference` note to pull level-gated features from.
    classRef: z.string().catch(''),
    level: z.coerce.number().catch(1),
    race: z.string().catch(''),
    ac: z.coerce.number().catch(10),
    hp: z.coerce.number().catch(10),
    maxHp: z.coerce.number().catch(10),
    stats: abilityScoresSchema
  })
  .passthrough()

export type PcFrontmatter = z.infer<typeof pcFrontmatterSchema>

export function defaultPcFrontmatter(): PcFrontmatter {
  return pcFrontmatterSchema.parse({ type: 'pc' })
}
