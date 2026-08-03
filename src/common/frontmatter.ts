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
