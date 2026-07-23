use std::time::Instant;

use dashmap::DashMap;
use str0m::change::SdpOffer;

#[derive(Clone)]
pub struct WebRtcPeer {
    pub peer_id: String,
    pub info_hash: String,
}

impl WebRtcPeer {
    pub fn new(peer_id: &str, info_hash: &str) -> Self {
        Self {
            peer_id: peer_id.to_string(),
            info_hash: info_hash.to_string(),
        }
    }

    pub fn create_offer(&self) -> Result<String, String> {
        let mut rtc = str0m::Rtc::new(Instant::now());
        let mut change = rtc.sdp_api();
        change.add_channel("chunks".to_string());
        let (offer, _pending) = change
            .apply()
            .ok_or_else(|| "str0m apply fallo: no changes".to_string())?;
        Ok(offer.to_sdp_string())
    }

    pub fn accept_answer(&self, _sdp: &str) -> Result<(), String> {
        Err("accept_answer: run loop no implementado".to_string())
    }

    pub fn set_remote_offer(&self, sdp: &str) -> Result<String, String> {
        let offer =
            SdpOffer::from_sdp_string(sdp).map_err(|e| format!("SDP offer invalido: {}", e))?;
        let mut rtc = str0m::Rtc::new(Instant::now());
        let answer = rtc
            .sdp_api()
            .accept_offer(offer)
            .map_err(|e| format!("str0m accept_offer fallo: {}", e))?;
        Ok(answer.to_sdp_string())
    }
}

pub struct WebRtcRegistry {
    peers: DashMap<String, WebRtcPeer>,
}

impl WebRtcRegistry {
    pub fn new() -> Self {
        Self {
            peers: DashMap::new(),
        }
    }

    pub fn register(&self, peer_id: &str, peer: WebRtcPeer) {
        self.peers.insert(peer_id.to_string(), peer);
    }

    pub fn get(&self, peer_id: &str) -> Option<WebRtcPeer> {
        self.peers.get(peer_id).map(|p| p.clone())
    }

    pub fn remove(&self, peer_id: &str) {
        self.peers.remove(peer_id);
    }

    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }
}
