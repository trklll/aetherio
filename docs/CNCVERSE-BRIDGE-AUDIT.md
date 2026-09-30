# Auditoría del mega-addon CNCVerse Bridge

Fecha: 2026-09-28
Addon: `https://cncverse.dpdns.org/u/px9xaawklwpmulusvyp/manifest.json`
`id`: `com.cncverse.stremiobridge.px9xaawklwpmulusvyp` · Cloudstream plugin bridge de NivinCNC

Todo lo de aquí está medido contra el addon en producción, no deducido del manifest.

---

## 1. Resumen en una línea

De ~70 catálogos declarados, **27 extensiones devolvieron alguna vez un stream**, y lo
hicieron **solo para películas** (alguna en español, muchas de India/Bangladesh). Anime,
K-Drama y Bollywood devuelven **cero**, de forma reproducible. Lo único que funciona
bien y rápido son los **directos de deportes**.

---

## 2. Comportamiento de los endpoints

| Endpoint | Estado | Latencia | Nota |
|---|---|---|---|
| `manifest.json` | 200, 28 KB | ~0,4 s | CORS `*` |
| `catalog/tv/*` | 200, poblado | 1,3–4 s | 5 catálogos de directos |
| `catalog/other/*` | 200, a menudo vacío | <1 s | |
| `stream/movie/*`, `stream/series/*` | 200 | **28–49 s** | no cachea, `cf-cache-status: DYNAMIC` |
| `meta/*` | **404** | — | declarado en el manifest, no implementado |
| `subtitles/*` | 200 `{"subtitles":[]}` | 1,5 s | siempre vacío |

**CORS abierto** (`Access-Control-Allow-Origin: *`), así que funciona desde el webview
sin proxy.

**No determinista**: el mismo título devuelve cantidades distintas entre llamadas
(Dune 2 → 90, luego 177, luego 204). El bridge parece ir devolviendo lo que va
resolviendo de sus ~70 extensiones en paralelo.

---

## 3. Proveedores que devolvieron streams

27 extensiones reales, más 2 etiquetas que no son sitios sino el extractor genérico
del propio bridge (`CNC Verse`, `CNC Verse Mobile` = HubCloud/Cloudstream bypass).

| # | Etiqueta en `name` | Volumen típico | Tipo | ¿Duplicada en Aetherio? |
|---|---|---|---|---|
| 1 | `Cinefreak` | 37 | LatAm | no |
| 2 | `VegaMovies` | 43 | India | no |
| 3 | `Movies4u` | 24 | India | no |
| 4 | `Hindmoviez` | 24 | India (OTT) | no |
| 5 | `MovieLinkBDProvider` | 36 | Bangladesh | no |
| 6 | `PikashowProvider` | 12 | India (OTT) | no |
| 7 | `PelispediaProvider` | 14 | LatAm | no |
| 8 | `MultiMoviesProvider` | 3 | India | no |
| 9 | `Pelisplus4KProvider` | 3 | LatAm | parcial (`PelisPlusHD`) |
| 10 | `Hdmovie2` | 8 | India | no |
| 11 | `MoviezwapProvider` | 5 | India (Telugu/Tamil) | no |
| 12 | `Goojara` | 1 | India | no |
| 13 | `Fibwatch` | 2 | India/Bangladesh | no |
| 14 | `KisskhProvider` | 1 | K/C drama | no |
| 15 | `Banglaplex` | 7 | Bangladesh | no |
| 16 | `Pencurimovie` | 1 | SEA | no |
| 17 | `HDhub4u` | 4 | India | **sí ×4** |
| 18 | `FourKHDHub` | 12 | India | **sí ×3** |
| 19 | `MoviesDrive` | 28 | India | **sí** |
| 20 | `Moviesmod` | 4 | India | **sí** |
| 21 | `StreamFlixProvider` | 6 | India | **sí** |
| 22 | `AllMovieLandProvider` | 5 | India | **sí** |
| 23 | `MovieBoxProviderIN` | 6 | India | **sí** |
| 24 | `CastleTvProvider` | 14 | India (VLC) | **sí** |
| 25 | `Animeav1` | 4 | Anime | **sí ×3** |
| 26 | `YTS` | 11 (magnet) | Global | **sí** (Torrentio/Nyaa/SeaDex) |
| 27 | `CuevanaProvider` | 4 | LatAm | parcial (`Cuevana UBD`) |

**Las 12 duplicadas se mapearon al chip que Aetherio ya tenía**, así que se suman a su
contador en vez de abrir un chip redundante. Verificado sobre 204 streams reales de
Dune 2: 37 streams se fusionaron en `HdHub`/`4KHDHub`/`Castle`/`MovieBox`/
`StreamFlix`/`MoviesMod`/`AllMovieLand`, y 155 abrieron chips nuevos.

---

## 4. Proveedores declarados que NUNCA devolvieron nada

Declarados en el manifest, cero streams en ninguna de las ~20 consultas:

**Anime** (8 declarados, 0 funcionan): `Anikai`, `KuroAnime`, `AnimeAv1` (en su
catálogo; sí funciona vía otro camino), `AniKoto`, `AniVortex`, `Re:ANIME` ×2,
`Latanime`, `MonoSchinos`, `MundoDonghua`, `Subsplease`

**OTT Hollywood/India** (16): `Netflix`/`NetflixM`, `PrimeVideo`/`PrimeVideoM`,
`Hotstar`/`HotstarM`, `Disney`/`DisneyM`, `Marvel`/`MarvelM`, `StarWars`/`StarWarsM`,
`Pixar`/`PixarM`, `JIO TV`, `JIO TV+`, `SUN NXT`, `MovieBoxIN`, `Xon`, `MassTamilan`

**India/Bangladesh** (12): `BollyFlix`, `TopMovies`, `Rogmovies`, `DoFlix`, `Rtally`,
`5movierulz`, `Idlix`, `HDHub4U`, `LayarKaca`, `Megakino`, `Cinemana`, `YTS MX`

**LatAm** (12): `Cinecalidad`, `Cuevana` (catálogo), `EntrePeliculasySeries`,
`LaMovie`, `PelisplusHD`, `Catálogo HBO Max`, `Catálogo Infantil`, `Catálogo Netflix`,
`Cinefreak` (catálogo), `HDrezka`, `Mlsbd`, `Coflix`

**Otros** (8): `CinemaCity`, `Xon`, `SportsStreams`, `BasketballReplays` ×2,
`PlayZTV Highlights`, `MovieLinkBD` (catálogo), `MundoDonghua`, `Pelispedia` (catálogo)

> Nota: muchos de estos existen en el manifest pero el bridge instance no los tiene
> habilitados. El manifest y la instancia no coinciden.

---

## 5. Cobertura por contenido — la parte incómoda

18 títulos probados en paralelo. El patrón es nítido: **~4 s y vacío** significa que
la instancia no lo cubre; **~48 s** significa que sí y tarda.

| Título | Tipo | Streams | Latencia |
|---|---|---|---|
| The Shawshank Redemption | Hollywood | 134 / 122 / 124 | 28–48 s |
| Dune: Part Two | Hollywood | 90 / 177 / 204 | 47–49 s |
| Extraction | Hollywood | 142 | ~48 s |
| Oppenheimer | Hollywood | 68 | 48 s |
| The Batman | Hollywood | 70 | 49 s |
| Cars 2 | Español | 66 | — |
| Película tamil | Tamil | 3 | — |
| Breaking Bad S1E1 | **Series** | **4** | 31 s |
| One Piece S1E1 | **Anime** | **0** | 3,4 s |
| Jujutsu Kaisen S1E1 | **Anime** | **0** | 3,4 s |
| Your Name | **Anime** | **0** | 3,5 s |
| Demon Slayer: Mugen Train | **Anime** | **0** | 47,6 s |
| Squid Game S1E1 | **K-Drama** | **0** | 4,0 s |
| Crash Landing on You S1E1 | **K-Drama** | **0** | 3,4 s |
| 3 Idiots | **Bollywood** | **0** | 4,0 s |
| RRR | **Bollywood** | **0** | 4,2–11,8 s (4 intentos) |

Descartado que sea rate limiting: **RRR devolvió 0 en 4 intentos** separados, con
latencias distintas. Es cobertura ausente, no un bloqueo.

**Series funcionan fatal** (4 streams en Breaking Bad frente a 142 en una película) y
**anime/K-Drama/Bollywood no existen** para esta instancia. Es justo al revés de lo
que un "mega repo" debería añadir.

---

## 6. Duplicadas: ¿son mejores que las de Aetherio?

Medido sobre Dune 2, mismos ficheros, GET real de cabeceras (sin descargar):

| | Aetherio `HdHub` | CNCVerse `HDhub4u` | CNCVerse `FourKHDHub` |
|---|---|---|---|
| Streams | **54** | 4 | 4 |
| Vivos | **6/8 (75 %)** | 3/4 (75 %) | 2/4 (50 %) |
| TTFB medio | **359 ms** | 642 ms | 738 ms |
| `Content-Length` | ✅ hasta 30 GB | ✅ | ❌ chunked |
| Errores | — | — | **2× HTTP 403** |

**No son mejores.** Son el mismo upstream: el fichero de 18,98 GB aparece en ambos
(`c6b1e8c9…r2.cloudflarestorage.com`). El bridge solo añade un **pool de espejos
alternativo** (`rohitkiskk.workers.dev`, `hubfilesserver2.workers.dev`,
`index.azurecloud.workers.dev`).

Sirven como **reserva** cuando un espejo principal cae, no como fuente principal.
Por eso se fusionan en el chip `HdHub` en vez de abrir los suyos.

Los repos de providers que ya tiene Aetherio cubren 66 scrapers distintos
(yoruix 29, adrianjael 17, eclipsia 11, kennethjys 10, range7 9). Cruzados con las 27
que funcionan aquí: **12 duplicadas, 15 genuinamente nuevas** — y las 15 nuevas son
casi todas de India/Bangladesh/LatAm/SEA.

---

## 7. Deportes — lo único que funciona bien

| Catálogo | Metas | Latencia |
|---|---|---|
| `cnc_StreamedSports_tv` | 95 | 2,1 s |
| `cnc_PlayZTVLiveEvents_tv` | 74 | 2,1 s |
| `cnc_PlayFyLiveEvents_tv` | 64 | 1,7 s |
| `cnc_SportzXLiveEvents_tv` | 28 | 1,3 s |
| `cnc_SKTechLiveEvents_tv` | 22 | 4,0 s |

**283 eventos totales, 283 extraídos correctamente.** Deportes detectados:
Football 150, American Football 44, Cricket 14, Baseball 10, Basketball 10,
Boxing 8, WWE 8, Darts 8, Fight 8, Hockey 5, Motorsport 5, Rugby 2, MotoGP, UFC,
Formula 1, Tennis, Golf.

Competiciones correctamente separadas del deporte: Africa Cup of Nations Qual. 46,
UEFA Nations League 31, International Friendly Games 12, ASEAN Cup 9,
CONCACAF Nations League 7, MLB 8.

**Streams de directo: 734 ms, 11 fuentes** para un evento. Muy por debajo de los
12 s de timeout que usa la página de Deportes.

Aporta respecto a StremVerse: **MotoGP, UFC, WWE, Snooker, Dardos** y las
competiciones de fútbol internacional, que StremVerse no trae.

**No probados** (no se llegaron a consultar): `cnc_SportzXHighlights_tv`,
`cnc_PlayFyHighlights_tv`, `cnc_BasketballReplays_tv` (×2), `cnc_JIOTVIND_tv`,
`cnc_JIOTVPlusIND_tv`, `cnc_SUNNXT_tv`.

### El solape entre catálogos es pequeño

Medido: SKTech ∩ PlayFy = 6 eventos, PlayFy ∩ PlayZTV = 12, SportzX ∩ StreamedSports = 7.
**283 metas → 283 eventos únicos.** O sea, el valor **no** es dar 4 fuentes de reserva
al mismo partido: es la **cobertura** que aporta. La fusión sigue haciéndose para
que un partido que coincida no aparezca dos veces.

### Tres esquemas distintos en los ids

- `cnc:<base64>` decodifica a `"<NombreCatalogo>::<json>"`, no a JSON pelado.
- `eventId` en SKTech/SportzX/PlayZTV; `channelId` en PlayFy; `id` (slug) en
  StreamedSports.
- `title` es **el partido**; `eventInfo.eventName` es **la competición**
  ("One Day International", "Asian Games"). `meta.name` sale abreviado y con emoji
  (`"🏏 IND vs WI"`).
- **64 de 283 ids usan base64 con alfabeto de URL** (`-`/`_`), que `atob` rechaza.

---

## 8. Logos

El addon **no publica logos por extensión**: `logo.png`, `logos.json`,
`providers.json`, `favicon.ico` → todos 404. Solo existe `logo.png` del puente
(127 KB, en el repo de GitHub).

Probados 13 sitios de las extensiones nuevas: solo **3** devuelven favicon, y 2 de
esos son PNG de 2 bytes (vacíos).

**Decisión**: los chips de estas fuentes usan el logo del puente. No es el logo del
sitio, pero sí dice de dónde viene el stream. La alternativa sería rascar logos de
terceros, frágil y de dudosa titularidad.

---

## 9. Veredicto

**Aporta**: deportes (rápido, poblado, con disciplinas que StremVerse no trae) y
~15 extensiones únicas de India/Bangladesh/LatAm/SEA para películas.

**No aporta**: anime, K-Drama, Bollywood, series en general. Cero.

**Coste**: +28–49 s en la primera carga de cada Episodie, por un addon cuyo
timeout por defecto (6 s × 3) lo haría fallar siempre sin cambio de código.

**Duplicadas**: 12 de 27, todas de peor o igual calidad que las propias.
Se fusionan como reserva.

**Licencia**: *All rights reserved*. El README además dice que la versión de
escritorio no soporta el bypass de Cloudflare, así que la cobertura varía por
instancia. Por eso la URL es opt-in y no viene hardcodeada.
