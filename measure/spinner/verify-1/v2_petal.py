# -*- coding: utf-8 -*-
# V2: geometria por petalo (r0, r1, L, W, hw del cap, residuos de cap) + ring scan + drift de centro.
import math
import numpy as np
import _lib as L

ref, ren, _ = L.load()
Dr = L.field(ref)
Dn = L.field(ren)

def bc(Df):
    ys, xs = np.where(Df > 12.0)
    return (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0

print("==== V2 per-petal geometry")
print("exp: r0=92.8 r1=266.8 L=174.0 W=60.9 hw@station=26.37 capCEN_IN=123.25 capCEN_OUT=236.35")
for tag, Df in (("ref", Dr), ("ren", Dn)):
    cx, cy = bc(Df)
    print("---- img=%s center=(%.1f,%.1f)" % (tag, cx, cy))
    print("pet | r0    | r1    | L     | W    | hw   | capIN(m,mx) | capOUT(m,mx) | coreD")
    r0s = {}
    for k in range(8):
        ux, uy = L.axis_dirs(k)
        vx, vy = -uy, ux
        coreD = L.bilin(Df, cx + ux * L.RMID, cy + uy * L.RMID)
        thr = 0.5 * coreD
        if thr < 6.0:
            print("%3s  *** petal missing? coreD=%.1f ***" % (L.NAMES[k], coreD))
            continue
        r0 = L.cross_along(Df, cx, cy, 60.0, 150.0, ux, uy, thr, True)
        r1 = L.cross_along(Df, cx, cy, 200.0, 292.0, ux, uy, thr, False)
        rm = r1 - r0 if (r0 is not None and r1 is not None) else float('nan')
        r0s[k] = r0
        ws = []
        for t in (140.0, 155.0, 180.0, 205.0, 226.0):
            px, py = cx + ux * t, cy + uy * t
            v0 = L.bilin(Df, px, py)
            if v0 < thr:
                continue
            a = L.perp_cross(Df, px, py, vx, vy, v0, -1)
            b = L.perp_cross(Df, px, py, vx, vy, v0, +1)
            if a is not None and b is not None:
                ws.append(b - a)
        Wm = sum(ws) / len(ws) if ws else float('nan')
        wspread = (max(ws) - min(ws)) if len(ws) >= 2 else 0.0
        px, py = cx + ux * (L.R0 + L.WID / 4.0), cy + uy * (L.R0 + L.WID / 4.0)
        v0 = L.bilin(Df, px, py)
        hw = float('nan')
        if v0 >= thr:
            a = L.perp_cross(Df, px, py, vx, vy, v0, -1)
            b = L.perp_cross(Df, px, py, vx, vy, v0, +1)
            if a is not None and b is not None:
                hw = (b - a) / 2.0

        def capres(tcen, rising, sign):
            res = []
            t_lo = tcen - 70.0 if rising else tcen - 12.0
            t_hi = tcen + 60.0 if rising else tcen + 80.0
            for o in np.arange(-24.0, 24.01, 6.0):
                pxc, pyc = cx + vx * o, cy + vy * o
                tc2 = L.cross_along(Df, pxc, pyc, t_lo, t_hi, ux, uy, thr, rising)
                if tc2 is None:
                    continue
                dy2 = (L.WID / 2.0) ** 2 - o * o
                if dy2 <= 0:
                    continue
                pred = tcen + sign * math.sqrt(dy2)
                res.append(tc2 - pred)
            if not res:
                return float('nan'), float('nan')
            return sum(res) / len(res), max(abs(x) for x in res)

        ci_m, ci_x = capres(L.R0 + L.WID / 2.0, True, -1.0)
        co_m, co_x = capres(L.R1 - L.WID / 2.0, False, 1.0)
        print("%3s | %6.2f | %6.2f | %6.2f | %5.2f | %5.2f | %6.2f,%5.2f | %6.2f,%5.2f | %5.1f"
              % (L.NAMES[k], r0, r1, rm, Wm, hw, ci_m, ci_x, co_m, co_x, coreD))
        if wspread > 1.0:
            print("     (W stations spread %.2f)" % wspread)

    # ring scan r=180: conteo de petalos + centros angulares
    th = np.arange(0.0, 360.0, 0.25)
    X = cx + np.cos(np.radians(th)) * 180.0
    Y = cy - np.sin(np.radians(th)) * 180.0
    vals = L.bilin_grid(Df, X, Y)
    on = vals > 12.0
    n = len(th)
    start0 = int(np.argmin(on))
    runs = []
    cur = None
    for j in range(n):
        i = (start0 + j) % n
        if on[i]:
            if cur is None:
                cur = [i, i]
            else:
                cur[1] = i
        else:
            if cur is not None:
                runs.append(cur)
                cur = None
    if cur is not None:
        runs.append(cur)
    petals = []
    noise = 0
    for a_i, b_i in runs:
        if b_i <= a_i:
            continue
        seg = vals[a_i:b_i + 1]
        angseg = th[a_i:b_i + 1]
        cen = float((angseg * seg).sum() / seg.sum())
        span = th[b_i] - th[a_i] + 0.25
        if span < 3.0:
            noise += 1
            continue
        petals.append((cen, span))
    print("ring r=180: petals=%d (noise arcs=%d)" % (len(petals), noise))
    for idx, (cen, span) in enumerate(petals):
        dev = ((cen - idx * 45.0 + 540.0) % 360.0) - 180.0
        print("   #%d ang=%.2f dev=%+.2f span=%.2f" % (idx, cen, dev, span))

    # drift de centro desde pares petal-opuesto (cancela el radio real)
    aE, aNE, aN, aNW, aW, aSW, aS, aSE = range(8)
    rr = {}
    for k in (0, 2, 4, 6):
        ux, uy = L.axis_dirs(k)
        coreD = L.bilin(Df, cx + ux * L.RMID, cy + uy * L.RMID)
        rr[k] = L.cross_along(Df, cx, cy, 60.0, 150.0, ux, uy, 0.5 * coreD, True)
    dx = ((L.R0 - rr[0]) + (rr[4] - L.R0)) / 2.0
    dy = ((L.R0 - rr[2]) + (rr[6] - L.R0)) / 2.0
    print("center drift from tip pairs: dx=%+.2f dy=%+.2f px" % (dx, dy))
