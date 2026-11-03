# -*- coding: utf-8 -*-
# M3: dumps crudos de pixels (D redondeado + RGB) para evidencia de borde/cap/esquina.
import numpy as np
import _lib as L

ref, ren, _ = L.load()
Dr = L.field(ref)
Dn = L.field(ren)

def dump(tag, Df, y0, y1, x0, x1, label, rgb_row=None):
    print("---- %s %s  y[%d..%d] x[%d..%d]  (D)" % (tag, label, y0, y1, x0, x1))
    print("     " + "".join("%5d" % x for x in range(x0, x1 + 1)))
    for y in range(y0, y1 + 1):
        print("y%3d " % y + "".join("%5.0f" % round(Df[y, x]) for x in range(x0, x1 + 1)))
    if rgb_row is not None:
        for y in ([rgb_row] if isinstance(rgb_row, int) else rgb_row):
            print("  RGB y=%d:" % y)
            for x in range(x0, x1 + 1):
                print("   x=%d rgb=%s D=%.1f" % (x, tuple(int(v) for v in ren[y, x]), Dn[y, x]))

for tag, Df in (("ref", Dr), ("ren", Dn)):
    dump(tag, Df, 284, 296, 495, 501, "E petal TOP edge trunk")
    dump(tag, Df, 344, 356, 495, 501, "E petal BOTTOM edge trunk")
    dump(tag, Df, 96, 104, 285, 296, "N petal LEFT edge trunk")
    dump(tag, Df, 96, 104, 344, 355, "N petal RIGHT edge trunk")
    dump(tag, Df, 314, 326, 406, 420, "E inner cap tip")
    dump(tag, Df, 380, 392, 378, 392, "SE inner cap tip")

dump("ren", Dn, 0, 13, 0, 13, "corner top-left (page-bg)")
print("corner RGB ren:")
for y in (0, 1, 2, 3, 5, 7, 10, 13):
    print("  y=%d:" % y + "".join(" (%d,%d)=%s" % (x, y, tuple(int(v) for v in ren[y, x])) for x in (0, 1, 2, 3, 5, 7, 10, 13)))
