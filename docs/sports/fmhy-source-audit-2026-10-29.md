# FMHY Sports: revisión e integración nativa

Fecha: 29 de octubre de 2026. Índice consultado: <https://fmhy.net/video#live-sports>.

## Alcance y límites

Se abrió cada una de las **55 direcciones principales distintas** de Live Sports; Reedsports y Reedstreams comparten URL y se cuentan una vez. No se incluyen los mirrors, enlaces a chats, Live TV general ni Sports Replays. Un HTTP 200 solo confirma acceso a una página, no reproducción de sus streams. La inspección profunda se concentró en los candidatos con feeds públicos; las demás filas siguen pendientes de extractor y verificación de vídeo.

El usuario eligió **solo el reproductor de Aetherio**, sin iframes. No se ejecuta JavaScript remoto, no se resuelven CAPTCHA ni se incorporan claves DRM, sesiones privadas o accesos de pago. No se almacenan listas de URLs firmadas en el código.

## Primera tanda integrada

`fmhy-native` agrega dos sitios, conserva los demás proveedores de Sports y se activa una sola vez en instalaciones existentes. Una desactivación explícita posterior se respeta.

- **SportsBite:** catálogo público observado en `https://sportsbite.org/api/forestgump/matches`. Se leen únicamente literales de datos de sus players `tlive/lol/rs/sk`; nunca se carga un iframe ni se ejecuta el player. Solo se ofrece el HLS si pasa la prueba de segmentos nativos. En la muestra había 112 eventos y 244 entradas de player; **eso no equivale a 244 streams compatibles**. Las muestras con prefijo PNG se rechazan: ffprobe moderno las reconoce con opciones especiales, pero el libmpv incluido en Aetherio no las decodifica.
- **StreamFree:** catálogo `https://streamfree.top/streams`, disponibilidad `/api/v1/sources/{stream_key}`, servidor `/get-stream-key/{stream_key}`. El token temporal se lee del JSON literal del player público y se reconstruye el HLS en cada resolución. Solo se consultan los players que el sitio declara activos. Una señal de muestra abrió con el **libmpv incluido en la app**, H.264 1920×1080 y AAC (dos pistas). Esa muestra era un canal continuo y **no se convierte en un partido ficticio**.

Los partidos futuros aportan agenda, no streams reproducibles. Los finalizados, fechas antiguas, canales continuos y respuestas HTML disfrazadas de vídeo no se ofrecen como partidos en vivo. Se priorizan fuentes explícitamente etiquetadas en español. Hay límites por sitio y de concurrencia, timeout y caché compartida entre agenda/directos. Los fallos de un sitio no eliminan los del otro.

El ajuste de extensiones HLS del backend es exclusivo de rutas HTTPS auditadas de estos dos sitios y de reproducción live. Usa una lista finita de sufijos y protocolos HTTP/HTTPS; no cambia películas, series ni fuentes arbitrarias. **Hay que recompilar/reiniciar el backend Tauri para aplicar ese ajuste.**

La capa actual de identidad del tablero acepta fútbol y MMA; esta integración no cambia esa selección de disciplinas ni introduce una sección de TV lineal.

Nota de repositorio: `src/hooks/useLiveEvents.ts` y `src/services/liveSportsService.ts` ya están excluidos localmente mediante `.git/info/exclude`. La conexión del proveedor y la migración se modificaron en disco, sin alterar esas exclusiones ni hacer commits. Hay que tenerlo en cuenta si se quiere versionar o distribuir esta integración fuera de este workspace.

## Registro página por página

“Pendiente” significa que no se ha validado una ruta nativa; no que sea imposible o que el sitio esté caído. Los errores de DNS/TLS/conexión describen el entorno de revisión, no disponibilidad mundial.

| # | Sitio / URL principal | Evidencia observada / decisión |
|---|---|---|
| 1 | [TimStreams](https://tim-streams.com/) | 200; API `/api/live-upcoming` respondió con 29 eventos. Muestra de player externo devolvió 502; pendiente nativo. |
| 2 | [StreamCorner](https://streamcorner.st/) | 200; app JS; pendiente de extractor/verificación. |
| 3 | [StreamFree](https://streamfree.top/) | 200; integración nativa condicional y prueba con libmpv; ver arriba. |
| 4 | [PPV.ST](https://ppv.st/) | 200; app con API separada; muestras de catálogo ofrecen embeds. Pendiente nativo. |
| 5 | [zlive](https://zlive.st/) | 200; app JS; pendiente. |
| 6 | [StreamSports99](https://streamsports99.ru/) | Conexión rechazada desde este entorno. No integrado. |
| 7 | [DaddyLive](https://dlive.sx/) | 200 tras redirección a `thedaddy.pk`; agenda con `watch.php`. Pendiente. |
| 8 | [SportsBite](https://sportsbite.org/) | 200; integración nativa condicional; solo segmentos compatibles. |
| 9 | [AURA Sports](https://aurasports.xyz/) | 200; app JS; pendiente. |
| 10 | [DamiTV](https://damitv.st/) | 200; API pública observada en `https://ondemand.st/papi/api/streams`. Documenta embeds; muestra de ruta HLS devolvió 403. No integrado. |
| 11 | [90minutes](https://www.90minutes.pro/) | 200; pendiente. |
| 12 | [WatchSports](https://watchsports.su/) | 200; pendiente. |
| 13 | [Strumyk](https://strumyk.pk/) | 200; pendiente. |
| 14 | [Strims24](https://strims24.st/) | 200; pendiente. |
| 15 | [RoxieStreams](https://roxiestreams.su/) | 200; pendiente. |
| 16 | [Cinevid](https://cinevid.st/events) | 200; app JS; pendiente. |
| 17 | [BINTV](https://www.bintv.cc/) | 200; API pública `https://bintvjson.lovable.app/api/public/bintvjson`, con eventos y 219 canales en la muestra. Wrappers/iframes; no se importan los recuentos como streams verificados. Pendiente nativo. |
| 18 | [Futbol-X](https://www.futbol-x.xyz/) | 200; pendiente. |
| 19 | [Watch Footy](https://watchfooty.st/) | DNS no resuelto desde este entorno. |
| 20 | [NTV](https://ntv.cx/) | 200 tras redirección a `/matches/raptor`; pendiente. |
| 21 | [LiveTV](https://livetv.sx/enx/) | DNS no resuelto desde este entorno. |
| 22 | [StreamEast](https://streameast.ga/) | 403 / desafío antibot. Sin evasión, no integrado. |
| 23 | [DaddyLiveHD](https://daddylive.mov/) | 200; pendiente. |
| 24 | [Reedstreams / Reedsports](https://reedstreams.to/) | 200; app y API separada; pendiente. |
| 25 | [xyzstreams](https://xyzstreams.st/) | 200; el endpoint de marcador anunciado en `api.streamxyz.shop:2053` no resolvió DNS. Pendiente. |
| 26 | [Sportsurge](https://v2.sportsurge.net/) | 403 / desafío antibot. No integrado. |
| 27 | [Matchora](https://matchora.to/) | 200; pendiente. |
| 28 | [TotalSportek](https://total-sportekk.st/) | 200 tras redirección a `totalsport-ek.st`; pendiente. |
| 29 | [Sportsurge.st](https://ww1.sportsurge.st/) | 200 tras redirección a `sportsurges.st`; pendiente. |
| 30 | [Tap4Sport](https://tap4sport.st/) | 403 / desafío antibot. No integrado. |
| 31 | [CMVTV](https://cmvv.lovable.app/) | Redirige a `/blocked`: aviso de retirada del hosting. No integrado. |
| 32 | [Fantastic Soda](https://fantasticsoda.com/) | 200; pendiente. |
| 33 | [FSL](https://freestreams-live1h.pk/) | 200 tras redirección a `freestreams-live1i.pk`; pendiente. |
| 34 | [Streami](https://streamic.st/) | 200; pendiente. |
| 35 | [SportOnTV](https://sportontv.click/) | 200; pendiente. |
| 36 | [FalconStreams](https://falconstreams.app/) | 200 tras redirección a `falconstreams.st/home1`; pendiente. |
| 37 | [CricHD](https://crichd.at/) | 200; páginas de eventos; pendiente. |
| 38 | [TheTVApp](https://thetvapp.plus/) | 200 tras redirección a `/v12`; páginas de deportes; pendiente. |
| 39 | [Rerace](https://www.rerace.net/sports/) | 200; enlaces `watch/?m=...`; pendiente. |
| 40 | [MainPortal66](https://mainportal66.com/) | 200; portal de enlaces; pendiente. |
| 41 | [FCTV33](https://www.fctv33go.hair/) | 200 tras redirección a `fctv33go.lol`; pendiente. |
| 42 | [VIP Box Sports](https://vipleague.me/home) | 200 tras redirección a `vipleague.vg/home`; pendiente. |
| 43 | [FawaNews](http://www.fawanews.sc/) | 200 en HTTP; no se añade transporte en claro al conector nuevo. |
| 44 | [Baked.live](https://baked.live/) | Certificado TLS expirado en la revisión. No se desactiva la validación TLS. |
| 45 | [Guide TV](https://guidetv.live/) | 200; pendiente. |
| 46 | [NBAMonster](https://nbamonster.com/) | 200 tras redirección a `/home5`; pendiente. |
| 47 | [OnHockey](https://onhockey.tv/) | 200; pendiente. |
| 48 | [Pitsport](https://pitsport.st/) | 200; app anuncia `/api/v1`; pendiente de catálogo y prueba nativa. |
| 49 | [RacingLap](https://racinglap.net/) | 200; agenda y páginas `/live/{id}`; muestra de página usa iframes. Pendiente nativo. |
| 50 | [OvertakeFans](https://overtakefans.com/) | 200; enlaces a web player y Ace Stream; pendiente nativo. |
| 51 | [F1 Live](https://flive.dpdns.org/) | 200; app JS y página `/watch`; pendiente. |
| 52 | [NontonGP](https://esp32.nontonx.com/) | 200; páginas con fuentes HTML5. Muestra HLS devolvió 403; no integrada. |
| 53 | [r/rugbystreams](https://www.reddit.com/r/rugbystreams/) | Respuesta genérica de Reddit, no lista nativa de streams. |
| 54 | [Live Snooker Guide](https://redd.it/1ibz2yz) | Redirección a Reddit, no lista nativa de streams. |
| 55 | [Tiz-Cycling](https://tiz-cycling.tv/) | 200; sitio con directos y repeticiones; pendiente de distinguir y validar cada tipo. |

## Verificación reproducible

```powershell
npx vitest run src/services/fmhySportsProviders.test.ts src/services/fmhyNativeProbe.test.ts src/services/fmhySportsConfig.test.ts
npx playwright test e2e/fmhy-sports.spec.ts e2e/sports-home.spec.ts e2e/sports-player.spec.ts --workers=1
npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml --test sports_hls_options
```

Los E2E usan respuestas controladas: prueban catálogo → validación → sesión nativa → retorno a Sports, no la disponibilidad futura de terceros. La prueba real de decodificación se hizo aparte con la DLL de libmpv distribuida en `src-tauri/bin/mpv` y salida de vídeo/audio nula. Ninguna muestra conserva cookies, credenciales o tokens en este documento.
