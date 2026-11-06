# FotMob finish review — 2026-11-06

## 1. Disposition

**SHIP — local MVP only.** No blocking finding in the scoped integration and supplied evidence. This is not approval for production redistribution or a guarantee that an unofficial provider remains available or free forever.

## 2. Scope / contract

Preserve the existing TV shell, CSS, typography, navigation, Añadir and direct club pages. Review the ESPN-to-FotMob data replacement, provider attribution, independent optional Wikidata facts and partial-honours disclosure—not a redesign.

The contract distinguishes unknown from zero, separates Peru’s accumulated and phase tables, identifies the last published lineup rather than predicting starters, and gives the verified United registry precedence. FotMob honours remain partial; Wikidata is attributed, unverified club metadata, never an official title total. No payment, trial or bot bypass is part of this MVP.

## 3. Material findings

- **No new scoped visual blocker observed.** The two actual-source 1920×1080 captures retain readable identity, position summaries, five section controls and highlighted standings within the incumbent shell.
- The 900px and 390px fixture captures retain the hierarchy and controls. Narrow tabs wrap; the standings viewport exposes only some columns, consistent with the contracted horizontal overflow—not evidence that those columns are absent.
- Alianza’s `AL` fallback is a pre-existing missing local crest, not a regression introduced by this provider change and not a blocker for this data task.
- FotMob permission and availability limits remain real, explicitly accepted local-MVP constraints. They must not become a production-permission or permanent-service claim.

## 4. Evidence limits

Directly inspected the surface brief, MVP documentation, craft floor and four requested captures. `narrow.png` and `minimum.png` use synthetic fixtures; they prove composition, not live-source accuracy.

Supplied execution evidence: 23 passing unit tests, passing release TypeScript check, all 11 related Playwright tests passing, including the real-source four-club check asserting standings, 11 starters, over 20 roster rows, a loaded player photo, honours and partial labels. Supplied mechanical detector result: `[]`. These runs were not independently repeated by this reviewer.

Supplemental `live-alianza-lineup.png`, `live-alianza-squad.png` and refreshed `live-alianza-honours.png` were directly inspected: portraits are visible, and honours explicitly warn of partial coverage with a FotMob source; the footer attributes unverified Wikidata metadata (Alianza `Q572957`) and the club website. Completed checks are now credited as supplied evidence: two successful real-source four-team runs, including explicit Wikidata `Q50602`, 11 starters, over 20 squad rows, loaded photos and partial titles; another passing four-test team-page suite after the final label correction; and another passing release TypeScript check. The source-correctness correction does not automatically publish founding dates: the refreshed footer shows ID, website and provenance instead; per the supplied correction, the dubious raw registered year remains backend-only pending verification. Wikidata is not an official title-total source. These completed checks supersede the earlier pending status; they were not independently rerun by this reviewer. This is not a fresh native-Tauri, computed-contrast or complete accessibility certification.

## 5. Documentation

`docs/sports-team-data-mvp.md` records sources, fixed-host transport, cache/retry boundaries, identity checks, unknown-data semantics, partial honours, optional Wikidata and the redistribution restriction, with deterministic and live verification commands. It does not establish perpetual provider access.

The surface brief preserves the correct integration-only direction. Its earlier 14-unit/9-Playwright finish record is historical; the supplied 23-unit/11-Playwright evidence above belongs to this review. Missing global `DESIGN.md` remains an inherited documentation gap, not grounds to redesign or expand this task. Review screenshots are evidence, not new shipping raster assets. Only this review file was written.
