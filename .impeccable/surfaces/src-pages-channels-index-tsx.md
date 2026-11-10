---
version: 1
slug: "src-pages-channels-index-tsx"
primary_target: "src/pages/Channels/index.tsx"
related_targets: ["src/pages/Channels/LiveChannelsPage.tsx","src/pages/Channels/LiveChannelsPage.css","src/pages/Channels/ChannelLivePreview.tsx","src/pages/Channels/liveChannelModel.ts","src/pages/Channels/ChannelsTV.css","src/pages/Channels/ChannelSearchDialog.tsx","src/services/iptvChannels.ts","src/components/layout/TopNav.tsx"]
---

# Canales

Primary target: `src/pages/Channels/index.tsx`
Mode: Operate. Desktop and TV/Big Picture surface inside the established Aetherio visual world.

Updated brief, 9 November 2026: the user explicitly rejected the old mockup and mismatched PC/TV implementations. Replace both with one real channel surface using the available IPTV sources. Confirmed in the structured question: **Sí, previa en directo** while browsing. Apple TV is the craft reference; existing Aetherio typography, materials, shell and controls remain authoritative. This supersedes the earlier mockup-only scope below.

## Direction contract

**THESIS:** Watch before committing: a real, silent live preview stays visible while exploring an aligned television guide. Refuse the disconnected directory of identical channel cards.

**OWN-WORLD:** Inherit Inter, the profile backdrop, app gutters, neutral atv palette, existing `liquid-glass-pill` controls, rounded-card geometry and white primary actions. Do not create a blur/filter or a new material. Broadcast identities provide the only local colour.

**STORY:** Select or focus a real channel to tune a muted preview; inspect actual XMLTV information when available; open the existing full player deliberately. Loading, failed signals and missing schedules remain distinct, recoverable states.

**FIRST VIEWPORT:** Quiet Canales header and real clock; a large 16:9 live preview occupies the left forty percent, with channel identity, programme title, actual metadata and a white Ver canal action beside it. One compact category/search row separates preview from the guide. Channel logos and identities anchor the left column; real programmes occupy a two-hour timeline. Missing EPG is one understated row, never fabricated television. At TV scale the preview and controls stay pinned above a scrollable guide; a narrow PC window stacks the preview and confines overflow to the timeline.

**FORM:** User-pinned Apple TV/reference-guide structure, code-led implementation; seed key `user-pinned-channels-guide`. No concept roll or generated comp: the user pinned the established reference and asked for its implementation. Signature interaction: focusing a channel tunes its live preview after a bounded dwell, cancelling obsolete playback when focus moves, without moving the outer shell.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

- Scope: `/channels` and `/big-picture/channels`, routed through the same real-channel page. Preserve the shared shell, Sports and existing IPTV settings/player.
- Reuse bundled IPTV catalog, playlist loaders, XMLTV parser, public-URL checks, native provider transport, existing full-player session priming and protected TV search keyboard.
- Preview starts muted after a 320ms focus dwell. Obsolete resolutions and HLS callbacks cannot replace the newly selected channel; unmount destroys media and clears source buffers. Unsupported or inaccessible previews retain retry and the explicit full-player action.
- Only actual XMLTV programmes occupy timed cells. Match regional channel IDs exactly (ignoring quality suffixes); use display-name fallback only without a channel ID and with an unambiguous match. Future selections explicitly say the video remains the current live signal.
- Browse 48 channels per page; filters and search combine, resetting pagination. The guide owns overflow; selection never scrolls the outer TV page. Source availability is not inferred from catalog membership.
- Existing Inter, neutral surfaces, white primary action, app gutter tokens and `liquid-glass-pill`/`liquid-glass-dark` remain authoritative. No global system replacement or new blur material.

## Verification — live implementation, 9 November 2026

- `npm run build`: passed; pre-existing large-bundle/Browserslist warnings remain.
- 39 unit tests passed across `liveChannelModel`, `iptvChannels` and `iptvSports`.
- `e2e/channels-live.spec.ts`: 4 passed. A controlled HLS fixture made from an existing app intro proves real video decoding, sound toggle and XMLTV selection; error recovery, empty filters and controller-style TV navigation/search also pass. Fixture video is test-only, not shipped as channel programming.
- Actual-source screenshots (no fabricated video or schedules): `.impeccable/review/channels-live/{desktop,mobile,user-1056,tv-720p,tv-1080p,tv-2160p}.png`. The included 30A Golf Kingdom source played in all captures. Some remote playlists failed; the UI reports partial availability.
- Startup animation did not settle in headless/browser inspection; evidence only overrides the startup overlay, not product code. The included browser viewport is 1056×886. Native Tauri playback and physical controller/television tests remain unverified.
- Detector ran once: advisory-only type/radius/palette findings against the narrow global navigation tokens. Page-local scale and existing selected-white were not promoted into new global tokens.
- Nested reviewer/documenter spawning was rejected by the harness depth limit. Degraded in-thread review and documentation check are recorded in `finish-review.md` and `documentation-check.md`; they are not independent approval.

## Historical mockup adaptation — superseded by the live brief above

## TV adaptation — 9 November 2026

The following records the earlier mock-only implementation and is not the current scope. The user has since rejected synthetic schedules and explicitly requested live preview in both modes.

- Keep the preview, category controls and sample-time heading visible. Only the time grid scrolls, horizontally and vertically; channel names and time headings stay pinned in their respective axes.
- Enter focused on the selected current programme. Left/right follows programmes; up/down follows the same broadcast-time anchor across channels of different durations. Focus updates the preview without requiring A. The left edge opens the incumbent rail and closing it restores the exact programme.
- All controls have deterministic arrow navigation. A confirms; B closes search before navigating back. An entry without in-app history returns to the Big Picture home. F10/Start keeps the Canales destination when switching modes.
- Search reuses the shipped `NameKeyboard` in a protected native dialog, with real keyboard support and a clear no-results recovery. No mouse or physical keyboard is required.
- Reading-distance scale is scoped to `.channels-page--tv`: 21px programme titles/16px times at 1080p, proportional scaling through 4K, and minimum 17px/14px at 720p. The guide's 86px rows scale with this mode. These are not new global typography tokens.
- Selected cells retain the incumbent `#f5f5f7`; focused cells add an inset neutral contrast mark. Existing Inter, app inset variables and glass utilities remain authoritative.
- Verify 1280×720, 1920×1080 and 3840×2160 together, plus synthetic A, B, rail restoration, search, time bounds and desktop regression. Browser evidence does not replace a physical controller/TV test.
