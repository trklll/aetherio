# Integración del Provider Hub en Aetherio móvil

El hub centraliza las fuentes por defecto para el móvil. Dos caminos posibles:

## A) Ruta exploratoria (sin tocar la app)

En **Ajustes → Fuentes / Añadir fuente (Stremio)**, añade:

```
https://aetherio-provider-hub.xoolinnbeats.workers.dev/manifest.json
```

Con esto la app consulta el manifest del hub (cumple el protocolo Stremio:
`resources: ["stream"]`, `idPrefixes: ["tt"]`, `types: [movie/series]`) y las
streams llegan por:

- Película: `GET <base>/stream/movie/ttNNNNNN.json`
- Serie: `GET <base>/stream/series/ttNNNNNN:ss:ep.json`

Notas del protocolo que el hub ya cumple (verificado contra
`SourceProtocol.kt`/`SourceRepository.kt` del repo móvil):

- `idPrefixes` con `tt` + 12 dígitos; videoId de serie `ttNNNNNN:ss:ep` (ss ≥ 0, ep > 0).
- Streams solo HTTPS directos, **sin** cabeceras/requestHeaders/proxyHeaders,
  sin externalUrl/ytId/infoHash ni campos DRM (merge `mobileHeaders: "drop"`).
- Límites: manifest ≤ 512 KB, streams ≤ 2 MB, `name` ≤ 120, `description` ≤ 600.

## B) Fuentes por defecto en el repo del móvil (recomendado)

Cambiar las metasticias del repo del amigo:
`app/src/main/java/com/panoli707/aetherio/nativeapp/.../ fuentes por defecto` —
reemplazar `id`/URL codificadas en el APK por el manifest del hub:

1. Sustituir el(s) URL(s) predeterminado(s) por
   `https://aetherio-provider-hub.xoolinnbeats.workers.dev/manifest.json`.
2. Mantener la validación de protocolo intacta (es un manifest Stremio estándar).
3. No tocar la lógica de añadir fuentes propias del usuario en Ajustes; el hub
   solo gestiona las predeterminadas.

Esto permite actualizar/corregir/retirar fuentes **sin publicar una nueva
versión del APK**. Tras cambiar scripts en KV/admin, ejecuta
`node scripts/deploy-current-providers.mjs` en `provider-hub/`: empaqueta los
scripts y despliega solo el Worker. Cloudflare no permite leer KV ni compilar
JavaScript dinámico dentro de peticiones, por eso el bundle se compila al
arrancar el Worker.

## Observabilidad

- `GET /health` — estado del hub (version + warmup).
- Cabeceras de respuesta en `/stream/...`:
  - `x-aetherio-hub: stale=<ids>` — el script sigue ejecutando código viejo
    hasta el redeploy del Worker.
  - `x-aetherio-hub: no-compiled-providers` — ningún proveedor ejecutable en
    esta instancia (se compilan solo al arranque).

## Límites a vigilar

- 100k requests/día (plan gratuito de Cloudflare): con ~1 usuario no llega
  cerca; documentado en el README principal.
- El hub solo delega URLs directas; **no sirve video**.

