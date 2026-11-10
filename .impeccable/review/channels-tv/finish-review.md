# TV guide: finish review

First bounded inspection: 1920×1080, 1280×720, 3840×2160, and protected channel search, captured together by `e2e/channels-tv.spec.ts`. Incumbent truth: `.impeccable/review/channels/desktop.png`, current Channels CSS, Inter, existing glass utilities and profile background.

## Keep

- Original preview/timeline composition, channel colours, proportional time cells, neutral selected cell, demo labels and disabled playback.
- Fixed preview while the guide reveals off-screen programmes; separate sticky channel and time headings.
- Locally enlarged type and controls, with no redesign of desktop, Sports, providers or IPTV.
- Existing NameKeyboard rather than a second keyboard implementation. Native dialog protects focus and pointer access to the background.

## Correction batch

1. The rail became visible before its 130ms focus timeout. An immediate Right still moved the programme behind it instead of closing the menu. Make focus transfer and restoration synchronous with the rail state, independent of the decorative transition.
2. Keep external pointer/Tab focus aligned with the guide's time anchor, without losing the time anchor during managed vertical focus.
3. Add a safe TV-home return for direct entries without history; extend checks to keyboard numeric mode, deletion and 720p dialog containment.
4. Scale newly added inline icons through 4K, use the established 28px compact heading step and keep the compact footer at 14px.

## Detector

Mechanical detector ran once. Five advisory findings: the incumbent selected colour `#f5f5f7` and local font sizes. The colour and deliberate TV scale are recorded in the surface brief/DESIGN.md; the unneeded 29px heading became 28px. No detector errors were returned. No new raster asset ships; all illustrative assets are unchanged from the incumbent Canales surface and retain their prior provenance.

Review is inline and not represented as independent review. Physical TV, physical gamepad, Tauri WebView2 and mpv are not verified by these Chromium captures.
