use super::{ScrapedStream, ScrapedSubtitle};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::header::{ORIGIN, REFERER};
use serde::Deserialize;
use std::collections::HashMap;

const CINEBY_ORIGIN: &str = "https://www.cineby.at";
const CINEBY_REFERER: &str = "https://www.cineby.at/";
const CINEBY_API: &str = "https://api.speedracelight.com";
const CINEBY_DB: &str = "https://db.speedracelight.com/3";
const GOLDEN_RATIO: u32 = 2_654_435_769;
const MAGIC: [u8; 4] = [109, 118, 109, 49];

#[derive(Debug, Deserialize)]
struct SeedResponse {
    seed: String,
}

#[derive(Debug, Default, Deserialize)]
struct ExternalIds {
    imdb_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MediaMetadata {
    title: Option<String>,
    name: Option<String>,
    release_date: Option<String>,
    first_air_date: Option<String>,
    #[serde(default)]
    external_ids: ExternalIds,
}

#[derive(Debug, Deserialize)]
struct FindResult {
    id: u32,
}

#[derive(Debug, Default, Deserialize)]
struct FindResponse {
    #[serde(default)]
    movie_results: Vec<FindResult>,
    #[serde(default)]
    tv_results: Vec<FindResult>,
}

#[derive(Debug, Deserialize)]
struct SourcePayload {
    #[serde(default)]
    sources: Vec<CinebySource>,
    #[serde(default)]
    subtitles: Vec<CinebySubtitle>,
}

#[derive(Debug, Deserialize)]
struct CinebySource {
    url: String,
    quality: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CinebySubtitle {
    url: String,
    lang: Option<String>,
    language: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Default)]
struct HlsMetadata {
    quality: Option<String>,
    languages: Vec<String>,
}

fn hls_attribute(line: &str, name: &str) -> Option<String> {
    let marker = format!("{name}=");
    let rest = &line[line.find(&marker)? + marker.len()..];
    let value = if let Some(quoted) = rest.strip_prefix('"') {
        quoted.split('"').next().unwrap_or_default()
    } else {
        rest.split(',').next().unwrap_or_default()
    };
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn parse_hls_metadata(playlist: &str) -> HlsMetadata {
    let mut max_height = None::<u32>;
    let mut languages = Vec::<String>::new();
    for line in playlist.lines().map(str::trim) {
        if line.starts_with("#EXT-X-STREAM-INF:") {
            let height = hls_attribute(line, "RESOLUTION")
                .and_then(|resolution| resolution.split_once('x').map(|(_, height)| height.to_string()))
                .and_then(|height| height.parse::<u32>().ok());
            if let Some(height) = height {
                max_height = Some(max_height.map_or(height, |current| current.max(height)));
            }
        }
        if line.starts_with("#EXT-X-MEDIA:") && hls_attribute(line, "TYPE").as_deref() == Some("AUDIO") {
            if let Some(language) = hls_attribute(line, "NAME").or_else(|| hls_attribute(line, "LANGUAGE")) {
                if !languages.iter().any(|item| item.eq_ignore_ascii_case(&language)) {
                    languages.push(language);
                }
            }
        }
    }
    let quality = max_height.map(|height| match height {
        2000.. => "2160p".to_string(),
        1000.. => "1080p".to_string(),
        700.. => "720p".to_string(),
        _ => format!("{height}p"),
    });
    HlsMetadata { quality, languages }
}

async fn inspect_hls_metadata(client: &reqwest::Client, url: &str) -> HlsMetadata {
    if !url.to_ascii_lowercase().contains(".m3u8") {
        return HlsMetadata::default();
    }
    let Ok(response) = client
        .get(url)
        .header(REFERER, CINEBY_REFERER)
        .header(ORIGIN, CINEBY_ORIGIN)
        .send()
        .await
    else {
        return HlsMetadata::default();
    };
    let Ok(response) = response.error_for_status() else {
        return HlsMetadata::default();
    };
    response
        .text()
        .await
        .map(|playlist| parse_hls_metadata(&playlist))
        .unwrap_or_default()
}

fn mix(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(2_246_822_507);
    value ^= value >> 13;
    value = value.wrapping_mul(3_266_489_909);
    value ^ (value >> 16)
}

fn initial_state(seed: &str, media_id: u32) -> ([Option<u32>; 61], u32) {
    let mut hash = 2_166_136_261_u32;
    for code_unit in seed.encode_utf16() {
        hash = (hash ^ u32::from(code_unit)).wrapping_mul(16_777_619);
    }

    let mut state = mix(mix(hash) ^ mix(media_id ^ GOLDEN_RATIO));
    let mut values = [None; 61];
    for index in 0..8_u32 {
        let slot = (state % 61) as usize;
        state = state
            .wrapping_add(GOLDEN_RATIO)
            .rotate_left(7 + (7 & index));
        values[slot] = Some(state ^ mix(state));
        state = mix(state.wrapping_add(slot as u32));
    }

    (values, mix(2_779_096_485 ^ state))
}

fn next_word(values: &mut [Option<u32>; 61], acc: &mut u32, index: u32) -> u32 {
    let slot = (*acc % 61) as usize;
    let present_mask = 0_u32.wrapping_sub(u32::from(values[slot].is_some()));
    let slot_value = values[slot].unwrap_or(0);
    let product = slot_value ^ GOLDEN_RATIO.wrapping_mul(index.wrapping_add(1));
    let combined = (*acc ^ product) | (*acc & product & present_mask);
    let combined = combined.wrapping_add(*acc).rotate_left((slot as u32) & 31)
        ^ acc.rotate_left(((slot as u32).wrapping_mul(7)) & 31);
    let next = mix(combined.wrapping_add(GOLDEN_RATIO));
    values[slot] = Some(next);
    *acc = next;
    next
}

fn decrypt_payload(payload: &str, seed: &str, media_id: u32) -> Result<String, String> {
    let encoded = payload.trim().trim_end_matches('=');
    let mut bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|error| format!("Cineby payload is not valid base64url: {error}"))?;
    let (mut values, mut acc) = initial_state(seed, media_id);

    for (index, chunk) in bytes.chunks_mut(4).enumerate() {
        let word = next_word(&mut values, &mut acc, index as u32);
        for (offset, byte) in chunk.iter_mut().enumerate() {
            *byte ^= ((word >> (offset * 8)) & 0xff) as u8;
        }
    }

    if !bytes.starts_with(&MAGIC) {
        return Err("Cineby rejected the source payload seed".to_string());
    }

    String::from_utf8(bytes[MAGIC.len()..].to_vec())
        .map_err(|error| format!("Cineby payload is not UTF-8: {error}"))
}

fn tmdb_id(external_id: Option<&str>) -> Option<u32> {
    let value = external_id?.trim();
    let numeric = value.strip_prefix("tmdb:").unwrap_or(value);
    numeric.parse().ok()
}

fn imdb_id(external_id: Option<&str>) -> Option<&str> {
    let value = external_id?.trim();
    let value = value.strip_prefix("imdb:").unwrap_or(value);
    (value.starts_with("tt")
        && value[2..]
            .chars()
            .all(|character| character.is_ascii_digit()))
    .then_some(value)
}

async fn resolve_media_id(
    client: &reqwest::Client,
    external_id: Option<&str>,
    media_type: &str,
) -> Result<u32, String> {
    if let Some(media_id) = tmdb_id(external_id) {
        return Ok(media_id);
    }

    let imdb = imdb_id(external_id)
        .ok_or_else(|| "Cineby direct playback requires a TMDB or IMDb id".to_string())?;
    let response = client
        .get(format!("{CINEBY_DB}/find/{imdb}"))
        .header(REFERER, CINEBY_REFERER)
        .header(ORIGIN, CINEBY_ORIGIN)
        .query(&[("external_source", "imdb_id"), ("language", "en-US")])
        .send()
        .await
        .map_err(|error| format!("Cineby IMDb lookup failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Cineby IMDb lookup response failed: {error}"))?
        .json::<FindResponse>()
        .await
        .map_err(|error| format!("Cineby IMDb lookup could not be decoded: {error}"))?;
    let result = if media_type == "movie" {
        response.movie_results.first()
    } else {
        response.tv_results.first()
    };
    result
        .map(|item| item.id)
        .ok_or_else(|| format!("Cineby could not map IMDb id {imdb} to TMDB"))
}

fn release_year(metadata: &MediaMetadata) -> String {
    metadata
        .release_date
        .as_deref()
        .or(metadata.first_air_date.as_deref())
        .and_then(|date| date.get(..4))
        .unwrap_or_default()
        .to_string()
}

pub async fn resolve(
    client: &reqwest::Client,
    query: &str,
    media_type: &str,
    external_id: Option<&str>,
    season: Option<u32>,
    episode: Option<u32>,
    embed_url: &str,
) -> Result<Vec<ScrapedStream>, String> {
    let media_id = resolve_media_id(client, external_id, media_type).await?;
    let cineby_type = if media_type == "movie" { "movie" } else { "tv" };
    let metadata_url = format!("{CINEBY_DB}/{cineby_type}/{media_id}");
    let metadata = client
        .get(metadata_url)
        .header(REFERER, CINEBY_REFERER)
        .header(ORIGIN, CINEBY_ORIGIN)
        .query(&[
            ("append_to_response", "external_ids"),
            ("language", "en-US"),
        ])
        .send()
        .await
        .map_err(|error| format!("Cineby metadata request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Cineby metadata response failed: {error}"))?
        .json::<MediaMetadata>()
        .await
        .map_err(|error| format!("Cineby metadata could not be decoded: {error}"))?;

    let seed = client
        .get(format!("{CINEBY_API}/seed"))
        .header(REFERER, CINEBY_REFERER)
        .header(ORIGIN, CINEBY_ORIGIN)
        .query(&[("mediaId", media_id)])
        .send()
        .await
        .map_err(|error| format!("Cineby seed request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Cineby seed response failed: {error}"))?
        .json::<SeedResponse>()
        .await
        .map_err(|error| format!("Cineby seed could not be decoded: {error}"))?;

    let year = release_year(&metadata);
    let imdb_id = metadata.external_ids.imdb_id.clone().unwrap_or_default();
    let title = metadata
        .title
        .or(metadata.name)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| query.to_string());
    let params = vec![
        ("title", title.clone()),
        ("mediaType", cineby_type.to_string()),
        ("year", year),
        ("episodeId", episode.unwrap_or(1).to_string()),
        ("seasonId", season.unwrap_or(1).to_string()),
        ("tmdbId", media_id.to_string()),
        ("imdbId", imdb_id),
        ("enc", "2".to_string()),
        ("seed", seed.seed.clone()),
    ];
    let encrypted_body = client
        .get(format!("{CINEBY_API}/cdn/sources-with-title"))
        .header(REFERER, CINEBY_REFERER)
        .header(ORIGIN, CINEBY_ORIGIN)
        .query(&params)
        .send()
        .await
        .map_err(|error| format!("Cineby source request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Cineby source response failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Cineby source payload could not be read: {error}"))?;
    let encrypted = serde_json::from_str::<String>(encrypted_body.trim())
        .unwrap_or_else(|_| encrypted_body.trim().to_string());
    let decoded = decrypt_payload(&encrypted, &seed.seed, media_id)?;
    let payload: SourcePayload = serde_json::from_str(&decoded)
        .map_err(|error| format!("Cineby source payload is invalid: {error}"))?;

    let subtitles = payload
        .subtitles
        .into_iter()
        .enumerate()
        .filter(|(_, subtitle)| subtitle.url.starts_with("http"))
        .map(|(index, subtitle)| ScrapedSubtitle {
            id: Some(format!("cineby-{media_id}-{index}")),
            url: subtitle.url,
            lang: subtitle.lang,
            language: subtitle.language,
            title: subtitle.title,
        })
        .collect::<Vec<_>>();
    let headers = HashMap::from([
        ("Referer".to_string(), CINEBY_REFERER.to_string()),
        ("Origin".to_string(), CINEBY_ORIGIN.to_string()),
    ]);
    let mut streams = Vec::new();
    for source in payload.sources.into_iter().filter(|source| source.url.starts_with("http")) {
        let hls_metadata = inspect_hls_metadata(client, &source.url).await;
        let quality = source
            .quality
            .filter(|value| !value.trim().is_empty() && !value.eq_ignore_ascii_case("auto"))
            .or(hls_metadata.quality);
        streams.push(ScrapedStream {
            id: format!("cineby|{}", source.url),
            url: source.url,
            name: "Cineby".to_string(),
            title: Some(title.clone()),
            quality,
            languages: (!hls_metadata.languages.is_empty()).then_some(hls_metadata.languages),
            site_id: "cineby".to_string(),
            site_name: "Cineby".to_string(),
            embed_url: Some(embed_url.to_string()),
            headers: Some(headers.clone()),
            subtitles: (!subtitles.is_empty()).then(|| subtitles.clone()),
        });
    }

    if streams.is_empty() {
        return Err("Cineby returned no direct media sources".to_string());
    }
    Ok(streams)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_quality_and_audio_languages_from_master_playlist() {
        let metadata = parse_hls_metadata(r#"#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="es",NAME="Español"
#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080,AUDIO="audio"
video-1080.m3u8"#);
        assert_eq!(metadata.quality.as_deref(), Some("1080p"));
        assert_eq!(metadata.languages, vec!["English", "Español"]);
    }

    #[test]
    fn decrypts_reference_payload() {
        let decoded =
            decrypt_payload("ghJfzLuW9lGZ1AoOw_tfbKhU", "cineby-test-seed", 27205).unwrap();
        assert_eq!(decoded, r#"{"sources":[]}"#);
    }

    #[test]
    fn parses_tmdb_ids() {
        assert_eq!(tmdb_id(Some("tmdb:27205")), Some(27205));
        assert_eq!(tmdb_id(Some("27205")), Some(27205));
        assert_eq!(tmdb_id(Some("tt1375666")), None);
        assert_eq!(imdb_id(Some("tt1375666")), Some("tt1375666"));
        assert_eq!(imdb_id(Some("imdb:tt1375666")), Some("tt1375666"));
        assert_eq!(imdb_id(Some("tmdb:27205")), None);
    }

    #[tokio::test]
    #[ignore = "requires the live Cineby provider"]
    async fn resolves_live_hls_sources() {
        let client = crate::scraper::http::build_scraper_client().unwrap();
        let streams = resolve(
            &client,
            "Inception",
            "movie",
            Some("tt1375666"),
            None,
            None,
            "https://www.cineby.at/es/movie/27205?play=true",
        )
        .await
        .unwrap();

        assert!(!streams.is_empty());
        assert!(streams.iter().all(|stream| stream.url.contains(".m3u8")));
        assert!(streams.iter().any(|stream| stream.quality.is_some()));

        let manifest = client
            .get(&streams[0].url)
            .header(REFERER, CINEBY_REFERER)
            .header(ORIGIN, CINEBY_ORIGIN)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(manifest.trim_start().starts_with("#EXTM3U"));
    }
}
