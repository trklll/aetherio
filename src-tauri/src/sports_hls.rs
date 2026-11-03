const RECONNECT: &str = "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_on_http_error=[408,429,500,502,503,504],reconnect_delay_max=2,reconnect_max_retries=2,reconnect_delay_total_max=6";
// Some audited sports CDNs serve real MPEG-TS with web-file suffixes. Keep a
// finite extension list and network-only protocols; never enable this for VOD
// or for arbitrary addons. Brackets quote commas for mpv's key/value parser.
const WEB_SEGMENTS: &str = "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_on_http_error=[408,429,500,502,503,504],reconnect_delay_max=2,reconnect_max_retries=2,reconnect_delay_total_max=6,allowed_extensions=[m3u8,ts,m4s,mp4,aac,js,png],allowed_segment_extensions=[ts,m4s,mp4,aac,js,png],extension_picky=0,protocol_whitelist=[http,https,tcp,tls,crypto]";

pub fn stream_options(live: bool) -> Option<&'static str> {
    live.then_some(RECONNECT)
}

pub fn demuxer_options(target: &str, live: bool) -> Option<&'static str> {
    if !live {
        return None;
    }
    let audited = target.split_once("://").is_some_and(|(scheme, rest)| {
        if !scheme.eq_ignore_ascii_case("https") {
            return false;
        }
        let Some((host, tail)) = rest.split_once('/') else { return false };
        let path = tail.split(['?', '#']).next().unwrap_or_default();
        match host.to_ascii_lowercase().as_str() {
            "sportsbite.org" => ["tlive/", "lol/", "rs/", "sk/"].iter().any(|prefix| path.starts_with(prefix)),
            "strmfree.st" | "streamfree.top" => {
                ["live/", "live-cdn/", "live-externalcdn/"].iter().any(|prefix| path.starts_with(prefix))
                    && path.ends_with("/index.m3u8")
            }
            _ => false,
        }
    });
    Some(if audited { WEB_SEGMENTS } else { RECONNECT })
}
