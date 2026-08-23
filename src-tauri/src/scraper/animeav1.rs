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

#[derive(Debug, Clone, PartialEq)]
struct SearchResult {
    title: String,
    slug: String,
}

/// Parses every media result of the search node. Each result has the shape:
/// `{"id":N,"title":M,"synopsis":K,"categoryId":P,"slug":Q,"category":R},"<id>","<title>","<synopsis>","<slug>"`
/// The `categoryId` literal is emitted only once per distinct value (Remix
/// dedup), so it must be treated as optional and is not used for ranking.
fn extract_search_results(json_text: &str) -> Vec<SearchResult> {
    let search_node = match json_text.split(r#""results""#).nth(1) {
        Some(node) => node,
        None => return Vec::new(),
    };
    let body = match search_node.find(r#""uses""#) {
        Some(end) => &search_node[..end],
        None => search_node,
    };

    let result_re = Regex::new(
        r#"\{"id":\d+,"title":\d+,"synopsis":\d+,"categoryId":\d+,"slug":\d+,"category":\d+\},"\d+","((?:[^"\\]|\\.)*)",(?:"(?:[^"\\]|\\.)*"|null)(?:,\d+|,null)?,"([a-z0-9][a-z0-9\-]*)"#,
    )
    .unwrap();

    let mut results = Vec::new();
    for cap in result_re.captures_iter(body) {
        let Some(title) = cap.get(1).map(|m| m.as_str()) else {
            continue;
        };
        let Some(slug) = cap.get(2).map(|m| m.as_str()) else {
            continue;
        };
        if title.is_empty() || slug.len() < 2 {
            continue;
        }
        results.push(SearchResult {
            title: title.to_string(),
            slug: slug.to_string(),
        });
    }
    results
}

fn normalize_title(value: &str) -> String {
    value
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extracts an explicit season number from a title like "Sousou no Frieren
/// 2nd Season", "Mushoku Tensei II: ...", "Mob Psycho 100 II" or "One Punch
/// Man 3". Only explicit series-season markers are recognized.
fn title_season_number(title: &str) -> Option<u32> {
    let lower = title.to_lowercase();
    // "2nd Season", "Season 2", "Temporada 3", "2ª Temporada", "Cour 2".
    let numeric_re = Regex::new(
        r"(?i)(\d+)\s*(?:st|nd|rd|th|ª|a|o)?\s*(?:season|temporada|cour)|\b(?:season|temporada|cour)\s+(\d+)",
    )
    .ok()?;
    if let Some(cap) = numeric_re.captures(&lower) {
        if let Some(value) = cap.get(1).or_else(|| cap.get(2)) {
            if let Ok(season) = value.as_str().parse::<u32>() {
                if (1..=99).contains(&season) {
                    return Some(season);
                }
            }
        }
    }
    // Roman numeral I..V as a standalone token before ":" ("Mushoku Tensei
    // II: ...") or at the end of the title ("Mob Psycho 100 II"). Requires a
    // word boundary so "XII" or "DxD" never match.
    let roman_re = Regex::new(r"(?i)(?:^|\s)(iv|v|iii|ii|i)(?:\s*:|$)").ok()?;
    if let Some(cap) = roman_re.captures(&lower) {
        let token = cap.get(1)?.as_str().to_lowercase();
        let season = match token.as_str() {
            "i" => 1,
            "ii" => 2,
            "iii" => 3,
            "iv" => 4,
            "v" => 5,
            _ => return None,
        };
        return Some(season);
    }
    // Trailing number ("One Punch Man 3"). Kept small to avoid year-like
    // values and standalone numbers inside other titles. "Part 2" style
    // suffixes are part-of-season markers, not season numbers, and "Movie N"
    // trailers are movie numbering, not seasons.
    let part_re = Regex::new(r"(?i)\b(?:part|parte)\s+\d{1,2}\s*$").ok()?;
    if part_re.is_match(&lower) {
        return None;
    }
    let trailing_re = Regex::new(r"(?i)(\d{1,2})\s*$").ok()?;
    if let Some(cap) = trailing_re.captures(&lower) {
        if let Ok(season) = cap.get(1)?.as_str().parse::<u32>() {
            if (1..=50).contains(&season) && !has_movie_like_word(title) {
                return Some(season);
            }
        }
    }
    None
}

fn has_movie_like_word(value: &str) -> bool {
    let lower = value.to_lowercase();
    let word_re = Regex::new(r"(?i)\b(movie|film|pelicula|película|ova|special|especial|specials)\b").unwrap();
    word_re.is_match(&lower)
}

/// True when the title names a specific arc/late season rather than the base
/// series ("...Kanketsu-hen", "...Hashira Geiko-hen", "The Final Season").
fn has_arc_suffix(value: &str) -> bool {
    let lower = value.to_lowercase();
    let suffix_re = Regex::new(r"(?i)(?:-hen|final season)\s*$").unwrap();
    suffix_re.is_match(&lower)
}

/// True when any result shares a strong textual match with the query, meaning
/// the site's titles use the same language as the query. Otherwise the search
/// matched an English alias while the titles stay in Japanese (e.g. "Demon
/// Slayer" vs "Kimetsu no Yaiba") and a second search with the top result's
/// title is needed to isolate the right series family.
fn has_strong_title_match(results: &[SearchResult], query: &str) -> bool {
    let normalized_query = normalize_title(query);
    results.iter().any(|result| {
        let normalized_title = normalize_title(&result.title);
        normalized_title == normalized_query
            || normalized_title.starts_with(&normalized_query)
            || normalized_title.contains(&normalized_query)
            || normalized_query.contains(&normalized_title)
    })
}

/// Ranks all search results and returns the slug of the best match for the
/// given query. The search endpoint orders results by relevance to the query's
/// English alias, so the first hit is often a movie or the latest season
/// rather than the base series. We score by title similarity first; when the
/// query has no strong textual match (the site often uses the English alias
/// while titles stay in Japanese), we fall back to the backend's own ordering
/// and only apply season/movie adjustments on top of it.
fn pick_best_slug(results: &[SearchResult], query: &str, season: Option<u32>) -> Option<String> {
    if results.is_empty() {
        return None;
    }
    let normalized_query = normalize_title(query);
    let query_tokens: Vec<&str> = normalized_query.split_whitespace().collect();
    let query_is_movie_like = has_movie_like_word(query);
    let wanted = season.unwrap_or(1);
    let count = results.len();

    let mut best: Option<(&SearchResult, i64)> = None;
    for (index, result) in results.iter().enumerate() {
        let normalized_title = normalize_title(&result.title);
        // Backend relevance order decides ties between weak matches. For the
        // base season (1) the backend ranks the newest arc first, which is the
        // wrong pick for season 1, so the position signal is dropped there and
        // the base series wins via the shorter-title tie-break instead.
        let position_step = if wanted == 1 { 1 } else { 10_000 };
        let mut score: i64 = (count - index) as i64 * position_step;

        let strong = normalized_title == normalized_query
            || normalized_title.starts_with(&normalized_query)
            || normalized_title.contains(&normalized_query)
            || normalized_query.contains(&normalized_title);

        if strong {
            if normalized_title == normalized_query {
                score += 1_000_000;
            } else if normalized_title.starts_with(&normalized_query) {
                score += 500_000;
            } else if normalized_title.contains(&normalized_query) {
                score += 300_000;
            } else {
                score += 100_000;
            }
            let title_tokens: Vec<&str> = normalized_title.split_whitespace().collect();
            let contained = query_tokens
                .iter()
                .filter(|token| title_tokens.contains(token))
                .count();
            let ratio = contained as f64 / query_tokens.len().max(1) as f64;
            score += (ratio * 100_000.0) as i64;
        }

        // Series preference: penalize movie/special entries unless the query
        // itself asks for one.
        if !query_is_movie_like && has_movie_like_word(&result.title) {
            score -= 200_000;
        }

        // For the base season, arc entries ("Kanketsu-hen", "The Final
        // Season") are never the right pick, regardless of how well the arc
        // title matches the search term.
        if wanted == 1 && has_arc_suffix(&result.title) {
            score -= 1_000_000;
        }

        // Season disambiguation: prefer the entry matching the requested
        // season; without a season (or for season 1) prefer the base entry.
        // Explicit season markers are decisive for strong matches; for weak
        // matches the marker signal is kept small so the backend ordering
        // still decides between unnamed arc entries ("Hashira Geiko-hen").
        match title_season_number(&result.title) {
            Some(parsed) if parsed == wanted => {
                score += if strong { 1_000_000 } else { 200_000 };
            }
            Some(_) => {
                score -= if strong { 1_000_000 } else { 200_000 };
            }
            None if wanted == 1 => {
                score += 200_000;
            }
            None => {}
        }

        // Tie-break: shorter titles are the base series entries.
        score -= normalized_title.chars().count() as i64;

        if best.as_ref().is_none_or(|(_, best_score)| score > *best_score) {
            best = Some((result, score));
        }
    }

    best.map(|(result, _)| result.slug.clone())
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
    season: Option<u32>,
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

    let first_results = extract_search_results(&search_text);

    let mut slug = if has_strong_title_match(&first_results, query) {
        pick_best_slug(&first_results, query, season)
    } else if let Some(top) = first_results
        .iter()
        .find(|result| !has_movie_like_word(&result.title))
    {
        // The site matched an English alias while titles stay in Japanese.
        // Re-search with the top series result's own title to isolate the
        // series family, then rank within it. Movie/special entries are
        // skipped so their titles never anchor the second search.
        let second_query = urlencoding::encode(&top.title);
        let second_url = format!(
            "{ANIMEAV1_BASE}/catalogo/__data.json?page=1&search={second_query}"
        );
        let second_text = async {
            let response = client.get(&second_url).send().await.ok()?;
            let response = response.error_for_status().ok()?;
            response.text().await.ok()
        }
        .await;
        second_text
            .as_deref()
            .map(extract_search_results)
            .and_then(|results| pick_best_slug(&results, &top.title, season))
    } else {
        None
    };

    if slug.is_none() {
        slug = pick_best_slug(&first_results, query, season)
            .or_else(|| extract_first_slug_from_search(&search_text));
    }
    let slug = slug.ok_or_else(|| "AnimeAV1: no search results found".to_string())?;

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
    fn extract_search_results_parses_all_results() {
        // Real payload node for "Naruto" (truncated to first results).
        // Note: the categoryId literal (1) is emitted only for the first
        // result — Remix dedups repeated values in the data array.
        let json = r#""results":1,"total":101},[2,11,16],{"id":3,"title":4,"synopsis":5,"categoryId":6,"slug":7,"category":8},"190","Naruto","Sinopsis del ninja.",1,"naruto",{"id":6,"name":9,"slug":10,"malId":6},"TV Anime","tv-anime",{"id":12,"title":13,"synopsis":14,"categoryId":6,"slug":15,"category":8},"957","The Last: Naruto the Movie","Una pelicula.","the-last-naruto-the-movie",{"id":17,"title":18,"synopsis":19,"categoryId":6,"slug":20,"category":8},"964","Naruto: Shippuuden - Sunny Side Battle","Un especial.","naruto-shippuuden-sunny-side-battle","uses":{"search_params":["page"]}}"#;
        let results = extract_search_results(json);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "Naruto");
        assert_eq!(results[0].slug, "naruto");
        assert_eq!(results[1].title, "The Last: Naruto the Movie");
        assert_eq!(results[1].slug, "the-last-naruto-the-movie");
        assert_eq!(results[2].title, "Naruto: Shippuuden - Sunny Side Battle");
        assert_eq!(results[2].slug, "naruto-shippuuden-sunny-side-battle");
    }

    #[test]
    fn pick_best_slug_prefers_exact_series_match() {
        let results = vec![
            SearchResult {
                title: "The Last: Naruto the Movie".into(),
                slug: "the-last-naruto-the-movie".into(),
            },
            SearchResult {
                title: "Naruto".into(),
                slug: "naruto".into(),
            },
            SearchResult {
                title: "Naruto: Shippuuden - Sunny Side Battle".into(),
                slug: "naruto-shippuuden-sunny-side-battle".into(),
            },
        ];
        let slug = pick_best_slug(&results, "Naruto", Some(1));
        assert_eq!(slug, Some("naruto".to_string()));
    }

    #[test]
    fn pick_best_slug_skips_movies_for_series_query() {
        let results = vec![
            SearchResult {
                title: "Shingeki no Kyojin Movie: Kanketsu-hen - The Last Attack".into(),
                slug: "shingeki-no-kyojin-movie-kanketsu-hen-the-last-attack".into(),
            },
            SearchResult {
                title: "Shingeki no Kyojin".into(),
                slug: "shingeki-no-kyojin".into(),
            },
            SearchResult {
                title: "Shingeki no Kyojin OVA".into(),
                slug: "shingeki-no-kyojin-ova".into(),
            },
        ];
        // Zero title overlap: the plain series must win over the movie and OVA.
        let slug = pick_best_slug(&results, "Attack on Titan", Some(1));
        assert_eq!(slug, Some("shingeki-no-kyojin".to_string()));
    }

    #[test]
    fn pick_best_slug_matches_requested_season() {
        let results = vec![
            SearchResult {
                title: "Sousou no Frieren".into(),
                slug: "sousou-no-frieren".into(),
            },
            SearchResult {
                title: "Sousou no Frieren 2nd Season".into(),
                slug: "sousou-no-frieren-2nd-season".into(),
            },
        ];
        assert_eq!(
            pick_best_slug(&results, "Frieren", Some(2)),
            Some("sousou-no-frieren-2nd-season".to_string())
        );
        assert_eq!(
            pick_best_slug(&results, "Frieren", Some(1)),
            Some("sousou-no-frieren".to_string())
        );
        assert_eq!(
            pick_best_slug(&results, "Frieren", None),
            Some("sousou-no-frieren".to_string())
        );
    }

    #[test]
    fn pick_best_slug_handles_roman_numeral_seasons() {
        let results = vec![
            SearchResult {
                title: "Mushoku Tensei: Isekai Ittara Honki Dasu".into(),
                slug: "mushoku-tensei-isekai-ittara-honki-dasu".into(),
            },
            SearchResult {
                title: "Mushoku Tensei II: Isekai Ittara Honki Dasu".into(),
                slug: "mushoku-tensei-ii-isekai-ittara-honki-dasu".into(),
            },
            SearchResult {
                title: "Mushoku Tensei III: Isekai Ittara Honki Dasu".into(),
                slug: "mushoku-tensei-iii-isekai-ittara-honki-dasu".into(),
            },
        ];
        assert_eq!(
            pick_best_slug(&results, "Mushoku Tensei", Some(2)),
            Some("mushoku-tensei-ii-isekai-ittara-honki-dasu".to_string())
        );
        assert_eq!(
            pick_best_slug(&results, "Mushoku Tensei", Some(1)),
            Some("mushoku-tensei-isekai-ittara-honki-dasu".to_string())
        );
    }

    #[test]
    fn pick_best_slug_matches_trailing_number_seasons() {
        let results = vec![
            SearchResult {
                title: "One Punch Man".into(),
                slug: "one-punch-man".into(),
            },
            SearchResult {
                title: "One Punch Man 3".into(),
                slug: "one-punch-man-3".into(),
            },
        ];
        assert_eq!(
            pick_best_slug(&results, "One Punch Man", Some(3)),
            Some("one-punch-man-3".to_string())
        );
        assert_eq!(
            pick_best_slug(&results, "One Punch Man", Some(1)),
            Some("one-punch-man".to_string())
        );
    }

    #[test]
    fn title_season_number_recognizes_markers() {
        assert_eq!(title_season_number("Sousou no Frieren 2nd Season"), Some(2));
        assert_eq!(title_season_number("Mushoku Tensei II: Isekai"), Some(2));
        assert_eq!(title_season_number("Mob Psycho 100 II"), Some(2));
        assert_eq!(title_season_number("One Punch Man 3"), Some(3));
        assert_eq!(title_season_number("One Punch Man"), None);
        assert_eq!(title_season_number("Attack on Titan"), None);
        assert_eq!(title_season_number("Shingeki no Kyojin: The Final Season Part 2"), None);
        assert_eq!(title_season_number("86 Eighty-Six"), None);
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
    async fn live_probe_hls_headers() {
        let client = crate::scraper::http::build_scraper_client().unwrap();
        let cases = [
            ("Naruto", Some(1), Some(1)),
            ("One Piece", Some(1), Some(1)),
            ("Attack on Titan", Some(1), Some(5)),
            ("Frieren", Some(1), Some(1)),
            ("Jujutsu Kaisen", Some(2), Some(3)),
            ("One Punch Man", Some(3), Some(1)),
            ("Steins;Gate", Some(1), Some(1)),
            ("Death Note", Some(1), Some(1)),
            ("Vinland Saga", Some(2), Some(2)),
            ("Fullmetal Alchemist", Some(1), Some(10)),
        ];
        for (query, season, episode) in cases {
            let Ok((candidates, _)) = search_and_resolve(&client, query, season, episode).await
            else {
                eprintln!("SEG-PROBE {query}: resolve failed");
                continue;
            };
            let Some(hls) = candidates.iter().find(|s| s.url.contains("m3u8")) else {
                eprintln!("SEG-PROBE {query}: no hls");
                continue;
            };
            let text = client
                .get(&hls.url)
                .header("Referer", ZILLA_REFERER)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            let Some(seg) = text.lines().find(|l| !l.starts_with('#')) else {
                eprintln!("SEG-PROBE {query}: no segment line");
                continue;
            };
            let seg_url = if seg.starts_with("http") {
                seg.to_string()
            } else {
                let base = hls.url.rsplit_once('/').map(|(b, _)| b.to_string()).unwrap();
                format!("{base}/{seg}")
            };
            let status = client
                .get(&seg_url)
                .header("Referer", ZILLA_REFERER)
                .send()
                .await
                .map(|r| r.status().as_u16())
                .unwrap_or(0);
            eprintln!("SEG-PROBE {query:24} {status} {seg_url}");
        }
    }

    #[tokio::test]
    #[ignore = "requires the live AnimeAV1 provider"]
    async fn live_probe_many_titles() {
        let client = crate::scraper::http::build_scraper_client().unwrap();
        let cases: &[(&str, Option<u32>, u32)] = &[
            ("Frieren", Some(1), 1),
            ("Naruto", Some(1), 1),
            ("One Piece", Some(1), 1),
            ("Jujutsu Kaisen", Some(2), 3),
            ("Attack on Titan", Some(1), 5),
            ("Demon Slayer", Some(1), 2),
            ("Mushoku Tensei", Some(2), 4),
            ("One Punch Man", Some(3), 1),
            ("Boku no Hero Academia", Some(2), 2),
            ("Tokyo Ghoul", Some(1), 1),
            ("Death Note", Some(1), 1),
            ("Sousou no Frieren", Some(2), 2),
            ("Spy x Family", Some(1), 3),
            ("Vinland Saga", Some(2), 2),
            ("Steins;Gate", Some(1), 1),
            ("Fullmetal Alchemist", Some(1), 10),
        ];
        for (q, season, ep) in cases {
            match search_and_resolve(&client, q, *season, Some(*ep)).await {
                Ok((streams, title)) => {
                    let hls = streams.iter().filter(|s| s.url.contains("m3u8")).count();
                    eprintln!(
                        "OK  {:<28} s={:<2} ep={:<3} streams={:<3} hls={} title={:?}",
                        q,
                        season.map(|s| s.to_string()).unwrap_or_else(|| "-".into()),
                        ep,
                        streams.len(),
                        hls,
                        title
                    );
                }
                Err(e) => eprintln!(
                    "ERR {:<28} s={:<2} ep={:<3} {}",
                    q,
                    season.map(|s| s.to_string()).unwrap_or_else(|| "-".into()),
                    ep,
                    e
                ),
            }
        }
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
