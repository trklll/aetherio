# Canales: hooks y prueba real de las M3U integradas

Fecha: 2026-11-09. Estado: verificación parcial; no equivale a reproducción E2E en la ventana Tauri.

## Error de hooks

- Se confirmó que Vite servía `useTVGuideNavigation.ts` sin firma de React Fast Refresh. Al cambiar el número de hooks dentro de ese módulo, la página podía conservar un estado incompatible durante HMR.
- Se renombró a `useTVGuideNavigation.tsx`, conservando su comportamiento e importación sin extensión. Vite ahora registra su firma.
- `e2e/channels-hmr.spec.ts` falló antes del cambio por la firma ausente y pasó después.
- Se iniciaron servidores de desarrollo en los dos loopbacks: `127.0.0.1:1420` y `localhost:1420` (`::1`). No se abrió un listener LAN.
- Una pestaña que ya sufrió el error necesita una recarga completa. No se modificaron sus preferencias para recuperarla.

## Listas y señales reales

Comando reproducible: `node scripts/check-iptv-integrated.mjs [ruta-del-informe.json]`.

El diagnóstico utiliza las funciones reales de descarga, parseo y comprobación de segmentos de Aetherio. Las descargas de este proceso usan Node, no el puente HTTP nativo de Tauri. No importa listas ni modifica almacenamiento de perfiles.

Primera ejecución, `live.json`:

- Las cinco M3U por defecto de Deportes se descargaron y parsearon: iptv-org Deportes, iptv-org completa, IPTV Free Deportes, Hacks.Tools Deportes y u-din Deportes.
- La lista adjunta contiene 322 entradas. El parser deportivo acepta 314 canales; su filtrado y agrupación no son un recuento del catálogo general.
- TDTChannels: guía XMLTV válida con 186 canales y 7.829 programas en la descarga observada.
- La guía de epg.pw superó el límite de tamaño del descargador. No se aumentó ni desactivó esa protección.
- Muestra acotada de nueve rutas distintas: cuatro pasaron la comprobación de manifiesto y segmento, cinco no la pasaron. Una comprobación fallida no demuestra que un canal esté permanentemente caído.
- El libmpv incluido arrancó el decodificador de tres señales reales: SETANTA SPORTS 1, SETANTA SPORTS 2 y beIN SPORTS XTRA en Español. Se reutilizó `scripts/iptv-native-smoke.py`, con salidas de audio y vídeo nulas, observando `playback-restart`.

En navegador se reprodujo el fallo CORS de IPTV Free y Hacks.Tools (incluida la lista en español incorporada durante la sesión). No se desactivó la seguridad del navegador ni se añadió un proxy para ocultarlo.

Segunda ejecución, `current-catalog.json`, con el catálogo actual de escritorio:

- 1.986 entradas locales: 322 de la M3U adjunta y 1.664 de la instantánea IPTV Cat.
- Las cuatro listas remotas de Canales devolvieron 3.727 entradas: 496 de IPTV Free Deportes, 496 de Hacks Tools Deportes, 313 de u-din y 2.422 de IPTV Free Español.
- Total bruto: 5.713 entradas antes de deduplicación o verificación de señales. No significa que todos esos canales sean distintos o estén operativos.
- En esta segunda muestra pasaron tres de nueve rutas. Esas tres volvieron a arrancar con libmpv, en unos 1,85–1,91 segundos. Las respuestas de las fuentes son variables.

## Cambios concurrentes conservados

Durante la verificación aparecieron `iptvChannels.ts`, `IptvChannelsPage.tsx` y una nueva ruta de escritorio con datos reales. Se conservaron esos cambios. El fallo inicial del catálogo adjunto (`sourceId/sourceName` en lugar de `id/name`) fue corregido concurrentemente; no es una corrección atribuible a esta sesión.

- Después de esa corrección: `npx tsc -p tsconfig.release.json --noEmit` pasó.
- `npx vitest run src/services/iptvChannels.test.ts src/services/iptvSports.test.ts src/services/iptvSportsHttp.test.ts src/services/iptvSportsProvider.test.ts`: 66 pruebas correctas.
- `npx vite build`: correcto, con advertencias de chunks grandes y Browserslist antiguo.
- Las 16 E2E de la maqueta pasaron antes de la sustitución concurrente de la pantalla de escritorio. Ese resultado no certifica la nueva pantalla IPTV.
- `npx playwright test e2e/channels-hmr.spec.ts e2e/channels-tv.spec.ts --workers=1 --reporter=line`: 11 pruebas correctas después de los cambios, incluida la comprobación de visibilidad del foco a 720p.
- `e2e/channels.spec.ts` conserva las expectativas de la antigua maqueta de escritorio; no se debe presentar la suite completa como correcta con la nueva pantalla IPTV.

Resultado completo recibido después de la respuesta inicial:

- `npx playwright test e2e/channels-hmr.spec.ts e2e/channels.spec.ts e2e/channels-tv.spec.ts --workers=1 --reporter=line`: **10 correctas / 7 fallidas**.
- Seis fallos corresponden a expectativas de la maqueta antigua en escritorio, sustituida por el catálogo IPTV. Las pruebas deben adaptarse al comportamiento nuevo sin eliminar su cobertura.
- Un fallo real de TV sigue abierto: el último programa enfocado de Teledeporte se recorta a 720p, con ratio de viewport `0.978875458240509`. Pasó en la ejecución dirigida, pero falló en la combinada; no está corregido ni debe darse por cerrado.
- La regresión de la firma de hooks pasó también en la ejecución completa.
- Hubo además un error de escritura de una traza (`ENOENT`) al compartir `test-results` entre ejecuciones concurrentes. Las siguientes ejecuciones simultáneas deben usar carpetas `--output` distintas; ese error de artefactos no explica los siete fallos de aserciones.

## Límites

- No se accedió al almacenamiento privado de perfiles nativos ni se verificaron listas personales distintas de las integradas.
- No se verificó la reproducción dentro de la ventana Tauri ni con un mando físico.
- La guía TV seguía usando programación sintética al inspeccionarla. El catálogo IPTV de escritorio y esa guía no deben presentarse como la misma integración.
- Los canales de IPTV Cat son una instantánea, no una comprobación en vivo de sus 1.664 señales.
- No se midió cobertura instrumentada ni se hizo una compilación nativa.
