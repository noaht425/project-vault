import { useLocalNoteRefApi } from '../lib/noteRefApi'

/**
 * Used by PreviewPane's rendered [[wiki-links]] — resolves a title to a
 * note (exact-title match, else tell the user it doesn't exist yet). Thin
 * wrapper over useLocalNoteRefApi, which also backs PcSheet's
 * class-reference lookup and ClassFeaturesPanel — this hook just exists so
 * PreviewPane doesn't need to know the resolver interface exists.
 */
export function useWikiLinkNavigation(): (title: string) => Promise<void> {
  return useLocalNoteRefApi().openByTitle
}
