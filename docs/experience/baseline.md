# Línea base reproducible — S00

**Fecha de captura:** 2026-11-01. **Estado:** completada en el árbol de trabajo descrito aquí; no equivale a una build nativa ni a un commit reproducible por sí solo.

## Árbol y entorno

- HEAD: `429efda9ff20e102235875bd5bcd44aa8a786eeb`.
- El árbol ya tenía numerosos archivos modificados y no seguidos antes de S00. Se registró con `git status --short`; se preservaron y no se usaron reset, checkout, clean ni stash. Esta baseline describe **HEAD más ese árbol local**, no HEAD aislado.
- Versiones: Node `v22.23.2`; npm `12.0.2`; Rust `1.95.0 (59807616e 2026-04-14)`; Cargo `1.95.0 (f2d3ce0bd 2026-03-21)`.
- No se modificó runtime ni UI. Las capturas registran el diseño existente; las imágenes son arte sintético para no depender de contenido externo.

## Verificaciones

| Comando | Resultado | Observación |
|---|---|---|
| `npx tsc --noEmit` | **PASS**, código 0 en la verificación final | La primera ejecución había fallado al no resolver `src/services/movieSeriesDecades`; al repetir, el archivo local ya estaba presente y TypeScript terminó sin errores. Ese archivo pertenece a los cambios locales, no a S00. |
| `npx vitest run` | **FAIL**, código 1; 1247 aprobados, 48 fallidos (1295 tests; 133 archivos pasaron y 215 fallaron) | Los fallos observados pertenecen a `vendor/spatialposters`: imports con alias `@/` que no resuelven y pruebas de ESLint sin configuración disponible. Se registra como baseline; no se reparó código ajeno ni se relajaron expectativas. |
| `npx playwright test e2e/big-picture-library.spec.ts e2e/detail-back.spec.ts --project=chromium` | **PASS**, código 0; 3 pruebas | Las superficies web existentes de biblioteca Big Picture y retorno desde Detail. |
| `npx playwright test e2e/experience-baseline.spec.ts --project=chromium` | **PASS**, código 0; 1 prueba | Validó datos sintéticos, rutas y texto visible, y generó las ocho capturas enumeradas abajo. |
| Smoke nativo Windows con mpv / pruebas nativas Rust | **NO EJECUTADO** | Playwright no sustituye la prueba del ejecutable, Tauri ni mpv real. B02 permanece pendiente. |

## Fixture aislado

Fuente: [`e2e/fixtures/experience/core.json`](../../e2e/fixtures/experience/core.json), cargada por [`e2e/fixtures/experience.ts`](../../e2e/fixtures/experience.ts).

- Dos perfiles sintéticos; modo local; película y serie con IDs de TMDB propios.
- Tres entradas anime: MAL `1001` y AniList `1001` (mismo número, namespaces distintos), y MAL `1002` de formato OVA.
- Continue Watching con selección de audio/subtítulos, episodio nuevo e historial con marca manual S0E0.
- Fuentes rápida, lenta, vacía y fallida; pistas español, inglés y sin idioma; error de cuota `QuotaExceededError` limitado a una clave de prueba.
- Estados locales/AniList/Trakt y dos participantes Party ficticios.
- Reloj fijo `2026-11-01T12:00:00.000Z`, zona `UTC` y locale `es-ES`.
- Las APIs TMDB/AniList/Jikan reconocidas devuelven datos sintéticos; las imágenes se reemplazan por SVG generado. Toda llamada externa no reconocida se aborta. No se usan credenciales, cuentas ni contenido audiovisual real.
- Party se captura como estado de entrada: modal para unirse en escritorio y pantalla de Party en Big Picture. No se conecta a un relay ni se afirma que los participantes ficticios estén en una sala real.

## Capturas

Todas están en [`baseline-captures/`](baseline-captures/). Las dimensiones PNG fueron verificadas leyendo el encabezado del archivo. SHA-256 permite identificar exactamente los artefactos de esta ejecución.

| Archivo | Viewport | Ruta / estado | SHA-256 |
|---|---:|---|---|
| `desktop-home.png` | 1600×900 | `/home` | `d690ec7d84eddafb760ba53b9f984adca02f8e6aa803ef22c51b6a8dc88d4b05` |
| `desktop-detail.png` | 1600×900 | `/detail/movie/990001` | `11fa8cb5f9fa38e42194097df6492c7d5d6c0d2cfcb5d6983cd84bc461d693a6` |
| `desktop-settings.png` | 1600×900 | `/settings` | `6f6c0825a32e8c1c0ff7d35f9502330d6562ff19701ea8f7ca467f16b33a223f` |
| `desktop-party.png` | 1600×900 | `/home`, modal «Ver juntos (Party)» abierto | `45672e25a18ef1c4336d1c9d64b188a05cb4823a7c81a2c3b6fff2e4a4091079` |
| `big-picture-home.png` | 1920×1080 | `/big-picture` | `45ea8ecec24d0c08c1fab297ac50f5fb612f1640d8a904f9eff14295c2a86552` |
| `big-picture-detail.png` | 1920×1080 | `/big-picture/detail/movie/990001` | `334d5a884411c72d2888874581eb08272fbfb2577ed6411a062657e1ecb81ac3` |
| `big-picture-settings.png` | 1920×1080 | `/big-picture/settings` | `670e599e96182ccbd40353e34834083821c40dcfff5976436ad387258b2a6f80` |
| `big-picture-party.png` | 1920×1080 | `/big-picture/party` | `0e1d66da9fcfc47ac989d9328386e8a5e3de0a66749db09af3c75dc174dde809` |

## Salida y límites

- S00 cumple la baseline web, fixture aislada y capturas. El test nuevo comprueba que las vistas de Home, Detail, Ajustes y Party muestran contenido antes de capturar; una captura de navegación vacía no se considera válida.
- La suite Vitest completa conserva los fallos descritos arriba. Deben considerarse en las etapas que dependan de esas pruebas; no omitir pruebas dirigidas.
- **S01 queda habilitada** por dependencia. No se comenzó trabajo de S01 en esta etapa.
- **B01 sigue abierto:** falta el código real del backend de cuentas en `aetherio-backend/src`; no crear una alternativa de nube/autenticación. **B02 sigue pendiente:** smoke nativo Windows/mpv no ejecutado.
