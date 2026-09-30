//! Capa de compatibilidad EngineFS-P0.
//!
//! Traduce el contrato HTTP observado en `Loukious/stremio-runtime`
//! (ingeniería inversa del `server.js` de Stremio) hacia la API nativa de
//! `librqbit` que ya ejecuta Aetherio. Ver `docs/ENGINEFS_P0.md`.
//!
//! Solo loopback (`127.0.0.1`). Sin proxy remoto, sin HLS, sin archivos
//! comprimidos: eso es P1.

use super::p2p_layer_log;
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// Puerto preferido para compatibilidad con clientes Stremio. Si está
/// ocupado se usa un puerto efímero y se publica la URL efectiva.
pub const ENGINEFS_PREFERRED_PORT: u16 = 11470;
/// Tamaño máximo aceptado del body en `/create` (1 MiB).
pub const ENGINEFS_CREATE_BODY_MAX_BYTES: usize = 1024 * 1024;
/// Timeout de metadata/creación, igual que el flujo P2P existente.
pub const ENGINEFS_METADATA_TIMEOUT_MS: u64 = 20_000;

/// Entrada del registry: mapea info-hash normalizado -> torrent nativo.
#[derive(Clone, Debug)]
pub struct EnginefsEntry {
    pub native_torrent_id: String,
    pub details: serde_json::Value,
    pub selected_file: usize,
    pub created_at: Instant,
    pub last_access: Instant,
}

pub type SharedEnginefsRegistry = Arc<EnginefsRegistry>;

/// Registry `info_hash -> torrent nativo`. La creación concurrente del mismo
/// hash comparte el torrent existente; un fallo no deja entradas incompletas.
pub struct EnginefsRegistry {
    inner: Mutex<HashMap<String, EnginefsEntry>>,
    create_lock: Mutex<()>,
}

impl EnginefsRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            create_lock: Mutex::new(()),
        }
    }

    /// Bloqueo global de creación: serializa creates del mismo o distinto hash
    /// para que dos requests concurrentes no dupliquen sesiones.
    pub fn lock_creation(&self) -> std::sync::MutexGuard<'_, ()> {
        match self.create_lock.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Devuelve la entrada existente o registra la nueva. `is_new == false`
    /// indica deduplicación (el torrent ya existía).
    pub fn register_or_get(&self, hash: &str, entry: EnginefsEntry) -> (EnginefsEntry, bool) {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(existing) = inner.get_mut(hash) {
            existing.last_access = Instant::now();
            return (existing.clone(), false);
        }
        inner.insert(hash.to_string(), entry.clone());
        (entry, true)
    }

    pub fn lookup(&self, hash: &str) -> Option<EnginefsEntry> {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };
        inner.get_mut(hash).map(|entry| {
            entry.last_access = Instant::now();
            entry.clone()
        })
    }

    pub fn update_selected_file(&self, hash: &str, file_idx: usize) -> bool {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };
        inner.get_mut(hash).map_or(false, |entry| {
            entry.selected_file = file_idx;
            entry.last_access = Instant::now();
            true
        })
    }

    pub fn remove(&self, hash: &str) -> Option<EnginefsEntry> {
        match self.inner.lock() {
            Ok(mut inner) => inner.remove(hash),
            Err(poisoned) => poisoned.into_inner().remove(hash),
        }
    }

    pub fn clear(&self) {
        match self.inner.lock() {
            Ok(mut inner) => inner.clear(),
            Err(poisoned) => poisoned.into_inner().clear(),
        };
    }

    pub fn len(&self) -> usize {
        match self.inner.lock() {
            Ok(inner) => inner.len(),
            Err(poisoned) => poisoned.into_inner().len(),
        }
    }

    pub fn native_ids(&self) -> Vec<(String, String)> {
        match self.inner.lock() {
            Ok(inner) => inner
                .iter()
                .map(|(hash, entry)| (hash.clone(), entry.native_torrent_id.clone()))
                .collect(),
            Err(poisoned) => poisoned
                .into_inner()
                .iter()
                .map(|(hash, entry)| (hash.clone(), entry.native_torrent_id.clone()))
                .collect(),
        }
    }
}

impl Default for EnginefsRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Normaliza un info-hash a hex minúsculas de 40 caracteres. Acepta hex
/// (40) y base32 (32, alias del mismo hash). Cualquier otra cosa -> `None`.
pub fn normalize_info_hash(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() == 40 && value.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(value.to_ascii_lowercase());
    }
    if value.len() != 32 {
        return None;
    }
    let mut bytes = Vec::with_capacity(20);
    let mut accumulator = 0u32;
    let mut bit_count = 0u8;
    for character in value.bytes() {
        let digit = match character.to_ascii_uppercase() {
            b'A'..=b'Z' => character.to_ascii_uppercase() - b'A',
            b'2'..=b'7' => character - b'2' + 26,
            _ => return None,
        };
        accumulator = (accumulator << 5) | u32::from(digit);
        bit_count += 5;
        if bit_count >= 8 {
            bit_count -= 8;
            bytes.push(((accumulator >> bit_count) & 0xff) as u8);
        }
    }
    if bytes.len() != 20 || bit_count != 0 {
        return None;
    }
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Extrae el info-hash de un magnet (`xt=urn:btih:...`), normalizado.
pub fn info_hash_from_magnet(magnet: &str) -> Option<String> {
    let magnet = magnet.trim();
    if !magnet.to_ascii_lowercase().starts_with("magnet:") {
        return None;
    }
    let query = magnet.find('?').map(|i| &magnet[i + 1..]).unwrap_or("");
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if !key.eq_ignore_ascii_case("xt") {
            continue;
        }
        let decoded = urlencoding::decode(value).ok()?.into_owned();
        const PREFIX: &str = "urn:btih:";
        if decoded.len() > PREFIX.len() && decoded[..PREFIX.len()].eq_ignore_ascii_case(PREFIX) {
            if let Some(hash) = normalize_info_hash(&decoded[PREFIX.len()..]) {
                return Some(hash);
            }
        }
    }
    None
}

/// Rutas EngineFS-P0.
#[derive(Debug, PartialEq, Eq)]
pub enum EnginefsRoute {
    Heartbeat,
    Settings,
    GlobalStats,
    RemoveAll,
    Create,
    HashCreate { hash: String },
    HashStats { hash: String },
    FileStats { hash: String, idx: usize },
    FileStream { hash: String, idx: usize, filename: Option<String> },
    HashPause { hash: String },
    HashRemove { hash: String },
    NotFound,
}

fn split_path_query(url: &str) -> (&str, &str) {
    match url.find('?') {
        Some(i) => (&url[..i], &url[i + 1..]),
        None => (url, ""),
    }
}

/// Query string -> mapa (último valor gana, claves en minúsculas).
pub fn parse_query_params(query: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let decoded_key = urlencoding::decode(key).map(|v| v.into_owned()).unwrap_or_default();
        let decoded_value = urlencoding::decode(value)
            .map(|v| v.into_owned())
            .unwrap_or_default();
        out.insert(decoded_key.to_ascii_lowercase(), decoded_value);
    }
    out
}

fn parse_file_idx(raw: &str) -> Option<usize> {
    let raw = raw.trim();
    if raw.is_empty() || raw == "-1" {
        return None;
    }
    raw.parse::<usize>().ok()
}

/// Parsea la ruta EngineFS (sin query). El orden importa: las rutas
/// estáticas se resuelven antes que el catch-all de torrent.
pub fn parse_enginefs_route(url: &str) -> EnginefsRoute {
    let (path, _) = split_path_query(url);
    let segments: Vec<String> = path
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            urlencoding::decode(s)
                .map(|v| v.into_owned())
                .unwrap_or_default()
        })
        .collect();
    match segments.as_slice() {
        [] => EnginefsRoute::NotFound,
        [single] if single.eq_ignore_ascii_case("heartbeat") => EnginefsRoute::Heartbeat,
        [single] if single.eq_ignore_ascii_case("settings") => EnginefsRoute::Settings,
        [single] if single.eq_ignore_ascii_case("stats.json") => EnginefsRoute::GlobalStats,
        [single] if single.eq_ignore_ascii_case("removeall") => EnginefsRoute::RemoveAll,
        [single] if single.eq_ignore_ascii_case("create") => EnginefsRoute::Create,
        [hash, second] if second.eq_ignore_ascii_case("create") => {
            match normalize_info_hash(hash) {
                Some(hash) => EnginefsRoute::HashCreate { hash },
                None => EnginefsRoute::NotFound,
            }
        }
        [hash, second] if second.eq_ignore_ascii_case("stats.json") => {
            match normalize_info_hash(hash) {
                Some(hash) => EnginefsRoute::HashStats { hash },
                None => EnginefsRoute::NotFound,
            }
        }
        [hash, second] if second.eq_ignore_ascii_case("pause") => {
            match normalize_info_hash(hash) {
                Some(hash) => EnginefsRoute::HashPause { hash },
                None => EnginefsRoute::NotFound,
            }
        }
        [hash, second] if second.eq_ignore_ascii_case("remove") => {
            match normalize_info_hash(hash) {
                Some(hash) => EnginefsRoute::HashRemove { hash },
                None => EnginefsRoute::NotFound,
            }
        }
        [hash, idx] => match (normalize_info_hash(hash), parse_file_idx(idx)) {
            (Some(hash), Some(idx)) => EnginefsRoute::FileStream {
                hash,
                idx,
                filename: None,
            },
            _ => EnginefsRoute::NotFound,
        },
        [hash, idx, third] if third.eq_ignore_ascii_case("stats.json") => {
            match (normalize_info_hash(hash), parse_file_idx(idx)) {
                (Some(hash), Some(idx)) => EnginefsRoute::FileStats { hash, idx },
                _ => EnginefsRoute::NotFound,
            }
        }
        [hash, idx, first, rest @ ..] => {
            match (normalize_info_hash(hash), parse_file_idx(idx)) {
                (Some(hash), Some(idx)) => {
                    let mut name = first.to_string();
                    for part in rest {
                        name.push('/');
                        name.push_str(part);
                    }
                    EnginefsRoute::FileStream {
                        hash,
                        idx,
                        filename: Some(name),
                    }
                }
                _ => EnginefsRoute::NotFound,
            }
        }
        _ => EnginefsRoute::NotFound,
    }
}

/// Resultado del parseo de `Range`.
#[derive(Debug, PartialEq, Eq)]
pub enum RangeOutcome {
    /// Sin header o header vacío: respuesta 200 completa.
    Full,
    /// `bytes=start-end` / `bytes=start-` (end inclusivo, None = hasta el final).
    Single { start: u64, end: Option<u64> },
    /// `bytes=-N`: últimos N bytes.
    Suffix { length: u64 },
    /// Sintaxis no soportada (p. ej. multi-rango): 416.
    Invalid,
    /// Sintaxis válida pero fuera de los datos: 416.
    Unsatisfiable,
}

/// Parsea `Range` contra la longitud total conocida (`None` = desconocida).
pub fn parse_range_header(value: &str, total: Option<u64>) -> RangeOutcome {
    let value = value.trim();
    if value.is_empty() {
        return RangeOutcome::Full;
    }
    let rest = match value.strip_prefix("bytes=") {
        Some(rest) => rest.trim(),
        None => return RangeOutcome::Invalid,
    };
    // P0: sin multi-rango.
    if rest.contains(',') {
        return RangeOutcome::Invalid;
    }
    let (start_raw, end_raw) = rest.split_once('-').unwrap_or((rest, ""));
    let start_raw = start_raw.trim();
    let end_raw = end_raw.trim();
    if start_raw.is_empty() {
        // Sufijo: bytes=-N
        let n: u64 = match end_raw.parse() {
            Ok(n) => n,
            Err(_) => return RangeOutcome::Invalid,
        };
        if n == 0 {
            return RangeOutcome::Unsatisfiable;
        }
        if let Some(total) = total {
            if total == 0 {
                return RangeOutcome::Unsatisfiable;
            }
        }
        return RangeOutcome::Suffix { length: n };
    }
    let start: u64 = match start_raw.parse() {
        Ok(n) => n,
        Err(_) => return RangeOutcome::Invalid,
    };
    if end_raw.is_empty() {
        if let Some(total) = total {
            if start >= total {
                return RangeOutcome::Unsatisfiable;
            }
        }
        return RangeOutcome::Single { start, end: None };
    }
    let end: u64 = match end_raw.parse() {
        Ok(n) => n,
        Err(_) => return RangeOutcome::Invalid,
    };
    if end < start {
        return RangeOutcome::Invalid;
    }
    if let Some(total) = total {
        if start >= total {
            return RangeOutcome::Unsatisfiable;
        }
    }
    RangeOutcome::Single {
        start,
        end: Some(end),
    }
}

/// Valida el segmento `{filename}` informativo: nombre simple, sin
/// traversal (`..`, `/`, `\`, paths absolutos o equivalentes encoded).
/// Recibe el valor ya URL-decodificado.
pub fn is_safe_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > 512 {
        return false;
    }
    if name.contains('\0') {
        return false;
    }
    // Rechaza traversal y paths: el nombre debe ser un único segmento.
    if name.contains('/') || name.contains('\\') {
        return false;
    }
    if name == "." || name == ".." {
        return false;
    }
    // Segundo pase por si llegó doble-encoded.
    if let Ok(decoded) = urlencoding::decode(name) {
        if decoded.contains('/') || decoded.contains('\\') || decoded == ".." {
            return false;
        }
    }
    // Bloquea `C:` / rutas absolutas estilo Windows y `/` inicial.
    if name.len() >= 2 && name.as_bytes()[1] == b':' {
        return false;
    }
    true
}

/// Content-Type por extensión para respuestas de stream.
pub fn content_type_for_name(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "mkv" => "video/x-matroska",
        "mp4" | "m4v" => "video/mp4",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "ts" | "m2ts" => "video/mp2t",
        "wmv" => "video/x-ms-wmv",
        "srt" => "application/x-subrip",
        "vtt" => "text/vtt",
        _ => "application/octet-stream",
    }
}

pub fn file_name_at(details: &serde_json::Value, idx: usize) -> Option<String> {
    details
        .get("files")
        .and_then(|v| v.as_array())
        .and_then(|files| files.get(idx))
        .and_then(|file| file.get("name"))
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
}

pub fn file_length_at(details: &serde_json::Value, idx: usize) -> Option<u64> {
    details
        .get("files")
        .and_then(|v| v.as_array())
        .and_then(|files| files.get(idx))
        .and_then(|file| file.get("length"))
        .and_then(|v| v.as_u64())
        .filter(|len| *len > 0)
}

pub fn file_count(details: &serde_json::Value) -> usize {
    details
        .get("files")
        .and_then(|v| v.as_array())
        .map(|files| files.len())
        .unwrap_or(0)
}

/// Construye la forma `EngineStats` P0. Los campos sin equivalente nativo se
/// omiten o devuelven `null`; `uploadSpeed` espeja `downloadSpeed` por
/// compatibilidad legacy.
pub fn build_engine_stats(
    hash: &str,
    entry: &EnginefsEntry,
    native_stats: &serde_json::Value,
    file_idx: usize,
) -> serde_json::Value {
    let name = file_name_at(&entry.details, file_idx).unwrap_or_default();
    let length = file_length_at(&entry.details, file_idx);
    let progress_bytes = native_stats
        .get("progress_bytes")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let progress = match length {
        Some(len) if len > 0 => (progress_bytes as f64 / len as f64).clamp(0.0, 1.0),
        _ => 0.0,
    };
    let download_speed = native_stats
        .pointer("/live/download_speed")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let state = native_stats
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    serde_json::json!({
        "infoHash": hash,
        "torrentId": entry.native_torrent_id,
        "fileIdx": file_idx,
        "fileName": name,
        "streamLen": length,
        "streamProgress": progress,
        "progressBytes": progress_bytes,
        "downloadSpeed": download_speed,
        "uploadSpeed": download_speed,
        "state": state,
        "wires": null,
        "guessedFileIdx": entry.selected_file,
    })
}

// ---------------------------------------------------------------------------
// Servidor HTTP (tiny_http, loopback, un worker por request).
// ---------------------------------------------------------------------------

/// Handle del servidor EngineFS. El orden de apagado es: primero el
/// adaptador, después la API nativa.
pub struct EnginefsHandle {
    pub base_url: String,
    shutdown: Arc<AtomicBool>,
    stopped: mpsc::Receiver<()>,
}

struct ServerCtx {
    native_base_url: String,
    registry: SharedEnginefsRegistry,
    control: reqwest::blocking::Client,
    stream: reqwest::blocking::Client,
}

fn cors_headers() -> Vec<tiny_http::Header> {
    vec![
        tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
            .expect("cors header"),
        tiny_http::Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            &b"GET, POST, HEAD, OPTIONS"[..],
        )
        .expect("cors header"),
        tiny_http::Header::from_bytes(
            &b"Access-Control-Allow-Headers"[..],
            &b"Range, Content-Type"[..],
        )
        .expect("cors header"),
        tiny_http::Header::from_bytes(&b"Access-Control-Max-Age"[..], &b"1728000"[..])
            .expect("cors header"),
    ]
}

fn header(name: &[u8], value: &str) -> Option<tiny_http::Header> {
    tiny_http::Header::from_bytes(name, value.as_bytes()).ok()
}

fn json_response(status: u16, value: &serde_json::Value) -> tiny_http::ResponseBox {
    let mut response =
        tiny_http::Response::from_string(value.to_string()).with_status_code(status);
    for h in cors_headers() {
        response.add_header(h);
    }
    if let Some(h) = header(b"Content-Type", "application/json") {
        response.add_header(h);
    }
    response.boxed()
}

fn error_response(status: u16, message: &str) -> tiny_http::ResponseBox {
    json_response(status, &serde_json::json!({ "error": message }))
}

fn request_header<'a>(request: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().to_string().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

/// Arranca el servidor EngineFS en `127.0.0.1:11470` (o puerto efímero si
/// está ocupado) e imprime la línea de contrato `EngineFS server started`.
pub fn start_enginefs_server(
    native_base_url: String,
    registry: SharedEnginefsRegistry,
) -> Result<EnginefsHandle, String> {
    let preferred = format!("127.0.0.1:{}", ENGINEFS_PREFERRED_PORT);
    let server = tiny_http::Server::http(&preferred)
        .or_else(|_| tiny_http::Server::http("127.0.0.1:0"))
        .map_err(|e| format!("No se pudo abrir el servidor EngineFS: {e}"))?;
    let addr = server.server_addr().to_string();
    // `server_addr` se muestra como `127.0.0.1:<puerto>`.
    let base_url = format!("http://{addr}");
    println!("EngineFS server started at {base_url}");
    p2p_layer_log(
        "enginefs_started",
        serde_json::json!({ "baseUrl": base_url, "nativeBaseUrl": "127.0.0.1 (local)" }),
    );

    // Control: 30s para cubrir el timeout de metadata del motor (20s) +
    // margen. Si se agota, el error es de transporte y se mapea a 502.
    let control = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("No se pudo crear cliente EngineFS: {e}"))?;
    let stream = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("No se pudo crear cliente de stream EngineFS: {e}"))?;

    let ctx = Arc::new(ServerCtx {
        native_base_url,
        registry,
        control,
        stream,
    });
    let shutdown = Arc::new(AtomicBool::new(false));
    let loop_shutdown = shutdown.clone();
    let (stopped_tx, stopped_rx) = mpsc::channel::<()>();

    thread::spawn(move || {
        loop {
            if loop_shutdown.load(Ordering::Acquire) {
                break;
            }
            let request = match server.recv_timeout(Duration::from_millis(200)) {
                Ok(Some(request)) => request,
                Ok(None) => continue,
                Err(e) => {
                    p2p_layer_log(
                        "enginefs_accept_error",
                        serde_json::json!({ "error": e.to_string() }),
                    );
                    continue;
                }
            };
            let ctx = ctx.clone();
            // Un worker por request: un stream largo de MPV no bloquea
            // stats/pause/remove de otros torrents.
            thread::spawn(move || handle_request(request, &ctx));
        }
        p2p_layer_log("enginefs_stopped", serde_json::json!({}));
        let _ = stopped_tx.send(());
    });

    Ok(EnginefsHandle {
        base_url,
        shutdown,
        stopped: stopped_rx,
    })
}

/// Detiene el servidor EngineFS. Se llama antes de detener la API nativa.
pub fn stop_enginefs_server(handle: EnginefsHandle) {
    p2p_layer_log(
        "enginefs_stop_requested",
        serde_json::json!({ "baseUrl": handle.base_url }),
    );
    handle.shutdown.store(true, Ordering::Release);
    let stopped = handle.stopped.recv_timeout(Duration::from_secs(5)).is_ok();
    p2p_layer_log(
        "enginefs_stop_finished",
        serde_json::json!({ "baseUrl": handle.base_url, "stopped": stopped }),
    );
}

fn handle_request(mut request: tiny_http::Request, ctx: &ServerCtx) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let response = route_request(&method, &url, &mut request, ctx);
    if let Err(e) = request.respond(response) {
        p2p_layer_log(
            "enginefs_respond_error",
            serde_json::json!({ "url": url, "error": e.to_string() }),
        );
    }
}

fn route_request(
    method: &tiny_http::Method,
    url: &str,
    request: &mut tiny_http::Request,
    ctx: &ServerCtx,
) -> tiny_http::ResponseBox {
    use tiny_http::Method::{Get, Head, Options, Post};
    if *method == Options {
        let mut response = tiny_http::Response::empty(204).boxed();
        for h in cors_headers() {
            response.add_header(h);
        }
        return response;
    }
    let (_, query) = split_path_query(url);
    let params = parse_query_params(query);
    match parse_enginefs_route(url) {
        EnginefsRoute::Heartbeat => {
            if *method != Get {
                return error_response(405, "método no permitido");
            }
            json_response(200, &serde_json::json!({ "ok": true }))
        }
        EnginefsRoute::Settings => {
            if *method != Get {
                return error_response(405, "método no permitido");
            }
            json_response(
                200,
                &serde_json::json!({
                    "engine": "aetherio-enginefs-p0",
                    "baseUrl": "127.0.0.1 (local)",
                    "cacheSize": super::P2P_MAX_CACHE_BYTES,
                    "preferredPort": ENGINEFS_PREFERRED_PORT,
                }),
            )
        }
        EnginefsRoute::GlobalStats => {
            if *method != Get {
                return error_response(405, "método no permitido");
            }
            json_response(
                200,
                &serde_json::json!({ "engine": "aetherio-enginefs-p0", "torrents": ctx.registry.len() }),
            )
        }
        EnginefsRoute::Create => {
            if *method != Post {
                return error_response(405, "método no permitido");
            }
            handle_create(None, &params, request, ctx)
        }
        EnginefsRoute::HashCreate { hash } => {
            if *method != Post {
                return error_response(405, "método no permitido");
            }
            handle_create(Some(hash), &params, request, ctx)
        }
        EnginefsRoute::HashStats { hash } => {
            if *method != Get {
                return error_response(405, "método no permitido");
            }
            handle_stats(&hash, None, ctx)
        }
        EnginefsRoute::FileStats { hash, idx } => {
            if *method != Get {
                return error_response(405, "método no permitido");
            }
            handle_stats(&hash, Some(idx), ctx)
        }
        EnginefsRoute::FileStream { hash, idx, filename } => {
            if *method != Get && *method != Head {
                return error_response(405, "método no permitido");
            }
            handle_stream(&hash, idx, filename.as_deref(), &params, *method == Head, request, ctx)
        }
        EnginefsRoute::HashPause { hash } => {
            if *method != Post {
                return error_response(405, "método no permitido");
            }
            handle_pause(&hash, ctx)
        }
        EnginefsRoute::HashRemove { hash } => {
            if *method != Post {
                return error_response(405, "método no permitido");
            }
            handle_remove(&hash, ctx)
        }
        EnginefsRoute::RemoveAll => {
            if *method != Post {
                return error_response(405, "método no permitido");
            }
            handle_remove_all(ctx)
        }
        EnginefsRoute::NotFound => error_response(404, "ruta desconocida"),
    }
}

fn read_create_body(request: &mut tiny_http::Request) -> Result<String, tiny_http::ResponseBox> {
    let mut body = Vec::new();
    // Lee con límite manual para rechazar bodies gigantes.
    let mut reader = request.as_reader().take((ENGINEFS_CREATE_BODY_MAX_BYTES + 1) as u64);
    if let Err(e) = reader.read_to_end(&mut body) {
        return Err(error_response(400, &format!("no se pudo leer el body: {e}")));
    }
    if body.len() > ENGINEFS_CREATE_BODY_MAX_BYTES {
        return Err(error_response(413, "body demasiado grande"));
    }
    match String::from_utf8(body) {
        Ok(text) => Ok(text),
        Err(_) => Err(error_response(400, "body no es UTF-8 válido")),
    }
}

fn parse_usize_param(params: &HashMap<String, String>, key: &str) -> Option<usize> {
    params.get(key)?.trim().parse::<usize>().ok()
}

fn native_post_text(
    ctx: &ServerCtx,
    url: &str,
    body: &str,
) -> Result<(u16, String), String> {
    let response = ctx
        .control
        .post(url)
        .body(body.to_string())
        .send()
        .map_err(|e| format!("motor P2P local no disponible: {e}"))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .map_err(|e| format!("respuesta P2P ilegible: {e}"))?;
    Ok((status, text))
}

fn extract_details_id(json: &serde_json::Value) -> Result<(serde_json::Value, String), String> {
    let details = json
        .get("details")
        .cloned()
        .ok_or_else(|| String::from("el motor P2P no devolvió detalles del torrent"))?;
    let torrent_id = json
        .get("id")
        .and_then(|v| v.as_u64())
        .map(|v| v.to_string())
        .or_else(|| {
            details
                .get("id")
                .and_then(|v| v.as_u64())
                .map(|v| v.to_string())
        })
        .or_else(|| {
            details
                .get("info_hash")
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
        })
        .ok_or_else(|| String::from("el motor P2P no devolvió id del torrent"))?;
    Ok((details, torrent_id))
}

/// `POST /create` y `POST /{hash}/create`. Idempotente por info-hash: dos
/// requests concurrentes comparten el mismo torrent nativo.
fn handle_create(
    path_hash: Option<String>,
    params: &HashMap<String, String>,
    request: &mut tiny_http::Request,
    ctx: &ServerCtx,
) -> tiny_http::ResponseBox {
    let raw = match read_create_body(request) {
        Ok(raw) => raw.trim().to_string(),
        Err(response) => return response,
    };
    if raw.is_empty() {
        return error_response(400, "body vacío: se esperaba magnet, URL o blob");
    }
    let file_must_include = parse_usize_param(params, "filemustinclude");
    let guess_file_idx = parse_usize_param(params, "guessfileidx");
    let requested = file_must_include.or(guess_file_idx);
    let announces: Vec<String> = params
        .get("announce")
        .map(|v| {
            v.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();

    // Serializa creates para deduplicar concurrentes del mismo hash.
    let _creation = ctx.registry.lock_creation();

    // Candidato a hash: path > magnet del body.
    let candidate_hash = path_hash.clone().or_else(|| {
        if raw.to_ascii_lowercase().starts_with("magnet:") {
            info_hash_from_magnet(&raw)
        } else {
            None
        }
    });

    // Hit de registry: reutiliza sin crear sesión duplicada.
    if let Some(hash) = candidate_hash.as_deref() {
        if let Some(entry) = ctx.registry.lookup(hash) {
            if let Some(wanted) = file_must_include {
                if wanted != entry.selected_file {
                    if file_count(&entry.details) <= wanted {
                        return error_response(404, "file_idx fuera de rango");
                    }
                    let update_url = format!(
                        "{}/torrents/{}/update_only_files",
                        ctx.native_base_url, entry.native_torrent_id
                    );
                    let start_url = format!(
                        "{}/torrents/{}/start",
                        ctx.native_base_url, entry.native_torrent_id
                    );
                    let body = serde_json::json!({ "only_files": [wanted] }).to_string();
                    match ctx.control.post(&update_url).body(body).send() {
                        Ok(r) if r.status().is_success() => {}
                        _ => return error_response(502, "no se pudo cambiar el archivo del torrent"),
                    }
                    match ctx.control.post(&start_url).send() {
                        Ok(r) if r.status().is_success() => {}
                        _ => return error_response(502, "no se pudo reanudar el torrent"),
                    }
                    ctx.registry.update_selected_file(hash, wanted);
                    let entry = ctx.registry.lookup(hash).unwrap_or(entry);
                    return stats_response(hash, &entry, wanted, ctx);
                }
            }
            p2p_layer_log(
                "enginefs_create_dedup",
                serde_json::json!({
                    "infoHash": hash,
                    "ageMs": entry.created_at.elapsed().as_millis(),
                }),
            );
            let idx = requested.unwrap_or(entry.selected_file);
            return stats_response(hash, &entry, idx, ctx);
        }
    }

    // Body a reenviar: magnet + trackers `announce` añadidos.
    let mut forward = raw.clone();
    if forward.to_ascii_lowercase().starts_with("magnet:") {
        for tracker in &announces {
            forward.push_str("&tr=");
            forward.push_str(&urlencoding::encode(tracker));
        }
    }

    // Inspección (solo metadata) para elegir archivo sin descargar.
    let inspect_url = format!(
        "{}/torrents?list_only=true&timeout_ms={}",
        ctx.native_base_url, ENGINEFS_METADATA_TIMEOUT_MS
    );
    let (status, text) = match native_post_text(ctx, &inspect_url, &forward) {
        Ok(result) => result,
        Err(e) => return error_response(502, &e),
    };
    if status < 200 || status >= 300 {
        return error_response(502, &format!("el motor P2P rechazó la fuente: HTTP {status}"));
    }
    let inspected: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return error_response(502, "respuesta P2P inválida al inspeccionar"),
    };
    let inspect_details = match inspected.get("details") {
        Some(d) => d.clone(),
        None => return error_response(502, "el motor P2P no devolvió archivos al inspeccionar"),
    };
    // Tras inspeccionar ya conocemos el hash: dedup también para bodies URL
    // o blob, donde el dedup anticipado era imposible. No se re-añade.
    let inspected_hash = inspect_details
        .get("info_hash")
        .and_then(|v| v.as_str())
        .and_then(normalize_info_hash);
    if candidate_hash.is_none() {
        if let Some(hash) = inspected_hash.as_deref() {
            if let Some(entry) = ctx.registry.lookup(hash) {
                p2p_layer_log(
                    "enginefs_create_dedup",
                    serde_json::json!({
                        "infoHash": hash,
                        "ageMs": entry.created_at.elapsed().as_millis(),
                    }),
                );
                let idx = requested.unwrap_or(entry.selected_file);
                return stats_response(hash, &entry, idx, ctx);
            }
        }
    }
    let selected = match crate::choose_p2p_file(&inspect_details, requested, None) {
        Ok(idx) => idx,
        Err(e) => return error_response(400, &e),
    };

    // Creación real con solo el archivo elegido.
    let add_url = format!(
        "{}/torrents?only_files={}&overwrite=true&timeout_ms={}",
        ctx.native_base_url, selected, ENGINEFS_METADATA_TIMEOUT_MS
    );
    let (status, text) = match native_post_text(ctx, &add_url, &forward) {
        Ok(result) => result,
        Err(e) => return error_response(502, &e),
    };
    if status < 200 || status >= 300 {
        return error_response(502, &format!("el motor P2P rechazó la fuente: HTTP {status}"));
    }
    let created: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return error_response(502, "respuesta P2P inválida al crear"),
    };
    let (details, torrent_id) = match extract_details_id(&created) {
        Ok(result) => result,
        Err(e) => return error_response(502, &e),
    };
    let hash = details
        .get("info_hash")
        .and_then(|v| v.as_str())
        .and_then(normalize_info_hash)
        .or_else(|| candidate_hash.clone())
        .unwrap_or_else(|| torrent_id.to_ascii_lowercase());

    let entry = EnginefsEntry {
        native_torrent_id: torrent_id.clone(),
        details: details.clone(),
        selected_file: selected,
        created_at: Instant::now(),
        last_access: Instant::now(),
    };
    let (_, is_new) = ctx.registry.register_or_get(&hash, entry);
    if !is_new {
        // Carrera: otro thread registró el mismo hash mientras creábamos.
        // Solo se elimina el duplicado nativo si es una sesión distinta a
        // la registrada (mismo id = misma sesión: no tocar).
        let entry = match ctx.registry.lookup(&hash) {
            Some(entry) => entry,
            None => return error_response(502, "registro P2P inconsistente"),
        };
        if entry.native_torrent_id != torrent_id {
            let dup_url = format!("{}/torrents/{}/delete", ctx.native_base_url, torrent_id);
            let _ = ctx.control.post(&dup_url).send();
            p2p_layer_log(
                "enginefs_create_race_dedup",
                serde_json::json!({ "infoHash": hash, "duplicateId": torrent_id }),
            );
        } else {
            p2p_layer_log(
                "enginefs_create_same_session",
                serde_json::json!({ "infoHash": hash, "torrentId": torrent_id }),
            );
        }
        let idx = requested.unwrap_or(entry.selected_file);
        return stats_response(&hash, &entry, idx, ctx);
    }
    p2p_layer_log(
        "enginefs_created",
        serde_json::json!({ "infoHash": hash, "torrentId": torrent_id, "fileIdx": selected }),
    );
    stats_response(&hash, &ctx.registry.lookup(&hash).unwrap_or(EnginefsEntry {
        native_torrent_id: torrent_id,
        details,
        selected_file: selected,
        created_at: Instant::now(),
        last_access: Instant::now(),
    }), selected, ctx)
}

fn stats_response(
    hash: &str,
    entry: &EnginefsEntry,
    file_idx: usize,
    ctx: &ServerCtx,
) -> tiny_http::ResponseBox {
    if file_count(&entry.details) <= file_idx {
        return error_response(404, "file_idx fuera de rango");
    }
    let stats_url = format!(
        "{}/torrents/{}/stats/v1",
        ctx.native_base_url, entry.native_torrent_id
    );
    let native_stats = ctx
        .control
        .get(&stats_url)
        .send()
        .ok()
        .and_then(|r| r.json::<serde_json::Value>().ok())
        .unwrap_or(serde_json::json!({}));
    json_response(200, &build_engine_stats(hash, entry, &native_stats, file_idx))
}

fn handle_stats(hash: &str, idx: Option<usize>, ctx: &ServerCtx) -> tiny_http::ResponseBox {
    let entry = match ctx.registry.lookup(hash) {
        Some(entry) => entry,
        None => return error_response(404, "torrent desconocido"),
    };
    let file_idx = idx.unwrap_or(entry.selected_file);
    stats_response(hash, &entry, file_idx, ctx)
}

fn handle_pause(hash: &str, ctx: &ServerCtx) -> tiny_http::ResponseBox {
    let entry = match ctx.registry.lookup(hash) {
        Some(entry) => entry,
        None => return error_response(404, "torrent desconocido"),
    };
    let url = format!(
        "{}/torrents/{}/pause",
        ctx.native_base_url, entry.native_torrent_id
    );
    match ctx.control.post(&url).send() {
        Ok(r) if r.status().is_success() => json_response(200, &serde_json::json!({ "ok": true })),
        Ok(r) => error_response(502, &format!("pausa rechazada: HTTP {}", r.status())),
        Err(e) => error_response(502, &format!("motor P2P no disponible: {e}")),
    }
}

fn handle_remove(hash: &str, ctx: &ServerCtx) -> tiny_http::ResponseBox {
    let entry = match ctx.registry.lookup(hash) {
        Some(entry) => entry,
        None => return error_response(404, "torrent desconocido"),
    };
    let url = format!(
        "{}/torrents/{}/delete",
        ctx.native_base_url, entry.native_torrent_id
    );
    match ctx.control.post(&url).send() {
        Ok(r) if r.status().is_success() => {
            ctx.registry.remove(hash);
            json_response(200, &serde_json::json!({ "ok": true }))
        }
        Ok(r) => error_response(502, &format!("eliminación rechazada: HTTP {}", r.status())),
        Err(e) => error_response(502, &format!("motor P2P no disponible: {e}")),
    }
}

fn handle_remove_all(ctx: &ServerCtx) -> tiny_http::ResponseBox {
    let mut removed = 0usize;
    for (hash, native_id) in ctx.registry.native_ids() {
        let url = format!("{}/torrents/{}/delete", ctx.native_base_url, native_id);
        if ctx
            .control
            .post(&url)
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            ctx.registry.remove(&hash);
            removed += 1;
        }
    }
    json_response(200, &serde_json::json!({ "ok": true, "removed": removed }))
}

const FORWARD_HEADERS: &[&str] = &[
    "content-length",
    "content-range",
    "accept-ranges",
    "content-type",
    "etag",
    "last-modified",
    "content-disposition",
];

/// `GET|HEAD /{hash}/{idx}[/{filename}]`. Traduce al stream nativo y copia
/// status + headers. Nunca devuelve otro archivo ni contenido parcial
/// silencioso.
fn handle_stream(
    hash: &str,
    idx: usize,
    filename: Option<&str>,
    params: &HashMap<String, String>,
    is_head: bool,
    request: &mut tiny_http::Request,
    ctx: &ServerCtx,
) -> tiny_http::ResponseBox {
    if let Some(name) = filename {
        if !is_safe_filename(name) {
            return error_response(400, "nombre de archivo inválido");
        }
    }
    if let Some(f_param) = params.get("f") {
        if !f_param.is_empty() && !is_safe_filename(f_param) {
            return error_response(400, "parámetro f inválido");
        }
    }
    let entry = match ctx.registry.lookup(hash) {
        Some(entry) => entry,
        None => return error_response(404, "torrent desconocido"),
    };
    if file_count(&entry.details) <= idx {
        return error_response(404, "file_idx fuera de rango");
    }
    let file_name = file_name_at(&entry.details, idx).unwrap_or_default();
    let total = file_length_at(&entry.details, idx);

    // `?external=1` -> redirect legacy al stream con nombre.
    if params.get("external").map(|v| v == "1").unwrap_or(false) {
        let location = if file_name.is_empty() {
            format!("/{hash}/{idx}")
        } else {
            format!("/{hash}/{idx}/{}", urlencoding::encode(&file_name))
        };
        let mut response = tiny_http::Response::empty(307).boxed();
        for h in cors_headers() {
            response.add_header(h);
        }
        if let Some(h) = header(b"Location", &location) {
            response.add_header(h);
        }
        return response;
    }

    // Valida el Range localmente antes de reenviar: sintaxis no soportada o
    // insatisfacible -> 416 explícito, nunca contenido equivocado.
    //
    // El stream nativo (librqbit) solo entiende rangos abiertos
    // (`bytes=<offset>-`): los rangos cerrados y de sufijo se traducen a un
    // rango abierto y el adaptador aplica el límite, sintetizando el 206.
    enum ForwardPlan {
        /// Sin Range o rango abierto: reenvía tal cual y espeja.
        Verbatim { header: Option<String> },
        /// Rango cerrado/sufijo resuelto contra longitud conocida: reenvía
        /// `bytes={start}-`, sirve solo [start, end] y sintetiza el 206.
        Limited { start: u64, end: u64, total: u64 },
    }
    let range_header = request_header(request, "Range").unwrap_or("").to_string();
    let plan = match parse_range_header(&range_header, total) {
        RangeOutcome::Invalid | RangeOutcome::Unsatisfiable => {
            let mut response = error_response(416, "rango no satisfacible");
            if let Some(total) = total {
                if let Some(h) = header(b"Content-Range", &format!("bytes */{total}")) {
                    response.add_header(h);
                }
            }
            return response;
        }
        RangeOutcome::Full => ForwardPlan::Verbatim { header: None },
        RangeOutcome::Single { start: _, end: None } => ForwardPlan::Verbatim {
            header: Some(range_header),
        },
        RangeOutcome::Single {
            start,
            end: Some(end),
        } => match total {
            Some(total) if total > 0 => {
                let end = end.min(total - 1);
                ForwardPlan::Limited { start, end, total }
            }
            // Sin longitud conocida no se puede acotar: espeja el nativo.
            _ => ForwardPlan::Verbatim { header: Some(range_header) },
        },
        RangeOutcome::Suffix { length } => match total {
            Some(total) if total > 0 => {
                let start = total.saturating_sub(length);
                ForwardPlan::Limited { start, end: total - 1, total }
            }
            _ => {
                return error_response(416, "rango no satisfacible");
            }
        },
    };

    let native_url = format!(
        "{}/torrents/{}/stream/{}",
        ctx.native_base_url, entry.native_torrent_id, idx
    );
    let mut outgoing = if is_head {
        ctx.stream.head(&native_url)
    } else {
        ctx.stream.get(&native_url)
    };
    match &plan {
        ForwardPlan::Verbatim { header: None } => {}
        ForwardPlan::Verbatim { header: Some(h) } => {
            outgoing = outgoing.header(reqwest::header::RANGE, h.clone());
        }
        ForwardPlan::Limited { start, .. } => {
            outgoing = outgoing.header(reqwest::header::RANGE, format!("bytes={start}-"));
        }
    }
    let upstream = match outgoing.send() {
        Ok(response) => response,
        Err(e) => return error_response(502, &format!("motor P2P no disponible: {e}")),
    };
    let status = upstream.status().as_u16();
    if !(200..300).contains(&status) && status != 206 && status != 416 {
        return error_response(502, &format!("stream nativo falló: HTTP {status}"));
    }

    // Headers base: copia de la allowlist + garantías del contrato.
    let mut headers = cors_headers();
    // En modo Limited, Content-Length/Content-Range se sintetizan abajo.
    let skip_length = matches!(plan, ForwardPlan::Limited { .. });
    for name in FORWARD_HEADERS {
        if skip_length && (*name == "content-length" || *name == "content-range") {
            continue;
        }
        if let Some(value) = upstream
            .headers()
            .get(*name)
            .and_then(|v| v.to_str().ok())
        {
            if let Some(h) = header(name.as_bytes(), value) {
                headers.push(h);
            }
        }
    }
    // Garantías del contrato aunque el nativo no las envíe.
    if !upstream.headers().contains_key("accept-ranges") {
        if let Some(h) = header(b"Accept-Ranges", "bytes") {
            headers.push(h);
        }
    }
    if !upstream.headers().contains_key("content-type") && !file_name.is_empty() {
        if let Some(h) = header(b"Content-Type", content_type_for_name(&file_name)) {
            headers.push(h);
        }
    }
    if params.get("download").map(|v| v == "1").unwrap_or(false) && !file_name.is_empty() {
        if let Some(h) = header(
            b"Content-Disposition",
            &format!("attachment; filename=\"{file_name}\""),
        ) {
            headers.push(h);
        }
    }
    // DLNA mínimo para clientes que lo exigen.
    if let Some(h) = header(b"transferMode.dlna.org", "Streaming") {
        headers.push(h);
    }

    if let ForwardPlan::Limited { start, end, total } = plan {
        let limit = end.saturating_sub(start) + 1;
        if let Some(h) = header(b"Content-Length", &limit.to_string()) {
            headers.push(h);
        }
        if let Some(h) = header(
            b"Content-Range",
            &format!("bytes {start}-{end}/{total}"),
        ) {
            headers.push(h);
        }
        if is_head {
            let mut response =
                tiny_http::Response::from_data(Vec::<u8>::new()).with_status_code(206);
            for h in headers {
                response.add_header(h);
            }
            return response.boxed();
        }
        let limit_usize: usize = limit.try_into().unwrap_or(usize::MAX);
        return tiny_http::Response::new(
            tiny_http::StatusCode(206),
            headers,
            upstream.take(limit as u64),
            Some(limit_usize),
            None,
        )
        .boxed();
    }

    if is_head {
        let mut response =
            tiny_http::Response::from_data(Vec::<u8>::new()).with_status_code(status);
        for h in headers {
            response.add_header(h);
        }
        return response.boxed();
    }
    if status == 416 {
        let mut response =
            tiny_http::Response::from_data(Vec::<u8>::new()).with_status_code(416);
        for h in headers {
            response.add_header(h);
        }
        return response.boxed();
    }
    let content_length = upstream.content_length().map(|v| v as usize);
    tiny_http::Response::new(
        tiny_http::StatusCode(status),
        headers,
        upstream,
        content_length,
        None,
    )
    .boxed()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_entry() -> EnginefsEntry {
        EnginefsEntry {
            native_torrent_id: "7".to_string(),
            details: serde_json::json!({
                "info_hash": "0123456789abcdef0123456789abcdef01234567",
                "files": [
                    { "name": "Show.S01E03.mkv", "length": 1000 },
                    { "name": "Show.S01E04.mkv", "length": 2000 }
                ]
            }),
            selected_file: 1,
            created_at: Instant::now(),
            last_access: Instant::now(),
        }
    }

    #[test]
    fn normalize_accepts_hex_case_insensitive() {
        let hex = "0123456789ABCDEF0123456789abcdef01234567";
        assert_eq!(
            normalize_info_hash(hex),
            Some("0123456789abcdef0123456789abcdef01234567".to_string())
        );
        assert_eq!(normalize_info_hash("  0123456789abcdef0123456789abcdef01234567  ").map(|v| v.len()), Some(40));
        assert_eq!(normalize_info_hash("xyz"), None);
        assert_eq!(normalize_info_hash(""), None);
        assert_eq!(normalize_info_hash("0123"), None);
    }

    #[test]
    fn normalize_accepts_base32_alias() {
        // 32 x 'A' == 20 bytes cero == 40 x '0'.
        assert_eq!(
            normalize_info_hash("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            Some("0000000000000000000000000000000000000000".to_string())
        );
        assert_eq!(normalize_info_hash("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!"), None);
    }

    #[test]
    fn magnet_hash_extraction() {
        let hex = "0123456789abcdef0123456789abcdef01234567";
        assert_eq!(
            info_hash_from_magnet(&format!("magnet:?xt=urn:btih:{hex}&tr=x")),
            Some(hex.to_string())
        );
        assert_eq!(
            info_hash_from_magnet(&format!("MAGNET:?XT=URN:BTIH:{hex}")),
            Some(hex.to_string())
        );
        assert_eq!(info_hash_from_magnet("magnet:?xt=urn:btih:nope"), None);
        assert_eq!(info_hash_from_magnet("https://example.com/x.torrent"), None);
    }

    #[test]
    fn routes_static_before_catch_all() {
        assert_eq!(parse_enginefs_route("/heartbeat"), EnginefsRoute::Heartbeat);
        assert_eq!(parse_enginefs_route("/settings"), EnginefsRoute::Settings);
        assert_eq!(parse_enginefs_route("/stats.json"), EnginefsRoute::GlobalStats);
        assert_eq!(parse_enginefs_route("/removeAll"), EnginefsRoute::RemoveAll);
        assert_eq!(parse_enginefs_route("/create"), EnginefsRoute::Create);
        assert_eq!(parse_enginefs_route("/"), EnginefsRoute::NotFound);
        assert_eq!(parse_enginefs_route("/nope"), EnginefsRoute::NotFound);
    }

    #[test]
    fn routes_hash_endpoints() {
        let hex = "0123456789abcdef0123456789abcdef01234567";
        assert_eq!(
            parse_enginefs_route(&format!("/{hex}/create")),
            EnginefsRoute::HashCreate { hash: hex.to_string() }
        );
        assert_eq!(
            parse_enginefs_route(&format!("/{hex}/stats.json")),
            EnginefsRoute::HashStats { hash: hex.to_string() }
        );
        assert_eq!(
            parse_enginefs_route(&format!("/{hex}/pause")),
            EnginefsRoute::HashPause { hash: hex.to_string() }
        );
        assert_eq!(
            parse_enginefs_route(&format!("/{hex}/remove")),
            EnginefsRoute::HashRemove { hash: hex.to_string() }
        );
        assert_eq!(
            parse_enginefs_route(&format!("/{hex}/3")),
            EnginefsRoute::FileStream { hash: hex.to_string(), idx: 3, filename: None }
        );
        assert_eq!(
            parse_enginefs_route(&format!("/{hex}/3/stats.json")),
            EnginefsRoute::FileStats { hash: hex.to_string(), idx: 3 }
        );
        assert_eq!(
            parse_enginefs_route(&format!("/{hex}/3/Show.mkv")),
            EnginefsRoute::FileStream {
                hash: hex.to_string(),
                idx: 3,
                filename: Some("Show.mkv".to_string())
            }
        );
        // Query no afecta a la ruta.
        assert_eq!(
            parse_enginefs_route(&format!("/{hex}/3?external=1&tr=x")),
            EnginefsRoute::FileStream { hash: hex.to_string(), idx: 3, filename: None }
        );
        // Hash inválido e índice inválido -> NotFound.
        assert_eq!(parse_enginefs_route("/zzz/3"), EnginefsRoute::NotFound);
        assert_eq!(parse_enginefs_route(&format!("/{hex}/abc")), EnginefsRoute::NotFound);
        assert_eq!(parse_enginefs_route(&format!("/{hex}/-1")), EnginefsRoute::NotFound);
    }

    #[test]
    fn range_parsing() {
        assert_eq!(parse_range_header("", Some(100)), RangeOutcome::Full);
        assert_eq!(
            parse_range_header("bytes=0-99", Some(100)),
            RangeOutcome::Single { start: 0, end: Some(99) }
        );
        assert_eq!(
            parse_range_header("bytes=50-", Some(100)),
            RangeOutcome::Single { start: 50, end: None }
        );
        assert_eq!(
            parse_range_header("bytes=-200", Some(1000)),
            RangeOutcome::Suffix { length: 200 }
        );
        assert_eq!(parse_range_header("bytes=-0", Some(100)), RangeOutcome::Unsatisfiable);
        assert_eq!(parse_range_header("bytes=100-", Some(100)), RangeOutcome::Unsatisfiable);
        assert_eq!(parse_range_header("bytes=200-300", Some(100)), RangeOutcome::Unsatisfiable);
        assert_eq!(parse_range_header("bytes=0-99", None), RangeOutcome::Single { start: 0, end: Some(99) });
        assert_eq!(parse_range_header("bytes=0-99,200-299", Some(1000)), RangeOutcome::Invalid);
        assert_eq!(parse_range_header("items=0-99", Some(100)), RangeOutcome::Invalid);
        assert_eq!(parse_range_header("bytes=99-0", Some(100)), RangeOutcome::Invalid);
        assert_eq!(parse_range_header("bytes=abc-", Some(100)), RangeOutcome::Invalid);
    }

    #[test]
    fn filename_safety() {
        assert!(is_safe_filename("Show.S01E03.mkv"));
        assert!(is_safe_filename("Show S01E03 (2024).mkv"));
        assert!(!is_safe_filename(""));
        assert!(!is_safe_filename(".."));
        assert!(!is_safe_filename("../secret"));
        assert!(!is_safe_filename("a/b.mkv"));
        assert!(!is_safe_filename("a\\b.mkv"));
        assert!(!is_safe_filename("C:evil.mkv"));
        assert!(!is_safe_filename("%2e%2e"));
        assert!(!is_safe_filename("a\0b.mkv"));
    }

    #[test]
    fn content_type_mapping() {
        assert_eq!(content_type_for_name("a.mkv"), "video/x-matroska");
        assert_eq!(content_type_for_name("a.MP4"), "video/mp4");
        assert_eq!(content_type_for_name("a.avi"), "video/x-msvideo");
        assert_eq!(content_type_for_name("a.webm"), "video/webm");
        assert_eq!(content_type_for_name("a.ts"), "video/mp2t");
        assert_eq!(content_type_for_name("a.bin"), "application/octet-stream");
    }

    #[test]
    fn engine_stats_shape() {
        let entry = test_entry();
        let native = serde_json::json!({
            "state": "live",
            "progress_bytes": 500,
            "live": { "download_speed": 1234 }
        });
        let stats = build_engine_stats("abc", &entry, &native, 0);
        assert_eq!(stats["infoHash"], "abc");
        assert_eq!(stats["torrentId"], "7");
        assert_eq!(stats["fileIdx"], 0);
        assert_eq!(stats["fileName"], "Show.S01E03.mkv");
        assert_eq!(stats["streamLen"], 1000);
        assert_eq!(stats["streamProgress"], 0.5);
        assert_eq!(stats["downloadSpeed"], 1234);
        assert_eq!(stats["uploadSpeed"], 1234);
        assert_eq!(stats["state"], "live");
        assert!(stats["wires"].is_null());
        assert_eq!(stats["guessedFileIdx"], 1);
    }

    #[test]
    fn registry_dedup_keeps_first() {
        let registry = EnginefsRegistry::new();
        let first = test_entry();
        let mut second = test_entry();
        second.native_torrent_id = "99".to_string();
        let (entry, is_new) = registry.register_or_get("abc", first);
        assert!(is_new);
        assert_eq!(entry.native_torrent_id, "7");
        let (entry, is_new) = registry.register_or_get("abc", second);
        assert!(!is_new);
        assert_eq!(entry.native_torrent_id, "7");
        assert!(registry.update_selected_file("abc", 0));
        assert_eq!(registry.lookup("abc").unwrap().selected_file, 0);
        assert!(!registry.update_selected_file("missing", 0));
        assert!(registry.remove("abc").is_some());
        assert!(registry.lookup("abc").is_none());
        registry.register_or_get("x", test_entry());
        assert_eq!(registry.len(), 1);
        registry.clear();
        assert_eq!(registry.len(), 0);
    }
}
