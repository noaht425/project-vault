# Native American/First Nations + Pacific/Oceania name banks — research handoff

Read this at the start of the session, don't re-derive from scratch. This is a **research and sourcing task first, a build task second** — do not write any name content into the codebase until a source has been vetted against the bar below and the user has confirmed it.

## Goal

Add name-bank content for two new regions to the Settlement Populator's custom-race name system (`src/common/settlementNames.ts`), matching the shape/quality of the 9 existing `NAME_INSPIRATION_SOURCES` regions (nordic, romantic, eastern-european, east-asian, south-asian, west-asian, north-african-middle-eastern, central-african, south-african):

1. **Native American / First Nations**
2. **Pacific / Oceania** (confirmed in scope 2026-08-08 — Hawaiian, Māori, and broader Pasifika)

After a region's standalone bank exists, a small ~3-name-per-category sample can optionally be blended into `BASELINE_NAME_BANKS`'s Human entry too — same two-step pattern used for West Asian (built standalone first at `id: 'west-asian'`, blended into Human afterward in a separate commit, 2026-08-08).

## The bar this content has to clear (why this has taken multiple sessions already)

Established across several prior sessions, hit again from a fresh angle each time:

- **Ceremonial/sacred naming practices are real and specific.** In many Native American/First Nations traditions, personal names are clan property, earned through life milestones, or bestowed in ceremony — not a general public registry. A "list of common first names" in the same format as the other 9 regions may not be an appropriate format for this content at all, or may need to lean much more on **English translations / anglicized surnames** (Option A below) than on native-language given names.
- **Low-quality sources are common and have already been explicitly rejected**: `warpaths2peacepipes.com` (no stated authorship/sourcing, blocked automated access, pattern-matches known-bad SEO content) and `fantasynamegenerators.com` (hobby project, 1,400+ generators treating every real and fictional culture identically, no sourcing methodology).
- **The BIA Indian Census Rolls** (National Archives, M595, 1884–1940) are genuinely official — but are scanned microfilm images of real, specific historical individuals tied to an assimilation-era administrative system, not a machine-readable name list. Not practical to bulk-extract from, and ethically heavier than a generic "common surnames of a culture" pool even if it were practical. Reasonable *narrow* use: observing surname/naming **patterns** (Option A below), not extracting individuals' actual recorded names.
- User has personally researched this too and is treating it as important to get right — don't rush a source through just to unblock the build.

## What's promising, not yet verified by direct inspection

From an independent Gemini research pass (2026-08-08, transcript: https://share.gemini.google/pDbUDlrlTK7q) — check each of these directly before relying on them, the same way tribal .gov sites were checked earlier in this project (visit the site, confirm authorship/sourcing, don't take a secondhand description on faith):

- **FirstVoices** (firstvoices.com, First Peoples' Cultural Council, BC-based) — the most promising new lead specifically for Native American/First Nations. Claimed to be Indigenous-led with content contributed directly by community Elders/fluent speakers across dozens of First Nations language families. Not yet directly checked by Claude in this project.
- **Ulukau: The Hawaiian Electronic Library** (ulukau.org) + **Pukui & Elbert's *Hawaiian Dictionary*** — Mary Kawena Pukui is a genuinely authoritative Native Hawaiian cultural scholar; this is about as strong a source as exists for Hawaiian naming specifically.
- **Te Aka Māori Dictionary** (maoridictionary.co.nz) — maintained by Māori language scholars, covers te reo Māori personal names (ingoa).
- **Native-Languages.org** — already checked in an earlier session; turned out to be mostly vocabulary/dictionary content, not a personal-name list, and included content critiqued as inaccurate ("Chenoa" mistranslation example). Low priority.
- Several academic books were also cited (Suttles on Coast Salish, Benton-Banai's *The Mishomis Book* [genuinely Ojibwe-authored, a real primary source], Mooney's 1888 Cherokee ethnography [real but a non-Native Victorian-era outsider account, weigh accordingly], Perdue's *Cherokee Women*, Pukui's *Nānā i ke Kumu*). These are real, respected works but are physical/paywalled books — neither Claude nor Gemini can fetch and extract from them directly. Useful as reading leads for the user, not directly usable as a web source.

## Recommended approach (confirm with user before committing to it)

Two open design questions worth raising explicitly, not assuming:

1. **Multiple smaller banks vs. one umbrella bank per region.** The existing "west-asian" and "romantic" banks already bundle several related-but-distinct traditions under one clearly-labeled umbrella (e.g. "Turkish / Persian / Armenian / Georgian / Azerbaijani / Kurdish / Hebrew"). But "Native American/First Nations" spans far more linguistically/culturally distinct nations than any existing bank — Gemini's own research explicitly warned against a single generic "Native American" pool for exactly this reason ("Never pull names from a generic 'Native American' pool"). Likely better fit: **separate named banks per nation/region** (e.g. a Pacific NW/Coast Salish-inspired bank, a Great Lakes/Ojibwe-inspired bank, a Southeast/Cherokee-inspired bank, etc.), each sourced and labeled individually — mirroring how Gemini's own regional breakdown was structured. Same question applies to Pacific/Oceania (Hawaiian vs. Māori vs. wider Pasifika are distinct enough that separate banks may fit better than one "Pacific Islander" blob).
2. **Given-name vs. surname/translation balance.** Given the sacred/ceremonial concerns around personal given names specifically, it may be that some or all of these banks lean more heavily on English-translation-style names or historically-attested surnames (Option A/C from the Gemini conversation) rather than native-language given names (Option B) — decide this per-nation based on what a vetted source actually supports, not uniformly.

## Methodology once a source is actually vetted (adapted from the Gemini conversation's Option A/B/C framework)

- **Option A — anglicized/translated names or historically-attested surnames**: safest route for fiction. Look at naming *patterns* in vetted historical sources, don't lift a specific real individual's exact recorded name.
- **Option B — construct names from verified language roots**: only from a source that documents actual grammar/vocabulary with clear meanings (e.g. FirstVoices, Te Aka, Ulukau) — never copy a real living lineage's specific ceremonial name.
- **Option C — descriptive English translations**: study the *structural* pattern of how a nation's names are typically formed (e.g. "active weather/animal/directional verb" for Ojibwe) and construct new descriptive English phrases in that pattern, not real people's specific historical names.
- Run anything before it goes in the codebase through the same checks already applied elsewhere in this file: not a real, specific, still-referenced individual's name (see the existing surname-filtering note in `settlementNames.ts` above `NAME_INSPIRATION_SOURCES`); not a sacred/restricted title or ceremonial rank.

## Implementation shape to match once content is ready

`src/common/settlementNames.ts` — `NAME_INSPIRATION_SOURCES: NameBank[]`, each entry:
```ts
{
  id: 'kebab-case-id',
  name: 'Display Name (sub-groups if bundled)',
  firstNamesMale: [common('X'), normal('Y'), rare('Z'), ...],  // ~20 male
  firstNamesFemale: [...],                                       // ~20 female
  firstNamesNeutral: [...],                                      // ~8 neutral
  lastNames: [...]                                               // ~24
}
```
`common()`/`normal()`/`rare()` are weight-3/1/0.4 helpers already defined in the file — match the existing regions' density/weighting style, not the Human bank's uniform-weight approach (Human is deliberately uniform across traditions; a single-tradition custom-race bank is meant to have "some names more common than others" flavor within itself, like every other existing region).

## Explicit next steps

1. ~~Visit FirstVoices, Ulukau, and Te Aka directly (like the earlier tribal .gov checks) — confirm authorship/sourcing before treating them as usable.~~ Done 2026-08-09, see below.
2. Bring the two open design questions above back to the user before writing any code.
3. Build incrementally, one nation/region at a time, each as its own reviewable commit — not one giant multi-culture batch.

## Direct source checks (2026-08-09)

- **FirstVoices** — confirmed genuinely Indigenous-authored: browsed live, individual language sites (e.g. Dakelh/Southern Carrier, run by Nazko First Nation) are populated by that community's own team, community-owned copyright per the footer. BUT structurally it's a dictionary/phrasebook, not a curated personal-name list — searching "name" mostly surfaced the *word* "name" plus example sentences that happen to use real community members' actual names ("my name is Doreen", "This man's name is Gary") — specific real individuals, not reusable content, and exactly the kind of thing the existing code comment already warns against. Coverage also varies enormously site-to-site (some have 1,500+ words, others likely near-empty — not checked exhaustively). **New finding not previously flagged**: the site footer states content is licensed for "private, non-commercial use" only, with any commercial use requiring the copyright owner's prior written authorization — worth resolving before treating FirstVoices content as usable in a shipped app, regardless of the ceremonial-naming question.
- **Ulukau / wehewehe.org (Hawaiian)** — confirmed legitimate: hosts the actual full text of Pukui & Elbert's 1986 *Hawaiian Dictionary* plus the 2020 Combined Hawaiian Dictionary, searchable cover-to-cover, under the University of Hawaiʻi-affiliated Ulukau partnership. Did not complete a live word-by-word lookup (the search widget on wehewehe.org is a finicky legacy GSDL interface that didn't cooperate with automated input), but the source's provenance and scope are confirmed from the site itself. Good fit for Option B (construct from verified roots) since it documents real vocabulary with real meanings, not just a headword list.
- **Te Aka Māori Dictionary** — confirmed via live search (searched "aroha" successfully through a direct search URL). Real dictionary entries with meanings/synonyms/usage examples, e.g. "aroha" = love/compassion/empathy. Also has "(personal name)" encyclopedia-style entries, but those are for specific real notable individuals (e.g. an entry for the late Dr. Merimeri Penfold, a real Ngāti Kurī scholar, 1924–2014) — not reusable, same concern as FirstVoices' example sentences. Good news for the naming project specifically: many genuinely common real Māori first names *are* literally ordinary dictionary words with documented meanings (Aroha = love is itself a very common real given name), which makes Option B/C unusually natural to execute well here compared to Native American/First Nations, where FirstVoices doesn't offer an equivalent ready path.

### What this changes about the recommended approach

- For **Pacific/Oceania**, both vetted sources (Ulukau/Pukui-Elbert for Hawaiian, Te Aka for Māori) are strong, direct-inspection-confirmed, academically authoritative dictionaries — Option B (construct names from documented word roots/meanings) looks like the best-supported path, since it's how many real Hawaiian/Māori names are actually formed.
- For **Native American/First Nations**, FirstVoices is confirmed legitimate but doesn't hand over a ready name list the way Ulukau/Te Aka effectively do — still likely need nation-by-nation vocabulary spelunking (Option B where a given FirstVoices site has enough documented vocabulary) or fall back to Option A/C (translated/constructed descriptive names), and coverage will vary a lot by which specific FirstVoices site is checked. The commercial-use restriction is a new open question to resolve regardless of format.

## Decisions (confirmed with user 2026-08-09)

- **FirstVoices: ruled out entirely**, not just deferred. The non-commercial-use restriction in the footer is treated as a hard stop, not something to negotiate around with paraphrased/transformed use. Native American/First Nations stays deferred — do not build it from FirstVoices, and do not restart on it without a new source proposal from the user.
- **Sequencing: Pacific/Oceania first.** Build Hawaiian and Māori now, on the strength of the two directly-confirmed academic dictionaries. Native American/First Nations remains parked.
- **Bank structure: separate banks, not one umbrella bank.** A standalone `hawaiian` bank and a standalone `maori` bank (own `id`, own `name`, own entry in `NAME_INSPIRATION_SOURCES`), each independently sourced and labeled — not a single blended "Pacific/Oceania" entry. Any additional Pasifika tradition added later (Samoan, Tongan, etc.) should also be its own bank once it clears the same sourcing bar, not folded into these two.

## Words directly verified so far (2026-08-09), by dictionary lookup

Methodology proven out: search the real dictionary, read the actual definition text, only use words that come back as genuine headwords with a documented meaning. Not yet a complete bank for either language — this is the verified subset so far, to build outward from.

**Hawaiian (wehewehe.org, Pukui & Elbert *Hawaiian Dictionary* 1986):**
- `aloha` — love, affection, compassion, greeting
- `kai` — sea, seaside, tide
- `koa` — brave, bold, warrior; also the koa tree
- `nalu` — wave, surf
- `mana` — supernatural/divine power, authority
- `lani` — sky, heaven; also "very high chief, majesty... most common in personal names, as Lei-lani, royal child or heavenly lei; Pua-lani, descendant of royalty or heavenly flowers" — **the dictionary itself cites Leilani and Pualani as real attested compound personal names**, a strong direct confirmation of the Option B approach for this language.
- `pua`, `mele`, `maile` — confirmed present as real headwords (flower / song-chant / a native fragrant vine used in lei) but full definition text not yet pulled through — safe, uncontroversial basic vocabulary, low risk.

**Māori (maoridictionary.co.nz, Te Aka):**
- `rangi` — sky, heaven, day
- `hine` — girl, daughter (term of address to a girl/young woman) — common name-element/prefix
- `moana` — sea, ocean
- `kahurangi` — precious, treasured, blue-green (also a light-green prized variety of greenstone)

## Where this stands / next actual step

Source vetting is done and both regions have a proven, working verification method (search the real dictionary → read the real definition → only use confirmed real words). User said "keep going now" (2026-08-09) — continued verifying words directly.

### Full verified word set so far (2026-08-09)

**Hawaiian (wehewehe.org / Pukui & Elbert, all individually looked up and read):** aloha (love/compassion), kai (sea), koa (brave/warrior; also the koa tree), nalu (wave), mana (supernatural power), lani (sky/heaven; also "high chief... most common in personal names, as Lei-lani... Pua-lani" — dictionary's own cited examples), ikaika (strong/powerful), haku (lord/master), noa (freed of restriction, common/ordinary), aliʻi (chief/royal), nani (beauty), mauli (life/life force), hōkū (star), momi (pearl), kiele (gardenia), ʻilima (native flower, official flower of Oʻahu), plus pua/mele/maile/lei confirmed present as real headwords (flower / song-chant / a native fragrant vine / garland — some of the best-known Hawaiian words in existence, definitions not individually re-typed but presence confirmed same way as the rest).

**Māori (maoridictionary.co.nz / Te Aka, all individually looked up and read):** aroha (love/compassion), rangi (sky/heaven/day), hine (girl/daughter, term of address), moana (sea/ocean), kahurangi (precious/treasured, prized greenstone), wai (water), tāne (man/husband — also the name of the atua of forests), wahine (woman), ariki (paramount chief), marama (moon), whetū (star), manu (bird), huia (a prized, now-extinct native bird with treasured feathers), ao (dawn/world/day), tūī (a native songbird).

### Open question: the "surname" category

Neither Hawaiian nor Māori had Western-style inherited surnames before sustained European contact — this is the same shape of problem the doc already flagged for Native American/First Nations, just not as severe. Three options considered, none yet applied:
1. Invent new two-word compounds from verified roots (e.g. "Kai-lani") — risk: getting Hawaiian/Māori compounding grammar wrong even with real root words is its own form of the "treats the language superficially" problem this whole project has been trying to avoid.
2. Use real historically-attested family surnames — same "real specific lineage" ethical concern already raised about the BIA census rolls.
3. **Recommended**: use the same verified single words directly as the surname pool too (no invented compounding) — defensible because Hawaiian family names historically often did come from converting a meaningful existing word or a person's own name into a registered surname (post-Māhele land registration), so a real single dictionary word functioning as a "surname" isn't inventing a new pattern, and it sidesteps both risks above. Not yet confirmed with the user.

Nothing has been written to `settlementNames.ts` yet — still pending the user's call on the surname approach above, and a final look at the compiled draft.

### Surname decision (confirmed with user 2026-08-09): try verified compounds, don't self-construct

Found real dictionary-attested two-word compounds by using wehewehe.org's "All entries containing this word" search on `lani` and `hōkū` — these surfaced actual headwords already in Pukui & Elbert's dictionary, not anything self-combined:

- **Leilani** and **Pualani** — directly cited by name in the `lani` dictionary entry itself as personal-name examples ("Lei-lani, royal child or heavenly lei; Pua-lani, descendant of royalty or heavenly flowers")
- **pua lani** (D18836) — real headword, "descendant of [royalty]..."
- **wai lani** (D20687) — real headword, "rain water" (lit. heavenly water)
- **loke lani, roselani** (D11314) — real headword
- **wao lani** (D20884), **papa lani** (D17247) — real headwords
- **hōkū kai**, **pua hōkū** — real headwords found via a "hoku" contains-search

That's 8 solid, individually-attested compounds for the Hawaiian surname pool — smaller than the ~24 in the existing 9 regions, but each one is a real dictionary entry, not something constructed this session. Did not yet run the equivalent bulk "contains" search for Māori compounds (only spot-checked a few names encountered incidentally while searching `hine` and `rangi` earlier: Hine-moana, Rangi-nui, Whakaahu rangi — some of these are major-deity names, which raises a different concern than reusing an ordinary word: putting a primal atua's actual name on a random generated NPC surname reads differently than reusing "Leilani"-style ordinary compound vocabulary, closer to using "Odin" as a generic surname in the Nordic bank, which that bank deliberately does not do). **Māori surname research is the one piece not yet finished.**

### Status: both banks shipped (2026-08-09)

- **Hawaiian bank: done.** Added as `id: 'hawaiian'` in `NAME_INSPIRATION_SOURCES` in `src/common/settlementNames.ts` — 5 male / 7 female / 8 neutral firstnames + 8 lastNames, all individually sourced from Pukui & Elbert's *Hawaiian Dictionary* via wehewehe.org, lastNames are real attested compounds (not invented — found via the dictionary's own "contains" search on `lani` and `hōkū`).
- **Māori bank: done.** Added as `id: 'maori'` right after it — 4 male / 5 female / 6 neutral firstnames, all individually sourced from Te Aka (maoridictionary.co.nz, John C. Moorfield). lastNames use a different approach than Hawaiian's: Te Aka didn't have an equivalent "ordinary compound word" seam to mine, so this leans on minor/secondary personifications (a sea atua, a tree spirit, a moth/flute-music atua, a mist personification, two astronomical personifications) — explicitly excluding primal creator-deities (Rangi-nui, Tāne, Hine-nui-te-pō) and the one real historical named individual (a specific 1910–1976 military leader) that turned up in the same searches. This tier was confirmed acceptable with the user before writing it into code.
- Both entries pass `npx tsc --noEmit` clean. Neither is yet blended into `BASELINE_NAME_BANKS`'s Human entry (that's the optional second step the doc's Goal section describes, deliberately left for later/separate confirmation, same as how west-asian was sequenced).
- Native American/First Nations stays parked (see Decisions section above) — do not resume without a new source proposal from the user.
- Not yet committed to git — user said to keep working and commit everything together at the end of the session.
