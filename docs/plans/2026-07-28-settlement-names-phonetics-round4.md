# Plan: British names category, multi-select phonetic profiles, 2 more profiles

Written 2026-07-28, for a **future session with no memory of this one** to pick
up and execute. Three requests from the user after testing the Settlement
Populator's name-generation system further. Read
`docs/plans/2026-07-27-initiative-timeline-settlement.md` §3 first if you
haven't — it's the original design doc explaining the storage model and the
promotion-not-precreation philosophy the whole feature builds on. Also worth
skimming `docs/plans/2026-07-27-settlement-feedback-round3.md` §1, which is
where the phonetic-profile system was first built out from 2 profiles to 8
(the syllable-bank-coverage caveat below repeats a lesson learned there).

**Key files:**
- `src/common/settlementNames.ts` — `NAME_INSPIRATION_SOURCES` (real-world
  regional name banks a custom race can pool from), `BASELINE_NAME_BANKS`
  (the 8 built-in races)
- `src/common/phoneticNames.ts` — `PHONETIC_PROFILES`, `SYLLABLE_BANK`,
  `generateSyntheticName`
- `src/common/noteTypes/settlement.ts` — `customRaceDefSchema`
  (`inspirationSourceIds: string[]` vs `phoneticProfileId: string | null`,
  "either/or, not both" by design)
- `src/common/settlementGenerator.ts` — `nameFor()` (~line 505), where a
  custom race's `phoneticProfileId` is looked up and either synthesizes a
  name or falls through to `resolveNameBank`/`inspirationSourceIds` pooling
- `src/renderer/src/components/sheets/SettlementSetupTab.tsx` — `RaceCard`
  component (~line 540-590), the radio-toggle + checkbox-list / single
  `<select>` UI for a custom race's name source

All three items below are independent — do them in any order, or all
together. Existing tests: `tests/settlementNames.test.ts`,
`tests/phoneticNames.test.ts`, `tests/settlementGenerator.test.ts`.

---

## 1. Add a British Isles name-inspiration category

**Current state:** `NAME_INSPIRATION_SOURCES` in `settlementNames.ts` has 9
entries a custom race can multi-select and pool from: `nordic`, `romantic`
(Italian/French/Portuguese/Spanish/Latin), `eastern-european`, `east-asian`,
`south-asian`, `west-asian`, `north-african-middle-eastern`,
`central-african`, `south-african`. There is no English/Irish/Welsh/Scottish
category at all yet — confirmed gap, not an oversight to double-check.

**Open question — confirm with the user before building, don't guess:** the
user's own message hedged with "(British?)" — two readings:
1. **One combined "British Isles" entry** pooling English/Irish/Welsh/
   Scottish names together into a single `NameBank`, same shape as
   `romantic` (which already deliberately combines 5 distinct traditions
   into one weighted pool with common/normal/rare in-pool variety).
2. **Separate entries** — `english`, `irish`, `welsh`, `scottish` as 4
   distinct `NameBank`s a user can multi-select individually or together
   (so a custom race could be "Welsh-leaning" specifically, not just
   "vaguely British").

Recommendation: **(2), separate entries** — English, Irish, Welsh, and
Scots-Gaelic naming traditions are phonetically quite distinct from each
other (unlike the Romantic-language group, which shares more common ground),
and the existing multi-select mechanism already lets a user combine several
sources into one pool if they want a blended "British Isles" feel anyway.
Splitting loses nothing and gains precision. But this is a real content-shape
decision — ask first.

**Content-authoring notes (same pattern as every other `NAME_INSPIRATION_SOURCES`
entry — ~20 male/~20 female/~8 neutral/~24 last names, common/normal/rare
weighted, see any existing entry in `settlementNames.ts` for the exact
shape):**
- Keep them properly distinct from each other and from the existing `nordic`
  entry (some overlap is inevitable — Norse influence runs through Scottish/
  Irish naming history — but the goal is 4 pools that sound different when
  sampled, not near-duplicates).
- Same filter already documented in this file's history applies: avoid any
  surname that reads as referencing one real, specific, still-notable
  person/family rather than a generic surname (see the existing comment
  above `NAME_INSPIRATION_SOURCES` for the reasoning and prior examples
  caught this way).
- The existing comment block above `NAME_INSPIRATION_SOURCES` also documents
  why a "Native American" category was deliberately NOT built (shaky/
  low-quality source material, ceremonial-name concerns) — not relevant to
  this request, just worth reading so the same research-quality bar is
  applied here too.

**Tests:** follow the existing pattern in `tests/settlementNames.test.ts` for
`NAME_INSPIRATION_SOURCES` entries (bank shape validation, `resolveNameBank`
pooling behavior).

---

## 2. Let a custom race select MORE THAN ONE phonetic profile

**Current state:** `CustomRaceDef.phoneticProfileId` is `string | null` —
exactly one profile, picked via a single `<select>` in `RaceCard`
(`SettlementSetupTab.tsx`). This is the ONE place in the whole custom-race
name system that doesn't support multi-select — `inspirationSourceIds` (the
sibling "real-world sources" mode) already lets a user check as many boxes as
they want and pools them together (see `resolveNameBank`'s `sources.flatMap(...)`
in `settlementNames.ts`). The user wants phonetic profiles to work the same
way.

**Proposed schema change:**
- `customRaceDefSchema.phoneticProfileId: z.string().nullable().catch(null)`
  → `phoneticProfileIds: z.array(z.string()).catch([])` (rename, matching
  `inspirationSourceIds`'s array shape — empty array = "phonetic profile mode
  is off, use inspiration sources instead", same as how `phoneticProfileId:
  null` currently signals that).
- This is a breaking rename, not an additive field — existing settlement
  notes with a saved `phoneticProfileId` will lose that value on next load
  (the old field just won't be read anymore). Given this whole feature is
  user-editable/regeneratable per-settlement and the note type has shipped
  recently with presumably few real settlements built yet, a silent rename
  is probably fine — but confirm with the user if they have settlements
  already relying on a specific single profile before shipping this as a
  breaking change instead of an additive `phoneticProfileIds` alongside the
  old field.

**UI change (`RaceCard` in `SettlementSetupTab.tsx`):** replace the single
`<select>` (~line 576-586) with a checkbox list, exact same pattern as the
`inspirationSourceIds` checkbox list right above it (~line 557-574) — copy
that structure, swap `NAME_INSPIRATION_SOURCES`/`inspirationSourceIds` for
`PHONETIC_PROFILES`/`phoneticProfileIds`. The radio-toggle between "Real-world
inspiration sources" and "Phonetic profile" mode stays (still either/or, not
both, per the existing design comment in `noteTypes/settlement.ts`) — only
change is that the phonetic-profile SIDE of that toggle becomes multi-select
too.

**Real design fork in `settlementGenerator.ts`'s `nameFor()` — confirm with
the user before building:** when a custom race has 2+ phonetic profiles
selected, how should generation actually use them? Two approaches:
1. **(Recommended) Pick ONE profile per generated name, at random from the
   selected set, uniformly or weighted equally.** Each individual name still
   comes out sounding internally consistent (a clean "draconic" name or a
   clean "aquatic" name), but the race's population as a whole shows a mix
   of both sounds — e.g. a "half-drake, half-fish-folk" invented race would
   produce SOME draconic-sounding names and SOME aquatic-sounding names,
   not a blended mush. This preserves every profile's distinctiveness,
   which was the entire point of the tag-weighted syllable system in the
   first place (see round-3 plan doc §1's reasoning).
2. **Blend the selected profiles' `tagWeights` together (e.g. average or sum
   them) into one merged profile, then synthesize every name from that
   single merged weighting.** Produces one consistent "in-between" sound for
   the whole race, but risks washing out distinctiveness — two profiles with
   opposite emphases (e.g. `harsh-guttural`'s plosive/guttural/short-vowel
   vs `fey-whimsical`'s nasal/liquid/long-vowel) could average toward
   something bland rather than "the union of both textures."

Recommendation is (1) for the reason stated, but this is genuinely a matter
of taste about what "select multiple profiles" should FEEL like — ask.

**Implementation sketch for (1), if confirmed:** in `nameFor()`, where it
currently does
`const profile = customRace?.phoneticProfileId ? phoneticProfiles.find(...) : undefined`,
change to pick a random element of
`phoneticProfiles.filter(p => customRace?.phoneticProfileIds.includes(p.id))`
before falling through to the existing `generateSyntheticName(profile, rng)`
call. Reuse the `rng()`-based random-index pick pattern already used
elsewhere in this file (e.g. `pickProficiencies`), don't add a new helper
for something this small.

**Tests:** add a statistical test in `tests/settlementGenerator.test.ts`
(same style as existing phonetic-profile tests) generating many names for a
custom race with 2 profiles selected, asserting both profiles' characteristic
sounds show up across the sample (not just one profile dominating due to a
bug in the random pick).

---

## 3. Add 2 more phonetic profiles: Animalistic, Fire

**Current state:** 8 profiles exist (`elvish-leaning`, `harsh-guttural`,
`draconic`, `fey-whimsical`, `aquatic`, `stony-giant-kin`,
`celestial-ethereal`, `insectoid-alien` — see `PHONETIC_PROFILES` in
`phoneticNames.ts`). The user specifically wants an **Animalistic** one and a
**Fire**-related one, noting we already have water (`aquatic`) and stone
(`stony-giant-kin`) — this reads as continuing an elemental/creature-type
series, so if a good idea for a third comes up while working on this
(earth/storm/shadow are the obvious remaining elemental gaps, or something
like "insectoid" already covers one creature-type slot), consider proposing
one to the user rather than silently adding it — the original 6-profile
expansion asked before extending scope, follow that precedent.

**Suggested tag-weight direction for the 2 requested:**
- **Animalistic / feral** — nasal + liquid + guttural, short-vowel-leaning;
  should read as growly/breathy rather than articulate — lean into `nasal`
  and `guttural` together (a combination none of the existing 8 profiles
  emphasize simultaneously — `harsh-guttural` is guttural but plosive-heavy
  not nasal-heavy) so it doesn't just re-sound `harsh-guttural`.
- **Fire / ashen / infernal** — sibilant + affricate + plosive, a "crackling,
  hissing, popping" texture. Watch out: this tag combination overlaps
  significantly with `insectoid-alien` (affricate + sibilant + short-vowel)
  — needs a genuinely differentiating weight emphasis (e.g. add `guttural`
  or `plosive` weight that insectoid doesn't have) or it'll just sound like
  a second insectoid profile. This is exactly the kind of overlap risk the
  round-3 plan doc flagged for the original 6-profile expansion.

**Required before shipping either profile (same process used for the
original 6-profile expansion, repeat it exactly):**
1. Write the profile(s) into `PHONETIC_PROFILES`.
2. Generate sample output using the throwaway-test pattern
   (`_samplePhonetic.scratch.test.ts` — write it, run it, read the console
   output, delete it before committing) and actually LISTEN (read) whether
   Animalistic and Fire sound distinct from each other and from all 8
   existing profiles, especially `harsh-guttural`/`insectoid-alien`/
   `draconic` (the 3 already in similar sonic territory).
3. **Check `SYLLABLE_BANK` coverage before assuming distinctness will just
   work.** It's grown to 72 syllables (up from 54 originally) but was built
   with the ORIGINAL profiles' tag needs in mind. If Animalistic's
   nasal+guttural combo or Fire's sibilant+affricate+plosive combo don't have
   enough matching-tagged syllables to draw from, add ~10-15 more tagged
   syllables per profile that's under-differentiating, same as before —
   don't ship a profile that doesn't actually sound different just because
   the mechanism technically works.

**Tests:** the "produce audibly different sound palettes" statistical test
pattern in `tests/phoneticNames.test.ts` (regex-matching characteristic
sounds across many draws) — add a pair-test for each new profile against
its nearest existing neighbor (Animalistic vs `harsh-guttural`, Fire vs
`insectoid-alien`), not just against the full existing suite generically.

---

## Context for the future session (not action items, just answers to
## questions asked alongside this request — included so nothing needs
## re-deriving)

**How many physical appearance characteristics does `settlementAppearance.ts`
pull from, per notable?** 7 categories, each a per-race weighted pool: hair
(color+length+texture combined into one line) or scale color for Dragonborn
(mutually exclusive via `hasHair`), eye color, facial hair (male-only,
race-gated via `canGrowFacialHair`, ~60% chance of having some vs. clean-
shaven), race-specific special features (tusks/horns/tattoos/etc., ~70%
chance when the race has any defined), skin tone (skipped for Dragonborn —
scale color already covers it), height (numeric cm range per race, rendered
in both cm and feet/inches), and build (one shared `BUILDS` pool, not
per-race). Typically renders as 3-4 lines of prose depending on race. Stubs
(non-notable residents) never get appearance text at all — same cost/scope
lever as stats/personality/goal.

**Where does a settlement's `religionDistribution` actually show up once
generated?** Every resident (notable or stub) gets a `religion` field picked
via `pickReligion()` in `settlementGenerator.ts`, but it only surfaces in
TWO places in the whole UI: (1) the People tab's expanded-row detail — click
a resident row, one line reads "Follows {religion}." if set — and (2) the
promoted NPC note's body text (`settlementPromotion.ts` includes the same
line). It is NOT a table column and has NO filter dropdown, unlike Race/
Wealth tier/District/Notable-only which all have dedicated filter UI in the
People tab's filter bar. **Not a requested change** — the user asked "where
does this show up" as a question, not a "make it more visible" request — but
if a future session is asked to make religion more discoverable, adding a
Religion column + filter dropdown to `SettlementPeopleTab.tsx` would be the
obvious small follow-up, mirroring the existing Wealth/District filter
pattern exactly.
