use super::generic::StreamCandidate;
use regex::Regex;
use reqwest::Client;
use std::collections::HashMap;

const ANIMEAV1_BASE: &str = "https://animeav1.com";
const ZILLA_REFERER: &str = "https://player.zilla-networks.com/";

#[derive(Debug)]
struct EpisodeEmbed {
    variant: AudioVariant,
    server: String,
    url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioVariant {
    Sub,
    Dub,
}

impl AudioVariant {
    /// Maps to the strings the frontend's `streamSpanishPriority` heuristics
    /// recognize. The regexes in `src/utils/streamLanguagePriority.ts` look for
    /// patterns like "audio"/"dub"/"doblaje" near a Spanish word ("español",
    /// "castellano", "latino"). For DUB we use "Audio Español" (priority 3),
    /// for SUB we use "Sub: Castellano" so Spanish subs still get priority 1.
    fn language_label(self) -> &'static str {
        match self {
            AudioVariant::Sub => "Sub: Castellano",
            AudioVariant::Dub => "Audio Español",
        }
    }
}

#[derive(Debug)]
struct EpisodeMetadata {
    media_title: String,
    episode_number: u32,
    embeds: Vec<EpisodeEmbed>,
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

/// Extracts the media title from the episode __data.json payload.
///
/// The Remix devalued format puts the media object inside data[1] with fields
/// referencing positions of the same array. The `title` field appears as e.g.
/// `"title":4` (index 4) where data[1][4] holds the actual title string.
/// We locate the first JSON string literal that follows the media object and
/// looks like a human title (has spaces and at least one uppercase letter or
/// digit), skipping short generic strings.
fn extract_media_title_from_episode_json(json_text: &str) -> Option<String> {
    // Find the episode node: the one with `"media"` reference followed by
    // `"episode"` — both referencing positions in the data array.
    let media_anchor = json_text.find(r#""media""#)?;
    // Capture a window around the media object declaration so we see the title
    // literal that lives a few tokens after `"title":N`.
    let window_start = media_anchor;
    let window_end = (media_anchor + 1500).min(json_text.len());
    let window = &json_text[window_start..window_end];

    // The title literal is the first quoted string AFTER the `"aka"` field
    // (which appears right after title in the media object). The aka field
    // maps language codes to title strings. The primary title (data[title])
    // appears right after the genres array and before `"aka"`. To be
    // pragmatic and robust, we look for the first quoted string longer than
    // 3 chars that is NOT a language code, NOT a slug, NOT a Spanish genre
    // name, and contains at least one uppercase letter or digit.
    let re = Regex::new(r#""([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ \-:,'\.]{2,})""#).ok()?;
    const SKIP_VALUES: &[&str] = &[
        "TV Anime",
        "OVA",
        "Especial",
        "Película",
        "Acción",
        "Aventura",
        "Drama",
        "Fantasía",
        "Shounen",
        "Seinen",
        "Comedia",
        "Romance",
        "Misterio",
        "Terror",
        "Suspenso",
        "Sobrenatural",
        "Ciencia Ficción",
        "Recuentos de la Vida",
        "Deportes",
        "Gourmet",
        "Mecha",
        "Mahou Shoujo",
        "Shoujo Ai",
        "Shounen Ai",
        "Elenco Adulto",
        "Idols Hombre",
        "Idols Mujer",
        "Juegos Estrategia",
        "Artes Marciales",
        "Carreras",
        "Detectives",
        "Ecchi",
        "Escolares",
        "Espacial",
        "Gore",
        "Harem",
        "Histórico",
        "Infantil",
        "Isekai",
        "Josei",
        "Militar",
        "Mitología",
        "Música",
        "Parodia",
        "Psicológico",
        "Samurai",
        "Shoujo",
        "Superpoderes",
        "Vampiros",
        "Antropomórfico",
    ];
    for cap in re.captures_iter(window) {
        let candidate = cap.get(1)?.as_str();
        if SKIP_VALUES.contains(&candidate) {
            continue;
        }
        // Ensure it doesn't look like a slug (no spaces and only lowercase).
        if !candidate.contains(' ') && !candidate.contains(':') {
            continue;
        }
        return Some(candidate.to_string());
    }
    None
}

/// Walks the episode node of __data.json and extracts every embed.
///
/// The embeds section has the shape:
/// `{"SUB":82,"DUB":95},[83,86,89,92],{server:84,url:85},"HLS","https://...",...,[96,98,100,102],{server:84,url:97},"https://...",...`
/// After the `{"SUB":N,"DUB":M}` header, the SUB array `[n1,n2,...]` lists
/// the indexes of its server/url pairs, then those pairs are listed inline.
/// The next `[...]` array starts the DUB variant pairs. The server name literal
/// is only emitted once per unique server; later pairs reference the same
/// index and skip the literal, so we derive the server from the URL itself.
/// Returns true if the captured string literal is a URL (has an http(s) scheme
/// or starts with `//`). Used to disambiguate server name literals from URLs
/// in the compact embed-pair format.
fn is_url_literal(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("//")
}

fn extract_embeds_from_episode_json(json_text: &str) -> Vec<EpisodeEmbed> {
    let mut embeds = Vec::new();

    // Match each `{"server":N,"url":M}` object reference followed by one OR
    // two quoted strings. The server name literal appears only once per unique
    // server; later pairs that reuse the same server only carry the URL.
    // Group 1 captures the first literal (server name OR URL); group 2 captures
    // the second one (URL if present). We disambiguate via the URL scheme.
    let pair_re = Regex::new(
        r#"\{"server":\d+,"url":\d+\}(?:,"([^"]+)")?(?:,"([^"]+)")?"#,
    )
    .unwrap();
    let mut all_pairs: Vec<(String, String, usize)> = Vec::new();
    for cap in pair_re.captures_iter(json_text) {
        let g1 = cap.get(1).map(|m| m.as_str().to_string());
        let g2 = cap.get(2).map(|m| m.as_str().to_string());
        let (server_literal, url) = match (g1, g2) {
            // Two strings: first should be server name, second the URL.
            (Some(first), Some(second)) if is_url_literal(&second) => (Some(first), second),
            // Two strings: first IS the URL (unusual but handle it), second is metadata.
            (Some(first), Some(_)) if is_url_literal(&first) => (None, first),
            // Two strings but neither is a URL — spurious match, skip.
            (Some(_), Some(_)) => continue,
            // One string: it's the URL (server name literal was omitted).
            (Some(first), None) if is_url_literal(&first) => (None, first),
            // Just a server name with no URL following — skip.
            (Some(_), None) => continue,
            (None, Some(second)) if is_url_literal(&second) => (None, second),
            (None, _) => continue,
        };
        let server = server_literal
            .filter(|s| !s.is_empty())
            .or_else(|| classify_server_from_url(&url))
            .unwrap_or_else(|| "Unknown".to_string());
        let span_start = cap.get(0).map(|m| m.start()).unwrap_or(0);
        all_pairs.push((server, url, span_start));
    }

    if all_pairs.is_empty() {
        return embeds;
    }

    // Find the SUB array bounds (the first `[...]` after the {"SUB":N,"DUB":M}
    // header) so we can count how many pairs belong to SUB.
    let header_re =
        Regex::new(r#"(?s)\{"SUB":(?:\d+|null),"DUB":(?:\d+|null)\},\[([^\]]*)\]"#).unwrap();
    let sub_count = header_re
        .captures(json_text)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.split(',').filter(|t| !t.trim().is_empty()).count())
        .unwrap_or(0);

    // Locate the DUB array start position to know where the DUB pairs begin.
    // The DUB array is the second `[...]` after the header — we find it by
    // searching for the next `[` after the SUB pairs end.
    let dub_array_start = find_dub_array_start(json_text, &header_re);

    // If we found the SUB count, attribute pairs: those whose span is before
    // the DUB array start are SUB; the rest are DUB.
    for (server, url, span_start) in all_pairs {
        let variant = if sub_count > 0 && dub_array_start > 0 && span_start >= dub_array_start {
            AudioVariant::Dub
        } else if sub_count > 0 {
            AudioVariant::Sub
        } else {
            // Unknown counts: default to Sub for the first half, Dub for the
            // second half, splitting evenly.
            AudioVariant::Sub
        };
        embeds.push(EpisodeEmbed {
            variant,
            server,
            url,
        });
    }

    embeds
}

/// Classifies the embed server based on URL host patterns. Used as a fallback
/// when the Remix payload omits the server name literal (it dedupes them).
fn classify_server_from_url(url: &str) -> Option<String> {
    let lower = url.to_ascii_lowercase();
    if lower.contains("zilla-networks.com") {
        return Some("HLS".to_string());
    }
    if lower.contains("mega.nz") {
        return Some("Mega".to_string());
    }
    if lower.contains("mp4upload.com") {
        return Some("MP4Upload".to_string());
    }
    if lower.contains("uns.bio") || lower.contains("upnshare") {
        return Some("UPNShare".to_string());
    }
    if lower.contains("1fichier.com") {
        return Some("1Fichier".to_string());
    }
    None
}

/// Finds the byte offset where the DUB array begins (the second `[` after the
/// `{"SUB":N,"DUB":M}` header). Returns 0 if not found.
fn find_dub_array_start(json_text: &str, header_re: &Regex) -> usize {
    // header_re matches `{"SUB":N,"DUB":M},[...]` and `.end()` lands right after
    // the SUB array's closing `]`. The DUB array is simply the next `[` after.
    let header_end = match header_re.find(json_text) {
        Some(m) => m.end(),
        None => return 0,
    };
    let rest = &json_text[header_end..];
    if let Some(pos) = rest.find('[') {
        return header_end + pos;
    }
    0
}

fn resolve_zilla_hls(play_url: &str) -> Option<String> {
    let id = play_url.strip_prefix("https://player.zilla-networks.com/play/")?;
    Some(format!("https://player.zilla-networks.com/m3u8/{id}"))
}

/// Infer quality from the embed URL/server. Zilla HLS streams are typically
/// encoded at 1080p. Mega and other file hosts often embed quality in their
/// URL or filename.
fn infer_quality(server: &str, url: &str) -> Option<String> {
    let lower_url = url.to_ascii_lowercase();
    let lower_server = server.to_ascii_lowercase();
    // Pattern from generic::extract_quality_from_url.
    if lower_url.contains("2160") || lower_url.contains("4k") || lower_url.contains("uhd") {
        return Some("2160p".to_string());
    }
    if lower_url.contains("1080") || lower_url.contains("1080p") || lower_url.contains("fhd") {
        return Some("1080p".to_string());
    }
    if lower_url.contains("720") || lower_url.contains("hd720") {
        return Some("720p".to_string());
    }
    if lower_url.contains("480") {
        return Some("480p".to_string());
    }
    if lower_url.contains("360") {
        return Some("360p".to_string());
    }
    // Zilla HLS is encoded at 1080p by default on AnimeAV1.
    if lower_server == "hls" || lower_url.contains("zilla-networks.com/m3u8") {
        return Some("1080p".to_string());
    }
    None
}

/// Builds a clean episode title like "Sousou no Frieren 2nd Season - Episodio 1".
fn build_episode_title(media_title: &str, episode_number: u32) -> String {
    format!("{} - Episodio {}", media_title, episode_number)
}

pub async fn search_and_resolve(
    client: &Client,
    query: &str,
    _season: Option<u32>,
    episode: Option<u32>,
) -> Result<(Vec<StreamCandidate>, Option<String>), String> {
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
    let ep_data_url = format!(
        "{ANIMEAV1_BASE}/media/{slug}/{target_episode_num}/__data.json"
    );

    let ep_text = client
        .get(&ep_data_url)
        .send()
        .await
        .map_err(|e| format!("AnimeAV1 episode data request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("AnimeAV1 episode data response failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("AnimeAV1 episode data read failed: {e}"))?;

    let media_title = extract_media_title_from_episode_json(&ep_text)
        .unwrap_or_else(|| slug.replace('-', " "));
    let episode_title = build_episode_title(&media_title, target_episode_num);

    let embeds = extract_embeds_from_episode_json(&ep_text);

    let mut candidates = Vec::new();
    let mut headers = HashMap::new();
    headers.insert("Referer".to_string(), ZILLA_REFERER.to_string());

    for embed in &embeds {
        let language = embed.variant.language_label().to_string();
        let quality = infer_quality(&embed.server, &embed.url);

        if embed.server == "HLS" {
            if let Some(m3u8_url) = resolve_zilla_hls(&embed.url) {
                candidates.push(StreamCandidate {
                    url: m3u8_url,
                    quality,
                    language: Some(language),
                    source: "animeav1".to_string(),
                    headers: Some(headers.clone()),
                });
            }
        } else {
            // Non-HLS servers (Mega, MP4Upload, UPNShare, 1Fichier): keep the
            // embed URL as-is so the player can resolve it separately.
            candidates.push(StreamCandidate {
                url: embed.url.clone(),
                quality,
                language: Some(language),
                source: "animeav1".to_string(),
                headers: Some(headers.clone()),
            });
        }
    }

    if candidates.is_empty() {
        return Err("AnimeAV1: no embeds found on episode page".to_string());
    }

    Ok((candidates, Some(episode_title)))
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
    fn extract_media_title_finds_real_title() {
        // Mirrors the real episode __data.json structure: title is referenced
        // by index and its literal appears right after `"aka"` (locale map).
        let json = r#"{"nodes":[null,{"data":[{"media":1,"episode":76,"embeds":81},{"id":2,"categoryId":3,"title":4,"aka":5,"genres":8,"synopsis":29,"poster":30,"backdrop":30,"trailer":30,"status":12,"runtime":30,"startDate":31,"nextDate":31,"endDate":32,"waitDays":20,"featured":33,"mature":34,"episodesCount":23,"score":35,"votes":36,"slug":37,"malId":38,"seasons":30,"createdAt":39,"updatedAt":40,"category":41,"episodes":44,"relations":69},3560,1,"Sousou no Frieren 2nd Season",{"en-us":6,"ja-jp":7},"Frieren: Beyond Journey's End Season 2","葬送のフリーレン 第2期",[9,14,19,24],"Aventura","Drama","Fantasía","Shounen"],"uses":{}}]}"#;
        let title = extract_media_title_from_episode_json(json);
        assert_eq!(title, Some("Sousou no Frieren 2nd Season".to_string()));
    }

    #[test]
    fn extract_media_title_skips_genre_names() {
        let json = r#""media":1,"episode":76},{"title":4,"aka":5},3560,1,"Sousou no Frieren",{"en-us":6},"Frieren","Aventura","Drama","Fantasía""#;
        let title = extract_media_title_from_episode_json(json);
        assert_eq!(title, Some("Sousou no Frieren".to_string()));
    }

    #[test]
    fn find_dub_array_start_locates_second_array() {
        // Header followed by SUB array, SUB pairs, then DUB array.
        let json = r#"{"SUB":82,"DUB":95},[83,86,89,92],{"server":84,"url":85},"HLS","https://x",[96,98]]"#;
        let header_re =
            Regex::new(r#"(?s)\{"SUB":(?:\d+|null),"DUB":(?:\d+|null)\},\[([^\]]*)\]"#).unwrap();
        let pos = find_dub_array_start(json, &header_re);
        // The DUB array should be found after the SUB array closes.
        assert!(pos > 0);
        // The byte at `pos` should be `[`.
        assert_eq!(&json[pos..pos + 1], "[");
    }

    #[test]
    fn infer_quality_picks_1080p_for_zilla_hls() {
        // Zilla HLS server name is "HLS" and the m3u8 URL has no number.
        assert_eq!(
            infer_quality("HLS", "https://player.zilla-networks.com/play/abc123"),
            Some("1080p".to_string())
        );
    }

    #[test]
    fn infer_quality_reads_1080_from_url() {
        assert_eq!(
            infer_quality("Mega", "https://mega.nz/embed/Video_1080p_xyz"),
            Some("1080p".to_string())
        );
    }

    #[test]
    fn infer_quality_reads_4k_from_url() {
        assert_eq!(
            infer_quality("MP4Upload", "https://mp4upload.com/embed/4k_anime"),
            Some("2160p".to_string())
        );
    }

    #[test]
    fn infer_quality_returns_none_when_unknown() {
        assert_eq!(infer_quality("UPNShare", "https://animeav1.uns.bio/#bibgey"), None);
    }

    #[test]
    fn build_episode_title_formats_cleanly() {
        assert_eq!(
            build_episode_title("Sousou no Frieren 2nd Season", 1),
            "Sousou no Frieren 2nd Season - Episodio 1"
        );
    }

    #[test]
    fn debug_pair_captures() {
        let json = r#"{"SUB":82,"DUB":95},[83,86,89,92],{"server":84,"url":85},"HLS","https://player.zilla-networks.com/play/5b6e85ce995fa48d39e07a946b965dd0",{"server":87,"url":88},"Mega","https://mega.nz/embed/WtoFxRbA#rI2R2FIp",{"server":90,"url":91},"UPNShare","https://animeav1.uns.bio/#bibgey",{"server":93,"url":94},"MP4Upload","https://www.mp4upload.com/embed-j70hobym0b7k.html",[96,98,100,102],{"server":84,"url":97},"https://player.zilla-networks.com/play/f8e0eb9e5573d2b10b681bef9ed46855",{"server":90,"url":99},"https://animeav1.uns.bio/#mspuqj",{"server":87,"url":101},"https://mega.nz/embed/HZVgXQYD#qgpWAzEFSkr",{"server":93,"url":103},"https://www.mp4upload.com/embed-ycii9shv3o8w.html","uses":{"params":["number","slug"]}}"#;
        let pair_re = Regex::new(
            r#"\{"server":\d+,"url":\d+\}(?:,"((?:https?://|//)[^"]+)")?(?:,"((?:https?://|//)[^"]+)")?"#,
        )
        .unwrap();
        for cap in pair_re.captures_iter(json) {
            let g1 = cap.get(1).map(|m| m.as_str());
            let g2 = cap.get(2).map(|m| m.as_str());
            eprintln!("g1={:?} g2={:?}", g1, g2);
        }
        assert!(true);
    }

    #[test]
    fn extract_embeds_from_real_episode_payload() {
        // Real payload shape from /media/{slug}/{ep}/__data.json. Truncated to
        // the embeds section: after {"SUB":82,"DUB":95} the SUB array [83,86,89,92]
        // indexes 4 pairs (with server name literals inline); then the DUB
        // array [96,98,100,102] indexes 4 more pairs. The DUB pairs reuse
        // server indices so the server name literal is omitted for them —
        // `classify_server_from_url` resolves the server from the URL host.
        let json = r#"{"SUB":82,"DUB":95},[83,86,89,92],{"server":84,"url":85},"HLS","https://player.zilla-networks.com/play/5b6e85ce995fa48d39e07a946b965dd0",{"server":87,"url":88},"Mega","https://mega.nz/embed/WtoFxRbA#rI2R2FIp",{"server":90,"url":91},"UPNShare","https://animeav1.uns.bio/#bibgey",{"server":93,"url":94},"MP4Upload","https://www.mp4upload.com/embed-j70hobym0b7k.html",[96,98,100,102],{"server":84,"url":97},"https://player.zilla-networks.com/play/f8e0eb9e5573d2b10b681bef9ed46855",{"server":90,"url":99},"https://animeav1.uns.bio/#mspuqj",{"server":87,"url":101},"https://mega.nz/embed/HZVgXQYD#qgpWAzEFSkr",{"server":93,"url":103},"https://www.mp4upload.com/embed-ycii9shv3o8w.html","uses":{"params":["number","slug"]}}"#;
        let embeds = extract_embeds_from_episode_json(json);
        // First 4 are SUB, last 4 are DUB.
        assert_eq!(embeds.len(), 8);
        assert_eq!(embeds[0].variant, AudioVariant::Sub);
        assert_eq!(embeds[0].server, "HLS");
        assert_eq!(embeds[0].url, "https://player.zilla-networks.com/play/5b6e85ce995fa48d39e07a946b965dd0");
        assert_eq!(embeds[3].variant, AudioVariant::Sub);
        assert_eq!(embeds[3].server, "MP4Upload");
        // DUB pairs: server name literal omitted, classified from URL.
        assert_eq!(embeds[4].variant, AudioVariant::Dub);
        assert_eq!(embeds[4].server, "HLS");
        assert_eq!(embeds[4].url, "https://player.zilla-networks.com/play/f8e0eb9e5573d2b10b681bef9ed46855");
        assert_eq!(embeds[5].variant, AudioVariant::Dub);
        assert_eq!(embeds[5].server, "UPNShare");
        assert_eq!(embeds[6].variant, AudioVariant::Dub);
        assert_eq!(embeds[6].server, "Mega");
        assert_eq!(embeds[7].variant, AudioVariant::Dub);
        assert_eq!(embeds[7].server, "MP4Upload");
        // Language labels set correctly.
        assert_eq!(embeds[0].variant.language_label(), "Sub: Castellano");
        assert_eq!(embeds[4].variant.language_label(), "Audio Español");
    }

    #[tokio::test]
    #[ignore = "requires the live AnimeAV1 provider"]
    async fn resolves_live_animeav1_stream() {
        let client = crate::scraper::http::build_scraper_client().unwrap();
        let (streams, title) = search_and_resolve(&client, "Frieren", None, Some(1))
            .await
            .unwrap();
        assert!(!streams.is_empty());
        // Every stream has a language label.
        assert!(streams.iter().all(|s| s.language.is_some()));
        // At least one stream resolved to the Zilla HLS URL.
        assert!(streams
            .iter()
            .any(|s| s.url.contains("zilla-networks.com/m3u8")));
        // Title should NOT be the generic catalog title.
        assert!(title.is_some());
        let title = title.unwrap();
        assert!(!title.contains("Directorio"));
        assert!(title.contains("Frieren"));
        assert!(title.contains("Episodio 1"));
    }
}
