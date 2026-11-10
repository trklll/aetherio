# Aetherio Provider Hub

Servicio central de proveedores de fuentes para Aetherio (PC y móvil), alojado en
**Cloudflare Workers (plan gratuito)**. Permite añadir, corregir o retirar las
fuentes por defecto que ambas apps cargan desde el hub, **sin necesidad de
publicar versiones nuevas de las aplicaciones**. Cada usuario sigue añadiendo
sus propias fuentes en Ajustes; el hub solo gestiona las predeterminadas.

- URL del hub: `https://aetherio-provider-hub.xoolinnbeats.workers.dev` desplegado en la cuenta nueva (subdominio workers.dev: `xoolinnbeats`).
- Alcance: el hub **nunca aloja ni retransmite video**; solo devuelve
  enlaces directos HTTPS que los reproductores de cada app reproducen por su cuenta.
  También publica el directorio y los logos de los add-ons Stremio integrados;
  Aetherio consulta sus manifests y streams directamente.

## Cómo lo consumen las apps

| App | Ruta | Formato |
| --- | --- | --- |
| Aetherio | `GET /addons.json` | Directorio versionado de add-ons Stremio, URLs directas, logos y políticas de integración |
| Aetherio | `GET /addons/logos/<archivo>` | Logos de add-ons servidos por el Hub; Cinemeta tiene SVG de reserva y el resto se cachea desde sus fuentes |
| Aetherio móvil (Stremio-protocolo) | `GET /manifest.json` | Manifest Stremio con `resources: ["stream"]`, `types`, `idPrefixes: ["tt"]` |
| Aetherio móvil (protocolo Stremio) | `GET /stream/movie/ttNNNNN.json` / `GET /stream/series/ttNNNNN:sss:eee.json` | `{streams: [...]}` de todos los proveedores compilados; conserva links directos e infohash/magnets |
| Aetherio PC (ProviderRuntime) | `GET /manifest.json` | Sección `scrapers` con `filename` por proveedor |
| Aetherio PC | `GET /scripts/<id>.js` | Script CommonJS con sandbox del runtime de escritorio |

El directorio Stremio contiene Torrentio Latino, AnimES,
Cinemeta, HdHub, DeepFlix, PenguPlay y Sports Streams · Highfly. La URL pública
del manifest de Highfly no incluye personalización; Aetherio conserva y aplica
la URL propia de cada instalación. NyaaSi sigue siendo un indexer de
Torrentio, no una entrada independiente. La ruta de PenguPlay es relativa a la
API de Aetherio para que nunca se omita el proxy autenticado.

### Contrato del ejecutable

Los scripts son CommonJS con `module.exports = { getStreams }`. El escritorio usa:

```
getStreams(tmdbId, "movie" | "tv", season, episode, title)
```

El Worker invoca `getStreams([tmdbId, type, season, episode, title, null])`.
Los adaptadores Seanime admiten ambas formas sin modificar el contrato de los
proveedores anteriores.

En el sandbox del hub solo está permitido `require` de `axios`, `crypto-js` y
`cheerio` (incluidos en el bundle del runtime), un `fetch` limitado (solo
http(s), respuesta ≤ 8 MB) y un `Buffer` shim. Límites por llamada: 18 s,
12 streams por proveedor, 200 por respuesta y 8 proveedores ejecutándose a la vez.

## ¿Por qué se compila al arrancar?

El runtime actual de Cloudflare Workers (V8 sandbox) **deshabilita
`eval()`/`new Function()` durante las peticiones** y permite la generación de
código solo durante la fase de arranque (evaluación del módulo), con fecha de
compatibilidad ≥ 2025-06-01. Los scripts se compilan entonces un única vez en el
arranque en frío y las peticiones solo ejecutan módulos ya compilados.

- **Bundle (sin I/O):** compila el bundle de dependencias y los scripts prioritarios generados desde KV (`src/generatedProviderScripts.ts`) durante el arranque.
- Cloudflare Workers prohíbe I/O asíncrono en el scope global y `eval()`/`new Function()` dentro de handlers. Por ello, actualizar KV no basta para recompilar el agregador móvil: hay que empaquetar y desplegar el Worker.

### Obsolescencia (semántica de reinicio)

- `PUT /admin/providers/...` actualiza KV inmediatamente. PC consume el script
  desde el hub; para aplicar el cambio a `/stream` móvil ejecuta
  `node scripts/deploy-current-providers.mjs`. Eso despliega **solo el Worker**,
  no una nueva versión de Aetherio.
- Hasta ese despliegue, `/stream/...` sigue ejecutando el bundle anterior y
  añade `x-aetherio-hub: stale=<ids>` cuando detecta una versión desactualizada.

## Endpoints

| Método/ruta | Auth | Descripción |
| --- | --- | --- |
| `GET /health` | — | Estado y resumen del warmup |
| `GET /addons.json` | — | Directorio Stremio administrado en KV; caché 60 s y CORS público |
| `GET /addons/logos/<archivo>` | — | Logo de add-on desde el Hub, `max-age=86400` |
| `GET /manifest.json` | — | Manifest dual (móvil + escritorio), caché 60 s |
| `GET /scripts/<id>.js` | — | Fuente del script (servida con `max-age=300`) |
| `GET /stream/movie/ttNNNNNN.json` | — | Streams de película (cache interno 90 s) |
| `GET /stream/series/ttNNNNNN:ss:ep.json` | — | Streams de serie |
| `GET /admin` | — | Panel web de administración (las operaciones requieren token) |
| `GET /admin/providers` | `x-admin-token` | Lista el registro |
| `PUT /admin/providers/<id>` | `x-admin-token` | Crea/actualiza proveedor (+script inline o `scriptUrl`) |
| `PUT /admin/index` | `x-admin-token` | Sincroniza el índice completo en el orden indicado; elimina los ids omitidos |
| `DELETE /admin/providers/<id>` | `x-admin-token` | Retira el proveedor |
| `POST /admin/validate-script` | `x-admin-token` | Comprueba URL HTTPS, rechaza IPs literales/hosts locales y limita redirecciones/tamaño (sin compilar) |
| `POST /admin/test` | `x-admin-token` | Ejecuta una prueba solo si el módulo ya está compilado en el Worker |
| `GET /admin/addons` | `x-admin-token` | Lista los add-ons Stremio, sus manifests, integración y origen del logo |
| `PUT /admin/addons/<id>` | `x-admin-token` | Añade o edita un add-on; admite IDs de Stremio con puntos y mayúsculas |
| `DELETE /admin/addons/<id>` | `x-admin-token` | Retira un add-on del directorio; no borra configuraciones personales |
| `POST /admin/validate-addon` | `x-admin-token` | Comprueba `{ manifestUrl }` y devuelve el manifest validado, sin guardarlo |
| `GET /addons/logos/custom/<id>` | — | Logo administrado servido por el Hub; caché 300 s, tamaño máximo 512 KB |

`DELETE` retira del registro el proveedor y su script. Para retirarlo solo del
móvil también basta `PUT` con `"enabled": false`.

### Panel: add-ons de Stremio y scripts

`/admin` muestra ambos en una lista: primero las entradas Stremio y
después los proveedores de scripts. Usa el filtro **Stremio / Scripts** o busca
por nombre, ID o descripción. **AnimeAV1** se administra en **Scripts** como
`animeav1`, con su scraper real. Consulta `/catalogo/__data.json` y
`/media/<slug>/<episodio>/__data.json` en `animeav1.com`, conserva variantes
SUB/DUB y las cabeceras de reproducción del scraper original. No consulta
AnimES ni filtra sus resultados. Su logo oficial se sirve desde el Hub en
`/addons/logos/animeav1.svg`. En Aetherio, los scripts tienen una sección y
controles propios en Complementos, tanto en escritorio como en Big Picture.

Con **Nuevo add-on**, introduce la URL del manifest y pulsa **Comprobar manifest**
para importar su ID, nombre y respaldo. Después puedes editar el logo (URL HTTPS),
catálogos, integración oculta, timeout e intentos antes de guardar. Las URLs de logos
publicadas siempre pertenecen al Hub. El manifest y el directorio son públicos:
no introduzcas credenciales ni URLs personales. Highfly conserva su URL pública y
PenguPlay su ruta `/api/penguplay/manifest.json`, que resuelve el proxy autenticado.

Para restablecer el timeout o los intentos a **Automático**, deja el campo vacío
y guarda. La API admite `null` para borrar el override; omitir el campo conserva
su valor anterior.

Los add-ons se guardan en `addons:directory` dentro del namespace existente;
el registro de scripts no se toca. Sin esa clave se usan los valores integrados,
sin escribir ni resembrar durante una lectura. Una edición no requiere desplegar
el Worker: Aetherio recoge el directorio al sincronizar, manteniendo el estado
activado/desactivado elegido por cada usuario y la URL personal de Highfly.
**Por defecto / Manual** indica el estado inicial, no una comprobación de salud.
Los scripts siguen requiriendo un bundle desplegado para las pruebas del Worker.

Los directorios KV v1/v2 corrigen la antigua separación artificial: retiran
únicamente el alias generado y el filtro complementario de AnimES. La siguiente
edición guarda v3. No se reponen eliminaciones, directorios vacíos ni fuentes
personales; los metadatos administrativos restantes se conservan.

### Importación Seanime revisada

Origen: [Seanime Marketplace de Bas1874](https://raw.githubusercontent.com/Bas1874/Seanime-Marketplace/refs/heads/main/Marketplace/Main.json).
`src/seanime/catalog.lock.json` fija manifests, payloads, versiones, autores
upstream implícitos en su procedencia y SHA-256; `upstream/*.ts.txt` conserva
los originales. Los bundles CommonJS se generan **antes** del despliegue.

- Español: **AnimeAV1, AnimeFLV, JkAnime y Latanime**. AnimeFLV está marcado
  como averiado por el marketplace y se registra pausado, no como fuente sana.
- Adicionales: **20 proveedores de torrents y 7 de streaming** (idiomas de
  marketplace `en`, `ja` o `multi`; se excluyen fuentes de otros idiomas). En streaming
  solo se selecciona audio original y variantes softsub; en torrents se exige
  evidencia RAW/softsub y se rechazan doblajes y hardsubs declarados. Una extensión
  `.mkv` no basta. Los formatos desconocidos quedan fuera; el filtro usa metadatos,
  no promete haber inspeccionado los píxeles de cada vídeo.
- Ese filtro **no** se aplica a las cuatro fuentes españolas, por elección del
  usuario. Los subtítulos seleccionables se conservan.
- Las respuestas mantienen cabeceras, subtítulos, infohashes, magnets y seeders.
  `/stream` consulta todos los proveedores habilitados y devuelve el formato Stremio
  completo; los clientes que no reproduzcan BitTorrent o streams con cabeceras deben
  ignorar esas entradas. La prueba del panel informa de resultados de escritorio.

El puente limita cada ejecución a 12 s, 24 peticiones únicas, 8 MB por respuesta
y 16 MB materializados en total. Cookies, caché de peticiones y estado de cada
extensión viven solo durante esa invocación. No se compilan payloads en handlers.

```bash
# Recompila exactamente los originales fijados; sin red ni cambios en KV.
node scripts/import-seanime-providers.mjs --locked

# Lee y respalda el registro de producción; solo muestra el plan.
node scripts/register-seanime-providers.mjs

# Despliega primero, verifica warmup y añade únicamente los IDs nuevos.
node scripts/register-seanime-providers.mjs --apply
```

Estos tres comandos se ejecutan desde `provider-hub/`. La importación no es una
suscripción ni una siembra automática: el índice KV continúa mandando. El registro
conserva las entradas y estados existentes, aborta si cambiaron durante el deploy
y usa el login de Wrangler sin leer ni rotar `ADMIN_TOKEN`. No publica Aetherio.

Smoke opcional con sitios reales y módulos compilados de un Worker **local**:

```bash
npx playwright test --config provider-hub/seanime-smoke.config.ts
```

Pruebas del panel contra un Worker **local** con KV aislado y un token de prueba:

```bash
npx playwright test --config provider-hub/playwright.config.ts
```

Ese comando se ejecuta desde la raíz del repositorio. La configuración E2E no
carga los secretos ni el namespace de producción y no debe usarse para desplegar.

## Gestión de fuentes (curl)

Comprueba el estado del hub:

```bash
curl https://aetherio-provider-hub.xoolinnbeats.workers.dev/health
```

Añade o actualiza un proveedor con inline script:

```bash
curl -X PUT "https://aetherio-provider-hub.xoolinnbeats.workers.dev/admin/providers/mi-fuente" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data '{
    "name": "Mi Fuente",
    "description": "Enlaces directos (HTML scrape).",
    "supportedTypes": ["movie", "tv"],
    "mobileHeaders": "drop",
    "script": "module.exports = { getStreams: async (tmdbId, type, season, episode, title) => [] };"
  }'
```

Añade un proveedor que apunta a un script∬ remoto:

```bash
curl -X PUT "https://aetherio-provider-hub.xoolinnbeats.workers.dev/admin/providers/otra-fuente" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data '{"name": "Otra", "supportedTypes": ["movie"], "scriptUrl": "https://raw.githubusercontent.com/<user>/<repo>/main/provider.js"}'
```

Deshabilita temporalmente (deja de aparecer en `/manifest.json`):

```bash
curl -X PUT "https://aetherio-provider-hub.xoolinnbeats.workers.dev/admin/providers/mi-fuente" \
  -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  --data '{"enabled": false}'
```

Lista y elimina:

```bash
curl -H "x-admin-token: $ADMIN_TOKEN" \
  "https://aetherio-provider-hub.xoolinnbeats.workers.dev/admin/providers"

curl -X DELETE -H "x-admin-token: $ADMIN_TOKEN" \
  "https://aetherio-provider-hub.xoolinnbeats.workers.dev/admin/providers/mi-fuente"
```

Tras cambios manuales con `PUT` o `DELETE`, aplica el bundle móvil con:

```bash
node scripts/deploy-current-providers.mjs
```

### Sincronizar el set inicial de defaults

Desde `provider-hub/`, primero revisa el plan sin cambios; luego aplica la
sincronización al Worker de producción:

```bash
node scripts/register-defaults.mjs
node scripts/register-defaults.mjs --apply
```

El script escanea las fuentes originales, respeta los filtros y retirados de
Aetherio, comprueba la compatibilidad de cada script, deduplica por id y carga
los scripts y logos en KV. Conserva `scraper.logo` (o el logo del manifest) y,
si falta, intenta recuperar el favicon del dominio principal detectado en el
script. `--apply` sincroniza también el orden: los primeros seis
proveedores son los que se prueban en paralelo para móvil; luego genera el
bundle y despliega solo el Worker. Lee el token de `.admin-token.local` (o
`HUB_ADMIN_TOKEN`); nunca lo muestra.

`PUT /admin/index` es una operación de reemplazo, no de merge. Al omitir un id,
lo retira del manifest y elimina su copia del script. Para cambios de orden,
altas o retiros usa el script de sincronización o revisa cuidadosamente la
lista completa antes de llamar esa ruta.

## Despliegue

```bash
cd provider-hub
npx wrangler kv namespace create PROVIDERS     # pega el id en wrangler.toml
npx wrangler secret put ADMIN_TOKEN            # token admin (uuid largo)
npx wrangler secret put TMDB_BEARER            # opcional: token v4 TMDB
npx wrangler deploy
```

Preferencias TMDB: si hay `TMDB_BEARER`/`TMDB_KEY`, el título se resuelve con
TMDB (`/find/{imdbId}?external_source=imdb_id`); si no, usa **Cinemeta**
(`v3-cinemeta.strem.io`), público y sin clave.

`wrangler tail` para ver los logs de ejecución en producción.

## Límites del plan gratuito

- **10 ms de CPU por petición** de handler (la compilación del warmup del arranque no se factura contra esto).
- **100 000 peticiones/día** (KV + streams cuentan cada una).
- **50 sub-requests por petición** (KV + upstream del proveedor + TMDB/Cinemeta).
- KV: 1 000 escrituras/día, 100 000 lecturas/día (semitas para admin).
- Sin retransmisión de video; solo se devuelven URLs directas HTTPS.

## Estructura

```
provider-hub/
  wrangler.toml           # config (KV, compat date)
  src/
    index.ts              # rutas HTTP + warmup del bundle al arrancar
    sandbox.ts            # compilación/ejecución de scripts (modelo startup-only)
    registry.ts           # KV: índice versionado, registro y carga de scripts
    builtinScripts.ts     # importación de los text modules incluidos
    generatedProviderScripts.ts # scripts KV compilables en module-evaluation
    assets/*.txt          # provider-deps.js + scripts embebidos (text modules)
  scripts/
    register-defaults.mjs # escaneo, validación y sincronización del set inicial
    deploy-current-providers.mjs # empaqueta KV y despliega solo el Worker
    merge.ts              # fusión y adaptación desktop/móvil
    manifest.ts           # manifest dual
    tmdb.ts               # resolución del título (TMDB/Cinemeta)
    responses.ts, types.ts
```

