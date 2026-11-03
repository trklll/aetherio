# -*- coding: utf-8 -*-
# V3: agujero central, colores por petalo (rampa de alfa) y anti-aliasing de bordes.
import numpy as np
import _lib as L

ref, ren, _ = L.load()
Dr = L.field(ref)
Dn = L.field(ren)

def bc(Df):
    ys, xs = np.where(Df > 12.0)
    return (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0

print("==== V3 hole / colors / AA")
for tag, Df in (("ref", Dr), ("ren", Dn)):
    cx, cy = bc(Df)
    th = np.radians(np.arange(0.0, 360.0, 0.5))
    T = np.arange(0.0, 130.0, 0.25)
    X = cx + np.cos(th)[:, None] * T[None, :]
    Y = cy - np.sin(th)[:, None] * T[None, :]
    Vm = L.bilin_grid(Df, X, Y)
    hit = Vm > 6.0
    firsts = T[np.argmax(hit, axis=1)]
    nohit = ~hit.any(axis=1)
    firsts = firsts.astype(float)
    firsts[nohit] = 999.0
    thc = np.radians(np.arange(0.0, 360.0, 2.0))
    tc = np.arange(0.0, 52.0, 1.0)
    Xc = cx + np.cos(thc)[:, None] * tc[None, :]
    Yc = cy - np.sin(thc)[:, None] * tc[None, :]
    mx = float(L.bilin_grid(Df, Xc, Yc).max())
    print("%s hole: first-ink min=%.2f p5=%.2f median=%.2f max=%.2f nohit=%d | center-disk(t<52) max ink=%.2f (exp ~0)"
          % (tag, firsts.min(), np.percentile(firsts, 5), np.median(firsts),
             firsts.max(), int(nohit.sum()), mx))

print("---- petal core colors (13x13 window @ r_mid; centers propios)")
print("exp ramp alpha:", L.RAMP)
print("exp trunc:", [tuple(int(v) for v in (L.PET * a + L.BG * (1 - a))) for a in L.RAMP])
print("exp round:", [tuple(int(round(v)) for v in (L.PET * a + L.BG * (1 - a))) for a in L.RAMP])
cores = {}
for tag, Df, img in (("ref", Dr, ref), ("ren", Dn, ren)):
    cx, cy = bc(Df)
    for k in range(8):
        cores[(tag, k)] = L.petal_core_median(img, cx, cy, k)
for k in range(8):
    mr = cores[("ref", k)]
    mn = cores[("ren", k)]
    a = L.RAMP[k]
    c = L.PET * a + L.BG * (1.0 - a)
    d_round = mn - np.round(c)
    d_trunc = mn - np.floor(c)
    al = (mn - L.BG) / (L.PET - L.BG)
    alr = (mr - L.BG) / (L.PET - L.BG)
    print("%3s ref=%s ren=%s dRound=%s dTrunc=%s aRen=%s dev=%s aRef=%s"
          % (L.NAMES[k],
             ",".join("%5.1f" % v for v in mr),
             ",".join("%5.1f" % v for v in mn),
             ",".join("%+.1f" % v for v in d_round),
             ",".join("%+.1f" % v for v in d_trunc),
             ",".join("%.3f" % v for v in al),
             ",".join("%+.3f" % (v - a) for v in al),
             ",".join("%.3f" % v for v in alr)))
drr = [cores[("ren", k)] - cores[("ref", k)] for k in range(8)]
print("ren-ref core delta per petal:")
for k in range(8):
    print("  %3s %s" % (L.NAMES[k], ",".join("%+.1f" % v for v in drr[k])))

print("---- edge AA (ancho total de transicion de los dos bordes rectos, px, por estacion)")
for tag, Df in (("ref", Dr), ("ren", Dn)):
    cx, cy = bc(Df)
    for nm, k in (("E(a=1.00)", 0), ("W(a=0.50)", 4)):
        ux, uy = L.axis_dirs(k)
        vx, vy = -uy, ux
        coreD = L.bilin(Df, cx + ux * L.RMID, cy + uy * L.RMID)
        vals = []
        for t in range(int(L.R0) + 60, int(L.R1) - 60, 12):
            px, py = cx + ux * t, cy + uy * t
            o = np.arange(-40.0, 40.01, 0.25)
            X = px + vx * o
            Y = py + vy * o
            V = L.bilin_grid(Df, X, Y)
            band = (V > 0.08 * coreD) & (V < 0.92 * coreD)
            vals.append(float(band.sum()) * 0.25)
        vals = np.array(vals)
        print("%s %s edgeAA total-both-edges: median=%.2f min=%.2f max=%.2f (stations=%d)"
              % (tag, nm, np.median(vals), vals.min(), vals.max(), len(vals)))
    # tip del cap E (a=1.0): perfil radial en el eje
    ux, uy = L.axis_dirs(0)
    o = np.arange(80.0, 106.0, 0.25)
    X = cx + ux * o
    Y = cy + uy * o
    V = L.bilin_grid(Df, X, Y)
    band = (V > 0.08 * L.CORED) & (V < 0.92 * L.CORED)
    print("%s E-inner-tip AA width along axis: %.2f px (band core %.3f)" % (tag, float(band.sum()) * 0.25, L.CORED))
