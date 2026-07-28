# Plan: Custom Calendar System + Multi-Calendar Timeline with Event Pills

Written 2026-07-28, for a **future session with no memory of this one** to pick
up and execute. This is a big feature — comparable in size to the Settlement
Populator (see `docs/plans/2026-07-27-initiative-timeline-settlement.md`),
likely its own multi-session build. Read this whole doc before starting.

## Why

Two things prompted this:
1. The user wants **other people** to be able to use Project Vault for their
   own campaigns, which means a real calendar-editing UI (not just this
   vault's hardcoded parser) — reference screenshots from a site they like
   ("Time System Editor") were shown: Overview / Months / Week / Days /
   Years-Eras / Moons / Settings tabs, each editing a structured calendar.
2. For their OWN campaign, they want **multiple calendar systems viewable
   simultaneously** on the same timeline (their real-world example: a WWII
   timeline showing both Gregorian and Islamic dates for the same events) —
   plus a real visual timeline (scaled axis, event "pills" you click to
   expand), not the current plain sorted list.

## Current state (confirmed by reading the code, not assumed)

- `event` notes have a `date` field that is **plain free text**
  (`z.string()`, `src/common/noteTypes/event.ts`) — explicitly commented
  "not a real calendar date." No calendar note type or structured date
  exists anywhere in the app today.
- `src/common/worldTimeline.ts` pulls dated facts out of ANY note's body
  (a `## History` section's bullets, or bare `Born:`/`Died:` lines) — not
  just `event` notes.
- `src/common/worldTimeline.ts`'s Events view (`EventsTimelineView.tsx`,
  `CloudEventsTimelineView.tsx`) is a **plain list**, not a scaled visual
  timeline. No pills, no zoom, no axis.
- **`src/common/worldDate.ts` already exists** and is the key asset for
  this build — it parses this vault's specific free-text dates into a
  sortable chronological value, and already encodes the user's actual
  calendar data (recovered from an earlier session's chat + this file,
  see "Recovered calendar data" below). It's currently ONLY used for
  sorting (`compareWorldDates`), not for structured storage or display.
- Map×Timeline crossover (`src/common/mapTimeline.ts`, `MapSheet`'s
  Timeline section) already exists and steps through location-tagged
  events index-by-index — deliberately NOT date-scaled (see that doc).
  This new timeline is a different, date-scaled view; the map one can stay
  as-is unless a future session decides to unify them.

## Recovered calendar data (confirmed with user 2026-07-28, don't re-derive)

The user's own campaign (`Documents/Project Planar`) uses two calendars,
both already partially encoded in `worldDate.ts`:

**Age of the Many / Age of the Few** (main calendar — AM counts up like CE,
AF counts down like BCE; "Age of the Many" = AM's full era name, "Age of
the Few" = AF's full era name, confirmed by the AM/AF abbreviations):
- 4 months × 100 days each = 400-day year: Aucaela, Auctera, Morcaela, Mortera.
- 9-day week, each day named after a progenitor, **in this exact order**:
  Minem, Kleipur, Sylvana, Shram, Thean, Numen, Genasi, Talav, Sithi.

**Kingdom of Krotaphos** (a regional calendar, used only in dates about
that kingdom, sharing the same AM/AF year numbering as the main calendar):
- 12 variable-length months: Blython 30, Neemon 29, Veriton 28, Pavlon 27,
  Themon 26, Gwenon 25, Belphala 30, Abala 29, Tiyala 28, Lukala 27,
  Archala 26, Lilia 25 (330-day year total). Note the spelling is
  **Belphala**, not "Belphalia" — confirmed with the user after an initial
  spelling mismatch in the source chat.
- **6-day week** (different from the main calendar's 9-day week — confirmed
  NOT shared), names in order: Aaranea, Baator, Charios, Hesit, Sylas, Themati.

**Confirmed 2026-07-28**: build full hours/minutes/moons structure now
(not deferred), even though nothing in the vault currently uses sub-day
precision — the user wants this for the general-purpose calendar editor,
not just their own data. No hour/minute/moon values for either of the
user's own two calendars have been specified yet — ask at kickoff.

**For the migration** (see below): `worldDate.ts`'s existing parsing logic
(FULL_DATE_RE / BARE_YEAR_RE / COMPACT_RANGE_RE, month-name lookup across
both calendars, typo-tolerant fallback to year-only precision) is
proven-correct against this exact vault's real content already — reuse it
as the migration's parser rather than writing a new one.

## Architecture decision (confirmed with user 2026-07-28)

**A single canonical continuous timestamp per dated thing, with each
calendar acting as a pure formatter/parser over that shared axis** — the
only way "view this event in 2+ calendars simultaneously" actually works,
same principle real-world calendar conversion uses (a Julian day number as
the substrate, Gregorian/Islamic/Hebrew as display layers on top). Pick a
canonical unit now (suggest: minutes since an arbitrary epoch, since the
user wants full hour/minute precision) and stick with it everywhere a date
is stored.

**Calendar is its own note type** (like `settlement`/`map`), confirmed —
NOT a global app setting. A vault can define as many calendars as it wants;
each is a note holding the structured Months/Week/Days/Years-Eras/Moons
config (mirrors `settlement.ts`'s "one note, lightweight config, not
per-entity notes" pattern — there's no per-entity bloat risk here anyway,
a calendar definition is small).

**Multi-calendar display is fully generic (any N calendars active at
once)**, confirmed — not hardcoded to 2. A per-vault (or per-user?
ask at kickoff) list of "active calendars" controls which calendar(s)
format every displayed date. For the user's own campaign: Age of the
Many/Few + Krotaphos should both show. Design so a brand-new user with
zero calendars defined still works sensibly (probably: fall back to
showing raw free text, same as today, until they define at least one).

## Migration (confirmed with user 2026-07-28)

Write a real migration, not an additive-only field. Existing free-text
`date` values (on `event` notes, `## History` bullets, `Born:`/`Died:`
lines) get converted into the new canonical-timestamp format using
`worldDate.ts`'s existing parser as the base. Open questions to resolve
at kickoff, don't guess:
- What happens to text that `worldDate.ts` can't parse today (it already
  has a documented "returns null, caller leaves it undated" escape hatch)?
  Probably: keep the original free text as a fallback/override field so
  nothing is silently lost, same spirit as the `isPronounceable` fallback
  pattern used elsewhere in this codebase (Settlement Populator's
  phonetic-name synthesis) — return something usable rather than nothing.
- Does the migration run automatically on vault open, or is it a manual
  one-time action the user triggers? A one-time explicit action is safer
  (matches this codebase's general caution around irreversible-feeling
  operations) — confirm at kickoff.
- Krotaphos dates need to convert cleanly against the SAME canonical axis
  as main-calendar dates (worldDate.ts already does this scaling for
  sorting purposes — `scaledDay` in `parsePoint` — reuse that exact logic
  rather than re-deriving the conversion math).

## Timeline pill view (new, doesn't exist yet)

A new visual component (distinct from the existing plain-list
`EventsTimelineView.tsx`) — a scaled horizontal (or vertical?) axis over
the canonical timestamp range, events rendered as clickable pills
positioned proportionally, click-to-expand showing the event's summary
inline (or open the full note — ask which at kickoff). Needs:
- A sensible axis scale/zoom strategy for a world with a 400-day year and
  potentially many events spanning centuries (can't just be linear-always,
  or a single day-long event centuries ago becomes an invisible sliver
  next to a millennium-spanning era) — this is a real design question,
  don't hand-wave it; look at how other timeline libraries/tools handle
  this (clustering nearby events, zoom levels) before building from scratch.
- Formats each pill's date using whichever calendar(s) are currently
  active (see multi-calendar section above) — a pill might show two date
  strings stacked if 2 calendars are active, same as the reference
  screenshots' spirit of "see it in multiple systems."

## Suggested build order

1. `calendar` note type + schema (Months/Week/Days/Years-Eras/Moons fields,
   mirroring the reference screenshots' structure) — foundational, nothing
   else can be built without it.
2. Calendar editor UI (the 6 tabs from the reference screenshots, adapted
   to this app's existing sheet/tab conventions — `SettlementSheet.tsx`'s
   button-row tab pattern is the closest precedent, no real tab primitive
   exists in this codebase yet).
3. Canonical-timestamp formatter/parser per calendar (the actual
   month/week/day math — this is the trickiest pure-logic piece, budget
   real time for it, and write it calendar-agnostic from the start since
   day one requirement is "any user can define their own").
4. Structured date field on `event` notes (+ wherever else dates live) —
   replace/augment the free-text field.
5. Migration script reusing `worldDate.ts`'s parser.
6. Multi-calendar simultaneous display (active-calendars list + formatting
   every shown date through all active calendars).
7. New pill-based timeline view.

Each numbered step has its own open questions noted inline above — confirm
with the user at the start of whichever step you're building, don't
silently assume defaults for anything marked "ask at kickoff."

## Key files

- `src/common/noteTypes/event.ts` — current free-text `date` field.
- `src/common/worldTimeline.ts` — History-bullet/Born-Died extraction (stays
  as-is, feeds INTO the new structured date system rather than being
  replaced by it).
- `src/common/worldDate.ts` — the parser to reuse for migration; also
  currently the single source of truth for the user's actual calendar data
  (see "Recovered calendar data" above).
- `src/renderer/src/components/timeline/EventsTimelineView.tsx` +
  `CloudEventsTimelineView.tsx` — current plain-list view, precedent for
  where the new pill view's sibling component would live.
- `src/common/noteTypes/settlement.ts` + `SettlementSheet.tsx` +
  `SettlementSetupTab.tsx` — closest precedent for "a note type holding a
  big structured config, edited via a multi-tab sheet UI."
- `src/common/types.ts`'s `NoteTemplate` union — where `'calendar'` gets
  registered, same mechanical pattern as `'settlement'`/`'map'`.

## Progress

**Step 1 done (2026-07-28):** `calendar` note type + schema built —
`src/common/noteTypes/calendar.ts` (`calendarFrontmatterSchema`,
`defaultCalendarFrontmatter`), registered the normal `NoteTemplate` way
(not the `map`-style cloud bypass — a calendar note is plain per-vault
config, no cloud-only storage need): `types.ts`'s `NoteTemplate` union,
`noteTemplateDefaults.ts`'s `TEMPLATE_DEFAULTS`/`CREATE_PLACEHOLDERS`/
`CREATE_LABELS`/`CREATABLE_NOTE_KINDS`. A minimal placeholder
`CalendarSheet.tsx` (summary field + a one-line data readout) is wired
into `SheetView.tsx`'s dispatch switch so a calendar note doesn't render
blank — the real Overview/Months/Week/Days/Years-Eras/Moons tabbed editor
is still step 2, not yet built. Tests in `tests/calendar.test.ts`.

**Step 2 done (2026-07-28, same session):** the full 7-tab editor is
built, replacing the placeholder — `CalendarSheet.tsx` now dispatches to
`CalendarOverviewTab`/`CalendarMonthsTab`/`CalendarWeekTab`/
`CalendarDaysTab`/`CalendarYearsErasTab`/`CalendarMoonsTab`/
`CalendarSettingsTab` (all in `src/renderer/src/components/sheets/`),
same button-row tab pattern as `SettlementSheet.tsx`. Notes:
- Months/Week tabs got up/down move buttons (new `src/common/arrayMove.ts`
  helper, tested in `tests/arrayMove.test.ts`) since order is semantically
  load-bearing there (day-of-year/day-of-week math) — unlike settlement.ts's
  list editors, which never needed reordering.
- Added one schema field not in the original step-1 draft:
  `defaultEraId: string | null` on `calendarFrontmatterSchema`, edited via
  the new Settings tab — which era a bare/unsuffixed year belongs to.
  This directly generalizes `worldDate.ts`'s existing hardcoded "no AM/AF
  suffix defaults to AM" behavior to a calendar with any number of eras.
  Not explicitly confirmed with the user (a reasonable, low-risk,
  additive call, not a re-litigation of anything already confirmed) —
  flagging here in case a future session (or the user) wants to revisit
  it once the reference screenshots are available.
- Years & Eras tab combines era list editing AND the leap-year rule editor
  in one tab (matches the reference site's single hyphenated "Years-Eras"
  tab name, confirmed from the doc's own tab list — not a merge decision
  made independently).
- Full verification: `npx tsc -p tsconfig.web.json --noEmit` and
  `npx tsc -p tsconfig.node.json --noEmit` both clean (node config's 33
  pre-existing errors in `settlementGenerator.test.ts`/
  `settlementPromotion.test.ts` confirmed present on `main` before this
  work, unrelated); `npm test` — 301/301 passing. Could NOT visually
  verify the editor renders correctly in the actual Electron app (no
  desktop screenshot access in this environment) — worth the user
  actually opening a Calendar note and clicking through all 7 tabs before
  trusting this is production-ready.

Schema shape, confirmed with the user at kickoff:
- `eras: CalendarEra[]` — `{ id, name, abbreviation, direction: 'up'|'down' }`.
- `leapYearRule: LeapYearRule | null` — Gregorian-style nested interval/
  exception/exception-to-the-exception (`intervalYears`,
  `exceptionEveryYears`, `exceptionToExceptionEveryYears`, `extraDays`,
  `monthId` — null `monthId` means standalone intercalary day(s), not
  added to any month). `null` = no leap years (true of both the user's own
  calendars). This was the one gap in my first draft — user flagged
  leap years were missing before I wrote any code.
- `months: CalendarMonth[]` — `{ id, name, days }`, every month enumerated
  explicitly (handles both fixed-length and Krotaphos-style variable-length
  calendars, no "uniform length" shortcut).
- `weekDays: string[]` — ordered day names, no separate week-length field
  (length IS the array length).
- `hoursPerDay` / `minutesPerHour` — numeric, seeded 24/60 placeholders.
  User confirmed: no real hour/minute/moon values for their own two
  calendars yet, seed placeholders and fill in later via the editor
  (still true after this session — nothing decided about their actual
  sub-day precision).
- `moons: CalendarMoon[]` — `{ id, name, cycleDays, phaseOffsetDays }`.

**Not yet resolved / still open for a future session:**
- Everything in "Architecture decision," "Migration," and "Timeline pill
  view" above is UNCHANGED — none of it was touched this session. In
  particular the canonical-timestamp unit (step 3) is still just a
  suggestion, not decided.
- The reference site's actual field list was never seen directly this
  session (no screenshots available) — the schema above is a best-effort
  reconstruction confirmed against the user's verbal description plus one
  correction (leap years). If a future session gets access to the actual
  reference screenshots, double-check nothing else is missing (e.g. named/
  irregular hour segments, named moon phases — both explicitly considered
  and left out this round since the user didn't flag them, but worth a
  second look with the real screenshots in hand).
- The Settings tab's `defaultEraId` field (see Step 2 notes above) hasn't
  been shown to the user yet — worth a quick confirmation it's the right
  call before more is built on top of it.
- Next session should start at step 5 (migration) — steps 1-4 are all
  done now.

**Step 3 done (2026-07-28, same session):** canonical-timestamp
formatter/parser built — `src/common/calendarMath.ts`:
- `toCanonicalMinutes(calendar, parts)` / `fromCanonicalMinutes(calendar,
  minutes)` — the two-way conversion the architecture decision above
  requires, using **minutes since an arbitrary shared epoch** as the
  canonical unit (picked per the doc's own suggestion, since full
  hour/minute precision was already required). Epoch = canonical minute 0
  = a calendar's first `direction: 'up'` era's year 1, first month, day 1,
  hour 0, minute 0. A `direction: 'down'` era's year 1 is the year
  immediately before that (no year zero — matches real BCE/CE and
  `worldDate.ts`'s existing AM/AF epoch() convention exactly). Two
  calendars that both anchor to this same point (true of the user's own
  two) come out mutually convertible automatically, with no extra
  alignment field required — confirmed by a passing test converting the
  SAME instant through both calendars.
- `isLeapYear` / `yearLengthDays` / the internal leap-day-count math is
  **closed-form** (floor-division, no loops) — the same trick real
  Gregorian day-count algorithms use (`365y + floor(y/4) - floor(y/100) +
  floor(y/400)`), generalized to the schema's arbitrary interval/
  exception/exception-to-exception/extraDays shape. Verified against the
  actual Gregorian rule's known behavior at 1900/2000/2024 in
  `tests/calendarMath.test.ts`.
- The REVERSE direction (canonical minutes -> calendar date) has no
  closed-form inverse once a leap rule makes year length irregular — this
  is a genuine, known-in-the-literature limitation of leap-year math, not
  a shortcut I introduced. Used the standard fix instead: estimate the
  year from the average year length, then correct with a small bounded
  loop (leap adjustment is always tiny relative to a full year, so it
  converges in 0-2 iterations in every test case, including a full
  1900-2025 span crossing the 100-year exception AND the 400-year
  exception-to-the-exception).
- `formatCalendarDate` — human-readable rendering (e.g. "15 Aucaela, 42
  AM", or with a trailing "14:30" once hour/minute are non-zero). Not
  wired into any UI yet — step 7 (pill view) is the first real consumer.
- 14 tests in `tests/calendarMath.test.ts`: round-trips across a plain
  2-month calendar, the user's actual AM/AF two-era 400-day calendar
  (including the AM/AF epoch boundary itself), and a Gregorian-style
  leap-rule calendar spanning 1900-2025. `npm test` — 315/315 passing;
  `tsc` clean on both configs (same 33 pre-existing unrelated errors as
  before).
- **Not yet wired to anything real**: this module has no caller yet.
  Steps 4 (structured date field on notes) and 5 (migration) are what
  will actually call `toCanonicalMinutes`/`fromCanonicalMinutes` on real
  vault data — until then this is tested in isolation only.
- **Still open**: what happens when a calendar has zero eras, or zero
  'up'/'down' eras of the direction a given canonical minute needs —
  `fromCanonicalMinutes` returns `null` in that case (same "leave it
  undated" escape hatch as `worldDate.ts`), but no caller exists yet to
  confirm that's the right UX (vs. e.g. falling back to raw free text).

**Step 4 done (2026-07-28, same session):** structured date field added to
`event` notes — `src/common/noteTypes/event.ts`'s new
`eventStructuredDateSchema` / `structuredDate` field. Key decision: this
**adds to** the existing free-text `date` field, never replaces it — every
existing event note keeps working exactly as before (`structuredDate`
defaults `null`), matching the doc's own migration-section reasoning
("keep the original free text as a fallback/override field so nothing is
silently lost") applied one step early, at the schema level. A
`structuredDate` references a calendar note **by title** (`calendarNoteTitle`,
same convention as this file's existing `location` field) plus
`{eraId, year, monthId, day, hour, minute}` — the exact shape
`calendarMath.ts`'s `CalendarDateParts` expects, so `toCanonicalMinutes`/
`fromCanonicalMinutes` can consume it directly once a caller needs to
(nothing does yet — see Step 3's notes).

`EventSheet.tsx` got a new checkbox-gated "structured date" section:
picks a calendar note (datalist, like the existing Location field), then
era/year/month/day/hour/minute inputs once that calendar's own frontmatter
is fetched. This needed a genuinely new capability — `NoteRefApi` (used by
4+ existing sheets) only exposed `readBodyByTitle`, not frontmatter, so a
`readFrontmatterByTitle` method was added to the shared interface and both
backend implementations (`useLocalNoteRefApi`/`useCloudNoteRefApi` in
`src/renderer/src/lib/noteRefApi.ts`) — local reads+parses the note's raw
content, cloud already returns `frontmatter` directly from `getNote`.
`tests/renderer/noteRefApi.test.ts` updated (new 5th constructor arg on
every existing `createNoteRefApi(...)` call) plus a new
`readFrontmatterByTitle` describe block.

Tests: `tests/event.test.ts` (schema — coexistence of `date`/`structuredDate`,
malformed-input fallback). Verification: `npm test` — 320/320 passing;
both `tsc` configs clean (still the same 33 pre-existing unrelated errors).
Could not visually verify the new EventSheet UI in the actual app (no
desktop screenshot access) — worth checking a real event note's Date
section renders/behaves as expected.

**Not yet resolved / still open:**
- `structuredDate` is populated ONLY by hand via this new UI — nothing
  auto-fills it from the existing free-text `date` yet. That's step 5
  (migration), which still has its own unresolved kickoff questions from
  the original plan (auto vs. manual trigger; what happens to text
  `worldDate.ts` can't parse) — unchanged by this session's work.
- `worldTimeline.ts`'s History-bullet/Born-Died extraction (free text
  inside note bodies, not frontmatter) was deliberately left untouched,
  per the doc's own "stays as-is, feeds INTO the new structured date
  system" — no structured equivalent exists for those yet, only for
  dedicated `event` notes.
- The EventSheet UI is functional but minimal (plain dropdowns, no
  validation that the chosen day/month/hour/minute combination is even
  in-range for the selected calendar) — worth a pass once real usage
  surfaces rough edges.
