# Registro — plan maestro de experiencia Aetherio

Plan canónico: [aetherio-master-experience.md](aetherio-master-experience.md).
Fecha inicial: 2026-11-01. S00 se ejecutó el 2026-11-01; S01 y S02 se ejecutaron el 2026-11-02. Evidencia de S00: [baseline.md](baseline.md).

## Estado de etapas

| Etapa | Estado | Dependencias / observación |
|---|---|---|
| S00 | HECHO | Baseline reproducible, fixture sintética sin APIs reales y ocho capturas; ver `baseline.md`. Vitest conserva 48 fallos previos en `vendor/spatialposters`. |
| S01 | HECHO | S00; contratos C1/C4 y evidencia de ejecución abajo. |
| S02 | HECHO | S01; B02 sigue abierto para smoke nativo Windows/mpv. |
| S03 | PENDIENTE | S02 |
| S04 | PENDIENTE | S01 |
| S05 | PENDIENTE | S04 |
| S06 | PENDIENTE | S01 |
| S07 | BLOQUEADA | S06 y B01: falta código real del backend de cuentas |
| S08 | PENDIENTE | S07 |
| S09 | PENDIENTE | S01 |
| S10 | PENDIENTE | S09, S02, S04 |
| S11 | PENDIENTE | S00 |
| S12 | PENDIENTE | S11, S01, S03 |
| S13 | PENDIENTE | S03, S05, S06, S08, S10, S12 |

## Bloqueos

- **B01 ABIERTO:** `aetherio-backend/src` vacío en el árbol observado; no se ha localizado aquí la implementación de la API de cuentas. Aportar código real y entorno local antes de ejecutar S07. No crear otra autenticación ni afirmar que cloud está implementado.
- **B02 ABIERTO:** smoke nativo Windows/mpv no ejecutado en S00 ni S02; Playwright no lo sustituye.

## S01 — ejecución

- **Estado:** HECHA. **Fecha:** 2026-11-02. **HEAD:** `429efda9ff20e102235875bd5bcd44aa8a786eeb`; sin commit. El árbol tenía numerosos cambios locales previos; se preservaron.
- **Contratos leídos:** C1/C4; perfiles locales y ámbito de cuenta; persistencia legacy de biblioteca e historial. No se inició S02 ni se cambió UI.
- **Implementado:** `MediaRef`/`EpisodeRef` con claves por tupla JSON, validación tipada, adaptación legacy y aliases explícitos comprobados. Tipos movie/series/anime quedan separados; ids numéricos sin procedencia y prefijos desconocidos quedan en `legacy`; ids addon requieren `addonId`.
- **Ámbito:** captura serializable `{accountScope, profileId, generation}` sin credenciales, eventos/suscripción e invalidación por cambio de perfil/cuenta. Las claves de experiencia registradas se incluyen en adopción/borrado de perfiles; las claves nuevas sin perfil activo quedan aisladas por cuenta. No se rekeyearon claves legacy ni se migraron datos entre cuentas.
- **Escrituras:** resultados tipados, eventos de éxito solo después de persistir, evento independiente de fallo y journal versionado con valores previos/siguientes para lotes multiclave. Recuperación reproducible tras interrupción; versiones futuras se conservan y no se sobrescriben. `buildMediaKey` y firmas/retornos legacy permanecen compatibles; el player no depende de que el guardado local tenga éxito.
- **Archivos S01:** `src/domain/mediaIdentity.ts`, `experienceStorage.ts`, `storageResult.ts` y sus tests; nuevos tests de ciclo de vida en `src/utils/localProfiles.experienceStorage.test.ts` y `src/utils/library.test.ts`; adaptadores en `src/utils/localProfiles.ts`, `src/utils/library.ts`, `src/utils/continueWatching.ts` y tests de progreso. `continueWatching.ts` ya contenía cambios locales ajenos de anime/deportes, que se conservaron.
- **Pruebas RED:** antes de la implementación, el target falló por módulos/variantes try aún inexistentes (3 suites y 2 tests fallidos), como se esperaba.
- **Verificación PASS:** target S01 extendido: 8 archivos, 46 tests; `npx tsc --noEmit`; `git diff --check` (solo avisos Git existentes de conversión LF/CRLF).
- **No ejecutadas:** suite Vitest completa, E2E, smoke nativo Windows/mpv. No eran necesarios cambios UI; B02 permanece abierto. B01 sigue abierto y no afecta S01.
- **Datos/rollback:** JSON y claves legacy conservados; escritura nueva aislada y aditiva. Retirar solo las adiciones S01 de los archivos mencionados; no revertir cambios previos del árbol. Sin commit, despliegue ni acciones remotas.
- **Siguiente etapa habilitada:** S02. No iniciada.

## S02 — ejecución

- **Estado:** HECHA. **Fecha:** 2026-11-02. **HEAD base:** `429efda9ff20e102235875bd5bcd44aa8a786eeb`; sin commit. El árbol ya contenía numerosos cambios locales de otras tareas; se preservaron y no se atribuyen a S02.
- **Contratos leídos:** C1/C2 y criterios S02; identidad de medios, almacenamiento por ámbito, preferencias, progreso legacy y carga de subtítulos.
- **Implementado:** preferencia semántica normalizada por entrega y episodio en `aetherio-title-playback-selections-v1`; identidad mediante `MediaRef`/`EpisodeRef`, registro en almacenamiento de experiencia y aislamiento por ámbito de perfil. Resolución manual → episodio → entrega → idiomas globales → pista por defecto. El legado de sesión/progreso se usa como dato de migración semántica; los ids mpv solo se aplican a la fuente abierta. Selección manual guarda idioma/título/flags, subtítulo apagado persiste como `off`, y las elecciones no escriben idiomas globales. Si falta el audio solicitado se conserva la intención, se usa el fallback disponible y se anuncia una vez por fuente; una elección manual tardía impide re-aplicar la selección automática. `automaticSourceRecovery` queda `false` por defecto y se expone en Ajustes de escritorio y Big Picture; no se implementó recuperación VOD de S03.
- **Archivos S02:** nuevos `src/domain/playbackSelection.ts`, `src/domain/playbackSelection.test.ts`, `src/hooks/usePlaybackSelection.ts`, `src/hooks/usePlaybackSelection.test.ts` y `e2e/playback-selection.spec.ts`; extensiones S02 en `src/config/playbackPreferences.ts`/test, `src/hooks/useSubtitles.ts`, `src/pages/Player/index.tsx`, `src/pages/Player/types.ts`, `src/pages/Settings/index.tsx` y `src/pages/BigPicture/BigPictureSettings.tsx`. Varios archivos ya tenían cambios locales previos ajenos; se conservaron.
- **Verificación PASS:** `npx vitest run src/domain/playbackSelection.test.ts src/hooks/usePlaybackSelection.test.ts src/config/playbackPreferences.test.ts src/pages/Player/mediaTitleIdentity.test.ts` (4 archivos, 26 tests); `npx playwright test e2e/playback-selection.spec.ts --project=chromium` (2/2, cambio semántico de pista al cambiar fuente/episodio, subtítulos `off`, ajuste en ambos modos); `npx tsc --noEmit --noUnusedLocals false`; `git diff --check` (solo avisos preexistentes de conversión LF/CRLF).
- **Incidencia de typecheck:** `npx tsc --noEmit` sigue fallando únicamente por TS6133 en `src/services/movieSeriesNewReleases.ts:84` (`today` declarado y sin leer), archivo ajeno a S02. No se modificó para no ampliar el alcance.
- **No ejecutadas:** smoke nativo Windows/mpv con fixture legal de dos pistas; suite Vitest completa. Playwright usa mpv simulado y no satisface B02. La E2E no cubre perfil B ni proveedor nativo.
- **Datos/rollback:** escritura nueva aditiva y semántica; las preferencias globales y datos legacy se conservan. Desactivar el consumo del almacén nuevo permite volver al comportamiento previo; no borrar claves ni migrar destructivamente. Sin commit, despliegue ni acciones remotas.
- **Siguiente etapa habilitada:** S03. B02 permanece abierto; B01 permanece abierto para S07/S08 y no bloquea S03.

## Registro de planificación

- HEAD observado: `429efda9ff20e102235875bd5bcd44aa8a786eeb` con numerosos cambios locales preexistentes; no se tocaron.
- Git, remoto/default branch y autenticación de gh comprobados solo en lectura; ninguna acción remota realizada.
- Impeccable context ejecutado una vez; se detectó implementación visual vigente sin PRODUCT.md/DESIGN.md. Se completó entrevista de alcance y se creó PRODUCT.md con datos confirmados. No se rediseñó ni se creó DESIGN.md.
- Confirmaciones: incluir Big Picture, conservar diseño/datos/proveedores; autoriza fijar reglas del plan; excluir motivo de recomendaciones y servicios de pago.
- En la sesión de planificación inicial no se ejecutaron build/tests. La evidencia de la ejecución posterior de S00 está en `baseline.md`.
- Archivos propios finales: `PRODUCT.md`, `docs/experience/aetherio-master-experience.md`, este registro. Los dos planes se movieron desde la carpeta ignorada `plans/`; no se modificó `.gitignore`.
- Revisión adversarial independiente: NO EJECUTADA. Se intentó abrir un revisor y la herramienta devolvió `Subagent depth limit reached (1)`; no se cambió configuración ni se simuló una aprobación independiente.
- Revisión documental en esta sesión: 14 etapas únicas S00–S13; delimitadores Markdown equilibrados; cada etapa tiene contexto, dependencias y rollback. Se corrigieron identidad legacy explícita, escrituras multiclave recuperables, snapshot cloud consistente, presupuestos combinados de payload Party, conflictos simultáneos y aislamiento de la configuración E2E Party. Esto no verifica runtime ni reemplaza S00.
- Archivos propios de S00: `e2e/experience-baseline.spec.ts`, `e2e/fixtures/experience.ts`, `e2e/fixtures/experience/core.json`, `docs/experience/baseline.md`, `docs/experience/baseline-captures/*.png` y esta actualización del registro. No se modificó runtime/UI.
- Verificaciones S00: `npx tsc --noEmit` PASS final; `npx vitest run` FAIL (1247 pass/48 fail en vendor); E2E base existente 3/3 PASS; fixture/capturas 1/1 PASS. Fechas, viewport, hashes, causas conocidas y comandos exactos en `baseline.md`.
- Pruebas NO EJECUTADAS: smoke nativo Windows/mpv y pruebas Rust/ejecutable. B02 sigue abierto. B01 sigue abierto para S07/S08.
- Próxima etapa habilitada: **S01**. No iniciada en esta sesión; ejecutar solo en una sesión posterior.

## Plantilla obligatoria por etapa

```text
Etapa:
Estado: EN_CURSO | BLOQUEADA | HECHA
Fecha:
Baseline/commit y cambios previos relevantes:
Contexto y contratos leídos:
Archivos creados/modificados por esta etapa:
Comandos ejecutados y códigos de salida:
Tests/criterios de aceptación comprobados:
Pruebas NO EJECUTADAS:
Bloqueos/incidencias previas o nuevas:
Enmiendas aprobadas, si las hay:
Datos preservados y estrategia de rollback:
Siguiente etapa habilitada:
```

## Enmiendas

Ninguna enmienda de implementación. Las correcciones de revisión del plan se registran como revisión documental, no como funcionalidades hechas.
