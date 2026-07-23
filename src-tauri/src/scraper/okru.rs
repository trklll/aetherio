use super::generic::StreamCandidate;
use super::http::DEFAULT_USER_AGENT;
use reqwest::{header::REFERER, Client, Url};
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio::time::timeout;

const OK_ORIGIN: &str = "https://ok.ru";
const OK_SEARCH_URL: &str = "https://ok.ru/video/search?st.cmd=video&st.psft=showcase&st.m=SEARCH&st.ft=search&st.fuvh=on&st.furl=%2Fvideo%2Fshowcase&cmd=VideoContentBlock";
const MAX_SEARCH_RESULTS: usize = 6;
const MAX_CONCURRENT_RESOLVES: usize = 3;
const EMBED_RESOLVE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct SearchPayload {
    videos: Option<SearchVideos>,
}

#[derive(Debug, Deserialize)]
struct SearchVideos {
    list: Option<Vec<SearchItem>>,
}

#[derive(Debug, Deserialize)]
struct SearchItem {
    name: Option<String>,
    movie: Option<SearchMovie>,
}

#[derive(Debug, Deserialize)]
struct SearchMovie {
    id: Option<String>,
    title: Option<String>,
}

#[derive(Debug)]
pub struct OkruResolvedStream {
    pub title: String,
    pub embed_url: String,
    pub stream: StreamCandidate,
}

#[derive(Debug)]
struct ResolveAttempt {
    index: usize,
    title: String,
    embed_url: String,
    result: Result<Vec<StreamCandidate>, String>,
}

pub fn is_okru_url(value: &str) -> bool {
    Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|host| host == "ok.ru" || host.ends_with(".ok.ru"))
}

fn quality_label(name: &str) -> Option<String> {
    let normalized = name.trim().to_ascii_lowercase();
    let value = match normalized.as_str() {
        "mobile" | "144" | "144p" => "144p",
        "lowest" | "240" | "240p" => "240p",
        "low" | "360" | "360p" => "360p",
        "sd" | "480" | "480p" => "480p",
        "hd" | "720" | "720p" => "720p",
        "full" | "fullhd" | "1080" | "1080p" => "1080p",
        "quad" | "1440" | "1440p" => "1440p",
        "ultra" | "4k" | "2160" | "2160p" => "4K",
        _ if !normalized.is_empty() => return Some(name.trim().to_string()),
        _ => return None,
    };
    Some(value.to_string())
}

fn metadata_from_options(options: &Value) -> Option<Value> {
    let metadata = options
        .pointer("/flashvars/metadata")
        .or_else(|| options.get("metadata"))?;
    match metadata {
        Value::String(encoded) => serde_json::from_str(encoded).ok(),
        Value::Object(_) => Some(metadata.clone()),
        _ => None,
    }
}

fn candidates_from_metadata(metadata: &Value, referer: &str) -> Vec<StreamCandidate> {
    let headers = HashMap::from([
        ("Referer".to_string(), referer.to_string()),
        ("Origin".to_string(), OK_ORIGIN.to_string()),
        ("User-Agent".to_string(), DEFAULT_USER_AGENT.to_string()),
    ]);
    metadata
        .get("videos")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|video| {
            let url = video.get("url")?.as_str()?.trim();
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return None;
            }
            let name = video.get("name").and_then(Value::as_str).unwrap_or("OK.ru");
            Some(StreamCandidate {
                url: url.to_string(),
                quality: quality_label(name),
                language: None,
                source: "okru".to_string(),
                headers: Some(headers.clone()),
            })
        })
        .collect()
}

pub fn extract_streams(html: &str, referer: &str) -> Vec<StreamCandidate> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("[data-options]").expect("valid OK.ru selector");
    for element in document.select(&selector) {
        let Some(raw_options) = element.value().attr("data-options") else {
            continue;
        };
        let Ok(options) = serde_json::from_str::<Value>(raw_options) else {
            continue;
        };
        if let Some(metadata) = metadata_from_options(&options) {
            let streams = candidates_from_metadata(&metadata, referer);
            if !streams.is_empty() {
                return streams;
            }
        }
    }

    // Some OK.ru responses expose the same object directly in a script block.
    let marker = r#"\"metadata\":\""#;
    if let Some(start) = html.find(marker) {
        let encoded = &html[start + marker.len()..];
        if let Ok(Value::String(metadata_text)) = serde_json::from_str::<Value>(&format!(
            "\"{}\"",
            encoded.split("\",\"").next().unwrap_or_default()
        )) {
            if let Ok(metadata) = serde_json::from_str::<Value>(&metadata_text) {
                return candidates_from_metadata(&metadata, referer);
            }
        }
    }
    Vec::new()
}

pub async fn resolve(client: &Client, url: &str) -> Result<Vec<StreamCandidate>, String> {
    let response = client
        .get(url)
        .header(REFERER, OK_ORIGIN)
        .send()
        .await
        .map_err(|error| format!("OK.ru request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("OK.ru response failed: {error}"))?;
    let final_url = response.url().to_string();
    let html = response
        .text()
        .await
        .map_err(|error| format!("OK.ru response could not be read: {error}"))?;
    let streams = extract_streams(&html, &final_url);
    if streams.is_empty() {
        Err("OK.ru did not expose playable video variants".to_string())
    } else {
        Ok(streams)
    }
}

fn normalized_search_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            value if value.is_alphanumeric() => value,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_search_results(html: &str, query: &str) -> Vec<(String, String)> {
    let document = Html::parse_document(html);
    let selector =
        Selector::parse("video-search-result[data-props]").expect("valid OK.ru search selector");
    let mut seen = HashSet::new();
    let normalized_query = normalized_search_text(query);
    document
        .select(&selector)
        .filter_map(|element| element.value().attr("data-props"))
        .filter_map(|value| serde_json::from_str::<SearchPayload>(value).ok())
        .flat_map(|payload| {
            payload
                .videos
                .and_then(|videos| videos.list)
                .unwrap_or_default()
        })
        .filter_map(|item| {
            let movie = item.movie?;
            let id = movie.id?.trim().to_string();
            if id.is_empty() || !id.chars().all(|character| character.is_ascii_digit()) {
                return None;
            }
            let title = movie
                .title
                .or(item.name)
                .filter(|value| !value.trim().is_empty())?;
            if !normalized_search_text(&title).contains(&normalized_query) {
                return None;
            }
            seen.insert(id.clone()).then_some((id, title))
        })
        .take(MAX_SEARCH_RESULTS)
        .collect()
}

fn quality_rank(quality: Option<&str>) -> u8 {
    match quality {
        Some("4K") => 8,
        Some("1440p") => 7,
        Some("1080p") => 6,
        Some("720p") => 5,
        Some("480p") => 4,
        Some("360p") => 3,
        Some("240p") => 2,
        Some("144p") => 1,
        _ => 0,
    }
}

fn finish_resolve_attempts(
    mut attempts: Vec<ResolveAttempt>,
    search_result_count: usize,
) -> Result<Vec<OkruResolvedStream>, String> {
    attempts.sort_by_key(|attempt| attempt.index);

    let mut resolved = Vec::new();
    let mut failures = Vec::new();
    for attempt in attempts {
        match attempt.result {
            Ok(streams) => {
                let best = streams
                    .into_iter()
                    .max_by_key(|stream| quality_rank(stream.quality.as_deref()));
                match best {
                    Some(stream) => resolved.push(OkruResolvedStream {
                        title: attempt.title,
                        embed_url: attempt.embed_url,
                        stream,
                    }),
                    None => failures.push(format!("{}: no playable variants", attempt.title)),
                }
            }
            Err(error) => failures.push(format!("{}: {error}", attempt.title)),
        }
    }

    if resolved.is_empty() {
        let details = if failures.is_empty() {
            "no resolver task completed".to_string()
        } else {
            failures.join("; ")
        };
        return Err(format!(
            "OK.ru could not resolve any of {search_result_count} matching video(s): {details}"
        ));
    }

    if !failures.is_empty() {
        eprintln!(
            "[scraper:okru] resolved {}/{} matching video(s); skipped: {}",
            resolved.len(),
            search_result_count,
            failures.join("; ")
        );
    }
    Ok(resolved)
}

async fn resolve_search_results(
    client: &Client,
    results: Vec<(String, String)>,
) -> Result<Vec<OkruResolvedStream>, String> {
    let search_result_count = results.len();
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_RESOLVES));
    let mut tasks = JoinSet::new();

    for (index, (id, title)) in results.into_iter().enumerate() {
        let client = client.clone();
        let semaphore = Arc::clone(&semaphore);
        let embed_url = format!("{OK_ORIGIN}/videoembed/{id}");
        tasks.spawn(async move {
            let result = match semaphore.acquire_owned().await {
                Ok(_permit) => {
                    match timeout(EMBED_RESOLVE_TIMEOUT, resolve(&client, &embed_url)).await {
                        Ok(result) => result,
                        Err(_) => Err(format!(
                            "embed resolution timed out after {}s",
                            EMBED_RESOLVE_TIMEOUT.as_secs()
                        )),
                    }
                }
                Err(_) => Err("embed resolver concurrency gate closed".to_string()),
            };
            ResolveAttempt {
                index,
                title,
                embed_url,
                result,
            }
        });
    }

    let mut attempts = Vec::with_capacity(search_result_count);
    let mut task_failures = Vec::new();
    while let Some(task_result) = tasks.join_next().await {
        match task_result {
            Ok(attempt) => attempts.push(attempt),
            Err(error) => task_failures.push(format!("resolver task failed: {error}")),
        }
    }

    if attempts.is_empty() && !task_failures.is_empty() {
        return Err(format!(
            "OK.ru could not resolve any of {search_result_count} matching video(s): {}",
            task_failures.join("; ")
        ));
    }
    if !task_failures.is_empty() {
        eprintln!("[scraper:okru] {}", task_failures.join("; "));
    }
    finish_resolve_attempts(attempts, search_result_count)
}

pub async fn search_and_resolve(
    client: &Client,
    query: &str,
) -> Result<Vec<OkruResolvedStream>, String> {
    let html = client
        .post(OK_SEARCH_URL)
        .header(REFERER, format!("{OK_ORIGIN}/video/showcase"))
        .header("X-Requested-With", "XMLHttpRequest")
        .form(&[
            ("st.v.sq", query),
            ("gwt.requested", "9579ea2eT1774883610506"),
        ])
        .send()
        .await
        .map_err(|error| format!("OK.ru search failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("OK.ru search response failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("OK.ru search response could not be read: {error}"))?;
    let results = parse_search_results(&html, query);
    if results.is_empty() {
        return Err(format!(
            "OK.ru search returned no matching videos for {query:?}"
        ));
    }
    resolve_search_results(client, results).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(url: &str, quality: &str) -> StreamCandidate {
        StreamCandidate {
            url: url.to_string(),
            quality: Some(quality.to_string()),
            language: None,
            source: "okru".to_string(),
            headers: None,
        }
    }

    #[test]
    fn recognizes_okru_hosts_only() {
        assert!(is_okru_url("https://ok.ru/videoembed/123"));
        assert!(is_okru_url("https://m.ok.ru/video/123"));
        assert!(!is_okru_url("https://not-ok.ru/video/123"));
    }

    #[test]
    fn extracts_variants_and_playback_headers() {
        let metadata = serde_json::json!({
            "videos": [
                { "name": "hd", "url": "https://vd123.okcdn.ru/video.mp4?sig=1" },
                { "name": "full", "url": "https://vd123.okcdn.ru/video-1080.mp4?sig=2" }
            ]
        });
        let options = serde_json::json!({ "flashvars": { "metadata": metadata.to_string() } });
        let html = format!(r#"<div data-options='{}'></div>"#, options);
        let streams = extract_streams(&html, "https://ok.ru/videoembed/123");
        assert_eq!(streams.len(), 2);
        assert_eq!(streams[0].quality.as_deref(), Some("720p"));
        assert_eq!(streams[1].quality.as_deref(), Some("1080p"));
        assert_eq!(
            streams[0]
                .headers
                .as_ref()
                .and_then(|headers| headers.get("Origin"))
                .map(String::as_str),
            Some("https://ok.ru")
        );
        assert_eq!(
            streams[0]
                .headers
                .as_ref()
                .and_then(|headers| headers.get("User-Agent"))
                .map(String::as_str),
            Some(DEFAULT_USER_AGENT)
        );
    }

    #[test]
    fn extracts_html_encoded_data_options() {
        let html = r#"<div data-options="{&quot;flashvars&quot;:{&quot;metadata&quot;:&quot;{\&quot;videos\&quot;:[{\&quot;name\&quot;:\&quot;sd\&quot;,\&quot;url\&quot;:\&quot;https://vd.okcdn.ru/v.mp4\&quot;}]}&quot;}}"></div>"#;
        let streams = extract_streams(html, "https://ok.ru/videoembed/456");
        assert_eq!(streams.len(), 1);
        assert_eq!(streams[0].quality.as_deref(), Some("480p"));
    }

    #[test]
    fn parses_okru_search_component() {
        let payload = serde_json::json!({
            "videos": { "list": [
                { "name": "Los siete samuráis (1954)", "movie": { "id": "3697464052307", "title": "Los siete samuráis (1954)" } },
                { "name": "Sin ID", "movie": { "title": "Sin ID" } }
            ] }
        });
        let html = format!(
            r#"<video-search-result data-props='{}'></video-search-result>"#,
            payload
        );
        assert_eq!(
            parse_search_results(&html, "Los siete samurais"),
            vec![(
                "3697464052307".to_string(),
                "Los siete samuráis (1954)".to_string()
            )]
        );
    }

    #[test]
    fn resolution_results_keep_search_order_and_best_quality() {
        let resolved = finish_resolve_attempts(
            vec![
                ResolveAttempt {
                    index: 1,
                    title: "Second result".to_string(),
                    embed_url: "https://ok.ru/videoembed/2".to_string(),
                    result: Ok(vec![candidate("https://cdn/second.mp4", "720p")]),
                },
                ResolveAttempt {
                    index: 2,
                    title: "Broken result".to_string(),
                    embed_url: "https://ok.ru/videoembed/3".to_string(),
                    result: Err("HTTP 500".to_string()),
                },
                ResolveAttempt {
                    index: 0,
                    title: "First result".to_string(),
                    embed_url: "https://ok.ru/videoembed/1".to_string(),
                    result: Ok(vec![
                        candidate("https://cdn/first-480.mp4", "480p"),
                        candidate("https://cdn/first-1080.mp4", "1080p"),
                    ]),
                },
            ],
            3,
        )
        .unwrap();

        assert_eq!(resolved.len(), 2);
        assert_eq!(resolved[0].title, "First result");
        assert_eq!(resolved[0].stream.quality.as_deref(), Some("1080p"));
        assert_eq!(resolved[1].title, "Second result");
    }

    #[test]
    fn all_resolution_failures_return_actionable_error() {
        let error = finish_resolve_attempts(
            vec![
                ResolveAttempt {
                    index: 0,
                    title: "First result".to_string(),
                    embed_url: "https://ok.ru/videoembed/1".to_string(),
                    result: Err("request timed out".to_string()),
                },
                ResolveAttempt {
                    index: 1,
                    title: "Second result".to_string(),
                    embed_url: "https://ok.ru/videoembed/2".to_string(),
                    result: Ok(Vec::new()),
                },
            ],
            2,
        )
        .unwrap_err();

        assert!(error.contains("could not resolve any of 2"));
        assert!(error.contains("First result: request timed out"));
        assert!(error.contains("Second result: no playable variants"));
    }

    #[tokio::test]
    #[ignore = "requires the live OK.ru provider"]
    async fn finds_live_seven_samurai_streams() {
        let client = crate::scraper::http::build_scraper_client().unwrap();
        let streams = search_and_resolve(&client, "Los siete samuráis")
            .await
            .unwrap();
        assert!(!streams.is_empty());
        assert!(streams
            .iter()
            .all(|stream| stream.stream.url.starts_with("http")));
        assert!(streams
            .iter()
            .any(|stream| { stream.title.to_ascii_lowercase().contains("samur") }));
        let candidate = &streams[0].stream;
        let mut request = client
            .get(&candidate.url)
            .header(reqwest::header::RANGE, "bytes=0-1023");
        for (name, value) in candidate.headers.as_ref().into_iter().flatten() {
            request = request.header(name, value);
        }
        let response = request.send().await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert!(response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("video/")));
    }
}
