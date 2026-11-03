# ANALYSIS — Apple petal spinner (referencia: captura pegada en chat pro aetherio)

Fuente: imagen pegada por el usuario en la conversación (recorte tipo icono, ~160px, fondo rojo ladrillo).
La imagen NO existe como archivo en disco ⇒ el skill manda: "reconstruct design intent from platform
standards and state every inference as an inference". Todas las medidas abajo son proporciones
adimensionales (x = fracción del diámetro del spinner) + colores muestreados a ojo, marcados como
INFERENCIA. El artefacto en disco `ref-spec.png` es la RECONSTRUCCIÓN de esa lectura (no la imagen
original); los agentes adversarios verifican render vs reconstrucción + spec numérica.

## 1. Scale factor
- Recorte cuadrado, spinner ocupa ~92% del ancho (petal tips near edges). Canvas de trabajo:
  CSS 320×320, disco S=290px centrado ⇒ margen 15px por lado ≈ 4.7% (coincide con el recorte observado).
- Escala no es crítica: componente atómico; la geometría va en proporciones.

## 2. Geometry (unidades: fracción de S)
| Magnitud | Valor | Tipo |
|---|---|---|
| Pétalos | 8, cada 45° | medido (recuento visual) |
| Forma | cápsula (rect redondeado full) | medido |
| Largo pétalo L | 0.30·S (87px @S290) | inferencia ±0.02 |
| Ancho pétalo W | 0.105·S (30.5px) | inferencia ±0.01 |
| Extremo interno r0 | 0.16·S (46px) ⇒ agujero ~0.11·S radio | inferencia |
| Extremo externo r1 | r0+L = 0.46·S (133px) < 0.5 S ✓ | derivado |
| Centro del pétalo | r_mid = (r0+r1)/2 = 0.298·S (89.5px) | derivado |

## 3. Color
| Elemento | Valor | Tipo |
|---|---|---|
| Fondo del recorte | #7E2123 (ladrillo oscuro) | INFERENCIA (llano, sin viñeta visible) |
| Petal base (head) | #F1504B / RGB(241,80,75) | INFERENCIA |
| Estela | rampa de alfa 8 pasos sobre el mismo color | inferencia (patrón canónico Apple/UIActivityIndicator) |

## 4. Rampa de alfa (8 pasos, head→tail visual CCW)
[1.00, 0.88, 0.76, 0.63, 0.50, 0.40, 0.31, 0.22]
- Orden angular (desde Este, CCW visual): E, NE, N, NW, W, SW, S, SE.
- Evidencia de la imagen: pétalos claros en W/NW (pálidos), E/NE brillantes ⇒ head=E, cola hacia W.
- Quiralidad = INFERENCIA; se fija idéntica en spec, clon e integración (rotación CW: la cabeza
  E avanza hacia S, la estela queda detrás en CCW consistentemente).

## 5. Motion
- Rotación del contenedor 360° lineal infinito, periodo 1.05s (equivale al cadence actual de
  aetherio: .aetherio-loading-spin 1.05s y gsap rotate 1.05s — paridad de ritmo deliberada).
- Fórmula del efecto estela: alfas estáticos + rotación del grupo (no animación por pétalo).
- ?frozen=1 → animation:none (t=0 determinista para diff).
- prefers-reduced-motion: reduce → animation:none (los pétalos quedan estáticos con su rampa,
  legible como "cargador" sin girar; §14 del spec interno de aetherio).

## 6. A11y (ya presente en aetherio, se conserva)
- Contenedor del estado: role="status" + aria-live="polite" + aria-busy (LoadingState).
- Cada pétalo aria-hidden="true" (elementos decorativos).

## 7. Variantes
- Referencia de clonación: ROJO de la imagen (fondo #7E2123, pétalos #F1504B).
- Integración aetherio (decisión del usuario): BLANCO NEUTRO sobre bg atv (#ffffff pétalos,
  sobre #0d0d0d) — la variante roja nunca se integra; sirve solo de verificación geométrica.
- White rampa idéntica; alpha sobre negro sube contraste naturalmente.

## 8. KNOWN INTENTIONAL DELTAS (lista para agentes adversarios)
1. ref-spec.png es una RECONSTRUCCIÓN; la imagen original solo existió en el chat.
2. El fondo del recorte es parte del crop, no del componente: en integración el spinner es
   transparente sobre superficie del padre.
3. Quiralidad de la estela: inferida (E head, cola CCW).
4. Tamaños en px del clon (290/30.5/87/…) son elecciones de escala, no del design original.
5. La página del clon muestra además tamaño real 46px y 28px (los de aetherio) — adición de
   contexto, no del design de la imagen.
