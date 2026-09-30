use super::generic::StreamCandidate;
use super::http::DEFAULT_USER_AGENT;
use aes::cipher::{BlockDecryptMut, KeyIvInit};
use regex::Regex;
use reqwest::Client;
use std::collections::HashMap;

const ANIMEAV1_BASE: &str = "https://animeav1.com";
const ZILLA_REFERER: &str = "https://player.zilla-networks.com/";

/// Headers base de navegador para reproducción en MPV. Varios hosts exigen
/// fetch-metadata de navegador real (`Sec-Fetch-Site: same-origin`, verificado
/// en vivo contra Zilla: sin él los segmentos responden 403 aunque el
/// Referer sea correcto) y bloquean el UA por defecto de libmpv.
fn browser_playback_headers(referer: String) -> HashMap<String, String> {
    let origin = referer
        .split('/')
        .take(3)
        .collect::<Vec<_>>()
        .join("/");
    HashMap::from([
        ("Referer".to_string(), referer),
        ("Origin".to_string(), origin),
        (
            "User-Agent".to_string(),
            DEFAULT_USER_AGENT.to_string(),
        ),
        ("Sec-Fetch-Dest".to_string(), "empty".to_string()),
        ("Sec-Fetch-Mode".to_string(), "cors".to_string()),
        ("Sec-Fetch-Site".to_string(), "same-origin".to_string()),
    ])
}

/// Headers para streams UPNShare (https://animeav1.uns.bio/...). Requieren el
/// origin del embed como Referer/Origin más headers de navegador.
fn upnshare_playback_headers(embed_url: &str) -> HashMap<String, String> {
    let origin = embed_url
        .split('#')
        .next()
        .and_then(|base| {
            let mut parts = base.split('/').collect::<Vec<_>>();
            if parts.len() >= 3 {
                parts.truncate(3);
                Some(parts.join("/"))
            } else {
                None
            }
        })
        .unwrap_or_else(|| "https://animeav1.uns.bio".to_string());
    browser_playback_headers(format!("{origin}/"))
}

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
    if lower.contains("mega.nz") || lower.contains("mega.io") || lower.contains("mega.co.nz") {
        return Some("Mega".to_string());
    }
    if lower.contains("mp4upload.com") {
        return Some("MP4Upload".to_string());
    }
    if lower.contains("uns.bio") || lower.contains("upnshare") {
        return Some("UPNShare".to_string());
    }
    if lower.contains("voe.sx") {
        return Some("Voe".to_string());
    }
    if lower.contains("streamtape.com") {
        return Some("Streamtape".to_string());
    }
    if lower.contains("yourupload.com") {
        return Some("YourUpload".to_string());
    }
    if lower.contains("1fichier.com") {
        return Some("1Fichier".to_string());
    }
    None
}

/// File hosts whose embeds can never resolve to a direct stream, so they must
/// never be offered as sources: 1Fichier blocks free programmatic downloads
/// ("all free guest slots are currently in use") and Mega serves only
/// encrypted API chunks — their pages always fail in MPV.
/// Host-based (not server-name-based) so it also covers renamed servers and
/// alternate domains like mega.io.
fn is_dead_file_host(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("1fichier.com")
        || lower.contains("mega.nz")
        || lower.contains("mega.io")
        || lower.contains("mega.co.nz")
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

// --- UPNShare embed resolution ------------------------------------------------
//
// UPNShare embeds look like `https://animeav1.uns.bio/#o8wi3v`: a Vidstack SPA
// that resolves the real stream through `GET /api/v1/video?id=<hash>`. The
// response body is a hex string holding AES-128-CBC ciphertext (PKCS7). The
// key and IV are derived in the SPA bundle from location.protocol/hash, and
// evaluate to fixed values for https pages:
//   key: "kiemtienmua911ca"
//   iv:  "1234567890oiuytr"
// The decrypted payload is JSON whose `cfNative` field is a proxied HLS
// manifest (animeav1.uns.bio/v4/pl/.../master....m3u8?k=...&kx=...) that plays
// directly in MPV. `source` (raw https manifest) is usually IP-locked to the
// visitor, so `cfNative` is preferred.

const UPNSHARE_AES_KEY: [u8; 16] = *b"kiemtienmua911ca";
const UPNSHARE_AES_IV: [u8; 16] = *b"1234567890oiuytr";

/// Extracts the UPNShare video id from an embed URL hash (e.g. `#o8wi3v`).
fn upnshare_video_id(embed_url: &str) -> Option<String> {
    let hash = embed_url.split('#').nth(1)?;
    // The hash may carry extra params (`&poster=`, `&subs=`); the id is first.
    let id = hash.split('&').next()?;
    if id.len() < 4 || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some(id.to_string())
}

/// AES-128-CBC decrypt (PKCS7) of a hex-encoded body. Returns the UTF-8 text.
fn upnshare_decrypt_hex_body(hex_body: &str) -> Result<String, String> {
    let ciphertext = hex::decode(hex_body.trim())
        .map_err(|e| format!("UPNShare hex decode failed: {e}"))?;
    if ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
        return Err("UPNShare payload is not a valid AES block".to_string());
    }
    let mut buffer = ciphertext;
    let decryptor = cbc::Decryptor::<aes::Aes128>::new_from_slices(
        &UPNSHARE_AES_KEY,
        &UPNSHARE_AES_IV,
    )
    .map_err(|e| format!("UPNShare cipher init failed: {e}"))?;
    let plaintext = decryptor
        .decrypt_padded_mut::<aes::cipher::block_padding::Pkcs7>(&mut buffer)
        .map_err(|e| format!("UPNShare decrypt failed: {e}"))?;
    String::from_utf8(plaintext.to_vec()).map_err(|e| format!("UPNShare payload is not UTF-8: {e}"))
}

/// Picks the best playable URL from a decrypted `/api/v1/video` payload.
/// `cfNative` (proxied through the embed host) plays anywhere; `source` is
/// commonly IP-locked; `ttStream` is TikTok-CDN relative and needs the host.
fn upnshare_pick_stream_url(payload: &serde_json::Value, embed_url: &str) -> Option<String> {
    let prefer = [
        payload.get("cfNative").and_then(|v| v.as_str()),
        payload.get("source").and_then(|v| v.as_str()),
    ];
    if let Some(url) = prefer.into_iter().flatten().find(|u| u.starts_with("https://")) {
        return Some(url.to_string());
    }
    // Relative paths (e.g. "/hls/.../master.m3u8") resolve against the embed host.
    let embed_origin = {
        let base = embed_url.split('#').next()?;
        let mut parts = base.split('/').collect::<Vec<_>>();
        if parts.len() >= 3 {
            parts.truncate(3);
            Some(parts.join("/"))
        } else {
            None
        }
    }?;
    for key in ["ttStream", "hlsVideoTiktok"] {
        if let Some(path) = payload.get(key).and_then(|v| v.as_str()) {
            if path.starts_with('/') {
                return Some(format!("{embed_origin}{path}"));
            }
        }
    }
    None
}

/// Resolves a UPNShare embed (`https://animeav1.uns.bio/#id`) to its direct
/// HLS manifest.
async fn resolve_upnshare(client: &Client, embed_url: &str) -> Result<String, String> {
    let video_id = upnshare_video_id(embed_url)
        .ok_or_else(|| "UPNShare embed has no video id in its hash".to_string())?;
    let origin = embed_url
        .split('#')
        .next()
        .and_then(|base| base.split('/').next().map(|_| base))
        .and_then(|base| {
            let mut parts = base.split('/').collect::<Vec<_>>();
            if parts.len() >= 3 {
                parts.truncate(3);
                Some(parts.join("/"))
            } else {
                None
            }
        })
        .ok_or_else(|| "UPNShare embed URL has no origin".to_string())?;

    let api_url = format!("{origin}/api/v1/video?id={video_id}");
    let response = client
        .get(&api_url)
        .header("Referer", format!("{origin}/"))
        .send()
        .await
        .map_err(|e| format!("UPNShare API request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("UPNShare API returned HTTP {}", response.status()));
    }
    let hex_body = response
        .text()
        .await
        .map_err(|e| format!("UPNShare API read failed: {e}"))?;

    let payload_text = upnshare_decrypt_hex_body(&hex_body)?;
    let payload: serde_json::Value = serde_json::from_str(&payload_text)
        .map_err(|e| format!("UPNShare payload is not JSON: {e}"))?;
    upnshare_pick_stream_url(&payload, embed_url)
        .ok_or_else(|| "UPNShare payload has no playable stream".to_string())
}

// --- MP4Upload embed resolution ------------------------------------------------
//
// MP4Upload embeds (`https://www.mp4upload.com/embed-<id>.html`) are plain
// videojs pages: the direct file sits in `player.src({ type: "video/mp4",
// src: "https://a\d.mp4upload.com:\d+/d/<token>/video.mp4" })`. The file host
// requires the embed URL as Referer.

/// Extracts the direct mp4 URL from an MP4Upload embed page.
fn mp4upload_extract_direct_url(html: &str) -> Option<String> {
    let src_re = Regex::new(
        r#"src:\s*"(https://[a-z0-9.]*mp4upload\.com(?::\d+)?/d/[^"]+/video\.mp4)""#,
    )
    .ok()?;
    src_re
        .captures(html)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
}

/// Resolves an MP4Upload embed page to its direct mp4 file URL.
async fn resolve_mp4upload(client: &Client, embed_url: &str) -> Result<String, String> {
    let html = client
        .get(embed_url)
        .header("Referer", "https://www.mp4upload.com/")
        .send()
        .await
        .map_err(|e| format!("MP4Upload request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("MP4Upload response failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("MP4Upload read failed: {e}"))?;
    mp4upload_extract_direct_url(&html)
        .ok_or_else(|| "MP4Upload did not expose the direct file".to_string())
}

// --- VOE embed resolution ------------------------------------------------------
//
// VOE embeds (`https://voe.sx/e/<id>`) answer with a JS redirect to a rotating
// mirror domain. The mirror page hides its stream in
// `<script type="application/json">["<obfuscated>"]</script>`, decoded as:
// ROT13 -> strip 2-char separators (`@$`, `^^`, `~@`, `%?`, `*~`, `!!`, `#&`)
// -> strip `_` -> base64 -> Caesar(-3) -> reverse -> base64 -> JSON.
// The decoded payload's `source` is the signed HLS manifest.

/// Extracts the mirror embed URL from a voe.sx redirect page
/// (`window.location.href = 'https://<mirror>/e/<id>'`).
fn voe_extract_mirror_url(html: &str) -> Option<String> {
    let re = Regex::new(r#"window\.location\.href\s*=\s*'(https://[^']+/e/[^']+)'"#).ok()?;
    re.captures(html)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extracts the obfuscated sources string from a VOE mirror embed page.
fn voe_extract_sources_string(html: &str) -> Option<String> {
    let re = Regex::new(r#"<script[^>]*type="application/json"[^>]*>\["([^"]*)"\]"#).ok()?;
    re.captures(html)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
}

/// Decodes a VOE obfuscated sources string into the JSON payload text.
fn voe_decode_sources(encoded: &str) -> Result<String, String> {
    if encoded.trim().is_empty() {
        return Err("VOE sources string is empty".to_string());
    }
    // ROT13 over ASCII letters.
    let rot13: String = encoded
        .chars()
        .map(|c| match c {
            'A'..='Z' => (((c as u8 - b'A' + 13) % 26) + b'A') as char,
            'a'..='z' => (((c as u8 - b'a' + 13) % 26) + b'a') as char,
            _ => c,
        })
        .collect();
    // Strip the VOE 2-char separators, then the underscores.
    let mut stripped = rot13;
    for sep in ["@$", "^^", "~@", "%?", "*~", "!!", "#&"] {
        stripped = stripped.replace(sep, "");
    }
    stripped.retain(|c| c != '_');
    // base64 -> Caesar(-3) -> reverse -> base64 -> JSON text.
    use base64::Engine as _;
    let step1 = base64::engine::general_purpose::STANDARD
        .decode(&stripped)
        .map_err(|e| format!("VOE base64 step 1 failed: {e}"))?;
    let shifted: Vec<u8> = step1.iter().map(|b| b.wrapping_sub(3)).collect();
    let reversed: Vec<u8> = shifted.into_iter().rev().collect();
    let step2 = base64::engine::general_purpose::STANDARD
        .decode(&reversed)
        .map_err(|e| format!("VOE base64 step 2 failed: {e}"))?;
    String::from_utf8(step2).map_err(|e| format!("VOE payload is not UTF-8: {e}"))
}

/// Picks the signed HLS manifest from a decoded VOE payload.
fn voe_pick_stream_url(payload: &serde_json::Value) -> Option<String> {
    payload
        .get("source")
        .and_then(|v| v.as_str())
        .filter(|u| u.starts_with("https://"))
        .map(|s| s.to_string())
}

/// Matches VOE embed URLs listed by providers (`voe.sx/e/...`).
fn is_voe_url(url: &str) -> bool {
    url.to_ascii_lowercase().contains("voe.sx")
}

/// Resolves a VOE embed to its signed HLS manifest. Returns the stream URL
/// plus the mirror page to use as Referer.
async fn resolve_voe(
    client: &Client,
    embed_url: &str,
) -> Result<(String, HashMap<String, String>), String> {
    let first_html = client
        .get(embed_url)
        .header("Referer", "https://voe.sx/")
        .send()
        .await
        .map_err(|e| format!("VOE request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("VOE response failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("VOE read failed: {e}"))?;

    // voe.sx itself only serves a JS redirect; the mirror holds the player.
    let (page_url, html) = match voe_extract_mirror_url(&first_html) {
        Some(mirror_url) => {
            let mirror_html = client
                .get(&mirror_url)
                .header("Referer", "https://voe.sx/")
                .send()
                .await
                .map_err(|e| format!("VOE mirror request failed: {e}"))?
                .error_for_status()
                .map_err(|e| format!("VOE mirror response failed: {e}"))?
                .text()
                .await
                .map_err(|e| format!("VOE mirror read failed: {e}"))?;
            (mirror_url, mirror_html)
        }
        None => (embed_url.to_string(), first_html),
    };

    let encoded = voe_extract_sources_string(&html)
        .ok_or_else(|| "VOE page has no sources payload".to_string())?;
    let json_text = voe_decode_sources(&encoded)?;
    let payload: serde_json::Value = serde_json::from_str(&json_text)
        .map_err(|e| format!("VOE payload is not JSON: {e}"))?;
    let stream_url =
        voe_pick_stream_url(&payload).ok_or_else(|| "VOE payload has no stream".to_string())?;
    let headers = browser_playback_headers(page_url);
    Ok((stream_url, headers))
}

// --- Streamtape embed resolution ------------------------------------------------
//
// Streamtape `/e/<id>` (and `/v/<id>`) pages carry the signed file in a hidden
// `#robotlink` div: `//streamtape.com/get_video?id=...&expires=...&ip=...&token=...`.
// The web player loads `#botlink` + `&stream=1`, so we do the same.

/// Matches Streamtape embed/watch URLs.
fn is_streamtape_url(url: &str) -> bool {
    url.to_ascii_lowercase().contains("streamtape.com")
}

/// Extracts the signed file URL from a Streamtape page.
fn streamtape_extract_direct_url(html: &str) -> Option<String> {
    let re =
        Regex::new(r#"id="robotlink"[^>]*>([^<]*streamtape\.com/get_video\?[^<]*)<"#).ok()?;
    let inner = re.captures(html)?.get(1)?.as_str();
    // The static div drops one slash (`/streamtape.com/...`); the player JS
    // rewrites it to the protocol-relative `//streamtape.com/...`.
    let absolute = if inner.starts_with("//") {
        format!("https:{inner}")
    } else if let Some(rest) = inner.strip_prefix('/') {
        format!("https://{rest}")
    } else {
        inner.to_string()
    };
    Some(format!("{absolute}&stream=1"))
}

/// Resolves a Streamtape embed/watch page to its signed file URL.
async fn resolve_streamtape(
    client: &Client,
    embed_url: &str,
) -> Result<(String, HashMap<String, String>), String> {
    let html = client
        .get(embed_url)
        .header("Referer", "https://streamtape.com/")
        .send()
        .await
        .map_err(|e| format!("Streamtape request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Streamtape response failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Streamtape read failed: {e}"))?;
    let stream_url = streamtape_extract_direct_url(&html)
        .ok_or_else(|| "Streamtape did not expose the file".to_string())?;
    let headers = browser_playback_headers(embed_url.to_string());
    Ok((stream_url, headers))
}

// --- YourUpload embed resolution ------------------------------------------------
//
// YourUpload embeds (`https://www.yourupload.com/embed/<id>`) are plain
// jwplayer pages: the direct file sits in `file: 'https://...mp4'`.

/// Matches YourUpload embed URLs.
fn is_yourupload_url(url: &str) -> bool {
    url.to_ascii_lowercase().contains("yourupload.com")
}

/// Extracts the direct mp4 URL from a YourUpload embed page.
fn yourupload_extract_direct_url(html: &str) -> Option<String> {
    let re = Regex::new(r#"file:\s*'(https://[^']+\.mp4)'"#).ok()?;
    re.captures(html)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
}

/// Resolves a YourUpload embed page to its direct mp4 file URL.
async fn resolve_yourupload(
    client: &Client,
    embed_url: &str,
) -> Result<(String, HashMap<String, String>), String> {
    let html = client
        .get(embed_url)
        .header("Referer", "https://www.yourupload.com/")
        .send()
        .await
        .map_err(|e| format!("YourUpload request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("YourUpload response failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("YourUpload read failed: {e}"))?;
    let stream_url = yourupload_extract_direct_url(&html)
        .ok_or_else(|| "YourUpload did not expose the direct file".to_string())?;
    let headers = browser_playback_headers(embed_url.to_string());
    Ok((stream_url, headers))
}

// --- VidHide embed resolution ---------------------------------------------------
//
// VidHide (rotating mirror domains, `/embed/<id>`) hides its HLS manifest in a
// Dean Edwards packed script:
// `eval(function(p,a,c,k,e,d){...}('PACKED',36,COUNT,'T1|T2|...'.split('|')))`.
// Unpacking substitutes every base36 token with its table word, revealing the
// `https://...m3u8?...` file URLs.

/// Converts a table index to its base36 token (`10` -> `"a"`).
fn to_base36(mut value: u32) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize] as char);
        value /= 36;
    }
    out.into_iter().rev().collect()
}

/// Extracts `(packed_body, base, table)` from a VidHide packed script.
fn vidhide_extract_packer_args(html: &str) -> Option<(String, u32, Vec<String>)> {
    let re = Regex::new(
        r"(?s)eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)\)",
    )
    .ok()?;
    let cap = re.captures(html)?;
    let packed = cap.get(1)?.as_str().to_string();
    let base: u32 = cap.get(2)?.as_str().parse().ok()?;
    let _count: usize = cap.get(3)?.as_str().parse().ok()?;
    let table: Vec<String> = cap.get(4)?.as_str().split('|').map(|s| s.to_string()).collect();
    Some((packed, base, table))
}

/// Unpacks a Dean Edwards packed body with its word table.
fn vidhide_unpack(packed: &str, table: &[String]) -> String {
    let mut out = packed.to_string();
    for (index, word) in table.iter().enumerate().rev() {
        if word.is_empty() {
            continue;
        }
        let token = to_base36(index as u32);
        // ASCII boundaries: tokens are [0-9a-z], like the JS `\b` semantics.
        let pattern = format!(r"(?-u:\b{}\b)", regex::escape(&token));
        if let Ok(re) = Regex::new(&pattern) {
            out = re.replace_all(&out, regex::NoExpand(word)).into_owned();
        }
    }
    out
}

/// Extracts the HLS manifest from unpacked VidHide JS (prefers master).
fn vidhide_extract_m3u8(unpacked: &str) -> Option<String> {
    let re = Regex::new(r#"https://[^\s"'\\]+\.m3u8[^\s"'\\]*"#).ok()?;
    let mut first: Option<String> = None;
    for cap in re.captures_iter(unpacked) {
        let url = cap.get(0)?.as_str().to_string();
        if first.is_none() {
            first = Some(url.clone());
        }
        if url.contains("master.m3u8") {
            return Some(url);
        }
    }
    first
}

/// Resolves a VidHide embed page to its HLS manifest.
async fn resolve_vidhide(
    client: &Client,
    embed_url: &str,
) -> Result<(String, HashMap<String, String>), String> {
    let html = client
        .get(embed_url)
        .send()
        .await
        .map_err(|e| format!("VidHide request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("VidHide response failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("VidHide read failed: {e}"))?;
    let (packed, base, table) = vidhide_extract_packer_args(&html)
        .ok_or_else(|| "VidHide page has no packed script".to_string())?;
    if base != 36 {
        return Err("VidHide packer base is not 36".to_string());
    }
    let unpacked = vidhide_unpack(&packed, &table);
    let stream_url = vidhide_extract_m3u8(&unpacked)
        .ok_or_else(|| "VidHide did not expose a manifest".to_string())?;
    let headers = browser_playback_headers(embed_url.to_string());
    Ok((stream_url, headers))
}

// --- Generic unknown-embed sniffing ----------------------------------------------
//
// Providers keep adding/renaming servers (VOE and VidHide rotate their mirror
// domains), so embeds can arrive without a usable server literal. For those we
// fetch the page once and sniff for known player signatures instead of handing
// an HTML page to MPV.

/// Outcome of sniffing an unknown embed page.
enum SniffedEmbed {
    /// A direct stream was extracted.
    Resolved { url: String, headers: HashMap<String, String> },
    /// Known-unplayable shell (Byse SPA: needs PoW captcha + session).
    Dead,
    /// No known signature: leave the URL as-is for the player to try.
    Unknown,
}

/// True for direct media URLs (mp4/m3u8/...) that MPV can load untouched.
fn has_media_extension(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let lower = path.to_ascii_lowercase();
    const EXTS: &[&str] = &[
        ".m3u8", ".mpd", ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".mov", ".wmv", ".flv",
        ".ogv", ".ogg", ".mpg", ".mpeg", ".m2ts", ".mts", ".ts",
    ];
    EXTS.iter().any(|ext| lower.ends_with(ext))
}

/// Sniffs an already-fetched embed page for known player signatures.
fn sniff_embed_page(embed_url: &str, html: &str) -> SniffedEmbed {
    let headers = browser_playback_headers(embed_url.to_string());

    // VOE mirror listed without its server literal.
    if html.contains(r#"type="application/json""#) {
        if let Some(encoded) = voe_extract_sources_string(html) {
            if let Ok(text) = voe_decode_sources(&encoded) {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(stream_url) = voe_pick_stream_url(&payload) {
                        return SniffedEmbed::Resolved {
                            url: stream_url,
                            headers: headers.clone(),
                        };
                    }
                }
            }
        }
    }
    // VidHide mirror listed without its server literal.
    if html.contains("eval(function(p,a,c,k,e,d)") {
        if let Some((packed, base, table)) = vidhide_extract_packer_args(html) {
            if base == 36 {
                let unpacked = vidhide_unpack(&packed, &table);
                if let Some(stream_url) = vidhide_extract_m3u8(&unpacked) {
                    return SniffedEmbed::Resolved {
                        url: stream_url,
                        headers: headers.clone(),
                    };
                }
            }
        }
    }
    // Streamtape watch/embed page.
    if html.contains("robotlink") {
        if let Some(stream_url) = streamtape_extract_direct_url(html) {
            return SniffedEmbed::Resolved {
                url: stream_url,
                headers: headers.clone(),
            };
        }
    }
    // YourUpload embed page.
    if html.contains("jwplayerOptions") {
        if let Some(stream_url) = yourupload_extract_direct_url(html) {
            return SniffedEmbed::Resolved {
                url: stream_url,
                headers,
            };
        }
    }
    // Byse SPA shell: needs session + PoW captcha, can never play in MPV.
    if html.contains("video-embed-mode") {
        return SniffedEmbed::Dead;
    }
    SniffedEmbed::Unknown
}

/// Fetches an unknown embed page and sniffs it for known player signatures.
async fn fetch_and_sniff(client: &Client, embed_url: &str) -> SniffedEmbed {
    let html = match client.get(embed_url).send().await {
        Ok(response) => match response.error_for_status() {
            Ok(ok) => match ok.text().await {
                Ok(text) => text,
                Err(_) => return SniffedEmbed::Unknown,
            },
            Err(_) => return SniffedEmbed::Unknown,
        },
        Err(_) => return SniffedEmbed::Unknown,
    };
    sniff_embed_page(embed_url, &html)
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
    let headers = browser_playback_headers(ZILLA_REFERER.to_string());
    // UPNShare rate-limits its API hard (HTTP 429): resolve at most one embed
    // per episode. The first UPNShare embed is the SUB variant.
    let mut upnshare_resolved = false;

    for embed in &embeds {
        let language = embed.variant.language_label().to_string();

        if embed.server == "UPNShare" {
            if upnshare_resolved {
                continue;
            }
            // The uns.bio embed is a JS SPA, not a direct stream: resolve it
            // through the provider API to the real HLS manifest.
            match resolve_upnshare(client, &embed.url).await {
                Ok(m3u8_url) => {
                    upnshare_resolved = true;
                    let quality = infer_quality(&embed.server, &m3u8_url).or(Some("1080p".to_string()));
                    candidates.push(StreamCandidate {
                        url: m3u8_url,
                        quality,
                        language: Some(language),
                        source: "animeav1".to_string(),
                        headers: Some(upnshare_playback_headers(&embed.url)),
                    });
                }
                Err(error) => {
                    eprintln!("[scraper:animeav1] UPNShare resolve failed: {error}");
                }
            }
            continue;
        }

        if embed.server == "MP4Upload" {
            // The embed page hides the direct file in a videojs `player.src`
            // call; resolve it so MPV gets the mp4 itself.
            match resolve_mp4upload(client, &embed.url).await {
                Ok(mp4_url) => {
                    let mp4_headers =
                        browser_playback_headers("https://www.mp4upload.com/".to_string());
                    candidates.push(StreamCandidate {
                        url: mp4_url,
                        quality: infer_quality(&embed.server, &embed.url),
                        language: Some(language),
                        source: "animeav1".to_string(),
                        headers: Some(mp4_headers),
                    });
                }
                Err(error) => {
                    eprintln!("[scraper:animeav1] MP4Upload resolve failed: {error}");
                }
            }
            continue;
        }

        if embed.server == "Voe" || is_voe_url(&embed.url) {
            // The embed page is a JS player shell: decode its sources payload
            // to the signed HLS manifest so MPV gets a real stream.
            match resolve_voe(client, &embed.url).await {
                Ok((stream_url, voe_headers)) => {
                    let quality = infer_quality(&embed.server, &stream_url)
                        .or(Some("1080p".to_string()));
                    candidates.push(StreamCandidate {
                        url: stream_url,
                        quality,
                        language: Some(language),
                        source: "animeav1".to_string(),
                        headers: Some(voe_headers),
                    });
                }
                Err(error) => {
                    eprintln!("[scraper:animeav1] VOE resolve failed: {error}");
                }
            }
            continue;
        }

        if embed.server == "Streamtape" || is_streamtape_url(&embed.url) {
            // The page hides the signed file in `#robotlink`.
            match resolve_streamtape(client, &embed.url).await {
                Ok((stream_url, st_headers)) => {
                    let quality = infer_quality(&embed.server, &embed.url);
                    candidates.push(StreamCandidate {
                        url: stream_url,
                        quality,
                        language: Some(language),
                        source: "animeav1".to_string(),
                        headers: Some(st_headers),
                    });
                }
                Err(error) => {
                    eprintln!("[scraper:animeav1] Streamtape resolve failed: {error}");
                }
            }
            continue;
        }

        if embed.server == "YourUpload" || is_yourupload_url(&embed.url) {
            // The jwplayer page carries the direct mp4 in `file: '...'`.
            match resolve_yourupload(client, &embed.url).await {
                Ok((stream_url, yu_headers)) => {
                    let quality = infer_quality(&embed.server, &stream_url);
                    candidates.push(StreamCandidate {
                        url: stream_url,
                        quality,
                        language: Some(language),
                        source: "animeav1".to_string(),
                        headers: Some(yu_headers),
                    });
                }
                Err(error) => {
                    eprintln!("[scraper:animeav1] YourUpload resolve failed: {error}");
                }
            }
            continue;
        }

        if embed.server == "VidHide" {
            // Rotating mirror domains: unpack the packed player JS to the HLS.
            match resolve_vidhide(client, &embed.url).await {
                Ok((stream_url, vh_headers)) => {
                    let quality = infer_quality(&embed.server, &stream_url)
                        .or(Some("1080p".to_string()));
                    candidates.push(StreamCandidate {
                        url: stream_url,
                        quality,
                        language: Some(language),
                        source: "animeav1".to_string(),
                        headers: Some(vh_headers),
                    });
                }
                Err(error) => {
                    eprintln!("[scraper:animeav1] VidHide resolve failed: {error}");
                }
            }
            continue;
        }

        if is_dead_file_host(&embed.url)
            || embed.server == "1Fichier"
            || embed.server == "Mega"
        {
            // Never offered as a source: these pages can never play in MPV.
            // 1Fichier blocks free guest downloads from non-browsers ("all
            // free guest slots are currently in use") and Mega requires its
            // encrypted API.
            continue;
        }

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
        } else if has_media_extension(&embed.url) {
            // Direct file with no resolver needed: MPV loads it untouched.
            candidates.push(StreamCandidate {
                url: embed.url.clone(),
                quality,
                language: Some(language),
                source: "animeav1".to_string(),
                headers: Some(headers.clone()),
            });
        } else {
            // Unknown server (mirrors rotate domains and literals get
            // renamed): fetch once and sniff for known player signatures.
            // Byse-like SPA shells are skipped; anything unrecognized keeps
            // the URL as-is so the player (yt-dlp) can still try.
            match fetch_and_sniff(client, &embed.url).await {
                SniffedEmbed::Resolved { url, headers } => candidates.push(StreamCandidate {
                    url,
                    quality,
                    language: Some(language),
                    source: "animeav1".to_string(),
                    headers: Some(headers),
                }),
                SniffedEmbed::Dead => {
                    eprintln!(
                        "[scraper:animeav1] skipping unplayable {} embed",
                        embed.server
                    );
                }
                SniffedEmbed::Unknown => candidates.push(StreamCandidate {
                    url: embed.url.clone(),
                    quality,
                    language: Some(language),
                    source: "animeav1".to_string(),
                    headers: Some(headers.clone()),
                }),
            }
        }
    }

    if candidates.is_empty() {
        return Err("AnimeAV1: no embeds found on episode page".to_string());
    }

    Ok((candidates, Some(episode_title)))
}

#[allow(dead_code)]
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
    fn upnshare_video_id_reads_hash() {
        assert_eq!(
            upnshare_video_id("https://animeav1.uns.bio/#o8wi3v").as_deref(),
            Some("o8wi3v")
        );
        // Extra hash params are stripped.
        assert_eq!(
            upnshare_video_id("https://animeav1.uns.bio/#o8wi3v&poster=x").as_deref(),
            Some("o8wi3v")
        );
        assert_eq!(upnshare_video_id("https://animeav1.uns.bio/"), None);
        assert_eq!(upnshare_video_id("https://animeav1.uns.bio/#ab"), None);
    }

    #[test]
    fn upnshare_decrypt_recovers_real_payload_shape() {
        // Fixture: AES-128-CBC/PKCS7 of the real /api/v1/video payload shape
        // (key "kiemtienmua911ca", iv "1234567890oiuytr"), as served by uns.bio.
        let hex_body = "95611938b8acc718f799196c55ca4d6fa3db5a6a3ee4fa1675f620bae399b46e8df4cc2dcd947b303fef4976a1219decea938bd10640e1a93354ab6a1c59199386dac5d8e11085b9a131cb958555f3840a2f36ecf36e0f098cdc74e385bc2e4c2ee7fc9883b6bd7535c531723a07802df48beab76525bf4519c4aac21680d488e1257a4a192dc71d7895cc4280f5efa996f26e81674ca439c29427432a20b25a1944c995f441e1e2751f4060bb528b2660a1177bf28576ee9a974cc62860b7f7c343d33f11c29203486649a719dabfb316c8ccc7a67d8f5cf566ffb5828147c19bc45f7da205bcb0ffa79f4d0444a7421bdb36aae944fe3f25862887f3a45650cf94f5f9c49100d730972f2e479a74c5daeaa07e8a755d377eb4a2ce08fc7a8fd38e29028815a7c11f3d46a0a657a7ebebf87ad66965432739d191edb2c893c61e700ea2d379263aa654f0249fd085542ba48016e7a968ea992475e80807eade93fa209a3cadaded688c1433b73af2bd97a21a181e5f9befc2bf5732d2cdf80ba02ac91b21aad4ec56519586260054f6cff35ef896c8f5807e1d91c23f3303c8a32ffa5997ce4d511297ef7a537cdb7bd93da4b63239064003fca43518b61ef5";
        let text = upnshare_decrypt_hex_body(hex_body).expect("decrypt");
        let payload: serde_json::Value = serde_json::from_str(&text).expect("json");
        assert_eq!(payload["title"], "257_2_SUB.mp4");
        // cfNative (proxied manifest) wins over the IP-locked `source`.
        let picked = upnshare_pick_stream_url(&payload, "https://animeav1.uns.bio/#o8wi3v")
            .expect("pick");
        assert!(picked.starts_with("https://animeav1.uns.bio/v4/pl/"));
        assert!(picked.contains("master.1787702761.m3u8"));
    }

    #[test]
    fn upnshare_pick_stream_falls_back_to_relative_paths() {
        let payload: serde_json::Value = serde_json::from_str(
            r#"{"hlsVideoTiktok":"/hls/abc/tt/master.m3u8"}"#,
        )
        .unwrap();
        let picked =
            upnshare_pick_stream_url(&payload, "https://animeav1.uns.bio/#xyz").expect("pick");
        assert_eq!(picked, "https://animeav1.uns.bio/hls/abc/tt/master.m3u8");
    }

    #[test]
    fn upnshare_decrypt_rejects_non_block_body() {
        assert!(upnshare_decrypt_hex_body("aabbcc").is_err());
        assert!(upnshare_decrypt_hex_body("").is_err());
    }

    #[test]
    fn voe_decode_sources_recovers_payload() {
        // Fixture obfuscated with the inverse pipeline
        // (base64 -> reverse -> Caesar(+3) -> base64 -> separators -> ROT13).
        let encoded = "DQAkGQq_LAyO@$3BT_kzo1H2M_z^^f0AH93_CQIpr~@Su_XMKb0Jy_j3%?JGICr_KW9Mac*~I_F2qlGJk_FoS!!t1KU_kMAzI9G_#&Kkb";
        let text = voe_decode_sources(encoded).expect("decode");
        let payload: serde_json::Value = serde_json::from_str(&text).expect("json");
        assert_eq!(
            voe_pick_stream_url(&payload).as_deref(),
            Some("https://example.com/master.m3u8")
        );
    }

    #[test]
    fn voe_decode_sources_rejects_garbage() {
        assert!(voe_decode_sources("!!!not-valid!!!").is_err());
        assert!(voe_decode_sources("").is_err());
    }

    #[test]
    fn voe_extract_mirror_url_reads_js_redirect() {
        let html = "<script>window.location.href = 'https://johnfullwonder.com/e/6tmjy171qf2g';</script>";
        assert_eq!(
            voe_extract_mirror_url(html).as_deref(),
            Some("https://johnfullwonder.com/e/6tmjy171qf2g")
        );
        assert_eq!(voe_extract_mirror_url("<html></html>"), None);
    }

    #[test]
    fn voe_extract_sources_string_reads_json_script() {
        let html = r#"<script type="application/json">["abc123"]</script>"#;
        assert_eq!(
            voe_extract_sources_string(html).as_deref(),
            Some("abc123")
        );
        assert_eq!(voe_extract_sources_string("<html></html>"), None);
    }

    #[test]
    fn voe_pick_stream_url_prefers_source_manifest() {
        let payload: serde_json::Value = serde_json::from_str(
            r#"{"source":"https://cdn.example.com/master.m3u8","direct_access_url":"https://cdn.example.com/f.mp4"}"#,
        )
        .unwrap();
        assert_eq!(
            voe_pick_stream_url(&payload).as_deref(),
            Some("https://cdn.example.com/master.m3u8")
        );
        let empty: serde_json::Value = serde_json::from_str("{}").unwrap();
        assert_eq!(voe_pick_stream_url(&empty), None);
    }

    #[test]
    fn streamtape_extract_direct_url_reads_robotlink() {
        let html = r#"<div id="robotlink" style="display:none;">/streamtape.com/get_video?id=P6x2k1yrxMu0P1v&expires=1789172182&ip=FRuODxyTDRSNFt&token=hH8icwa_Ncde</div>"#;
        assert_eq!(
            streamtape_extract_direct_url(html).as_deref(),
            Some("https://streamtape.com/get_video?id=P6x2k1yrxMu0P1v&expires=1789172182&ip=FRuODxyTDRSNFt&token=hH8icwa_Ncde&stream=1")
        );
        // Protocol-relative variant.
        let html2 = r#"<div id="robotlink">//streamtape.com/get_video?id=abc&token=x</div>"#;
        assert_eq!(
            streamtape_extract_direct_url(html2).as_deref(),
            Some("https://streamtape.com/get_video?id=abc&token=x&stream=1")
        );
        assert_eq!(streamtape_extract_direct_url("<html></html>"), None);
    }

    #[test]
    fn yourupload_extract_direct_url_reads_jwplayer_file() {
        let html = "var jwplayerOptions = {\n  file: 'https://vidcache.net:8161/a2026091083hOoFy58r1/video.mp4',\n  image: 'x',\n};";
        assert_eq!(
            yourupload_extract_direct_url(html).as_deref(),
            Some("https://vidcache.net:8161/a2026091083hOoFy58r1/video.mp4")
        );
        // Watermark/logo `file:` entries (no .mp4) must not match.
        assert_eq!(
            yourupload_extract_direct_url("logo: {\n file: '/images/watermark.png',\n}"),
            None
        );
    }

    #[test]
    fn to_base36_encodes_tokens() {
        assert_eq!(to_base36(0), "0");
        assert_eq!(to_base36(10), "a");
        assert_eq!(to_base36(35), "z");
        assert_eq!(to_base36(36), "10");
        assert_eq!(to_base36(56), "1k");
        assert_eq!(to_base36(526), "em");
    }

    #[test]
    fn vidhide_unpack_and_extract_m3u8() {
        // Small packer fixture: `2("v").1({3:[{4:"5://6.7.8/9/a.b"}]});`
        // with table `|setup|jwplayer|sources|file|https|cdn|example|com|hls|master|m3u8`.
        let packed = r#"2("v").1({3:[{4:"5://6.7.8/9/a.b"}]});"#;
        let table: Vec<String> = "|setup|jwplayer|sources|file|https|cdn|example|com|hls|master|m3u8"
            .split('|')
            .map(|s| s.to_string())
            .collect();
        let unpacked = vidhide_unpack(packed, &table);
        assert!(unpacked.contains(r#"file:"https://cdn.example.com/hls/master.m3u8""#), "got: {unpacked}");
        assert_eq!(
            vidhide_extract_m3u8(&unpacked).as_deref(),
            Some("https://cdn.example.com/hls/master.m3u8")
        );
    }

    #[test]
    fn vidhide_extract_packer_args_reads_eval_call() {
        let html = "x eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(a,b)}('PACKED',36,3,'|bb|aa'.split('|'))) y";
        let (packed, base, table) = vidhide_extract_packer_args(html).expect("args");
        assert_eq!(packed, "PACKED");
        assert_eq!(base, 36);
        assert_eq!(table, vec!["".to_string(), "bb".to_string(), "aa".to_string()]);
        assert_eq!(vidhide_extract_packer_args("<html></html>"), None);
    }

    #[test]
    fn has_media_extension_detects_direct_files() {
        assert!(has_media_extension("https://cdn.example.com/v/master.m3u8?token=x"));
        assert!(has_media_extension("https://cdn.example.com/f/video.mp4"));
        assert!(!has_media_extension("https://voe.sx/e/6tmjy171qf2g"));
        assert!(!has_media_extension("https://www.mp4upload.com/embed-x.html"));
    }

    #[test]
    fn sniff_embed_page_classifies_pages() {
        // VOE mirror page (tiny real-shape payload from the voe fixture).
        let voe_html = r#"<script type="application/json">["DQAkGQq_LAyO@$3BT_kzo1H2M_z^^f0AH93_CQIpr~@Su_XMKb0Jy_j3%?JGICr_KW9Mac*~I_F2qlGJk_FoS!!t1KU_kMAzI9G_#&Kkb"]</script>"#;
        match sniff_embed_page("https://mirror.example/e/abc", voe_html) {
            SniffedEmbed::Resolved { url, .. } => {
                assert_eq!(url, "https://example.com/master.m3u8")
            }
            other => panic!("expected Resolved, got {}", matches!(other, SniffedEmbed::Dead)),
        }
        // Byse SPA shell.
        let byse_html = r#"<html><head><title>Byse Frontend</title></head><body class="video-embed-mode"><div id="root"></div></body></html>"#;
        assert!(matches!(
            sniff_embed_page("https://byselapuix.com/e/x", byse_html),
            SniffedEmbed::Dead
        ));
        // Unknown page passes through.
        assert!(matches!(
            sniff_embed_page("https://example.com/e/x", "<html><body>hi</body></html>"),
            SniffedEmbed::Unknown
        ));
    }

    #[test]
    fn is_voe_url_matches_embed_hosts() {
        assert!(is_voe_url("https://voe.sx/e/6tmjy171qf2g"));
        assert!(!is_voe_url("https://animeav1.uns.bio/#o8wi3v"));
        assert!(!is_voe_url("https://www.mp4upload.com/embed-x.html"));
    }

    #[test]
    fn is_dead_file_host_covers_fichier_and_mega_variants() {
        assert!(is_dead_file_host("https://1fichier.com/?4yut51p3vqdw1i7xbdfm"));
        assert!(is_dead_file_host("https://mega.nz/embed/WtoFxRbA#rI2R2FIp"));
        assert!(is_dead_file_host("https://mega.io/embed/abc123"));
        assert!(is_dead_file_host("https://mega.co.nz/file/xyz#key"));
        assert!(!is_dead_file_host("https://animeav1.uns.bio/#o8wi3v"));
        assert!(!is_dead_file_host("https://www.mp4upload.com/embed-j70hobym0b7k.html"));
        assert!(!is_dead_file_host("https://player.zilla-networks.com/m3u8/abc"));
    }

    #[test]
    fn mp4upload_extract_direct_url_reads_player_src() {
        let html = r#"<script>
        var player = videojs("player", {}, function(){
        player.src({
            type: "video/mp4",
            src: "https://a4.mp4upload.com:183/d/xkxzk3fez3b4quuotsrraziqjg6uyrgxnys5hr6s3jy32ravtr6hieudeuz4uixrd3oezlju/video.mp4"
           });
        });</script>"#;
        assert_eq!(
            mp4upload_extract_direct_url(html).as_deref(),
            Some("https://a4.mp4upload.com:183/d/xkxzk3fez3b4quuotsrraziqjg6uyrgxnys5hr6s3jy32ravtr6hieudeuz4uixrd3oezlju/video.mp4")
        );
        // No player.src -> no match.
        assert_eq!(mp4upload_extract_direct_url("<html></html>"), None);
        // Poster/other src attributes must not match.
        assert_eq!(
            mp4upload_extract_direct_url(r#"player.poster("https://a4.mp4upload.com/i/02960/x.jpg")"#),
            None
        );
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
        // Regresión: los segmentos Zilla responden 403 sin fetch-metadata de
        // navegador. Este test usa EXACTAMENTE los headers que el scraper
        // entrega a MPV (candidate.headers) y exige 200.
        let mut failures = 0;
        for (query, season, episode) in cases {
            let Ok((candidates, _)) = search_and_resolve(&client, query, season, episode).await
            else {
                eprintln!("SEG-PROBE {query}: resolve failed");
                failures += 1;
                continue;
            };
            let Some(hls) = candidates.iter().find(|s| s.url.contains("m3u8")) else {
                eprintln!("SEG-PROBE {query}: no hls");
                failures += 1;
                continue;
            };
            let mut playlist_req = client.get(&hls.url);
            for (k, v) in hls.headers.iter().flatten() {
                playlist_req = playlist_req.header(k, v);
            }
            let text = playlist_req
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            let Some(seg) = text.lines().find(|l| !l.starts_with('#')) else {
                eprintln!("SEG-PROBE {query}: no segment line");
                failures += 1;
                continue;
            };
            let seg_url = if seg.starts_with("http") {
                seg.to_string()
            } else {
                let base = hls.url.rsplit_once('/').map(|(b, _)| b.to_string()).unwrap();
                format!("{base}/{seg}")
            };
            let mut seg_req = client.get(&seg_url);
            for (k, v) in hls.headers.iter().flatten() {
                seg_req = seg_req.header(k, v);
            }
            let status = seg_req
                .send()
                .await
                .map(|r| r.status().as_u16())
                .unwrap_or(0);
            eprintln!("SEG-PROBE {query:24} {status} {seg_url}");
            if status != 200 {
                failures += 1;
            }
        }
        assert_eq!(failures, 0, "some HLS segments rejected the shipped playback headers");
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

    #[tokio::test]
    #[ignore = "requires the live VOE provider"]
    async fn resolves_live_voe_embed() {
        let client = crate::scraper::http::build_scraper_client().unwrap();
        let (stream_url, headers) =
            resolve_voe(&client, "https://voe.sx/e/6tmjy171qf2g")
                .await
                .expect("VOE resolve");
        assert!(stream_url.contains("master.m3u8"), "got: {stream_url}");
        assert!(headers.contains_key("Referer"));
    }
}
