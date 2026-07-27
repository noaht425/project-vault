import { create } from 'zustand'
import {
  travelModesFrontmatterSchema,
  defaultTravelModesFrontmatter,
  type TravelMode,
  type TravelModesFrontmatter
} from '../../../common/noteTypes/travelModes'
import type { CloudTreeNode } from '../../../common/cloudTypes'

const TRAVEL_MODES_NOTE_NAME = 'Travel Modes'

// Shared stable-reference fallback for `frontmatter?.modes ?? EMPTY_MODES`
// selectors — a fresh `[]` literal there would make zustand's
// useSyncExternalStore see a "new" value on every check and spin into an
// infinite render loop (React error #185) while frontmatter is still null,
// i.e. every time a map/travel-modes note is opened before load() resolves.
export const EMPTY_TRAVEL_MODES: TravelMode[] = []

// Travel-mode presets are global (setting-wide, not per-map), so rather than
// a dedicated table this is just the one note of type 'travel-modes' in the
// workspace — found by scanning the tree, auto-created on first use. Same
// "note as document store" approach as the map note type itself.
function findTravelModesNode(nodes: CloudTreeNode[]): CloudTreeNode | null {
  for (const node of nodes) {
    if (!node.isDirectory && node.noteType === 'travel-modes') return node
    if (node.children) {
      const found = findTravelModesNode(node.children)
      if (found) return found
    }
  }
  return null
}

interface TravelModesState {
  noteId: string | null
  version: number
  frontmatter: TravelModesFrontmatter | null
  loading: boolean
  load: () => Promise<void>
  save: (modes: TravelMode[]) => Promise<void>
}

export const useTravelModesStore = create<TravelModesState>((set, get) => ({
  noteId: null,
  version: 0,
  frontmatter: null,
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const tree = (await window.cloudApi.getCachedTree()) ?? (await window.cloudApi.refreshTree())
      const existing = findTravelModesNode(tree)

      if (existing) {
        const note = await window.cloudApi.getNote(existing.id)
        set({ noteId: note.id, version: note.version, frontmatter: travelModesFrontmatterSchema.parse(note.frontmatter), loading: false })
      } else {
        const frontmatter = defaultTravelModesFrontmatter()
        const note = await window.cloudApi.createNote({ name: TRAVEL_MODES_NOTE_NAME, frontmatter })
        set({ noteId: note.id, version: note.version, frontmatter, loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  save: async (modes) => {
    const { noteId, version, frontmatter } = get()
    if (!noteId || !frontmatter) return

    // A PATCH's frontmatter is a full column replace, not a merge (see
    // project-vault-cloud's PATCH /api/notes/[id]) — sending only { modes }
    // would silently wipe `type`/`tags` and corrupt the generated
    // note_type column this store's own lookup depends on.
    const nextFrontmatter: TravelModesFrontmatter = { ...frontmatter, modes }
    set({ frontmatter: nextFrontmatter })

    const attempt = (atVersion: number) => window.cloudApi.saveNote({ id: noteId, version: atVersion, frontmatter: nextFrontmatter })

    const result = await attempt(version)
    if (result.status === 'saved') {
      set({ version: result.note.version })
      return
    }

    // One retry against whatever version actually landed — this is a
    // personal, low-stakes preset list, not worth a full conflict-banner UI.
    const retry = await attempt(result.current.version)
    if (retry.status === 'saved') set({ version: retry.note.version })
  }
}))
