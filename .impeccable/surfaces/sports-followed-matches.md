---
version: 1
slug: "sports-followed-matches"
primary_target: "src/pages/Sports/SportsMyTeamsPage.tsx"
related_targets: ["src/pages/Sports/SportsMyTeamsPage.css", "src/pages/Sports/followedFixtures.ts"]
---

## Scope and visitor mode
Operate. The user explicitly requests a dedicated Mis equipos page for matches of followed teams. Inherit Aetherio's existing grey canvas, liquid-glass table material, typography, team insignia and desktop/gamepad navigation. Reference screenshots pin the matchup structure and Ayer / Hoy / Próximos tabs only; green is expressly forbidden.

## Direction contract
THESIS: A single readable match schedule for the user's own teams, never a fixed list from the reference.
OWN-WORLD: The established #1f1f1f Aetherio ground and incumbent liquid-glass panels; restrained white, grey rules, real local insignia and tabular numerals. No team-colored ambient background.
STORY: Enter Mis equipos from Sports navigation, switch calendar periods, recognize followed clubs by a star, read actual kickoff or result, and open a team's existing detail page. Preserve the favorites shelf and its selection editor.
FIRST VIEWPORT: Compact Mis equipos heading below the existing navigation band; one broad neutral table panel with three equal-width tabs above dated groups. Each matchup has competition, mirrored crest/name columns and a central time/result. Narrow windows reflow without changing the information hierarchy.
FORM: User-pinned reference adapted to the existing desktop app; code-led local extension, seed key: not rolled (precisely specified request). No new visual world or asset generation.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Data constraints
Reuse FotMob team overviews and existing canonical live/agenda events. Deduplicate shared fixtures, use America/Lima calendar dates, isolate profiles, and retain partial data on individual team failures. Never guess missing competitions, records, times or odds. The Odds API advertises 500 free monthly credits and decimal prices but requires a key; no signup, paid service, scraping workaround or fabricated sample odds is authorized.

## Finish record
2026-11-07: `ship` for the page/table increment after two bounded visual rounds. Nested review delegation hit the harness depth limit; the shipped degraded finish-review and documenter protocols were applied in-thread. Review, incumbent-system comparison and exact verification evidence are under `.impeccable/review/sports-followed-matches/`. Final checks: 36 unit tests, 7 interaction E2E tests plus the successful capture test, TypeScript and Vite build. Odds feed integration remains explicitly pending a real free source/key; conversion support is tested but no numerical production odds are claimed. No shipping rasters or global design-system changes were made.
