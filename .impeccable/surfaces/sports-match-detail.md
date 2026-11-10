---
version: 1
slug: "sports-match-detail"
primary_target: "src/pages/Sports/SportsMatchPage.tsx"
related_targets: ["src/pages/Sports/SportsMatchSurface.tsx", "src/pages/Sports/SportsMatchPage.css", "src/pages/Sports/SportsFlag.tsx", "src/pages/Sports/SportsFlag.css", "src/pages/Sports/SportsMyTeamsPage.tsx", "src/pages/BigPicture/SportsMatchCard.css", "src/components/layout/ShellDetailPreview.tsx"]
---

## Scope and visitor mode
Operate. A precise reference-pinned extension of Sports, not a redesign. Keep the neutral agenda, existing Sports rail, profile isolation, actual fixtures, real competition tables, current Play icon and playback flow. Each whole matchup row, not its crests, opens the existing TV shell carousel for that date. No team chooser on the agenda, following action or share icon in a matchup.

## Direction contract
THESIS: A matchup is the unit of exploration: schedule row → incumbent shell carousel → expanded match page → existing playback, never a new carousel implementation or a team-detail detour.
OWN-WORLD: Existing Aetherio type, liquid-glass panel material, white/grey hierarchy and actual insignia. The detail's two crest-derived team colors become woven cloth, as explicitly pinned by the user; the schedule remains neutral.
STORY: Read a kickoff/result, select the whole matchup, browse same-date matches, expand, inspect actual standings, and choose Ver partido when a real source is available. No invented records, odds or playback success.
FIRST VIEWPORT: Centered calendar date, competition, mirrored large crests with team names and published records, central kickoff, then Ver partido with the existing filled Play icon. Below: honest odds availability and standings with participants subtly highlighted. Keep all controls usable in narrow windows and on keyboard/gamepad.
FORM: User-pinned screenshot composition inside the established world; code-led precise local extension, seed key: not rolled. No asset generation or new global visual identity.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Motion thesis
The matchup preview and expanded detail share one authored motion: gentle physical cloth folds traveling from the pinned left hoist toward the right, with fixed foreground crests/text. WindyCloth-derived Verlet physics runs at fixed 60 Hz with bounded catch-up on a 32×20 grid; a reusable 96×60 bicubic mesh supplies smooth geometric normals. The entire viewport remains covered, with no visible external hem or violent right-side curls. The selected shell layer owns one canvas from the first card morph through iframe reveal, expansion and collapse; the transparent, inert iframe never mounts a second flag and only gains interaction after expansion. Neighboring matches stay still. The shell's compact native backing size is established before the morph and does not reallocate per tween frame; it changes once after expanded bounds settle. Native Full HD remains native, with a 2048×1440 backing cap and DPR ≤2. Pause hidden/offscreen and honor reduced motion dynamically; without WebGL retain the readable palette gradient. Existing TV shell expansion/collapse remains untouched.

## Finish record
2026-11-07: Physical-cloth replacement, rightward gentle motion, native-resolution optimization and shell-owned animation continuity are documented in `.impeccable/review/sports-match-detail/flag-physics-review.md`, including discarded low-resolution variants, software-renderer measurements, screenshots and verification limits.
2026-11-07: Finish review requested one material contrast fix; the verdict scored it resolved (`ship` at that fix-list scope). Nested reviewer/documenter delegation hit the harness depth limit, so the shipped degraded protocols were applied in-thread and disclosed. Review, verdict, documentation comparison and exact verification limits are under `.impeccable/review/sports-match-detail/`. No new global design system or shipping raster was introduced. The two older silent-retry notice assertions remain explicitly outside this visual increment.
