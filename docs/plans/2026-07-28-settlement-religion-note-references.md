# Plan: Populate a settlement's religion list from real vault notes

Written 2026-07-28, for a **future session with no memory of this one** to pick
up and execute. User request, discussed but not yet built (previous session
hit its usage limit right after the plan was confirmed).

## Why

Today, `religionDistribution` entries on a `settlement` note are pure free
text — the user retypes the same deity/faction names (e.g. "Abaddon",
"Archangel Michael") by hand every time they set up a new settlement. The
user already has real lore notes for these entities in the vault (e.g.
`NPCs/Archangels/*`, `NPCs/Archdevils/Abaddon`) and wants to point a
settlement's religion picker at that existing content instead of retyping it,
AND get a real link back to that lore note once it's used.

## Confirmed with the user (2026-07-28)

- Build both **single-note** add ("point at one specific note, e.g.
  `NPCs/Archdevils/Abaddon`") and **whole-folder** add ("point at a folder,
  e.g. `NPCs/Archangels`, and add one religion per note inside it in one
  click").
- Folder-add is a **one-time snapshot action, not a live sync** — matches
  every other "populate from a source" pattern already in this app (Import
  Local Vault, district defaults, promotion). If the user adds a new note to
  that folder later, they re-click "Add all from folder" to pick it up.
  Must be **safe to re-run**: skip any note whose title is already present
  in `religionDistribution` (same "dedupe by name" spirit as
  `vaultCloudMigration.ts`'s `indexKey` check).
- Once a religion is linked to a real note, show an **"Open ↗" button** next
  to it — exact same UX as `EventSheet.tsx`'s existing Location field.
- A promoted NPC's "Follows X" line should become a real `[[X]]` wiki-link
  when X matches a real note, so the deity's own note gets a backlink for
  free (same mechanism `LanguageSheet.tsx`'s language-to-language sentences
  already use — no new backlink machinery needed, just write the sentence
  as a wiki-link instead of plain text).
- The existing plain free-text input is **kept, not replaced** — some
  religions won't have a dedicated note (e.g. "sun worship" as a generic
  concept), and manual typing must still work exactly as it does today.

**Still open — ask at kickoff, don't guess:** does "add all from a folder"
recurse into subfolders, or only pick up notes directly inside the named
folder? Leaning toward direct-children-only (simpler, matches the user's own
examples which were flat folders), but wasn't confirmed before the session
ended.

## Current state (confirmed by reading the code)

- `ReligionShare` (`src/common/noteTypes/settlement.ts`) is already just
  `{ religion: string, percent: number }` — **no schema change needed**, a
  religion linked to a note is still just a string (that note's title).
- Religion distribution UI lives in `SettlementSetupTab.tsx` (~line
  276-312) — a plain list of `<input>` (name) + `<input type="number">`
  (percent) + remove button, plus a bare "+ Add religion" button
  (~line 306-311) that appends `{ religion: 'New Religion', percent: 0 }`.
- `settlementPromotion.ts` writes the promoted NPC's religion as a plain
  sentence today: `Follows {religion}.` — this is the line that needs to
  become `Follows [[{religion}]].` when the religion matches a real note
  (harmless either way if it doesn't — an unmatched `[[wiki-link]]` just
  shows "no note titled X yet", same as any dangling wiki-link elsewhere in
  this app).
- **Precedent to mirror exactly**: `EventSheet.tsx`'s Location field
  (~line 51-68 as of this writing) — `noteRefApi.searchTitles('', type)` +
  `<datalist>` for autocomplete, plus an "Open ↗" button
  (`sheet-open-ref-button` class) calling `noteRefApi.openByTitle(title,
  type)`. Copy this shape for the single-note-add control.
- **`NoteRefApi` (`src/renderer/src/lib/noteRefApi.ts`) has NO folder-scoped
  listing method today** — this is new capability, not reuse. Existing
  methods: `searchTitles(query, type?)`, `openByTitle`,
  `readFrontmatterByTitle` (added this session for the calendar picker,
  same file), `createNote`. A `listNotesInFolder(folderPath)` (or similar)
  needs to be added to this interface, `createNoteRefApi`'s factory, AND
  both `useLocalNoteRefApi`/`useCloudNoteRefApi` hook implementations —
  same pattern as how `readFrontmatterByTitle` got added this session (see
  git history around 2026-07-28's event/calendar work for the exact shape
  of that change, it's the most recent precedent for extending this
  interface).
- **Local vault folder listing**: `VaultSession.getTree()` /
  `buildTree()` (`src/main/vault/tree.ts`) already returns the full
  `TreeEntry[]` tree with `isDirectory`/`children` — a folder's direct
  note children can be found by walking this tree to the matching
  directory path and filtering `children` for `!isDirectory`. No new
  main-process method may even be needed if the renderer already has the
  tree cached (check `useVaultStore`'s tree state before adding a new IPC
  round-trip for something derivable from data already in memory).
- **Cloud folder listing**: no direct equivalent exists yet. `CloudTreeNode[]`
  (from `cloudApi.refreshTree()`/`getCachedTree()`) likely already has the
  same folder/note nesting structure needed — check `cloudTypes.ts`'s
  `CloudTreeNode` shape first; deriving the folder's note children from the
  already-fetched tree (same as local) may avoid needing a new API route
  entirely. Only add a new `/api/...` endpoint in `project-vault-cloud` if
  the existing tree data genuinely doesn't have what's needed.
- **Folder-picker UI does not exist anywhere in this app** — this is new.
  Simplest approach: walk the existing tree data (already available via
  `useVaultStore`/`useCloudStore`, no new fetch needed) to collect every
  directory path, offer as a `<datalist>`-backed text input (same
  autocomplete pattern as everything else in this app) rather than
  building a real folder-tree picker widget — matches this codebase's
  general "reuse the datalist pattern" convention rather than introducing
  a new UI primitive for something that doesn't need one.

## Suggested build order

1. Confirm the subfolder-recursion open question with the user.
2. Add `listNotesInFolder` (or derive folder contents from already-cached
   tree data client-side, if that avoids new IPC/API surface entirely —
   check this first, it may be simpler than adding a new method).
3. Single-note "add religion from note" control in
   `SettlementSetupTab.tsx`, mirroring `EventSheet.tsx`'s Location field
   exactly (search datalist + Open ↗ button).
4. Folder-based bulk-add control (folder datalist + button), using
   whatever `listNotesInFolder` returns, deduping against
   `data.religionDistribution`'s existing entries by title.
5. `settlementPromotion.ts`: change the religion line to a `[[wiki-link]]`.
6. Tests: extend `tests/settlementPromotion.test.ts` for the wiki-link
   change; new tests for whatever folder-listing function gets added
   (local + cloud, or the pure "derive folder children from tree data"
   helper if that's the chosen approach).

## Key files

- `src/common/noteTypes/settlement.ts` — `ReligionShare` (no change needed).
- `src/renderer/src/components/sheets/SettlementSetupTab.tsx` — religion
  distribution UI (~line 276-312), where the new controls get added.
- `src/renderer/src/components/sheets/EventSheet.tsx` — Location field,
  the UI pattern to mirror for single-note add.
- `src/renderer/src/lib/noteRefApi.ts` — where a folder-listing method
  would be added, if the tree-data-derivation approach doesn't pan out.
- `src/common/settlementPromotion.ts` — religion sentence → wiki-link change.
- `src/main/vault/tree.ts`, `src/common/cloudTypes.ts` (`CloudTreeNode`) —
  check these FIRST for whether folder contents are already derivable from
  existing tree data before adding any new fetch method.
