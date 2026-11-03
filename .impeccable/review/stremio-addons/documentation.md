# Stremio admin extension — documentation evidence

2026-11-02 · Ordinary functional extension · Operate mode. This is an evidence note, not a new visual system or a shipping verdict.

## Evidence checked

- `PRODUCT.md` and the Stremio extension section of `.impeccable/surfaces/provider-hub-src-assets-admin-html-txt.md`.
- Current `provider-hub/src/assets/admin.html.txt`, `admin.css.txt`, and `admin.js.txt`.
- `provider-hub/README.md`, especially the add-on endpoints and “Panel: add-ons de Stremio y scripts” workflow.
- Final captures: [desktop directory](desktop-directory.png), [desktop inspector](desktop-inspector.png), [mobile](mobile.png), and [narrow](narrow.png); compared with their `before-*` correction-pass captures.

## Comparison with the incumbent system

- The current stylesheet and captures retain the deep blue-green planes, mint primary/selection/focus treatment, system typography, rounded controls, bordered directory, and contextual inspector. The inspector sits beside the directory on desktop and below it at narrow widths (the stylesheet switches at 940px). No replacement identity is introduced.
- The extension joins the existing directory: Stremio entries precede scripts; **Todos los tipos / Stremio / Scripts** combines with search and status filtering. Separate **Nuevo script** and **Nuevo add-on** actions select the appropriate inspector fields.
- The Stremio inspector adds manifest checking, logo source, default-enabled state, catalog policy, hidden integration, optional stream limits, and advanced fallback JSON. Manifest checking updates the draft; saving remains a separate action. Script editing and published-bundle testing remain separate from Stremio configuration.
- Copy preserves AnimeAV1 under AnimES and NyaaSi under Torrentio. It distinguishes initial defaults from personal choices, warns that the directory is public, keeps Highfly personal URLs in Aetherio, and identifies PenguPlay’s authenticated-proxy route.
- Correction evidence is visible in the current source: lazy logos remain attached while loading, with initials available as fallback; clearing timeout/attempts sends explicit `null` values. Reviewer confirmation of these fixes is a separate, pending verdict.

The `before-*` images already contain this extension; they establish correction-pass continuity, not a pre-extension baseline or byte-for-byte proof that all incumbent CSS is unchanged. Capture counts include a local **E2E Script** fixture and are not a production inventory or upstream-health claim.

## Operator documentation and verification scope

The README documents authenticated add-on CRUD/validation, the separate `addons:directory` KV key, Hub-served public logos, personal-configuration safeguards, and isolated local Playwright execution. It distinguishes directory edits without Worker redeployment from script tests that require a published bundle. No deployment or Aetherio release is asserted here.

The implementation handoff reports **47 Vitest tests**, **8 real local Playwright tests**, Hub typecheck, and a Worker dry run passing. These were not rerun in this documentation-only pass. The finish reviewer’s continuation verdict was pending at documentation time; this note does not substitute for it.

No new shipping raster assets were authored. External add-on logos are runtime assets; the PNGs linked above are verification artifacts, not shipping artwork.

## Documentation gaps and boundary

- **Pre-existing:** root `DESIGN.md` is missing, as confirmed by context loading. The surface’s inherited FINISH line still names it; an ordinary extension does not authorize inventing or repairing that system documentation.
- **Minor operator detail:** the README mentions timeout/attempt editing but does not explicitly explain that clearing either optional field restores automatic behavior.
- Only this evidence note was authored. Sources, README, product/surface documents, design files, tokens, deployment state, and other work in progress were left untouched.

## Parent follow-through after documentation

- The separate reviewer returned `ship` for both scored fixes, marking them resolved (not a new whole-surface audit).
- README now explicitly documents blank fields / API `null` to restore automatic stream overrides.
- Provider Hub 1.6.0 deployed as Worker version `8aacaf87-2d94-4f67-8f56-b0de1f93bc11`. Production `/admin`, its JS, `/health`, `/addons.json`, and all seven logo routes returned 200; unauthenticated `/admin/addons` returned 401. No production roster entries were changed for testing, no secrets were rotated, and Aetherio was not published.
- Temporary V8 coverage runner measured the new `addonRegistry.ts` and `remoteAssets.ts` modules: 87.16% statements, 81.98% branches, 100% functions, 93.24% lines. No package manifest or lockfile changes were made for the runner.
