# FINDINGS — Verificación adversarial funcional/estructural · spinner clone
**Sesión:** verify-2 · **Fecha:** 2026-10-29 · **Artefacto bajo prueba:**
`measure\spinner\clone\index.html` (servido en `http://127.0.0.1:4191/clone/index.html`,
server `python -m http.server 4191` cwd `measure\spinner`, jugador/propiedad del verificador, ya muerto).
**Spec de referencia:** `ANALYSIS.md` §2 (geometría), §4 (rampa/quiralidad), §5 (motion), §8 (deltas intencionales).
**Motor:** Playwright 1.6x sobre chromium 156.0.8078.4 (headless, python sync API, browser cache del repo @playwright/test). Interacciones reales: `get_attribute`, `elementFromPoint`, `getBoundingClientRect`, muestreo de reloj de página con `performance.now()`, 60×`requestAnimationFrame`, screenshots PNG comparadas pixel-a-pixel (numpy/PIL). URL espejo de artefactos: `%TEMP%\opencode\spinner-verify2-mirror\`.

---

## VEREDICTO GLOBAL

**8 de 9 pruebas PASS. 1 hallazgo real (minor), con causa raíz probada mecánicamente.**
La página es apta como referencia funcional/geométrica del átomo spinner; ningún defecto
crítico ni mayor. El hallazgo afecta solo a esta página de verificación (no al `.spinner`
que se integra en aetherio) y es de layout/hitbox de página, no de geometría del componente.

| # | Prueba | Veredicto | Evidencia clave |
|---|--------|-----------|-----------------|
| T1 | Animación 360°/1.05s lineal CW + `?frozen=1`→none | **PASS** | 4 intervalos: Δ 91.39°/97.17° vs esperado 92.67°/100.46° (ventana ±6°); dinámica continua CW consistente; frozen: `animationName:none`, `transform:none` en los 4 |
| T2 | A11y | **PASS** | 4 spinners × (role=img, aria-label="Cargando"); 32/32 `<i>` con aria-hidden="true"; 8 pétalos por spinner |
| T3 | Invariantes de escala | **PASS** | ref: L/S=0.30000, W/S=0.10517, R=15.25=W/2 exacto; s46: 0.29993/0.10496 (R=2.415=W_decl/2 exacto, dif. sub-pixel 0.0009 vs W computada); s28: 0.29967/0.10491 (dif. R 0.0012) |
| T4 | prefers-reduced-motion | **PASS** | `reducedMotion:reduce` → `animationName:none` en los 4; Δángulo 0.00° tras 250ms; pétalo head `opacity:1`, `rgb(241,80,75)` intacto (rampa legible estática) |
| T5 | 0 errores consola en 320x320/800x600/1440x900 | **PASS** (consola) | 0 console-error, 0 pageerror, 0 respuesta ≥400 en los 3 viewports; ni siquiera hay petición favicon |
| T5 | Sin overflow horizontal | **FAIL→hallazgo F1** @320x320 | `window.scrollX==0` al cargar ✓, pero la página SÍ puede scrollear horizontalmente (maxScrollLeft 40–77 fluctuante; frozen: 32 determinista). Pasa limpia en 800x600 y 1440x900 (maxScrollLeft=0, scrollWidth==clientWidth) |
| T6 | Estabilidad | **PASS** | 60 rAF → 1 único estado geométrico (divergentes=0); 2 screenshots congeladas (entre las que hubo un `reload` completo) → **diff pixel-a-pixel 0** (900×1440×3) |
| T7 | Targets muertos / hit-testing | **PASS** | `a,button,[onclick]` = 0; elementFromPoint en el centro de los 4 spinners → el propio `.spinner` ("self"); centro del plato rojo con animación viva (rotación arbitraria) → dentro de `#ref-spinner` |

---

## HALLAZGO F1 — [minor] Overflow horizontal fluctuante en 320x320 (scrollable overflow incluye el AABB del disco rotado)

**Severidad: minor** — es un defecto de layout de la *página de verificación* (no del
componente spinner; el `.spinner` integrado en aetherio hereda solo la geometría de
pétalos, no esta página). El literal del criterio ("no debe desbordar scroll horizontal")
se viola: el scrollable overflow existe y además es **no determinista** mientras anima.

### Repro exacto (chrome 156 headless, viewport 320x320)
1. `python -m http.server 4191` con cwd `measure\spinner`.
2. Cargar `http://127.0.0.1:4191/clone/index.html` (SIN `?frozen=1`).
3. Medir repetidamente `document.scrollingElement.scrollWidth` cada ~80ms mientras rota.

Métricas de barrido (`sweep.json`, 16 muestras × 80ms):
- **Animado:** scrollWidth oscila **360 → 397 px** (spread 37), maxScrollLeft **40 → 77 px** en el mismo viewport. Dos cargas "idénticas" antes del barrido habían dado 368 y 357 — no es ruido de medición, es fase de rotación.
- **Congelado (`?frozen=1`):** scrollWidth **352 constante** (spread 0), maxScrollLeft 32.
- 800x600 y 1440x900: **0** en ambos regímenes (AABB rotado cabe en el viewport).

### Causa raíz (probada, dos causas apiladas)
1. **Layout estático:** los `.plate` son `width:320px` fijos con `min-width:auto` de flex-item
   y `body{padding:48px 32px}` ⇒ en viewport 320 el borde derecho del plato queda en
   32+320 = **352** ⇒ scrollable overflow 32px **siempre** (también frozen).
2. **AABB del transform:** `@keyframes ai-rotate to {transform:rotate(360deg)}` sobre el
   `.spinner` de 290px hace que la región de scrollable overflow incluya la caja
   transformada. AABB de un cuadrado S rotado θ: 290·(|cosθ|+|sinθ|) ⇒ máx 410.06px a 45°.
   Pico teórico: centro 192 + 205.06 = **397.06 → 397px, igual al máximo medido** ✓
   ⇒ mientras anima, el ancho scrolleable "respira" con la rotación (no determinista).

### Fix sugerido (sin tocar la geometría del spinner)
```css
.plate { overflow: clip; }        /* recorte tipo "crop": el disco (tipOuter=133px < 145px=mitad de plato) nunca se recorta visualmente; mata la causa 2 */
body   { overflow-x: clip; }      /* cinturón: mata la causa 1 sin crear scroll container (fallback: hidden) */
```
Alternativa sistemática: `@media (max-width: 384px){ body{padding:16px} .plate{width:min(320px, calc(100vw - 32px))} .plate .spinner{ zoom: calc((100vw - 32px)/320) } }` — pero la primera opción es mínima y suficiente; `overflow:clip` respeta el carácter de "recorte" del plato (§8-2) y no cambia hit-testing del interior.

### Clasificación refutada / no-hallazgos a propósito de F1
- `window.scrollX==0` al cargar: se cumple (0 en los 3 viewports); el defecto es que la región scrolleable existe, no que el usuario esté scrolleado.
- El scroll vertical a 320 (scrollHeight 1010) es esperado: los platos hacen wrap y el contenido mide más que el viewport. Criterio era horizontal; no es hallazgo.

---

## OBSERVACIONES (medidas, sin defecto reclamable en la tolerancia de spec)
1. **Extremo interno del pétalo (agujero):** ref tipInner/S = 0.15862 (rmid 89.5 − L/2 43.5 = 46px); s46/s28 = 0.14804/0.14800 (6.81px/4.144px) vs §2 tabla "r0 = 0.16·S". Desviación máx **0.55px @46px** — sub-visual; la propia tabla redondea (r0 escrito 0.16 con r1=r0+L=133 ⇒ números elegidos 46/133/89.5). Ajusta al tipo "elecciones de escala" del §8-4. No accionable.
2. **Cuantización de sub-pixel en variantes pequeñas:** la W computada de s46 es 4.82812 vs declarada 4.83 (y s28: 2.9375 vs 2.94) — floor de layout a 1/64px; el `border-radius` computado (2.415/1.47) es exactamente mitad de la W **declarada** (calc(var(--pet-w)/2)) y difiere 0.0009–0.0012px de la mitad de la W computada. Intuible, no hallazgo.
3. **Temporización real del giro:** con `wait_for_timeout(262)` los instantes reales cayeron en 270–293ms (planificación de la API); la verificación se hizo contra el reloj de página (`performance.now()`), por lo que Δ esperado se recalculó por intervalo real — es el método correcto, no una concesión.
4. **Quiralidad/rampa:** fuera del alcance funcional de esta sesión (se verifican los §8-3 como delta intencional; no se contradijo nada medible).

## Meta-notas de la sesión (transparencia del verificador)
- Dos falsos FAIL de primera pasada (**T3 y T7**) fueron defectos de **mi sonda** (mapeé `width` como L y comparé `"True"` vs `true`), corregidos y re-medidos antes de emitir veredicto: no entran como hallazgos. T5-T1 sí cambió de status tras el barrido (el FAIL original quedó de pie y ganó explicación causa-raíz).
- El scratch `verify-2` quedó **vacío una vez** a mitad de sesión (borrado externo, no reproducible por mí; dir mtime 03:57); de ahí el espejo en `%TEMP%\opencode\spinner-verify2-mirror\` (results.json, sweep.json, frozen_a/b.png, metrics-dump.txt). Ningún número de este informe depende del scratch.
- Determinismo cross-load verificado explícitamente: las dos screenshots de T6 separan un `page.reload()` completo y aun así diff = 0 px.

## Artefactos
- Script de pruebas: `measure\spinner\verify-2\verify.py` (+ `sweep.py`); resultados: `results.json`, `sweep.json` en out dir y espejo temp.
- Capturas congeladas: `verify-2\frozen_a.png` / `frozen_b.png` (espejo temp) — interminables pixel-iguales.
- Para re-corrida: `python -m http.server 4191` (cwd `measure\spinner`) → `python verify.py` → `python sweep.py` → matar server.
