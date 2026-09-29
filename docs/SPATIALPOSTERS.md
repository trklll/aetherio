# SpatialPosters

Aetherio usa [SpatialPosters](https://github.com/TheAceOfficials/SpatialPosters) para los
pósters con etiquetas (género, año, rating, ranking, logo de distribuidora, sellos de
calidad). Reemplaza por completo a BetterPosters (btttr.cc).

## Cómo funciona

SpatialPosters es un renderizador **server-side** (Next.js + sharp + resvg). No se puede
embeber en el webview de Tauri, así que corre como **proceso hermano** y Aetherio le habla
por HTTP:

```
{instanceUrl}/api/poster/{movie|tv}/{tmdbId}?lang=es&region=MX&...
```

Ventaja frente a btttr: btttr solo servía por IMDb (`/poster/imdb/.../{tt}.jpg`), lo que
obligaba a Aetherio a llevar una capa de resolución TMDB→IMDb. SpatialPosters acepta el ID
TMDB nativo, así que esa capa ya no existe.

Nada se empaqueta dentro de Aetherio: la instancia se corre aparte y la licencia de
SpatialPosters (AGPL-3.0) se mantiene en su propio programa.

## Levantar la instancia

**En la app ya no hay nada que hacer.** SpatialPosters y su runtime Node viajan
dentro de Aetherio como recursos: al abrir la app el server arranca solo, y al
cerrarla se apaga. El usuario no instala Node, no clona nada, no configura URLs.

El build de release lo hace solo: `beforeBuildCommand` en `tauri.conf.json` es
`npm run build && npm run posters:stage`, así que no hay forma de empaquetar Aetherio
sin los posters. Para relanzarlo a mano:

```bash
npm run posters:stage
```

Qué genera (y **no** se commitea: ~60 MB y 2300+ archivos):

```
src-tauri/resources/spatialposters/   -> build standalone de Next.js (41 MB)
src-tauri/resources/bin/node.exe      -> runtime Node portable (83 MB)
```

El script es idempotente y detecta antigüedad, así que llamarlo de más no cuesta nada:

| Situación | Qué hace | Medido |
|---|---|---|
| Todo al día | no hace nada | ~3 s |
| Cambió un `.ts` de SpatialPosters | recompila y vuelve a copiar | ~25 s |
| `-Force` | rehace todo | ~2 min |

"Ya existe" no cuenta como "está al día": si el source de SpatialPosters cambió, se
recompila. Sin esto la app seguiría sirviendo el server viejo indefinidamente y nadie
se enteraría.

Detalle importante: el tracer de `output: standalone` de Next copia el `.node` de
sharp pero **no** las DLL de libvips. En el proyecto original eso no se nota porque
Node sube de `standalone/` hasta el `node_modules` completo de la raíz; al empaquetar
no hay padre y el server muere con `ERR_DLOPEN_FAILED` (`/api/poster` → 500). Por eso
el script copia los paquetes nativos enteros de sharp.

### Ciclo de vida

- **Arranca** con la app. El comando Rust `start_posters_server` lanza el proceso y
  espera a que responda (hasta 20 s) antes de devolver, así el primer render con
  posters ya lo encuentra vivo.
- **Se apaga** con la app, y también si Aetherio **crashea**: el `node.exe` se asigna
  a un Job Object de Windows con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, así que el SO
  lo mata aunque el proceso padre muera a la fuerza. Sin esto quedaba un node.exe
  huérfano ocupando el puerto 3000 y ~200 MB de RAM para siempre.
- Es **idempotente**: si ya hay algo escuchando en el puerto, no se relanza nada.
- Si falla (recursos sin empaquetar, por ejemplo) **no rompe el arranque**: Aetherio
  sigue con los pósters de TMDB.

### Para desarrollo de SpatialPosters

Estos comandos siguen existiendo para trabajar sobre el server por separado:

```bash
npm run posters:setup     # primera vez (clonea, npm install, compila)
npm run posters:start     # arranca standalone en :3000
npm run posters           # estado + prueba real de un poster
npm run posters:stop      # detiene
```

O directo:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\spatialposters.ps1 setup
```

Para un amigo esto **no** hace falta: la app ya lo trae. Requisitos: **Node ≥ 22**
(el script lo comprueba y falla con un mensaje claro). Instalación por defecto:
`Projects\SpatialPosters`, como repo hermano. Cambiable con `-Path`.

Desarrollo (rebuild automático):

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\spatialposters.ps1 start -Dev
```

### Qué hace el script y por qué

- **Arma el runtime standalone a mano.** SpatialPosters compila con
  `output: standalone`, así que `npm start` no funciona: hay que copiar
  `.next/static` y `public` dentro de `.next/standalone` y arrancar `node server.js`.
  Es lo mismo que hace su Dockerfile.
- **Arranca el calentado.** La caché de pósteres es in-memory, así que sin precalentar
  cada arranque arranca frío. El script dispara `/api/warmup` en segundo plano.
- **Verifica de verdad**, no solo que el puerto esté abierto: pide un póster real y
  reporta bytes y milisegundos.

### Trampa conocida: `/api/health` siempre devuelve 503

No lo uses como sonda de vida ni para monitorearlo. Solo lee la clave del header
`x-api-key` (a propósito, para no dejarla en una query que queda en los logs) y nunca
del entorno. Sin ese header marca todas las comprobaciones como 401 y responde **503
aunque el server esté perfectamente bien**. Para comprobar que está vivo, pide un
póster o un catálogo.

## Configuración

El script escribe `.env.local` así, sin ninguna clave real:

```
TMDB_BASE_URL=https://trkll.aetherio.workers.dev/api/tmdb
TMDB_API_KEY=via-proxy-no-se-usa
LOG_LEVEL=info
```

> **Requisito:** sin `TMDB_BASE_URL` ni `TMDB_API_KEY` la ruta de póster responde **503**
> (`TMDB API key is missing`) y los catálogos de ranking vienen vacíos.
>
> La clave real nunca está en la máquina del usuario: vive como secret del Worker y el
> descriptor descarta cualquier `api_key` que llegue en el request. Por eso el valor del
> `.env.local` es un texto fijo y no un secreto.
>
> Verificado en producción (versión `efc88f50`): 20 identificadores de prueba → **0× 401**.
> Los que no existen devuelven el 404 real de TMDB y los que solo existen en el namespace
> alterno (p. ej. `movie/400001`) se encuentran, porque el reintento movie↔TV ya lleva las
> credenciales del servidor. Antes ese reintento salía sin ellas y devolvía 401.

Para añadir caché persistente (Upstash, plan gratis) sin tocar el `.env.local`:

```bash
$env:SPATIALPOSTERS_KV_URL = "https://tu-upstash.upstash.io"
$env:SPATIALPOSTERS_KV_TOKEN = "..."
npm run posters:setup
```

## Conectar con Aetherio

**No hay que configurar nada.** Dos capas de plug and play:

1. El server ya viene adentro y arranca solo con la app.
2. Aetherio ya apunta a `http://localhost:3000`, que es el puerto que usa.

El campo **Ajustes → SPATIALPOSTERS → URL de la instancia** sigue editable solo para
el caso de que muevas el server a otra máquina o puerto (NAS, otra PC, un contenedor),
o si prefieres correrlo por tu cuenta con `npm run posters:start`. El ajuste es por
perfil, pero el default ya funciona en todos.

Verificado con la configuración borrada de localStorage: 301 imágenes en Home, 203
servidas por SpatialPosters, 0 rotas.

### Detección de instancia caída

Como la instancia es un proceso aparte, puede no estar corriendo. Aetherio lo detecta y se
apaga solo, sin pedir un solo póster:

- Al arrancar hace **un** `GET {instancia}/manifest.json`. Es barato, no llama a TMDB, no pide
  credenciales y viene con `Access-Control-Allow-Origin: *`.
- Si responde, se activa el pipeline. Si no, Aetherio se queda con los pósters de TMDB y **no
  emite ninguna URL** de la instancia: el corte está en `buildSpatialPosterUrl`, que es el
  único punto por el que pasan el hook, las filas de Home, Catalog, Detail y el selector
  manual.
- TTL: 60 s si está arriba, 20 s si está caída. Con la caída cacheada no se vuelve a tocar el
  puerto; al vencer el TTL el siguiente sondeo reintenta, así que **si levantás la instancia
  con la app abierta, Aetherio se reconnecta solo**, sin reiniciar.

Medido: con la instancia apagada, Home hizo **1 petición** a `localhost:3000` (el sondeo) y
**0 peticiones** de pósters, en vez de ~300 URLs rotas.
## Parámetros que usa Aetherio

Emitidos siempre: `lang` y `region` (el upstream cae en `it`/`IT` si no se especifican).

|Ajuste | Parámetro |
|---|---|
| Región | `region` |
| Idioma del póster | `lang` |
| Etiquetas de info (on/off) | `badges=0` |
| Género / Año / Rating | `bg=0` / `by=0` / `br=0` |
| Estilo de etiqueta | `bs` (`shadow`, `pill`, `bar`, `colored`, `bordo`, `vetro`) |
| Etiquetas de ranking (on/off) | `ranking=0` |
| Estilo de ranking | `rs` (`default`, `bar`, `colored`, `pill`, `netflix`) |
| Sellos de calidad | `mq` (`4K`, `HDR`, `DV`, `IMAX`) |
| Logo de distribuidora (on/off) | `netLogo=0` |
| Lado del ribbon | `side` (`left`/`right`) |
| Desenfoque (on/off) | `be=0` |
| Intensidad / Atenuación / Oscuridad | `blur` / `bf` / `bd` |
| Altura del degradado | `gradHeight` |

Rangos validados contra el clamp del servidor: `blur` 1–100, `gradHeight` 5–100,
`bf`/`bd` 0–100. `scale`/`ox`/`oy` (ajuste fino del logo) no se emiten por defecto.

## Orden de las filas Top

Las filas `Top Películas`, `Top Series` y las dos de tendencias se ordenan por el **Top 20 de
JustWatch**, leído del catálogo de la instancia:

```
{instanceUrl}/catalog/{movie|series}/pictorium-jw-{movies|series}.json?region=MX
```

Detalles del formato (**verificados con datos reales**, no solo leyendo el fuente):

- La ruta es `/catalog/...`, **no** el `/catalogs/...` estándar de Stremio. Comprobado:
  `/catalog/...` → **200**, `/catalogs/...` → **404**.
- Responde `Access-Control-Allow-Origin: *`, necesario porque Aetherio hace `fetch` del
  catálogo desde el webview.
- `metas[].id` viene como `tmdb:<id>` (20/20 verificados) → el mapa se indexa por TMDB, sin IMDb.
- `metas[]` trae exactamente `id, type, name, poster, background, banner, logo, releaseInfo,
  imdbRating, genres, description`. **No existe campo de rank**, pero el array ya viene en
  orden de ranking: el puesto es el índice + 1.
- Devuelve `metas: []` si la instancia no tiene `TMDB_API_KEY` (o sea, las filas Top pierden
  el orden pero no rompen).
- Se cachea 1 h por `tipo + instancia + región`, con un presupuesto de 5 s: si el ranking no
  llega a tiempo, la fila conserva su orden y lo que no se rankea queda intercalado.

## Comportamiento y rendimiento (medido en esta máquina)

Valores reales medidos contra la instancia local (Next 16 dev, sin caché persistente):

| Escenario | Tiempo |
|---|---|
| Primer request ever (incluye compilar la ruta) | ~6.9 s |
| Render en frío, título nuevo, server caliente | **1.5 – 2.5 s** |
| Render caliente (mismo póster) | **~110 ms** |
| Catálogo JustWatch, 20 metas | ~3.7 s la primera vez |

Implicaciones:

- **El arranque paga el frío.** Con 6 descargas concurrentes y ~2 s por póster, 6 s de
  prewarm calientan ~18 pósters: aproximadamente la primera pantalla. El resto se
  verifica de forma perezosa al entrar en vista y hace el swap cuando está listo.
- **Sin caché persistente, cada reinicio de Aetherio vuelve a renderizar todo.** La caché
  por defecto es solo en memoria; `data/` queda vacío. Configura Upstash (abajo) o los
  arranques se sienten lentos.

## Caché persistente (recomendado)

Sin esto, cada arranque re-renderiza todo lo que se ve. Opciones:

**Upstash KV** (lo más simple, plan gratis) — en `.env.local`:

```
KV_REST_API_URL=https://tu-upstash.upstash.io
KV_REST_API_TOKEN=...
```

**ImgBB / Cloudinary / R2** — además de cachear, sirven el póster desde una CDN, así que la
latencia cae por debajo de los 110 ms del cache en memoria. Ver `.env.example`.

Precalentar de forma explícita: `GET /api/warmup` en la instancia.

## Fallback y robustez (verificado)

- **503/404 → póster original de TMDB.** Verificado: con la instancia mal configurada la
  ruta devuelve **503** y nunca 500, así que el fallback se activa de forma limpia y la
  card no queda en negro.
- **Params tolerantes.** `region=ZZ`, `lang=zz`, `bs=invalido`, `blur=999`, `gradHeight=999`
  se aceptan con clamp/default: ninguno produce 500.
- **Concurrencia:** las verificaciones offscreen están limitadas a 6 por host (el navegador
  también). Con `sharp` siendo CPU-bound, un arranque en frío sin tope saturaría la
  instancia.
- **Presupuesto de prewarm:** 6 s (ver arriba para la aritmética). Lo que no quepa se
  verifica de forma perezosa al entrar en pantalla.
- El badge de ranking se **oculta** en las filas top (`: { rankingBadges: false }`), porque
  el número grande de la card ya indica el puesto.
- `POSTER_PROBE_FAIL_TTL_MS` = 5 min: una instancia caída no se reintenta en bucle.

## Badge personalizado

Se eliminó. SpatialPosters acepta texto extra (`extra`) pero no color ni posición libre: el
estilo sale de `bs` y `ribbonSide` es para el ribbon de Top 10, no para una esquina
arbitraria. No había equivalente sin reimplementar el horneado en cliente, que es justo lo
que se quería eliminar (el render es server-side).

## Override manual de póster

Se mantiene el de Aetherio (`CardArtworkPicker`): si el usuario elige un póster a mano, gana
sobre SpatialPosters. El selector incluye la opción "SpatialPosters" cuando hay instancia
configurada. No se delega en el store de mappings de SpatialPosters (requiere autenticar
contra la instancia).

## Verificación

```bash
npx tsc --noEmit        # sin errores
npm run test:posters    # 44 tests
npx vite build          # bundle ok
```

Tests propios de la integración: `src/config/spatialPosters.test.ts` (23) y
`src/services/posterArtworkCache.test.ts` (3).
