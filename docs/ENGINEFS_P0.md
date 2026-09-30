# EngineFS-P0 — Contrato de compatibilidad interno de Aetherio

Objetivo: capa de compatibilidad inspirada en el contrato observado de
`Loukious/stremio-runtime` (ingeniería inversa del `server.js` de Stremio),
montada sobre la sesión `librqbit` ya existente en Aetherio. No reemplaza el
motor P2P ni modifica `vendor/librqbit-8.1.1`.

Aetherio conserva dos URLs internas:

- `native_base_url`: API nativa de `librqbit` (crear, iniciar, pausar,
  estadísticas, eliminar). Solo control y cleanup.
- `enginefs_base_url`: API compatible EngineFS. URL pública de reproducción
  que recibe MPV.

`P2pPlaybackInfo.server_url` sigue apuntando a la API nativa. El target
resuelto para MPV es la URL EngineFS.

## Endpoints P0

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/heartbeat` | Liveness. `200 {"ok":true}`. |
| `GET` | `/settings` | Config efectiva (puerto, cacheSize, versión). |
| `GET` | `/stats.json` | Estado global mínimo del adaptador. |
| `POST` | `/create` | Crear torrent desde magnet, URL `.torrent` o blob hex. Idempotente por info-hash. |
| `POST` | `/{info_hash}/create` | Igual que `/create`, con `announce`, `fileMustInclude`, `guessFileIdx` opcionales. |
| `GET` | `/{info_hash}/stats.json` | `EngineStats` del archivo seleccionado. |
| `GET` | `/{info_hash}/{file_idx}/stats.json` | `EngineStats` del archivo indicado. |
| `GET` | `/{info_hash}/{file_idx}` | Stream del archivo. Soporta `Range`, `HEAD`, `?external=1`, `?download=1`, `?tr=`, `?f=`. |
| `HEAD` | `/{info_hash}/{file_idx}` | Solo headers del stream. |
| `GET` | `/{info_hash}/{file_idx}/{filename}` | Stream ignorando el segmento de nombre (se valida, no se usa como path). |
| `POST` | `/{info_hash}/pause` | Pausa el torrent (proxy nativo). |
| `POST` | `/{info_hash}/remove` | Elimina el torrent (proxy nativo) y limpia el registry. |
| `POST` | `/removeAll` | Elimina todos los torrents del registry. |

Fuera de P0 (P1): proxy remoto, HLS/transcode, casting, archivos
(`rar/zip/7z/tar/nzb/ftp`), `/yt/*`, HTTPS `12470`, `local-addon`, subtítulos.

## Forma `EngineStats`

```json
{
  "infoHash": "<hex-lower-40>",
  "torrentId": "<id-nativo>",
  "fileIdx": 3,
  "fileName": "Show.S01E03.mkv",
  "streamLen": 1474831360,
  "streamProgress": 0.42,
  "progressBytes": 619424256,
  "downloadSpeed": 5242880,
  "uploadSpeed": 5242880,
  "state": "live",
  "wires": null,
  "guessedFileIdx": 3
}
```

- `uploadSpeed` espeja `downloadSpeed` por compatibilidad legacy.
- `wires` es `null` en stats por archivo (igual que el contrato observado).
- Los campos desconocidos de la API nativa no se inventan: se omiten o se
  devuelven `null`.

## Identidad de torrents

- El info-hash se normaliza a hex minúsculas de 40 caracteres.
- Se acepta representación base32 (20 bytes → hex) como alias del mismo hash.
- Mayúsculas/minúsculas colapsan al mismo registro.
- Clave del registry: info-hash normalizado.
- El ID interno de `librqbit` (`torrent_id` numérico o hash) se guarda en la
  entrada del registry, nunca como clave pública.
- Crear dos veces el mismo info-hash devuelve el registro existente
  (idempotente). Dos requests concurrentes comparten el mismo torrent.
- Un fallo de creación no deja entradas incompletas en el registry.

## Selección de archivo

- `file_idx` explícito en la URL tiene prioridad.
- `fileMustInclude` restringe el candidato a ese índice (si no es reproducible,
  se devuelve error en lugar de adivinar otro).
- `guessFileIdx` sugiere el índice cuando no hay `file_idx` explícito.
- Sin ninguno de los anteriores se reutiliza `choose_p2p_file` (score por
  episodio + tamaño, penalizando samples/trailers).
- Índice fuera de rango → `404 {"error":"file_idx fuera de rango"}`.
- Hash desconocido → `404 {"error":"torrent desconocido"}`.

## Streaming HTTP

El adaptador traduce `/{hash}/{idx}` a
`{native}/torrents/{native_id}/stream/{idx}` y copia status y headers:

- `200` sin `Range`; `206` con `Range` válido + `Content-Range`.
- `416` con rango insatisfacible (incluye `Content-Range: bytes */<len>`
  cuando se conoce la longitud).
- `HEAD` devuelve los mismos headers sin cuerpo.
- Rangos sufijo (`bytes=-N`) soportados.
- `Accept-Ranges: bytes` siempre presente en respuestas de stream.
- `Content-Type` por extensión; `Content-Disposition: attachment` con
  `?download=1`.
- `?external=1` → `307` con `Location: /{hash}/{filename}`.
- `?tr=` añade trackers a la creación (no altera un torrent ya creado).
- `?f=` es alias legacy del nombre de archivo, solo validación.
- Si la pieza aún no está disponible, la request espera hasta el timeout de
  metadata/piezas y luego devuelve error; nunca se devuelve contenido parcial
  silencioso ni otro archivo distinto.

## Seguridad (P0)

- Bind exclusivo a `127.0.0.1`.
- Info-hash estrictamente validado (40 hex o 32 base32).
- `file_idx` numérico validado contra la lista de archivos.
- El segmento `{filename}` se valida como nombre simple: se rechazan `..`,
  `/`, `\`, paths absolutos y secuencias URL-encoded equivalentes.
- Body de `/create` limitado a 1 MiB.
- Sin proxy remoto ni lectura arbitraria de archivos locales en P0.
- Torrents privados siguen bloqueados explícitamente hasta disponer de sesión
  sin DHT.
- CORS restringido al contexto local.

## Lifecycle

- El adaptador arranca después de la API nativa y se detiene antes que ella.
- Las URLs EngineFS antiguas no sobreviven a un reinicio: el registry se
  limpia al invalidar el servidor.
- El cleanup (`pause`/`delete`) usa siempre la API nativa.
- La readiness probe de playback comprueba el stream EngineFS público.

## Criterios de aceptación P0

1. `GET /heartbeat` responde `200`.
2. `POST /create` con magnet crea y devuelve `EngineStats`.
3. Repetir el mismo magnet no duplica la sesión.
4. `GET /{hash}/{idx}` con `Range` devuelve `206` con `Content-Range`.
5. `HEAD` devuelve headers sin cuerpo.
6. Seek sobre piezas no descargadas espera hasta timeout y luego falla con
   error explícito.
7. MPV reproduce mediante la URL EngineFS.
8. `POST /{hash}/pause`, reanudación y `POST /{hash}/remove` funcionan.
9. El cleanup no deja torrents huérfanos tras cerrar MPV.
10. Tras reinicio del servidor, las URLs antiguas devuelven `404`, no datos de
    otro torrent.
11. Torrents privados siguen rechazados.
12. La API nativa de Aetherio sigue funcionando sin cambios de comportamiento.
