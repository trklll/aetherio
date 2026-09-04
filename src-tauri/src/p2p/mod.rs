pub mod chunk_store;
pub mod tracker;
pub mod webrtc;

pub use chunk_store::{ChunkStore, SharedChunkStore};
pub use tracker::TrackerServer;


use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// Tope máximo del caché de chunks P2P (2 GB) y antigüedad máxima (7 días).
pub const P2P_MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const P2P_MAX_CACHE_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

pub fn p2p_layer_log(event: &str, payload: serde_json::Value) {
    let line = serde_json::json!({
        "event": event,
        "tsMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|v| v.as_millis())
            .unwrap_or_default(),
        "payload": payload,
    });
    eprintln!("[AETHERIO:P2P:CHUNK] {}", line);
}

pub fn spawn_p2p_layer(
    cache_root: PathBuf,
) -> (SharedChunkStore, TrackerServer) {
    let chunk_root = cache_root.join("chunks");
    let store = Arc::new(ChunkStore::new(chunk_root));

    let tracker = TrackerServer::bind_and_spawn();
    let tracker_port = tracker.port;

    p2p_layer_log("p2p_layer_started",
        serde_json::json!({
            "cacheRoot": cache_root.display().to_string(),
            "trackerPort": tracker_port,
            "chunkSize": chunk_store::CHUNK_SIZE,
        })
    );

    let maintenance_store = store.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(300));
            let removed = maintenance_store.sweep(P2P_MAX_CACHE_AGE, P2P_MAX_CACHE_BYTES);
            if removed > 0 {
                p2p_layer_log(
                    "chunk_cache_swept",
                    serde_json::json!({ "removedFiles": removed }),
                );
            }
        }
    });

    (store, tracker)
}
