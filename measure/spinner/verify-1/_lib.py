# -*- coding: utf-8 -*-
"""Helpers compartidos para la verificacion adversaria de measure/spinner."""
import math, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))            # measure/spinner/verify-1
ROOT = os.path.dirname(HERE)                                  # measure/spinner

def load():
    ri = Image.open(os.path.join(ROOT, "ref-spec.png"))
    ni = Image.open(os.path.join(ROOT, "render.png"))
    ref = np.asarray(ri.convert("RGB"), dtype=np.float64)
    ren = np.asarray(ni.convert("RGB"), dtype=np.float64)
    assert ref.shape == ren.shape == (640, 640, 3), (ref.shape, ren.shape)
    return (ref, ren, dict(ref_fmt=ri.format, ref_mode=ri.mode,
                           ren_fmt=ni.format, ren_mode=ni.mode))

BG = np.array([126.0, 33.0, 35.0])            # plato #7E2123
PET = np.array([241.0, 80.0, 75.0])           # petalo #F1504B
CORED = float(np.abs(PET - BG).mean())        # valor del campo D con alpha=1
S = 580.0
R0 = 0.16 * S                  # 92.8
LSPEC = 0.30 * S               # 174.0
WID = 0.105 * S                # 60.9
R1 = R0 + LSPEC                # 266.8
RMID = (R0 + R1) / 2.0         # 179.8
RAMP = [1.00, 0.88, 0.76, 0.63, 0.50, 0.40, 0.31, 0.22]
NAMES = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"]
EXP_HW = math.sqrt((WID / 2.0) ** 2 - (WID / 4.0) ** 2)   # 26.37 half-width del cap en R0+W/4

def field(img):
    return np.abs(img - BG).mean(axis=2)

def bilin(F, x, y):
    h, w = F.shape
    x = min(max(x, 0.0), w - 1.0)
    y = min(max(y, 0.0), h - 1.0)
    x0 = min(int(x), w - 2)
    y0 = min(int(y), h - 2)
    fx = x - x0
    fy = y - y0
    return (F[y0, x0] * (1 - fx) * (1 - fy) + F[y0, x0 + 1] * fx * (1 - fy)
            + F[y0 + 1, x0] * (1 - fx) * fy + F[y0 + 1, x0 + 1] * fx * fy)

def bilin_grid(F, X, Y):
    h, w = F.shape
    x0 = np.clip(np.floor(X).astype(np.intp), 0, w - 2)
    y0 = np.clip(np.floor(Y).astype(np.intp), 0, h - 2)
    fx = X - x0
    fy = Y - y0
    return (F[y0, x0] * (1 - fx) * (1 - fy) + F[y0, x0 + 1] * fx * (1 - fy)
            + F[y0 + 1, x0] * (1 - fx) * fy + F[y0 + 1, x0 + 1] * fx * fy)

def axis_dirs(k):
    rad = math.radians(k * 45.0)
    return math.cos(rad), -math.sin(rad)   # ux, uy en coords de imagen (y hacia abajo)

def cross_along(F, cx, cy, t0, t1, ux, uy, thr, rising, step=0.25):
    prev = bilin(F, cx + ux * t0, cy + uy * t0)
    t = t0
    while t < t1:
        t += step
        v = bilin(F, cx + ux * t, cy + uy * t)
        if rising and prev < thr <= v:
            f = (thr - prev) / max(v - prev, 1e-9)
            return t - step + step * f
        if (not rising) and prev >= thr > v:
            f = (prev - thr) / max(prev - v, 1e-9)
            return t - step + step * f
        prev = v
    return None

def perp_cross(F, px, py, vx, vy, v0, sign, maxo=42.0):
    thr = 0.5 * v0
    o = 0.0
    prev_o = 0.0
    prev_v = v0
    while abs(o) < maxo:
        o += sign * 0.25
        v = bilin(F, px + vx * o, py + vy * o)
        if v < thr:
            f = (prev_v - thr) / max(prev_v - v, 1e-9)
            return prev_o + (o - prev_o) * f
        prev_v = v
        prev_o = o
    return None

def petal_core_median(img, cx, cy, k, half=6):
    ux, uy = axis_dirs(k)
    xi = int(round(cx + ux * RMID))
    yi = int(round(cy + uy * RMID))
    patch = img[yi - half:yi + half + 1, xi - half:xi + half + 1].reshape(-1, 3)
    return np.median(patch, axis=0)
