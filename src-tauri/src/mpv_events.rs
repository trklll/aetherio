/// End-file carries its reason/error in event.data, NOT mpv_event.error.
pub fn end_reason_name(reason: i32) -> &'static str {
    match reason {
        0 => "eof",
        2 => "stop",
        3 => "quit",
        4 => "error",
        5 => "redirect",
        _ => "unknown",
    }
}

/// Extract only a numeric HTTP code: log lines can contain signed URLs.
pub fn http_status_from_log(message: &str) -> Option<u16> {
    for prefix in ["HTTP error ", "Server returned "] {
        if let Some((_, suffix)) = message.split_once(prefix) {
            let code = suffix.split_whitespace().next()?;
            if code.len() == 3 && code.bytes().all(|byte| byte.is_ascii_digit()) {
                let code: u16 = code.parse().ok()?;
                if (400..600).contains(&code) { return Some(code); }
            }
        }
    }
    None
}
