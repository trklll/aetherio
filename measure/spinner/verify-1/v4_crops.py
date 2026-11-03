# -*- coding: utf-8 -*-
# V4: crops de evidencia (ghost 50%, diff x8, tiras por petalo, zooms de bordes/caps).
import os
import numpy as np
from PIL import Image, ImageDraw
import _lib as L

ref, ren, _ = L.load()
ab = np.abs(ref - ren).mean(axis=2)
d8 = np.clip(ab * 8.0, 0, 255).astype(np.uint8)
Image.fromarray(((ref + ren) / 2.0).clip(0, 255).astype(np.uint8)).save(os.path.join(L.HERE, "ghost.png"))
Image.fromarray(d8).save(os.path.join(L.HERE, "ghostdiff8.png"))

def crop_img(arr, box):
    x0, y0, x1, y1 = box
    return Image.fromarray(arr[y0:y1, x0:x1].astype(np.uint8))

def strip(name, box, zoom=1):
    a = crop_img(ref, box)
    b = crop_img(ren, box)
    c = crop_img(d8, box)
    w, h = a.size
    cv = Image.new("RGB", (w * 3 + 8, h + 16), (240, 240, 240))
    cv.paste(a, (0, 16))
    cv.paste(b, (w + 4, 16))
    cv.paste(c, (2 * w + 8, 16))
    dr = ImageDraw.Draw(cv)
    dr.text((2, 2), name + " ref|ren|diff x8", fill=(0, 0, 0))
    if zoom != 1:
        cv = cv.resize((cv.size[0] * zoom, cv.size[1] * zoom), Image.NEAREST)
    cv.save(os.path.join(L.HERE, name + ".png"))
    print("saved", name, cv.size)

for k in range(8):
    ux, uy = L.axis_dirs(k)
    ax = int(round(320 + ux * L.RMID))
    ay = int(round(320 + uy * L.RMID))
    strip("petal-%d-%s" % (k, L.NAMES[k]), (ax - 105, ay - 105, ax + 105, ay + 105))

strip("center-200", (220, 220, 420, 420))
strip("z-e-inner-tip", (392, 270, 462, 370), zoom=4)
strip("z-e-top-edge", (450, 270, 570, 330), zoom=4)
ux, uy = L.axis_dirs(7)
sx = int(round(320 + ux * (L.R0 + L.WID / 2.0)))
sy = int(round(320 + uy * (L.R0 + L.WID / 2.0)))
strip("z-se-inner-tip", (sx - 40, sy - 40, sx + 40, sy + 40), zoom=4)
print("crops done ->", L.HERE)
