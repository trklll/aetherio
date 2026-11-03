# -*- coding: utf-8 -*-
"""
Adversarial functional/structural verification of measure/spinner/clone/index.html
Real playwright interactions: get_attribute / evaluate / getBoundingClientRect /
requestAnimationFrame sampling / screenshots. Each finding carries exact repro.
Spec refs: ANALYSIS.md — S2 geometry (L=.30S W=.105S, 8 petals, R=W/2), S5 motion
(360deg CW 1.05s linear; ?frozen=1 -> none; reduced-motion -> none).

Outputs are mirrored to %TEMP%\\opencode\\spinner-verify2-mirror (scratch dir was
observed emptying once; mirror guarantees the run is not lost).
"""
import json, math, os, shutil, traceback
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4191/clone/index.html"
OUT = r"C:\Users\Administrator\Documents\Projects\aetherio\measure\spinner\verify-2"
MIRROR = os.path.join(os.environ.get("TEMP", r"C:\Users\Administrator\AppData\Local\Temp"),
                      "opencode", "spinner-verify2-mirror")
os.makedirs(MIRROR, exist_ok=True)

results = []

def record(tid, title, status, metrics, error=None):
    results.append({"id": tid, "title": title, "status": status,
                    "metrics": metrics, "error": error})
    print(f"[{status}] {tid} {title}")

def dump():
    for d in (OUT, MIRROR):
        try:
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "results.json"), "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
        except Exception as ex:
            print("dump failed:", d, ex)

def norm(d):  # normalize angle diff to [0,360)
    return d % 360.0

def angle_ms(page, sel):
    return page.evaluate("""sel => {
        const cs = getComputedStyle(document.querySelector(sel));
        let a = 0.0;
        if (cs.transform && cs.transform !== 'none') {
            const v = cs.transform.match(/matrix\\(([^)]+)\\)/);
            if (v) { const f = v[1].split(',').map(Number); a = Math.atan2(f[1], f[0]) * 180 / Math.PI; }
        }
        return {angle: a, anim: cs.animationName, dur: cs.animationDuration,
                it: cs.animationIterationCount, t: performance.now()};
    }""", sel)

try:  # ---- everything mirrors via finally -----------------------------------
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---- 1. ANIMACIoN ------------------------------------------------------
        try:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            page.goto(BASE, wait_until="load")
            page.wait_for_timeout(150)
            s1 = angle_ms(page, "#ref-spinner")
            per = []
            prev = s1
            for i in range(4):
                page.wait_for_timeout(262)
                s = angle_ms(page, "#ref-spinner")
                d = norm(s["angle"] - prev["angle"])
                exp = (s["t"] - prev["t"]) * 360.0 / 1050.0
                per.append({"delta_deg": round(d, 3), "expected_deg": round(exp, 3),
                            "elapsed_ms": round(s["t"] - prev["t"], 2),
                            "ok": abs(((d - exp + 180) % 360) - 180) <= 6.0})
                prev = s
            m = {
                "intervals_262ms": per,
                "animName": s1["anim"], "animDur": s1["dur"], "iteration": s1["it"],
                "all_intervals_ok": all(x["ok"] for x in per),
                "direction": "CW(+)" if all(x["delta_deg"] > 60 for x in per) else "??",
            }
            ctx.close()
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            page.goto(BASE + "?frozen=1", wait_until="load")
            page.wait_for_timeout(200)
            frozen = page.evaluate("""() => {
                const out = [];
                for (const el of document.querySelectorAll('.spinner')) {
                    const cs = getComputedStyle(el);
                    out.push({sel: el.className, animName: cs.animationName,
                              transform: cs.transform, n: el.querySelectorAll('i').length});
                }
                return out;
            }""")
            m["frozen"] = frozen
            dur_ok = m["animDur"].endswith("s") and abs(float(m["animDur"][:-1]) - 1.05) < 1e-9
            ok = (m["all_intervals_ok"] and m["direction"] == "CW(+)"
                  and m["animName"] == "ai-rotate" and dur_ok
                  and all(x["animName"] == "none" and x["transform"] == "none" and x["n"] == 8 for x in frozen))
            record("T1", "Rotation ~90deg/262ms 1.05s linear; frozen=1 -> none",
                   "PASS" if ok else "FAIL", m)
            ctx.close()
        except Exception:
            record("T1", "Animation", "ERROR", {}, traceback.format_exc())
            dump()

        # ---- 2. A11Y -----------------------------------------------------------
        try:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            page.goto(BASE, wait_until="load")
            n_spin = page.locator(".spinner").count()
            roles, labels, petals = [], [], []
            for i in range(n_spin):
                loc = page.locator(".spinner").nth(i)
                roles.append(loc.get_attribute("role"))
                labels.append(loc.get_attribute("aria-label"))
                petals.append(loc.locator("i").count())
            hidden = page.locator(".spinner i[aria-hidden='true']").count()
            all_i = page.locator(".spinner i").count()
            m = {"spinners": n_spin, "roles": roles, "aria_labels": labels,
                 "petals_per_spinner": petals,
                 "i_total": all_i, "i_aria_hidden_true": hidden,
                 "role_all_img": all(r == "img" for r in roles),
                 "label_all_cargando": all(l == "Cargando" for l in labels),
                 "aria_hidden_cover": hidden == all_i == 32,
                 "petals_8_each": all(x == 8 for x in petals)}
            ok = (m["spinners"] == 4 and m["role_all_img"] and m["label_all_cargando"]
                  and m["aria_hidden_cover"] and m["petals_8_each"])
            record("T2", "role=img+Cargando x4; 8 pAtilo <i> aria-hidden c/u", "PASS" if ok else "FAIL", m)
            ctx.close()
        except Exception:
            record("T2", "A11y", "ERROR", {}, traceback.format_exc())
            dump()

        # ---- 3. INVARIANTES DE ESCALA ------------------------------------------
        try:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            page.goto(BASE, wait_until="load")
            page.wait_for_timeout(120)
            data = page.evaluate("""() => {
                const out = [];
                for (const sel of ['#ref-spinner', '.spinner.s46', '.spinner.s28']) {
                    const el = document.querySelector(sel);
                    const cs = getComputedStyle(el);
                    const i = el.querySelector('i');
                    const ics = getComputedStyle(i);
                    // CSS: i { width: var(--pet-w); height: var(--pet-l); border-radius: calc(var(--pet-w)/2) }
                    out.push({sel,
                        S_var: cs.getPropertyValue('--s').trim(),
                        Wdecl: cs.getPropertyValue('--pet-w').trim(),
                        Ldecl: cs.getPropertyValue('--pet-l').trim(),
                        rmiddecl: cs.getPropertyValue('--pet-rmid').trim(),
                        boxW: cs.width, boxH: cs.height,
                        Wc: ics.width, Lc: ics.height, R: ics.borderTopLeftRadius});
                }
                return out;
            }""")
            m = []
            for d in data:
                S = float(d["S_var"].replace("px", ""))
                Wc = float(d["Wc"].replace("px", "")); Lc = float(d["Lc"].replace("px", ""))
                R = float(d["R"].replace("px", ""))
                Wdecl = float(d["Wdecl"].replace("px", "")); Ldecl = float(d["Ldecl"].replace("px", ""))
                rmid = float(d["rmiddecl"].replace("px", ""))
                boxW = float(d["boxW"].replace("px", ""))
                m.append({"sel": d["sel"], "S_px": S,
                          "W_computed": Wc, "L_computed": Lc, "R": R,
                          "W_declared": Wdecl, "L_declared": Ldecl, "rmid": rmid,
                          "W_over_S": round(Wc / S, 5), "L_over_S": round(Lc / S, 5),
                          "R_eq_decl_W_half": abs(R - Wdecl / 2) < 1e-6,
                          "R_vs_comp_W_half_px": round(abs(R - Wc / 2), 4),
                          "box_eq_S": abs(boxW - S) < 1e-3,
                          "tipOuter_over_S": round((rmid + Ldecl / 2) / S, 5),
                          "tipInner_over_S": round((rmid - Ldecl / 2) / S, 5)})
            checks = [{"sel": x["sel"],
                       "L_ok": abs(x["L_over_S"] - 0.30) <= 0.005,
                       "W_ok": abs(x["W_over_S"] - 0.105) <= 0.006,
                       "R_decl_ok": x["R_eq_decl_W_half"],
                       "R_comp_ok": x["R_vs_comp_W_half_px"] <= 0.02,
                       "box_ok": x["box_eq_S"],
                       "in_disk": x["tipOuter_over_S"] < 0.5} for x in m]
            ok = all(c["L_ok"] and c["W_ok"] and c["R_decl_ok"] and c["R_comp_ok"] and c["box_ok"] and c["in_disk"] for c in checks)
            record("T3", "W/S~=0.105, L/S~=0.30, R~=W/2 (width=pet-w, height=pet-l)",
                   "PASS" if ok else "FAIL", {"per_spinner": m, "checks": checks})
            ctx.close()
        except Exception:
            record("T3", "Scale invariants", "ERROR", {}, traceback.format_exc())
            dump()

        # ---- 4. PREFERS-REDUCED-MOTION -----------------------------------------
        try:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
            page = ctx.new_page()
            page.goto(BASE, wait_until="load")
            page.wait_for_timeout(200)
            m = page.evaluate("""() => {
                const out = [];
                for (const el of document.querySelectorAll('.spinner')) {
                    const cs = getComputedStyle(el);
                    const i = el.querySelector('i');
                    out.push({cls: el.className, animName: cs.animationName,
                              petOpacity: getComputedStyle(i).opacity,
                              petBg: getComputedStyle(i).backgroundColor});
                }
                return out;
            }""")
            a1 = angle_ms(page, "#ref-spinner"); page.wait_for_timeout(250); a2 = angle_ms(page, "#ref-spinner")
            m_static = {"outlined": m, "angle_t0": a1["angle"], "angle_t250ms": a2["angle"],
                        "really_static": abs(norm(a2["angle"] - a1["angle"])) < 0.01}
            ok = all(x["animName"] == "none" for x in m) and m_static["really_static"] \
                 and all(x["petOpacity"] == "1" and "rgb" in x["petBg"] for x in m)
            record("T4", "reducedMotion=reduce -> animation:none, pAtilo estAticos visibles",
                   "PASS" if ok else "FAIL", m_static)
            ctx.close()
        except Exception:
            record("T4", "Reduced motion", "ERROR", {}, traceback.format_exc())
            dump()

        # ---- 5. CONSOLA / OVERFLOW (3 tamaAos) ----------------------------------
        for vw, vh in [(320, 320), (800, 600), (1440, 900)]:
            try:
                ctx = browser.new_context(viewport={"width": vw, "height": vh})
                page = ctx.new_page()
                errs, perrs, r404 = [], [], []
                page.on("console", lambda msg: errs.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
                page.on("pageerror", lambda err: perrs.append(str(err)))
                page.on("response", lambda r: r404.append(f"{r.status} {r.url}") if r.status >= 400 else None)
                page.goto(BASE, wait_until="load")
                page.wait_for_timeout(500)
                ov = page.evaluate("""() => {
                    const d = document.scrollingElement;
                    const before = window.scrollX;
                    d.scrollLeft = 99999; d.scrollTop = 99999;
                    const culprits = [];
                    document.querySelectorAll('body *').forEach(el => {
                        const r = el.getBoundingClientRect();
                        const cs = getComputedStyle(el);
                        if (r.right > d.clientWidth + 0.5 && cs.position !== 'fixed') {
                            const key = el.tagName.toLowerCase() + '.' + String(el.className) + ':' + Math.round(r.right);
                            if (!document.__seen) document.__seen = new Set();
                            if (!document.__seen.has(key)) { document.__seen.add(key);
                                culprits.push({el: key, right_px: Math.round(r.right), width_px: Math.round(r.width)});
                            }
                        }
                    });
                    return {before, maxScrollLeft: Math.round(d.scrollLeft),
                            maxScrollTop: Math.round(d.scrollTop),
                            scrollW: d.scrollWidth, clientW: d.clientWidth,
                            scrollH: d.scrollHeight, clientH: d.clientHeight,
                            stage: (() => { const s = getComputedStyle(document.querySelector('.stage')); return s.flexDirection + '/' + s.flexWrap; })(),
                            culprits: culprits.slice(0, 10)};
                }""")
                page.evaluate("document.scrollingElement.scrollLeft = 0; document.scrollingElement.scrollTop = 0;")
                m = {"viewport": f"{vw}x{vh}", "console_errors": errs, "pageerrors": perrs,
                     "http_gt4xx": r404,
                     "scrollX_loaded": ov["before"], "maxScrollLeft": ov["maxScrollLeft"],
                     "maxScrollTop": ov["maxScrollTop"],
                     "scrollW": ov["scrollW"], "clientW": ov["clientW"],
                     "overflow_x_px": ov["scrollW"] - ov["clientW"],
                     "scrollH": ov["scrollH"], "clientH": ov["clientH"],
                     "dropped": ov["maxScrollTop"] > 0,
                     "stage": ov["stage"], "overflow_culprits": ov["culprits"]}
                h_overflow = ov["maxScrollLeft"] > 0
                ok = not errs and not perrs and not r404 and not h_overflow
                record(f"T5[{vw}x{vh}]", "0 errores consola; sin scroll horizontal",
                       "PASS" if ok else "FAIL", m)
                ctx.close()
            except Exception:
                record(f"T5[{vw}x{vh}]", "Console/overflow", "ERROR", {}, traceback.format_exc())
                dump()

        # ---- 6. ESTABILIDAD (60 rAF + screenshots congeladas) -------------------
        try:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            page.goto(BASE + "?frozen=1", wait_until="load")
            page.wait_for_timeout(250)
            raf = page.evaluate("""async () => {
                const sels = ['#ref-spinner', 'main section:nth-of-type(2) .spinner', '.spinner.s46', '.spinner.s28'];
                const read = () => sels.map(sel => {
                    const el = document.querySelector(sel);
                    const r = el.getBoundingClientRect();
                    const cs = getComputedStyle(el);
                    const i = el.querySelector('i');
                    const ics = getComputedStyle(i);
                    return [sel, r.left.toFixed(4), r.top.toFixed(4), cs.width, cs.height,
                            cs.transform, ics.width, ics.height, ics.opacity,
                            cs.getPropertyValue('--s').trim(), cs.getPropertyValue('--pet-l').trim()].join('|');
                });
                await new Promise(res => requestAnimationFrame(res));
                const frames = [];
                for (let k = 0; k < 60; k++) {
                    await new Promise(res => requestAnimationFrame(() => { frames.push(read().join('#')); res(); }));
                }
                const uniq = [...new Set(frames)];
                return {n: frames.length, uniqCount: uniq.length,
                        first: frames[0], other: uniq.length > 1 ? uniq[1] : null};
            }""")
            m = {"raf_frames": raf["n"], "unique_geometry_states": raf["uniqCount"],
                 "geometry_ok": raf["uniqCount"] == 1,
                 "sample_frame_0": raf["first"],
                 "divergent_frame": raf["other"]}
            a1 = os.path.join(MIRROR, "frozen_a.png")
            b1 = os.path.join(MIRROR, "frozen_b.png")
            page.screenshot(path=a1, full_page=True)
            page.reload(wait_until="load"); page.wait_for_timeout(200)
            page.screenshot(path=b1, full_page=True)
            import numpy as np
            from PIL import Image
            A = np.asarray(Image.open(a1).convert("RGB"), dtype=np.int16)
            B = np.asarray(Image.open(b1).convert("RGB"), dtype=np.int16)
            if A.shape != B.shape:
                m["pixdiff"] = f"shape {A.shape} vs {B.shape}"
                pix_ok = False
            else:
                d = np.abs(A - B)
                m["shape"] = list(A.shape)
                m["pixdiff_max"] = int(d.max())
                m["pixdiff_pixels"] = int((d.sum(axis=2) > 0).sum())
                pix_ok = m["pixdiff_max"] == 0
            m["screens_ok"] = pix_ok
            record("T6", "60 rAF sin variar geometria; 2 screenshots congeladas identicas",
                   "PASS" if (m["geometry_ok"] and pix_ok) else "FAIL", m)
            ctx.close()
        except Exception:
            record("T6", "Stability", "ERROR", {}, traceback.format_exc())
            dump()

        # ---- 7. TARGETS MUERTOS / hit-testing -----------------------------------
        try:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            page.goto(BASE, wait_until="load")
            page.wait_for_timeout(150)
            m = page.evaluate("""() => {
                const dead = document.querySelectorAll('a,button,[onclick]').length;
                const hits = [];
                for (const [name, sel] of [['plate-ref', '#ref-spinner'],
                                           ['plate-aeth', 'main section:nth-of-type(2) .spinner'],
                                           ['s46', '.spinner.s46'], ['s28', '.spinner.s28']]) {
                    const el = document.querySelector(sel);
                    const r = el.getBoundingClientRect();
                    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                    const p = document.elementFromPoint(cx, cy);
                    const rel = p === el ? 'self' : (p && el.contains(p) ? 'child:' + p.tagName + '.' + p.className : 'OUTSIDE(' + (p ? p.tagName + '.' + p.className : 'null') + ')');
                    hits.push({target: name, rel: rel});
                }
                const plateRef = document.querySelector('.plate--ref').getBoundingClientRect();
                const pal = document.elementFromPoint(plateRef.left + plateRef.width / 2, plateRef.top + plateRef.height / 2);
                const refSpinner = document.querySelector('#ref-spinner');
                hits.push({target: 'plato-ref(animado, rot random)', rel: pal && (pal === refSpinner || refSpinner.contains(pal)) ? 'inside #ref-spinner' : 'OUTSIDE'});
                return {dead_clickables: dead, hits};
            }""")
            ok = m["dead_clickables"] == 0 and all("OUTSIDE" not in str(h["rel"]) for h in m["hits"])
            record("T7", "0 enlaces/botones muertos; elementFromPoint centro -> spinner", "PASS" if ok else "FAIL", m)
            ctx.close()
        except Exception:
            record("T7", "Dead targets", "ERROR", {}, traceback.format_exc())
            dump()

        browser.close()
finally:
    dump()
    fails = [r for r in results if r["status"] != "PASS"]
    print(f"\nTOTAL {len(results)} | PASS {len(results)-len(fails)} | non-PASS {len(fails)}")
    print("mirror:", MIRROR)
