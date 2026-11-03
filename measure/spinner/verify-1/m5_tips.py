# -*- coding: utf-8 -*-
# M5: puntas de caps con 2 decimales (ren) para cerrar r0/r1 por lado + cortes RGB en bordes.
import numpy as np
import _lib as L

ref, ren, _ = L.load()
Dr = L.field(ref)
Dn = L.field(ren)

def d2(x):
    return ("%6.2f" % x)

def dump(tag, Df, img, y0, y1, x0, x1, label):
    print("---- %s %s y[%d..%d] x[%d..%d] (D)" % (tag, label, y0, y1, x0, x1))
    print("      " + "".join("%7d" % x for x in range(x0, x1 + 1)))
    for y in range(y0, y1 + 1):
        print("y%4d " % y + "".join("%7.2f" % Df[y, x] for x in range(x0, x1 + 1)))

def edge_rows(tag, Df, y, x0, x1, label):
    # perfil exacto de una fila con RGB
    print("%s %s row y=%d:" % (tag, label, y))
    for x in range(x0, x1 + 1):
        print("  x=%d rgb=%s D=%.2f" % (x, tuple(int(v) for v in img[y, x]), Df[y, x]))

for tag, Df, img in (("ref", Dr, ref), ("ren", Dn, ren)):
    dump(tag, Df, img, 314, 328, 576, 592, "E OUTER cap tip")
    dump(tag, Df, img, 404, 420, 310, 330, "S INNER cap tip (top of S petal)")
    dump(tag, Df, img, 48, 64, 312, 330, "N OUTER cap tip (top)")
    dump(tag, Df, img, 312, 328, 218, 234, "W INNER cap tip (right end of W)")

# coverage exacto de filas de borde para E y W (ren): filas 289..292 x 348..352 ya visibles;
# aqui perfiles RGB de las filas de transicion del E petal (ren)
edge_rows("ren", Dn, ren, 290, 496, 502, "E top edge row 290")
edge_rows("ren", Dn, ren, 352, 496, 502, "E bottom edge row 352")
edge_rows("ren", Dn, ren, 586, 318, 322, "S bottom tip row 586")
edge_rows("ren", Dn, ren, 587, 318, 322, "S bottom tip row 587")
