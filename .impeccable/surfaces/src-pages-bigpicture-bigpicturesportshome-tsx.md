---
version: 1
slug: "src-pages-bigpicture-bigpicturesportshome-tsx"
primary_target: "src/pages/BigPicture/BigPictureSportsHome.tsx"
related_targets: ["src/pages/BigPicture/SportsMatchCard.tsx", "src/pages/BigPicture/SportsMatchCard.css", "src/pages/BigPicture/SportsReplaysRow.tsx"]
---

## Scope and visitor mode
Operate. Sports match cards in TV/Big Picture, including live, upcoming and replay catalogs. The user confirmed TV only, preserving catalogs, navigation and playback. Enable Sports in development (`npm run tauri dev`), not in the production release.

## Direction contract
THESIS: Recognize the two opponents before opening a match. Replace addon match posters with two real crests on their own color fields; never mistake broadcaster branding for a team.
OWN-WORLD: Extend the incumbent dark Aetherio TV canvas, horizontal virtualized rows, white focus outline and existing typography. Colors belong to teams, not a new app theme. Use the existing local insignia and identity registries first.
STORY: Read the opponents, match title, then the known status/schedule and competition. Activate with mouse, keyboard or controller; source selection remains available. Unknown or failed crests become initials, not invented logos.
FIRST VIEWPORT: Preserve the current hero and row geometry. Each card has two centered, uncropped crests separated diagonally. Title and secondary metadata remain visible below the artwork, never over the teams. Channel cards and the rest of Home stay unchanged.
FORM: User-pinned reference, local extension; seed key: not rolled (precisely specified component). Code-led implementation of the supplied reference, no generated artwork. Windows desktop/TV at 1280 and 1920; retain the app's existing minimum-window behavior.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions
None. No new asset downloads, provider APIs or redesign of the rest of TV mode.

## Finish record
Reviewed 2026-11-06: `ship` for the TV match-card extension at Windows/TV window sizes. Evidence and the exact scope are in `.impeccable/review/sports-match-cards/finish-review.md`; checks and the incumbent-system comparison are in `documentation-review.md`. Nested delegation was unavailable, so both passes used the shipped degraded protocols in-thread. This ordinary extension preserves the existing visual system; the pre-existing missing global DESIGN.md is not repaired as a side effect. No shipping raster assets were added or modified.
