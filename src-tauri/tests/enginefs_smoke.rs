//! Smoke test real de EngineFS-P0 contra la red BitTorrent.
//!
//! Levanta la misma pila que la app (sesión `librqbit` + API nativa +
//! adaptador EngineFS) y actúa como un usuario real:
//!   1. Torrent con miles de seeders (ISO de Ubuntu 24.04.3).
//!   2. Magnet sin peers (falla con 502 tras el timeout de metadata).
//!   3. Contrato: dedup, Range/HEAD/seek, external, download, 416,
//!      404, traversal, pause/remove/removeAll y reinicio.
//!
//! Tarda minutos porque descarga metadata y piezas reales.

use aetherio_lib::p2p::enginefs::{
    EnginefsHandle, EnginefsRegistry, SharedEnginefsRegistry, start_enginefs_server,
    stop_enginefs_server,
};
use librqbit::{
    Api, Session, SessionOptions,
    dht::PersistentDhtConfig,
    http_api::{HttpApi, HttpApiOptions},
};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const UBUNTU_TORRENT_URL: &str =
    "https://releases.ubuntu.com/noble/ubuntu-24.04.3-desktop-amd64.iso.torrent";
// Hash aleatorio sin peers: prueba el camino de "muy poca gente" (timeout).
const DEAD_MAGNET: &str =
    "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce";

fn log(step: &str, detail: serde_json::Value) {
    println!(
        "[SMOKE] {} {}",
        step,
        serde_json::to_string(&detail).unwrap_or_default()
    );
}

async fn start_stack() -> (String, String, SharedEnginefsRegistry, Arc<Session>, String, EnginefsHandle) {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_millis())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!("aetherio-smoke-{stamp}"));
    let session_dir = root.join("session");
    std::fs::create_dir_all(&session_dir).expect("crear dir de sesión smoke");
    let dht_config = root.join("dht.json");

    let session = Session::new_with_opts(
        session_dir,
        SessionOptions {
            dht_config: Some(PersistentDhtConfig {
                dump_interval: Some(Duration::from_secs(30)),
                config_filename: Some(dht_config),
            }),
            fastresume: true,
            enable_upnp_port_forwarding: false,
            defer_writes_up_to: Some(64),
            ..Default::default()
        },
    )
    .await
    .expect("iniciar sesión librqbit");

    let api = Api::new(session.clone(), None, None);
    let http_api = HttpApi::new(
        api,
        Some(HttpApiOptions {
            read_only: false,
            basic_auth: None,
        }),
    );
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind API nativa");
    let native_base = format!("http://{}", listener.local_addr().expect("addr nativa"));
    tokio::spawn(async move {
        let _ = http_api.make_http_api_and_run(listener, None).await;
    });

    let registry: SharedEnginefsRegistry = Arc::new(EnginefsRegistry::new());
    // `start_enginefs_server` crea clientes reqwest blocking (con runtime
    // propio): debe correr fuera del contexto async.
    let registry_for_server = registry.clone();
    let native_for_server = native_base.clone();
    let handle = tokio::task::spawn_blocking(move || {
        start_enginefs_server(native_for_server, registry_for_server)
    })
    .await
    .expect("join arranque EngineFS")
    .expect("iniciar EngineFS");
    let base = handle.base_url.clone();
    log(
        "stack_lista",
        serde_json::json!({ "enginefs": base, "nativa": "127.0.0.1 (local)" }),
    );
    (base, native_base, registry, session, root.display().to_string(), handle)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn enginefs_smoke_usuario_real() {
    let (base, native_base, registry, session, root, handle) = start_stack().await;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .expect("cliente http");

    // 1. Heartbeat / settings / stats global.
    let hb: serde_json::Value = client
        .get(format!("{base}/heartbeat"))
        .send()
        .await
        .expect("heartbeat transport")
        .json()
        .await
        .expect("heartbeat json");
    assert_eq!(hb["ok"], true);
    log("heartbeat_ok", hb);

    // 2. CASO POPULAR: Ubuntu 24.04.3 (miles de seeders).
    log("caso_popular_inicio", serde_json::json!({ "url": UBUNTU_TORRENT_URL }));
    let created: serde_json::Value = client
        .post(format!("{base}/create"))
        .body(UBUNTU_TORRENT_URL.to_string())
        .send()
        .await
        .expect("create popular transport")
        .json()
        .await
        .expect("create popular json");
    assert!(
        created.get("error").is_none(),
        "create popular falló: {created}"
    );
    let hash = created["infoHash"].as_str().expect("infoHash").to_string();
    let file_idx = created["fileIdx"].as_u64().expect("fileIdx") as usize;
    let stream_len = created["streamLen"].as_u64().unwrap_or(0);
    assert!(stream_len > 1_000_000_000, "la ISO debe medir GB: {created}");
    log(
        "caso_popular_creado",
        serde_json::json!({
            "infoHash": hash,
            "file": created["fileName"],
            "bytes": stream_len,
            "estado": created["state"],
        }),
    );

    // 3. Dedup: crear dos veces comparte la sesión.
    let dup: serde_json::Value = client
        .post(format!("{base}/create"))
        .body(UBUNTU_TORRENT_URL.to_string())
        .send()
        .await
        .expect("dedup transport")
        .json()
        .await
        .expect("dedup json");
    assert_eq!(dup["torrentId"], created["torrentId"], "dedup falló: {dup}");
    log("dedup_ok", serde_json::json!({ "torrentId": dup["torrentId"] }));

    // 4. Stats por archivo.
    let stats: serde_json::Value = client
        .get(format!("{base}/{hash}/{file_idx}/stats.json"))
        .send()
        .await
        .expect("stats transport")
        .json()
        .await
        .expect("stats json");
    assert_eq!(stats["infoHash"], hash);
    log(
        "stats_ok",
        serde_json::json!({
            "progreso": stats["streamProgress"],
            "velocidad": stats["downloadSpeed"],
            "estado": stats["state"],
        }),
    );

    // 5. HEAD.
    let head = client
        .head(format!("{base}/{hash}/{file_idx}"))
        .send()
        .await
        .expect("head transport");
    assert!(head.status().is_success(), "HEAD falló: {}", head.status());
    let accept_ranges = head
        .headers()
        .get("accept-ranges")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert_eq!(accept_ranges, "bytes");
    log("head_ok", serde_json::json!({ "acceptRanges": accept_ranges }));

    // 6. Range inicial (primeros 256 KiB) como haría MPV al abrir.
    let first = client
        .get(format!("{base}/{hash}/{file_idx}"))
        .header("Range", "bytes=0-262143")
        .send()
        .await
        .expect("range inicial transport");
    assert_eq!(first.status().as_u16(), 206, "range inicial no fue 206");
    let body = first.bytes().await.expect("leer range inicial");
    assert_eq!(body.len(), 262144, "range inicial incompleto");
    log("range_inicial_ok", serde_json::json!({ "bytes": body.len() }));

    // 7. Seek a mitad del archivo (5 GiB) con cliente paciente.
    let seek_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("cliente seek");
    let middle = 5_000_000_000u64.min(stream_len.saturating_sub(262144));
    let seek = seek_client
        .get(format!("{base}/{hash}/{file_idx}"))
        .header("Range", format!("bytes={middle}-{}", middle + 262143))
        .send()
        .await
        .expect("seek transport");
    assert_eq!(seek.status().as_u16(), 206, "seek no fue 206");
    let seek_body = seek.bytes().await.expect("leer seek");
    assert_eq!(seek_body.len(), 262144, "seek incompleto");
    let content_range = seek_client
        .get(format!("{base}/{hash}/{file_idx}"))
        .header("Range", format!("bytes={middle}-{}", middle + 100))
        .send()
        .await
        .expect("content-range transport")
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert!(
        content_range.starts_with("bytes "),
        "sin Content-Range: {content_range}"
    );
    log(
        "seek_ok",
        serde_json::json!({ "offset": middle, "contentRange": content_range }),
    );

    // 8. external=1 -> 307 con Location (sin seguir redirects).
    let no_redirect = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("cliente sin redirects");
    let ext = no_redirect
        .get(format!("{base}/{hash}/{file_idx}?external=1"))
        .send()
        .await
        .expect("external transport");
    assert_eq!(ext.status().as_u16(), 307);
    let location = ext
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert!(location.contains(&hash), "Location sin hash: {location}");
    log("external_ok", serde_json::json!({ "location": location }));

    // 9. download=1 -> attachment.
    let dl = client
        .get(format!("{base}/{hash}/{file_idx}?download=1"))
        .header("Range", "bytes=0-99")
        .send()
        .await
        .expect("download transport");
    let disposition = dl
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert!(disposition.contains("attachment"), "sin attachment: {disposition}");
    log("download_ok", serde_json::json!({ "disposition": disposition }));

    // 10. Rango imposible -> 416.
    let bad = client
        .get(format!("{base}/{hash}/{file_idx}"))
        .header("Range", "bytes=99999999999999-")
        .send()
        .await
        .expect("416 transport");
    assert_eq!(bad.status().as_u16(), 416);
    log("rango_416_ok", serde_json::json!({}));

    // 11. Hash desconocido -> 404; hash inválido -> 404; traversal -> 400.
    let unknown = client
        .get(format!("{base}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/0"))
        .send()
        .await
        .expect("404 transport");
    assert_eq!(unknown.status().as_u16(), 404);
    let invalid = client
        .get(format!("{base}/zzz/0"))
        .send()
        .await
        .expect("hash inválido transport");
    assert_eq!(invalid.status().as_u16(), 404);
    let traversal = client
        .get(format!("{base}/{hash}/{file_idx}/a/b.mkv"))
        .send()
        .await
        .expect("traversal transport");
    assert_eq!(traversal.status().as_u16(), 400);
    log("errores_http_ok", serde_json::json!({}));

    // 12. Pause.
    let pause = client
        .post(format!("{base}/{hash}/pause"))
        .send()
        .await
        .expect("pause transport");
    assert!(pause.status().is_success());
    log("pause_ok", serde_json::json!({}));

    // 13. CASO POCOS SEEDERS: magnet muerto -> 502 tras timeout de metadata.
    log("caso_muerto_inicio", serde_json::json!({ "magnet": "btih:aaaa… (sin peers)" }));
    let dead_resp = client
        .post(format!("{base}/create"))
        .body(DEAD_MAGNET.to_string())
        .send()
        .await
        .expect("create muerto transport");
    assert_eq!(dead_resp.status().as_u16(), 502, "el magnet muerto debió dar 502");
    let dead_body: serde_json::Value = dead_resp.json().await.expect("dead json");
    assert!(dead_body.get("error").is_some(), "sin mensaje de error: {dead_body}");
    log("caso_muerto_ok", dead_body);

    // 14. Remove del popular + stats -> 404.
    let remove = client
        .post(format!("{base}/{hash}/remove"))
        .send()
        .await
        .expect("remove transport");
    assert!(remove.status().is_success());
    let gone = client
        .get(format!("{base}/{hash}/{file_idx}/stats.json"))
        .send()
        .await
        .expect("gone transport");
    assert_eq!(gone.status().as_u16(), 404);
    log("remove_ok", serde_json::json!({}));

    // 15. removeAll.
    let remove_all = client
        .post(format!("{base}/removeAll"))
        .send()
        .await
        .expect("removeAll transport");
    assert!(remove_all.status().is_success());
    assert_eq!(registry.len(), 0);
    log("remove_all_ok", serde_json::json!({}));

    // 16. Reinicio: se detiene el adaptador, se arranca otro contra la misma
    // sesión nativa pero con registry vacío, y las URLs viejas dan 404.
    tokio::task::spawn_blocking(move || stop_enginefs_server(handle))
        .await
        .expect("join parada EngineFS");
    let fresh: SharedEnginefsRegistry = Arc::new(EnginefsRegistry::new());
    let new_handle = tokio::task::spawn_blocking(move || {
        start_enginefs_server(native_base, fresh)
    })
    .await
    .expect("join reinicio EngineFS")
    .expect("reiniciar EngineFS");
    let stale = client
        .get(format!("{}/{}/{}/stats.json", new_handle.base_url, hash, file_idx))
        .send()
        .await
        .expect("stale transport");
    assert_eq!(stale.status().as_u16(), 404, "URL vieja resucitó tras reinicio");
    log(
        "reinicio_ok",
        serde_json::json!({ "nuevoServidor": new_handle.base_url }),
    );
    tokio::task::spawn_blocking(move || stop_enginefs_server(new_handle))
        .await
        .expect("join parada final");

    session.stop().await;
    let _ = std::fs::remove_dir_all(&root);
    log("fin", serde_json::json!({ "todo": "ok" }));
}
