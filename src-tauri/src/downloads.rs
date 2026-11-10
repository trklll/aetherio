use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    net::IpAddr,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use aes::Aes128;
use reqwest::{
    blocking::{Client, Response},
    header::{HeaderName, HeaderValue, CONTENT_TYPE, LOCATION},
    redirect::Policy,
    Url,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const EVENT_NAME: &str = "download-progress";
pub(crate) const MAX_REDIRECTS: usize = 5;
const MAX_PLAYLIST_BYTES: usize = 16 * 1024 * 1024;
const MAX_SEGMENT_BYTES: usize = 512 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(350);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

type Aes128CbcDecryptor = cbc::Decryptor<Aes128>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub title: String,
    pub media_type: Option<String>,
    pub media_id: Option<String>,
    pub episode_title: Option<String>,
    pub episode_still: Option<String>,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub status: String,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub segments_downloaded: Option<usize>,
    pub total_segments: Option<usize>,
    pub file_path: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub retry_available: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub target: String,
    pub file_idx: Option<usize>,
    pub headers: Option<HashMap<String, String>>,
    pub title: String,
    pub media_type: Option<String>,
    pub media_id: Option<String>,
    pub episode_title: Option<String>,
    pub episode_still: Option<String>,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub live: Option<bool>,
}

#[derive(Default)]
pub struct DownloadState {
    inner: Mutex<DownloadInner>,
    available: Condvar,
}

#[derive(Default)]
struct DownloadInner {
    loaded: bool,
    active: bool,
    records: HashMap<String, DownloadRecord>,
    cancel: HashMap<String, Arc<AtomicBool>>,
    retry_requests: HashMap<String, DownloadRequest>,
}

#[derive(Debug)]
struct HlsKey {
    url: Url,
    iv: Option<[u8; 16]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HlsMap {
    url: Url,
    byte_range: Option<(u64, u64)>,
}

#[derive(Debug)]
struct HlsSegment {
    url: Url,
    byte_range: Option<(u64, u64)>,
    sequence: u64,
    key: Option<HlsKey>,
    map: Option<HlsMap>,
}

#[derive(Debug)]
struct HlsPlaylist {
    segments: Vec<HlsSegment>,
}

#[tauri::command]
pub fn download_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
) -> Result<Vec<DownloadRecord>, String> {
    let root = download_root(&app)?;
    let mut inner = lock_inner(&state);
    load_manifest(&root, &mut inner)?;
    let mut records = inner.records.values().cloned().collect::<Vec<_>>();
    records.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(records)
}

#[tauri::command]
pub fn download_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
    request: DownloadRequest,
) -> Result<DownloadRecord, String> {
    validate_download_request(&request)?;
    let root = download_root(&app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("No se pudo crear la carpeta de descargas: {error}"))?;

    let now = now_ms();
    let id = format!("dl-{now}-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let record = DownloadRecord {
        id: id.clone(),
        title: normalize_title(&request.title),
        media_type: request.media_type.clone(),
        media_id: request.media_id.clone(),
        episode_title: request.episode_title.clone(),
        episode_still: request.episode_still.clone(),
        poster: request.poster.clone(),
        background: request.background.clone(),
        status: String::from("queued"),
        bytes_downloaded: 0,
        total_bytes: None,
        segments_downloaded: None,
        total_segments: None,
        file_path: None,
        error: None,
        retry_available: true,
        created_at: now,
        updated_at: now,
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut inner = lock_inner(&state);
        load_manifest(&root, &mut inner)?;
        inner.records.insert(id.clone(), record.clone());
        inner.cancel.insert(id.clone(), cancel.clone());
        inner.retry_requests.insert(id.clone(), request.clone());
        if let Err(error) = persist_retry_requests(&root, &inner.retry_requests) {
            inner.records.remove(&id);
            inner.cancel.remove(&id);
            inner.retry_requests.remove(&id);
            return Err(error);
        }
        persist_manifest(&root, &inner.records)?;
    }

    let worker_app = app.clone();
    let worker_record = record.clone();
    thread::spawn(move || run_download(worker_app, root, worker_record, request, cancel));
    Ok(record)
}

#[tauri::command]
pub fn download_retry(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
    id: String,
) -> Result<DownloadRecord, String> {
    let root = download_root(&app)?;
    let mut inner = lock_inner(&state);
    load_manifest(&root, &mut inner)?;
    let mut record = inner
        .records
        .get(&id)
        .cloned()
        .ok_or_else(|| String::from("No se encontró la descarga."))?;
    if record.status != "failed" && record.status != "interrupted" {
        return Err(String::from("Solo se pueden reintentar descargas fallidas o interrumpidas."));
    }
    let request = inner
        .retry_requests
        .get(&id)
        .cloned()
        .ok_or_else(|| String::from("No se puede reintentar esta descarga porque no conserva su fuente."))?;
    validate_download_request(&request)?;

    let now = now_ms();
    record.status = String::from("queued");
    record.bytes_downloaded = 0;
    record.total_bytes = None;
    record.segments_downloaded = None;
    record.total_segments = None;
    record.file_path = None;
    record.error = None;
    record.updated_at = now;
    record.retry_available = true;
    let cancel = Arc::new(AtomicBool::new(false));
    inner.records.insert(id.clone(), record.clone());
    inner.cancel.insert(id.clone(), cancel.clone());
    persist_manifest(&root, &inner.records)?;

    let worker_app = app.clone();
    let worker_record = record.clone();
    thread::spawn(move || run_download(worker_app, root, worker_record, request, cancel));
    Ok(record)
}

fn validate_download_request(request: &DownloadRequest) -> Result<(), String> {
    if request.live.unwrap_or(false) {
        return Err(String::from("Los canales en directo no se pueden descargar."));
    }
    if super::is_p2p_target(request.target.trim()) {
        if request.target.len() > 8 * 1024 {
            return Err(String::from("La fuente torrent excede el tamaño permitido."));
        }
    } else {
        let target = Url::parse(request.target.trim())
            .map_err(|_| String::from("La fuente no tiene un enlace HTTP descargable."))?;
        if target.scheme() != "http" && target.scheme() != "https" {
            return Err(String::from("Solo se pueden descargar fuentes HTTP o HTTPS."));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn download_cancel(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
    id: String,
) -> Result<(), String> {
    let root = download_root(&app)?;
    let mut inner = lock_inner(&state);
    load_manifest(&root, &mut inner)?;
    let record = inner
        .records
        .get(&id)
        .ok_or_else(|| String::from("No se encontró la descarga."))?;
    if record.status == "completed" || record.status == "failed" || record.status == "cancelled" {
        return Ok(());
    }
    if let Some(cancel) = inner.cancel.get(&id) {
        cancel.store(true, Ordering::Release);
    }
    set_record_status(&mut inner, &id, "cancelled", None);
    persist_manifest(&root, &inner.records)?;
    app.emit(EVENT_NAME, inner.records.get(&id).cloned())
        .map_err(|error| error.to_string())?;
    drop(inner);
    state.available.notify_all();
    Ok(())
}

#[tauri::command]
pub fn download_delete(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
    id: String,
) -> Result<(), String> {
    let root = download_root(&app)?;
    let mut inner = lock_inner(&state);
    load_manifest(&root, &mut inner)?;
    if let Some(cancel) = inner.cancel.get(&id) {
        cancel.store(true, Ordering::Release);
    }
    let record = inner
        .records
        .get(&id)
        .cloned()
        .ok_or_else(|| String::from("No se encontró la descarga."))?;
    let item_dir = root.join(&id);
    if item_dir.exists() {
        fs::remove_dir_all(&item_dir)
            .map_err(|error| format!("No se pudo borrar el archivo: {error}"))?;
    }
    inner.records.remove(&id);
    inner.cancel.remove(&id);
    inner.retry_requests.remove(&id);
    persist_manifest(&root, &inner.records)?;
    persist_retry_requests(&root, &inner.retry_requests)?;
    let _ = app.emit(
        EVENT_NAME,
        serde_json::json!({ "id": record.id, "deleted": true }),
    );
    Ok(())
}

#[tauri::command]
pub fn download_open_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
    id: String,
) -> Result<(), String> {
    let root = download_root(&app)?;
    let mut inner = lock_inner(&state);
    load_manifest(&root, &mut inner)?;
    let record = inner
        .records
        .get(&id)
        .ok_or_else(|| String::from("No se encontró la descarga."))?;
    let Some(file_path) = record.file_path.as_deref() else {
        return Err(String::from(
            "La descarga todavía no tiene un archivo completo.",
        ));
    };
    let path = PathBuf::from(file_path);
    if !path.starts_with(&root) || !path.exists() {
        return Err(String::from("No se encontró el archivo descargado."));
    }
    let directory = path.parent().unwrap_or(&root);
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(directory).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(directory).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(directory).spawn();
    result
        .map(|_| ())
        .map_err(|error| format!("No se pudo abrir la carpeta: {error}"))
}

fn run_download(
    app: tauri::AppHandle,
    root: PathBuf,
    mut record: DownloadRecord,
    request: DownloadRequest,
    cancel: Arc<AtomicBool>,
) {
    let manager = app.state::<DownloadState>();
    {
        let mut inner = lock_inner(&manager);
        while inner.active && !cancel.load(Ordering::Acquire) {
            let waited = manager
                .available
                .wait_timeout(inner, Duration::from_millis(250));
            inner = match waited {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }
        if cancel.load(Ordering::Acquire) {
            set_record_status(&mut inner, &record.id, "cancelled", None);
            let _ = persist_manifest(&root, &inner.records);
            if let Some(item) = inner.records.get(&record.id) {
                let _ = app.emit(EVENT_NAME, item);
            }
            return;
        }
        inner.active = true;
        set_record_status(&mut inner, &record.id, "downloading", None);
        if let Some(updated) = inner.records.get(&record.id) {
            record = updated.clone();
        }
        let _ = persist_manifest(&root, &inner.records);
    }
    emit_record(&app, &root, &manager, &record.id);

    let item_dir = root.join(&record.id);
    let part_path = item_dir.join("media.part");
    let mut active_p2p: Option<super::P2pPlaybackInfo> = None;
    let result = (|| {
        fs::create_dir_all(&item_dir)
            .map_err(|error| format!("No se pudo crear la carpeta de la descarga: {error}"))?;
        let target_text = request.target.trim();
        let is_youtube = is_youtube_download_target(target_text);
        let extension = if is_youtube {
            download_youtube(
                &app,
                &root,
                &manager,
                &record.id,
                target_text,
                &item_dir,
                &part_path,
                &cancel,
            )?
        } else {
            let client = Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(60 * 60))
                .redirect(Policy::none())
                .build()
                .map_err(|error| format!("No se pudo crear el cliente HTTP: {error}"))?;
            let is_p2p = super::is_p2p_target(target_text);
            let (target, credential_host, mut response, torrent_extension) = if is_p2p {
                let p2p_state = app.state::<super::P2pState>();
                let resolved = super::resolve_p2p_playback_target(
                    &app,
                    &p2p_state,
                    target_text,
                    request.file_idx,
                    None,
                )?
                .ok_or_else(|| String::from("No se pudo resolver la fuente torrent."))?;
                let p2p = resolved.p2p.ok_or_else(|| {
                    String::from("El motor P2P no devolvió el archivo seleccionado.")
                })?;
                let extension = torrent_file_extension(&p2p.details, p2p.file_idx);
                active_p2p = Some(p2p);
                if cancel.load(Ordering::Acquire) {
                    return Err(String::from("__cancelled__"));
                }
                let target = Url::parse(&resolved.target)
                    .map_err(|_| String::from("El motor P2P devolvió una URL inválida."))?;
                if !is_loopback_url(&target) {
                    return Err(String::from(
                        "El motor P2P devolvió una URL fuera del dispositivo.",
                    ));
                }
                let response = client
                    .get(target.clone())
                    .send()
                    .map_err(|error| format!("No se pudo leer el archivo torrent: {error}"))?;
                if !response.status().is_success() {
                    return Err(format!(
                        "El motor P2P respondió HTTP {}.",
                        response.status().as_u16()
                    ));
                }
                (target, String::new(), response, extension)
            } else {
                let target = Url::parse(target_text)
                    .map_err(|_| String::from("Enlace de origen inválido."))?;
                let credential_host = target.host_str().unwrap_or_default().to_ascii_lowercase();
                let response = send_get(
                    &client,
                    target.clone(),
                    &credential_host,
                    request.headers.as_ref(),
                    &cancel,
                )?;
                (target, credential_host, response, None)
            };
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_ascii_lowercase();
            let is_hls = !is_p2p
                && (target.path().to_ascii_lowercase().ends_with(".m3u8")
                    || content_type.contains("mpegurl")
                    || content_type.contains("vnd.apple.mpegurl"));
            let is_dash = !is_p2p
                && (target.path().to_ascii_lowercase().ends_with(".mpd")
                    || content_type.contains("application/dash+xml"));
            if !is_hls && !is_dash && is_rejected_media_type(&content_type) {
                return Err(String::from(
                    "La fuente respondió una página o datos, no un archivo de video descargable.",
                ));
            }
            if is_hls {
                let playlist_url = response.url().clone();
                let text = read_limited(&mut response, MAX_PLAYLIST_BYTES)?;
                if download_hls(
                    &app,
                    &root,
                    &manager,
                    &record.id,
                    &client,
                    &playlist_url,
                    &credential_host,
                    request.headers.as_ref(),
                    &text,
                    &part_path,
                    &cancel,
                )? {
                    ".mp4"
                } else {
                    ".ts"
                }
            } else if is_dash {
                let manifest_url = response.url().clone();
                let text = read_limited(&mut response, MAX_PLAYLIST_BYTES)?;
                super::downloads_dash::download_dash(
                    &client,
                    &manifest_url,
                    &credential_host,
                    request.headers.as_ref(),
                    std::str::from_utf8(&text)
                        .map_err(|_| String::from("El manifiesto DASH no es UTF-8 válido."))?,
                    &item_dir,
                    &part_path,
                    &cancel,
                    |downloaded, completed, total| {
                        update_progress(
                            &app,
                            &root,
                            &manager,
                            &record.id,
                            downloaded,
                            None,
                            Some(completed),
                            Some(total),
                        );
                    },
                )?;
                ".mpd"
            } else {
                let total = response.content_length();
                set_total(&app, &root, &manager, &record.id, total);
                let mut output = File::create(&part_path)
                    .map_err(|error| format!("No se pudo crear el archivo: {error}"))?;
                let mut downloaded = 0u64;
                let mut last_progress = Instant::now();
                let mut chunk = [0u8; 128 * 1024];
                loop {
                    if cancel.load(Ordering::Acquire) {
                        return Err(String::from("__cancelled__"));
                    }
                    let count = response
                        .read(&mut chunk)
                        .map_err(|error| format!("Fallo al leer el stream: {error}"))?;
                    if count == 0 {
                        break;
                    }
                    output
                        .write_all(&chunk[..count])
                        .map_err(|error| format!("No se pudo guardar el stream: {error}"))?;
                    downloaded = downloaded.saturating_add(count as u64);
                    if last_progress.elapsed() >= PROGRESS_INTERVAL {
                        update_progress(
                            &app, &root, &manager, &record.id, downloaded, total, None, None,
                        );
                        last_progress = Instant::now();
                    }
                }
                output
                    .flush()
                    .map_err(|error| format!("No se pudo finalizar el archivo: {error}"))?;
                update_progress(
                    &app, &root, &manager, &record.id, downloaded, total, None, None,
                );
                torrent_extension.unwrap_or_else(|| extension_for_response(&target, &content_type))
            }
        };
        if cancel.load(Ordering::Acquire) {
            return Err(String::from("__cancelled__"));
        }
        let final_path = item_dir.join(safe_filename(&record.title, extension));
        fs::rename(&part_path, &final_path)
            .map_err(|error| format!("No se pudo finalizar la descarga: {error}"))?;
        Ok(final_path)
    })();

    if result
        .as_ref()
        .err()
        .is_some_and(|error| error == "__cancelled__")
        || cancel.load(Ordering::Acquire)
    {
        let _ = fs::remove_file(&part_path);
        let _ = fs::remove_dir_all(item_dir.join("dash"));
        remove_partial_youtube_files(&item_dir);
        finish_job(&app, &root, &manager, &record.id, "cancelled", None, None);
    } else {
        match result {
            Ok(path) => finish_job(
                &app,
                &root,
                &manager,
                &record.id,
                "completed",
                Some(path.to_string_lossy().into_owned()),
                None,
            ),
            Err(error) => {
                let _ = fs::remove_file(&part_path);
                let _ = fs::remove_dir_all(item_dir.join("dash"));
                remove_partial_youtube_files(&item_dir);
                finish_job(
                    &app,
                    &root,
                    &manager,
                    &record.id,
                    "failed",
                    None,
                    Some(error),
                );
            }
        }
    }
    if let Some(p2p) = active_p2p {
        super::cleanup_p2p_torrent(p2p);
    }
    {
        let mut inner = lock_inner(&manager);
        inner.active = false;
        inner.cancel.remove(&record.id);
    }
    manager.available.notify_one();
}

fn download_hls(
    app: &tauri::AppHandle,
    root: &Path,
    state: &DownloadState,
    id: &str,
    client: &Client,
    playlist_url: &Url,
    credential_host: &str,
    headers: Option<&HashMap<String, String>>,
    initial_text: &[u8],
    part_path: &Path,
    cancel: &AtomicBool,
) -> Result<bool, String> {
    let mut current_url = playlist_url.clone();
    let mut playlist_bytes = initial_text.to_vec();
    for _ in 0..2 {
        let text = std::str::from_utf8(&playlist_bytes)
            .map_err(|_| String::from("La lista HLS no es texto UTF-8 válido."))?;
        if let Some(variant) = select_variant(text, &current_url)? {
            if cancel.load(Ordering::Acquire) {
                return Err(String::from("__cancelled__"));
            }
            current_url = variant;
            let mut response = send_get(
                client,
                current_url.clone(),
                credential_host,
                headers,
                cancel,
            )?;
            playlist_bytes = read_limited(&mut response, MAX_PLAYLIST_BYTES)?;
            current_url = response.url().clone();
            continue;
        }
        break;
    }
    let text = std::str::from_utf8(&playlist_bytes)
        .map_err(|_| String::from("La lista HLS no es texto UTF-8 válido."))?;
    let playlist = parse_media_playlist(text, &current_url)?;
    let is_fmp4 = playlist
        .segments
        .iter()
        .any(|segment| segment.map.is_some());
    let mut output = File::create(part_path)
        .map_err(|error| format!("No se pudo crear el archivo HLS: {error}"))?;
    update_progress(
        app,
        root,
        state,
        id,
        0,
        None,
        Some(0),
        Some(playlist.segments.len()),
    );
    let mut downloaded = 0u64;
    let mut first_segment = true;
    let mut written_map: Option<HlsMap> = None;

    for (index, segment) in playlist.segments.iter().enumerate() {
        if cancel.load(Ordering::Acquire) {
            return Err(String::from("__cancelled__"));
        }
        if segment.map != written_map {
            if let Some(map) = &segment.map {
                let map_bytes = read_hls_resource(
                    client,
                    &map.url,
                    map.byte_range,
                    credential_host,
                    headers,
                    cancel,
                    MAX_PLAYLIST_BYTES,
                )?;
                if !looks_like_fmp4_init(&map_bytes) {
                    return Err(String::from(
                        "El segmento de inicialización HLS no es un contenedor fMP4 válido.",
                    ));
                }
                output.write_all(&map_bytes).map_err(|error| {
                    format!("No se pudo guardar la inicialización HLS: {error}")
                })?;
                downloaded = downloaded.saturating_add(map_bytes.len() as u64);
            }
            written_map = segment.map.clone();
        }
        let encrypted_or_raw = read_hls_resource(
            client,
            &segment.url,
            segment.byte_range,
            credential_host,
            headers,
            cancel,
            MAX_SEGMENT_BYTES,
        )?;
        let bytes = if let Some(key) = &segment.key {
            let mut key_response =
                send_get(client, key.url.clone(), credential_host, headers, cancel)?;
            let key_bytes = read_limited(&mut key_response, 64)?;
            if key_bytes.len() != 16 {
                return Err(String::from("La clave HLS AES-128 no tiene 16 bytes."));
            }
            let iv = key.iv.unwrap_or_else(|| sequence_iv(segment.sequence));
            decrypt_hls_segment(&encrypted_or_raw, &key_bytes, &iv)?
        } else {
            encrypted_or_raw
        };
        if first_segment {
            let valid = if is_fmp4 {
                looks_like_fmp4_fragment(&bytes)
            } else {
                looks_like_mpeg_ts(&bytes)
            };
            if !valid {
                return Err(String::from(
                    "El primer segmento HLS no coincide con su contenedor MPEG-TS o fMP4.",
                ));
            }
            first_segment = false;
        }
        output
            .write_all(&bytes)
            .map_err(|error| format!("No se pudo guardar un segmento HLS: {error}"))?;
        downloaded = downloaded.saturating_add(bytes.len() as u64);
        update_progress(
            app,
            root,
            state,
            id,
            downloaded,
            None,
            Some(index + 1),
            Some(playlist.segments.len()),
        );
    }
    output
        .flush()
        .map_err(|error| format!("No se pudo finalizar el archivo HLS: {error}"))?;
    Ok(is_fmp4)
}

fn read_hls_resource(
    client: &Client,
    url: &Url,
    byte_range: Option<(u64, u64)>,
    credential_host: &str,
    headers: Option<&HashMap<String, String>>,
    cancel: &AtomicBool,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let expected_bytes = byte_range.map(|(start, end)| end.saturating_sub(start).saturating_add(1));
    if expected_bytes.is_some_and(|length| length > max_bytes as u64) {
        return Err(String::from(
            "El rango HLS supera el tamaño máximo permitido.",
        ));
    }
    let mut response = match byte_range {
        Some(range) => {
            send_get_range(client, url.clone(), credential_host, headers, cancel, range)?
        }
        None => send_get(client, url.clone(), credential_host, headers, cancel)?,
    };
    let limit = expected_bytes.map_or(max_bytes, |length| length as usize);
    let bytes = read_limited(&mut response, limit)?;
    if expected_bytes.is_some_and(|expected| bytes.len() as u64 != expected) {
        return Err(String::from(
            "El servidor no devolvió la cantidad solicitada de bytes HLS.",
        ));
    }
    Ok(bytes)
}

pub(crate) fn send_get(
    client: &Client,
    mut url: Url,
    credential_host: &str,
    headers: Option<&HashMap<String, String>>,
    cancel: &AtomicBool,
) -> Result<Response, String> {
    for redirect_count in 0..=MAX_REDIRECTS {
        if cancel.load(Ordering::Acquire) {
            return Err(String::from("__cancelled__"));
        }
        if url.host_str().is_some_and(is_youtube_page_host) {
            return Err(String::from(
                "YouTube no permite descarga directa desde esta fuente.",
            ));
        }
        if !super::is_public_http_url(&url) {
            return Err(String::from(
                "La URL de descarga no es pública o usa un protocolo no permitido.",
            ));
        }
        let mut builder = client.get(url.clone()).header("User-Agent", "Aetherio/1.0");
        if url
            .host_str()
            .unwrap_or_default()
            .eq_ignore_ascii_case(credential_host)
        {
            for (name, value) in headers.unwrap_or(&HashMap::new()) {
                let Ok(name) = HeaderName::from_bytes(name.trim().as_bytes()) else {
                    continue;
                };
                let Ok(value) = HeaderValue::from_str(value) else {
                    continue;
                };
                if name == "host" || name == "range" || name == "content-length" {
                    continue;
                }
                builder = builder.header(name, value);
            }
        }
        let response = builder
            .send()
            .map_err(|error| format!("No se pudo descargar la fuente: {error}"))?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(String::from(
                    "La fuente excedió el límite de redirecciones.",
                ));
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| String::from("La fuente redirigió sin indicar destino."))?;
            url = response
                .url()
                .join(location)
                .map_err(|_| String::from("La fuente redirigió a una URL inválida."))?;
            continue;
        }
        if is_byte_range_response(
            response.status().as_u16(),
            response.headers().contains_key("content-range"),
        ) {
            return Err(String::from(
                "Las respuestas HTTP parciales o por rangos no se admiten.",
            ));
        }
        if !response.status().is_success() {
            return Err(format!(
                "La fuente respondió HTTP {}.",
                response.status().as_u16()
            ));
        }
        return Ok(response);
    }
    Err(String::from("No se pudo resolver la fuente."))
}

pub(crate) fn send_get_range(
    client: &Client,
    mut url: Url,
    credential_host: &str,
    headers: Option<&HashMap<String, String>>,
    cancel: &AtomicBool,
    (start, end): (u64, u64),
) -> Result<Response, String> {
    if end < start || end.saturating_sub(start).saturating_add(1) > MAX_SEGMENT_BYTES as u64 {
        return Err(String::from("El rango HTTP solicitado no es válido."));
    }
    let expected_range = format!("bytes {start}-{end}");
    let expected_bytes = end - start + 1;
    for redirect_count in 0..=MAX_REDIRECTS {
        if cancel.load(Ordering::Acquire) {
            return Err(String::from("__cancelled__"));
        }
        if url.host_str().is_some_and(is_youtube_page_host) {
            return Err(String::from(
                "YouTube no permite descarga directa desde esta fuente.",
            ));
        }
        if !super::is_public_http_url(&url) {
            return Err(String::from(
                "La URL de descarga no es pública o usa un protocolo no permitido.",
            ));
        }
        let mut builder = client
            .get(url.clone())
            .header("User-Agent", "Aetherio/1.0")
            .header("Range", format!("bytes={start}-{end}"));
        if url
            .host_str()
            .unwrap_or_default()
            .eq_ignore_ascii_case(credential_host)
        {
            for (name, value) in headers.unwrap_or(&HashMap::new()) {
                let Ok(name) = HeaderName::from_bytes(name.trim().as_bytes()) else {
                    continue;
                };
                let Ok(value) = HeaderValue::from_str(value) else {
                    continue;
                };
                if name == "host" || name == "range" || name == "content-length" {
                    continue;
                }
                builder = builder.header(name, value);
            }
        }
        let response = builder
            .send()
            .map_err(|error| format!("No se pudo descargar el rango de bytes: {error}"))?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(String::from(
                    "La fuente excedió el límite de redirecciones.",
                ));
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| String::from("La fuente redirigió sin indicar destino."))?;
            url = response
                .url()
                .join(location)
                .map_err(|_| String::from("La fuente redirigió a una URL inválida."))?;
            continue;
        }
        if response.status().as_u16() != 206 {
            return Err(String::from(
                "El servidor no respetó el rango de bytes solicitado.",
            ));
        }
        let content_range = response
            .headers()
            .get("content-range")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        let (unit, value) = content_range
            .split_once(' ')
            .ok_or_else(|| String::from("El servidor devolvió un Content-Range inválido."))?;
        let (actual_range, total) = value
            .split_once('/')
            .ok_or_else(|| String::from("El servidor devolvió un Content-Range inválido."))?;
        if !unit.eq_ignore_ascii_case("bytes") {
            return Err(String::from(
                "El servidor devolvió un Content-Range inválido.",
            ));
        }
        let total_is_valid = total == "*" || total.parse::<u64>().is_ok_and(|length| length > end);
        if actual_range != expected_range
            || !total_is_valid
            || response
                .content_length()
                .is_some_and(|length| length != expected_bytes)
        {
            return Err(String::from(
                "El servidor devolvió un rango de bytes distinto al solicitado.",
            ));
        }
        return Ok(response);
    }
    Err(String::from("No se pudo resolver el rango de bytes."))
}

fn parse_media_playlist(text: &str, base_url: &Url) -> Result<HlsPlaylist, String> {
    if !text.lines().any(|line| line.trim() == "#EXT-X-ENDLIST") {
        return Err(String::from(
            "La lista HLS es en directo y no se puede descargar como VOD.",
        ));
    }
    let mut segments = Vec::new();
    let mut key: Option<HlsKey> = None;
    let mut current_map: Option<HlsMap> = None;
    let mut pending_byte_range: Option<(u64, Option<u64>)> = None;
    let mut previous_range_ends: HashMap<String, u64> = HashMap::new();
    let mut sequence = 0u64;
    let mut next_sequence = 0u64;
    let mut saw_media_sequence = false;
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(value) = line.strip_prefix("#EXT-X-MAP:") {
            if pending_byte_range.is_some() {
                return Err(String::from(
                    "Un rango de bytes HLS debe preceder directamente a un segmento.",
                ));
            }
            let attributes = parse_attributes(value);
            let uri = attributes
                .get("URI")
                .ok_or_else(|| String::from("La inicialización fMP4 HLS no tiene URI."))?;
            let url = base_url
                .join(uri)
                .map_err(|_| String::from("La URL de inicialización HLS no es válida."))?;
            let byte_range = attributes
                .get("BYTERANGE")
                .map(|value| {
                    let spec = parse_hls_byte_range(value)?;
                    resolve_hls_byte_range(spec, &url, &mut previous_range_ends)
                })
                .transpose()?;
            current_map = Some(HlsMap { url, byte_range });
            continue;
        }
        if let Some(value) = line.strip_prefix("#EXT-X-BYTERANGE:") {
            if pending_byte_range.is_some() {
                return Err(String::from("La lista HLS repite un rango de bytes."));
            }
            pending_byte_range = Some(parse_hls_byte_range(value)?);
            continue;
        }
        if let Some(value) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            sequence = value
                .trim()
                .parse()
                .map_err(|_| String::from("Número de secuencia HLS inválido."))?;
            next_sequence = sequence;
            saw_media_sequence = true;
            continue;
        }
        if let Some(value) = line.strip_prefix("#EXT-X-KEY:") {
            let attributes = parse_attributes(value);
            match attributes.get("METHOD").map(String::as_str).unwrap_or("") {
                "NONE" => key = None,
                "AES-128" => {
                    let uri = attributes
                        .get("URI")
                        .ok_or_else(|| String::from("La clave AES-128 HLS no tiene URI."))?;
                    let url = base_url
                        .join(uri)
                        .map_err(|_| String::from("La URI de clave HLS no es válida."))?;
                    let iv = attributes
                        .get("IV")
                        .map(|value| parse_iv(value))
                        .transpose()?;
                    key = Some(HlsKey { url, iv });
                }
                _ => {
                    return Err(String::from(
                        "El cifrado de esta lista HLS no es compatible; solo se admite AES-128.",
                    ))
                }
            }
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        let url = base_url
            .join(line)
            .map_err(|_| String::from("La URL de un segmento HLS no es válida."))?;
        let byte_range = pending_byte_range
            .take()
            .map(|spec| resolve_hls_byte_range(spec, &url, &mut previous_range_ends))
            .transpose()?;
        segments.push(HlsSegment {
            url,
            byte_range,
            sequence: next_sequence,
            key: key.as_ref().map(|current| HlsKey {
                url: current.url.clone(),
                iv: current.iv,
            }),
            map: current_map.clone(),
        });
        next_sequence = next_sequence.saturating_add(1);
    }
    if segments.is_empty() {
        return Err(String::from(
            "La lista HLS no contiene segmentos descargables.",
        ));
    }
    if pending_byte_range.is_some() {
        return Err(String::from(
            "La lista HLS termina antes del segmento con rango.",
        ));
    }
    if !saw_media_sequence {
        sequence = 0;
    }
    let _ = sequence;
    Ok(HlsPlaylist { segments })
}

fn parse_hls_byte_range(value: &str) -> Result<(u64, Option<u64>), String> {
    let value = value.trim();
    let (length, offset) = match value.split_once('@') {
        Some((length, offset)) if !offset.trim().is_empty() => (length, Some(offset.trim())),
        Some(_) => {
            return Err(String::from(
                "El offset del rango de bytes HLS no es válido.",
            ));
        }
        None => (value, None),
    };
    let length = length
        .parse::<u64>()
        .map_err(|_| String::from("La longitud del rango de bytes HLS no es válida."))?;
    if length == 0 || length > MAX_SEGMENT_BYTES as u64 {
        return Err(String::from(
            "La longitud del rango de bytes HLS no es válida.",
        ));
    }
    let offset = offset
        .map(|offset| {
            offset
                .parse::<u64>()
                .map_err(|_| String::from("El offset del rango de bytes HLS no es válido."))
        })
        .transpose()?;
    Ok((length, offset))
}

fn resolve_hls_byte_range(
    (length, offset): (u64, Option<u64>),
    url: &Url,
    previous_range_ends: &mut HashMap<String, u64>,
) -> Result<(u64, u64), String> {
    let key = url.as_str().to_string();
    let start = match offset {
        Some(offset) => offset,
        None => *previous_range_ends.get(&key).ok_or_else(|| {
            String::from("El rango de bytes HLS no tiene un offset previo para este recurso.")
        })?,
    };
    let end = start
        .checked_add(length - 1)
        .ok_or_else(|| String::from("El rango de bytes HLS excede el límite numérico."))?;
    let next_start = end
        .checked_add(1)
        .ok_or_else(|| String::from("El rango de bytes HLS excede el límite numérico."))?;
    previous_range_ends.insert(key, next_start);
    Ok((start, end))
}

fn select_variant(text: &str, base_url: &Url) -> Result<Option<Url>, String> {
    let mut current_bandwidth = None;
    let mut variants: Vec<(u64, Url)> = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(attributes) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            current_bandwidth = parse_attributes(attributes)
                .get("BANDWIDTH")
                .and_then(|value| value.parse::<u64>().ok());
        } else if !line.is_empty() && !line.starts_with('#') {
            if let Some(bandwidth) = current_bandwidth.take() {
                let url = base_url
                    .join(line)
                    .map_err(|_| String::from("La variante HLS tiene una URL inválida."))?;
                variants.push((bandwidth, url));
            }
        }
    }
    Ok(variants
        .into_iter()
        .max_by_key(|(bandwidth, _)| *bandwidth)
        .map(|(_, url)| url))
}

fn parse_attributes(value: &str) -> HashMap<String, String> {
    let mut attributes = HashMap::new();
    let mut token = String::new();
    let mut quoted = false;
    for character in value.chars().chain(std::iter::once(',')) {
        match character {
            '"' => {
                quoted = !quoted;
                token.push(character);
            }
            ',' if !quoted => {
                if let Some((name, value)) = token.split_once('=') {
                    attributes.insert(
                        name.trim().to_ascii_uppercase(),
                        value.trim().trim_matches('"').to_string(),
                    );
                }
                token.clear();
            }
            _ => token.push(character),
        }
    }
    attributes
}

fn parse_iv(value: &str) -> Result<[u8; 16], String> {
    let hex_value = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .ok_or_else(|| String::from("El IV AES-128 debe usar formato hexadecimal."))?;
    if hex_value.len() > 32 || hex_value.is_empty() {
        return Err(String::from("El IV AES-128 tiene una longitud inválida."));
    }
    let padded = format!("{:0>32}", hex_value);
    let decoded =
        hex::decode(padded).map_err(|_| String::from("El IV AES-128 no es hexadecimal válido."))?;
    decoded
        .try_into()
        .map_err(|_| String::from("El IV AES-128 tiene una longitud inválida."))
}

fn sequence_iv(sequence: u64) -> [u8; 16] {
    let mut iv = [0u8; 16];
    iv[8..].copy_from_slice(&sequence.to_be_bytes());
    iv
}

fn decrypt_hls_segment(ciphertext: &[u8], key: &[u8], iv: &[u8; 16]) -> Result<Vec<u8>, String> {
    if ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
        return Err(String::from(
            "Un segmento HLS AES-128 tiene una longitud cifrada inválida.",
        ));
    }
    let mut plaintext = ciphertext.to_vec();
    let decrypted = Aes128CbcDecryptor::new_from_slices(key, iv)
        .map_err(|_| String::from("No se pudo inicializar el descifrado AES-128."))?
        .decrypt_padded_mut::<Pkcs7>(&mut plaintext)
        .map_err(|_| String::from("No se pudo descifrar un segmento HLS AES-128."))?;
    Ok(decrypted.to_vec())
}

fn looks_like_mpeg_ts(bytes: &[u8]) -> bool {
    bytes.len() >= 3 * 188 && bytes[0] == 0x47 && bytes[188] == 0x47 && bytes[376] == 0x47
}

fn looks_like_fmp4_init(bytes: &[u8]) -> bool {
    has_mp4_box(bytes, b"ftyp") && has_mp4_box(bytes, b"moov")
}

fn looks_like_fmp4_fragment(bytes: &[u8]) -> bool {
    has_mp4_box(bytes, b"moof") && has_mp4_box(bytes, b"mdat")
}

fn has_mp4_box(bytes: &[u8], wanted: &[u8; 4]) -> bool {
    let mut offset = 0usize;
    while offset.saturating_add(8) <= bytes.len() {
        let size = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        if &bytes[offset + 4..offset + 8] == wanted {
            return true;
        }
        if size < 8 || size == 0 {
            break;
        }
        offset = match offset.checked_add(size) {
            Some(next) if next > offset => next,
            _ => break,
        };
    }
    false
}

fn read_limited(response: &mut Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|error| format!("No se pudo leer la respuesta: {error}"))?;
        if count == 0 {
            break;
        }
        if result.len().saturating_add(count) > limit {
            return Err(String::from(
                "La respuesta de la fuente excede el tamaño máximo admitido.",
            ));
        }
        result.extend_from_slice(&buffer[..count]);
    }
    Ok(result)
}

fn extension_for_response(url: &Url, content_type: &str) -> &'static str {
    let extension = Path::new(url.path())
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "mp4" | "m4v" => ".mp4",
        "mkv" => ".mkv",
        "avi" => ".avi",
        "mov" => ".mov",
        "webm" => ".webm",
        "ts" | "m2ts" => ".ts",
        _ if content_type.contains("matroska") => ".mkv",
        _ if content_type.contains("webm") => ".webm",
        _ if content_type.contains("mp2t") => ".ts",
        _ => ".mp4",
    }
}

fn is_youtube_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "youtu.be"
        || [
            "youtube.com",
            "youtube-nocookie.com",
            "youtube.googleapis.com",
            "youtubei.googleapis.com",
            "googlevideo.com",
        ]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

fn is_youtube_page_host(host: &str) -> bool {
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    is_youtube_host(&normalized)
        && normalized != "googlevideo.com"
        && !normalized.ends_with(".googlevideo.com")
}

fn is_rejected_media_type(content_type: &str) -> bool {
    let media_type = content_type.split(';').next().unwrap_or_default().trim();
    matches!(
        media_type,
        "text/html"
            | "application/xhtml+xml"
            | "application/json"
            | "text/json"
            | "application/xml"
            | "text/xml"
    ) || media_type.ends_with("+json")
        || media_type.ends_with("+xml")
}

fn is_byte_range_response(status_code: u16, has_content_range: bool) -> bool {
    status_code == 206 || has_content_range
}

fn is_loopback_url(url: &Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }
    match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false),
        None => false,
    }
}

fn torrent_file_extension(details: &serde_json::Value, file_idx: usize) -> Option<&'static str> {
    let name = details
        .get("files")?
        .as_array()?
        .get(file_idx)?
        .get("name")?
        .as_str()?;
    let extension = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "mp4" | "m4v" => Some(".mp4"),
        "mkv" => Some(".mkv"),
        "avi" => Some(".avi"),
        "mov" => Some(".mov"),
        "webm" => Some(".webm"),
        "ts" | "m2ts" => Some(".ts"),
        _ => None,
    }
}

fn is_youtube_download_target(target: &str) -> bool {
    let Ok(url) = Url::parse(target) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    [
        "youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "youtube.googleapis.com",
        "youtubei.googleapis.com",
    ]
    .iter()
    .any(|domain| {
        host.eq_ignore_ascii_case(domain)
            || host.to_ascii_lowercase().ends_with(&format!(".{domain}"))
    })
}

fn download_youtube(
    app: &tauri::AppHandle,
    root: &Path,
    state: &DownloadState,
    id: &str,
    target: &str,
    item_dir: &Path,
    part_path: &Path,
    cancel: &AtomicBool,
) -> Result<&'static str, String> {
    remove_partial_youtube_files(item_dir);
    let executable = super::ytdlp_path(app)?;
    let output_template = item_dir.join("yt-dlp-media.%(ext)s");
    let stderr_path = item_dir.join("yt-dlp-stderr.log");
    let stderr = File::create(&stderr_path)
        .map_err(|error| format!("No se pudo crear el registro temporal de yt-dlp: {error}"))?;
    let mut command = Command::new(executable);
    command
        .arg("--no-playlist")
        .arg("--no-part")
        .arg("--no-progress")
        .arg("--match-filter")
        .arg("!is_live")
        .arg("--format")
        .arg("best[acodec!=none][vcodec!=none]/best")
        .arg("--output")
        .arg(output_template)
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("No se pudo iniciar yt-dlp: {error}"))?;
    let mut last_reported_bytes = 0u64;
    let status = loop {
        if cancel.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(String::from("__cancelled__"));
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("No se pudo consultar yt-dlp: {error}"));
            }
        }
        if let Some((_, size)) = find_ytdlp_output(item_dir) {
            if size > last_reported_bytes {
                update_progress(app, root, state, id, size, None, None, None);
                last_reported_bytes = size;
            }
        }
        thread::sleep(PROGRESS_INTERVAL);
    };
    if !status.success() {
        let detail = fs::read_to_string(&stderr_path)
            .ok()
            .and_then(|contents| {
                contents
                    .lines()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.chars().take(360).collect::<String>())
            })
            .unwrap_or_else(|| String::from("yt-dlp no pudo obtener un archivo de video."));
        let _ = fs::remove_file(&stderr_path);
        return Err(format!(
            "No se pudo descargar el video de YouTube: {detail}"
        ));
    }

    let (source_path, downloaded) = find_ytdlp_output(item_dir)
        .ok_or_else(|| String::from("yt-dlp terminó, pero no generó un archivo de video."))?;
    let extension = local_media_extension(&source_path).ok_or_else(|| {
        String::from("yt-dlp devolvió un formato de video no compatible offline.")
    })?;
    fs::rename(&source_path, part_path)
        .map_err(|error| format!("No se pudo preparar el archivo de YouTube: {error}"))?;
    let _ = fs::remove_file(&stderr_path);
    set_total(app, root, state, id, Some(downloaded));
    update_progress(
        app,
        root,
        state,
        id,
        downloaded,
        Some(downloaded),
        None,
        None,
    );
    Ok(extension)
}

fn find_ytdlp_output(item_dir: &Path) -> Option<(PathBuf, u64)> {
    fs::read_dir(item_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            if !name.starts_with("yt-dlp-media.") || name.ends_with(".part") {
                return None;
            }
            local_media_extension(&path)?;
            let size = entry.metadata().ok()?.len();
            (size > 0).then_some((path, size))
        })
        .max_by_key(|(_, size)| *size)
}

fn local_media_extension(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "mp4" | "m4v" => Some(".mp4"),
        "mkv" => Some(".mkv"),
        "avi" => Some(".avi"),
        "mov" => Some(".mov"),
        "webm" => Some(".webm"),
        "ts" | "m2ts" => Some(".ts"),
        _ => None,
    }
}

fn remove_partial_youtube_files(item_dir: &Path) {
    let Ok(entries) = fs::read_dir(item_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("yt-dlp-media.") || name == "yt-dlp-stderr.log")
        {
            let _ = fs::remove_file(path);
        }
    }
}

fn safe_filename(title: &str, extension: &str) -> String {
    let safe = title
        .trim()
        .replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_")
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim_matches(['.', ' '])
        .chars()
        .take(150)
        .collect::<String>();
    format!(
        "{}{}",
        if safe.is_empty() { "video" } else { &safe },
        extension
    )
}

fn normalize_title(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        String::from("Video")
    } else {
        value.chars().take(180).collect()
    }
}

fn download_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("downloads"))
        .map_err(|error| format!("No se pudo ubicar la carpeta de descargas: {error}"))
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join("manifest.json")
}

fn retry_requests_path(root: &Path) -> PathBuf {
    root.join("retry-requests.json")
}

fn lock_inner(state: &DownloadState) -> std::sync::MutexGuard<'_, DownloadInner> {
    state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn load_manifest(root: &Path, inner: &mut DownloadInner) -> Result<(), String> {
    if inner.loaded {
        return Ok(());
    }
    inner.loaded = true;
    let retry_path = retry_requests_path(root);
    if retry_path.exists() {
        let raw = fs::read(&retry_path)
            .map_err(|error| format!("No se pudieron leer las fuentes para reintentar: {error}"))?;
        inner.retry_requests = serde_json::from_slice::<HashMap<String, DownloadRequest>>(&raw)
            .map_err(|error| format!("El registro de reintentos no es válido: {error}"))?;
    }
    let path = manifest_path(root);
    if !path.exists() {
        return Ok(());
    }
    let raw = fs::read(&path)
        .map_err(|error| format!("No se pudo leer el registro de descargas: {error}"))?;
    let records = serde_json::from_slice::<Vec<DownloadRecord>>(&raw)
        .map_err(|error| format!("El registro de descargas no es válido: {error}"))?;
    for mut record in records {
        record.retry_available = inner.retry_requests.contains_key(&record.id);
        if record.status == "downloading" || record.status == "queued" {
            record.status = String::from("interrupted");
            record.error = Some(String::from(
                "La app se cerró antes de terminar esta descarga.",
            ));
        }
        inner.records.insert(record.id.clone(), record);
    }
    Ok(())
}

// Las solicitudes pueden incluir cabeceras o URLs firmadas. Se guardan en un
// archivo interno de app-data y nunca se incluyen en DownloadRecord/eventos.
fn persist_retry_requests(
    root: &Path,
    requests: &HashMap<String, DownloadRequest>,
) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("No se pudo crear el registro: {error}"))?;
    let bytes = serde_json::to_vec(requests).map_err(|error| error.to_string())?;
    let temporary = root.join("retry-requests.json.tmp");
    fs::write(&temporary, bytes)
        .map_err(|error| format!("No se pudo guardar la fuente de reintento: {error}"))?;
    let destination = retry_requests_path(root);
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("No se pudo actualizar la fuente de reintento: {error}"))?;
    }
    fs::rename(temporary, destination)
        .map_err(|error| format!("No se pudo finalizar la fuente de reintento: {error}"))
}

fn persist_manifest(root: &Path, records: &HashMap<String, DownloadRecord>) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("No se pudo crear el registro: {error}"))?;
    let mut values = records.values().cloned().collect::<Vec<_>>();
    values.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    let bytes = serde_json::to_vec_pretty(&values).map_err(|error| error.to_string())?;
    let temporary = root.join("manifest.json.tmp");
    fs::write(&temporary, bytes)
        .map_err(|error| format!("No se pudo guardar el registro: {error}"))?;
    let destination = manifest_path(root);
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("No se pudo reemplazar el registro: {error}"))?;
    }
    fs::rename(temporary, destination)
        .map_err(|error| format!("No se pudo finalizar el registro: {error}"))
}

fn set_record_status(inner: &mut DownloadInner, id: &str, status: &str, error: Option<String>) {
    if let Some(record) = inner.records.get_mut(id) {
        record.status = status.to_string();
        record.error = error;
        record.updated_at = now_ms();
    }
}

fn update_progress(
    app: &tauri::AppHandle,
    root: &Path,
    state: &DownloadState,
    id: &str,
    bytes: u64,
    total: Option<u64>,
    segments: Option<usize>,
    total_segments: Option<usize>,
) {
    let mut inner = lock_inner(state);
    if let Some(record) = inner.records.get_mut(id) {
        record.bytes_downloaded = bytes;
        record.total_bytes = total.or(record.total_bytes);
        record.segments_downloaded = segments;
        record.total_segments = total_segments;
        record.updated_at = now_ms();
    }
    let _ = persist_manifest(root, &inner.records);
    if let Some(record) = inner.records.get(id) {
        let _ = app.emit(EVENT_NAME, record);
    }
}

fn set_total(
    app: &tauri::AppHandle,
    root: &Path,
    state: &DownloadState,
    id: &str,
    total: Option<u64>,
) {
    let mut inner = lock_inner(state);
    if let Some(record) = inner.records.get_mut(id) {
        record.total_bytes = total;
    }
    let _ = persist_manifest(root, &inner.records);
    if let Some(record) = inner.records.get(id) {
        let _ = app.emit(EVENT_NAME, record);
    }
}

fn finish_job(
    app: &tauri::AppHandle,
    root: &Path,
    state: &DownloadState,
    id: &str,
    status: &str,
    path: Option<String>,
    error: Option<String>,
) {
    let mut inner = lock_inner(state);
    if let Some(record) = inner.records.get_mut(id) {
        record.status = status.to_string();
        record.file_path = path;
        record.error = error;
        if status == "completed" {
            if let Some(total) = record.total_bytes {
                record.bytes_downloaded = total;
            }
        }
        record.updated_at = now_ms();
    }
    let _ = persist_manifest(root, &inner.records);
    if let Some(record) = inner.records.get(id) {
        let _ = app.emit(EVENT_NAME, record);
    }
}

fn emit_record(app: &tauri::AppHandle, root: &Path, state: &DownloadState, id: &str) {
    let inner = lock_inner(state);
    let _ = persist_manifest(root, &inner.records);
    if let Some(record) = inner.records.get(id) {
        let _ = app.emit(EVENT_NAME, record);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hls_media_sequence_and_relative_segment_urls() {
        let base = Url::parse("https://cdn.example/vod/index.m3u8").unwrap();
        let playlist = parse_media_playlist(
            "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:12\n#EXTINF:5,\nseg-1.ts\n#EXTINF:5,\nseg-2.ts\n#EXT-X-ENDLIST\n",
            &base,
        ).unwrap();
        assert_eq!(playlist.segments.len(), 2);
        assert_eq!(playlist.segments[0].sequence, 12);
        assert_eq!(
            playlist.segments[1].url.as_str(),
            "https://cdn.example/vod/seg-2.ts"
        );
    }

    #[test]
    fn rejects_live_hls_playlists_but_accepts_fmp4_vod() {
        let base = Url::parse("https://cdn.example/index.m3u8").unwrap();
        assert!(parse_media_playlist("#EXTM3U\n#EXTINF:5,\nseg.ts\n", &base)
            .unwrap_err()
            .contains("directo"));
        let playlist = parse_media_playlist(
            "#EXTM3U\n#EXT-X-MAP:URI=init.mp4\n#EXTINF:5,\nseg.m4s\n#EXT-X-ENDLIST\n",
            &base,
        )
        .unwrap();
        assert_eq!(playlist.segments.len(), 1);
        assert_eq!(
            playlist.segments[0].url.as_str(),
            "https://cdn.example/seg.m4s"
        );
        assert_eq!(
            playlist.segments[0].map.as_ref().unwrap().url.as_str(),
            "https://cdn.example/init.mp4"
        );
    }

    #[test]
    fn parses_explicit_and_implicit_hls_byte_ranges_for_media_and_initialization() {
        let base = Url::parse("https://cdn.example/vod/index.m3u8").unwrap();
        let playlist = parse_media_playlist(
            "#EXTM3U\n#EXT-X-MAP:URI=\"mux.mp4\",BYTERANGE=\"4@0\"\n#EXT-X-BYTERANGE:4@4\n#EXTINF:5,\nmux.mp4\n#EXT-X-BYTERANGE:4\n#EXTINF:5,\nmux.mp4\n#EXT-X-ENDLIST\n",
            &base,
        )
        .unwrap();

        assert_eq!(
            playlist.segments[0].map.as_ref().unwrap().byte_range,
            Some((0, 3))
        );
        assert_eq!(playlist.segments[0].byte_range, Some((4, 7)));
        assert_eq!(playlist.segments[1].byte_range, Some((8, 11)));
    }

    #[test]
    fn rejects_implicit_hls_byte_ranges_without_a_prior_range_for_the_same_resource() {
        let base = Url::parse("https://cdn.example/vod/index.m3u8").unwrap();
        let error = parse_media_playlist(
            "#EXTM3U\n#EXT-X-BYTERANGE:4\n#EXTINF:5,\nsegment.mp4\n#EXT-X-ENDLIST\n",
            &base,
        )
        .unwrap_err();
        assert!(error.contains("offset"));
    }

    #[test]
    fn recognizes_fmp4_initialization_and_fragments() {
        let init = [
            0, 0, 0, 8, b'f', b't', b'y', b'p', 0, 0, 0, 8, b'm', b'o', b'o', b'v',
        ];
        let fragment = [
            0, 0, 0, 8, b'm', b'o', b'o', b'f', 0, 0, 0, 8, b'm', b'd', b'a', b't',
        ];
        assert!(looks_like_fmp4_init(&init));
        assert!(looks_like_fmp4_fragment(&fragment));
        assert!(!looks_like_fmp4_init(&fragment));
        assert!(!looks_like_fmp4_fragment(&init));
    }

    #[test]
    fn selects_highest_bandwidth_variant_and_parses_quoted_attributes() {
        let base = Url::parse("https://cdn.example/master.m3u8").unwrap();
        let selected = select_variant(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000,CODECS=\"avc1.4d401f,mp4a.40.2\"\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000\nhigh/index.m3u8\n",
            &base,
        ).unwrap().unwrap();
        assert_eq!(selected.as_str(), "https://cdn.example/high/index.m3u8");
    }

    #[test]
    fn parses_aes_iv_and_derives_sequence_iv_as_big_endian() {
        assert_eq!(parse_iv("0x1").unwrap()[15], 1);
        assert_eq!(sequence_iv(2)[15], 2);
        assert_eq!(sequence_iv(0x0102)[14..], [1, 2]);
        assert!(parse_iv("not-hex").is_err());
    }

    #[test]
    fn creates_safe_filename_with_expected_extension() {
        assert_eq!(
            safe_filename("../A movie: test?", ".ts"),
            "_A movie_ test_.ts"
        );
        assert_eq!(safe_filename("...", ".mp4"), "video.mp4");
    }

    #[test]
    fn identifies_youtube_hosts_without_matching_lookalikes() {
        assert!(is_youtube_host("www.youtube.com"));
        assert!(is_youtube_host("r3---sn.googlevideo.com"));
        assert!(is_youtube_host("youtu.be"));
        assert!(!is_youtube_host("notyoutube.com"));
        assert!(is_youtube_page_host("www.youtube.com"));
        assert!(!is_youtube_page_host("r3---sn.googlevideo.com"));
    }

    #[test]
    fn rejects_html_and_json_responses_but_accepts_media_types() {
        assert!(is_rejected_media_type("text/html; charset=utf-8"));
        assert!(is_rejected_media_type("application/json"));
        assert!(!is_rejected_media_type("video/mp4"));
        assert!(!is_rejected_media_type("application/octet-stream"));
    }

    #[test]
    fn rejects_partial_and_content_range_http_responses() {
        assert!(is_byte_range_response(206, false));
        assert!(is_byte_range_response(200, true));
        assert!(!is_byte_range_response(200, false));
    }
}
