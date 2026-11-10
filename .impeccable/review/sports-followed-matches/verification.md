# Verification — followed-team match page

2026-11-07. Working tree already contained substantial user/other-session work. No commit, reset, revert, dependency install, paid service or account signup was performed.

- RED: new tests initially failed because the followed-fixtures/decimal-odds modules were absent and the adapter discarded opponent IDs/competition. A second targeted RED reproduced canonical-alias duplication and the real FotMob `tournament` shape.
- GREEN: `npx vitest run src/pages/Sports/followedFixtures.test.ts src/utils/sportsOdds.test.ts src/services/sportsTeamOverview.test.ts src/pages/BigPicture/sportsTeams.test.ts src/utils/sportsTime.test.ts` — **36 passed**.
- `npx playwright test e2e/sports-followed-matches.spec.ts --workers=2 --grep-invert capturas` — **7 passed**, covering dedicated routing, three periods, shared-match deduplication, collapse, detail links, empty/error/partial states, existing selection editor, keyboard/cruceta, Sports rail entry and profile changes.
- The capture test passed in both bounded visual rounds, writing desktop, 900px and 390px windows for Hoy and Próximos. Initial screenshot missing pending crests was corrected by waiting for images. No UI polishing after the second capture round.
- Intermediate expanded E2E run found cold Vite lazy-load timing and a rail test clicking before the old route had actually finished transitioning. The test now waits on the destination page/current-section affordance and permits a 30s cold mount, rather than changing shared navigation. A loader test was corrected because the current catalog has no basketball club entity to use as a fixture. These failures are not hidden as successful runs.
- `npx tsc -p tsconfig.release.json --noEmit` — pass, including the final production code.
- `npx vite build` — pass (25.10s). Existing Browserslist age and large-chunk advisories remain. This is the existing production configuration; Sports development gating was not changed.
- `impeccable.cmd detect --json` over the new page/component, CSS and fixture helper — **[]**, run once.
- `git diff --check` over affected paths — pass; Git emitted only its line-ending normalization advisories.
- Coverage percentage not measured: @vitest/coverage-v8 is not installed, and no dependency was added to obtain it.

## Live-source check and odds limitation

Consulted on 2026-11-07:

- https://www.fotmob.com/api/data/teams?id=6398 — a normal public read succeeded; actual fixtures publish `tournament.name` / `tournament.leagueId`, `home.id` and `away.id`. Added adapter coverage for that real shape. The endpoint is unofficial and not guaranteed stable; this is not a redistribution-license grant.
- https://the-odds-api.com/ — advertises Starter **FREE, 500 monthly credits**, all sports/most bookmakers, decimal and American formats. Requires an API key. No key was supplied, no plan activated and no request to an authenticated odds endpoint was made. Full intended league coverage and redistribution terms were not verified.

The user must be told that live odds are not integrated yet. `sportsOdds.ts` provides tested explicit American-to-decimal conversion (-145 → 1.69, +150 → 2.50, -380 → 1.26); it is not connected to a production feed. The UI states that odds are unavailable instead of showing sample values as real prices. No scraping or access-control bypass was attempted.
