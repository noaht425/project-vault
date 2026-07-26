import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

/** Triggers on `[[`, queries the cloud workspace's note titles via IPC, and
 *  inserts `Name]]` on accept — cloud counterpart of wikiLinkCompletion.ts,
 *  swapping vaultApi.searchTitles for cloudApi.searchTitles. */
export function cloudWikiLinkCompletionSource(
  context: CompletionContext
): Promise<CompletionResult | null> | CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]]*/)
  if (!match) return null

  const query = match.text.slice(2)
  if (query.length === 0 && !context.explicit) return null

  return window.cloudApi.searchTitles(query).then((results) => {
    if (results.length === 0) return null
    return {
      from: match.from + 2,
      options: results.map((r) => ({
        label: r.name,
        apply: `${r.name}]]`,
        type: 'text'
      })),
      validFor: /^[^\]]*$/
    }
  })
}
