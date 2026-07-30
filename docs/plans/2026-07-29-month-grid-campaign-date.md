# Plan: Visual month/day calendar grid + campaign "today" date

Written 2026-07-29, for a **future session with no memory of this one** to pick up and
execute if interrupted. Builds directly on `docs/plans/2026-07-28-calendar-timeline-system.md`
(calendar notes, canonical-minutes math, the pill timeline) and the moon-phase/weather
work done the same week (`common/calendarMath.ts`'s `computeMoonPhase`, `common/weatherGeneration.ts`).

## Why

From the feature-audit artifact's Part B: a real "look at the month of Aucaela" view — a
month grid for user-defined fantasy calendars, distinct from both the calendar editor
(defines structure) and the pill timeline (scatters everything chronologically). The
user wants it specifically **"to show me upcoming events,"** which needs an anchor date.

Confirmed with the user:
- **Include a campaign "today" date** (also resolves the audit's separate "no today
  marker" gap): per-vault current in-campaign date; the grid opens on it, highlights it,
  and an upcoming-events list becomes meaningful.
- **Day cells show moon phases** (reuse `computeMoonPhase`).
- **Expandable per-day detail shows weather across locations** — the location↔climate
  tie already exists (`climateNoteTitle` on location/settlement notes); this only
  *consumes* it: enumerate places with a climate, show each one's generated weather for
  the clicked day.

## Existing pieces reused (no new math where old math works)

- `toCanonicalMinutes`/`fromCanonicalMinutes`/`formatCalendarDate`/`daysInMonthForYear`/
  `computeMoonPhase` — `src/common/calendarMath.ts`.
- `expandAnnualRecurrence` — `src/common/eventTimelinePlacement.ts` (recurring events
  must appear on the grid).
- `computeWeatherForDate` — `src/common/weatherGeneration.ts`.
- Data-loading pattern (listEvents + calendar frontmatters + settings) — copied from
  `EventsPillTimelineView.tsx` / `CloudEventsPillTimelineView.tsx`.
- Weekday convention: `CalendarWeekTab.tsx`'s own UI text — "day 1 of the calendar's
  epoch falls on" the first `weekDays` entry. Weekday index = positive-mod(daysFromEpoch,
  weekDays.length).

## 1. Pure logic — `src/common/monthGrid.ts`

`MonthRef { eraId, year, monthId }`; `weekdayIndex`; `buildMonthGrid` (leap-aware via
`daysInMonthForYear`, leading/trailing null padding); `stepMonth` (steps via canonical
minutes so year rollover and the up/down era boundary both work with zero
special-casing); `monthRefForMinutes`; `bucketByDay`.

## 2. Campaign date — settings on both backends

`CampaignDate { calendarNoteTitle, eraId, year, monthId, day }` in `common/types.ts`;
`VaultSettings`/`CloudWorkspaceSettings` gain `campaignDate: CampaignDate | null`.

- Local: `session.ts`'s `getSettings`/`defaultVaultSettings` read/default it (loose
  shape validation, falls back to null rather than throwing — same spirit as the rest of
  that settings file).
- Cloud: `project-vault-cloud` migration `0004_workspace_campaign_date.sql` (`campaign_date
  jsonb` on `workspaces` — **user must run this once in the Supabase SQL editor**,
  same as 0003) + `workspace-settings/route.ts` GET/PATCH extended, PATCH now
  field-optional (only touches whichever key is present in the body).

## 3. Views — third "Calendar" tab in both Events sections

`EventsSection.tsx` / `CloudEventsSection.tsx` gain a third tab alongside List/Timeline.
New `MonthGridView.tsx` (+ cloud twin `CloudMonthGridView.tsx`, same duplicated-pair
convention as the pill views): calendar selector, month header with step/Today controls,
a real CSS-grid month calendar (day cells show the day number, moon phase emoji(s), and
up to a few event-title chips with overflow), a day-detail panel (full date, events,
moon phases, weather per climate-tied place, "Set as campaign date" button — this
doubles as the only campaign-date editor needed), and an upcoming-events list anchored
to the campaign date.

## Verification

- `npx vitest run tests/monthGrid.test.ts` + full suite (same pre-existing
  better-sqlite3 ABI failures only) + `tsc --noEmit` clean on both configs.
- `project-vault-cloud`: migration + route committed; **user runs the 0004 SQL in
  Supabase manually** before the cloud grid's campaign date will persist.
- Electron UI — no screenshot capability in this environment; user verifies visually:
  open Events → Calendar tab, page months, click a day, set campaign date, confirm the
  upcoming list and weather/moon details.

## Status as of 2026-07-29

**Complete.** `monthGrid.ts` pure logic, `CampaignDate` type + local/cloud settings
wiring, `project-vault-cloud` migration + route, `EventsSection.tsx`/`CloudEventsSection.tsx`
tab wiring, `MonthGridView.tsx`/`CloudMonthGridView.tsx`, CSS, and tests
(`tests/monthGrid.test.ts` — 18 passing; `tests/vaultSettings.test.ts` extended for
campaignDate — blocked in this dev environment by a pre-existing, unrelated
`better-sqlite3` native-module ABI mismatch, will pass in a normal environment).
`tsc --noEmit` clean on both configs; 445 tests passing overall.

**Not yet done by this session**: the user needs to run the `0004_workspace_campaign_date.sql`
migration in the Supabase SQL editor before the Cloud Workspace's campaign date will
persist (same manual step 0003 needed) — see that file for the exact SQL. Not manually
verified in the running Electron app (no screenshot capability in this dev environment).
