# Cloud Workspace settlements: move bulk data to Supabase Storage

Written because the current session is running low on usage budget after a
long back-and-forth diagnosing this — read this whole doc before starting,
don't re-derive from scratch. The user has confirmed the fix direction
(below); what's missing is the actual implementation.

## Confirmed root cause (don't re-investigate this part)

Cloud Workspace settlement saves were failing/hanging with **zero visible
feedback** until this session added proper error surfacing (see "Already
fixed this session" below). Once that shipped, the user hit Save and got
back the real error:

```
Save failed: Error invoking remote method 'cloud:saveNote': SyntaxError:
Unexpected token 'R', "Request En"... is not valid JSON
```

That's Vercel's platform-level Serverless Function request body limit
(**~4.5MB**, hard limit, not configurable via Next.js `bodyParser` config —
that setting never applied to the App Router anyway) rejecting the request
with a plain-text "Request Entity Too Large" response before
`project-vault-cloud`'s own `PATCH /api/notes/[id]` handler ever runs. The
client tries to `res.json()` that plain-text body and throws a JSON parse
error instead of getting a clean HTTP status to handle — which is why the
surfaced message looks like a JSON parsing bug rather than a size-limit
rejection (worth cleaning up while in here, see "Nice to have" below).

A generated Settlement's `residents`/`buildings` arrays can easily be
**30+ MB of JSON** at Metropolis scale (verified directly: stringifying a
~65,000-resident settlement produces ~36MB). Cloud Workspace sends the
**entire** frontmatter (including those arrays) as one PATCH request body —
nowhere close to fitting in 4.5MB for anything but a small settlement.

**Local Vault has no such limit** — it writes straight to a file via IPC,
no HTTP request involved at all. This is why several earlier fixes this
session (see below) never fully resolved the user's reports: those fixes
were all real and correct, just for a code path (Local Vault) the user
wasn't actually hitting for this particular settlement.

## Already fixed this session (don't re-investigate, just build on top)

All committed and pushed to `main`, all covered by tests, all working
correctly for **Local Vault**:

1. `stringifyNote` (`src/common/frontmatter.ts`) now passes `noRefs: true`
   to gray-matter/js-yaml — cut a Metropolis-scale settlement's stringify
   time from 7.6s to ~1.0s (js-yaml's default shared-reference detection
   pass is pure overhead here, byte-for-byte identical output either way).
2. `SheetView.tsx`'s top-level `parseNote(content)` call is now memoized
   on `content` — it used to re-run on every unrelated re-render.
3. `openNote`/`closeNote` in both `editorStore.ts` and `cloudEditorStore.ts`
   now flush (`saveNow()`) the currently-open note before switching away
   or clearing state — they used to just `clearTimeout` the pending
   debounced autosave and discard it.
4. `main/index.ts`'s `before-quit` handler asks the renderer to flush
   before actually quitting (bounded by a timeout, `QUIT_FLUSH_TIMEOUT_MS`,
   currently 30s) instead of trusting the debounce timer to have already
   fired.
5. A manual **Save button** in the title bar (`App.tsx`), enabled/labeled
   "Save\*" whenever either editor store is dirty, calling both stores'
   `saveNow()` unconditionally (each is a no-op when not dirty). Cmd+S now
   routes through the same `saveAll()` — it used to only ever save the
   Local Vault store, silently doing nothing in Cloud Workspace.
6. Both editor stores now track `saving` (true while a save IPC/network
   call is in flight) and `saveError` (the actual thrown message, cleared
   on the next attempt or on opening/closing a note) — surfaced next to
   the Save button. **This is what let the user finally see the real
   error above** — before this, a failing save only ever reached the
   (invisible to a normal user) devtools console.
7. Both stores' `saveNow()` now has a 60s timeout
   (`SAVE_TIMEOUT_MS`/`withTimeout`) around the actual save call, so a
   hung request surfaces a clear "timed out" error instead of waiting
   forever with zero feedback. Doesn't cancel the underlying call (no
   clean way to abort `ipcRenderer.invoke` or `fetch`) — the existing
   `baseVersion`/optimistic-concurrency check is what protects against a
   late-arriving response landing after a retry.

None of the above fixes the Cloud-specific 4.5MB ceiling itself — they made
the *symptom* (silent, confusing failure) visible and fixed real bugs, but
the underlying limit is a platform constraint that needs an actual
architecture change.

## Chosen fix direction (confirmed with the user)

Move a settlement's bulk generated data (residents, buildings, and
probably factions — see open question below) out of the note's inline
`frontmatter` and into **Supabase Storage**, uploaded/downloaded directly
from the Electron main process, bypassing the Vercel API (and its 4.5MB
limit) entirely for that data. The note's `frontmatter` keeps only a
pointer/reference plus the lightweight Setup-tab config fields (race
distribution, wealth tiers, building type defs, etc. — all small).

**This exact pattern already exists in this codebase** — study it closely
before designing anything new:

- `project-vault-cloud/supabase/migrations/0002_map_images_storage.sql` —
  the `map-images` Storage bucket + its owner-scoped RLS policy
  (`map_images_owner_all`, checks the first path segment against
  `auth.uid()`).
- `src/main/cloud/cloudSession.ts`'s `uploadMapImage`/`getMapImageUrl`/
  `storageClient()` — a fresh bearer-token-scoped Supabase client per call
  (not routed through the Vercel API at all), object paths namespaced
  `${userId}/${randomUUID()}${ext}`, signed URLs with a 1-hour TTL
  (`SIGNED_URL_TTL_SECONDS`).
- `MapSheet.tsx`'s image loading (`window.cloudApi.getMapImageUrl(path)`
  then `loadImageDimensions(url)`) for how the renderer consumes a
  storage-backed field.

## Concrete implementation plan

### 1. New Supabase migration
A new bucket (e.g. `settlement-data`) mirroring `0002_map_images_storage.sql`
exactly — same owner-scoped RLS shape, same object-path-prefix-is-userId
convention. Content type will be `application/json` instead of an image
mimetype.

### 2. Schema changes (`src/common/noteTypes/settlement.ts`)
Add something like:
```ts
bulkDataStoragePath: z.string().nullable().catch(null)
```
Keep `residents`/`buildings`/`factions` in the schema (don't remove them —
see backward compatibility below), but they become "the data IF inline"
rather than always-authoritative.

**Open question to confirm with the user before writing this:** should
`factions` also move to storage, or is it small enough to always stay
inline? (Factions are bounded by `FACTION_NAME_POOL`'s size plus a
handful of custom ones — almost certainly fine to leave inline even for a
Metropolis. Recommend: only `residents`/`buildings` move, `factions` stays
inline, to keep the blast radius smaller.)

### 3. Backward compatibility (don't force a migration)
Existing small-enough Cloud settlements already have `residents`/
`buildings` inline and working. Don't break them:
- On **read**: if `bulkDataStoragePath` is set, fetch residents/buildings
  from Storage and merge into the working data; if it's `null`, use the
  inline fields exactly as today.
- On **save**: decide a threshold (e.g. serialized residents+buildings
  exceeds ~2MB — leaves headroom under the 4.5MB limit alongside the rest
  of the frontmatter) — below it, keep saving inline (simplest, no Storage
  round-trip for the common small-settlement case); at/above it, upload to
  Storage and PATCH the note with `bulkDataStoragePath` set and
  `residents`/`buildings` cleared to `[]` in the inline fields.
- **Local Vault is entirely unaffected** — it has no size limit, so it
  should never use `bulkDataStoragePath` at all; this is Cloud-only
  behavior. The two backends already diverge in `noteRefApi.ts`
  (`useLocalNoteRefApi`/`useCloudNoteRefApi`), so this is consistent with
  the existing local/cloud split, not a new kind of divergence.

### 4. `cloudSession.ts` additions
New methods mirroring `uploadMapImage`/`getMapImageUrl`, e.g.
`uploadSettlementBulkData(residents, buildings)` →
`{ path: string }` and `getSettlementBulkData(path)` →
`{ residents, buildings }` (fetch + parse JSON from the signed URL, or
just build a fresh bearer-scoped Supabase client and download+parse
directly server-side in the main process — either works, follow whichever
is more consistent with `uploadMapImage`'s existing shape).

### 5. IPC/preload/`cloudApi` wiring
New `cloudApi` methods exposed the same way
`pickAndUploadMapImage`/`getMapImageUrl` already are (`src/preload/index.ts`,
`src/main/ipc/cloud.ts`).

### 6. UI changes
This is the part that touches the most files, since several components
currently assume `data.residents`/`data.buildings` are always the full,
authoritative arrays straight from frontmatter:
- `SettlementSheet.tsx` — after parsing frontmatter, if
  `bulkDataStoragePath` is set (Cloud mode only), fetch+merge the real
  arrays before handing `data` down to its tabs. Probably wants a loading
  state (fetching a large JSON blob from Storage isn't instant).
- `SettlementSetupTab.tsx`'s `handleGenerate` — after generating, decide
  inline-vs-Storage based on size, upload if needed, patch the pointer
  field instead of (or alongside clearing) the inline arrays.
- `SettlementPeopleTab.tsx`/`SettlementBuildingsTab.tsx`/
  `SettlementFactionsTab.tsx` — should keep working unchanged if
  `SettlementSheet.tsx` does the resolving before handing data down, but
  verify the promote-to-real-note flows
  (`settlementPromotion.ts`/`noteRefApi.createNote`) still work against
  the resolved (not raw-frontmatter) resident/building records.

### 7. Nice to have, low priority, separate from the main fix
`cloudSession.ts`'s `parseOrThrow` (and the client-side error handling)
should detect a non-JSON response body (like Vercel's plain-text 413) and
surface something readable ("Request too large") instead of a confusing
"SyntaxError: Unexpected token" — this bit the user directly during
diagnosis and would still be confusing for any OTHER future oversized
request this app ever makes, independent of this specific settlement fix.

## How to verify once built
Generate a Metropolis-scale settlement (~60k+ population) in **Cloud
Workspace** specifically (not Local Vault — that path already works), Save,
confirm no size error, quit and reopen the app, confirm People/Buildings
tabs still show the full generated population. Also verify a **small**
Cloud settlement (a Hamlet/Village) still saves the old inline way without
ever touching Storage, to confirm the backward-compat threshold logic
doesn't regress the common case.
