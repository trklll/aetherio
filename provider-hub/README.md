# Aetherio Provider Hub

Servicio central de proveedores de fuentes para Aetherio (PC y móvil), alojado en
**Cloudflare Workers (plan gratuito)**. Permite añadir, corregir o retirar las
fuentes por defecto que ambas apps cargan desde el hub, **sin necesidad de
publicar versiones nuevas de las aplicaciones**. Cada usuario sigue añadiendo
sus propias fuentes en Ajustes; el hub solo gestiona las predeterminadas.

- URL del hub: `https://aetherio-provider-hub.xoolinnbeats.workers.dev` desplegado en la cuenta nueva (subdominio workers.dev: `xoolinnbeats`).
- Alcance: el hub **nunca aloja ni retransmite video**; solo devuelve
  enlaces directos HTTPS que los reproductores de cada app reproducen por su cuenta.

## Cómo lo consumen las apps

| App | Ruta | Formato |
| --- | --- | --- |
| Aetherio móvil (Stremio-protocolo) | `GET /manifest.json` | Manifest Stremio con `resources: ["stream"]`, `types`, `idPrefixes: ["tt"]` |
| Aetherio móvil | `GET /stream/movie/ttNNNNN.json` / `GET /stream/series/ttNNNNN:sss:eee.json` | `{streams: [...]}` fusionado y seguro para móvil |
| Aetherio PC (ProviderRuntime) | `GET /manifest.json` | Sección `scrapers` con `filename` por proveedor |
| Aetherio PC | `GET /scripts/<id>.js` | Script CommonJS con sandbox del runtime de escritorio |

### Contrato del ejecutable

Los scripts son CommonJS con `module.exports = { getStreams }` y reciben:

```
getStreams(tmdbId, "movie" | "tv", season, episode, title)
```

En el sandbox del hub solo está permitido `require` de `axios`, `crypto-js` y
`cheerio` (incluidos en el bundle del runtime), un `fetch` limitado (solo
http(s), respuesta ≤ 8 MB) y un `Buffer` shim. Límites por llamada: 18 s,
12 streams por proveedor, 200 por respuesta.

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
| `GET /manifest.json` | — | Manifest dual (móvil + escritorio), caché 60 s |
| `GET /scripts/<id>.js` | — | Fuente del script (servida con `max-age=300`) |
| `GET /stream/movie/ttNNNNNN.json` | — | Streams de película (cache interno 90 s) |
| `GET /stream/series/ttNNNNNN:ss:ep.json` | — | Streams de serie |
| `GET /admin/providers` | `x-admin-token` | Lista el registro |
| `PUT /admin/providers/<id>` | `x-admin-token` | Crea/actualiza proveedor (+script inline o `scriptUrl`) |
| `PUT /admin/index` | `x-admin-token` | Sincroniza el índice completo en el orden indicado; elimina los ids omitidos |
| `DELETE /admin/providers/<id>` | `x-admin-token` | Retira el proveedor |

`DELETE` retira del registro el proveedor y su script. Para retirarlo solo del
móvil también basta `PUT` con `"enabled": false`.

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

