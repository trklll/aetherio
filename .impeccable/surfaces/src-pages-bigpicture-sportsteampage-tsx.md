---
version: 1
slug: "src-pages-bigpicture-sportsteampage-tsx"
primary_target: "src/pages/BigPicture/SportsTeamPage.tsx"
related_targets: ["src/pages/BigPicture/SportsTeamPage.css", "src/services/sportsTeamOverview.ts"]
---
## Scope and visitor mode
Operate. User requests direct team pages instead of the club modal; explicitly retains Añadir and the favorites editor. New ESPN endpoints authorized by this request. Preserve existing TV shell, local profiles and playback.

## Direction contract
THESIS: Activate a followed team and immediately read its table, not an options dialog.
OWN-WORLD: Inherit the existing dark TV shell, type, large focus rings and real local crests; charcoal content surface and neutral selected navigation.
STORY: Read the club identity and league position, switch between standings, last published lineup, squad, matches and sourced honours. Missing coverage is not zero.
FIRST VIEWPORT: Back/retry controls, 128px crest beside club name, position/points/played when known, five visible section buttons, full-width standings table with the club highlighted.
FORM: User-specified functional extension, code-led; seed key not rolled (pinned task). Tables retain horizontal overflow at narrow widths, lineup becomes one column. Existing rail remains untouched.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Data constraints
ESPN is unofficial, cached five minutes, failures isolated by section. Only exact unique team/alias matches. No guessed future lineup. Honours stored separately with source and verification date; coverage currently Manchester United only. No database or licensed API credentials configured by this task.

## Finish record
2026-11-06: finish reviewer scored the responsive header finding resolved and returned SHIP, scoped to that finding, after inspecting refreshed 1920/900/390 captures. See `.impeccable/review/sports-team-page/finish-review.md` and `documentation-review.md`. Fourteen unit tests, nine related Playwright tests, release TypeScript check passed; two page-specific Playwright tests passed again after the responsive fix. Mechanical detector returned no findings. No shipping raster assets created. Existing global DESIGN.md gap preserved, not repaired.
