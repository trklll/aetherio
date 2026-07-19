use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
pub struct StreamCandidate {
    pub url: String,
    pub quality: Option<String>,
    pub language: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum EmbedType {
    Iframe,
}

pub fn build_search_url(base_url: &str, search_path: &str, query: &str) -> String {
    let slug = query
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    let encoded = urlencoding::encode(query);
    let replacement = if search_path.contains('?') {
        encoded.as_ref()
    } else {
        slug.as_str()
    };
    format!(
        "{}{}",
        base_url,
        search_path.replace("{query}", replacement)
    )
}

pub fn extract_detail_urls(html: &str, base_url: &str, query: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("a[href]").unwrap();
    let query_terms = query
        .split_whitespace()
        .map(normalize_match_text)
        .filter(|term| term.len() >= 2)
        .collect::<Vec<_>>();
    let mut seen = HashSet::new();

    document
        .select(&selector)
        .filter_map(|element| {
            let href = element.value().attr("href")?.trim();
            if href.is_empty()
                || href.starts_with('#')
                || href.starts_with("javascript:")
                || href.contains("/search")
            {
                return None;
            }
            let label = element.text().collect::<Vec<_>>().join(" ");
            let haystack = normalize_match_text(&format!("{href} {label}"));
            if !query_terms.is_empty() && !query_terms.iter().all(|term| haystack.contains(term)) {
                return None;
            }
            let resolved = resolve_relative_url(href, base_url);
            seen.insert(resolved.clone()).then_some(resolved)
        })
        .collect()
}

fn normalize_match_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|char| if char.is_alphanumeric() { char } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn extract_embed_urls(html: &str) -> Vec<(String, EmbedType)> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    let iframe_re = Regex::new(r#"<iframe[^>]+src=["']([^"']+)["']"#).unwrap();
    for cap in iframe_re.captures_iter(html) {
        if let Some(url) = cap.get(1) {
            let url = url.as_str().to_string();
            if !seen.contains(&url) {
                seen.insert(url.clone());
                results.push((url, EmbedType::Iframe));
            }
        }
    }

    let iframe_re2 = Regex::new(r#"src=["']([^"']+)["'][^>]*iframe"#).unwrap();
    for cap in iframe_re2.captures_iter(html) {
        if let Some(url) = cap.get(1) {
            let url = url.as_str().to_string();
            if !seen.contains(&url) {
                seen.insert(url.clone());
                results.push((url, EmbedType::Iframe));
            }
        }
    }

    results
}

pub fn extract_stream_urls(html: &str) -> Vec<StreamCandidate> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    let m3u8_re = Regex::new(r#"(https?://[^"'\s<>]+\.m3u8[^"'\s<>]*)"#).unwrap();
    for cap in m3u8_re.captures_iter(html) {
        if let Some(m) = cap.get(1) {
            let url = clean_stream_url(m.as_str());
            if !seen.contains(&url) && looks_like_valid_stream_url(&url) {
                seen.insert(url.clone());
                let quality = extract_quality_from_url(&url);
                candidates.push(StreamCandidate {
                    url,
                    quality,
                    language: None,
                    source: "m3u8".to_string(),
                });
            }
        }
    }

    let mp4_re = Regex::new(r#"(https?://[^"'\s<>]+\.mp4[^"'\s<>]*)"#).unwrap();
    for cap in mp4_re.captures_iter(html) {
        if let Some(m) = cap.get(1) {
            let url = clean_stream_url(m.as_str());
            if !seen.contains(&url) && looks_like_valid_stream_url(&url) {
                seen.insert(url.clone());
                let quality = extract_quality_from_url(&url);
                candidates.push(StreamCandidate {
                    url,
                    quality,
                    language: None,
                    source: "mp4".to_string(),
                });
            }
        }
    }

    let dash_re = Regex::new(r#"(https?://[^"'\s<>]+\.mpd[^"'\s<>]*)"#).unwrap();
    for cap in dash_re.captures_iter(html) {
        if let Some(m) = cap.get(1) {
            let url = clean_stream_url(m.as_str());
            if !seen.contains(&url) && looks_like_valid_stream_url(&url) {
                seen.insert(url.clone());
                candidates.push(StreamCandidate {
                    url,
                    quality: None,
                    language: None,
                    source: "dash".to_string(),
                });
            }
        }
    }

    let file_re = Regex::new(r#"file\s*[:=]\s*["'](https?://[^"']+)""#).unwrap();
    for cap in file_re.captures_iter(html) {
        if let Some(m) = cap.get(1) {
            let url = clean_stream_url(m.as_str());
            if !seen.contains(&url) && looks_like_valid_stream_url(&url) {
                seen.insert(url.clone());
                let quality = extract_quality_from_url(&url);
                let source = if url.contains(".m3u8") {
                    "m3u8"
                } else if url.contains(".mp4") {
                    "mp4"
                } else {
                    "direct"
                };
                candidates.push(StreamCandidate {
                    url,
                    quality,
                    language: None,
                    source: source.to_string(),
                });
            }
        }
    }

    let source_re = Regex::new(r#"source\s*[:=]\s*["'](https?://[^"']+)""#).unwrap();
    for cap in source_re.captures_iter(html) {
        if let Some(m) = cap.get(1) {
            let url = clean_stream_url(m.as_str());
            if !seen.contains(&url) && looks_like_valid_stream_url(&url) {
                seen.insert(url.clone());
                let quality = extract_quality_from_url(&url);
                candidates.push(StreamCandidate {
                    url,
                    quality,
                    language: None,
                    source: "source".to_string(),
                });
            }
        }
    }

    candidates
}

pub async fn fetch_page(client: &Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed for {}: {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status().as_u16(), url));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read response body from {}: {}", url, e))
}

pub async fn follow_embed_chain(
    client: &Client,
    embed_url: &str,
    max_depth: u32,
) -> Result<Vec<StreamCandidate>, String> {
    let mut all_streams = Vec::new();
    let mut visited = HashSet::new();
    let mut current_url = embed_url.to_string();

    for _ in 0..=max_depth {
        if visited.contains(&current_url) {
            break;
        }
        visited.insert(current_url.clone());

        let html = match fetch_page(client, &current_url).await {
            Ok(html) => html,
            Err(_) => break,
        };

        let streams = extract_stream_urls(&html);
        if !streams.is_empty() {
            all_streams.extend(streams);
            break;
        }

        let embeds = extract_embed_urls(&html);
        if let Some((next_url, _)) = embeds.into_iter().next() {
            let resolved = resolve_relative_url(&next_url, &current_url);
            current_url = resolved;
        } else {
            break;
        }
    }

    Ok(all_streams)
}

pub fn resolve_relative_url(url: &str, base: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }

    if url.starts_with("//") {
        return format!("https:{}", url);
    }

    if let Some(pos) = base.find("://") {
        let scheme_and_host =
            &base[..pos + 3 + base[pos + 3..].find('/').unwrap_or(base.len() - pos - 3)];
        if url.starts_with('/') {
            return format!("{}{}", scheme_and_host, url);
        }
        if let Some(last_slash) = base.rfind('/') {
            let base_dir = &base[..last_slash + 1];
            return format!("{}{}", base_dir, url);
        }
    }

    url.to_string()
}

fn clean_stream_url(url: &str) -> String {
    let cleaned = url
        .replace("\\u002F", "/")
        .replace("\\/", "/")
        .replace("\\u0026", "&")
        .replace("\\&", "&")
        .replace("\\u003F", "?")
        .replace("\\u003D", "=");

    if let Some(pos) = cleaned.find("'") {
        return cleaned[..pos].to_string();
    }
    if let Some(pos) = cleaned.find('"') {
        return cleaned[..pos].to_string();
    }
    if let Some(pos) = cleaned.find('\\') {
        return cleaned[..pos].to_string();
    }

    cleaned
}

fn looks_like_valid_stream_url(url: &str) -> bool {
    if url.len() < 10 {
        return false;
    }
    if url.contains("example.com") || url.contains("placeholder") || url.contains("localhost") {
        return false;
    }
    if url.contains(".css") || url.contains(".js") || url.contains(".png") || url.contains(".jpg") {
        return false;
    }
    true
}

fn extract_quality_from_url(url: &str) -> Option<String> {
    let lower = url.to_lowercase();
    if lower.contains("1080") || lower.contains("1080p") {
        Some("1080p".to_string())
    } else if lower.contains("720") || lower.contains("720p") {
        Some("720p".to_string())
    } else if lower.contains("480") || lower.contains("480p") {
        Some("480p".to_string())
    } else if lower.contains("4k") || lower.contains("2160") {
        Some("4K".to_string())
    } else {
        None
    }
}

#[allow(dead_code)]
pub fn extract_iframes_from_html(html: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("iframe").unwrap();
    document
        .select(&selector)
        .filter_map(|el| el.value().attr("src").map(String::from))
        .collect()
}

#[allow(dead_code)]
pub fn extract_text_between(html: &str, start: &str, end: &str) -> Option<String> {
    let start_pos = html.find(start)? + start.len();
    let remaining = &html[start_pos..];
    let end_pos = remaining.find(end)?;
    Some(remaining[..end_pos].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_search_url_with_slug() {
        let url = build_search_url("https://cineby.at", "/search/{query}", "The Matrix");
        assert_eq!(url, "https://cineby.at/search/the-matrix");
    }

    #[test]
    fn build_search_url_with_special_chars() {
        let url = build_search_url("https://example.com", "/s/{query}", "Breaking Bad");
        assert!(url.contains("breaking-bad"));
        assert!(url.starts_with("https://example.com"));
    }

    #[test]
    fn build_search_url_single_word() {
        let url = build_search_url("https://example.com", "/search/{query}", "Inception");
        assert_eq!(url, "https://example.com/search/inception");
    }

    #[test]
    fn build_search_url_encodes_query_parameters() {
        let url = build_search_url(
            "https://example.com",
            "/search?query={query}",
            "Breaking Bad",
        );
        assert_eq!(url, "https://example.com/search?query=Breaking%20Bad");
    }

    #[test]
    fn extract_detail_urls_matches_link_text_and_deduplicates() {
        let html = r#"
            <a href="/watch/20/naruto">Naruto</a>
            <a href="/watch/20/naruto">Naruto duplicate</a>
            <a href="/watch/1735/naruto-shippuden">Naruto Shippuden</a>
            <a href="/watch/21/boruto">Boruto</a>
        "#;
        let urls = extract_detail_urls(html, "https://miruro.to", "Naruto Shippuden");
        assert_eq!(urls, vec!["https://miruro.to/watch/1735/naruto-shippuden"]);
    }

    #[test]
    fn extract_embed_urls_finds_iframes() {
        let html = r#"<html><body>
            <iframe src="https://embed.example.com/player/123" width="800" height="450"></iframe>
            <p>Some text</p>
            <iframe src="https://other.example.com/embed/456"></iframe>
        </body></html>"#;
        let embeds = extract_embed_urls(html);
        assert_eq!(embeds.len(), 2);
        assert!(embeds
            .iter()
            .any(|(url, _)| url.contains("embed.example.com")));
        assert!(embeds
            .iter()
            .any(|(url, _)| url.contains("other.example.com")));
    }

    #[test]
    fn extract_embed_urls_deduplicates() {
        let html = r#"<iframe src="https://same.example.com/a"></iframe>
            <iframe src="https://same.example.com/a"></iframe>"#;
        let embeds = extract_embed_urls(html);
        assert_eq!(embeds.len(), 1);
    }

    #[test]
    fn extract_embed_urls_returns_empty_for_no_iframes() {
        let html = "<html><body><p>No iframes here</p></body></html>";
        let embeds = extract_embed_urls(html);
        assert!(embeds.is_empty());
    }

    #[test]
    fn extract_stream_urls_finds_m3u8() {
        let html = r#"source: "https://cdn.videosrc.net/video/master.m3u8?token=abc""#;
        let streams = extract_stream_urls(html);
        assert!(!streams.is_empty());
        assert!(streams.iter().any(|s| s.url.contains("master.m3u8")));
    }

    #[test]
    fn extract_stream_urls_finds_mp4() {
        let html = r#"file: "https://storage.videosrc.net/movie.mp4""#;
        let streams = extract_stream_urls(html);
        assert!(!streams.is_empty());
        assert!(streams.iter().any(|s| s.url.contains("movie.mp4")));
    }

    #[test]
    fn extract_stream_urls_finds_m3u8_in_various_formats() {
        let html = r#"
            var url = "https://cdn1.videosrc.net/hls/live.m3u8";
            source: 'https://cdn2.videosrc.net/playlist.m3u8?t=123';
            "https://cdn3.videosrc.net/stream.m3u8"
        "#;
        let streams = extract_stream_urls(html);
        let urls: Vec<&str> = streams.iter().map(|s| s.url.as_str()).collect();
        assert!(urls.iter().any(|u| u.contains("live.m3u8")));
        assert!(urls.iter().any(|u| u.contains("playlist.m3u8")));
        assert!(urls.iter().any(|u| u.contains("stream.m3u8")));
    }

    #[test]
    fn extract_stream_urls_finds_dashed_urls() {
        let html = r#"source: "https://cdn.videosrc.net/video.mpd""#;
        let streams = extract_stream_urls(html);
        assert!(streams.iter().any(|s| s.url.contains("video.mpd")));
    }

    #[test]
    fn extract_stream_urls_ignores_css_js() {
        let html = r#"
            <link href="https://cdn.videosrc.net/style.css" rel="stylesheet">
            <script src="https://cdn.videosrc.net/app.js"></script>
            <img src="https://cdn.videosrc.net/logo.png">
        "#;
        let streams = extract_stream_urls(html);
        assert!(streams.is_empty());
    }

    #[test]
    fn extract_stream_urls_ignores_placeholders() {
        let html = r#"source: "https://example.com/placeholder.m3u8""#;
        let streams = extract_stream_urls(html);
        assert!(streams.is_empty());
    }

    #[test]
    fn extract_quality_from_url_various() {
        assert_eq!(
            extract_quality_from_url("https://x.com/1080p/video.m3u8"),
            Some("1080p".into())
        );
        assert_eq!(
            extract_quality_from_url("https://x.com/720/video.m3u8"),
            Some("720p".into())
        );
        assert_eq!(
            extract_quality_from_url("https://x.com/480/video.m3u8"),
            Some("480p".into())
        );
        assert_eq!(
            extract_quality_from_url("https://x.com/4k/video.m3u8"),
            Some("4K".into())
        );
        assert_eq!(extract_quality_from_url("https://x.com/video.m3u8"), None);
    }

    #[test]
    fn clean_stream_url_removes_unicode_escapes() {
        assert_eq!(
            clean_stream_url("https://cdn.example.com/video.m3u8\\u003Ftoken\\u003Dabc"),
            "https://cdn.example.com/video.m3u8?token=abc"
        );
    }

    #[test]
    fn clean_stream_url_removes_backslash_slash() {
        assert_eq!(
            clean_stream_url("https://cdn.example.com\\/video.m3u8"),
            "https://cdn.example.com/video.m3u8"
        );
    }

    #[test]
    fn resolve_relative_url_full_url() {
        assert_eq!(
            resolve_relative_url("https://other.com/page", "https://base.com/dir/"),
            "https://other.com/page"
        );
    }

    #[test]
    fn resolve_relative_url_double_slash() {
        assert_eq!(
            resolve_relative_url("//cdn.videosrc.net/video.m3u8", "https://base.com/page"),
            "https://cdn.videosrc.net/video.m3u8"
        );
    }

    #[test]
    fn resolve_relative_url_root_path() {
        let result = resolve_relative_url("/player/embed", "https://example.com/dir/page");
        assert_eq!(result, "https://example.com/player/embed");
    }

    #[test]
    fn resolve_relative_url_relative_path() {
        let result = resolve_relative_url("embed.html", "https://example.com/dir/page");
        assert_eq!(result, "https://example.com/dir/embed.html");
    }

    #[test]
    fn looks_like_valid_stream_url_rejects_short() {
        assert!(!looks_like_valid_stream_url("http://x"));
    }

    #[test]
    fn looks_like_valid_stream_url_rejects_placeholders() {
        assert!(!looks_like_valid_stream_url(
            "https://example.com/video.m3u8"
        ));
        assert!(!looks_like_valid_stream_url(
            "https://placeholder.com/video.m3u8"
        ));
        assert!(!looks_like_valid_stream_url("https://localhost/video.m3u8"));
    }

    #[test]
    fn looks_like_valid_stream_url_rejects_static_assets() {
        assert!(!looks_like_valid_stream_url(
            "https://cdn.example.com/style.css"
        ));
        assert!(!looks_like_valid_stream_url(
            "https://cdn.example.com/app.js"
        ));
    }

    #[test]
    fn looks_like_valid_stream_url_accepts_valid() {
        assert!(looks_like_valid_stream_url(
            "https://cdn.videosrc.net/video.m3u8?token=abc"
        ));
        assert!(looks_like_valid_stream_url(
            "https://storage.videosrc.net/movie.mp4"
        ));
    }

    #[test]
    fn extract_iframes_from_html_basic() {
        let html = r#"<iframe src="https://a.com/embed/1"></iframe><iframe src="https://b.com/embed/2"></iframe>"#;
        let iframes = extract_iframes_from_html(html);
        assert_eq!(iframes.len(), 2);
    }

    #[test]
    fn extract_text_between_works() {
        let html = "var x = \"hello world\"; var y = 42;";
        let result = extract_text_between(html, "var x = \"", "\";");
        assert_eq!(result, Some("hello world".to_string()));
    }

    #[test]
    fn extract_text_between_missing_start() {
        assert_eq!(extract_text_between("hello world", "{{", "}}"), None);
    }

    #[test]
    fn extract_text_between_missing_end() {
        assert_eq!(extract_text_between("hello world", "hel", "xyz"), None);
    }
}
