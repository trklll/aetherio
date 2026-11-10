# TV guide: confirmation verdict

disposition: blocked

Two bounded inspection rounds completed. No further visual-polish loop was run.

## Confirmed

- `/big-picture/channels`, selected-programme initial focus, time-preserving directional navigation, preview updates, controller-A activation of filters, protected search, Escape/B focus return, empty-state recovery, Now, F10 destination preservation, and safe direct-entry Back all passed.
- The rail's immediate open/close/focus restoration check now passes after separating focus transfer from its decorative timing.
- Six desktop Canales regression tests passed unchanged.
- Captures: `1080p.png`, `720p.png`, `2160p.png`, `search.png` in this directory. The existing composition/materials are preserved.
- `npx tsc -p tsconfig.release.json --noEmit`: passed.
- `npx vite build`: passed; existing large-chunk/Browserslist warnings remain. This is a web build, not native Tauri/mpv verification.
- Unit targets (`channelNavigation`, `channelDemo`, `appMode`, `spatialNav`, `bigPictureTransition`): 38 tests passed. Instrumented coverage was not collected; the coverage plugin is not installed.

## Blocking finding

The 1280×720 held-direction/reveal test fails after moving to Teledeporte's final programme: its focused cell has an IntersectionObserver viewport ratio of 0.978875 rather than 1. The preview remains on screen and the programme is navigable, but the focus reveal must be corrected for the cell's final layout after preview/row updates. Do not call this TV adaptation 100% complete until this check passes.

Exact reproducer:

`npx playwright test e2e/channels-tv.spec.ts --grep 'el foco revela' --workers=1 --reporter=line`

Current evidence: `test-results/channels-tv-el-foco-revela-0a16b-n-desplazar-la-vista-previa-chromium/test-failed-1.png` and `trace.zip`.

## Additional regression results

The final combined E2E run was **20 passed / 8 failed**. Of these, Canales was **16 passed / 1 failed** (including its capture test). Seven other failures were in broader existing targets:

- `e2e/app-mode.spec.ts`: four startup/resume assertions expected `/home` or `/big-picture`, but saw `/profiles`.
- `e2e/sports-rail-focus.spec.ts`: three failures expecting the old `Sports` label or Sports hero actions that were not present. The current incumbent rail labels that destination `Deportes`.

No baseline isolation was run; these are not asserted to be pre-existing, and the combined suite is not green. No unrelated startup/Sports repair was attempted.

## Limits

Inline review, not independent review. No physical controller/TV, Tauri WebView2 or live broadcast test. The guide remains a deliberately synthetic mockup; playback is disabled. No new raster assets were introduced.
