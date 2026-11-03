# -*- coding: utf-8 -*-
# V1: centro global, metricas globales, fondo del plato y esquina redondeada.
import numpy as np
import _lib as L

print("==== V1 center & globals")
ref, ren, meta = L.load()
print(meta)
Dr = L.field(ref)
Dn = L.field(ren)
ab = np.abs(ref - ren).mean(axis=2)
print("global mean|d|=%.3f p95=%.2f p99=%.2f max=%.1f"
      % (ab.mean(), np.percentile(ab, 95), np.percentile(ab, 99), ab.max()))

ir = Dr > 12.0
inn = Dn > 12.0
print("ink px (D>12): ref=%d ren=%d ratio=%.4f" % (ir.sum(), inn.sum(), inn.sum() / ir.sum()))
u = ir | inn
print("mean|d| ink-union=%.2f  pure-bg=%.3f (max %.1f)"
      % (ab[u].mean(), ab[~u].mean(), ab[~u].max()))

for tag, Df in (("ref", Dr), ("ren", Dn)):
    ys, xs = np.where(Df > 12)
    print("%s ink bbox x[%d..%d] y[%d..%d] span=(%.1f,%.1f) center=(%.1f,%.1f) [spec: centro(320,320) span 533.6]"
          % (tag, xs.min(), xs.max(), ys.min(), ys.max(),
             xs.max() - xs.min() + 1.0, ys.max() - ys.min() + 1.0,
             (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0))
    m = Df > 12
    l = m[:, :320].sum()
    r = m[:, 320:].sum()
    t = m[:320, :].sum()
    b = m[320:, :].sum()
    print("  %s ink split @320: L=%.0f R=%.0f (d=%+.0f)  T=%.0f B=%.0f (d=%+.0f)"
          % (tag, l, r, l - r, t, b, t - b))

for tag, img in (("ref", ref), ("ren", ren)):
    ms = []
    for (x, y) in ((30, 30), (580, 30), (30, 580), (580, 580)):
        ms.append(tuple(np.median(img[y:y + 24, x:x + 24].reshape(-1, 3), axis=0)))
    print(tag, "plate corners(24px) medians: %s" % (ms,))
    print(tag, "tl 0..10 median:", tuple(np.median(img[0:10, 0:10].reshape(-1, 3), axis=0)))

pb = np.array([11.0, 11.0, 12.0])
pgn = np.abs(ren - pb).mean(axis=2) < 6.0
pgr = np.abs(ref - pb).mean(axis=2) < 6.0
print("page-bg-look px (11,11,12 +-6): ref=%d ren=%d" % (pgr.sum(), pgn.sum()))
if pgn.sum():
    ys, xs = np.where(pgn)
    print("  ren page-bg bbox x[%d..%d] y[%d..%d]" % (xs.min(), xs.max(), ys.min(), ys.max()))
    for (ysl, xsl, nm) in ((ys[:4], xs[:4], "sample"),):
        for i in range(min(4, len(ys))):
            print("   px(%d,%d)=rgb%s" % (xs[i], ys[i], tuple(int(v) for v in ren[ys[i], xs[i]])))
