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
  return matter.stringify(note.body, note.frontmatter)
}
