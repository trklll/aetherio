# Sports: revisión de Reddit y TazzTV

Fecha de comprobación: **29 de octubre de 2026**.

## Resultado

- Se revisó el contenido completo del [live de Reddit](https://www.reddit.com/live/1hnquu38u2snz) y se resolvieron sus **21 enlaces externos deportivos distintos**. Las dos publicaciones repiten los mismos enlaces.
- Los 21 pasan por `link2ly.com` y anuncian **TazzTV como destino predeterminado**, cambiando únicamente el filtro de liga. No son 21 proveedores independientes ni enlaces directos de vídeo.
- La [página de fútbol de TazzTV](https://tazztv.net/es?league=Soccer) devuelve una comprobación antibot desde este entorno. No se pudo inspeccionar un catálogo o reproductor detrás de esa comprobación.
- **Ninguna señal de DAZN o ESPN ni resolución 1920×1080 quedó verificada en esta revisión.** Tampoco se obtuvo una URL HLS/DASH reproducible. Esto no demuestra que el sitio carezca de streams: su contenido no fue accesible para verificarlos.
- No se modificó ningún proveedor ni el reproductor de Aetherio. Este documento es el único archivo añadido por esta revisión.

## Inventario de los enlaces de Reddit

Cada URL de TinyURL se consultó mediante GET. Las 21 terminaron en una página HTTP 200 de `link2ly.com`, titulada «Redirecting…». El destino se leyó del literal `defaultTarget` de esa página, sin ejecutar ese código como parte de un extractor. Se omiten los identificadores de seguimiento de los destinos.

| # | Enlace de Reddit | Destino predeterminado sin seguimiento |
|---|---|---|
| 1 | [Every-sports-now](https://tinyurl.com/Every-sports-now) | `https://tazztv.net/` |
| 2 | [Every-Soccer-here](https://tinyurl.com/Every-Soccer-here) | `https://tazztv.net/?league=Soccer` |
| 3 | [All-NFL-Game](https://tinyurl.com/All-NFL-Game) | `https://tazztv.net/?league=NFL` |
| 4 | [NCAAB-All-MAtchs](https://tinyurl.com/NCAAB-All-MAtchs) | `https://tazztv.net/?league=NCAAB` |
| 5 | [NCAAF-Every-MAtch](https://tinyurl.com/NCAAF-Every-MAtch) | `https://tazztv.net/?league=NCAAF` |
| 6 | [NBA-MAtchs](https://tinyurl.com/NBA-MAtchs) | `https://tazztv.net/?league=NBA` |
| 7 | [Every-Tennis-now](https://tinyurl.com/Every-Tennis-now) | `https://tazztv.net/?league=Tennis` |
| 8 | [NHL-ALL-GAmes](https://tinyurl.com/NHL-ALL-GAmes) | `https://tazztv.net/?league=NHL` |
| 9 | [UFC-ALl-FIghts](https://tinyurl.com/UFC-ALl-FIghts) | `https://tazztv.net/?league=MMA` |
| 10 | [Boxing-Fight-here](https://tinyurl.com/Boxing-Fight-here) | `https://tazztv.net/?league=Boxing` |
| 11 | [Rugby-Every-GAme](https://tinyurl.com/Rugby-Every-GAme) | `https://tazztv.net/?league=Rugby` |
| 12 | [F1-Every-races](https://tinyurl.com/F1-Every-races) | `https://tazztv.net/?league=F1` |
| 13 | [Every-MLB](https://tinyurl.com/Every-MLB) | `https://tazztv.net/?league=MLB` |
| 14 | [GOLF-Every-way](https://tinyurl.com/GOLF-Every-way) | `https://tazztv.net/?league=Golf` |
| 15 | [CFL-MAtch](https://tinyurl.com/CFL-MAtch) | `https://tazztv.net/?league=CFL` |
| 16 | [Motorsports-Here](https://tinyurl.com/Motorsports-Here) | `https://tazztv.net/?league=Motorsports` |
| 17 | [Athletics-now](https://tinyurl.com/Athletics-now) | `https://tazztv.net/?league=Athletics` |
| 18 | [Others-Sports](https://tinyurl.com/Others-Sports) | `https://tazztv.net/?league=Other` |
| 19 | [High-School-Football-try](https://tinyurl.com/High-School-Football-try) | `https://tazztv.net/?league=High+School+Football` |
| 20 | [Euroleague-here](https://tinyurl.com/Euroleague-here) | `https://tazztv.net/?league=Euroleague` |
| 21 | [WNBA-Game](https://tinyurl.com/WNBA-Game) | `https://tazztv.net/?league=WNBA` |

El mismo literal incluye un destino alternativo `jokertvguide.sx`, con los mismos filtros, seleccionado por zona horaria de India. **Solo se observó esa configuración; no se visitó ni verificó ese destino alternativo.**

## Evidencia de TazzTV y límite de la inspección

| Ruta consultada | Observación |
|---|---|
| `https://tazztv.net/es?league=Soccer` | HTTP 302 sin cabecera `Location` en la respuesta HTTP observada; cuerpo HTML «Security check» / «Checking your browser». Incluye componentes de comprobación antibot y CAPTCHA. |
| `https://tazztv.net/sso/start?return_to=%2F` | Ruta observada durante la navegación normal del sitio. La consulta HTTP también devuelve «Security check»; no permite concluir si después se exige una cuenta o un pago. |

La primera apertura en el navegador integrado mostró «Analyzing browser…». Las siguientes navegaciones se interrumpieron al dirigirse a `/sso/start`; no se consiguió mantener abierta una página de reproducción inspeccionable.

Los cuerpos HTML recibidos de ambas rutas no contienen elementos `video`, `source` o `iframe`, menciones `.m3u8`/`.mpd`, ni DAZN/ESPN. **Es una observación de la pantalla de seguridad, no del catálogo real del sitio.** No se resolvió ni eludió el CAPTCHA ni se introdujeron credenciales.

## Consecuencia para Sports

La integración actual usa `LiveSource` para URLs de medios nativos y `fmhy-native` verifica fuentes antes de presentarlas como reproducibles. Una página HTML, un enlace de afiliado o una pantalla de seguridad no sirven como fuente para ese flujo. No se añadieron iframes ni fuentes sin comprobar.

Para evaluar TazzTV falta acceder normalmente a una página concreta que reproduzca un evento. Si el usuario puede abrirla en el navegador integrado, se puede continuar la inspección desde esa página, sin que comparta contraseñas, cookies o claves en el chat. Después habría que verificar el manifiesto, la resolución declarada y la decodificación con el reproductor incluido en Aetherio; una etiqueta «HD» o «Full HD» por sí sola no acredita 1080p.

La revisión previa de otros proveedores permanece separada en [fmhy-source-audit-2026-10-29.md](./fmhy-source-audit-2026-10-29.md). Sus pruebas anteriores no se repitieron aquí ni acreditan DAZN/ESPN en TazzTV.
