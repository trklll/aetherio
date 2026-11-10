# Mis equipos verification

2026-11-06. No commits created; existing unrelated working-tree changes were preserved.

## Passing checks
- `npx tsc --noEmit -p tsconfig.json` — passed.
- `npx vitest run src/pages/BigPicture/sportsTeams.test.ts src/pages/BigPicture/sportsHome.test.ts src/data/sports/preferences.test.ts` — 2 suites / 19 tests passed. The third path has no matching suite; no separate preference-suite pass is claimed.
- `npx playwright test e2e/sports-my-teams.spec.ts --grep-invert capturas --workers 1` — 6/6 passed after correcting the test to switch through the real profile API instead of changing the obsolete legacy active-profile key.
- The new capture test passed in the preceding run; all nine final screenshots were opened and checked. Total new spec coverage: 6 functional tests + 1 successful capture test.
- Three existing related E2Es passed: composed TV cards/source dialog; replay crests; top entry/scroll restoration.
- Impeccable detector over SportsTeamsRow.tsx, SportsTeamsRow.css and BigPictureSportsHome.tsx — `[]`; run once.
- `git diff --check` — passed, with existing CRLF normalization warnings only.

## RED evidence
- The new unit suite initially failed to resolve the intentionally unimplemented sportsTeams module.
- The first new E2E executed and failed because the row-title sequence lacked Mis equipos. It subsequently passed unchanged in intent.

## Unresolved existing-test setup
`npx playwright test e2e/sports-home.spec.ts --grep 'encabeza Sports' --workers 1` fails at setupUpcomingSchedule's existing assertion on line 106: no sports-upcoming row is produced after registering the local upcoming fixture and clicking Actualizar agenda. It fails before reaching the updated row-order assertion. No change to the agenda/provider implementation was made in this task, and this report does not claim the broader Sports suite passes. This failure was reproduced in isolation after an initial parallel test run also conflicted over Playwright's shared output artifacts.

## Scope
Second row after the first available event catalog; if there are no event catalogs, Mis equipos remains available before Repeticiones rather than inventing an empty match row. Onboarding remains unchanged. Team selections save to the current profile's existing preferences, preserving competition/sport/organization/fighter selections. No favorites are inferred from the example or from competition follows by this new row. Existing onboarding may already have explicitly populated followedClubs; those saved IDs are treated as the user's existing selection.

The UI review disposition is `ship` at the new-row visual scope; see finish-review.md. It is an in-thread degraded review, not an independent subagent approval.
