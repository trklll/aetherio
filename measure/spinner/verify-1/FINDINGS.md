# FINDINGS — adversarial pixel-fidelity verification (verify-1), 3 passes: adv.py / adv2.py / adv3.py
Evidence: fresh numpy/PIL measurements on ref-spec.png vs render.png (640×640; cx=cy=320; S=580; spec r0=92.8 r1=266.8 W=60.9 L=174.0, ramp [1,.88,.76,.63,.5,.4,.31,.22]). Diffmap: verify-1/adv_diff.png. Raw dumps + tables in adv*_out.txt. §8 known deltas excluded. Mtime check: render.png (03:49:58) is fresher than clone/index.html (03:49:20) → not stale. Debug note: 3 self-inflicted metric bugs were found and corrected mid-run (bg sampler accidentally on petals; angle-envelope mis-scored as error; center-fit Jacobian radii sign) — final metrics below are the corrected ones. 37 raw assertions executed.

## F1 — MAJOR: 1px half-tone halo + ~1px width inflation on 6/8 petals (transform-phase rendering)
- Ghost census (trunk annulus r∈[126,236], petal wedge, D at 5–95% of that petal's core): ren E:224, NE:219, W:222, NW:192, SW:203, SE:237 px; N:0, S:0. ref: 0 on ALL 8. The halo runs the full long edge: raw dump x=498 (E petal): ren rows y290=33.3, y291=67.3 … y351=67.3, y352=33.3 (D=33.3 = exactly 50% of core 67.3); ref: hard 0→67.3 at y289/290 and y350/351.
- 50%-span width @t=180 (dev px), ren−ref: E +0.98, NE +1.82, NW +2.01, W +1.94, SW +1.92, SE +1.81, S +1.00, N −1.00 (ren E 61.73 = 30.9 CSS vs ref 60.75 = 30.4 vs spec 60.9). Ink px ratio ren/ref = 1.014 (79864/78765).
- Fix: put petal straight edges on integer dpr2 phases — make --pet-w a whole CSS px (30px ⇒ 60 device px; edges land on grid in any phase) or add a +0.25 CSS px phase nudge to each petal transform. Re-shoot + re-run ghost census (target 0 on E/W/N/S). Diagonal petals will keep their ~1px AA gradient (they already antialias ~1.75px vs reconstruction's hard steps; ref paints 0-transition steps everywhere, even diagonals — see dump z-se-inner-tip.png parity).

## F2 — MINOR: rendered disk sits +0.53 dev px below spec center; per-petal phase scatter
- 4-param LS center fit (16 tips, inner+outer radius classes): ren (320.00, 320.53), tip resid max 0.07px; spec center (320,320). ref itself fits (319.50, 319.50) resid 0.21 (recon-internal quirk).
- Perp-offset ren−ref @t=180 (dev px): E +1.00, NE +1.57, SE +0.90 vs N −0.50, W −0.50, SW −0.58, S −0.50, NW +0.15 — same transform-phase root cause as F1.
- Fix: jointly with F1; acceptance |fit−(320,320)| ≤ 0.25px.

## F3 — MINOR: 92 px of page-bg leak into the crop's 4 corners
- .plate--ref has border-radius:6 CSS px ⇒ 12 device px: page bg (11,11,12) shows through (92 px inside 14px corner squares; ref: 0 — square crop).
- Fix: .plate--ref { border-radius:0 } for the comparison plate (or crop 12px in). This is page context, not the spinner geometry.

## Verified-clean metrics (no finding)
- Ramp: implied α (R-ch, (L−126)/115) ren: E 1.000, NE .878, N .757, NW .626, W .504, SW .391, S .313, SE .217 — max |dev vs spec| = 0.0087 (tol ±0.02). ref matches to ≤0.5 LSB.
- Colors: petal-E interior 3×3 medians == exactly (241,80,75) in both; bg (10 pts: r=70 gap, 8 inter-petal r=250, r=300) == exactly (126,33,35) in both.
- Hole: max D in r<40 disk = 0.0 both images; first ink annulus r=91.5 both.
- Edges: r0 ref 92.39 / ren 92.27, r1 ref 266.97 / ren 265.94 (spec ±2.0 pass); angular mean error ren ≤0.36° all petals (tol ±0.75°).
- Capsule ends (E): tip widths at 0.5/1/3/6/10px in: ref 18.2/23.5/31.5/39.5/47.5, ren 16.9/21.3/30.1/38.7/46.9 — ramps like the capsule model (11/15.5/26.4/36.3/45.1 +AA), nowhere near square-cut (~61). Rounded ✓.
- L: ref 174.6, ren 173.7 vs spec 174.0. Global diff: mean|d|=0.365 (p99 5.33, max 68 corner-dominated); mean|d| on ink-union 1.72.

## Assertion bookkeeping
adv.py: 6 · adv2.py: 25 · adv3.py: 6 = 37 executed; after the 3 bug fixes: all tolerance checks pass; F1–F3 above are reported deltas, not failed tolerances.
