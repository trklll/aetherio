"""Screenshot del clon vía http server + playwright (python). Nunca file://.

Por defecto dispara el plato de REFERENCIA (.plate--ref) en viewport 320x320 dpr2
→ render.png de 640x640, comparable con ref-spec.png.
`python shot.py --plate aeth` → plato aetherio (para la variante blanca).
"""
import http.server, socketserver, threading, sys, functools, os
from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.abspath(__file__))

PORT = 4173
plate = "ref"
for i, a in enumerate(sys.argv):
    if a == "--plate" and i + 1 < len(sys.argv):
        plate = sys.argv[i + 1]

PlateCls = {"ref": "plate--ref", "aeth": "plate--aeth"}[plate]
out_name = "render.png" if plate == "ref" else "render-aeth.png"

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=BASE)
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
t = threading.Thread(target=httpd.serve_forever, daemon=True)
t.start()

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 320, "height": 320}, device_scale_factor=2)
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"http://127.0.0.1:{PORT}/clone/index.html?frozen=1")
        pg.wait_for_function('document.fonts.status === "loaded"')
        pg.wait_for_selector(f".{PlateCls}", timeout=5000)
        el = pg.query_selector(f".{PlateCls}")
        el.screenshot(path=os.path.join(BASE, out_name))
        if errors:
            print("CONSOLE ERRORS:", errors)
        else:
            print("console: 0 errors")
        b.close()
finally:
    httpd.shutdown()
print("shot ok ->", out_name)
