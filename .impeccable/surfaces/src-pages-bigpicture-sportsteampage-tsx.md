---
version: 1
slug: "src-pages-bigpicture-sportsteampage-tsx"
primary_target: "src/pages/BigPicture/SportsTeamPage.tsx"
related_targets: ["src/pages/BigPicture/SportsTeamPage.css", "src/services/sportsTeamOverview.ts"]
---
## Scope and visitor mode
Operate. Direct team pages instead of the club modal; retain Añadir and the favorites editor. The user now explicitly requests a free local MVP using FotMob, no ESPN requests, and optional Wikidata enrichment. Prioritize actual working data, not a frontend redesign. Preserve existing TV shell, local profiles and playback.

## Direction contract
THESIS: Activate a followed team and immediately read its table, not an options dialog.
OWN-WORLD: Inherit the existing dark TV shell, type, large focus rings and real local crests; charcoal content surface and neutral selected navigation.
STORY: Read the club identity and league position, switch between standings, last published lineup, squad, matches and sourced honours. Missing coverage is not zero.
FIRST VIEWPORT: Back/retry controls, 128px crest beside club name, position/points/played when known, five visible section buttons, full-width standings table with the club highlighted.
FORM: User-specified functional extension, code-led; seed key not rolled (pinned task). Tables retain horizontal overflow at narrow widths, lineup becomes one column. Existing rail remains untouched.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Data constraints
FotMob is unofficial and used only for the local MVP. No subscriptions, trial plans, API credentials, anti-bot bypasses or ESPN fallback. Desktop requests reuse native HTTP; browser development uses fixed-host Vite proxies. Five-minute bounded cache and in-flight deduplication. Four explicitly checked club identities; unique exact-name search elsewhere. Peru annual/Apertura/Clausura tables stay separate. Scorer statistics override placeholder roster zeroes. Last-lineup match is joined by exact ID. Local verified United honours take precedence; FotMob trophies are always labelled partial. Wikidata is independent optional club metadata with a 24-hour cache and explicit identities, not an authoritative replacement for sports results or historical title totals. Provider permissions for production redistribution remain unresolved.

## Finish record
2026-11-06: finish reviewer scored the responsive header finding resolved and returned SHIP, scoped to that finding, after inspecting refreshed 1920/900/390 captures. See `.impeccable/review/sports-team-page/finish-review.md` and `documentation-review.md`. Fourteen unit tests, nine related Playwright tests, release TypeScript check passed; two page-specific Playwright tests passed again after the responsive fix. Mechanical detector returned no findings. No shipping raster assets created. Existing global DESIGN.md gap preserved, not repaired.

2026-11-06 (FotMob replacement): 23 unit tests and all 11 related Playwright tests passed, including a live check against City, United, Alianza and Grau. An additional live repeat also passed with explicit real Wikidata identity validation and captures of Alianza lineup, player photos and partial honours. TypeScript release check passed; mechanical detector returned `[]`. Reviewer disposition SHIP for the local MVP only, not production redistribution; see `fotmob-finish-review.md` and `fotmob-documentation-review.md` in the same review directory. A dubious Wikidata foundation year is not auto-published: enrichment remains source-attributed and non-authoritative. Existing UI world preserved; no shipping raster assets added.
