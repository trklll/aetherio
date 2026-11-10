# Sports app — independent finish review

## Disposition
**SHIP** within the existing development-only availability. No material requirement violation or extension-induced craft regression found. This is a local extension of the incumbent interface, not a redesign.

## Evidence checked
- Read `PRODUCT.md`, `.impeccable/surfaces/sports-app.md`, and Impeccable's craft floor/polish guidance. The existing rail component/CSS is the visual authority; missing `DESIGN.md` is not a blocker or authorization to repair global documentation.
- Visually inspected **every required image**: `desktop.png` (1920×1080), `user-1280.png` (1280×720), `minimum.png` (900×600), `mobile.png` (390×844 diagnostic), and `transition.png`. The expanded rail is complete and readable at shipped sizes; the transition has an opaque cover and centered, undistorted Sports logo.
- Checked `SportsApp.tsx`, `SportsRail.tsx`, `sportsMode.ts`, shared rail implementation/styles, transition implementation/styles, scoped integration diffs, button mappings, and relevant Playwright assertions in `e2e/sports-home.spec.ts` and `e2e/sports-team-page.spec.ts`.
- Independently ran `npx vitest run src/utils/sportsMode.test.ts src/utils/bigPictureTransition.test.ts`: **2 files / 12 tests passed**.
- Parent-reported evidence (not rerun here): release TypeScript and Vite build passed; latest scoped Playwright run **13 passed**; changed-TSX detector returned `[]`.

## Requirement/craft findings
**No material findings.**
- `SportsRail.tsx:7–19` reuses `BigPictureRail`, keeps its original profile/avatar/clock, puts **Volver a Aetherio** first in the menu, removes platforms/IPTV only from this sidebar, and targets existing sections and sports-scoped profile settings. All four layout captures corroborate the header and complete menu; footer IPTV remains covered by the existing-flow test.
- `SportsApp.tsx:5–17` reuses the existing home, team and settings screens under `/big-picture/sports`; unknown sports routes return to its home. `BigPicture/index.tsx` preserves the main Deportes entry and development gate.
- `GamepadWakeListener.tsx:64–86`, `useGamepad.ts:313–320`, and `inputActions.ts` separate **F9 / Xbox View/Back index 8** from ordinary **B index 1** and retain **F10 / Start index 9**. `sportsMode.ts:13–28` records the originating desktop/TV mode for the dedicated return flow.
- `bigPictureTransition.ts` uses the supplied root `AetherioSportsLogo.png` through the existing GSAP transition and reduced-motion path, without a second animation system. `transition.png` confirms the intended branded cover.

## Required fixes
None for this extension. No production code, supplied asset, unrelated changes, staging, or commits were modified by this review.

## Limits
Static screenshots and source review; no live browser, physical Xbox controller, native WebView2/mpv playback, or independent end-to-end rerun. Captures use fixture content and the expanded navigation state, not every loading/error/profile-length state; exact contrast was not measured live. The 390px capture clips existing wide sports content, but it is diagnostic and outside the shipped Windows minimum width of 900px, not an extension blocker. Build/E2E results above remain explicitly parent-reported; unrelated pre-existing dirty work was excluded.
