//! Cache de posters en disco, servido por un proxy loopback propio.
//!
//! Por que no se resuelve dentro de SpatialPosters: upstream guarda los
//! posters en un `Map` en memoria porque su destino es Vercel, donde el disco
//! es de solo lectura. Toda su capa de almacenamiento esta escrita con `fetch`
//! (R2, Cloudinary, ImgBB) y evita `node:fs` a proposito. Parchear `cache.ts`
//! para tocar disco no compila: Turbopack y webpack rechazan cualquier modulo
//! de Node en ese modulo ("chunking context does not support external
//! modules"). Verificado, no es teoria.
//!
//! Asi que el cache vive aca, en Aetherio, que es donde corresponde: el server
//! externo queda como un renderer tonto y nosotros guardamos lo que devuelve.
//!
//! Flujo:
//!   Aetherio -> este proxy -> disco
//!                      \-> miss -> SpatialPosters -> se guarda y se responde
//!
//! SpatialPosters queda intacto: ni fork, ni parche, ni un `git pull` que rompa.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tiny_http::{Header, Response, Server, StatusCode};

/// Puerto donde escucha SpatialPosters (ver poster_server.rs).
const UPSTREAM_PORT: u16 = 3000;

/// Peticiones al upstream simultaneas. Un arranque en frio pide ~260 posters y
/// cada render puede tardar segundos: sin esto el proxy atenderia de a uno y la
/// primera tanda tardaria minutos.
const MAX_CONCURRENT_FETCHES: usize = 8;

/// Tope de disco. Los posters rondan los 30-60 KB, asi que esto da del orden de
/// 3.000 titulos.
const CACHE_MAX_BYTES: u64 = 256 * 1024 * 1024;

/// Un poster no cambia: 30 dias es Practico y no obliga a re-render nunca.
const CACHE_TTL: Duration = Duration::from_secs(30 * 24 * 3600);

/// Puerto efectivo del proxy, para que el frontend arme las URLs.
static CACHE_PORT: AtomicUsize = AtomicUsize::new(0);

pub fn port() -> u16 {
    CACHE_PORT.load(Ordering::Relaxed) as u16
}

pub fn base_url() -> Option<String> {
    let port = port();
    (port > 0).then(|| format!("http://127.0.0.1:{port}"))
}

/// Arranca el proxy de cache. Devuelve el puerto.
///
/// Idempotente en la practica: si ya hay uno corriendo se devuelve su puerto.
pub fn start(cache_dir: PathBuf) -> Result<u16, String> {
    let existing = port();
    if existing > 0 {
        return Ok(existing);
    }

    let _ = std::fs::create_dir_all(&cache_dir);

    let server = Server::http("127.0.0.1:0")
        .map_err(|error| format!("No se pudo iniciar el cache de posters: {error}"))?;
    let bound = server
        .server_addr()
        .to_ip()
        .map(|address| address.port())
        .ok_or_else(|| String::from("El cache de posters no obtuvo un puerto TCP."))?;

    CACHE_PORT.store(bound as usize, Ordering::Relaxed);

    let in_flight = Arc::new(AtomicUsize::new(0));
    let dir = Arc::new(cache_dir);

    std::thread::spawn(move || {
        let client = match reqwest::blocking::Client::builder()
            // El primer render en frio puede tardar 5 s o mas; 30 s es holgado
            // para que un poster lento no provoque un fallback en el cliente.
            .timeout(Duration::from_secs(30))
            .user_agent("Aetherio-PosterCache/1.0")
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };

        for request in server.incoming_requests() {
            let Some((media_type, id, query)) = parse_poster_path(request.url()) else {
                let _ = request.respond(
                    Response::from_string("poster not found").with_status_code(StatusCode(404)),
                );
                continue;
            };

            // Un acierto en disco no necesita salir a la red, asi que se resuelve
            // en el hilo del listener. Solo los misses consumen un permiso.
            if let Some(hit) = read_cached(&dir, &media_type, &id, &query) {
                let _ = request.respond(with_cors(hit));
                continue;
            }

            let client = client.clone();
            let dir = Arc::clone(&dir);
            let in_flight = Arc::clone(&in_flight);

            // Hilo por peticion para que un render lento no bloquee al resto.
            // El permiso si es global, para no saturar SpatialPosters.
            std::thread::spawn(move || {
                while in_flight.load(Ordering::Acquire) >= MAX_CONCURRENT_FETCHES {
                    std::thread::sleep(Duration::from_millis(20));
                }
                in_flight.fetch_add(1, Ordering::AcqRel);
                let result = fetch_and_store(&client, &dir, &media_type, &id, &query);
                in_flight.fetch_sub(1, Ordering::AcqRel);
                let _ = request.respond(with_cors(result));
            });
        }
    });

    Ok(bound)
}

/// Valida `/poster/{movie|tv}/{id}?{query}`. Devolver `None` en vez de un 400:
/// si la ruta no es nuestra, se responde 404 y el frontend cae a TMDB.
fn parse_poster_path(url: &str) -> Option<(String, String, String)> {
    let (path, query) = match url.split_once('?') {
        Some((path, query)) => (path, query),
        None => (url, ""),
    };
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    if parts.len() != 3 || parts[0] != "poster" {
        return None;
    }
    let media_type = parts[1];
    if media_type != "movie" && media_type != "tv" {
        return None;
    }
    let id = parts[2];
    if id.is_empty() || id.len() > 12 || !id.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    // Un query gigante seria un intento de llenar el disco con una clave sola.
    if query.len() > 1024 {
        return None;
    }
    Some((media_type.to_string(), id.to_string(), query.to_string()))
}

fn cache_key(media_type: &str, id: &str, query: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(media_type.as_bytes());
    hasher.update(b"/");
    hasher.update(id.as_bytes());
    hasher.update(b"?");
    hasher.update(query.as_bytes());
    hex::encode(hasher.finalize())
}

fn cache_file(dir: &PathBuf, key: &str) -> PathBuf {
    dir.join(format!("{key}.poster"))
}

/// Formato: [4 bytes BE = largo del content-type][content-type][bytes del poster].
///
/// El content-type va dentro del archivo para no llevar un sidecar por poster.
fn encode(content_type: &str, body: &[u8]) -> Vec<u8> {
    let mut header = Vec::with_capacity(4 + content_type.len() + body.len());
    header.extend_from_slice(&(content_type.len() as u32).to_be_bytes());
    header.extend_from_slice(content_type.as_bytes());
    header.extend_from_slice(body);
    header
}

fn read_cached(
    dir: &PathBuf,
    media_type: &str,
    id: &str,
    query: &str,
) -> Option<Reply> {
    let key = cache_key(media_type, id, query);
    let file = cache_file(dir, &key);
    let metadata = std::fs::metadata(&file).ok()?;
    if metadata.len() < 4 {
        return None;
    }
    if metadata
        .modified()
        .ok()
        .and_then(|when| when.elapsed().ok())
        .map(|age| age > CACHE_TTL)
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(&file);
        return None;
    }
    let raw = std::fs::read(&file).ok()?;
    let length = u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize;
    if raw.len() < 4 + length {
        return None;
    }
    let content_type = String::from_utf8(raw[4..4 + length].to_vec()).ok()?;
    Some((raw[4 + length..].to_vec(), content_type, 200))
}

/// Lo que se responde: cuerpo, content-type y status.
///
/// El status viaja porque el frontend decide con el: un 200 con un texto de
/// error adentro seria un poster roto disfrazado de exito.
type Reply = (Vec<u8>, String, u16);

fn fetch_and_store(
    client: &reqwest::blocking::Client,
    dir: &PathBuf,
    media_type: &str,
    id: &str,
    query: &str,
) -> Reply {
    let mut url = format!("http://127.0.0.1:{UPSTREAM_PORT}/api/poster/{media_type}/{id}");
    if !query.is_empty() {
        url.push('?');
        url.push_str(query);
    }

    let response = match client.get(&url).send() {
        Ok(response) => response,
        Err(_) => {
            return (
                b"El servidor de posters no respondio.".to_vec(),
                "text/plain; charset=utf-8".to_string(),
                502,
            )
        }
    };

    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    // Los errores hacia arriba se propagan tal cual: el frontend los usa para
    // caer al poster de TMDB. Cachear un 404 como si fuera un poster dejaria la
    // pantalla en negro para siempre.
    if !status.is_success() {
        return (format!("upstream {status}").into_bytes(), content_type, status.as_u16());
    }

    let body = match response.bytes() {
        Ok(bytes) => bytes.to_vec(),
        Err(_) => {
            return (
                b"fallo la lectura".to_vec(),
                "text/plain; charset=utf-8".to_string(),
                502,
            )
        }
    };

    store(dir, media_type, id, query, &content_type, &body);
    (body, content_type, 200)
}

fn store(
    dir: &PathBuf,
    media_type: &str,
    id: &str,
    query: &str,
    content_type: &str,
    body: &[u8],
) {
    let key = cache_key(media_type, id, query);
    let file = cache_file(dir, &key);
    // No damos por sentado que la carpeta exista: `start` la crea, pero si
    // alguien borra la cache con la app corriendo, seguir escribiendo en
    // silencio es peor que volver a crearla.
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    make_space(dir, body.len() as u64);
    let _ = std::fs::write(&file, encode(content_type, body));
}

/// Evicta lo mas antiguo hasta bajar del 90% del tope.
fn make_space(dir: &PathBuf, incoming: u64) {
    let total = || -> u64 {
        std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|entry| entry.metadata().ok())
                    .filter(|meta| meta.is_file())
                    .map(|meta| meta.len())
                    .sum()
            })
            .unwrap_or(0)
    };

    if total() + incoming <= CACHE_MAX_BYTES {
        return;
    }

    let mut files: Vec<(PathBuf, std::time::SystemTime, u64)> = match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .flatten()
            .filter_map(|entry| {
                let meta = entry.metadata().ok()?;
                if !meta.is_file() {
                    return None;
                }
                Some((entry.path(), meta.modified().ok()?, meta.len()))
            })
            .collect(),
        Err(_) => return,
    };
    files.sort_by_key(|(_, modified, _)| *modified);

    let mut used = total() + incoming;
    for (path, _, size) in files {
        if used <= CACHE_MAX_BYTES * 9 / 10 {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            used = used.saturating_sub(size);
        }
    }
}

fn with_cors((body, content_type, status): Reply) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_data(body)
        .with_status_code(StatusCode(status))
        .with_header(
            Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap_or_else(|_| {
                Header::from_bytes(&b"Content-Type"[..], &b"application/octet-stream"[..]).unwrap()
            }),
        );
    // El WebView pide las imagenes a otro origen (tauri://localhost), asi que
    // sin esto el navegador las bloquea aunque el poster exista.
    response = response.with_header(
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
    );
    // Un error no se cachea en el navegador: si SpatialPosters se levanta un
    // segundo despues, el poster tiene que volver a pedirse.
    if status == 200 {
        response = response.with_header(
            Header::from_bytes(&b"Cache-Control"[..], &b"public, max-age=2592000, immutable"[..])
                .unwrap(),
        );
    } else {
        response = response.with_header(
            Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap(),
        );
    }
    response
}

/// URL base del cache, o null si todavia no arranco.
///
/// El frontend la consulta al montar: el puerto es efimero, asi que no puede
/// estar escrito en los ajustes.
#[tauri::command]
pub fn poster_cache_url() -> Option<String> {
    base_url()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acepta_las_dos_rutas_de_poster() {
        assert_eq!(
            parse_poster_path("/poster/movie/155?region=MX&lang=es"),
            Some(("movie".into(), "155".into(), "region=MX&lang=es".into()))
        );
        assert_eq!(
            parse_poster_path("/poster/tv/1399"),
            Some(("tv".into(), "1399".into(), String::new()))
        );
    }

    #[test]
    fn rechaza_ruinas_que_no_son_de_poster() {
        for url in [
            "/api/health",
            "/poster/movie",
            "/poster/anime/155",
            "/poster/movie/abc",
            "/poster/movie/155/extra",
            "/youtube/abc/video",
        ] {
            assert_eq!(parse_poster_path(url), None, "{url} deberia rechazarse");
        }
    }

    #[test]
    fn rechaza_un_query_absurdo() {
        let enorme = "a".repeat(2000);
        assert_eq!(parse_poster_path(&format!("/poster/movie/155?{enorme}")), None);
    }

    #[test]
    fn la_clave_distingue_tipo_id_y_query() {
        let a = cache_key("movie", "155", "region=MX");
        let b = cache_key("tv", "155", "region=MX");
        let c = cache_key("movie", "155", "region=US");
        assert_ne!(a, b, "movie y tv no pueden compartir clave");
        assert_ne!(a, c, "la region cambia el poster, debe cambiar la clave");
        assert_eq!(a, cache_key("movie", "155", "region=MX"), "es estable");
    }

    #[test]
    fn un_error_de_upstream_no_pasa_como_200() {
        // El frontend decide con el status: un 200 con un texto de error
        // adentro seria un poster roto disfrazado de exito.
        let dir = std::env::temp_dir().join("aetherio-poster-cache-status");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);

        // Sin SpatialPosters levantado, un miss tiene que ser 502, no 200.
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(800))
            .build()
            .expect("cliente");
        let (_, _, status) = fetch_and_store(
            &client,
            &dir,
            "movie",
            "999999999",
            "region=MX&lang=es",
        );
        assert_eq!(status, 502, "sin upstream tiene que ser 502");

        // Y el error no se guarda: si despues levanta el server, el poster
        // tiene que poder volver a pedirse.
        let stored = read_cached(&dir, "movie", "999999999", "region=MX&lang=es");
        assert!(stored.is_none(), "un error nunca se cachea");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ida_y_vuelta_de_un_poster_en_disco() {
        let dir = std::env::temp_dir().join("aetherio-poster-cache-test");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dir);

        let body = b"\xFF\xD8\xFF un poster cualquiera".to_vec();
        store(&dir, "movie", "155", "region=MX", "image/jpeg", &body);

        let hit = read_cached(&dir, "movie", "155", "region=MX").expect("deberia haber hit");
        assert_eq!(hit.0, body, "los bytes vuelven intactos");
        assert_eq!(hit.1, "image/jpeg", "el content-type vuelve intacto");

        // Un query distinto es otro poster: no debe tocar el mismo archivo.
        assert!(read_cached(&dir, "movie", "155", "region=US").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
