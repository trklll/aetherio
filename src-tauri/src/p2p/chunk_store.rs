use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use bytes::Bytes;
use dashmap::DashMap;
use parking_lot::Mutex;
use thiserror::Error;

use crate::p2p::p2p_layer_log;

#[derive(Debug, Error)]
pub enum ChunkError {
    #[error("No hay fuentes para servir el chunk {0}")]
    NoSources(String),
    #[error("Todas las fuentes fallaron para {0}: {1:?}")]
    AllSourcesFailed(String, Vec<String>),
    #[error("Error de I/O: {0}")]
    Io(String),
}

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct ChunkKey {
    info_hash: String,
    offset: u64,
}

impl ChunkKey {
    fn new(info_hash: &str, offset: u64) -> Self {
        Self {
            info_hash: info_hash.to_string(),
            offset,
        }
    }
}

pub const CHUNK_SIZE: u64 = 64 * 1024;

pub trait ChunkSource: Send + Sync + 'static {
    fn fetch(&self, offset: u64, len: usize) -> Result<Bytes, String>;
}

pub struct ChunkStore {
    hot: DashMap<ChunkKey, Bytes>,
    eviction_queue: Mutex<VecDeque<ChunkKey>>,
    disk_root: PathBuf,
    max_mem_bytes: usize,
    cur_mem_bytes: AtomicUsize,
    sources: DashMap<String, Vec<Box<dyn ChunkSource>>>,
}

impl ChunkStore {
    pub fn new(disk_root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&disk_root);
        Self {
            hot: DashMap::new(),
            eviction_queue: Mutex::new(VecDeque::new()),
            disk_root,
            max_mem_bytes: 32 * 1024 * 1024,
            cur_mem_bytes: AtomicUsize::new(0),
            sources: DashMap::new(),
        }
    }

    pub fn with_mem_cap(mut self, bytes: usize) -> Self {
        self.max_mem_bytes = bytes;
        self
    }

    pub fn register_source(&self, info_hash: &str, source: Box<dyn ChunkSource>) {
        self.sources
            .entry(info_hash.to_string())
            .or_insert_with(Vec::new)
            .push(source);
    }

    fn chunk_path(&self, info_hash: &str, offset: u64) -> PathBuf {
        let prefix = &info_hash[..info_hash.len().min(2)];
        self.disk_root
            .join(prefix)
            .join(info_hash)
            .join(format!("{:016x}.bin", offset))
    }

    fn chunk_store_disk(&self, info_hash: &str, offset: u64, data: &[u8]) {
        let path = self.chunk_path(info_hash, offset);
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                p2p_layer_log("disk_mkdir_error",
                    serde_json::json!({"path": parent.display().to_string(), "error": e.to_string()})
                );
            }
        }
        if let Err(e) = std::fs::write(&path, data) {
            p2p_layer_log("disk_write_error",
                serde_json::json!({"path": path.display().to_string(), "error": e.to_string()})
            );
        }
    }

    fn disk_load(&self, info_hash: &str, offset: u64) -> Option<Bytes> {
        let path = self.chunk_path(info_hash, offset);
        std::fs::read(&path).ok().map(Bytes::from)
    }

    fn evict_if_needed(&self) {
        loop {
            let current = self.cur_mem_bytes.load(Ordering::Relaxed);
            if current <= self.max_mem_bytes {
                break;
            }
            let key = self.eviction_queue.lock().pop_front();
            match key {
                Some(key) => {
                    let removed_bytes = self
                        .hot
                        .remove(&key)
                        .map(|(_, bytes)| bytes.len())
                        .unwrap_or(0);
                    if removed_bytes > 0 {
                        self.cur_mem_bytes
                            .fetch_sub(removed_bytes, Ordering::Relaxed);
                    }
                }
                None => break,
            }
        }
    }

    fn fetch_from_sources(&self, info_hash: &str, offset: u64, len: usize) -> Result<Bytes, ChunkError> {
        let mut errors = Vec::new();
        if let Some(sources) = self.sources.get(info_hash) {
            for (i, source) in sources.iter().enumerate() {
                match source.fetch(offset, len) {
                    Ok(bytes) if !bytes.is_empty() => return Ok(bytes),
                    Ok(_) => errors.push(format!("fuente {} devolvio vacio", i)),
                    Err(e) => errors.push(format!("fuente {}: {}", i, e)),
                }
            }
        }

        if errors.is_empty() {
            Err(ChunkError::NoSources(format!("{}@{}", info_hash, offset)))
        } else {
            Err(ChunkError::AllSourcesFailed(
                format!("{}@{}", info_hash, offset),
                errors,
            ))
        }
    }

    pub fn store_chunk(&self, info_hash: &str, offset: u64, data: Bytes) {
        let key = ChunkKey::new(info_hash, offset);
        let data_len = data.len();

        if self.hot.contains_key(&key) {
            return;
        }

        self.hot.insert(key.clone(), data.clone());
        self.cur_mem_bytes.fetch_add(data_len, Ordering::Relaxed);

        self.eviction_queue.lock().push_back(key.clone());

        self.evict_if_needed();

        self.chunk_store_disk(info_hash, offset, &data);
    }

    pub fn fetch_range(&self, info_hash: &str, start: u64, end: u64) -> Result<Bytes, ChunkError> {
        if end <= start {
            return Ok(Bytes::new());
        }

        let first_chunk = start / CHUNK_SIZE;
        let last_chunk = (end - 1) / CHUNK_SIZE;
        let mut result = Vec::with_capacity((end - start) as usize);

        for chunk_idx in first_chunk..=last_chunk {
            let chunk_start = chunk_idx * CHUNK_SIZE;
            let chunk_end = chunk_start + CHUNK_SIZE;
            let fetch_start = start.max(chunk_start);
            let fetch_end = end.min(chunk_end);
            if fetch_end <= fetch_start {
                continue;
            }

            let key = ChunkKey::new(info_hash, chunk_start);

            let chunk_data = if let Some(cached) = self.hot.get(&key) {
                cached.clone()
            } else if let Some(disk) = self.disk_load(info_hash, chunk_start) {
                self.hot.insert(key.clone(), disk.clone());
                self.cur_mem_bytes.fetch_add(disk.len(), Ordering::Relaxed);
                self.eviction_queue.lock().push_back(key);
                self.evict_if_needed();
                disk
            } else {
                let fetched = self.fetch_from_sources(info_hash, chunk_start, CHUNK_SIZE as usize)?;
                self.store_chunk(info_hash, chunk_start, fetched.clone());
                fetched
            };

            let range_start = (fetch_start - chunk_start) as usize;
            let range_end = (fetch_end - chunk_start) as usize;
            result.extend_from_slice(&chunk_data[range_start..range_end]);
        }

        Ok(Bytes::from(result))
    }
}

pub type SharedChunkStore = Arc<ChunkStore>;
