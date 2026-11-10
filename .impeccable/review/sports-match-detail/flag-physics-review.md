# Physical flag integration — 2026-11-07

## Scope and result

Adapted WindyCloth's MIT-licensed Verlet/relaxed-constraint solver instead of
continuing to prescribe the cloth shape in a sine-wave vertex shader. No
Three.js runtime dependency was added. Attribution and license notices live
beside `SportsFlagCloth.ts` in `SportsFlagCloth.LICENSE.txt`.

- Source: https://github.com/cybertiwari/Indian-Flag/blob/master/js/WindyCloth.js
- Upstream: https://github.com/mrdoob/three.js/blob/r110/examples/webgl_animation_cloth.html
- Physical grid: 32×20; fixed 60 Hz integration, at most three catch-up steps.
- Structural, shear and soft bending constraints; only the left hoist is pinned.
- Gust phase travels to the right. Reduced force and extra damping near the
  free hem prevent the large accumulating right-side curls reported by the user.
- A reusable 96×60 bicubic render mesh supplies geometric normals. No arrays
  or particle objects are allocated in the per-frame solver/render update.
- The selected shell backdrop is the sole owner of the cloth canvas from the
  first frame through loading, panel reveal, expansion and collapse. The detail
  iframe stays transparent and does not mount a duplicate flag; it remains inert
  until expansion. Neighboring matches stay still. The same canvas node and
  simulation survive every reveal/size transition.
- The shell passes its compact backing dimensions before the card morph starts,
  so the native-quality buffer does not reallocate on each CSS tween frame. It
  changes resolution once after a settled expansion/collapse, not during motion.
- Reduced-motion mode draws a deterministic settled pose without a recurring
  animation loop. Preview and detail share the same material and initial pose.
- Switching selected preview state releases the old WebGL canvas context before
  the newly selected match animates; hidden visited surfaces do not retain a
  trail of active animation contexts.
- Window projection keeps the entire viewport covered; local cloth movement
  cannot expose the external hem. It deliberately does not show a free-standing
  flag silhouette, self-collisions or overhanging folds.
- Native Full HD backing resolution is retained in motion and at rest (DPR
  capped at 2, maximum backing size 2048×1440). Low-resolution motion variants
  were rejected rather than promoted as a quality fix.
- The non-overlapping projection does not require a depth buffer. An opaque,
  desynchronized WebGL context avoids unnecessary depth/blending work.
- Lighting AND pigment mixing run on the dense render mesh; the fragment
  shader only outputs interpolated RGB. This was the decisive native-resolution
  optimization, not a change to performance assertions.

## Measurements

The integrated fixture uses a 1440×1000 native canvas. The browser reports
ANGLE/SwiftShader (software Vulkan), not a hardware GPU. Samples last 1.5 s.
These measurements do not establish 60 fps on every production device.

| Variant | Frames | P95 interval | Decision |
| --- | ---: | ---: | --- |
| Previous procedural/native renderer | 51 | 58 ms | Historical baseline |
| Initial physical solver, depth buffer | 67 | 42 ms | Correctness/visual fixes required |
| 600k-pixel motion buffer | 78 | 34 ms | Rejected: user requires quality |
| Native, 60 Hz solver, per-pixel pigment mixing | 53 / 50 | 34 / 34 ms | Failed unchanged performance gate |
| Native, vertex lighting + pigment mixing | 70 | 27 ms | All 11 relevant E2E tests passed |
| Final independent repeat 1 | 66 | 26 ms | Passed |
| Final independent repeat 2 | 67 | 25 ms | Passed |
| Shell reveal repeat 1 | 89 | 20 ms | Reveal gap 32 ms; largest nearby gap 34 ms |
| Shell reveal repeat 2 | 94 | 20 ms | Reveal gap 39 ms; largest nearby gap 39 ms |
| Full selected-suite repeat | 89 | 22 ms | Reveal gap 26 ms; largest nearby gap 56 ms |

The separate 24-match/long-table probe recorded 93 draws in 1.5 s, P95 17.9 ms.
Switching across 13 matches created 13 contexts and released 12; one remained
in that probe. Hidden canvases do not initialize a GPU context. This does not
mean the real carousel has only one context: visible previews can each hold a
still context, but only the selected shell backdrop runs a simulation loop. Its
canvas remains the owner through reveal and expansion; no iframe renderer takes
over or starts a second loop.

## Verification

```powershell
npx vitest run src/pages/Sports/SportsFlagCloth.test.ts
npx tsc -p tsconfig.release.json --noEmit
npx playwright test e2e/sports-flag.spec.ts e2e/sports-followed-matches.spec.ts --grep 'muchos partidos|viewport|cadencia real|capturas del relieve|misma pose|degradado continuo|medición de cadencia|la bandera shell no se pausa|sin WebGL|congelados|permanece dentro|solo ondea' --workers=1 --trace off
npx playwright test e2e/sports-followed-matches.spec.ts --grep 'medición de cadencia' --workers=1 --repeat-each=2
npx playwright test e2e/sports-followed-matches.spec.ts --grep 'solo ondea la bandera' --workers=1 --repeat-each=2
```

- Six solver unit tests passed: independent deterministic rest states, sustained
  wind stability, fixed stepping, bounded catch-up, buffer reuse/normals, and
  rightward gust propagation. Coverage percentage was not measured.
- The selected-shell continuity test passed twice in isolation and in the full
  selected suite. The parent canvas measured 89–94 draws / 20–22 ms P95 in the
  1.5 s post-reveal window at 1188×958 on SwiftShader. The draw gap straddling
  reveal was 26–39 ms; the largest nearby gap was 34–56 ms. Only two
  backing-dimension writes occurred through reveal, and no more than one settled
  resize occurred after expansion.
- The test confirms the same canvas node stays connected and drawing across
  reveal; the iframe contains no `.sports-flag`, remains inactive before
  expansion, and does not start another renderer. Neighboring matches stay
  still. Side-by-side canvas screenshots 180 ms apart differ visibly.
- The coverage test draws against a magenta clear color and checks every pixel:
  zero uncovered pixels after an animated interval.
- Preview/detail at an identical Full HD rest pose match exactly. Normalized
  shell/detail comparison differs by 0.1883/255 on average due to resizing.
- TypeScript passed. The scoped Impeccable detector reported no findings.
- Visual checks cover desktop and narrow layouts; material acceptance against
  the user's references remains the user's judgment, not a test assertion.

## Review artifacts

`flag-physics-desktop.png`, `flag-physics-narrow.png`,
`flag-physics-shell-static.png` and `flag-physics-detail-static.png` are local
Playwright captures of this build using synthetic fixtures and the application's
existing crest assets. They are review evidence, not new shipping artwork.
