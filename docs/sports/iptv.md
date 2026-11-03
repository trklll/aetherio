# IPTV en Sports

Diagnóstico y recuperación del reproductor: [Fiabilidad del reproductor IPTV](iptv-player-reliability.md).

## Uso

- Sports incorpora **Canales deportivos**, filtrados por los deportes elegidos en Personalizar. Los canales identificados como españoles aparecen primero; los demás siguen disponibles después, en su orden relativo. Seguir un club no oculta los canales del resto de ese deporte.
- **Listas IPTV** permite añadir una URL M3U, pegar M3U o importar un archivo, activar/desactivar listas y guardar sus guías XMLTV. Las listas se guardan por perfil en este dispositivo.
- Cada card de un partido en directo tiene **Fuentes** para elegir antes de reproducir. Pulsar la card sigue reproduciendo directamente.
- El reproductor normal y Big Picture tienen un botón visible **Fuentes**, junto a los otros controles. Las fuentes IPTV y de addons conviven; elegir un addon no fuerza de nuevo IPTV.

## Decisiones locales de interfaz

- Modo **Operate**: extensión de la interfaz existente, no un rediseño. Se conservan el hero, la tipografía, las superficies y la geometría heredada de las cards; estas decisiones locales no establecen un sistema visual nuevo.
- En anchos de hasta 600 px, el botón **Fuentes** de la card se ancla a la izquierda (`left: 10px; right: auto`) para quedar accesible sin desplazar horizontalmente la primera card. No se cambia el ancho de la card ni se convierte su desbordamiento heredado en una regla para futuras superficies.
- En la barra Big Picture, la excepción de ancho se limita a `[data-player-source-toggle]` para conservar la etiqueta **Fuentes**; no modifica los demás controles.
- El selector de la card y el gestor de listas comparten un diálogo modal nativo: foco contenido, cierre con Escape sin propagarlo a la navegación exterior y devolución del foco al control de origen si sigue montado. Los errores del gestor se anuncian con `role="alert"`.

## Datos iniciales

Lista pública de deportes de [iptv-org](https://github.com/iptv-org/iptv):

`https://iptv-org.github.io/iptv/categories/sports.m3u`

Guía española de [TDTChannels](https://www.tdtchannels.com/):

`https://www.tdtchannels.com/epg/TV.xml`

La guía se detecta también en `x-tvg-url`, `url-tvg` o `tvg-url` de la cabecera M3U. Se admiten XMLTV y XMLTV comprimido con gzip, incluso cuando la URL acaba en `.xml`. La guía inicial no cubre todos los canales internacionales: cada lista puede aportar sus propias guías. Los IDs `TDP.TV`, `E3.TV`, `RMTV.TV`, `GOL.TV` y `Betis.TV` tienen equivalencias explícitas con los IDs españoles de iptv-org.

La prioridad de idioma usa `tvg-language`/metadatos de fuente cuando existen; en su ausencia, reconoce etiquetas como “Español” y algunos IDs de canales locales de países hispanohablantes. Es una preferencia de orden, no un bloqueo: canales sin idioma conocido permanecen en la fila.

## Qué se identifica como partido

No se analiza el vídeo ni se da por hecho que un canal deportivo emite cierto partido. Se cruza el programa actual de XMLTV con los dos participantes, sus alias conocidos, el deporte y el horario del evento del addon. La diferencia máxima entre los inicios es de 45 minutos. No se mezclan categorías femeninas, juveniles o reservas con el primer equipo.

Se excluyen programas caducados, previas, resúmenes y repeticiones identificadas. Una organización como «UFC» no basta: hace falta el combate concreto o un número de evento coincidente. Una fuente solo pasa a primaria tras comprobar un manifiesto HLS de directo y bytes de un segmento TS/fMP4 accesible. La comprobación no garantiza que la guía sea exacta ni que el proveedor mantenga la emisión disponible después.

Cuando falta guía, coincidencia o verificación, el canal se conserva en su fila, pero no se añade como fuente del partido. Un evento nuevo procedente solo de IPTV necesita además una marca explícita de directo en la guía. Los canales lineales conservan una identidad separada: no llenan «Ahora mismo» con partidos inventados.

## Límites y seguridad

- Hasta 10 listas; contenido pegado/archivo de hasta 2 MB. Importaciones por URL y guías: 8 MB descargados y 16 MB descomprimidos.
- Solo destinos HTTP/HTTPS públicos, sin credenciales en la URL ni direcciones privadas/locales. No se admiten literales IPv6. Tokens de una lista en la query se conservan localmente: no se deben publicar capturas ni compartirlos.
- Solo se propagan Referer y User-Agent de la lista; nunca scripts, cookies, Authorization ni cabeceras arbitrarias. No se ejecuta JavaScript ni se resuelven entidades XML externas.
- Caché de catálogo/guía de 10 minutos; fallos reintentables al minuto. La selección del programa se recalcula al refrescar; las asociaciones caducan al acabar el programa.
- Verificaciones acotadas a 16 canales candidatos y dos alternativas por canal, con concurrencia limitada. Se conserva el resto de fuentes de addons.
- No se evitan DRM ni restricciones geográficas. Que un enlace esté en una lista pública no garantiza disponibilidad, derechos de uso ni cobertura de una competición.

## Puntos de extensión y pruebas

- `src/services/iptvSports.ts`: M3U, XMLTV, identidad, filtrado y asociaciones.
- `src/services/iptvSportsHttp.ts`: transporte nativo/web, límites y comprobación HLS.
- `src/services/iptvSportsProvider.ts`: proveedor registrado y cachés, sin una segunda arquitectura de integración.
- `src/services/iptvSportsConfig.ts`: listas por perfil y valores iniciales.
- `src/pages/BigPicture/sportsChannels.ts`: fila lineal independiente de los partidos.
- `src/services/liveSportsService.ts`: mezcla progresiva de proveedores y sesión de fuentes con clave de medio.
- `e2e/sports-iptv.spec.ts`: importación, selección de deportes, fuentes en card/reproductor y desactivación.

Las pruebas de interfaz simulan el puente Tauri: verifican navegación, cabeceras y selección, no que una superficie libmpv real dibuje vídeo. No se añaden dependencias ni servidores nuevos.

## Verificación del 30 de octubre de 2026

| Comprobación | Resultado |
| --- | --- |
| `npm run build` | Correcto tras los últimos cambios; avisos no bloqueantes de Browserslist y tamaño de algunos chunks. |
| `npx tsc --noEmit` | Correcto. |
| `npx vitest run src --exclude 'vendor/**' --exclude 'src/pages/Entity/entityRanking.test.ts'` | 103 archivos y 940 pruebas correctos. |
| `node --experimental-strip-types --test src/pages/Entity/entityRanking.test.ts` | Cuatro pruebas correctas; este archivo utiliza `node:test`, no Vitest. |
| `npx playwright test e2e/sports-iptv.spec.ts e2e/sports-player.spec.ts --workers=2 --output artifacts/iptv-spanish-priority-e2e` | Once pruebas correctas, incluido el orden español primero y el acceso a Fuentes en la primera card móvil sin desplazar horizontalmente. |

La comprobación con los datos públicos reales de iptv-org y TDTChannels, a las 18:27 UTC, importó 453 canales deportivos y encontró programación actual para Esport3, Real Madrid TV y Teledeporte. La comprobación de manifiesto y bytes de medios fue positiva para la primera fuente de Real Madrid TV y negativa para la de Teledeporte. Es una observación puntual, no una garantía de disponibilidad ni una prueba de reproducción nativa completa.

Las nueve capturas `iptv-*.png` de `.impeccable/review/` cubren la fila de canales, el selector de la card, las listas y el reproductor en escritorio y móvil. Son evidencia de QA, no activos de producción. El área de vídeo blanca de las capturas del reproductor corresponde a la ausencia de superficie libmpv en el navegador de pruebas, no a una emisión real validada.

La revisión visual previa encontró un único ajuste material: **Fuentes** quedaba fuera del viewport móvil por el ancho heredado de la card. Tras el anclaje local descrito arriba, el mismo revisor lo calificó como **RESOLVED**, con disposición **ship** limitada a ese ajuste, y no observó regresiones visibles atribuibles en las nueve capturas. Este cierre no aprueba toda la aplicación ni acredita reproducción nativa con libmpv.

La ejecución ampliada de `e2e/sports-home.spec.ts` no quedó completamente verde: presentó fallos de mocks de repeticiones y timeouts durante trabajo concurrente en esa función. No se modificó ese trabajo para corregirlos ni se declara validada toda la suite E2E de la aplicación. La salida dedicada `artifacts/iptv-e2e` evita interferencias con otros procesos que usan `test-results`.
