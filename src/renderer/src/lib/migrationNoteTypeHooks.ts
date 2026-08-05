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

// Fetching the actual image bytes is injected (fetchBytes) rather than
// called directly here, so this stays testable without stubbing global
// fetch — the real implementation just does `fetch(url).then(r =>
// r.arrayBuffer())`.
export interface CloudToLocalMediaApi {
  getMapImageUrl(path: string): Promise<string>
  getSettlementBulkData(path: string): Promise<{ residents: unknown[]; buildings: unknown[] }>
  saveLocalImageBytes(bytes: ArrayBuffer, suggestedName: string): Promise<{ path: string }>
  fetchBytes(url: string): Promise<ArrayBuffer>
}

export interface LocalToCloudMediaApi {
  getLocalImageUrl(path: string): Promise<string>
  uploadSettlementBulkData(residents: SettlementResident[], buildings: SettlementBuilding[]): Promise<{ path: string }>
  uploadLocalMapImage(vaultRelativePath: string): Promise<{ path: string }>
}

function suggestedImageName(path: string): string {
  return path.split('/').pop() || 'image'
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
      const url = await api.getMapImageUrl(image.path)
      const bytes = await api.fetchBytes(url)
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
