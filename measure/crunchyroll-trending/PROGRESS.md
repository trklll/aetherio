# Crunchyroll trending

Phase: COMPLETE. Implementation and targeted verification finished; no commit
has been created.

## Final behavior

- “En tendencia ahora” is the first catalog section after the Crunchyroll hero.
- No pagination marks/dots are rendered beside the heading.
- Results render through the shared `CatalogRow` with the normal Aetherio/BTTTR
  poster route after AniList IDs are resolved to TMDB.
- The internal row name is `Anime`, so it does not activate Top/ranked formatting.
  There is no rank numbering or purple “Airing” badge.
- PC uses the standard row scroll and arrows. Big Picture uses season-style genre
  tabs with LB/RB genre switching and no custom genre arrows. ArrowUp from the
  first trend row restores the page top so the platform hero is visible.
- Genre tabs align with the catalog gutter. Selecting a genre scrolls only the
  tab rail and keeps the selected pill inside the safe area; “Todos” explicitly
  returns the rail to its starting position.
- Genre tabs keep “Todos” first and sort the remaining Spanish labels
  alphabetically; “Chicas mágicas” is excluded.
- The trending section no longer adds extra bottom margin before the next catalog.
- The section remains Spanish and other streaming platforms are unchanged.

## Verification

- `npx vitest run src/navigation/spatialNav.test.ts src/services/anilistTrending.test.ts`:
  24 passed.
- `npx playwright test e2e/crunchyroll-trending.spec.ts --workers=2`: 10 passed,
  covering placement, genres/cache, standard card behavior, detail navigation,
  tab alignment and reset, catalog spacing, Big Picture scroll-to-hero, narrow
  viewports, retry, and platform isolation.
- `npx tsc -p tsconfig.release.json --noEmit`: passed.
- `npx vite build --logLevel warn`: passed. Existing warnings note stale
  Browserslist data and chunks larger than 500 kB.
- Existing `e2e/streaming-platform-navigation.spec.ts` scroll-to-first-row check
  passed; its combined navigation test currently fails earlier because its test
  fixture does not produce the expected collection button.
- Browser geometry checks verify the tab gutters, active-tab safe area, “Todos”
  reset, and next-catalog gap at 1280×900; the existing narrow-viewport rail
  test also passes. No pixel-diff claim is made: artwork is time-dependent.
- `git diff --check`: passed; Git emitted LF-to-CRLF normalization notices for
  files already present in the working tree.
