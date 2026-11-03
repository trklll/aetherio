# -*- coding: utf-8 -*-
"""T5-sweep: is horizontal overflow PHASE-DEPENDENT on the spinner rotation?
Reads scrollWidth/maxScrollLeft/AABB repeatedly: animated (16x80ms) vs frozen (4x250ms).
Viewports 320x320 and 800x600. Result -> sweep.json (+mirror)."""
import json, os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4191/clone/index.html"
OUT = r"C:\Users\Administrator\Documents\Projects\aetherio\measure\spinner\verify-2"
MIRROR = os.path.join(os.environ.get("TEMP", ""), "opencode", "spinner-verify2-mirror")

def sweep(page, url, n, dt):
    page.goto(url, wait_until="load")
    page.wait_for_timeout(150)
    samples = []
    for k in range(n):
        s = page.evaluate("""() => {
            const d = document.scrollingElement;
            const sp = document.querySelector('#ref-spinner');
            const r = sp.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            // AABB right of the rotating box, in page coords (rect includes rotation)
            return {sw: d.scrollWidth, sl: Math.round(d.scrollLeft),
                    swl: Math.round(d.scrollWidth - d.clientWidth),
                    aabb_right_raw: Math.round(r.right), scrollX: window.scrollX};
        }""")
        samples.append(s)
        page.wait_for_timeout(dt)
    sws = [x["sw"] for x in samples]
    sls = [x["swl"] for x in samples]
    return {"n": len(samples), "scrollWidth_min": min(sws), "scrollWidth_max": max(sws),
            "maxScrollLeft_min": min(sls), "maxScrollLeft_max": max(sls),
            "spread_sw": max(sws) - min(sws), "samples": samples[::2]}

results = {}
with sync_playwright() as p:
    browser = p.chromium.launch()
    for vw, vh in [(320, 320), (800, 600)]:
        ctx = browser.new_context(viewport={"width": vw, "height": vh})
        page = ctx.new_page()
        key = f"{vw}x{vh}"
        results[key + " animated 16x80ms"] = sweep(page, BASE, 16, 80)
        results[key + " frozen 4x250ms"] = sweep(page, BASE + "?frozen=1", 4, 250)
        ctx.close()
    browser.close()

for d in (OUT, MIRROR):
    with open(os.path.join(d, "sweep.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1, ensure_ascii=False)
for k, v in results.items():
    print(k, "->", {kk: vv for kk, vv in v.items() if kk != "samples"})
