# Add "Copy Cloud Workspace → Local Vault" (mirror the existing Local → Cloud import)

Written for a fresh session to execute. Read this whole doc before starting
— it's the result of a research pass over the existing local→cloud copy
feature and every cloud-only capability that would need a local equivalent
first. Don't re-derive any of the "Already understood" sections below from
scratch; verify them if you like, but they're accurate as of this write-up.

## What the user wants

A button that copies the Cloud Workspace into the Local Vault, mirroring
the existing "Import Local Vault…" button (which copies Local → Cloud).
Goal: work in either workspace, then copy changes into the other on
demand. **Not** a continuous/automatic sync — a manual, one-directional
copy action you trigger from either side.

**Confirmed with the user: this needs to update existing notes, not just
create missing ones.** The existing Local→Cloud importer is create-only
(see below) — that's *not* sufficient here, since the user's actual
workflow is editing a note that already exists on both sides and wanting
that edit carried over. Behavior needed, per note that already exists on
both sides:
- Source is newer than destination → safe, go ahead and overwrite the
  destination.
- Destination is newer than, or the same age as, the source (or either
  side's modified-time is unknown/missing) → **do not overwrite** — this
  would silently clobber a change the user might not remember making
  elsewhere. Skip it and surface it clearly as something the user needs
  to look at themselves, rather than guessing. The user picked
  "compare and warn" explicitly as the safest option over blind overwrite.
- This must apply **symmetrically to both directions** — the existing
  Local→Cloud importer needs this same upgrade, not just the new button,
  or the two buttons would behave inconsistently.

This requires porting features that currently only exist in the Cloud
Workspace to the Local Vault first, because the copy can't create locally
what Local can't represent yet. Two things are cloud-only right now:
**Map notes** (image storage) and **Settlement bulk data** (large
resident/building arrays, offloaded to cloud storage above a size
threshold). Everything else copies as plain frontmatter/body text already.

## Already understood — study these before writing any code

**The existing Local→Cloud copier**, `src/renderer/src/lib/vaultCloudMigration.ts`,
function `importVaultIntoCloud()`. Its own top-of-file comment:

> "One-time (safely re-runnable) tool to seed the Cloud Workspace from the
> local Vault... nothing here is a sync engine, it's a bulk 'create what's
> missing' pass reusing the same one-at-a-time IPC calls the UI uses for
> everyday edits."

Key properties — most worth preserving in the reverse direction, **except
create-only-never-overwrites, which this plan deliberately changes to
compare-and-warn (see "What the user wants" above and design decision #1
below)**:
- **Create-only, never overwrites, today.** Builds an index of the
  destination's existing tree keyed by `${parentId}::${name}`
  (`indexCloudTree`) before starting, skips anything already present. This
  plan adds a comparison step for the already-present case instead of an
  unconditional skip.
- **Idempotent / safely re-runnable** — rerunning only creates net-new
  items. This is *why* it uses an index check rather than catching a
  create-conflict error (a `unique(workspace_id, parent_id, name)`
  constraint doesn't dedupe root-level items the naive way, since Postgres
  never treats two `NULL` `parent_id`s as equal — read the code comment
  around this, it's non-obvious).
- **Recursive tree walk**, folders before files at each level, one
  note/folder at a time via the same IPC calls the UI itself uses (not a
  bulk transaction).
- **Per-item error handling** — failures collect into `progress.errors`
  and stream live via `onProgress`; a failed folder skips its subtree
  (no id to attach children to).
- **Only copies `frontmatter`/`body`** — no image or attachment handling
  at all today, because Local has never needed any (see below).

Its UI: `VaultImportPanel.tsx`, triggered from `CloudFileTree.tsx`'s
"Import Local Vault…" toolbar button (only present in Cloud Workspace's
sidebar). Progress UI streams from `onProgress` — reuse this exact
component shape for the new direction rather than inventing a new pattern.

**Note identity across the two storage models** — there is no persistent
cross-reference id anywhere. Local identity is filesystem path/filename;
Cloud identity is a Postgres `notes.id` uuid. The importer bridges them
purely by **name + folder position**, matching Postgres's
`unique(workspace_id, folder_id, name)` constraint. Do the same in
reverse: match by filename (`name` minus `.md`) + folder path.

**Map notes are cloud-only today**, deliberately — see the comment at the
top of `src/common/noteTypes/map.ts`. `'map'` is absent from
`CREATABLE_NOTE_KINDS`/`TEMPLATE_DEFAULTS` (`src/common/noteTemplateDefaults.ts`)
and from the local `NoteTemplate` union (`src/common/types.ts`). It's
created only via a dedicated "+ Map" button in `CloudFileTree.tsx`
(`cloudApi.createNote` directly, not the generic "New" menu).

Important nuance already confirmed: **`SheetView.tsx` is fully shared**
between `Editor.tsx` (local) and `CloudEditor.tsx` (cloud), and switches
purely on `frontmatter.type` — it does **not** hard-fail on a
`type: map` note opened locally, it renders `MapSheet` regardless.
`MapSheet.tsx` itself is **not** gated by `noteRefApi.isCloud` (unlike
`SettlementSheet.tsx`, which is) — it unconditionally calls
`window.cloudApi.pickAndUploadMapImage()`/`getMapImageUrl()`, which are
always present on `window` (single preload script) but fail against the
real network when there's no active cloud session, silently showing no
image. This is the one existing "leak" and exactly what Phase 3 below
needs to fix properly rather than route around.

**Cloud Map image storage**: `cloudSession.ts`'s `uploadMapImage`/
`getMapImageUrl`/`storageClient()` — a bearer-token-scoped Supabase client
per call (bypasses the Vercel API entirely), object paths namespaced
`${userId}/${randomUUID()}${ext}`, 1-hour signed URLs. Backed by the
`map-images` Storage bucket + owner-scoped RLS
(`project-vault-cloud/supabase/migrations/0002_map_images_storage.sql`).

**Cloud Settlement bulk-data offload**: already shipped (see
`docs/plans/2026-08-03-cloud-settlement-storage-offload.md` for the full
design rationale — read it, don't re-litigate the 4.5MB Vercel body-limit
reasoning). Implementation: `uploadSettlementBulkData`/
`getSettlementBulkData` in `SettlementSheet.tsx` (~lines 57-119), gated by
`noteRefApi.isCloud`, referenced via `frontmatter.bulkDataStoragePath`.
**Local Vault has no equivalent limit** — it writes straight to a file via
IPC, no HTTP request involved, confirmed directly in that plan doc. This
means Local doesn't need its own offload system at all; it just needs to
always store bulk data inline, and the copier needs to translate between
"offloaded pointer" (cloud) and "always inline" (local) in both
directions.

**Local Vault has zero attachment/image storage today**, for any note
type. This needs to be built from scratch in Phase 2.

## Design decisions (recommended — confirm with the user only if you want to deviate)

1. **Compare-and-warn, not create-only, not blind-overwrite.** Confirmed
   with the user (see "What the user wants"). Still idempotent, still
   matched by name+folder, still no real merge UI — the only change from
   the existing importer's model is: an already-present note gets a
   timestamp comparison instead of an unconditional skip. This is
   meaningfully short of true two-way sync (no merging content, no
   handling "both sides changed since last copy" as anything other than
   "warn, let the user sort it out") — don't scope-creep into building
   real conflict resolution/diffing, that's a much bigger feature the user
   hasn't asked for.
2. **A reliable "last modified" timestamp needs to exist on both sides
   before comparison is possible at all — this doesn't exist today and is
   new foundational work (see Phase 1).** Cloud has `notes.updated_at` in
   Postgres, but Local notes are just files with no modified-time
   tracked anywhere in the app's own data (filesystem mtime exists but
   isn't trustworthy as a source of truth — it resets on file
   copies/restores/certain sync tools, which is exactly the kind of
   operation this whole feature revolves around). Recommended fix:
   **stamp an `updatedAt` ISO-timestamp field directly into every note's
   frontmatter**, on both Local and Cloud, at the single existing
   centralized save chokepoint each side already has
   (`editorStore.ts`/`cloudEditorStore.ts`'s `saveNow()` — see the
   `docs/plans/2026-08-03-cloud-settlement-storage-offload.md` doc, which
   already identified and touched these same two functions for an
   unrelated fix, so this session doesn't need to rediscover them).
   Embedding it in frontmatter (rather than relying solely on cloud's
   Postgres column) keeps the comparison logic storage-backend-agnostic —
   the copier just reads one field the same way from either side,
   regardless of where the note came from. **Missing/unparseable
   `updatedAt` on either side (e.g. a note saved before this field
   existed) must be treated as "don't know, don't overwrite" — fold it
   into the warn case, never the safe-to-overwrite case**, since silent
   data loss is worse than an extra manual review.
3. **Local image storage location**: a hidden folder at the vault root,
   e.g. `.attachments/` (same dotfile-hidden-from-tree convention already
   used for `.project-vault-settings.json` — check `src/main/vault/tree.ts`
   for exactly how dotfiles get excluded, reuse it). Store images as
   `<uuid>-<sanitized-original-filename>`, referenced by a path relative
   to the vault root in frontmatter (mirroring how cloud stores a `path`
   string, not a full URL).
4. **Serving local images to the renderer**: check `src/main/index.ts`'s
   `BrowserWindow`/`webPreferences` config first — if `file://` access
   from the renderer isn't already blocked, a `file://<absolute path>` URL
   may just work. If it's locked down, register a custom protocol handler
   in the main process (e.g. `vault-attachment://`) the way Electron apps
   commonly do for local asset serving. Don't assume either way — verify
   against this app's actual config before building the image-loading
   path.
5. **Settlement bulk data**: no local offload system. Local settlements
   always keep `residents`/`buildings`/etc. inline in frontmatter,
   regardless of size (confirmed safe — see above). The copier is what
   handles translation: cloud→local downloads the offloaded blob and
   inlines it, dropping `bulkDataStoragePath`; local→cloud checks size and
   offloads if needed (reuse the existing `shouldOffloadBulkData()`
   check/upload path).
6. **Code organization**: add the new direction as a sibling exported
   function in `vaultCloudMigration.ts` (e.g. `importCloudIntoVault()`),
   reusing the same tree-walk/indexing/comparison shape rather than
   duplicating the file. The two functions will diverge in their
   per-note-type image/bulk-data handling (item 7 below), but the core
   walk-and-create-or-compare logic is structurally identical, just
   reversed.
7. **Per-note-type extra handling lives outside the generic walk**: keep
   the generic copier ignorant of note-type specifics (it just moves
   frontmatter+body, as today). Add a thin post-processing hook — "after
   creating/updating this note, if its `type` is `map`/`settlement`, run
   this extra step" — so Map image download/upload and Settlement
   bulk-data inline/offload logic stay isolated and independently testable
   rather than baked into the generic tree walk.
8. **Surfacing a warned-and-skipped note**: don't build a per-note
   blocking modal that interrupts a bulk copy for every conflict — this
   is a batch operation that could touch dozens of notes. Instead, run the
   whole pass, collect every "destination looks newer/unknown" case into a
   list, and show that list at the end alongside the existing
   created/updated/error counts (extend `VaultImportPanel.tsx`'s existing
   progress-summary shape rather than inventing a new UI pattern). The
   user reviews and re-copies individual notes manually if they decide the
   overwrite is actually safe — v1 doesn't need a "force update this one"
   button, see Open Questions.

## Phased implementation plan

### Phase 1 — `updatedAt` timestamp tracking (prerequisite for everything else)
- Add `updatedAt: string | null` (ISO timestamp) as a shared frontmatter
  field alongside the other cross-note-type fields like `tags`/`summary`
  (check whether it makes more sense added per-schema in each
  `noteTypes/*.ts` file, or handled generically at the save layer so every
  note type gets it automatically without touching ~14 schema files —
  prefer the generic approach if `stringifyNote`/the save chokepoint can
  cleanly own it).
- Stamp it on every save, both sides, at the single existing centralized
  save function each side already has: `editorStore.ts`'s `saveNow()`
  (local) and `cloudEditorStore.ts`'s `saveNow()` (cloud) — see design
  decision #2 for why these are the right/only chokepoints to touch.
- Existing notes (created before this field existed) will have
  `updatedAt: null` until their next save — confirm the comparison logic
  (Phase 5/6) treats `null` as "unknown, don't overwrite" per design
  decision #2, not as "infinitely old, always safe to overwrite."

### Phase 2 — Local image/attachment storage infrastructure
- New main-process IPC handlers (mirror `cloud.ts`'s Map image handlers'
  shape, but write to local disk): something like
  `vault:pickAndSaveLocalImage(vaultPath)` → copies a user-picked file into
  `.attachments/`, returns the relative path + dimensions;
  `vault:getLocalImageUrl(vaultPath, relativePath)` → resolves to whatever
  URL scheme design decision #4 lands on.
- Preload bridge additions (`src/preload/index.ts`'s `vaultApi`).
- Make sure `.attachments/` is excluded from the note tree the same way
  `.project-vault-settings.json` already is.

### Phase 3 — Local Map note support
- Add `'map'` to `CREATABLE_NOTE_KINDS`/`TEMPLATE_DEFAULTS`
  (`noteTemplateDefaults.ts`) and the local `NoteTemplate` union
  (`types.ts`).
- Add a "+ Map" creation entry point to the **local** `FileTree.tsx`,
  mirroring `CloudFileTree.tsx`'s existing dedicated button (Map isn't in
  the generic "New" menu even in Cloud).
- Make `MapSheet.tsx` environment-aware: branch on `noteRefApi.isCloud`
  between `window.cloudApi.pickAndUploadMapImage()`/`getMapImageUrl()` and
  the new local equivalents from Phase 2 — same gating pattern
  `SettlementSheet.tsx` already uses, copy it.
- Everything else in the Map feature set (`MapCanvas.tsx`,
  `MapTripCalculator.tsx`, `MapTimeline.tsx`, `mapGeometry.ts`, landmasses,
  travel modes, the globe/wraparound/latitude-distortion system added
  since) is already environment-agnostic — it only ever touches
  `frontmatter`, not `window.cloudApi` — so this should be the only file
  needing a code change for Map itself to work locally.

### Phase 4 — Settlement bulk-data inline/offload translation
- No new local storage system (per design decision #5) — just make sure
  `SettlementSheet.tsx`'s existing `isCloud` gate already does the right
  thing for Local (inline always) — verify, don't assume, since this
  logic was written cloud-first.
- This phase is really just verification + writing the copier-side
  translation logic that Phase 5/6 need — there's likely very little to
  change in `SettlementSheet.tsx` itself.

### Phase 5 — Build `importCloudIntoVault()` + UI
- New function in `vaultCloudMigration.ts`, structurally mirroring
  `importVaultIntoCloud()` (indexed-by-name+folder, per-item error
  collection, idempotent) but walking the Cloud tree and creating into the
  Local vault instead. **Diverges from the existing importer at the
  "already exists" branch**: instead of unconditionally skipping, read
  both sides' `updatedAt` (Phase 1) and either overwrite (source newer),
  or skip-and-record-as-a-warning (destination newer/same-age/either side
  unknown) — see design decisions #1, #2, #8.
- Per-note-type post-processing hook (design decision #7), run on both
  create AND update: for a `type: map` note, download its image from
  Supabase Storage (`cloudSession.ts`'s existing signed-URL fetch, or a
  new bulk-download path) and save it locally via Phase 2's new IPC,
  rewriting `frontmatter.image.path`. For a `type: settlement` note with
  `bulkDataStoragePath` set, fetch the blob (`getSettlementBulkData`) and
  inline it, dropping the pointer field.
- New UI: a "Import Cloud Workspace…" button in the **local** `FileTree.tsx`
  toolbar (mirroring where the existing button lives in `CloudFileTree.tsx`),
  triggering a new panel component mirroring `VaultImportPanel.tsx`'s
  progress-streaming UX, extended with the warned/skipped-notes list
  (design decision #8).

### Phase 6 — Symmetric upgrade to the existing `importVaultIntoCloud()`
- Once Local can have real Map notes with real local images, the
  *existing* Local→Cloud copier needs the mirror-image extra step: for a
  local `type: map` note, upload its local image file to Supabase Storage
  and rewrite `frontmatter.image.path` to the cloud path/pointer shape.
- Same for oversized local settlements being pushed to cloud: reuse the
  existing `shouldOffloadBulkData()`/`uploadSettlementBulkData()` path that
  `SettlementSheet.tsx` already has for interactive saves.
- Without this phase, copying a locally-created Map note to Cloud would
  silently drop its image (frontmatter would carry a local-relative path
  that means nothing in Supabase Storage) — don't skip it.
- **Also apply the same compare-and-warn upgrade from Phase 5 here** —
  this function currently skips existing notes unconditionally; it needs
  the identical `updatedAt` comparison and warned-list reporting, not just
  the image/bulk-data handling. This is the "symmetric" part of the phase
  name — after this phase, both buttons behave identically in both the
  update logic and the warning UX, just mirrored in direction.

### Phase 7 — Tests
Follow this repo's existing `vitest` conventions (see `tests/*.test.ts` for
style). At minimum:
- Idempotency: running either copy direction twice with no changes on
  either side creates/updates nothing the second time.
- **Update case**: an existing note whose source-side `updatedAt` is newer
  than the destination's gets overwritten with the source's content.
- **Warn case**: an existing note whose destination-side `updatedAt` is
  newer, equal, or where either side is `null`/missing gets left alone and
  shows up in the warned-list, not silently skipped or silently
  overwritten.
- Name+folder matching correctly identifies "this note already exists" on
  either side (the precondition for the update/warn branch above).
- A Map note's image survives a round trip (cloud→local→cloud, or
  local→cloud→local) with working dimensions/URL at the end, on both the
  create path and the update path.
- A Settlement's bulk data survives a round trip regardless of which
  direction offloads/inlines it, on both the create path and the update
  path.
- Partial-failure behavior: one bad note/folder doesn't abort the whole
  copy, and its subtree is skipped cleanly (mirror the existing importer's
  tests if any exist for `importVaultIntoCloud` — check first).

## Open questions to confirm with the user before or during implementation

- Exact name for the local hidden attachments folder (`.attachments/` is
  a reasonable default, not confirmed).
- Whether the two directions should live behind one panel with a
  direction toggle, or stay as two separate buttons/entry points (one in
  each file tree) — recommend the latter, since it mirrors the existing
  UI exactly and avoids inventing new UX for something that already has a
  working pattern.
- Whether a confirmation dialog is wanted before running either copy
  direction — the existing importer doesn't have one (it's non-destructive
  by design), but this version *can* overwrite existing notes now (when
  source is confirmed newer), which is a meaningfully different risk
  profile — worth a quick check with the user on whether the update case
  should show a summary confirm ("N notes will be updated, M skipped as
  conflicts — proceed?") before actually writing anything, rather than
  just running and reporting after the fact.
- **Does v1 need a way to force-overwrite a specific warned/conflicting
  note from inside the summary UI**, or is "go open that note yourself and
  decide" (possibly running the single-note copy manually some other way)
  acceptable for a first version? Recommend deferring this — it adds real
  UI surface (a per-row action, its own confirm) for a case that should be
  rare if `updatedAt` tracking works correctly, and nothing about the
  warn-and-skip design forecloses adding it later.
- Confirm the `updatedAt` field name doesn't collide with anything already
  used informally in existing frontmatter across note types (quick grep
  before adding it — low risk given `.passthrough()` schemas, but cheap to
  check).
