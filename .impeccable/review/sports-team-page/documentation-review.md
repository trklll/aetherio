# Sports team page — documentation review

Date: 2026-11-06. Scope: ordinary extension of the incumbent Big Picture Sports interface, not a new visual identity or global design-system change.

## Evidence checked

- `PRODUCT.md`: preserve the existing application and Big Picture design; reuse existing pieces; distinguish verified, unknown and failed data; preserve local-profile isolation.
- `.impeccable/surfaces/src-pages-bigpicture-sportsteampage-tsx.md`: direct team route, five information sections, standings-first composition, retained favorites editor and playback, honest coverage limits.
- `src/pages/BigPicture/SportsTeamPage.tsx` and `SportsTeamPage.css`: implemented identity header, navigation, tables, player imagery, fixtures, recovery states, responsive rules and focus treatment.
- `src/pages/BigPicture/BigPictureSportsHome.css`, `SportsTeamsRow.css` and `SportsIptv.css`: incumbent dark surfaces, bright text, muted metadata, neutral active controls, generous targets and white focus outlines. `SportsTeamsRow.tsx` additionally confirms team-card routing while retaining Añadir and the favorites selection dialog.
- `src/services/sportsTeamOverview.ts` and `src/data/sports/teamHonours.ts`: actual provider, caching, matching, photo URLs and editorial honours coverage.
- `C:/Users/Administrator/.config/opencode/skills/impeccable/reference/document.md`: evidence-led extraction, no fabricated tokens, and separation of durable system guidance from surface-specific composition.

This is a source-based documentation review, not a claim of browser, controller, accessibility or live-provider verification.

## Inherited conventions

The extension retains the dark TV-oriented visual language, inherited font family, strong headings, secondary metadata, tabular numerals and real club crests. Its white focus outline (3px with 5px offset) continues the incumbent dialog's white-outline vocabulary (2px with 3px offset), with larger page controls (52px minimum height versus the dialog's 44px). Neutral light selected navigation echoes existing white primary actions rather than introducing a branded accent.

Existing home geometry and liquid-glass team cards remain incumbent patterns; the detail page does not replace their materials or global tokens. Team activation now opens the detail route, while Añadir still opens the favorites editor. The page returns to Sports on local-profile changes and invokes the existing live-playback session/path helpers.

## Scoped new patterns

- A flat charcoal information surface (`#181b20`) replaces the home surface's ambient backdrop only within `.team-page`. No new font, global palette or global component policy is established.
- Identity and optional position/points/played summary precede five section buttons: Clasificación, Alineación, Plantilla, Partidos and Títulos. Clasificación is the default; selection uses `aria-current` and separate spatial-navigation groups.
- Full-width, horizontally scrollable tables support dense standings, squad and honours data. The followed team's row has a tonal highlight plus a screen-reader label. Missing numeric values use an em dash, not an invented zero.
- The crest resolver requests the existing 128px asset; its desktop wrapper is 136px, then 100px below 1100px and 64px below 600px. This implementation detail differs from the brief's shorthand “128px crest.”
- At 600px and below, the identity header reflows, the record moves below it, player lists become one column and fixtures wrap. Table regions remain keyboard-focusable and horizontally scrollable.
- Loading, connection failure, unsupported coverage, partial failure and unpublished data have distinct messages. Retry stays on the team page. The last published/live lineup is explicitly not a prediction of the next starting XI.

These are page-local information patterns, not additions to a global design-system contract.

## Data and asset provenance

ESPN is an **unofficial API source**, not an official integration or licensed coverage guarantee. Requests share a five-minute, in-memory endpoint cache; rejected requests are removed from that cache. Team resolution requires exactly one normalized exact name/alias match. Section requests isolate failures after team resolution. The footer identifies ESPN, consultation time and coverage limitations; retry may reuse still-valid cached responses rather than forcing a fresh fetch.

Honours are separate local editorial data, currently **Manchester United men's first team only**, with the official trophy-room URL and recorded verification date `2026-11-06`. The page states that this record does not update automatically. Other teams show verification-pending copy, not zero titles. This review checked the recorded source/date, not the trophy-room website independently. No Wikidata source or integration is used by this extension.

**No new shipping raster assets are introduced.** Club identity reuses the existing crest resolver/assets. Player portraits remain remote HTTPS headshot URLs supplied by ESPN responses, loaded lazily with an existing Lucide person-icon fallback on missing/failed images; they are not newly bundled artwork. No generated hero raster or new local photo set is required.

## Documentation disposition

The extension is consistent with the incumbent visual vocabulary while adding explicitly scoped data-reading layouts. Documentation captures its boundaries and provenance without promoting one-off values into global tokens.

The existing application-level documentation gap remains: root `DESIGN.md` and `.impeccable/design.json` are absent. Vendor DESIGN.md files are not application design authority. The surface brief's generic finish instruction naming DESIGN.md does not authorize creating global design documentation for this ordinary extension. **The gap is reported, not repaired:** neither file is created or modified, and no global design-system changes are authorized by this review.
