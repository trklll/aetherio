No global design-system changes. Checked PRODUCT.md, the Sports surface brief, src/index.css, BigPicture.css, BigPictureSportsHome.css, CatalogRow.tsx, SportsMatchCard.tsx and SportsMatchCard.css. DESIGN.md and .impeccable/design.json were absent before this ordinary extension and remain untouched. Documentation review used the degraded in-thread protocol because nested delegation was unavailable.

Palette: incumbent dark Aetherio canvas; opponent colors from provider/identity data, with stable fallback colors.
Type ramp: inherited TV font; card title 16px/600, metadata 14px, initials 40px, non-match event label 28px.
Geometry: existing 425×248px row artwork, 12px corners, 112px contained crests; captions start 12px below.
Interaction rule: explicit 3px white card/source focus outlines, controller activation and source selection; reduced motion removes movement.
Identity rule: verified local crests first, provider crest fallback, then initials; no addon-composed match posters and no invented opponents for solo events.

Not canonized or repaired: pre-existing absent global design documentation; the app-wide outline reset requiring a scoped Sports override; unsupported sub-900px TV layout. These are not authorization for a global visual-system rewrite.

## Verification
- 75 unit tests passed across sportsMatchCards, sportsHome, sportsReplaysService, insignia and identity. The new engine and tests live in src/utils/ because the existing src/data/sports directory has a local Git exclusion; no ignore policy was changed.
- 24 Playwright Sports home/rail tests passed. The final capture test was rerun successfully after adding top-of-document and 390px diagnostic evidence.
- `npx tsc -p tsconfig.release.json --noEmit` passed.
- Vite production build passed in the approved temporary directory, without overwriting the user's dist.
- Production browser checks passed: Sports redirects to Big Picture, no Sports rail item, Sources settings unchanged.
- Four nuvio_server tests and three sports_assets tests passed in the debug native build with process-scoped `TAURI_CONFIG={"bundle":{"resources":[]}}`; the previous environment value was restored. The default build attempt hit Windows error 32 on resource copying. No existing process was closed.
- Mechanical detector ran once; only the pre-existing comment false-positive described in finish-review.md was reported.
- `git diff --check` passed for the task's changed tracked files. No commits were created and unrelated changes were preserved.
