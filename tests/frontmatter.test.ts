import { describe, it, expect } from 'vitest'
import {
  parseNote,
  stringifyNote,
  stampUpdatedAt,
  stringifyNoteCached,
  createFieldStringifyCache,
  extractFrontmatterType
} from '../src/common/frontmatter'

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
    const cached = stringifyNoteCached(note, ['residents', 'buildings'], [], createFieldStringifyCache())

    expect(cached).toBe(plain)
  })

  it('reuses the cached block for a key listed in unchangedKeys, producing the same frontmatter when re-parsed', () => {
    const residents = [{ id: 'r1', name: 'Alice' }]
    const buildings = [{ id: 'b1', name: 'Inn' }]
    const cache = createFieldStringifyCache()

    stringifyNoteCached({ frontmatter: { type: 'settlement', summary: 'v1', residents, buildings }, body: '' }, ['residents', 'buildings'], [], cache)
    const second = stringifyNoteCached(
      { frontmatter: { type: 'settlement', summary: 'v2', residents, buildings }, body: '' },
      ['residents', 'buildings'],
      ['residents', 'buildings'],
      cache
    )

    expect(parseNote(second).frontmatter).toEqual({ type: 'settlement', summary: 'v2', residents, buildings })
  })

  it('re-serializes a key NOT listed in unchangedKeys, reflecting a genuinely new value correctly', () => {
    const cache = createFieldStringifyCache()
    const residentsV2 = [{ id: 'r1', name: 'Alice' }, { id: 'r2', name: 'Bob' }]

    stringifyNoteCached({ frontmatter: { type: 'settlement', residents: [{ id: 'r1', name: 'Alice' }] }, body: '' }, ['residents'], [], cache)
    // residents omitted from unchangedKeys — this call is telling the
    // function "residents may have changed," matching how
    // SettlementSheet.tsx derives it from whether `patch` included the key.
    const second = stringifyNoteCached({ frontmatter: { type: 'settlement', residents: residentsV2 }, body: '' }, ['residents'], [], cache)

    expect(parseNote(second).frontmatter.residents).toEqual(residentsV2)
  })

  // The actual bug that shipped and recurred: an earlier version of this
  // function detected "unchanged" via `cachedValue === value` (JS reference
  // equality). That's the ONE thing that can't be trusted here — this
  // app's real flow always re-parses `content` (a string) fresh on every
  // edit via parseNote(), which allocates brand new arrays/objects even
  // when every element is identical. This test reproduces that exact round
  // trip (unlike the tests above, which reuse the SAME in-memory array
  // across calls and would have passed even with the broken
  // reference-equality version) — proving the cache still works when the
  // "unchanged" value is a fresh object with the same content, not the
  // same reference.
  it('still reuses the cached block when the "unchanged" value is a fresh object with identical content, not the same reference (real app round trip)', () => {
    const cache = createFieldStringifyCache()
    const residentsV1 = [{ id: 'r1', name: 'Alice' }]

    const first = stringifyNoteCached({ frontmatter: { type: 'settlement', summary: 'v1', residents: residentsV1 }, body: '' }, ['residents'], [], cache)

    // Simulate the real app: content -> parseNote(content) -> a BRAND NEW
    // residents array, structurally identical but a different reference.
    const reparsed = parseNote(first)
    expect(reparsed.frontmatter.residents).not.toBe(residentsV1) // sanity check this test actually exercises the risky path
    expect(reparsed.frontmatter.residents).toEqual(residentsV1)

    const second = stringifyNoteCached(
      { frontmatter: { ...reparsed.frontmatter, summary: 'v2' }, body: reparsed.body },
      ['residents'],
      ['residents'], // caller asserts "unchanged" based on patch keys, not reference
      cache
    )

    expect(parseNote(second).frontmatter).toEqual({ type: 'settlement', summary: 'v2', residents: residentsV1 })
  })

  it('leaves non-cache-key fields (e.g. body, other frontmatter) working normally alongside reused fields', () => {
    const residents = [{ id: 'r1' }]
    const cache = createFieldStringifyCache()
    stringifyNoteCached({ frontmatter: { type: 'settlement', residents }, body: 'first body' }, ['residents'], [], cache)

    const second = stringifyNoteCached(
      { frontmatter: { type: 'settlement', residents, targetPopulation: 500 }, body: 'second body' },
      ['residents'],
      ['residents'],
      cache
    )
    const parsed = parseNote(second)

    expect(parsed.frontmatter).toEqual({ type: 'settlement', residents, targetPopulation: 500 })
    expect(parsed.body.trim()).toBe('second body')
  })

  it('skips a cache key that is absent from this frontmatter without throwing', () => {
    const cache = createFieldStringifyCache()
    const result = stringifyNoteCached({ frontmatter: { type: 'note' }, body: '' }, ['residents', 'buildings'], [], cache)

    expect(parseNote(result).frontmatter).toEqual({ type: 'note' })
  })

  it('does not reuse a key listed in unchangedKeys if it was never cached before (first-ever call)', () => {
    const cache = createFieldStringifyCache()
    const residents = [{ id: 'r1' }]
    // Nothing cached yet, but caller (wrongly or not) says "unchanged" —
    // must still produce correct output, not an empty/placeholder value.
    const result = stringifyNoteCached({ frontmatter: { type: 'settlement', residents }, body: '' }, ['residents'], ['residents'], cache)

    expect(parseNote(result).frontmatter.residents).toEqual(residents)
  })

  // Regression test for the actual reported bug: typing in a Settlement's
  // Summary field re-stringified the ENTIRE frontmatter (residents/
  // buildings included) on every keystroke, freezing and once crashing the
  // renderer for a large local settlement. This deliberately exercises the
  // WORST case for stringifyNoteCached ALONE — a fresh parseNote() of the
  // previous output on every iteration, discarding residents/buildings'
  // object identity every time, the same way SettlementSheet.tsx's naive
  // `useMemo(() => parseNote(content), [content])` used to. The real fix
  // shipped in SettlementSheet.tsx goes further and skips that re-parse
  // entirely (see its own `lastOwn` ref) whenever `content` is exactly what
  // it last wrote itself, which this test intentionally does NOT do — so
  // the bound below is generous (proving "much better than the original
  // bug," not "as fast as the shipped fix," which has no cheap way to
  // exercise here without a React test harness, which this repo doesn't
  // have for any component).
  it('stays much faster than the original bug even in the worst case (a fresh parse every call, never reusing residents/buildings by reference)', () => {
    const residents = Array.from({ length: 20000 }, (_, i) => ({ id: `r${i}`, name: `Resident ${i}`, race: 'human', age: 30 }))
    const buildings = Array.from({ length: 5000 }, (_, i) => ({ id: `b${i}`, name: `Building ${i}` }))
    const cache = createFieldStringifyCache()
    const sentence = 'A quiet town at the edge of the map.'
    const cacheKeys = ['residents', 'buildings']

    // First call seeds the cache (pays the real cost once, same as any
    // cache-miss would).
    let content = stringifyNoteCached({ frontmatter: { type: 'settlement', summary: '', residents, buildings }, body: '' }, cacheKeys, [], cache)

    const start = Date.now()
    for (let i = 1; i <= sentence.length; i++) {
      // The real round trip: re-parse the PREVIOUS call's own output, then
      // patch just "summary" — residents/buildings come from THIS fresh
      // parse, never the original array reference.
      const { frontmatter, body } = parseNote(content)
      const patch = { summary: sentence.slice(0, i) }
      const unchangedKeys = cacheKeys.filter((key) => !(key in patch))
      content = stringifyNoteCached({ frontmatter: { ...frontmatter, ...patch }, body }, cacheKeys, unchangedKeys, cache)
    }
    const elapsedMs = Date.now() - start

    // sentence.length calls total, each paying a real parseNote() of the
    // full previous output on top of stringifyNoteCached's own work — a
    // single full stringify+parse+validate at this scale (the ORIGINAL
    // bug's per-keystroke cost) already runs into several hundred ms each
    // (see the sibling perf test above at a third this size, plus the ~140ms
    // zod cost SettlementSheet.tsx's own comment measured separately); over
    // sentence.length keystrokes that's many seconds. This test only
    // isolates the stringify side (not parse or zod), so it should still
    // land well under that even with the deliberately-not-optimized parse.
    // Generous bound, not a tight benchmark.
    expect(elapsedMs).toBeLessThan(4000)

    const parsed = parseNote(content)
    expect(parsed.frontmatter.summary).toBe(sentence)
    expect((parsed.frontmatter.residents as unknown[]).length).toBe(20000)
    expect((parsed.frontmatter.buildings as unknown[]).length).toBe(5000)
  })
})

describe('extractFrontmatterType', () => {
  it('extracts a plain, unquoted type', () => {
    const content = stringifyNote({ frontmatter: { type: 'npc', tags: [] }, body: 'hello' })
    expect(extractFrontmatterType(content)).toBe('npc')
  })

  it('strips surrounding quotes from a quoted type', () => {
    expect(extractFrontmatterType("---\ntype: 'settlement'\n---\n")).toBe('settlement')
    expect(extractFrontmatterType('---\ntype: "settlement"\n---\n')).toBe('settlement')
  })

  it('returns undefined when there is no frontmatter block at all', () => {
    expect(extractFrontmatterType('just plain body text\n')).toBeUndefined()
  })

  it('returns undefined when type is absent from the frontmatter', () => {
    const content = stringifyNote({ frontmatter: { tags: [] }, body: '' })
    expect(extractFrontmatterType(content)).toBeUndefined()
  })

  // Regression: a naive unscoped regex over the whole content string would
  // match a body line that happens to start with "type:" too — anchored to
  // the frontmatter block specifically (same reasoning as stampUpdatedAt),
  // since gray-matter/js-yaml only ever write real frontmatter keys
  // unindented at column 0.
  it('never matches a body line that happens to start with "type:"', () => {
    const content = stringifyNote({ frontmatter: { type: 'note' }, body: 'type: not a real field, just body text\n' })
    expect(extractFrontmatterType(content)).toBe('note')
  })

  // Regression test for the actual reported bug: SheetView.tsx used to
  // call parseNote(content) — a full YAML parse — on every keystroke just
  // to read this one field, completely bypassing every optimization
  // SettlementSheet.tsx made internally, since SheetView sits above it and
  // always parsed first. Proves the replacement stays fast at the scale
  // where that was measured taking 1.4+ seconds.
  it('stays fast for a huge inline-residents settlement note, unlike a full parseNote', () => {
    const residents = Array.from({ length: 20000 }, (_, i) => ({ id: `r${i}`, name: `Resident ${i}`, race: 'human', age: 30 }))
    const content = stringifyNote({ frontmatter: { type: 'settlement', residents }, body: '' })

    const start = Date.now()
    const type = extractFrontmatterType(content)
    const elapsedMs = Date.now() - start

    expect(type).toBe('settlement')
    expect(elapsedMs).toBeLessThan(50)
  })
})
