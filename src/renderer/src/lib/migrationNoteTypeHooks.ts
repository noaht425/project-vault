// Per-note-type translation for the cloud<->local vault copier — kept out
// of vaultCloudMigration.ts's generic tree-walk (which only ever moves
// frontmatter/body) so Map image and Settlement bulk-data handling stay
// isolated and independently testable, per docs/plans/2026-08-04-cloud-to-
// local-copy.md design decision #7. Runs as a post-processing hook on both
// the create AND update path for a note, right before it's written to the
// destination.
import type { SettlementBuilding, SettlementResident } from '../../../common/noteTypes/settlement'

export interface TranslatedNote {
  frontmatter: Record<string, unknown>
  body: string
}

// downloadMapImage fetches bytes directly (Supabase Storage .download(),
// same approach getSettlementBulkData already used) rather than handing
// back a signed URL for the renderer to fetch() itself — an earlier version
// did that and failed in production with a generic "Failed to fetch": an
// <img> element (MapSheet.tsx's own display path, unaffected) can load
// cross-origin without CORS, but fetch()+arrayBuffer() needs a CORS-
// readable response, and Supabase's default bucket CORS policy doesn't
// allow that from this app's file:// origin. Downloading server-side (in
// CloudSession, which runs in the main process, not a browser) sidesteps
// CORS entirely.
export interface CloudToLocalMediaApi {
  downloadMapImage(path: string): Promise<ArrayBuffer>
  getSettlementBulkData(path: string): Promise<{ residents: unknown[]; buildings: unknown[] }>
  saveLocalImageBytes(bytes: ArrayBuffer, suggestedName: string): Promise<{ path: string }>
}

export interface LocalToCloudMediaApi {
  getLocalImageUrl(path: string): Promise<string>
  uploadSettlementBulkData(residents: SettlementResident[], buildings: SettlementBuilding[]): Promise<{ path: string }>
  uploadLocalMapImage(vaultRelativePath: string): Promise<{ path: string }>
}

function suggestedImageName(path: string): string {
  return path.split('/').pop() || 'image'
}

// A Map note that exists on both sides is otherwise an all-or-nothing
// timestamp comparison (see vaultCloudMigration.ts's isSourceNewer) — fine
// for most fields, but pins are independently-addressable (each has its own
// stable `id`, added by whichever side the user happened to be using at the
// time) rather than one blob that only makes sense as a single "current"
// version. Under the plain newer-wins-or-skip rule, a pin added on the side
// that ISN'T picked as newer (or on a rerun where dest is now newer/same-
// age) never reaches the other side at all, and even on the side that DOES
// win, a full overwrite silently drops any pin the losing side had that the
// winning side doesn't — that's the actual reported bug. Returns null when
// there's nothing to add (dest already has every pin source has, or either
// side isn't a map) so callers can tell "nothing to do" apart from "merge
// to an empty/unchanged pins array." On an id collision, dest's own pin
// always wins — this only ever ADDS pins the destination is missing, never
// overwrites one that already exists there under the same id.
export function mergeMapPins(
  destFrontmatter: Record<string, unknown>,
  sourceFrontmatter: Record<string, unknown>
): { pins: unknown[]; addedCount: number } | null {
  if (destFrontmatter.type !== 'map' || sourceFrontmatter.type !== 'map') return null
  const destPins = Array.isArray(destFrontmatter.pins) ? destFrontmatter.pins : []
  const sourcePins = Array.isArray(sourceFrontmatter.pins) ? sourceFrontmatter.pins : []
  const destIds = new Set(destPins.map((p) => (p as { id?: unknown })?.id))
  const missing = sourcePins.filter((p) => !destIds.has((p as { id?: unknown })?.id))
  if (missing.length === 0) return null
  return { pins: [...destPins, ...missing], addedCount: missing.length }
}

// Cloud's frontmatter shape isn't imported/validated here (zod-parsing a
// possibly-mid-migration note is exactly the kind of extra coupling design
// decision #7 wants to avoid) — just reads the couple of fields this
// translation cares about, loosely, the same "don't assume the whole shape"
// spirit `.passthrough()` schemas already have everywhere else.
export async function translateCloudNoteForLocal(note: TranslatedNote, api: CloudToLocalMediaApi): Promise<TranslatedNote> {
  const { frontmatter, body } = note

  if (frontmatter.type === 'map') {
    const image = frontmatter.image as { path?: unknown } | null | undefined
    if (image && typeof image.path === 'string' && image.path) {
      const bytes = await api.downloadMapImage(image.path)
      const saved = await api.saveLocalImageBytes(bytes, suggestedImageName(image.path))
      return { frontmatter: { ...frontmatter, image: { ...image, path: saved.path } }, body }
    }
  }

  if (frontmatter.type === 'settlement') {
    const bulkPath = frontmatter.bulkDataStoragePath
    if (typeof bulkPath === 'string' && bulkPath) {
      const { residents, buildings } = await api.getSettlementBulkData(bulkPath)
      return { frontmatter: { ...frontmatter, residents, buildings, bulkDataStoragePath: null }, body }
    }
  }

  return note
}

// Mirror direction for Phase 6's symmetric upgrade to importVaultIntoCloud —
// a local Map note's image is a file under .attachments/, uploaded to
// Supabase Storage; an oversized local Settlement's residents/buildings get
// offloaded the same way SettlementSheet.tsx already does for interactive
// saves (see shouldOffloadBulkData).
export async function translateLocalNoteForCloud(
  note: TranslatedNote,
  api: LocalToCloudMediaApi,
  shouldOffloadBulkData: (residents: SettlementResident[], buildings: SettlementBuilding[]) => boolean
): Promise<TranslatedNote> {
  const { frontmatter, body } = note

  if (frontmatter.type === 'map') {
    const image = frontmatter.image as { path?: unknown } | null | undefined
    if (image && typeof image.path === 'string' && image.path) {
      const uploaded = await api.uploadLocalMapImage(image.path)
      return { frontmatter: { ...frontmatter, image: { ...image, path: uploaded.path } }, body }
    }
  }

  if (frontmatter.type === 'settlement') {
    const residents = (Array.isArray(frontmatter.residents) ? frontmatter.residents : []) as SettlementResident[]
    const buildings = (Array.isArray(frontmatter.buildings) ? frontmatter.buildings : []) as SettlementBuilding[]
    if (shouldOffloadBulkData(residents, buildings)) {
      const { path } = await api.uploadSettlementBulkData(residents, buildings)
      return { frontmatter: { ...frontmatter, residents: [], buildings: [], bulkDataStoragePath: path }, body }
    }
  }

  return note
}
