# -*- coding: utf-8 -*-
"""Adversarial verification (fresh independent pass) — ref-spec.png vs render.png.
Only python + PIL + numpy. cx=cy=320 per brief; own diffmap; counts assertions."""
import math, numpy as np
from PIL import Image

ROOT = r"C:/Users/Administrator/Documents/Projects/aetherio/measure/spinner"
ref = np.asarray(Image.open(f"{ROOT}/ref-spec.png").convert("RGB"), dtype=np.float64)
ren = np.asarray(Image.open(f"{ROOT}/render.png").convert("RGB"), dtype=np.float64)

BG  = np.array([126.0, 33.0, 35.0]);  PET = np.array([241.0, 80.0, 75.0])
S    = 580.0
R0S, LS, W = .16*S, .30*S, .105*S           # 92.8 / 174.0 / 60.9 dev px
R1S  = R0S + LS                              # 266.8
RM   = .298*S                                # 179.84
RAMP = [1.00, .88, .76, .63, .50, .40, .31, .22]
NAMES= ["E","NE","N","NW","W","SW","S","SE"]
A = []  # assertions
def chk(name, val, ok):
    A.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name, "=", val)

def ck(name, ok, val=None):
    A.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name, ("= " + str(val)) if val is not None else "")

def field(img): return np.abs(img - BG).mean(axis=2)
FREF, FREN = field(ref), field(ren)

def bl(F, X, Y):
    x0 = np.clip(np.floor(X).astype(int), 0, F.shape[1]-2); y0 = np.clip(np.floor(Y).astype(int), 0, F.shape[0]-2)
    fx, fy = X-x0, Y-y0
    return (F[y0,x0]*(1-fx)*(1-fy) + F[y0,x0+1]*fx*(1-fy) +
            F[y0+1,x0]*(1-fx)*fy + F[y0+1,x0+1]*fx*fy)

def dirs(k):
    a = math.radians(k*45.0)
    return math.cos(a), -math.sin(a)      # ux, uy image coords (y down); CCW visual

def axis_edges(F, k, cx=320.0, cy=320.0):
    """inner/outer 50%-elevation crossings along petal axis, sub-px, vectorized."""
    ux, uy = dirs(k)
    t = np.arange(-30.0, 310.0, 0.25)
    v = bl(F, cx+ux*t, cy+uy*t)
    vmid = bl(F, np.array([cx+ux*RM]), np.array([cy+uy*RM]))[0]
    thr = vmid * 0.5
    ink = np.where(v >= thr)[0]
    i0, i1 = ink[0], ink[-1]
    r_in  = t[i0] + .25*(thr - v[i0-1]) / max(v[i0] - v[i0-1], 1e-9)
    r_out = t[i1-1] + .25*(v[i1-1] - thr) / max(v[i1-1] - v[i1], 1e-9)
    return r_in, r_out, vmid, thr

def perp_profile(F, k, t, cx=320.0, cy=320.0):
    ux, uy = dirs(k); px, py = cx+ux*t, cy+uy*t
    vx, vy = -uy, ux
    s = np.arange(-44.0, 44.0001, 0.25)
    v = bl(F, px+vx*s, py+vy*s)
    vmid = bl(F, np.array([px]), np.array([py]))[0]
    thr = vmid * 0.5
    ink = np.where(v >= thr)[0]
    e0, e1 = ink[0], ink[-1]
    sL = s[e0] + .25*(thr - v[e0-1]) / max(v[e0] - v[e0-1], 1e-9)
    sR = s[e1-1] + .25*(v[e1-1] - thr) / max(v[e1-1] - v[e1], 1e-9)
    return sR - sL, (sR + sL) / 2.0

print("== 1) per-petal polar edges (r0/r1, L, angle-error) ==")
tabs = {}
for tag, F in (("ref", FREF), ("ren", FREN)):
    rows = []
    for k in range(8):
        ri, ro, vmid, thr = axis_edges(F, k)
        Lk = ro - ri
        rows.append((k, ri, ro, Lk))
    tabs[tag] = rows
    print(tag, "petal: r0, r1, L, dL(r1-r0spec.524?)")
for k in range(8):
    rr = tabs["ref"][k]; nr = tabs["ren"][k]
    print(f"  {NAMES[k]:2s} ref r0={rr[1]:6.2f} r1={rr[2]:6.2f} L={rr[3]:6.2f} | "
          f"ren r0={nr[1]:6.2f} r1={nr[2]:6.2f} L={nr[3]:6.2f} | dL={nr[3]-rr[3]:+5.2f}")

print("== 2) implied alpha per petal (R channel, 7x7 median at rmid) ==")
def core_rgb(img, k, half=3):
    ux, uy = dirs(k)
    xi = int(round(320 + ux*RM)); yi = int(round(320 + uy*RM))
    patch = img[yi-half:yi+half+1, xi-half:xi+half+1].reshape(-1, 3)
    return np.median(patch, axis=0)
aR = {}
for tag, img in (("ref", ref), ("ren", ren)):
    al = []
    for k in range(8):
        c = core_rgb(img, k)
        al.append((c[0]-126.0)/115.0)
    aR[tag] = al
    print(tag, "  ".join(f"{NAMES[k]}={al[k]:.3f}" for k in range(8)))
dev = [aR["ren"][k] - aR["ref"][k] for k in range(8)]
print("ren alphaR vs spec:", "  ".join(f"{NAMES[k]}={aR['ren'][k]-RAMP[k]:+.3f}" for k in range(8)))
mramp = max(abs(aR['ren'][k]-RAMP[k]) for k in range(8))
ck("ramp alphaR ren vs spec |dev|<=0.02 all petals", mramp <= 0.02, round(mramp, 4))
print("== 3) colors: 3x3 exact at petal E & bg ==")
def c3(img, x, y): return int(round(img[y-1:y+2, x-1:x+2].reshape(-1,3).mean(0)[0])), 0
pts_e = [(500,320),(468,320),(532,320),(500,290),(500,350)]
pts_b = [(30,30),(600,30),(30,600),(600,600),(320,30)]
def sample(img, pts, tag):
    out = []
    for x, y in pts:
        p = img[y-1:y+2, x-1:x+2].reshape(-1,3).mean(0)
        out.append(tuple(int(round(v)) for v in p))
    return out
se, sb = sample(ren, pts_e, "E"), sample(ren, pts_b, "bg")
re_, rb = sample(ref, pts_e, "E"), sample(ref, pts_b, "bg")
print("ren petalE pts:", se)
print("ren bg pts:", sb)
print("ref petalE pts:", re_)
print("ref bg pts:", rb)
okE = all(p == (241,80,75) for p in se); okB = all(p == (126,33,35) for p in sb)
okE_ref = all(p == (241,80,75) for p in re_); okB_ref = all(p == (126,33,35) for p in rb)
ck("ren petal-E exact #F1504B", okE); ck("ren bg exact #7E2123", okB)
ck("ref petal-E exact #F1504B", okE_ref); ck("ref bg exact #7E2123", okB_ref)
print("== 4) central hole (r<40) ==")
yy, xx = np.mgrid[0:640, 0:640]
RR = np.hypot(xx-320.0, yy-320.0)
for tag, F in (("ref", FREF), ("ren", FREN)):
    m = RR < 40.0
    print(tag, "max D r<40 =", F[m].max())
    rh = None
    for r in np.arange(0, 130, .5):
        if F[(RR >= r) & (RR < r+.5)].max(initial=0.0) >= 6.0:   # any real ink (>=6 D)
            rh = r; break
    print(tag, " first annulus with D>=6 at r =", rh)
ck("ren hole r<40 max D == 0", float(FREN[RR<40].max()) == 0.0)
print("== 5) petal E radial profile: width / stations / tips roundness ==")
stations = [130.0, 150.0, 170.0, 190.0, 210.0, 230.0]
for tag, F in (("ref", FREF), ("ren", FREN)):
    ws = []
    for t in stations:
        w, off = perp_profile(F, 0, t)
        ws.append((t, w, off))
    print(tag, "E stations (t, width, perp_offset):")
    for t, w, off in ws: print(f"   t={t:5.1f}  w={w:6.2f}  off={off:+5.2f}")
cap_R = W/2.0
for tag, F in (("ref", FREF), ("ren", FREN)):
    for lbl, t0 in (("inner", R0S), ("outer", R1S)):
        prof = []
        for d in (0.5, 1.0, 3.0, 6.0, 10.0):
            w, _ = perp_profile(F, 0, t0 + d if lbl == "inner" else t0 - d)
            exp = 2*math.sqrt(max(cap_R**2 - (cap_R-d)**2, 0.0))
            prof.append((d, w, exp))
        print(tag, f"E {lbl}-tip width vs capsule model (d, measured, model):",
              " ".join(f"{d}:{w:.1f}/{e:.1f}" for d, w, e in prof))
print("== 6) full-cone center fit (16 tips, LS) ==")
def fit_center(F, c0=(320.0, 320.0)):
    pts, rs = [], []
    for k in range(8):
        ux, uy = dirs(k)
        ri, ro, _, _ = axis_edges(F, k)
        pts.append((c0[0]+ux*ri, c0[1]+uy*ri)); pts.append((c0[0]+ux*ro, c0[1]+uy*ro))
    P = np.array(pts)
    c = np.array(c0, float)
    for it in range(30):
        d = P - c; n = np.hypot(d[:,0], d[:,1]); rbar = n.mean()
        e = n - rbar
        J = -d / n[:, None]
        JtJ = J.T @ J + np.eye(2)*1e-9
        delta = np.linalg.solve(JtJ, J.T @ e)
        c -= delta
        if np.max(np.abs(delta)) < 1e-6: break
    resid = np.hypot(*(P-c).T) - (np.hypot(*(P-c).T)).mean()
    return c, resid
for tag, F in (("ref", FREF), ("ren", FREN)):
    c, r = fit_center(F)
    print(tag, "center fit:", np.round(c, 2), "| tip resid min..max px:", round(float(r.min()),2), round(float(r.max()),2))
print("== 7) hard-edge AA quantification (rows 5-95% across straight edges) ==")
def aa_rows(img, x, y0, y1):
    col = img[y0:y1, x, :].astype(float)
    Fv = np.abs(col - BG).mean(1)
    vtop = Fv.max()
    band = (Fv > 0.05*vtop) & (Fv < 0.95*vtop)
    return int(band.sum()), list(np.round(Fv, 1))
for tag, img in (("ref", ref), ("ren", ren)):
    nT, vt = aa_rows(img, 498, 287, 293)
    nB, vb = aa_rows(img, 498, 349, 355)
    print(tag, f"E petal x=498 top AA rows={nT}/{len(vt)}  bottom={nB}/{len(vb)}")
    print("   top  D profile:", vt)
    print("   bot  D profile:", vb)
for tag, img in (("ref", ref), ("ren", ren)):
    col = img[140:150, 289:293, :].astype(float)
    Fv = np.abs(col - BG).mean(2)
    rows = [list(np.round(r, 1)) for r in Fv]
    print(tag, "N petal rows y140..149 cols x289..292 F:")
    for r in rows: print("   ", r)
print("== 8) globals & diffmap ==")
d = np.abs(ref - ren).mean(axis=2)
print("diff mean|d|=", round(d.mean(),3), " p50=", round(np.percentile(d,50),3),
      " p95=", round(np.percentile(d,95),2), " p99=", round(np.percentile(d,99),2),
      " max=", round(d.max(),1))
d_noc = d.copy(); d_noc[(RR > 440)] = 0.0
print("diff excluding corners(r>440): mean=", round(d_noc.mean(), 4),
      " max=", round(d_noc.max(), 2))
inkA = (FREF > 12) & (RR < 300); inkB = (FREN > 12) & (RR < 300)
union = inkA | inkB
print("ink px (D>12, r<300): ref=", int(inkA.sum()), " ren=", int(inkB.sum()),
      " ratio=", round(inkB.sum()/inkA.sum(), 4))
print("mean|d| on ink-union:", round(float(d[union].mean()), 3))
hot = np.argwhere(d > 8)
print("hot px (d>8):", len(hot),
      " sample:", [tuple(int(v) for v in p) for p in hot[:12]])
from PIL import Image as I
I.fromarray(np.clip(255 - d*8, 0, 255).astype(np.uint8)).save(f"{ROOT}/verify-1/adv_diff.png")
print("saved diffmap -> verify-1/adv_diff.png")
print("== plate corners (page bg leak) ==")
def corner_bg(img):
    n = 0
    for cy0, cx0, sy, sx in ((0,0,1,1),(0,639,1,-1),(639,0,-1,1),(639,639,-1,-1)):
        for yy2 in range(14):
            for xx2 in range(14):
                p = img[cy0 + sy*yy2, cx0 + sx*xx2]
                if abs(p[0]-11) < 4 and abs(p[1]-11) < 4 and abs(p[2]-12) < 4: n += 1
    return n
print("page-bg(11,11,12)px in 14px corner squares: ref=", corner_bg(ref), " ren=", corner_bg(ren))
print("== assertions ==")
aok = sum(1 for _, ok in A if ok); afail = len(A) - aok
print("total:", len(A), " pass:", aok, " fail:", afail)
for nm, ok in A:
    if not ok: print("  FAILED:", nm)
