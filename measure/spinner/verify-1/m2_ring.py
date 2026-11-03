# -*- coding: utf-8 -*-
# M2: ajuste LS de centro (16 puntas de caps), posiciones radiales/angulares por petalo,
# ring-scan corregido (8 petalos) y ajuste de circulo por cap.
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
    cx = -D / 2.0
    cy = -E / 2.0
    R = math.sqrt(max(cx * cx + cy * cy - F, 0.0))
    return cx, cy, R

print("==== M2 center LS-fit from 16 cap tips")
for tag, Df in (("ref", Dr), ("ren", Dn)):
    cx0, cy0 = bc(Df)
    tin, tout, per = [], [], {}
    for k in range(8):
        ux, uy = L.axis_dirs(k)
        coreD = L.bilin(Df, cx0 + ux * L.RMID, cy0 + uy * L.RMID)
        thr = 0.5 * coreD
        r0 = L.cross_along(Df, cx0, cy0, 60.0, 150.0, ux, uy, thr, True)
        r1 = L.cross_along(Df, cx0, cy0, 200.0, 292.0, ux, uy, thr, False)
        if r0 is None or r1 is None:
            per[k] = None
            continue
        tin.append((cx0 + ux * r0, cy0 + uy * r0))
        tout.append((cx0 + ux * r1, cy0 + uy * r1))
        per[k] = (r0, r1)
    tinA = np.array(tin)
    toutA = np.array(tout)
    cxi, cyi, Ri = ls_circle(tinA)
    cxo, cyo, Ro = ls_circle(toutA)
    print("%s: inner-tips fit center=(%.2f,%.2f) R=%.3f | outer-tips fit center=(%.2f,%.2f) R=%.3f"
          % (tag, cxi, cyi, Ri, cxo, cyo, Ro))
    cxf = (cxi + cxo) / 2.0
    cyf = (cyi + cyo) / 2.0
    print("%s: adopted center=(%.2f,%.2f) Rcaps=(%.3f inner / %.3f outer)" % (tag, cxf, cyf, Ri, Ro))
    r0i = Ri
    r1o = Ro
    print("%s implied r0=%.2f (refimg/clone/spec: 92.0/92.0/92.8) r1=%.2f (267.0/266.0/266.8) rmid=%.2f (179.5/179.0/179.8)"
          % (tag, r0i, r1o, (r0i + r1o) / 2.0))
    print("--- per-petal (distancias desde centro adoptado)")
    print("pet | r0     | r1     | L      | rmid   | resid_r0 | resid_r1 | tang_r0 | tang_r1")
    tangs0 = []
    tangs1 = []
    for k in range(8):
        if per[k] is None:
            continue
        ux, uy = L.axis_dirs(k)
        vx, vy = -uy, ux
        r0, r1 = per[k]
        p0 = np.array([cx0 + ux * r0 - cxf, cy0 + uy * r0 - cyf])
        p1 = np.array([cx0 + ux * r1 - cxf, cy0 + uy * r1 - cyf])
        vec0 = p0 / (np.linalg.norm(p0) + 1e-12)
        vec1 = p1 / (np.linalg.norm(p1) + 1e-12)
        n0 = np.linalg.norm(p0)
        n1 = np.linalg.norm(p1)
        t0 = float(np.dot(p0, np.array([vx, vy])))
        t1 = float(np.dot(p1, np.array([vx, vy])))
        tangs0.append(t0)
        tangs1.append(t1)
        print("%3s | %6.2f | %6.2f | %6.2f | %6.2f |  %+6.2f  |  %+6.2f  | %+6.2f | %+6.2f"
              % (L.NAMES[k], n0, n1, n1 - n0, (n0 + n1) / 2.0, n0 - r0i, n1 - r1o, t0, t1))
    print("  tang in-tip range=[%.2f..%.2f] out-tip range=[%.2f..%.2f]"
          % (min(tangs0), max(tangs0), min(tangs1), max(tangs1)))

    # ---- cap circle fit por petalo (forma del cap, independiente del ancla)
    print("--- cap circle fit (R esperado 30.45 para ambos caps)")
    for k in range(8):
        ux, uy = L.axis_dirs(k)
        vx, vy = -uy, ux
        coreD = L.bilin(Df, cx0 + ux * L.RMID, cy0 + uy * L.RMID)
        thr = 0.5 * coreD
        pts = []
        pts_o = []
        for o in np.arange(-24.0, 24.01, 6.0):
            pxc, pyc = cx0 + vx * o, cy0 + vy * o
            tc2 = L.cross_along(Df, pxc, pyc, 70.0, 170.0, ux, uy, thr, True)
            to2 = L.cross_along(Df, pxc, pyc, 210.0, 300.0, ux, uy, thr, False)
            if tc2 is not None:
                pts.append((cx0 + ux * tc2 + vx * o, cy0 + uy * tc2 + vy * o))
            if to2 is not None:
                pts_o.append((cx0 + ux * to2 + vx * o, cy0 + uy * to2 + vy * o))
        if len(pts) >= 4:
            cx_c, cy_c, R_c = ls_circle(np.array(pts))
            rr = math.hypot(cx_c - cxf, cy_c - cyf)
            print("  %s IN : center Rdist=%.2f (exp 123.25/122.5) Rcap=%.2f   dist_center=(%.2f,%.2f)"
                  % (L.NAMES[k], rr, R_c, cx_c - cxf, cy_c - cyf))
        if len(pts_o) >= 4:
            cx_c, cy_c, R_c = ls_circle(np.array(pts_o))
            rr = math.hypot(cx_c - cxf, cy_c - cyf)
            print("  %s OUT: center Rdist=%.2f (exp 236.35/235.75) Rcap=%.2f   dist_center=(%.2f,%.2f)"
                  % (L.NAMES[k], rr, R_c, cx_c - cxf, cy_c - cyf))

    # ---- ring scan corregido r=180
    th = np.arange(0.0, 360.0, 0.25)
    n = len(th)
    X = cxf + np.cos(np.radians(th)) * 180.0
    Y = cyf - np.sin(np.radians(th)) * 180.0
    vals = L.bilin_grid(Df, X, Y)
    th2 = np.concatenate([th, th + 360.0, th + 720.0])
    v2 = np.concatenate([vals, vals, vals])
    on2 = np.concatenate([vals > 12.0] * 3)
    start0 = int(np.argmin(vals > 12.0))
    W0 = start0 * 0.25
    W1 = W0 + 360.0
    runs = []
    cur = None
    for j in range(start0, start0 + 2 * n):
        if on2[j]:
            if cur is None:
                cur = [th2[j], th2[j], v2[j] * th2[j], v2[j]]
            else:
                cur[1] = th2[j]
                cur[2] += v2[j] * th2[j]
                cur[3] += v2[j]
        else:
            if cur is not None:
                runs.append((cur[0], cur[1], cur[2], cur[3]))
                cur = None
    out = []
    for (a, b, sw, sv) in runs:
        a2 = max(a, W0)
        b2 = min(b, W1)
        if b2 - a2 < 3.0 or b2 - a2 > 40.0:
            continue
        out.append((sw / max(sv, 1e-9), b2 - a2))
    out.sort()
    print("ring r=180 petals=%d" % len(out))
    for idx, (cen, span) in enumerate(out):
        expang = idx * 45.0
        dev = ((cen - expang + 540.0) % 360.0) - 180.0
        print("   #%d exp=%5.1f meas=%.2f dev=%+.2f span=%.2f" % (idx, expang, cen, dev, span))
