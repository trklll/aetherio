#[path = "../src/mpv_events.rs"]
mod mpv_events;

#[test]
fn distinguishes_normal_stop_redirect_and_actual_failure() {
    assert_eq!(mpv_events::end_reason_name(0), "eof");
    assert_eq!(mpv_events::end_reason_name(2), "stop");
    assert_eq!(mpv_events::end_reason_name(3), "quit");
    assert_eq!(mpv_events::end_reason_name(4), "error");
    assert_eq!(mpv_events::end_reason_name(5), "redirect");
    assert_eq!(mpv_events::end_reason_name(99), "unknown");
}

#[test]
fn extracts_only_numeric_http_status_not_urls_or_secrets() {
    for (line, expected) in [
        ("HTTP error 404 Not Found\n", Some(404)),
        ("Server returned 503 Service Unavailable", Some(503)),
        ("HTTP error 403 Forbidden for https://cdn.test/token/secret", Some(403)),
        ("HTTP error 4040 malformed", None),
        ("Playing https://cdn.test/404/secret", None),
        ("HTTP error 200 OK", None),
    ] {
        assert_eq!(mpv_events::http_status_from_log(line), expected, "{line}");
    }
}
