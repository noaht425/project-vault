// Matches [[Title]], [[Title|Alias]], and [[Title#Heading]] (heading/alias
// are captured but only the title is used for link resolution in v1).
const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

export function extractWikiLinkTitles(content: string): string[] {
  const titles: string[] = []
  for (const match of content.matchAll(WIKI_LINK_RE)) {
    const title = match[1].trim()
    if (title) titles.push(title)
  }
  return titles
}
