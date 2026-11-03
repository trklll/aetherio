# -*- coding: utf-8 -*-
"""Adv pass #3: fixed center fit (J sign), true bg points, angle-mean-only verdict."""
import math, numpy as np
from PIL import Image

ROOT = r"C:/Users/Administrator/Documents/Projects/aetherio/measure/spinner"
ref  = np.asarray(Image.open(f"{ROOT}/ref-spec.png").convert("RGB"), dtype=np.float64)
ren  = np.asarray(Image.open(f"{ROOT}/render.png").convert("RGB"), dtype=np.float64)
BG = np.array([126.0,33.0,35.0]); PET = np.array([241.0,80.0,75.0])
RM=.298*580.0
CORE = float(np.abs(PET-BG).mean())     # 67.333 per unit alpha
A=[]
def ckn(n, ok, val=None):
    A.append((n,bool(ok))); print(("PASS " if ok else "FAIL ")+n, ("= "+str(val)) if val is not None else "")
def field(img): return np.abs(img-BG).mean(axis=2)
FREF,FREN = field(ref), field(ren)

def axis_edges(F,k):
    ux,uy=math.cos(math.radians(k*45)),-math.sin(math.radians(k*45))
    t=np.arange(-30,310,.25)
    X=320+ux*t; Y=320+uy*t
    x0=np.clip(np.floor(X).astype(int),0,638); y0=np.clip(np.floor(Y).astype(int),0,638)
    fx,fy=X-x0,Y-y0
    v=(F[y0,x0]*(1-fx)*(1-fy)+F[y0,x0+1]*fx*(1-fy)+F[y0+1,x0]*(1-fx)*fy+F[y0+1,x0+1]*fx*fy)
    vm=float(F[int(round(320+uy*RM)),int(round(320+ux*RM))]); thr=vm*.5
    ink=np.where(v>=thr)[0]; i0,i1=ink[0],ink[-1]
    r_in =t[i0]+.25*(thr-v[i0-1])/max(v[i0]-v[i0-1],1e-9)
    r_out=t[i1-1]+.25*(v[i1-1]-thr)/max(v[i1-1]-v[i1],1e-9)
    return r_in,r_out,vm

def fit4(F):
    pts,cls=[],[]
    for k in range(8):
        ux,uy=math.cos(math.radians(k*45)),-math.sin(math.radians(k*45))
        ri,ro,_=axis_edges(F,k)
        pts.append([320+ux*ri,320+uy*ri]); cls.append(0)
        pts.append([320+ux*ro,320+uy*ro]); cls.append(1)
    P=np.array(pts); cls=np.array(cls); c=np.array([320.,320.]); r=[92.8,266.8]
    for it in range(60):
        d=P-c; n=np.hypot(d[:,0],d[:,1])
        nm=np.array([r[k] for k in cls]); e=n-nm
        J=np.zeros((16,4)); J[:,:2]=-d/n[:,None]
        for i in range(16): J[i,2+cls[i]]=-1.0
        delta=np.linalg.solve(J.T@J+np.eye(4)*1e-9, J.T@e)
        c-=delta[:2]; r=[r[0]-delta[2], r[1]-delta[3]]
        if np.max(np.abs(delta))<1e-8: break
    d=P-c; n=np.hypot(d[:,0],d[:,1]); nm=np.array([r[k] for k in cls])
    return c,r,n-nm

print("== center fit (4-param, fixed) ==")
fits={}
for tag,F in (("ref",FREF),("ren",FREN)):
    c,r,resid = fit4(F)
    fits[tag]=(c,r,abs(resid))
    print(f"  {tag} center=({c[0]:+.2f},{c[1]:+.2f}) r0={r[0]:.2f} r1={r[1]:.2f} max|resid|={abs(resid).max():.3f}")
    ckn(f"{tag} center |fit-(320,320)|<=0.75px", abs(c[0]-320)<=.75 and abs(c[1]-320)<=.75, f"({c[0]:+.2f},{c[1]:+.2f})")
    ckn(f"{tag} tips |resid|<=1.5px", float(abs(resid).max())<=1.5, round(float(abs(resid).max()),2))
    ckn(f"{tag} r0 = 92.8 spec +-2.0", abs(r[0]-92.8)<=2.0, round(r[0],2))
    ckn(f"{tag} r1 = 266.8 spec +-2.0", abs(r[1]-266.8)<=2.0, round(r[1],2))
dr = (fits["ren"][0]-np.array([320,320]), fits["ref"][0]-np.array([320,320]))
print("  ren center offset:", np.round(dr[0],2), " ref center offset:", np.round(dr[1],2))

print("== TRUE bg points: hole ring r=70 / inter-petal 22.5deg r=250 / outside r=300 ==")
def median_at(F,x,y):
    return tuple(int(round(v)) for v in np.median(F[y-1:y+2,x-1:x+2].reshape(-1,3),axis=0))
pts=[(int(320-70.0),320)]  # W side, annular gap r=70
for k in range(8):
    a=math.radians(22.5+k*45.0); ux,uy=math.cos(a),-math.sin(a)
    pts.append((int(round(320+250*ux)), int(round(320+250*uy))))   # between petals
pts.append((int(320-300.0), int(320)))
for tag,img in (("ref",ref),("ren",ren)):
    vals=[median_at(img,x,y) for x,y in pts if 0<x<639 and 0<y<639]
    ok=all(p==(126,33,35) for p in vals)
    print(" ",tag,"bg medians:",vals)
    ckn(f"{tag} bg / r70-hrr / 8 interpetal / == (126,33,35)", ok)
