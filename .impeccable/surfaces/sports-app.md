---
version: 1
slug: "sports-app"
primary_target: "src/pages/Sports/SportsApp.tsx"
related_targets: ["src/pages/Sports/SportsRail.tsx", "src/pages/BigPicture/BigPictureRail.tsx", "src/pages/BigPicture/index.tsx", "src/pages/BigPicture/BigPictureSportsHome.tsx"]
---

## Scope and visitor mode
Operate. Existing development-only Deportes becomes an app inside Aetherio, preserving its entry in the main sidebar, current screens, profile data, providers and playback. User confirmed preserving the current design. Follow-up: reuse the mode transition with the supplied AetherioSportsLogo.png, enter/toggle with F9 or Xbox View/Back (8), keep the original profile header and remove IPTV from the sidebar only.

## Direction contract
THESIS: Separate sports navigation without duplicating its features or redesigning Aetherio.
OWN-WORLD: Reuse the incumbent Big Picture rail, materials, typography, focus indicator and controller behavior. No new assets or visual tokens.
STORY: Enter Deportes from the menu, F9 or Xbox View/Back. The existing cinematic mode transition presents the user's Sports logo. Leave through Volver a Aetherio or the same shortcut; preserve the originating desktop/TV display mode. Start/F10 still toggles TV normally.
FIRST VIEWPORT: Keep the current live/upcoming and Mis equipos rows. Remove the Repeticiones row and its sidebar entry. The collapsed sports navigation occupies the current rail position. Expanded, it retains the original profile/avatar/clock header; its first menu button is Volver a Aetherio, followed by Inicio, Mis equipos and Personalizar. No streaming platforms or IPTV menu entry; existing IPTV controls inside Deportes remain available.
FORM: Precisely specified local extension, code-led; seed key: not rolled. Sections link to existing rows and controls; team and reused profile-settings pages retain sports navigation. Reuse GSAP mode transition and reduced-motion behavior, with no second animation system.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions
None. Preserve development-only availability. No global design documentation repairs.

## Finish record — 2026-11-07
- **SHIP**: independent `../review/sports-app/finish-review.md`; reuse/provenance and validation chronology in `../review/sports-app/documentation-review.md`.
- Incumbent `BigPictureRail`/rail CSS, sports screens/settings and GSAP mode transition/CSS reused; no new visual world/tokens. Inicio uses the exact shared `HomeBoldIcon` from Aetherio's main sidebar, with no new SVG. Root user-supplied `AetherioSportsLogo.png` imported unchanged; no generated/downloaded/modified rasters.
- Latest icon correction: parent-reported release TypeScript and 2 Playwright tests PASS; layout captures regenerated. Earlier extension: 13 Playwright, 31 Vitest and Vite build PASS (Browserslist/chunk warnings), detector `[]`; independent reviewer ran 12 passing Vitest tests.
- Pre-existing missing root `DESIGN.md` remains reported drift, not repaired; neither it nor `.impeccable/design.json` was created/changed. This Finish record does not claim global documentation completeness.
