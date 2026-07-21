import { useEditorStore } from '../state/editorStore'

/**
 * Shared by PreviewPane's rendered [[wiki-links]] and the family-tree
 * diagram's clickable name boxes — both resolve a title to a note the same
 * way (exact-title match, else tell the user it doesn't exist yet).
 */
export function useWikiLinkNavigation(): (title: string) => Promise<void> {
  const openNote = useEditorStore((s) => s.openNote)

  return async (title: string): Promise<void> => {
    try {
      const matches = await window.vaultApi.searchTitles(title)
      const exact = matches.find((m) => m.title.toLowerCase() === title.toLowerCase())
      if (exact) {
        await openNote(exact.path)
      } else {
        window.alert(`No note titled "${title}" yet.`)
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }
}
