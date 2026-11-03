"""Genera ref-spec.png (640x640): reconstrucción de la referencia pegada en chat.

Implementación INDEPENDIENTE del clon CSS (cross-check real de la geometría):
mismos números del ANALYSIS.md, cap redondeado de `stroke` en vez de cápsula CSS.
Escala: 2x del clon (S=580 en canvas 640, margen 30 por lado).
"""
from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ref-spec.png")

W = H = 640
BG = (126, 33, 35)        # #7E2123
PETAL = (241, 80, 75)     # #F1504B

S = 580.0                 # diámetro disco (2x de 290)
CX = W / 2.0
CY = H / 2.0
L = 0.30 * S              # 174
WIDTH = 0.105 * S         # 60.9
R0 = 0.16 * S             # 92.8
R1 = R0 + L               # 266.8
RMID = (R0 + R1) / 2.0    # 179.8

# Rampa (head→tail). Ángulo: visual CCW desde Este (screen Y hacia abajo ⇒ dy=-sin)
RAMP = [1.00, 0.88, 0.76, 0.63, 0.50, 0.40, 0.31, 0.22]
ANGLES = [a * 45.0 for a in range(8)]   # E, NE, N, NW, W, SW, S, SE

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

for alpha, ang in zip(RAMP, ANGLES):
    rad = math.radians(ang)
    dx, dy = math.cos(rad), -math.sin(rad)          # y hacia arriba visual
    # cápsula exacta: tronco [R0+W/2, R1-W/2] + cap redondo W/2 en cada extremo
    # ⇒ longitud total = L (igual que la cápsula CSS del clon)
    r_cap = WIDTH / 2.0
    x0, y0 = CX + dx * (R0 + r_cap), CY + dy * (R0 + r_cap)
    x1, y1 = CX + dx * (R1 - r_cap), CY + dy * (R1 - r_cap)
    col = tuple(int(c * alpha + BGc * (1 - alpha)) for c, BGc in zip(PETAL, BG))
    d.line([(x0, y0), (x1, y1)], fill=col, width=round(WIDTH))
    for x, y in ((x0, y0), (x1, y1)):
        d.ellipse([x - r_cap, y - r_cap, x + r_cap, y + r_cap], fill=col)

img.save(OUT)
print("spec ok ->", OUT, img.size)
