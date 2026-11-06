# Sports team page — FotMob documentation review

Date: 2026-11-06. **Documentation complete for the local MVP data integration.** This is an ordinary extension of the incumbent Big Picture interface, not a redesign or global design-system change.

## Evidence and scope

Read `PRODUCT.md`, `.impeccable/surfaces/src-pages-bigpicture-sportsteampage-tsx.md`, `docs/sports-team-data-mvp.md`, `src/pages/BigPicture/SportsTeamPage.tsx`, `src/pages/BigPicture/SportsTeamPage.css`, the incumbent `src/pages/BigPicture/BigPictureSportsHome.css`, and `C:/Users/Administrator/.config/opencode/skills/impeccable/reference/document.md`. Existing documentation and FotMob finish reviews supply historical context.

This source-based review documents preserved visual conventions, provider-facing copy and provenance. It does not claim fresh browser, native-Tauri, controller or accessibility verification. Its current FotMob/Wikidata notes supersede the ESPN-specific provenance paragraphs in the earlier `documentation-review.md`; that historical file remains untouched.

## Preserved tokens, layout and navigation

- The page retains its charcoal surface (`#181b20`), bright text (`#f8f9fa`), muted metadata (`--team-muted: #c5c8cd`) and translucent separators (`--team-line: rgb(255 255 255 / 16%)`). These are observed page-local values, not newly promoted global tokens.
- Typography still inherits the application font family, with tabular numerals, fluid body sizing (`clamp(16px, 1.15vw, 22px)`) and strong headings. Neutral selected navigation remains light (`#f0f2f5`) with dark text (`#171a20`); no new font or brand accent is introduced.
- Controls retain their minimum height (52px), rounded corners (10px), hover treatment and white focus outline (3px with 5px offset). Existing disabled, loading and recovery states remain distinct.
- Back/retry controls, club identity, optional position/points/played summary and five section buttons retain their order. The crest resolver requests the existing 128px image; the wrapper is 136px on desktop, 100px below 1100px and 64px below 600px.
- Full-width tables retain keyboard-focusable horizontal overflow, tonal own-team highlighting and the screen-reader team label. At 600px and below, the identity header reflows, the record moves underneath, the lineup becomes one column and fixtures wrap. Attribution text can wrap without changing that composition.
- Clasificación remains the default, followed by Alineación, Plantilla, Partidos and Títulos. Selected sections use `aria-current`; controls retain spatial-navigation groups. Team changes restore the initial section and back-button focus; local-profile changes return to Deportes. Existing live-playback session/path helpers remain in use.
- The direct club route, Añadir/favorites-editor contract, TV shell and rail are preserved. Home continues to own its geometry and ambient match-color backdrop; the team page does not replace home materials or alter global navigation.

## Scoped data-source and disclosure changes

- **FotMob replaces ESPN for this integration.** Loading, connection-error and unverified-team messages name FotMob. The footer says “Datos: FotMob (acceso no oficial, MVP local)”, gives consultation time and states that coverage depends on the club and competition. There is no ESPN traffic or hidden ESPN fallback in the supplied integration evidence.
- The MVP documentation records native HTTP reuse, fixed-host development proxies, bounded five-minute FotMob caching, in-flight deduplication and explicit fresh-fetch retry without automatic retries or provider switching. No payment, trial, API credential or bot bypass is introduced.
- The four checked identities are Manchester City (`8456`), Manchester United (`10260`), Alianza Lima (`6398`) and Atlético Grau (`920789`). Other matches require a unique exact-name identity check, not a first-result guess.
- Peru's accumulated, Apertura and Clausura tables stay separate; the header uses the accumulated record. Missing numeric information remains an em dash rather than an invented zero. Scorer evidence, not placeholder roster zeroes, determines published goals.
- Lineup copy identifies the last published/live-match lineup and explicitly says it does not confirm the next starting XI. Missing coverage, unpublished data, partial failure and connection failure remain separate states, with retry available on the same page.
- Provider honours are explicitly labelled: “Registro parcial de FotMob: puede omitir títulos históricos. No equivale al palmarés completo del club.” They are not summed or presented as a complete club history. Missing honours do not mean zero titles. The verified local Manchester United men's-first-team record retains precedence, its source/date and its non-automatic-update disclosure.

No unverifiable source-completeness, perpetual-availability or redistribution-permission claim is introduced. FotMob's unofficial endpoints and reuse restrictions remain documented local-MVP limitations; successful tests do not grant production redistribution rights.

## Optional Wikidata attribution

Wikidata remains independent, optional club metadata with a documented 24-hour cache; its failure cannot block FotMob sports data. The existing club-data aside identifies “Complemento Wikidata”, the actual Q-ID, the club website when supplied and the source, followed by “Datos sin verificación editorial.” The website is currently rendered as text. FotMob's venue takes precedence over the optional Wikidata stadium fallback.

Historical/foundation years read from Wikidata remain only at the data boundary and are **not automatically published**. The live source returned a dubious Alianza foundation year; the current page instead shows the attributed Wiki identity and club website. Wikidata is not treated as editorial verification, a results authority or a complete historical title register.

## Asset provenance

**No new shipping raster assets are introduced.** Club identity reuses existing crest assets/resolution and the existing missing-crest fallback. Player portraits are external FotMob-supplied images, loaded lazily with a person-icon fallback on missing or failed images; they are not a newly bundled photo library or generated artwork. Review screenshots are verification artifacts, not shipping imagery. Existing asset use does not establish new redistribution rights.

## Functional evidence and limits

Supplied execution evidence, not independently rerun by this documentation reviewer:

- **23 passing unit tests.**
- **11 passing related E2E tests**, including actual FotMob data for all four clubs rather than only synthetic fixtures.
- **Passing release TypeScript check.**
- **An additional successful live repeat** explicitly asserted the actual Wikidata complement `Q50602` and passed all four clubs again. This updates the earlier finish review's then-pending status for that repeat.

These results support the tested local integration, not exhaustive provider coverage or future endpoint stability. The older surface finish record's 14-unit/9-E2E counts are historical, not this extension's current evidence.

## Documentation disposition

The source and disclosure changes fit the existing page-local information patterns without changing the global visual contract. The pre-existing missing root `DESIGN.md` remains an inherited documentation gap, not permission to create or repair a global design system. Neither `DESIGN.md` nor a design sidecar is created or changed.

Only `.impeccable/review/sports-team-page/fotmob-documentation-review.md` is written by this review; no code, styles, product/surface documents or shipping assets are edited.
