use super::generic::StreamCandidate;
use regex::Regex;
use reqwest::Client;
use std::collections::HashMap;

const ANIMEAV1_BASE: &str = "https://animeav1.com";
const ZILLA_REFERER: &str = "https://player.zilla-networks.com/";

#[derive(Debug)]
struct EmbedInfo {
    server: String,
    url: String,
}

fn extract_first_slug_from_search(json_text: &str) -> Option<String> {
    // AnimeAV1 returns a Remix "devalued" payload where the search results node
    // contains a flat array of primitives plus index references like `"slug":7`
    // (meaning: read the string at data[1][7]). We isolate the search node and
    // pick the first anime-looking slug string we find inside it.
    let search_node = json_text
        .split(r#""results""#)
        .nth(1)?;
    // Cut the node body at the next top-level "uses" or end so we don't pick
    // slugs from unrelated nodes (genres/catalog categories).
    let body = match search_node.find(r#""uses""#) {
        Some(end) => &search_node[..end],
        None => search_node,
    };

    let slug_re = Regex::new(r#""([a-z0-9][a-z0-9\-]{2,})""#).ok()?;
    let mut best: Option<String> = None;
    for cap in slug_re.captures_iter(body) {
        let slug = cap.get(1)?.as_str().to_string();
        if slug.len() < 4 {
            continue;
        }
        if !slug.contains('-') {
            continue;
        }
        if slug.contains('/') || slug.contains('.') {
            continue;
        }
        // Skip known generic / catalog slugs.
        const SKIP: &[&str] = &[
            "tv-anime",
            "pelicula",
            "ova",
            "especial",
            "ciencia-ficcion",
            "recuentos-de-la-vida",
            "elenco-adulto",
            "idols-hombre",
            "idols-mujer",
            "juegos-estrategia",
            "mahou-shoujo",
            "shoujo-ai",
            "shounen-ai",
        ];
        if SKIP.contains(&slug.as_str()) {
            continue;
        }
        // Skip "page" / order / pagination-looking slugs.
        if slug.starts_with("page") || slug == "default" {
            continue;
        }
        best = Some(slug);
        break;
    }
    best
}

fn extract_embeds_from_html(html: &str) -> Vec<EmbedInfo> {
    let mut embeds = Vec::new();

    let embed_block_re = Regex::new(r#"embeds\s*:\s*\{"#).unwrap();
    if let Some(m) = embed_block_re.find(html) {
        let start = m.end() - 1;
        if let Some(end) = find_balanced_brace(html, start) {
            let block = &html[start..=end];
            let entry_re =
                Regex::new(r#"\{[^{}]*server\s*:\s*"([^"]+)"[^{}]*url\s*:\s*"([^"]+)"[^{}]*\}"#)
                    .unwrap();
            for cap in entry_re.captures_iter(block) {
                if let (Some(server), Some(url)) = (cap.get(1), cap.get(2)) {
                    embeds.push(EmbedInfo {
                        server: server.as_str().to_string(),
                        url: url.as_str().to_string(),
                    });
                }
            }
        }
    }

    embeds
}

fn find_balanced_brace(text: &str, open_pos: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    if bytes.get(open_pos)? != &b'{' {
        return None;
    }
    let mut depth = 1u32;
    let mut in_string = false;
    let mut escape_next = false;
    for i in (open_pos + 1)..bytes.len() {
        let ch = bytes[i] as char;
        if escape_next {
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn resolve_zilla_hls(play_url: &str) -> Option<String> {
    let id = play_url.strip_prefix("https://player.zilla-networks.com/play/")?;
    Some(format!("https://player.zilla-networks.com/m3u8/{id}"))
}

pub async fn search_and_resolve(
    client: &Client,
    query: &str,
    _season: Option<u32>,
    episode: Option<u32>,
) -> Result<Vec<StreamCandidate>, String> {
    let encoded_query = urlencoding::encode(query);
    let search_url = format!("{ANIMEAV1_BASE}/catalogo/__data.json?page=1&search={encoded_query}");

    let search_text = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("AnimeAV1 search request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("AnimeAV1 search response failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("AnimeAV1 search text read failed: {e}"))?;

    let slug = extract_first_slug_from_search(&search_text)
        .ok_or_else(|| "AnimeAV1: no search results found".to_string())?;

    let target_episode_num = episode.unwrap_or(1);
    let ep_url = format!("{ANIMEAV1_BASE}/media/{slug}/{target_episode_num}");

    let ep_html = client
        .get(&ep_url)
        .send()
        .await
        .map_err(|e| format!("AnimeAV1 episode page request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("AnimeAV1 episode page response failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("AnimeAV1 episode page read failed: {e}"))?;

    let embeds = extract_embeds_from_html(&ep_html);

    let mut candidates = Vec::new();
    let mut headers = HashMap::new();
    headers.insert("Referer".to_string(), ZILLA_REFERER.to_string());

    for embed in &embeds {
        if embed.server == "HLS" {
            if let Some(m3u8_url) = resolve_zilla_hls(&embed.url) {
                candidates.push(StreamCandidate {
                    url: m3u8_url,
                    quality: None,
                    language: None,
                    source: "animeav1".to_string(),
                    headers: Some(headers.clone()),
                });
            }
        } else {
            candidates.push(StreamCandidate {
                url: embed.url.clone(),
                quality: None,
                language: None,
                source: "animeav1".to_string(),
                headers: Some(headers.clone()),
            });
        }
    }

    if candidates.is_empty() {
        return Err("AnimeAV1: no embeds found on episode page".to_string());
    }

    Ok(candidates)
}

pub fn build_search_url(query: &str) -> String {
    let encoded = urlencoding::encode(query);
    format!("{ANIMEAV1_BASE}/catalogo?search={encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_zilla_hls_extracts_m3u8_url() {
        let result = resolve_zilla_hls("https://player.zilla-networks.com/play/abc123");
        assert_eq!(
            result,
            Some("https://player.zilla-networks.com/m3u8/abc123".to_string())
        );
    }

    #[test]
    fn resolve_zilla_hls_returns_none_for_invalid_url() {
        assert!(resolve_zilla_hls("https://example.com/video").is_none());
    }

    #[test]
    fn build_search_url_encodes_query() {
        let url = build_search_url("Sousou no Frieren");
        assert_eq!(
            url,
            "https://animeav1.com/catalogo?search=Sousou%20no%20Frieren"
        );
    }

    #[test]
    fn extract_first_slug_from_search_finds_best_slug() {
        // Mirrors the real AnimeAV1 Remix "devalued" payload shape.
        let json = r#"{"type":"data","nodes":[null,{"type":"data","data":[{"user":1},null],"uses":{"dependencies":["https://animeav1.com/auth"]}},{"type":"data","data":[{"results":1,"total":16,"categoriesIdsMap":17,"genresIdsMap":29},[2,11],{"id":3,"title":4,"synopsis":5,"categoryId":6,"slug":7,"category":8},"3560","Sousou no Frieren 2nd Season","Tras el Examen...",1,"sousou-no-frieren-2nd-season",{"id":6,"name":9,"slug":10,"malId":6},"TV Anime","tv-anime",{"id":12,"title":13,"synopsis":14,"categoryId":6,"slug":15,"category":8},"159","Sousou no Frieren","Durante su busqueda...","sousou-no-frieren"],"uses":{"search_params":["page"]}}]}"#;
        let slug = extract_first_slug_from_search(json);
        assert_eq!(slug, Some("sousou-no-frieren-2nd-season".to_string()));
    }

    #[test]
    fn extract_first_slug_skips_category_slugs() {
        // Genres/categories appear after the results node — they must be ignored.
        let json = r#""results":1,"total":2},"sousou-no-frieren",{"slug":33},"Acción",0,"accion",{"id":16,"name":35,"type":32,"slug":36,"malId":16},"Aventura","aventura","uses":{"search_params":["page"]}}"#;
        let slug = extract_first_slug_from_search(json);
        assert_eq!(slug, Some("sousou-no-frieren".to_string()));
    }

    #[test]
    fn extract_first_slug_returns_none_without_results_node() {
        let json = r#"{"type":"data","nodes":[null]}"#;
        let slug = extract_first_slug_from_search(json);
        assert!(slug.is_none());
    }

    #[test]
    fn extract_embeds_from_html_finds_hls() {
        let html = r#"embeds:{SUB:[{server:"HLS",url:"https://player.zilla-networks.com/play/abc123"}],DUB:[{server:"Mega",url:"https://mega.nz/embed/xyz"}]}"#;
        let embeds = extract_embeds_from_html(html);
        assert_eq!(embeds.len(), 2);
        assert_eq!(embeds[0].server, "HLS");
        assert_eq!(
            embeds[0].url,
            "https://player.zilla-networks.com/play/abc123"
        );
    }

    #[test]
    fn extract_embeds_returns_empty_for_no_match() {
        let html = r#"<html><body>No embeds here</body></html>"#;
        let embeds = extract_embeds_from_html(html);
        assert!(embeds.is_empty());
    }

    #[test]
    fn find_balanced_brace_works() {
        let text = r#"embeds:{SUB:[{server:"HLS"}],DUB:[{server:"Mega"}]}"#;
        let start = text.find('{').unwrap();
        let end = find_balanced_brace(text, start);
        assert!(end.is_some());
        let end = end.unwrap();
        assert_eq!(&text[end..], "}");
    }

    #[tokio::test]
    #[ignore = "requires the live AnimeAV1 provider"]
    async fn resolves_live_animeav1_stream() {
        let client = crate::scraper::http::build_scraper_client().unwrap();
        let streams = search_and_resolve(&client, "Frieren", None, Some(1))
            .await
            .unwrap();
        assert!(!streams.is_empty());
        assert!(streams
            .iter()
            .any(|s| s.url.contains("zilla-networks.com/m3u8")));
    }
}
