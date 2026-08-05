import matter from 'gray-matter'

export interface ParsedNote {
  frontmatter: Record<string, unknown>
  body: string
}

export function parseNote(content: string): ParsedNote {
  const { data, content: body } = matter(content)
  return { frontmatter: data, body }
}

// Cheap, string-level extraction of just the top-level `type` field from a
// note's raw content — SheetView.tsx uses this to decide which sheet
// component to render WITHOUT paying for a full parseNote() on every
// keystroke, even though `type` itself never changes during a normal
// editing session (a settlement note stays a settlement note). A full
// parseNote() of a large Settlement's inline residents/buildings measured
// 1.4+ seconds on its own (confirmed directly) — real, reported cost: this
// ran on EVERY edit regardless of anything SettlementSheet.tsx itself did
// internally, since SheetView.tsx sits ABOVE it and did its own separate
// full parse first, just to read this one field. Anchored to the
// frontmatter block specifically (not the raw content), same reasoning as
// stampUpdatedAt: a body that happens to start a line with "type:" must
// never be mistaken for the real frontmatter key, which gray-matter/js-
// yaml always write unindented at column 0.
export function extractFrontmatterType(content: string): string | undefined {
  if (!content.startsWith('---\n')) return undefined
  const closeIndex = content.indexOf('\n---\n', 4)
  if (closeIndex === -1) return undefined
  const frontmatterBlock = content.slice(4, closeIndex + 1)
  const match = frontmatterBlock.match(/^type:\s*(.+)$/m)
  if (!match) return undefined
  // Strip a quoted scalar's surrounding quotes (js-yaml only quotes a
  // plain word like a note type when it'd otherwise be ambiguous — not
  // observed in practice for this field, but cheap to handle correctly
  // rather than assume it never happens).
  return match[1].trim().replace(/^['"]|['"]$/g, '')
}

export function stringifyNote(note: ParsedNote): string {
  // noRefs: true skips js-yaml's default shared-reference/circular-alias
  // detection pass — a full walk comparing object identity across the
  // whole tree before it writes a single byte. Nothing this app ever
  // serializes intentionally shares object references (a large Settlement
  // note's residents/buildings arrays are thousands of independently
  // generated objects, never aliases of each other), so that pass is pure
  // waste here, and it's the dominant cost at scale: measured 7.6s -> 1.0s
  // (identical byte-for-byte output) stringifying a ~65,000-resident
  // settlement. This was very likely the real reason "generate a big
  // settlement, then quit shortly after" kept losing data even after
  // flush-before-quit/flush-before-switching-notes were added — several
  // seconds of the renderer thread being frozen synchronously in this one
  // call is long enough to make the app look hung and invite a force-quit
  // (SIGKILL) that no in-app code can intercept, or to eat into the
  // flush-before-quit timeout before the save has even been attempted.
  // gray-matter's own TS types don't model this option even though it's
  // passed straight through to js-yaml's dump() at runtime (verified: same
  // byte-for-byte output as without it, just far faster) — cast is for the
  // type checker only.
  return matter.stringify(note.body, note.frontmatter, { noRefs: true } as Parameters<typeof matter.stringify>[2])
}

// Cheap, string-level stamp of a top-level `updatedAt` field into an
// already-formed note's raw content — deliberately NOT a parseNote +
// stringifyNote round trip. That round trip's cost is proportional to the
// ENTIRE frontmatter, and a local Settlement note's residents/buildings
// arrays stay inline in frontmatter (no offload locally — see
// docs/plans/2026-08-04-cloud-to-local-copy.md design decision #5), which
// can run tens of MB. Confirmed regression: editorStore.ts's saveNow() used
// to call parseNote+stringifyNote on every 1.5s-debounced autosave to add
// this stamp, and for a large settlement that froze (and in one reported
// case, crashed) the renderer — exactly the failure mode stringifyNote's
// own noRefs comment above already documents ("7.6s -> 1.0s... several
// seconds of the renderer thread being frozen synchronously... is long
// enough to make the app look hung and invite a force-quit"), except this
// added a SECOND full round trip (a parse AND a stringify) on top of
// whatever the save already needed. A single anchored regex replace/insert
// is a linear text scan, not a full YAML tokenize + rebuild of the whole
// object graph, and is dramatically cheaper at scale.
export function stampUpdatedAt(content: string, iso: string): string {
  const closeIndex = content.startsWith('---\n') ? content.indexOf('\n---\n', 4) : -1
  if (closeIndex === -1) {
    // No frontmatter block — falls back to the slow-but-correct path, which
    // is fine performance-wise too since there's no huge frontmatter to
    // round-trip if there's no frontmatter block in the first place. Also
    // reached for a genuinely unterminated block (opening "---\n" with no
    // closing one) — that's malformed YAML gray-matter's own parseNote()
    // can't handle either (confirmed directly), so this just surfaces the
    // same error any caller of parseNote already would, not a new failure
    // mode.
    const { frontmatter, body } = parseNote(content)
    return stringifyNote({ frontmatter: { ...frontmatter, updatedAt: iso }, body })
  }

  const frontmatterBlock = content.slice(4, closeIndex + 1) // between the delimiters, keeps its trailing \n
  const rest = content.slice(closeIndex + 1) // closing '---\n' + body, untouched
  const line = `updatedAt: '${iso}'`
  // Anchored to frontmatterBlock specifically (not the raw content) so a
  // body that happens to start a line with "updatedAt:" is never touched —
  // this only ever matches the real top-level frontmatter key, which
  // gray-matter/js-yaml always writes unindented (column 0); every nested
  // key has leading whitespace and can't match ^.
  const stampedBlock = /^updatedAt:.*$/m.test(frontmatterBlock)
    ? frontmatterBlock.replace(/^updatedAt:.*$/m, line)
    : `${line}\n${frontmatterBlock}`
  return `---\n${stampedBlock}${rest}`
}

export interface FieldStringifyCache {
  entries: Map<string, string> // key -> last-dumped YAML text for that key
}

export function createFieldStringifyCache(): FieldStringifyCache {
  return { entries: new Map() }
}

// Dumps a single {key: value} pair through the real stringifyNote (empty
// body) and slices out just the frontmatter line(s) — reuses the exact
// same matter.stringify() call/options as the real thing, so formatting is
// guaranteed identical to what that key's slice would look like inside a
// larger dump (verified directly: concatenating every key's own dumpField
// output equals the full multi-key dump byte-for-byte).
function dumpField(key: string, value: unknown): string {
  const wrapped = stringifyNote({ frontmatter: { [key]: value }, body: '' })
  const end = wrapped.indexOf('\n---\n', 4)
  return wrapped.slice(4, end + 1)
}

// Like stringifyNote, but for each key in `cacheKeys` that ALSO appears in
// `unchangedKeys`, reuses the previously-dumped YAML text instead of
// re-serializing it. Built for local Settlement notes: residents/buildings
// stay inline in frontmatter with no size offload (see docs/plans/2026-08-
// 04-cloud-to-local-copy.md design decision #5 — Cloud never has this
// problem because it offloads above ~2MB, keeping its own inline
// frontmatter always small; Local has no such bound). A local settlement's
// frontmatter can run tens of MB, and SettlementSheet.tsx's
// commitFrontmatter used to re-stringify the WHOLE frontmatter —
// residents/buildings included — on every single keystroke in an unrelated
// field like "summary". Confirmed regression: a user typing in that field
// froze, and once crashed, the renderer.
//
// `unchangedKeys` is asserted by the CALLER, not detected here via
// reference equality — an earlier version of this function tried
// `cachedValue === value`, but this app always round-trips an edit back
// through `content` (a string): every onContentChange call re-parses fresh
// via parseNote(content), which allocates BRAND NEW arrays/objects even
// when the actual data is byte-identical. Reference equality was false on
// every single call after the first, silently defeating the cache
// entirely — confirmed regression, the bug recurred even after this
// function existed. The caller (SettlementSheet.tsx) instead derives
// unchangedKeys from whether ITS OWN patch touched that key — reliable
// because every call site in this app already follows the convention of
// only including changed fields in a patch — and guards against a
// content change from anywhere ELSE (a raw markdown hand-edit, switching
// notes) invalidating that assumption by resetting its cache whenever
// `content` doesn't match what it itself last wrote.
//
// Implementation: dumps the whole frontmatter through the real
// stringifyNote(), but with EVERY cacheKey's value swapped for a short,
// collision-proof placeholder string first — js-yaml only has to serialize
// a tiny scalar for that field, not the real array, regardless of whether
// it's a cache hit or miss — then splices the real YAML block back in for
// that one line via an exact string replace: either the cached block
// (reused, no dump at all) or a freshly-computed one (miss, dumped exactly
// once and cached for next time). An earlier version only swapped
// REUSED keys, leaving a cache-miss key's real value inline in the main
// stringifyNote() call — correct, but meant dumping that field TWICE (once
// there, once more to populate the cache) — confirmed measurably doubling
// the cost of the first edit after opening a large settlement. Always
// swapping means every key is dumped at most once per call either way, and
// the main stringifyNote() call is always cheap since it never embeds the
// real arrays. All delimiter/whitespace/body handling still runs through
// the unmodified real stringifyNote() call; the only custom part is a
// single-line swap per cache key.
export function stringifyNoteCached(note: ParsedNote, cacheKeys: string[], unchangedKeys: string[], cache: FieldStringifyCache): string {
  const patched: Record<string, unknown> = { ...note.frontmatter }
  const swaps: { line: string; dumped: string }[] = []

  for (const key of cacheKeys) {
    if (!(key in note.frontmatter)) continue
    let dumped = unchangedKeys.includes(key) ? cache.entries.get(key) : undefined
    if (dumped === undefined) {
      dumped = dumpField(key, note.frontmatter[key])
      cache.entries.set(key, dumped)
    }
    const placeholder = `__frontmatter_field_cache__${key}`
    patched[key] = placeholder
    swaps.push({ line: `${key}: ${placeholder}\n`, dumped })
  }

  let content = stringifyNote({ frontmatter: patched, body: note.body })
  for (const { line, dumped } of swaps) {
    content = content.replace(line, dumped)
  }

  return content
}
