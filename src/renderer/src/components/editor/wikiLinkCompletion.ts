import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

/** Triggers on `[[`, queries the vault's note titles via IPC, and inserts
 *  `Title]]` on accept (the user already typed the opening `[[`). */
export function wikiLinkCompletionSource(
  context: CompletionContext
): Promise<CompletionResult | null> | CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]]*/)
  if (!match) return null

  const query = match.text.slice(2)
  if (query.length === 0 && !context.explicit) return null

  return window.vaultApi.searchTitles(query).then((results) => {
    if (results.length === 0) return null
    return {
      from: match.from + 2,
      options: results.map((r) => ({
        label: r.title,
        apply: `${r.title}]]`,
        type: 'text'
      })),
      validFor: /^[^\]]*$/
    }
  })
}
