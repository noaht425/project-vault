# Plan: Settlement Populator — real-app testing feedback (round 3) + inventory

Written 2026-07-27, for a **future session with no memory of this one** to pick up
and execute. The user tested the SettlementSheet UI directly in the running app
(after two earlier fix-up rounds, both already committed/pushed — commits
`67a9538` and `43093be` on `main`) and filed 11 notes, plus one additional
feature requested separately (#12, item inventory). This doc is the complete
handoff: don't assume anything from a prior conversation, everything needed is
here.

**Read `docs/plans/2026-07-27-initiative-timeline-settlement.md` first** if you
haven't — it's the original design doc for the whole Settlement Populator
feature and explains the storage model (one `settlement` note holding
lightweight arrays, not one note per resident/building) and the
promotion-not-precreation philosophy that everything below builds on.

**Key files:**
- `src/common/noteTypes/settlement.ts` — schema (Zod), all the `default*()` seed
  functions
- `src/common/settlementGenerator.ts` — the pure generation engine
  (`generateSettlement`)
- `src/common/settlementNames.ts` — name banks, `FLAVOR_TAG_TEMPLATES`,
  personality/goal pools
- `src/common/phoneticNames.ts` — syllable-based name synthesis for custom
  races that want an invented sound instead of a name-list pool
- `src/common/settlementPromotion.ts` — pure mapping from a background
  resident/building to a real npc/location note's frontmatter+body
- `src/renderer/src/components/sheets/Settlement{Sheet,SetupTab,PeopleTab,BuildingsTab}.tsx`
  — the UI

All of the above have existing test files under `tests/` (`settlement*.test.ts`,
`phoneticNames.test.ts`) — 254 tests passing as of the last push. Keep them
green; add new ones for anything new.

---

## 1. Expand phonetic profiles beyond the 2 proof-of-concept ones

**Current state:** `phoneticNames.ts` has exactly 2 `PHONETIC_PROFILES`
(`elvish-leaning`: fricative/sibilant/front/long-vowel; `harsh-guttural`:
plosive/guttural/back/short-vowel), explicitly built as a proof of concept to
validate the mechanism (tagged syllable bank + weighted synthesis + a
pronounceability filter) before investing in more content. User confirmed the
mechanism works and wants more profiles now.

**Proposed additions** (6 more, for 8 total) — each is a distinct tag-weight
emphasis so they sound genuinely different from each other and from the
existing 2, not just re-shuffled variations:
- **draconic** — plosive + guttural + LONG-vowel (distinct from harsh-guttural,
  which is short-vowel — draconic should sound weighty AND drawn-out, not
  clipped)
- **fey / whimsical** — nasal + liquid + front + long-vowel, light/airy/sing-song
- **aquatic** — sibilant + liquid + long-vowel, flowing
- **stony / giant-kin** — plosive + nasal + back + short-vowel (for CUSTOM
  giant-like races — Goliath already has its own name-list bank, this is for
  something else entirely giant-flavored)
- **celestial / ethereal** — fricative + liquid + long-vowel + front, but less
  sibilant-heavy than elvish-leaning — softer, more open
- **insectoid / alien** — affricate + sibilant + short-vowel, clicking/buzzing

**Important — check syllable bank coverage before assuming these will sound
distinct.** The current `SYLLABLE_BANK` (~54 entries, `phoneticNames.ts`) was
built with elvish-leaning and harsh-guttural specifically in mind. Some of the
new profiles (especially fey/whimsical's need for airy long-vowel-only
syllables, and insectoid's need for affricate-heavy short clicky syllables)
may not have enough matching-tagged syllables to draw from yet, and could end
up sounding too similar to the existing 2 regardless of profile weights.
**Recommend: generate sample output for each new profile (same pattern as the
existing `_samplePhonetic.scratch.test.ts` throwaway-test approach used
earlier in this feature's development — write it, run it, read the output,
delete it) and add ~10-15 more tagged syllables if a profile isn't
differentiating enough**, rather than shipping profiles that don't actually
sound different.

**Tests:** follow the existing pattern in `tests/phoneticNames.test.ts` — the
"produce audibly different sound palettes" statistical test (counts matching
regex patterns for characteristic sounds across many draws) is the template to
copy per new profile pair you want to verify are distinct.

---

## 2. No confirmation after clicking Generate

**Current state:** `SettlementSetupTab.tsx`'s `handleGenerate()` calls
`generateSettlement(...)` and `updateFrontmatter({ buildings, residents })` —
nothing else. Since Setup/People/Buildings are separate tabs, there's no
visible change on the Setup tab itself after generating; the user has to
switch tabs (or scroll, in the original report) to confirm anything happened.

**Proposed fix:** add local state (e.g. `const [lastGenerated, setLastGenerated] = useState<string | null>(null)`)
set right after a successful generate:
`setLastGenerated(\`Generated ${result.residents.length.toLocaleString()} residents across ${result.buildings.length.toLocaleString()} buildings.\`)`,
rendered as a persistent inline note (this app's existing `right-panel-note`
class) directly below the Generate button. **Don't use a timed/auto-dismissing
toast** — this app has no toast/notification system anywhere else, and a
message that disappears on its own risks recreating the exact "did anything
happen?" confusion that prompted this note. Clear `lastGenerated` back to
`null` whenever the user edits any generation input or clicks Generate again
(simplest: just let the next `setLastGenerated` call overwrite it, and don't
worry about clearing it on unrelated edits — a slightly-stale confirmation
message is harmless).

---

## 3. Custom race shows as a raw UUID in the People tab's race filter

**Confirmed bug.** `SettlementPeopleTab.tsx`:
```ts
const races = Array.from(new Set(data.residents.map((r) => r.race))).sort()
```
then rendered directly: `<option key={r} value={r}>{r}</option>`. For a
baseline race this is fine (`r` is `"human"`, `"elf"`, etc.), but for a custom
race `r` is the `CustomRaceDef.id` — a `crypto.randomUUID()` string, never
meant to be displayed. `SettlementSetupTab.tsx`'s `RaceCard` component already
solved this exact problem for its own race `<select>` (baseline races
capitalized, custom races shown via `customRace.name`) — reuse the same
resolution logic here instead of displaying `r` raw.

**Fix:**
```ts
const raceLabel = (raceId: string): string =>
  data.customRaces.find((cr) => cr.id === raceId)?.name ??
  (raceId.charAt(0).toUpperCase() + raceId.slice(1))
```
and render `<option key={r} value={r}>{raceLabel(r)}</option>`. Worth
considering extracting this as a small shared helper (maybe into
`settlementNames.ts` alongside `BASELINE_RACES`, since both `RaceCard` and
this filter need the same "resolve a race id to a display label" logic and a
third place — the sample-output printing scripts and possibly future UI —
will likely want it too) rather than duplicating the inline expression a third
time.

---

## 4. Blacksmith rolled STR 9 — bug?

**Not a bug — confirmed working as designed, no code change needed.**
Blacksmith's `primaryAbility: 'str'` shifts that stat's generation MEAN to 14
(10 + `PRIMARY_ABILITY_BONUS` of 4 in `settlementGenerator.ts`), but the SD
stays 2 for every stat regardless of bias. A roll of 9 is `(9-14)/2 = -2.5`
SD below that mean — roughly a 1-in-160 occurrence (one-tailed), which is
exactly the kind of rare-but-real variance the normal-distribution design was
built to allow (the user explicitly asked for this shape earlier in the
feature's development — see the `rollAbilityScore`/`ABILITY_SD` comments in
`settlementGenerator.ts`). If the user wants biased stats to dip low less
often, that's a tuning knob (`PRIMARY_ABILITY_BONUS`/`ABILITY_SD`), not a
defect — mention this is adjustable but don't change it unless asked.

---

## 5. "Profession" column is really "workplace," not job title — plus unemployment/wealth-extreme "Class" options

**This is the biggest design item in this doc — confirm the interpretation
below with the user before building, don't guess silently.**

**Current state:** Only ONE resident per staffed building is ever generated
— the "notable" (`BuildingTypeDef.staffed` gate, see the original plan doc).
That resident implicitly IS the owner/proprietor; there's no separate
job-title concept, and no stub resident (the cheap, non-notable bulk of the
population) has any employment representation at all — `professionBuildingId`
is hardcoded `null` for every stub in `settlementGenerator.ts`'s stub-creation
loop. The "Profession" column in `SettlementPeopleTab.tsx` shows
`buildingNameById.get(r.professionBuildingId)` — i.e. it already only ever
shows WHERE someone works, never a role; the user is right that "Profession"
is a misnomer for what's actually there, but the deeper gap is that there's no
job-title field to put in the description instead.

**Proposed design:**
- Rename the column header from "Profession" to "Workplace" (trivial,
  `SettlementPeopleTab.tsx`).
- Add `jobTitle: z.string().catch('')` to `settlementResidentSchema`
  (`noteTypes/settlement.ts`). For notables this is generation-time-assigned
  (e.g. always "Owner", or drawn from a small per-building-type pool like
  "Owner"/"Master Smith"/"Proprietor" — simplest v1: just hardcode "Owner" for
  every notable, since they're definitionally the one running the place).
  Show `jobTitle` in the People tab's expanded-row detail (where
  personality/goal/proficiencies/appearance already render), not the table
  column.
- Extend generation so **some stub residents also get a workplace + job
  title** (not full notable treatment — no personality/goal/stats/appearance,
  just `professionBuildingId` + a generic `jobTitle` like "Apprentice",
  "Laborer", "Journeyman", "Stablehand" — possibly per-building-category
  flavored, reusing the `proficiencyPool`-on-`BuildingTypeDef` precedent
  pattern, e.g. a new `jobTitlePool: string[]` field). This ties directly into
  #6 below (age-gated employment probability).
- **The ambiguous part, confirm before building:** the user's exact words were
  *"if we haven't implemented an unemployed and/or homeless [state] then this
  should be implemented as one of the Class options along with
  ultra-wealthy."* Two readings:
  1. **(Recommended)** Unemployment/homelessness is a separate boolean-ish
     concept from wealth tier (a resident can be Middle class AND
     unemployed-between-jobs, or Lower class and homeless specifically) —
     add it as its own field (e.g. `employmentStatus: 'employed' | 'unemployed' | 'homeless'`
     or simpler, infer "unemployed" from `jobTitle === '' && age >= adulthood`
     and add a distinct `homeless: boolean` flag separate from
     `homeBuildingId === null` since currently a `null` home just means "no
     home building was assigned due to capacity," not a deliberate homelessness
     state). "Ultra-wealthy" in this reading is just a new entry added to
     `defaultWealthTiers()` (a 4th tier above Upper), unrelated to
     employment.
  2. Unemployment/homelessness/ultra-wealthy are ALL new `WealthTier`-like
     entries in the same list — i.e. the wealth tier spectrum literally
     grows to include "Homeless" and "Ultra-wealthy" as tiers alongside
     Upper/Middle/Lower, and "unemployed" is folded into the "Homeless" tier
     conceptually.
  
  Recommendation is (1) because wealth tier and employment status are
  genuinely different axes in reality (an unemployed person isn't always
  homeless, a homeless person isn't always literally 0-income) and conflating
  them into one list would make the wealth-tier percent-total UI (which
  already has a "should total 100" soft validation) harder to reason about.
  But this is a real design fork — **ask the user directly which they meant
  before implementing**, since building the wrong one means redoing schema +
  generator + UI.

---

## 6. Kids and the elderly shouldn't realistically have jobs

**Current state:** trivially "satisfied" today only because NO stub resident
has a job at all (see #5) — not because of any age logic. Once #5 gives stub
residents real jobs, this becomes a real requirement.

**Proposed design:** an age-gated employment probability, evaluated per stub
resident against their race's life stage (`RaceLifeStage` — already exists,
`resolveLifeStage()` in `settlementGenerator.ts`):
- `age < adulthood`: **hard 0%** — the user was explicit about this ("the odds
  of a 2 year-old human having a job should be 0"), not just low.
- `adulthood <= age`: probability rises from adulthood, plateaus through
  prime working years, then declines approaching `maxAge`. A simple
  piecewise-linear shape is enough for v1 — e.g. ramp from 0% at `adulthood`
  to some plateau (recommend ~70-80%) by `adulthood + (oldAge-adulthood)*0.25`,
  hold the plateau until `oldAge`, then ramp back down to a low-but-nonzero
  floor (recommend ~10-15%, not 0 — some people work into old age) by
  `maxAge`.
- Exact percentages are a judgment call / tunable — implement as named
  constants near the other generation-tuning constants
  (`AVG_HOUSEHOLD_SIZE`, `POPULATION_PER_STAFFED_BUILDING`, etc. — same
  section of `settlementGenerator.ts`) so they're easy to find and adjust
  later without hunting through the algorithm.

**Test:** statistical, same style as the existing "keeps a fresh-adult notable
... rare" test (`race life stages` describe block, `settlementGenerator.test.ts`)
— generate a large population, assert 0 employed residents below adulthood,
assert employment rate is meaningfully higher in the prime-age bucket than
right at the elderly end.

---

## 7. Flavor tag content — the method, and "guarantee a few funny ones"

**Direct answer for the user, in case this session doesn't relay it:** yes,
there's a fixed table. `FLAVOR_TAG_TEMPLATES` in `settlementNames.ts` is a
hand-written array of 20 lines (e.g. "Sings to the animals; swears it helps.",
"Whistles constantly, off-key.") and `generateFlavorTag(rng)` just picks one
uniformly at random per stub resident. There's currently no "funny vs.
mundane" categorization — it's one undifferentiated pool.

**Proposed design:**
- Write ~10-15 more entries, aiming for genuinely funny/memorable ones (the
  user specifically liked "Sings to the animals; swears it helps." — that
  tone: a small, specific, slightly absurd habit, not a generic trait).
- Optionally split into two pools (or tag entries with a lightweight
  `funny: boolean` alongside the existing flat array — simplest: two separate
  arrays, `FLAVOR_TAG_TEMPLATES` and `FUNNY_FLAVOR_TAG_TEMPLATES`, and
  `generateFlavorTag` draws from a combined pool weighted however feels
  right, e.g. 70/30 mundane/funny).
- **Only add a "guarantee at least N funny ones" mechanism if targeting small
  settlements specifically.** For anything village-sized (100+) or larger,
  independent random sampling from even a 20-30 entry pool will surface
  several funny ones purely by population size — a guarantee mechanism would
  be solving a problem that doesn't really exist at that scale. It only
  matters for a Hamlet (20-100 people), where bad luck could plausibly mean
  zero funny flavor tags. If building this, the simplest correct approach:
  after normal generation, if a settlement's population is below some
  threshold (e.g. 150) and zero residents got a funny-tagged flavor line,
  force-swap one random stub resident's flavor tag to a funny one as a
  post-pass. Low priority relative to the other items in this doc.

---

## 8. Relationships (family/friends/enemies/romantic)

**Confirmed: still intentionally not built**, same reasoning as originally
decided (see `[[project_vault_next_features_plan]]` memory / earlier in this
feature's development if that context is available to whoever picks this up):
a real relationship graph needs mutual consistency (A's parent must have A as
their child), age math that doesn't produce impossible generations, and
generation-order dependencies that don't exist anywhere else in this engine
— comparable in size to the entire rest of the Settlement Populator combined.
**Still recommend treating this as its own dedicated design session**, not
something to fold into this round of fixes. Not scoped further in this doc.

---

## 9. Districts don't reflect their stated character (a "Religious District" got no temples)

**Current state:** `settlementGenerator.ts` assigns every building's district
via `nextDistrictId()` — a pure round-robin cycle through `data.districts`
with zero awareness of building type or district name/intent. Renaming a
district to something thematic (as the user did) has no effect on what
actually gets built there.

**Proposed design (this is a real engine change, not a small tweak — comparable
in scope to the original Specialty system, treat as its own chunk of work):**
- Extend `District` (schema in `noteTypes/settlement.ts`) with an optional
  `buildingTypeBoosts: SpecialtyBoost[]` field — **reuse the exact existing
  `specialtyBoostSchema` shape** (`{ buildingTypeId, multiplier }`) rather than
  inventing a new one, since it's the same concept (bias building-type
  selection) just scoped to one district instead of the whole settlement.
- Rework the building-placement loop: today, ALL residence buildings get
  placed round-robin, then ALL staffed buildings get placed round-robin
  (see `buildOneBuilding`/`nextDistrictId` in `settlementGenerator.ts`).
  Change to: for each building instance being placed, weight candidate
  districts by `district.buildingTypeBoosts` matching that specific building
  type (reuse the existing `specialtyMultiplier`-style multiplication logic,
  just keyed by district instead of settlement-wide active specialties),
  falling back to round-robin among districts with no relevant boost (or all
  districts, if none has a boost for this type — same "never a hard
  exclusion" philosophy as `sizeGateMultiplier`: a district with a religious
  boost should get MOST temples, not ALL of them, so a temple built outside
  the religious district is still possible, just less likely).
- **Recommend soft bias, not a hard restriction** — consistent with this
  engine's established philosophy everywhere else (`sizeGateMultiplier` is
  soft, specialty boosts are multiplicative not exclusive). Confirm this
  with the user if there's any doubt, but there's no reason to deviate from
  the pattern already used twice elsewhere in this same engine.
- UI: `SettlementSetupTab.tsx`'s district editor gains a way to set
  boosts per district — could reuse the same checkbox-list-of-building-types
  pattern already used for Specialties, scoped per district instead of
  global.

---

## 10. Natural-sort bug: "Farmstead 7" sorts between "Farmstead 69" and "Farmstead 70"

**Confirmed bug, root cause understood, small contained fix.** Both
`SettlementPeopleTab.tsx` and `SettlementBuildingsTab.tsx`'s sort comparators
compare string values with plain `<`/`>`:
```ts
const cmp = va < vb ? -1 : va > vb ? 1 : 0
```
This is lexicographic (character-by-character) comparison — `"...7"` sorts
AFTER `"...69"` because at the first differing character, `'7' > '6'`,
regardless of the fact that 69 is numerically bigger than 7. Classic
"natural sort" problem.

**Fix:** when both values being compared are strings, use
`String.prototype.localeCompare` with the `numeric: true` option instead of
raw `<`/`>`:
```ts
const cmp =
  typeof va === 'string' && typeof vb === 'string'
    ? va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' })
    : va < vb ? -1 : va > vb ? 1 : 0
```
Apply in both tabs' sort logic (`getSortValue`/comparator in
`SettlementPeopleTab.tsx` and `SettlementBuildingsTab.tsx` — they currently
have near-identical sort implementations, written separately rather than
shared; fixing both is required, consider whether it's finally worth
extracting a shared sort helper at this point rather than a 3rd near-duplicate
if a 3rd sortable table gets added later).

---

## 11. Click a building to see its associated residents

**Current state:** `SettlementPeopleTab.tsx` rows already expand on click
(the `expandedId` state + `Fragment` pattern, showing personality/stats/etc.).
`SettlementBuildingsTab.tsx` rows don't expand at all — no `expandedId` state,
no click handler beyond the promote button.

**Proposed design:** mirror the People tab's exact pattern. Add `expandedId`
state to `SettlementBuildingsTab.tsx`; on row click, show a sub-row (`colSpan`
across all columns, same styling as the People tab's expand row —
`background: 'rgba(127,127,127,0.08)'`) listing residents where
`r.homeBuildingId === b.id` (residents who live there) and separately
`r.professionBuildingId === b.id` (residents who work there — after #5 lands,
this could be more than one). Simplest v1: just list names + (once #5 exists)
job titles as plain text — no need for cross-tab navigation/linking
complexity in v1, that can be a follow-up if wanted.

---

## 12. Building inventory — shops/temples/etc. show what they're actually offering

**Newly requested, not previously discussed elsewhere.** Goal: a shop, temple,
tavern, or similar building should show a generated list of the goods/services
it actually offers, with realistic variety and availability that scales with
settlement size — a Hamlet's general store should carry a handful of basics;
a Metropolis's jeweler could plausibly stock something genuinely rare.

**Which building types get an inventory:** the `shop` category (all of it —
general-store, blacksmith, bakery, tailor, apothecary, jeweler, bookshop,
stables, tannery, carpenter, fishmonger, mill, brewery, market-stall) and the
`tavern` category (tavern, inn — as a "menu" of food/drink/lodging), and the
`religious` category (temple, shrine — services plus minor religious goods).
**Skip for v1:** `civic` (town-hall, guard-house, guildhall, warehouse, docks,
mine, barracks) and `residence` — these aren't point-of-sale locations in the
same sense. (Docks/mine could later become "sources of trade goods" rather
than retail listings — a reasonable future idea, not v1 scope.)

**Data model — deliberately reuses two patterns already established in this
codebase rather than inventing new mechanisms:**
- New field on `BuildingTypeDef` (`noteTypes/settlement.ts`):
  `itemPool: ItemListingDef[]`, where
  `itemListingDefSchema = z.object({ name: z.string(), minSizeId: z.string().catch('hamlet') })`.
  This is the exact same pattern as `proficiencyPool` (a per-building-type
  candidate list the generator draws from) combined with the exact same
  `minSizeId` soft-gate concept already used for `BuildingTypeDef` itself
  (rarity IS availability-by-size here — no need for a separate rarity enum,
  reuse the mechanism the user already understands from the Building Types
  table).
- New field on `SettlementBuilding`: `inventory: z.array(z.string()).catch([])`
  — the actual items in stock for THIS specific building instance, generated
  once at creation time (like wealth tier / district), preserved on
  regeneration for promoted buildings same as everything else.
- Items can freely describe goods OR services as plain strings (e.g. a
  Blacksmith's pool might mix "Hand-forged nails" with "Horseshoeing
  (service)") — don't build a separate goods-vs-services type distinction,
  consistent with this app's established "freeform tags, not a rigid enum"
  philosophy (dice notation, terrain types, conditions all work this way).

**Generation algorithm:**
1. When creating a building instance whose type has a non-empty `itemPool`,
   determine target stock count from settlement size — round numbers, e.g.
   hamlet=2-4, village=4-6, town=6-9, city=9-13, metropolis=13-18 (implement
   as a small size-indexed table near the other tuning constants).
2. Pick that many items from `buildingType.itemPool`, weighted by
   `sizeGateMultiplier(sizeId, item.minSizeId)` — **reuse the existing
   function directly**, don't reimplement — so a hamlet's shop mostly pulls
   common items with an occasional rare one slipping in, while a metropolis
   version skews toward the fancier end of the same pool.
3. Pick without replacement (reuse the existing pick-without-replacement
   pattern from `pickProficiencies` in `settlementGenerator.ts`), capped at
   the pool's actual size if it's smaller than the target count.

**Content needed — this is a substantial content-authoring pass, size it
accordingly:** an `itemPool` for each of the 18 shop/tavern/religious
building types in `defaultBuildingTypes()`, each with ~6-10 items spanning
hamlet-to-metropolis `minSizeId` tiers (so size actually matters — every item
having the same tier would make the size-scaling pointless). This is a bigger
content task than `proficiencyPool` was (more items per type, plus the tier
dimension needs real thought per item, not just a name). Budget it as its own
pass, likely worth doing 4-6 building types at a time with a sample-output
check in between (same iterative "build a batch, show real output, confirm
tone" pattern that worked well for name banks and personality content earlier
in this feature).

**UI:** show `building.inventory` in the Buildings tab's expand row (see #11
above — same expand mechanism, just add an inventory list alongside the
resident list).

---

## Suggested order

Rough grouping by size/risk, not a hard sequence:

1. **Quick, unambiguous fixes** (no design decisions needed, do these first):
   #3 (race filter UUID), #10 (natural sort), #2 (generate confirmation),
   #4 (no code change, just closed as "working as designed" if the user
   hasn't already internalized that).
2. **Moderate, clearly-scoped additions**: #11 (click building → residents),
   #7 (more flavor content).
3. **Confirm with the user before building** (data-model forks that are
   expensive to get wrong): #5's unemployment/wealth-tier interpretation —
   ask directly, don't guess.
4. **Bigger, self-contained engine work** (each comparable in size to a prior
   sub-feature of this project): #1 (phonetic profile expansion, plus
   syllable bank review), #6 (age-gated employment, depends on #5 landing
   first), #9 (district theming), #12 (building inventory — biggest content
   lift of this whole round).
5. **Still deliberately deferred**: #8 (relationships) — do not attempt to
   fold into this round.
