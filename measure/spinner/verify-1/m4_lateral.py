# -*- coding: utf-8 -*-
# M4: eje lateral y ancho por petalo (bilin 50%) + matrices crudas de bordes/claves (W, S, NE, SE-out).
import math
import numpy as np
import _lib as L

ref, ren, _ = L.load()
Dr = L.field(ref)
Dn = L.field(ren)

def bc(Df):
    ys, xs = np.where(Df > 12.0)
    return (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0

def ls_circle(P):
    x = P[:, 0]
    y = P[:, 1]
    A = np.stack([x, y, np.ones_like(x)], axis=1)
    b = -(x * x + y * y)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    D, E, F = sol
    return -D / 2.0, -E / 2.0

def fit_center(Df):
    cx0, cy0 = bc(Df)
    tin = []
    UX = {}
    for k in range(8):
        ux, uy = L.axis_dirs(k)
        coreD = L.bilin(Df, cx0 + ux * L.RMID, cy0 + uy * L.RMID)
        r0 = L.cross_along(Df, cx0, cy0, 60.0, 150.0, ux, uy, 0.5 * coreD, True)
        r1 = L.cross_along(Df, cx0, cy0, 200.0, 292.0, ux, uy, 0.5 * coreD, False)
        if r0 is None or r1 is None:
            continue
        tin.append((cx0 + ux * r0, cy0 + uy * r0))
        tin.append((cx0 + ux * r1, cy0 + uy * r1))
    cxi, cyi = ls_circle(np.array(tin))
    return cxi, cyi, cx0, cy0

def lateral(Df, cxf, cyf, k):
    ux, uy = L.axis_dirs(k)
    vx, vy = -uy, ux
    sp = []
    ax = []
    for t in (140.0, 155.0, 180.0, 205.0, 226.0):
        px, py = cxf + ux * t, cyf + uy * t
        v0 = L.bilin(Df, px, py)
        thr = 0.5 * v0
        if v0 < thr or v0 < 3.0:
            continue
        a = L.perp_cross(Df, px, py, vx, vy, v0, -1)
        b = L.perp_cross(Df, px, py, vx, vy, v0, +1)
        if a is None or b is None:
            continue
        sp.append(b - a)
        ax.append((a + b) / 2.0)
    if not sp:
        return None, None, None
    return float(np.mean(sp)), float(np.mean(ax)), len(sp)

print("==== M4 lateral cross-section per petal (50% bilinear, stations x5)")
centers = {}
for tag, Df in (("ref", Dr), ("ren", Dn)):
    cxf, cyf, cx0, cy0 = fit_center(Df)
    centers[tag] = (cxf, cyf)
    print("%s fitted center=(%.2f,%.2f) (crude bbox (%.1f,%.1f))" % (tag, cxf, cyf, cx0, cy0))
    print("pet | W     | axis_offset(perp) | stations | axis ABS (x,y)")
    for k in range(8):
        ux, uy = L.axis_dirs(k)
        vx, vy = -uy, ux
        w, off, ns = lateral(Df, cxf, cyf, k)
        if w is None:
            print("%3s N/A" % L.NAMES[k])
            continue
        axis_x = cxf + ux * 180.0 + vx * off
        axis_y = cyf + uy * 180.0 + vy * off
        print("%3s | %5.2f | %+6.2f | %d | (%.2f,%.2f)"
              % (L.NAMES[k], w, off, ns, axis_x, axis_y))

def dump(tag, Df, y0, y1, x0, x1, label):
    print("---- %s %s y[%d..%d] x[%d..%d]" % (tag, label, y0, y1, x0, x1))
    print("     " + "".join("%5d" % x for x in range(x0, x1 + 1)))
    for y in range(y0, y1 + 1):
        print("y%3d " % y + "".join("%5.0f" % round(Df[y, x]) for x in range(x0, x1 + 1)))

for tag, Df in (("ref", Dr), ("ren", Dn)):
    cxf, cyf = centers[tag]
    ux, uy = L.axis_dirs(4)
    dump(tag, Df, 286, 294, 137, 143, "W petal TOP-ish edge trunk (x 137..143)")
    dump(tag, Df, 347, 355, 137, 143, "W petal BOTTOM-ish edge trunk")
    dump(tag, Df, 497, 503, 284, 296, "S petal LEFT edge trunk")
    dump(tag, Df, 497, 503, 345, 357, "S petal RIGHT edge trunk")
    dump(tag, Df, 575, 591, 314, 327, "S inner cap tip (toward center from below)")
    dump(tag, Df, 313, 328, 570, 583, "E outer cap tip")
ux, uy = L.axis_dirs(1)
px_ = 320 + ux * 180.0
py_ = 320 - uy * 180.0
dump("ren", Dn, int(py_) - 22, int(py_) + 22, int(px_) - 22, int(px_) + 22, "NE mid-trunk zone")
