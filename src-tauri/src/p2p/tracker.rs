use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;

use dashmap::DashMap;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;

type WsSink = SplitSink<tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>, WsMessage>;

use crate::p2p::p2p_layer_log;

#[derive(Debug, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TrackerMessage {
    #[serde(rename = "announce")]
    Announce {
        peer_id: String,
        info_hash: String,
        port: u16,
    },
    #[serde(rename = "offer")]
    Offer {
        from: String,
        to: String,
        sdp: String,
    },
    #[serde(rename = "answer")]
    Answer {
        from: String,
        to: String,
        sdp: String,
    },
    #[serde(rename = "ice")]
    IceCandidate {
        from: String,
        to: String,
        candidate: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sdp_mid: Option<String>,
    },
    #[serde(rename = "leave")]
    Leave { peer_id: String },
    #[serde(rename = "peers")]
    Peers {
        info_hash: String,
        peers: Vec<PeerInfo>,
    },
    #[serde(rename = "signal")]
    Signal {
        from: String,
        to: String,
        sdp: String,
        kind: String,
    },
}

struct PeerConnection {
    peer_id: String,
    info_hash: String,
    tx: mpsc::UnboundedSender<String>,
}

struct TrackerState {
    rooms: DashMap<String, Vec<PeerConnection>>,
}

impl TrackerState {
    fn new() -> Self {
        Self {
            rooms: DashMap::new(),
        }
    }

    fn add_peer(&self, info_hash: &str, conn: PeerConnection) -> Vec<PeerInfo> {
        let mut existing = Vec::new();
        let mut entry = self
            .rooms
            .entry(info_hash.to_string())
            .or_insert_with(Vec::new);
        for peer in entry.iter() {
            existing.push(PeerInfo {
                peer_id: peer.peer_id.clone(),
                port: None,
            });
        }
        entry.push(conn);
        existing
    }

    fn remove_peer(&self, info_hash: &str, peer_id: &str) {
        if let Some(mut entry) = self.rooms.get_mut(info_hash) {
            entry.retain(|p| p.peer_id != peer_id);
            if entry.is_empty() {
                drop(entry);
                self.rooms.remove(info_hash);
            }
        }
    }

    fn send_to(&self, info_hash: &str, target: &str, msg: &str) -> bool {
        if let Some(entry) = self.rooms.get(info_hash) {
            for peer in entry.iter() {
                if peer.peer_id == target {
                    return peer.tx.send(msg.to_string()).is_ok();
                }
            }
        }
        false
    }
}

pub struct TrackerServer {
    pub port: u16,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    _handle: Option<tokio::task::JoinHandle<()>>,
}

impl TrackerServer {
    pub fn bind_and_spawn() -> Self {
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        let port = Arc::new(AtomicU16::new(0));
        let port_ref = port.clone();

        let handle = tokio::spawn(async move {
            let listener = match TcpListener::bind("127.0.0.1:0").await {
                Ok(l) => l,
                Err(e) => {
                    p2p_layer_log(
                        "tracker_bind_error",
                        serde_json::json!({"error": e.to_string()}),
                    );
                    return;
                }
            };
            let local_port = listener.local_addr().unwrap().port();
            port_ref.store(local_port, Ordering::Relaxed);
            p2p_layer_log(
                "tracker_bound",
                serde_json::json!({"port": local_port}),
            );

            let state = Arc::new(TrackerState::new());
            run_tracker(listener, state, shutdown_rx).await;
        });

        Self {
            port: port.load(Ordering::Relaxed),
            shutdown: Some(shutdown_tx),
            _handle: Some(handle),
        }
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

async fn run_tracker(
    listener: TcpListener,
    state: Arc<TrackerState>,
    mut shutdown: tokio::sync::oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                p2p_layer_log("tracker_stopped", serde_json::json!({}));
                break;
            }
            accept = listener.accept() => {
                match accept {
                    Ok((stream, peer_addr)) => {
                        p2p_layer_log("tracker_peer_connected",
                            serde_json::json!({"addr": peer_addr.to_string()})
                        );
                        let s = state.clone();
                        tokio::spawn(handle_peer(stream, s));
                    }
                    Err(e) => {
                        p2p_layer_log("tracker_accept_error",
                            serde_json::json!({"error": e.to_string()})
                        );
                    }
                }
            }
        }
    }
}

async fn handle_peer(stream: tokio::net::TcpStream, state: Arc<TrackerState>) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            p2p_layer_log(
                "tracker_ws_error",
                serde_json::json!({"error": e.to_string()}),
            );
            return;
        }
    };

    let (sink, stream_read) = ws.split();
    let (tx, rx) = mpsc::unbounded_channel::<String>();

    let mut my_info: Option<(String, String)> = None;

    let send_handle = tokio::spawn(send_loop(sink, rx));

    let mut read = stream_read;
    loop {
        let msg = read.next().await;
        match msg {
            Some(Ok(WsMessage::Text(utf8))) => {
                let text: String = utf8.to_string();
                let parsed: TrackerMessage = match serde_json::from_str(&text) {
                    Ok(m) => m,
                    Err(e) => {
                        p2p_layer_log(
                            "tracker_parse_error",
                            serde_json::json!({"raw": text.chars().take(200).collect::<String>(), "error": e.to_string()}),
                        );
                        continue;
                    }
                };

                match parsed {
                    TrackerMessage::Announce {
                        peer_id,
                        info_hash,
                        port: _,
                    } => {
                        let conn = PeerConnection {
                            peer_id: peer_id.clone(),
                            info_hash: info_hash.clone(),
                            tx: tx.clone(),
                        };
                        let peers = state.add_peer(&info_hash, conn);
                        my_info = Some((info_hash.clone(), peer_id.clone()));

                        let peers_msg = serde_json::to_string(&TrackerMessage::Peers {
                            info_hash,
                            peers,
                        })
                        .unwrap_or_default();
                        let _ = tx.send(peers_msg);
                    }
                    TrackerMessage::Offer { from, to, sdp } => {
                        if let Some((info_hash, _)) = &my_info {
                            let relay = serde_json::to_string(&TrackerMessage::Signal {
                                from: from.clone(),
                                to: to.clone(),
                                sdp: sdp.clone(),
                                kind: "offer".to_string(),
                            })
                            .unwrap_or_default();
                            state.send_to(info_hash, &to, &relay);
                        }
                    }
                    TrackerMessage::Answer { from, to, sdp } => {
                        if let Some((info_hash, _)) = &my_info {
                            let relay = serde_json::to_string(&TrackerMessage::Signal {
                                from: from.clone(),
                                to: to.clone(),
                                sdp: sdp.clone(),
                                kind: "answer".to_string(),
                            })
                            .unwrap_or_default();
                            state.send_to(info_hash, &to, &relay);
                        }
                    }
                    TrackerMessage::IceCandidate { from, to, .. } => {
                        if let Some((info_hash, _)) = &my_info {
                            state.send_to(info_hash, &to, &text);
                        }
                    }
                    TrackerMessage::Leave { .. } => {
                        if let Some((info_hash, peer_id)) = &my_info {
                            state.remove_peer(info_hash, peer_id);
                        }
                        break;
                    }
                    TrackerMessage::Signal { .. } | TrackerMessage::Peers { .. } => {}
                }
            }
            Some(Ok(WsMessage::Close(_))) => break,
            Some(Ok(WsMessage::Ping(_))) => {
                let _ = tx.send("__pong__".to_string());
            }
            Some(Err(e)) => {
                p2p_layer_log(
                    "tracker_ws_error",
                    serde_json::json!({"error": e.to_string()}),
                );
                break;
            }
            None => break,
            _ => {}
        }
    }

    if let Some((info_hash, peer_id)) = my_info {
        state.remove_peer(&info_hash, &peer_id);
    }

    send_handle.abort();
}

async fn send_loop(mut sink: WsSink, mut rx: mpsc::UnboundedReceiver<String>) {
    while let Some(msg) = rx.recv().await {
        if msg == "__pong__" {
            let _ = sink
                .send(WsMessage::Pong(bytes::Bytes::new()))
                .await;
        } else {
            if sink
                .send(WsMessage::text(msg))
                .await
                .is_err()
            {
                break;
            }
        }
    }
}
