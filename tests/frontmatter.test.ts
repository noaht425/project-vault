import { describe, it, expect } from 'vitest'
import { parseNote, stringifyNote } from '../src/common/frontmatter'

describe('parseNote/stringifyNote', () => {
  it('round-trips frontmatter and body unchanged', () => {
    const original = { frontmatter: { type: 'npc', tags: ['ally'], age: 42 }, body: '## Notes\nSome text.\n' }
    const content = stringifyNote(original)
    const parsed = parseNote(content)

    expect(parsed.frontmatter).toEqual(original.frontmatter)
    expect(parsed.body.trim()).toBe(original.body.trim())
  })

  // Regression test for a real data-loss bug: without noRefs: true,
  // js-yaml's default shared-reference/circular-alias detection pass makes
  // stringifying a large array of many distinct objects (e.g. a generated
  // Settlement's residents/buildings) take multiple seconds, freezing the
  // renderer long enough to risk a force-quit or eat into the
  // flush-before-quit timeout before a save is even attempted. See
  // common/frontmatter.ts's noRefs comment for the measured numbers
  // (7.6s -> 1.0s at ~65,000 residents, identical output either way).
  it('stringifies a large array of distinct objects fast, not just correctly', () => {
    const residents = Array.from({ length: 20000 }, (_, i) => ({
      id: `r${i}`,
      name: `Resident ${i}`,
      race: 'human',
      age: 20 + (i % 60),
      relatives: []
    }))

    const start = Date.now()
    const content = stringifyNote({ frontmatter: { type: 'settlement', residents }, body: '' })
    const elapsedMs = Date.now() - start

    // Generous bound (real fix takes ~1s at 3x this size) — this is a
    // regression guard against noRefs silently getting reverted/dropped,
    // not a tight perf benchmark.
    expect(elapsedMs).toBeLessThan(5000)

    const parsed = parseNote(content)
    expect((parsed.frontmatter.residents as unknown[]).length).toBe(20000)
  })
})
