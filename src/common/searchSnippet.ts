// SQLite's snippet() wraps matches with the two marker strings we give it.
// We use control characters (never legitimate note content) as those
// markers instead of real HTML tags, specifically so the renderer never
// needs dangerouslySetInnerHTML to show highlights — it splits on these
// markers and renders plain text / <mark> as real React elements instead.
export const SNIPPET_MATCH_START = ''
export const SNIPPET_MATCH_END = ''

export interface SnippetSegment {
  text: string
  highlighted: boolean
}

export function parseSnippet(raw: string): SnippetSegment[] {
  const segments: SnippetSegment[] = []
  let i = 0

  while (i < raw.length) {
    const start = raw.indexOf(SNIPPET_MATCH_START, i)
    if (start === -1) {
      segments.push({ text: raw.slice(i), highlighted: false })
      break
    }
    if (start > i) segments.push({ text: raw.slice(i, start), highlighted: false })

    const end = raw.indexOf(SNIPPET_MATCH_END, start)
    if (end === -1) {
      segments.push({ text: raw.slice(start + 1), highlighted: true })
      break
    }
    segments.push({ text: raw.slice(start + 1, end), highlighted: true })
    i = end + 1
  }

  return segments
}
