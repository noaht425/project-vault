import matter from 'gray-matter'

export interface ParsedNote {
  frontmatter: Record<string, unknown>
  body: string
}

export function parseNote(content: string): ParsedNote {
  const { data, content: body } = matter(content)
  return { frontmatter: data, body }
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
