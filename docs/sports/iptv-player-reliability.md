# Fiabilidad del reproductor IPTV

Revisión del 30 de octubre de 2026. El objetivo es recuperar cortes transitorios y distinguirlos de fuentes no disponibles, no prometer que cualquier URL de una lista pública funcione.

## Diagnóstico de la captura

`http://50.7.120.34:8080/DAZN1/index.m3u8` devolvió HTTP 404 fuera de Aetherio en dos peticiones independientes (curl normal y User-Agent de navegador, aproximadamente 0,38 s). La DLL libmpv incluida también devolvió HTTP 404 y `MPV_ERROR_LOADING_FAILED` en una comprobación headless posterior (~0,51 s). Es evidencia de indisponibilidad de ese enlace en ese momento, no de una avería general del reproductor ni de todos los canales DAZN.

## Problemas propios corregidos

1. **La reconexión no cubría el manifiesto inicial.** `demuxer-lavf-o` no basta para las peticiones que MPV realiza antes de abrir el demuxer. Se añade el mismo presupuesto HTTP a `stream-lavf-o`, manteniendo las opciones del demuxer para las peticiones posteriores.
2. **El error real se perdía.** MPV entrega la razón y el error de `end-file` en `event.data`, no necesariamente en `mpv_event.error`. Ahora se distingue `eof`, `stop`, `quit`, `redirect` y `error`. Se capturan códigos HTTP de mensajes de libavformat a nivel warning, suscribiéndose antes de inicializar MPV. No se reenvía el log crudo ni se copian URLs firmadas al diagnóstico.
3. **Eventos de cores antiguos podían contaminar una sesión nueva.** Se comprueban generación e identidad del core bajo el bloqueo de ciclo de vida. La generación se reserva antes de esperas de red; una apertura obsoleta no puede detener la fuente que la reemplazó. El frontend espera su cierre pendiente antes de abrir la siguiente.
4. **Los márgenes de carga no eran coherentes con la recuperación nativa.** En directo se permiten 45 s para cargar y 20 s para recibir el primer cuadro. No se aplican esos márgenes a VOD o P2P.
5. **La recuperación no rearmaba toda la sesión.** Las reaperturas de directo reutilizan el mismo ciclo completo que una fuente nueva: reinician EOF, posición, barrera de arranque y estado de archivo cargado. No reanudan desde la posición VOD ni descartan las cabeceras de la fuente.
6. **Se forzaba la pausa de caché durante atascos.** El directo conserva la gestión de buffer de MPV al liberar la barrera inicial y no recibe la secuencia periódica de desbloqueo de VOD mientras está atascado.

## Límites de recuperación

- Nativo: errores de red y HTTP 408/429/500/502/503/504; dos reintentos, retraso individual máximo de 2 s y presupuesto de espera acumulada de 6 s. No se activa `reconnect_at_eof` ni se amplían protocolos/extensiones fuera de los proveedores ya auditados.
- Frontend: como máximo dos reaperturas automáticas de la misma fuente, a 1,5 y 4 s, por selección de fuente. No se cambia silenciosamente a otro canal o addon. El usuario puede elegir otra fuente o reintentar manualmente.
- HTTP 401/403/404/410/429 identificado, formato incompatible y fallos de salida de audio/vídeo no provocan reaperturas automáticas. Sin código HTTP disponible se conserva un diagnóstico genérico y el presupuesto sigue acotado.
- Un bloqueo sin progreso durante 20 s puede activar ese mismo presupuesto. La pausa manual y salir del reproductor cancelan la recuperación pendiente.
- Un 404 no puede repararse aumentando el buffer. No se evitan DRM, permisos, límites de conexiones ni restricciones regionales.

## Canales que se muestran

- La fila de canales deportivos solo incluye una ruta IPTV después de comprobar que responde su manifiesto HLS y al menos un segmento de medios. Se prueban canales sin depender de que el XMLTV tenga una guía; si todas sus rutas fallan, el canal se omite. El selector de fuentes recibe únicamente las rutas verificadas.
- Se comprueban hasta ocho canales en paralelo y, para cada canal, se prueban las rutas en orden hasta encontrar una disponible. El resultado se considera reciente durante 55 s; al caducar, también se oculta de una instantánea antigua hasta que se vuelva a comprobar. Un sondeo no puede prometer que el servidor no caiga un instante después.
- Entre los canales disponibles, la fila conserva la prioridad existente para español: idioma explícito, identidad de canal conocida y metadatos regionales. Los canales de otros idiomas siguen apareciendo después si están disponibles.
- La primera comprobación puede tardar más con listas grandes o servidores lentos. Se prefiere dejar la fila vacía mientras se comprueba antes que presentar URLs que no se han verificado como disponibles.

## Panel de error: invariantes y cierre local

- **Continuidad visual (Operate).** La sección `showFallbackPanel` de `src/pages/Player/index.tsx` extiende el panel existente: conserva la tarjeta oscura, la paleta, la tipografía y su jerarquía, sin rediseñar el hero ni los controles del reproductor. No establece una identidad visual ni tokens nuevos.
- **Diagnóstico útil.** En un fallo de directo, salvo runtime ausente, el título es «No se pudo reproducir el directo», en lugar de «libmpv interno». El mensaje muestra el diagnóstico HTTP cuando se conoce; se conserva el aviso específico si falta el runtime.
- **Recuperación explícita y acotada.** El estado de recuperación se anuncia con `role="status"` solo cuando procede un reintento automático dentro del presupuesto descrito arriba. Se mantiene **Reintentar reproducción**; **Elegir otra fuente**, cuando la sesión admite el selector, abre el panel de fuentes existente sin cambiar de canal automáticamente.
- **Acciones accesibles y adaptables.** Se conserva el reintento blanco como acción primaria y se añade una secundaria oscura con borde. Ambas tienen altura mínima de 44 px y foco visible con contorno blanco de 2 px separado 4 px. La fila permite salto de línea en móvil, sin reducir las áreas de interacción.

Evidencia de QA de este panel: `.impeccable/review/iptv-error-desktop.png` (1280 × 720) y `.impeccable/review/iptv-error-mobile.png` (390 × 844). Son capturas de comprobación, no rasters de producción ni prueba de vídeo nativo o pantalla completa.

El cierre independiente recibido, entregado en cinco secciones, devolvió `disposition: ship` y `material_fixes: []` **solo para este panel**. El detector se ejecutó una vez tras la inspección y devolvió `[]`; este registro documental no repite el detector ni abre otra auditoría. El cierre no aprueba toda la aplicación, todos los canales ni el render nativo en pantalla completa: la evidencia nativa sigue limitada al smoke headless con la DLL real, y los E2E usan el puente Tauri simulado.

## Verificación reproducible

`scripts/iptv-native-smoke.py` usa **la DLL libmpv del proyecto**, un servidor HTTP local y segmentos MPEG-TS generados con FFmpeg. No usa un mock de MPV. `playback-restart` acredita inicio de decodificación/presentación con `vo=null`, no que el compositor de la aplicación dibuje vídeo en pantalla.

```powershell
python scripts/iptv-native-smoke.py --profile both --runs 3 --output "$env:TEMP/opencode/iptv-native-comparison.json"
```

Presupuesto: baseline y dos variantes de transporte; después comprobaciones de corrección/diagnóstico. La variante con solo `demuxer-lavf-o` siguió fallando en el manifiesto inicial y fue descartada; se promovió la que configura ambas capas. No se cambiaron tamaños de buffer ni se eligió una latencia por intuición.

| Caso local, tres repeticiones | Antes | Configuración corregida |
| --- | --- | --- |
| HLS accesible | Inicia 3/3 | Inicia 3/3 |
| Primer manifiesto devuelve 503 y luego se recupera | Falla 3/3 | Inicia 3/3 |
| Servidor mantiene 503 | Falla sin recuperación | Finaliza tras tres peticiones como máximo, sin bucle |
| URL inexistente (404) | Una petición, sin vídeo | Una petición, sin vídeo; diagnóstico HTTP |

Estos resultados no son una tasa de éxito de Internet ni una mejora porcentual general de velocidad. La muestra es pequeña y local. Una prueba remota adicional con Real Madrid TV inició la decodificación con la DLL real en aproximadamente 2,76 s; es una observación puntual.

Validaciones de código:

- `npx vite build`: correcto; avisos no bloqueantes por datos Browserslist desactualizados y algunos chunks mayores de 500 kB.
- Vitest de `src`, excluyendo `vendor/**` y el archivo independiente `entityRanking.test.ts` de `node:test`: 955 pruebas correctas en 104 archivos.
- `npx playwright test e2e/iptv-recovery.spec.ts e2e/sports-iptv.spec.ts e2e/sports-player.spec.ts --workers=1 --trace off`: 17 pruebas correctas. Cubren la exclusión de fuentes caídas, prioridad español, 404, reapertura con cabeceras, presupuesto de recuperación, terminaciones normales y margen de carga; el puente Tauri está simulado en estos E2E. Se desactivó el guardado de trazas para evitar errores de temporales al cerrar Chromium.
- Seis pruebas Rust de `sports_hls_options.rs` y `mpv_events.rs`, compiladas con `rustc --test` sobre los módulos de producción: correctas.
- `cargo check --lib`: correcto con `TAURI_CONFIG={"bundle":{"resources":[]}}` limitado al proceso de comprobación. El comando ordinario chocó con un recurso Node usado por otro proceso; no se cerró ese proceso ni se cambió `tauri.conf.json`.

Los cambios nativos necesitan un ejecutable recompilado y reiniciado: una instancia ya abierta no incorpora código Rust nuevo por recargar la interfaz. No se ha publicado un instalador ni se ha validado una sesión prolongada de todos los canales.
