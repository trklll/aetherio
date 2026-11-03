#[path = "../src/sports_hls.rs"]
mod sports_hls;

#[test]
fn never_changes_vod_or_unknown_provider_demuxers() {
    assert_eq!(sports_hls::demuxer_options("https://sportsbite.org/tlive/a", false), None);
    let options = sports_hls::demuxer_options("https://cdn.example.com/live/a.m3u8", true).unwrap();
    assert!(options.contains("reconnect=1"));
    assert!(!options.contains("extension_picky"));
}

#[test]
fn scopes_web_segment_compatibility_to_audited_https_live_paths() {
    for url in ["https://sportsbite.org/tlive/a?v=high", "https://sportsbite.org/lol/123", "https://strmfree.st/live-cdn/a/index.m3u8?_t=example", "https://streamfree.top/live/a/index.m3u8"] {
        let options = sports_hls::demuxer_options(url, true).unwrap();
        assert!(options.contains("extension_picky=0"));
        assert!(options.contains("allowed_segment_extensions=["));
        assert!(options.contains("protocol_whitelist=[http,https,tcp,tls,crypto]"));
        assert!(!options.contains("=ALL"));
    }
}

#[test]
fn host_substrings_credentials_and_unrelated_paths_do_not_enable_compatibility() {
    for url in ["http://sportsbite.org/tlive/a", "https://sportsbite.org.evil.test/tlive/a", "https://sportsbite.org@evil.test/tlive/a", "https://sportsbite.org/admin", "https://strmfree.st/embed/a", "https://evil.test/?https://sportsbite.org/tlive/a"] {
        assert!(!sports_hls::demuxer_options(url, true).unwrap().contains("extension_picky"));
    }
}

#[test]
fn retries_transient_http_failures_with_a_finite_budget_not_missing_channels() {
    let options = sports_hls::demuxer_options("http://50.7.120.34:8080/DAZN1/index.m3u8", true).unwrap();
    assert!(options.contains("reconnect_on_network_error=1"));
    assert!(options.contains("reconnect_on_http_error=[408,429,500,502,503,504]"));
    assert!(options.contains("reconnect_max_retries=2"));
    assert!(options.contains("reconnect_delay_total_max=6"));
    assert!(!options.contains("reconnect_at_eof=1"));
    assert!(!options.contains("404"));
    // Initial manifest requests use the stream layer; demuxer options alone
    // only cover requests made after the demuxer has opened.
    assert_eq!(sports_hls::stream_options(true), Some(options));
    assert_eq!(sports_hls::stream_options(false), None);
}
