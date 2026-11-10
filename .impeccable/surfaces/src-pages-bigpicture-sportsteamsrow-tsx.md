---
version: 1
slug: "src-pages-bigpicture-sportsteamsrow-tsx"
primary_target: "src/pages/BigPicture/SportsTeamsRow.tsx"
related_targets: ["src/pages/BigPicture/SportsTeamsRow.css","src/pages/BigPicture/sportsTeams.ts"]
---

## Scope and visitor mode
Operate. Extend the existing Sports home with a second horizontal row named “Mis equipos”. The user confirmed that it must contain their selected teams, not the example's fixed Liverpool/Ajax/Real Madrid selection. Preserve all existing match rows, providers, playback, personalization and profile isolation.

## Direction contract
THESIS: A recognizable shelf of the user's own teams, even when no matches are available. Do not infer favorites from the screenshot or followed competitions.
OWN-WORLD: Preserve the incumbent TV shell, typography, gutters and spatial navigation. Follow the reference's neutral translucent charcoal 16:9 tiles, single centered real crest, external title and muted schedule; the final tile carries a thin plus and “Añadir”.
STORY: Recognize selected clubs and national teams; read their real next match or an honest unavailable state. Activate a team to see its known matches; use Añadir to change team follows without restarting onboarding.
FIRST VIEWPORT: Existing first event row, then Mis equipos, then the remaining Sports rows. Team tiles share the existing 425px rail stride and 26px gaps, with uncropped centered 128px insignia containers. Keep the current ambient canvas untouched.
FORM: Precisely specified local extension, code-led; seed key: not rolled (user-pinned reference). Native desktop/TV widths 1920, 1280 and 900; check the existing 390px minimum-window behavior without inventing mobile support.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints
Reuse profile-scoped sports preferences, local verified insignia, native SportsDialog focus trap and horizontal virtual-window navigation attributes. No generated/downloaded assets, new provider endpoints, global design-system edits or unrelated cleanup.

## Finish record
2026-11-06: `ship` at the local row's visual scope after two bounded capture rounds; evidence and the five-section review are in `.impeccable/review/sports-my-teams/finish-review.md`. Nested delegation was rejected by the harness depth limit, so review and documentation used the shipped degraded protocols in-thread. The incumbent design-system comparison is in `documentation-review.md`; checks and the unresolved existing agenda-fixture test are in `verification.md`. This ordinary extension does not repair the pre-existing absent global DESIGN.md or change the incumbent minimum-window policy. No shipping raster assets were added or modified.
