# Plan: Initiative Tracker, Map × Timeline, Settlement Populator

Written 2026-07-27, for a future session (possibly not this one) to pick up without
re-discussing scope. Three independent features, ordered smallest → largest. Each
section is self-contained: goal, data model, UI, and open questions to confirm with
the user before/at the start of that feature's work.

No campaign content (names, lore, this world's specifics) is repeated in this doc —
architecture and requirements only, per the standing rule in
[[feedback_project_vault_no_campaign_content]] (see CLAUDE.md-equivalent context: the
user supplies content, Claude builds mechanism).

---

## 1. Initiative Tracker (do first — smallest, self-contained)

**Goal:** an at-table combat tracker driven by existing PC/NPC stat blocks, not a new
character system.

**Key design call: combatants are snapshots, not links.** Adding a note to the tracker
copies its `name`, `ac`, `hp`/`maxHp`, and `stats` (ability scores) into a new
ephemeral "combatant" object at that moment. Combat then mutates the combatant's own
`currentHp`/conditions — **never** the source note's frontmatter. Reasons: (a) an
NPC note's `hp` is a template ("a goblin has 7 hp"), not one specific goblin's
remaining HP mid-fight; (b) running 4 goblins from one "Goblin" note means 4
combatants, not 4 notes — avoids the same instance-bloat problem flagged for the
settlement feature. Each combatant keeps an optional `sourceNoteTitle` so the UI can
still offer a "view note" link back.

**Data model** (new file `src/common/initiative.ts`, framework-agnostic like
`dice.ts`/`mapGeometry.ts`):
```
Combatant {
  id, name, sourceNoteTitle | null,
  ac, maxHp, currentHp,
  initiative: number | null,   // rolled or manually entered
  conditions: string[],        // freeform tags, e.g. "Prone" — not a fixed enum,
                                // matches the app's ruleset-agnostic pattern elsewhere
  isPc: boolean                // PCs may want to stay in the list between fights;
                                // NPCs typically get cleared
}
Encounter { round: number, combatants: Combatant[], activeCombatantId: string | null }
```
Reuse `rollDice()` from `dice.ts` for `1d20 + DEX mod` initiative rolls, and
`abilityModifier()` from `creatureStats.ts` for the modifier. Sort by `initiative`
descending for turn order; "Next Turn" advances `activeCombatantId` and increments
`round` on wraparound.

**Persistence:** an Encounter is *not* a note — it shouldn't appear in search,
backlinks, or the graph. Store it as a small piece of app-level state that survives
an app restart (so a crash mid-fight doesn't lose HP/initiative), e.g. a JSON file in
Electron's userData dir written via IPC, same spirit as `cloudSessionStore.ts`'s
approach to non-vault state. One active encounter at a time is enough for v1.

**UI:** a new title-bar toolbar entry ("Initiative") opening a panel/view:
- "Add combatant" — search existing `pc`/`npc` notes (reuse the same title-search
  used for wiki-link autocomplete) **or** add an ad-hoc combatant (name + manual
  AC/HP/stats) for one-off monsters that don't warrant a note.
- Roll-all-initiative button, or per-combatant manual entry.
- Sorted turn-order list: current-turn highlight, HP as an editable number (click to
  adjust, supports `+`/`-` deltas so "take 6 damage" doesn't require doing the
  subtraction by hand), conditions as add/remove tags, remove-combatant.
- "End Encounter" clears the list (PCs optionally persist into the next one — decide
  based on how the user actually plays, ask if unclear when building).

**Scope for v1:** local vault only. The Cloud Workspace has no per-note-type sheets
yet beyond Map, and there's no session happening on a phone/browser today (PWA not
started — see [[project_vault_mobile_pwa_plan]]) — building it once in
`src/common/initiative.ts` keeps it portable to Cloud/PWA later without redoing the
logic.

**Open questions for the user at kickoff:**
- Do PCs carry over between encounters automatically, or does every encounter start
  empty?
- Any interest in a "monster is a duplicate" shortcut (add same combatant N times
  with auto-numbered names, e.g. "Goblin 1/2/3") — small addition, worth confirming
  before or after a v1.

---

## 2. Map × Timeline Crossover (do second — mostly wiring existing subsystems)

**Goal:** place `event` notes on the Map by date and location, with a slider that
reveals them chronologically and shows travel time between them — combining three
subsystems that already exist independently: Map pins + trip-time math
(`mapGeometry.ts`), the Events timeline (`worldTimeline.ts`/`worldDate.ts`), and
world-date parsing/sorting.

**Data model change — one new optional field:**
`src/common/noteTypes/event.ts` gets `location: z.string().catch('')` (a location
note title, same convention as `mapPinSchema.locationTitle` in `map.ts`). This is the
*only* schema change needed. An event with no `location` set simply doesn't
participate in the map view (still shows normally in the existing Events timeline).

**Matching logic:** for a given Map note, find every `event` note in the vault whose
`location` matches one of that map's `pins[].locationTitle`. Sort matches by
`compareWorldDates` (already vault-content-agnostic, handles undated entries by
sorting them last). No new date-parsing code needed — reuse `worldDate.ts` as-is.

**UI — new overlay mode in `MapSheet`/`MapCanvas`:**
- A horizontal slider spanning the matched events' date range (min → max).
- Moving the slider reveals/highlights pins for every matched event up to that point
  (simple show/hide for v1 — no animation, no auto-play). This is a DM-controlled
  "step through as I narrate" tool, not a playback feature.
- Clicking a revealed pin shows the event's summary plus, if a previously-revealed
  event is also selected, the trip distance/time between the two — reusing
  `mapGeometry.calculateTrip` and the existing `MapTripCalculator` UI pattern (two
  points → distance/time by travel mode).
- Events with a `location` that has no matching pin on *this* map still need
  somewhere to surface — a small "unplaced" list under the slider ("N events have no
  pin on this map yet") is enough; don't auto-create pins for them.

**Scope-control note:** this is the cheapest of the three features precisely because
almost nothing is new — it's schema plus a slider component plus reusing three
already-shipped calculations. Resist the urge to add animation/playback or
multi-map event routing in v1.

**Open questions for the user at kickoff:**
- Should PC/NPC notes with `Born`/`Died` facts (already parsed by
  `extractBornDiedFacts`) also be placeable on this timeline, or is it events-only
  for v1? (Events-only is simpler and probably sufficient — confirm.)

---

## 3. Settlement Populator (do last — biggest, own multi-session build)

**Goal:** given district/race/wealth/religion inputs, generate a populated
settlement (buildings + residents) for a DM to drop into a session — a heavily
scoped-down version of what fantasytowngenerator.com does at city-simulation scale.
Explicitly **not** in scope (confirmed with the user 2026-07-26): procedural
street/parcel map rendering, or live NPC schedule/occupancy simulation. A settlement
here is browsable data, not a drawn map — it can optionally be linked from a hand-
placed Map pin (reusing `mapPinSchema.locationTitle` — the settlement note *is* the
thing a pin points to) so it still has a place in the DM's own map.

### The storage problem, and how this design avoids it

The user's core concern: generating a believable town population (dozens to low
thousands of people/buildings) must **not** mean creating that many actual vault
notes. Full notes carry real weight in this app — they're indexed in FTS5/search,
appear in the file tree and graph, get backlink tracking — none of which should
happen for background extras that may never come up at the table.

**Solution: one `settlement` note type, everything stored as arrays in that single
note's frontmatter — exactly the pattern already shipped and confirmed working for
`map` notes** (`src/common/noteTypes/map.ts`: `terrainTypes`/`zones`/`lines`/`pins`
all live in one note's jsonb/YAML, not as separate notes/rows). A settlement with a
few hundred residents and buildings is at most a few hundred KB of JSON inside one
note — trivial for local YAML frontmatter or a Postgres jsonb column, and nothing
like "thousands of files/rows."

**Promotion, not pre-creation:** background residents/buildings are lightweight
records, not notes. Only when the DM actually cares about one (the party talks to a
shopkeeper, robs a specific house) does it get "promoted" to a real `npc`/`location`
note via an explicit action — from that point it's a first-class note with search/
backlinks/graph like anything else, and the settlement record just holds a pointer
to it. This is the single mechanism that makes "generate a town of 2,000" cheap: the
generator only ever fully commits notes for the handful that turn out to matter.

### Data model

New note type `settlement` (`src/common/noteTypes/settlement.ts`, same shape/passthrough
pattern as every other note type):

```
SettlementFrontmatter {
  type: 'settlement'
  districts: { id, name }[]
  raceDistribution: { race: string, percent: number }[]
  wealthTiers: { id, name, percent: number }[]   // e.g. relabel-able Upper/Middle/Lower
  religionDistribution: { religion: string, percent: number }[]
  buildingTypes: BuildingTypeDef[]   // seeded defaults, user-editable — see below
  buildings: SettlementBuilding[]
  residents: SettlementResident[]
}

BuildingTypeDef { id, name, category, defaultWealthTierId, staffed: boolean, weight: number }
  // seeded ~20-30 generic archetypes across residence/shop/civic/religious/tavern
  // categories — generic placeholder data, same spirit as defaultTerrainTypes() /
  // DEFAULT_TRAVEL_MODES, not this campaign's specific content. User can add/edit/
  // remove entries.

SettlementBuilding {
  id, name, buildingTypeId, wealthTierId, districtId,
  linkedNoteTitle: string | null   // set once promoted to a real `location` note
}

SettlementResident {
  id, name, race, age, gender,
  professionBuildingId: string | null,  // the building they work/operate, if any
  homeBuildingId: string | null,
  wealthTierId, districtId, religion,
  notable: boolean,
  // only populated when notable — see generation rules below
  personalityLine: string, goal: string, stats: AbilityScores | null,
  linkedNoteTitle: string | null   // set once promoted to a real `npc` note
}
```

### Generation rules (keeps scale sane without hand-limiting population size)

1. Pick a settlement size (Hamlet/Village/Town/City/Metropolis preset → a default
   population/building count range, overridable with an exact number).
2. Allocate buildings by `buildingTypes[].weight`, respecting the wealth-tier mix
   requested; split roughly evenly across districts (v1 — no per-district weighting).
3. **Only staffed buildings generate a "notable" resident** — one full character (name
   per race-appropriate generator, personality line, short goal, ability scores) per
   staffed building (shopkeepers, temple heads, tavern keepers, guild leads, etc.).
   This is the scope lever: a town of 2,000 might have 40-80 notables, not 2,000.
4. Remaining population fills as cheap household stub residents (name/race/age/
   district/home-building only, grouped a few per residence) — enough for honest
   demographic totals and filtering, without spending generation effort on prose
   nobody will read.
5. Name generation uses small per-race syllable/name-bank generators — generic,
   user-editable seed lists (same "mechanism not content" category as the map's
   terrain speed multipliers or the dice roller), not hand-authored to this specific
   world. **Flag to the user before building:** this is the first feature in the app
   where the software itself originates text content (names, personality lines),
   not just a mechanism for the user to fill in — worth an explicit go-ahead per
   [[feedback_project_vault_no_campaign_content]], even though it's generic/
   placeholder in the same way existing seeded defaults are.

### UI

A `SettlementSheet` (same tabbed pattern as `MapSheet`/`FamilyTreeSheet`):
- **Setup tab:** district list, race/wealth/religion distribution editors (percent
  fields, must total 100 — validate), building-type table editor, size/population
  control, "Generate" button (re-running regenerates only *unpromoted* records —
  promoted ones are never touched/overwritten).
- **People tab:** sortable/filterable table — filters for Race, Profession, Wealth
  tier, District, Notable-only toggle; a search box; click a row to expand full
  detail (or "Open note →" if `linkedNoteTitle` is set) with a "Promote to NPC note"
  action for unpromoted rows.
- **Buildings tab:** same pattern — filters for Building type, Wealth tier, District;
  "Promote to Location note" action.
- **Districts tab (maybe just a section, not a full tab):** simple list, mostly for
  editing district names post-generation.

### Open questions for the user at kickoff

- Confirm the "only staffed buildings get a full notable" rule — is that the right
  line, or should e.g. every household also get a one-line flavor tag even if not a
  full personality?
- Confirm OK with the generator originating generic name/personality-bank content
  (see flag above).
- Local vault, Cloud Workspace, or both? Map is Cloud-only because of Storage/image
  needs — a settlement has no image dependency, so it could ship local-first unlike
  Map did. Recommend local-first for consistency with Initiative Tracker's reasoning,
  revisit once Cloud Workspace has more per-type sheet parity.
- Wealth-tier labels default to "Upper/Middle/Lower" but should be user-renameable
  (not hardcoded) — confirm that's sufficient, or if more/fewer default tiers are
  wanted.

---

## Suggested order

1. Initiative Tracker — smallest, fully self-contained, no schema changes to
   existing note types beyond nothing at all (pure addition).
2. Map × Timeline — one optional field on `event`, otherwise wiring existing pieces.
3. Settlement Populator — new note type, new schema, generation algorithm, new
   browser UI, promotion flow. Biggest by a wide margin; treat as its own
   multi-session build, likely broken into its own sub-steps (schema + generation
   engine first, promotion flow and filter UI after).
