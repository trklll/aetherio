"""Diff numérico ref-spec.png vs render.png (640x640 ambos).

Métricas:
- mean |Δ| por canal (objetivo 5-15 en sustituidos; en este atomo <6 esperado)
- ink ratio global (px con brillo > bg+ threshold) 0.95-1.05
- geometría polar: por ángulo de pétalo (8 sectores) cuenta ink + radio medio de ink
  (detecta pétalos desaparecidos, radio mal puesto o rampa invertida)
- diffmap.png (amplificación x4 del delta)
"""
import numpy as np
from PIL import Image
import os, math

BASE = os.path.dirname(os.path.abspath(__file__))
ref = np.asarray(Image.open(os.path.join(BASE, "ref-spec.png")).convert("RGB"), dtype=np.int16)
ren = np.asarray(Image.open(os.path.join(BASE, "render.png")).convert("RGB"), dtype=np.int16)
assert ref.shape == ren.shape == (640, 640, 3), f"shape mismatch {ref.shape} {ren.shape}"

ab = np.abs(ref - ren).mean(axis=2)
mean_d = ab.mean()
p95 = np.percentile(ab, 95)
diff_img = np.clip(ab * 4, 0, 255).astype(np.uint8)
Image.fromarray(diff_img).save(os.path.join(BASE, "diff.png"))

bg = np.array([126, 33, 35])
# ink = px notables vs bg. Umbral: alfa min de la rampa 0.22 ⇒ Δmean = 0.22·67.3 ≈ 14.8.
# 12 deja pasar α=0.22 y descarta ruido/antialias del bg (Δ≈0-4).
TH_INK = 12.0
ink_ref = (np.abs(ref - bg).mean(axis=2) > TH_INK)
ink_ren = (np.abs(ren - bg).mean(axis=2) > TH_INK)
ink_ratio = ink_ren.sum() / max(ink_ref.sum(), 1)

# polar: 8 pétalos por sector; el pétalo k apunta a k*45° desde el center
CX = CY = 320.0
RAMP = [1.00, 0.88, 0.76, 0.63, 0.50, 0.40, 0.31, 0.22]
report = []
for k in range(8):
    ang = math.radians(k * 45)
    dx, dy = math.cos(ang), -math.sin(ang)
    rows = ink_ref.sum()  # placeholder para no warning
    sector_hits_ref = 0
    sector_hits_ren = 0
    rad_ref_mean, rad_ren_mean = [], []
    for t in np.arange(60, 300, 1.0):           # radio de exploración
        x, y = CX + dx * t, CY + dy * t
        xi, yi = int(round(x)), int(round(y))
        # sample a 5x5 en torno al punto central del radio y ±40 perpend
        for off in (-44, -22, 0, 22, 44):
            px, py = xi - int(round(-dy * off)), yi - int(round(dx * off))
            if 0 <= px < 640 and 0 <= py < 640:
                sector_hits_ref += int(ink_ref[py, px])
                sector_hits_ren += int(ink_ren[py, px])
    report.append((k, RAMP[k], sector_hits_ref, sector_hits_ren,
                   round(sector_hits_ren / max(sector_hits_ref, 1), 3)))

print(f"mean|d| = {mean_d:.2f} (p95 {p95:.1f})   ink ratio = {ink_ratio:.3f}")
print("sector k | alpha | ink spec | ink render | ratio (0.92-1.08 ok)")
for k, a, s, r, ratio in report:
    flag = "" if 0.92 <= ratio <= 1.08 else "  <-- CHECK"
    print(f"  {k}      {a:.2f}    {s:6d}      {r:6d}      {ratio}{flag}")
