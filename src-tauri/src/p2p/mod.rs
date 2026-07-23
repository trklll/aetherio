pub mod chunk_store;
pub mod tracker;
pub mod webrtc;

pub use chunk_store::{ChunkStore, SharedChunkStore};
pub use tracker::TrackerServer;


use std::path::PathBuf;
use std::sync::Arc;

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
) -> (SharedChunkStore, TrackerServer, tokio::task::JoinHandle<()>) {
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

    let maintenance_handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });

    (store, tracker, maintenance_handle)
}
