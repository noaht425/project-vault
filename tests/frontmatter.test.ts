import { describe, it, expect } from 'vitest'
import { parseNote, stringifyNote, stampUpdatedAt, stringifyNoteCached, createFieldStringifyCache } from '../src/common/frontmatter'

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

describe('stampUpdatedAt', () => {
  it('inserts a new updatedAt line when the frontmatter has none yet', () => {
    const content = stringifyNote({ frontmatter: { type: 'npc', tags: [] }, body: 'body text\n' })

    const stamped = stampUpdatedAt(content, '2026-08-04T12:00:00.000Z')
    const parsed = parseNote(stamped)

    expect(parsed.frontmatter.updatedAt).toBe('2026-08-04T12:00:00.000Z')
    expect(parsed.frontmatter.type).toBe('npc')
    expect(parsed.body.trim()).toBe('body text')
  })

  it('replaces an existing updatedAt line in place, leaving every other field untouched', () => {
    const content = stringifyNote({ frontmatter: { type: 'npc', updatedAt: '2026-08-01T00:00:00.000Z', role: 'Guard' }, body: 'body\n' })

    const stamped = stampUpdatedAt(content, '2026-08-04T12:00:00.000Z')
    const parsed = parseNote(stamped)

    expect(parsed.frontmatter).toEqual({ type: 'npc', updatedAt: '2026-08-04T12:00:00.000Z', role: 'Guard' })
  })

  // Regression: the naive version of this (an unscoped regex over the whole
  // content string) would match a body line that happens to start with
  // "updatedAt:" too — gray-matter/js-yaml only ever write real frontmatter
  // keys unindented at column 0, so this note's body deliberately includes
  // one to prove the scan stays inside the frontmatter block.
  it('never touches a body line that happens to start with "updatedAt:"', () => {
    const content = stringifyNote({ frontmatter: { type: 'note' }, body: 'updatedAt: not a real field, just body text\n' })

    const stamped = stampUpdatedAt(content, '2026-08-04T12:00:00.000Z')
    const parsed = parseNote(stamped)

    expect(parsed.frontmatter.updatedAt).toBe('2026-08-04T12:00:00.000Z')
    expect(parsed.body.trim()).toBe('updatedAt: not a real field, just body text')
  })

  it('falls back to the full parse/stringify path for content with no frontmatter block', () => {
    const stamped = stampUpdatedAt('just plain body text, no frontmatter at all\n', '2026-08-04T12:00:00.000Z')
    const parsed = parseNote(stamped)

    expect(parsed.frontmatter.updatedAt).toBe('2026-08-04T12:00:00.000Z')
    expect(parsed.body.trim()).toBe('just plain body text, no frontmatter at all')
  })

  // Confirmed directly against gray-matter (outside this test, to avoid its
  // own internal parse-result cache masking the throw on a repeat call with
  // identical content): an opening "---\n" with no closing delimiter is
  // genuinely malformed YAML, and gray-matter's own parseNote() throws on
  // it too — not a new failure mode this introduces, just the same
  // pre-existing behavior any caller of parseNote already had to live
  // with. The fallback path exists for "no frontmatter block at all"
  // (tested above), not for recovering truly malformed input.
  it('throws on truly malformed, unterminated frontmatter rather than silently producing wrong output', () => {
    const malformed = '---\ntype: npc\nno closing delimiter here'
    expect(() => stampUpdatedAt(malformed, '2026-08-04T12:00:00.000Z')).toThrow()
  })

  // Regression test for the actual reported bug: editorStore.ts used to
  // call parseNote+stringifyNote on every autosave just to add this one
  // field, and for a local Settlement (residents/buildings stay inline in
  // frontmatter — no offload locally, see docs/plans/2026-08-04-cloud-to-
  // local-copy.md design decision #5) that round trip was expensive enough
  // to freeze — and in one reported case, crash — the renderer. This proves
  // the replacement stays fast at a scale where the old approach visibly
  // wasn't (see stringifyNote's own noRefs comment: ~1s to stringify a
  // 65,000-resident settlement even with that optimization).
  it('stamps a huge inline-residents settlement note without doing a full YAML round trip', () => {
    const residents = Array.from({ length: 20000 }, (_, i) => ({ id: `r${i}`, name: `Resident ${i}`, race: 'human', age: 30 }))
    const content = stringifyNote({ frontmatter: { type: 'settlement', updatedAt: '2026-08-01T00:00:00.000Z', residents }, body: '' })

    const start = Date.now()
    const stamped = stampUpdatedAt(content, '2026-08-04T12:00:00.000Z')
    const elapsedMs = Date.now() - start

    // A full parse+stringify round trip of this same content already takes
    // ~150-300ms on typical hardware per the sibling perf test above (at
    // this size); this should be at least an order of magnitude faster
    // since it never touches the residents array at all.
    expect(elapsedMs).toBeLessThan(50)

    const parsed = parseNote(stamped)
    expect(parsed.frontmatter.updatedAt).toBe('2026-08-04T12:00:00.000Z')
    expect((parsed.frontmatter.residents as unknown[]).length).toBe(20000)
  })
})

describe('stringifyNoteCached', () => {
  it('produces byte-identical output to stringifyNote on the first call (empty cache, nothing to reuse yet)', () => {
    const note = { frontmatter: { type: 'settlement', summary: 'a town', residents: [{ id: 'r1' }], buildings: [{ id: 'b1' }] }, body: '' }

    const plain = stringifyNote(note)
    const cached = stringifyNoteCached(note, ['residents', 'buildings'], createFieldStringifyCache())

    expect(cached).toBe(plain)
  })

  it('reuses the cached block when a cache-key value is reference-identical, producing the same frontmatter when re-parsed', () => {
    const residents = [{ id: 'r1', name: 'Alice' }]
    const buildings = [{ id: 'b1', name: 'Inn' }]
    const cache = createFieldStringifyCache()

    const first = stringifyNoteCached({ frontmatter: { type: 'settlement', summary: 'v1', residents, buildings }, body: '' }, ['residents', 'buildings'], cache)
    const second = stringifyNoteCached({ frontmatter: { type: 'settlement', summary: 'v2', residents, buildings }, body: '' }, ['residents', 'buildings'], cache)

    expect(parseNote(first).frontmatter).toEqual({ type: 'settlement', summary: 'v1', residents, buildings })
    expect(parseNote(second).frontmatter).toEqual({ type: 'settlement', summary: 'v2', residents, buildings })
  })

  it('re-serializes a cache-key when its value actually changes (new reference), reflecting the new value correctly', () => {
    const cache = createFieldStringifyCache()
    const residentsV1 = [{ id: 'r1', name: 'Alice' }]
    const residentsV2 = [{ id: 'r1', name: 'Alice' }, { id: 'r2', name: 'Bob' }]

    stringifyNoteCached({ frontmatter: { type: 'settlement', residents: residentsV1 }, body: '' }, ['residents'], cache)
    const second = stringifyNoteCached({ frontmatter: { type: 'settlement', residents: residentsV2 }, body: '' }, ['residents'], cache)

    expect(parseNote(second).frontmatter.residents).toEqual(residentsV2)
  })

  it('leaves non-cache-key fields (e.g. body, other frontmatter) working normally alongside cache hits', () => {
    const residents = [{ id: 'r1' }]
    const cache = createFieldStringifyCache()
    stringifyNoteCached({ frontmatter: { type: 'settlement', residents }, body: 'first body' }, ['residents'], cache)

    const second = stringifyNoteCached(
      { frontmatter: { type: 'settlement', residents, targetPopulation: 500 }, body: 'second body' },
      ['residents'],
      cache
    )
    const parsed = parseNote(second)

    expect(parsed.frontmatter).toEqual({ type: 'settlement', residents, targetPopulation: 500 })
    expect(parsed.body.trim()).toBe('second body')
  })

  it('skips a cache key that is absent from this frontmatter without throwing', () => {
    const cache = createFieldStringifyCache()
    const result = stringifyNoteCached({ frontmatter: { type: 'note' }, body: '' }, ['residents', 'buildings'], cache)

    expect(parseNote(result).frontmatter).toEqual({ type: 'note' })
  })

  // Regression test for the actual reported bug: typing in a Settlement's
  // Summary field re-stringified the ENTIRE frontmatter (residents/
  // buildings included) on every keystroke, freezing and once crashing the
  // renderer for a large local settlement. Simulates typing a whole
  // sentence — many rapid calls, same cache, residents/buildings never
  // actually changing — and proves the total cost stays cheap throughout,
  // not just on average.
  it('stays fast across many rapid calls simulating keystrokes, with a huge residents/buildings array that never changes', () => {
    const residents = Array.from({ length: 20000 }, (_, i) => ({ id: `r${i}`, name: `Resident ${i}`, race: 'human', age: 30 }))
    const buildings = Array.from({ length: 5000 }, (_, i) => ({ id: `b${i}`, name: `Building ${i}` }))
    const cache = createFieldStringifyCache()
    const sentence = 'A quiet town at the edge of the map.'

    // First call seeds the cache (pays the real cost once, same as any
    // cache-miss would).
    stringifyNoteCached({ frontmatter: { type: 'settlement', summary: '', residents, buildings }, body: '' }, ['residents', 'buildings'], cache)

    const start = Date.now()
    let content = ''
    for (let i = 1; i <= sentence.length; i++) {
      content = stringifyNoteCached(
        { frontmatter: { type: 'settlement', summary: sentence.slice(0, i), residents, buildings }, body: '' },
        ['residents', 'buildings'],
        cache
      )
    }
    const elapsedMs = Date.now() - start

    // sentence.length calls total; a single full stringify at this scale
    // already runs into hundreds of ms (see the sibling perf test above at
    // a third this size) — if this were still doing a full re-stringify
    // per keystroke, this would take many seconds. Generous bound, not a
    // tight benchmark.
    expect(elapsedMs).toBeLessThan(500)

    const parsed = parseNote(content)
    expect(parsed.frontmatter.summary).toBe(sentence)
    expect((parsed.frontmatter.residents as unknown[]).length).toBe(20000)
    expect((parsed.frontmatter.buildings as unknown[]).length).toBe(5000)
  })
})
