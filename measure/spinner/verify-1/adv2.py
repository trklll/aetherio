# -*- coding: utf-8 -*-
"""Adv pass #2: angles, interior colors, 4-param center fit, per-petal width/offset,
ghost-row AA census per petal, ren-vs-ref perimeter stats."""
import math, numpy as np
from PIL import Image

ROOT = r"C:/Users/Administrator/Documents/Projects/aetherio/measure/spinner"
ref  = np.asarray(Image.open(f"{ROOT}/ref-spec.png").convert("RGB"), dtype=np.float64)
ren  = np.asarray(Image.open(f"{ROOT}/render.png").convert("RGB"), dtype=np.float64)
BG   = np.array([126.0,33.0,35.0]); PET = np.array([241.0,80.0,75.0])
S=580.0; R0S=.16*S; R1S=R0S+.30*S; RM=.298*S; W=.105*S
RAMP=[1.0,.88,.76,.63,.5,.4,.31,.22]; NAMES=["E","NE","N","NW","W","SW","S","SE"]
A=[]
def ckn(name, ok, val=None):
    A.append((name,bool(ok))); print(("PASS " if ok else "FAIL ")+name, ("= "+str(val)) if val is not None else "")
def field(img): return np.abs(img-BG).mean(axis=2)
FREF, FREN = field(ref), field(ren)
yy, xx = np.mgrid[0:640,0:640]
RX, RY = xx-320.0, yy-320.0
RR = np.hypot(RX,RY)
ANG = (np.degrees(np.arctan2(-RY, RX)) % 360.0)   # visual CCW deg from East, y-down corrected
CORE = [ RAMP[k]*float(np.abs(PET-BG).mean()) for k in range(8) ]   # D field = alpha * 67.333

print("== 1b) angular mean & error per petal (trunk band r in [126,236], D>50% core) ==")
res={}
for tag,F in (("ref",FREF),("ren",FREN)):
    rows=[]
    for k in range(8):
        wedge  = (np.abs(((ANG - k*45.0 + 180) % 360) - 180) < 22.5)
        trunk  = wedge & (RR>126) & (RR<236) & (F > .5*CORE[k])
        err = ((ANG[trunk] - k*45 + 180) % 360) - 180
        rows.append((trunk.sum(), err.mean(), err.std(), err.min(), err.max()))
        print(f"  {tag} {NAMES[k]:2s} npx={int(trunk.sum()):6d} meanErr={err.mean():+.4f}deg std={err.std():.3f} min={err.min():+.2f} max={err.max():+.2f}")
        if tag=="ren":
            ckn(f"angle-error ren {NAMES[k]} |mean|<=0.75deg & |maxdev|<=1.6deg",
                abs(err.mean())<=0.75 and max(abs(err.min()), abs(err.max()))<=1.6,
                f"mean {err.mean():+.3f} maxdev {max(abs(err.min()),abs(err.max())):+.2f}")
    res[tag]=rows

print("== 3b) interior color re-check (rows inside trunk, away from edges) ==")
def med(img,x,y,h=1):
    return tuple(int(round(v)) for v in np.median(img[y-h:y+h+1,x-h:x+h+1].reshape(-1,3),axis=0))
pts=[(500,300),(500,340),(470,320),(530,320)]
for tag,img in (("ref",ref),("ren",ren)):
    vals=[med(img,x,y) for x,y in pts]
    print(tag,"E trunk interior 3x3 medians:",vals)
    ckn(f"{tag} petal-E interior == (241,80,75)", all(p==(241,80,75) for p in vals))
    bgs=[med(img,x,y) for x,y in [(160,160),(480,160),(160,480),(480,480),(320,80),(320,560)]]
    print(tag,"bg herringbone medians:",bgs)
    ckn(f"{tag} bg interior == (126,33,35)", all(p==(126,33,35) for p in bgs))

print("== 6b) proper center fit: 16 tips, per-tip radius class (4 params) ==")
def axis_edges(F,k):
    ux,uy=math.cos(math.radians(k*45)),-math.sin(math.radians(k*45))
    t=np.arange(-30,310,.25); v=np.empty(len(t))
    X=320+ux*t; Y=320+uy*t
    x0=np.clip(np.floor(X).astype(int),0,638); y0=np.clip(np.floor(Y).astype(int),0,638)
    fx,fy=X-x0,Y-y0
    v=(F[y0,x0]*(1-fx)*(1-fy)+F[y0,x0+1]*fx*(1-fy)+F[y0+1,x0]*(1-fx)*fy+F[y0+1,x0+1]*fx*fy)
    vmid=(F[320,320+u_dense] if False else None)
    vm=np.array([F[int(round(320+uy*RM)), int(round(320+ux*RM))]])[0]
    thr=vm*.5
    ink=np.where(v>=thr)[0]; i0,i1=ink[0],ink[-1]
    r_in = t[i0]+.25*(thr-v[i0-1])/max(v[i0]-v[i0-1],1e-9)
    r_out= t[i1-1]+.25*(v[i1-1]-thr)/max(v[i1-1]-v[i1],1e-9)
    return r_in,r_out
def fit4(F):
    pts,cls=[],[]
    for k in range(8):
        ux,uy=math.cos(math.radians(k*45)),-math.sin(math.radians(k*45))
        ri,ro=axis_edges(F,k)
        if F[(320+uy*int(ri)) if False else 0,0] is None: pass
        pts.append([320+ux*ri,320+uy*ri]); cls.append(0)
        pts.append([320+ux*ro,320+uy*ro]); cls.append(1)
    P=np.array(pts); cls=np.array(cls)
    c=np.array([320.,320.]); r=[92.8,266.8]
    for it in range(40):
        d=P-c; n=np.hypot(d[:,0],d[:,1])
        nm=np.array([r[c_] for c_ in cls])
        e=n-nm
        J=np.zeros((16,4)); J[:,:2]=-d/n[:,None]
        for i in range(16):
            J[i,2+cls[i]]=1.0
        delta=np.linalg.lstsq(J,e,rcond=None)[0]
        c-=delta[:2]; r[0]-=delta[2]; r[1]-=delta[3]
        if np.max(np.abs(delta))<1e-7: break
    d=P-c; n=np.hypot(d[:,0],d[:,1]); nm=np.array([r[c_] for c_ in cls])
    return c,r,(n-nm)
for tag,F in (("ref",FREF),("ren",FREN)):
    c,r,resid=fit4(F)
    print(f"  {tag} center=({c[0]:.3f},{c[1]:.3f}) r0={r[0]:.2f} r1={r[1]:.2f} |tipresid| max={np.abs(resid).max():.3f}")
    ckn(f"{tag} center |fit-(320,320)|<=1.0", abs(c[0]-320)<=1 and abs(c[1]-320)<=1, f"({c[0]:.2f},{c[1]:.2f})")
    ckn(f"{tag} center |fit-(320,320)|<=0.5", abs(c[0]-320)<=.5 and abs(c[1]-320)<=.5, f"({c[0]:.2f},{c[1]:.2f})")
    ckn(f"{tag} tips |resid|<=1.2px", np.abs(resid).max()<=1.2, round(float(np.abs(resid).max()),2))
    ckn(f"{tag} r0 within spec 92.8 +- 2.0", abs(r[0]-92.8)<=2.0, round(r[0],2))
    ckn(f"{tag} r1 within spec 266.8 +- 2.0", abs(r[1]-266.8)<=2.0, round(r[1],2))

print("== 5b) per-petal width & perpendicular offset @ t=180 ==")
def perp(F,k,t):
    ux,uy=math.cos(math.radians(k*45)),-math.sin(math.radians(k*45))
    px,py=320+ux*t,320+uy*t; vx,vy=-uy,ux
    s=np.arange(-44,44.0001,.25)
    X=px+vx*s; Y=py+vy*s
    v=np.empty(len(s))
    x0=np.clip(np.floor(X).astype(int),0,638); y0=np.clip(np.floor(Y).astype(int),0,638)
    fx,fy=X-x0,Y-y0
    v=(F[y0,x0]*(1-fx)*(1-fy)+F[y0,x0+1]*fx*(1-fy)+F[y0+1,x0]*(1-fx)*fy+F[y0+1,x0+1]*fx*fy)
    vm=float(F[int(round(py)),int(round(px))])
    thr=vm*.5
    ink=np.where(v>=thr)[0]; e0,e1=ink[0],ink[-1]
    sL=s[e0]+.25*(thr-v[e0-1])/max(v[e0]-v[e0-1],1e-9)
    sR=s[e1-1]+.25*(v[e1-1]-thr)/max(v[e1-1]-v[e1],1e-9)
    return sR-sL,(sR+sL)/2.0
ws={}
for tag,F in (("ref",FREF),("ren",FREN)):
    ws[tag]=[]
    for k in range(8):
        w,off=perp(F,k,180.0)
        ws[tag].append((w,off))
        print(f"  {tag} {NAMES[k]:2s} width@180={w:6.2f} (spec {W:.1f}) perp_off={off:+.2f}")
    ckn(f"{tag} widths |w-{W:.0f}.0|<=1.0 all", all(abs(a-W)<=1.0 for a,_ in ws[tag]),
        ", ".join(NAMES[k]+f":{ws[tag][k][0]:.2f}" for k in range(8)))
dW=[ws["ren"][k][0]-ws["ref"][k][0] for k in range(8)]
dO=[ws["ren"][k][1]-ws["ref"][k][1] for k in range(8)]
print("  ren-ref width delta:", ", ".join(NAMES[k]+f":{dW[k]:+.2f}" for k in range(8)))
print("  ren-ref perp offset delta:", ", ".join(NAMES[k]+f":{dO[k]:+.2f}" for k in range(8)))
nOver=sum(1 for k in range(8) if dW[k]>0.5)
ckn("ren petals ~1px wider than ref on >5 petals (finding, expect TRUE)", nOver>5, f"{nOver}/8")
print("== 7b) ghost-row census: trunk-annulus px at 5-95% of core, per petal ==")
print("  (axis petals E/W/N/S should be 0 if hard edges)")
for tag,F in (("ref",FREF),("ren",FREN)):
    out=[]
    for k in range(8):
        wedge=(np.abs(((ANG-k*45+180)%360)-180)<22.5)
        trunk=wedge&(RR>126)&(RR<236)
        v=F[trunk]; c=CORE[k]
        cnt=int(((v>0.05*c)&(v<0.95*c)).sum())
        out.append(cnt)
    print(" ",tag,"ghost px per petal:", ", ".join(NAMES[k]+f":{out[k]}" for k in range(8)))
print("== assertions ==")
aok=sum(1 for _,ok in A if ok); afail=len(A)-aok
print("pass:",aok," fail:",afail," total:",len(A))
for nm,ok in A:
    if not ok: print("  FAILED:",nm)
