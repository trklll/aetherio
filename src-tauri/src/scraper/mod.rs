pub mod adapters;
pub mod cineby;
pub mod generic;
pub mod http;
pub mod provider_http;
pub mod sites;

use adapters::build_entry_target;
use generic::{extract_detail_urls, extract_embed_urls, extract_stream_urls, follow_embed_chain};
use http::build_scraper_client;
use serde::Serialize;
use sites::{
    all_recommended_sites, get_site_by_id, is_enabled_by_default, ScraperSite, SiteCategory,
};
use std::sync::Arc;
use tokio::sync::Semaphore;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedSubtitle {
    pub id: Option<String>,
    pub url: String,
    pub lang: Option<String>,
    pub language: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedStream {
    pub id: String,
    pub url: String,
    pub name: String,
    pub title: Option<String>,
    pub quality: Option<String>,
    pub languages: Option<Vec<String>>,
    pub site_id: String,
    pub site_name: String,
    pub embed_url: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub subtitles: Option<Vec<ScrapedSubtitle>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScraperSiteInfo {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub category: String,
    pub types: Vec<String>,
    pub enabled_by_default: bool,
}

fn site_category_string(cat: SiteCategory) -> String {
    match cat {
        SiteCategory::Aggregator => "aggregator".to_string(),
        SiteCategory::DedicatedServer => "dedicated_server".to_string(),
        SiteCategory::MultiServer => "multi_server".to_string(),
        SiteCategory::Anime => "anime".to_string(),
        SiteCategory::FreeWithAds => "free_with_ads".to_string(),
    }
}

fn site_info_from_site(site: &ScraperSite) -> ScraperSiteInfo {
    ScraperSiteInfo {
        id: site.id.to_string(),
        name: site.name.to_string(),
        base_url: site.base_url.to_string(),
        category: site_category_string(site.category),
        types: site.types.iter().map(|s| s.to_string()).collect(),
        enabled_by_default: is_enabled_by_default(site),
    }
}

async fn scrape_single_site(
    client: &reqwest::Client,
    site: &ScraperSite,
    query: &str,
    media_type: &str,
    external_id: Option<&str>,
    season: Option<u32>,
    episode: Option<u32>,
) -> Vec<ScrapedStream> {
    let entry_target = build_entry_target(site, query, media_type, external_id, season, episode);
    let search_url = entry_target.url;

    if site.id == "cineby" {
        match cineby::resolve(
            client,
            query,
            media_type,
            external_id,
            season,
            episode,
            &search_url,
        )
        .await
        {
            Ok(streams) if !streams.is_empty() => return streams,
            Ok(_) => {}
            Err(error) => eprintln!("[scraper:cineby] direct resolution failed: {error}"),
        }
    }

    let search_html = match generic::fetch_page(client, &search_url).await {
        Ok(html) => html,
        Err(_) => return vec![],
    };

    let mut detail_paths = Vec::new();
    if entry_target.is_detail_page {
        detail_paths.push(search_url.clone());
    }
    let search_embeds = extract_embed_urls(&search_html);
    for (embed_url, _) in &search_embeds {
        let resolved = generic::resolve_relative_url(embed_url, site.base_url);
        detail_paths.push(resolved);
    }

    for resolved in extract_detail_urls(&search_html, site.base_url, query) {
        if !detail_paths.contains(&resolved) {
            detail_paths.push(resolved);
        }
    }

    let title_re = regex::Regex::new(r#"<title[^>]*>([^<]+)</title>"#).unwrap();
    let page_title = title_re
        .captures(&search_html)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().trim().to_string());

    let mut all_streams: Vec<ScrapedStream> = Vec::new();

    let direct_streams = extract_stream_urls(&search_html);
    for candidate in direct_streams {
        all_streams.push(ScrapedStream {
            id: format!("{}|{}", site.id, candidate.url),
            url: candidate.url,
            name: site.name.to_string(),
            title: page_title.clone(),
            quality: candidate.quality,
            languages: None,
            site_id: site.id.to_string(),
            site_name: site.name.to_string(),
            embed_url: None,
            headers: None,
            subtitles: None,
        });
    }

    let detail_limit = std::cmp::min(detail_paths.len(), 3);
    for detail_path in &detail_paths[..detail_limit] {
        let detail_streams = follow_embed_chain(client, detail_path, 2)
            .await
            .unwrap_or_default();

        let detail_title = {
            let html = generic::fetch_page(client, detail_path)
                .await
                .unwrap_or_default();
            title_re
                .captures(&html)
                .and_then(|cap| cap.get(1))
                .map(|m| m.as_str().trim().to_string())
                .or_else(|| page_title.clone())
        };

        for candidate in detail_streams {
            all_streams.push(ScrapedStream {
                id: format!("{}|{}", site.id, candidate.url),
                url: candidate.url,
                name: site.name.to_string(),
                title: detail_title.clone(),
                quality: candidate.quality,
                languages: None,
                site_id: site.id.to_string(),
                site_name: site.name.to_string(),
                embed_url: Some(detail_path.clone()),
                headers: None,
                subtitles: None,
            });
        }
    }

    all_streams
}

pub async fn scrape_from_sites(
    query: String,
    media_type: String,
    external_id: Option<String>,
    season: Option<u32>,
    episode: Option<u32>,
    site_ids: Option<Vec<String>>,
) -> Result<Vec<ScrapedStream>, String> {
    let client = build_scraper_client()?;
    let client = Arc::new(client);

    let target_sites: Vec<ScraperSite> = if let Some(ids) = &site_ids {
        ids.iter().filter_map(|id| get_site_by_id(id)).collect()
    } else {
        sites::sites_for_type(&media_type)
    };

    if target_sites.is_empty() {
        return Ok(vec![]);
    }

    let semaphore = Arc::new(Semaphore::new(5));
    let mut handles = Vec::new();

    for site in target_sites {
        let client = Arc::clone(&client);
        let sem = Arc::clone(&semaphore);
        let query = query.clone();
        let media_type = media_type.clone();
        let external_id = external_id.clone();
        let season = season;
        let episode = episode;

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            scrape_single_site(
                &client,
                &site,
                &query,
                &media_type,
                external_id.as_deref(),
                season,
                episode,
            )
            .await
        }));
    }

    let mut all_streams = Vec::new();
    for handle in handles {
        if let Ok(streams) = handle.await {
            all_streams.extend(streams);
        }
    }

    dedupe_and_sort(&mut all_streams);
    Ok(all_streams)
}

fn dedupe_and_sort(streams: &mut Vec<ScrapedStream>) {
    let mut seen = std::collections::HashSet::new();
    streams.retain(|s| !is_lookup_page_url(&s.url) && seen.insert(s.url.clone()));
    streams.sort_by(|a, b| {
        let quality_order = |q: &Option<String>| match q.as_deref() {
            Some("4K") => 0,
            Some("1080p") => 1,
            Some("720p") => 2,
            Some("480p") => 3,
            _ => 4,
        };
        quality_order(&a.quality).cmp(&quality_order(&b.quality))
    });
}

fn is_lookup_page_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return true;
    };
    let has_search_route = url.path_segments().is_some_and(|segments| {
        segments.into_iter().any(|segment| {
            matches!(
                segment.to_ascii_lowercase().as_str(),
                "search" | "buscar" | "busqueda" | "query"
            )
        })
    });
    let has_query_parameter = url
        .query_pairs()
        .any(|(key, _)| matches!(key.to_ascii_lowercase().as_str(), "query" | "search"));
    has_search_route || has_query_parameter
}

#[tauri::command]
pub async fn scrape_streams(
    query: String,
    media_type: String,
    external_id: Option<String>,
    season: Option<u32>,
    episode: Option<u32>,
    sites: Option<Vec<String>>,
) -> Result<Vec<ScrapedStream>, String> {
    if query.trim().is_empty() {
        return Err("Query cannot be empty.".to_string());
    }

    scrape_from_sites(query, media_type, external_id, season, episode, sites).await
}

#[tauri::command]
pub async fn get_scraper_sites() -> Result<Vec<ScraperSiteInfo>, String> {
    Ok(all_recommended_sites()
        .iter()
        .map(site_info_from_site)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    use sites::SearchStyle;

    #[test]
    fn site_category_string_coverage() {
        assert_eq!(site_category_string(SiteCategory::Aggregator), "aggregator");
        assert_eq!(
            site_category_string(SiteCategory::DedicatedServer),
            "dedicated_server"
        );
        assert_eq!(
            site_category_string(SiteCategory::MultiServer),
            "multi_server"
        );
        assert_eq!(site_category_string(SiteCategory::Anime), "anime");
        assert_eq!(
            site_category_string(SiteCategory::FreeWithAds),
            "free_with_ads"
        );
    }

    #[test]
    fn site_info_from_site_preserves_all_fields() {
        let site = ScraperSite {
            id: "test",
            name: "Test Site",
            base_url: "https://test.com",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        };
        let info = site_info_from_site(&site);
        assert_eq!(info.id, "test");
        assert_eq!(info.name, "Test Site");
        assert_eq!(info.base_url, "https://test.com");
        assert_eq!(info.category, "aggregator");
        assert_eq!(info.types, vec!["movie", "series"]);
        assert!(!info.enabled_by_default);
    }

    #[test]
    fn dedupe_and_sort_removes_duplicates() {
        let mut streams = vec![
            ScrapedStream {
                id: "a|1".into(),
                url: "https://same.com/video.m3u8".into(),
                name: "A".into(),
                title: None,
                quality: Some("720p".into()),
                languages: None,
                site_id: "a".into(),
                site_name: "A".into(),
                embed_url: None,
                headers: None,
                subtitles: None,
            },
            ScrapedStream {
                id: "b|1".into(),
                url: "https://same.com/video.m3u8".into(),
                name: "B".into(),
                title: None,
                quality: Some("1080p".into()),
                languages: None,
                site_id: "b".into(),
                site_name: "B".into(),
                embed_url: None,
                headers: None,
                subtitles: None,
            },
        ];
        dedupe_and_sort(&mut streams);
        assert_eq!(streams.len(), 1);
    }

    #[test]
    fn dedupe_and_sort_sorts_by_quality() {
        let mut streams = vec![
            ScrapedStream {
                id: "1".into(),
                url: "https://a.com/480.m3u8".into(),
                name: "A".into(),
                title: None,
                quality: Some("480p".into()),
                languages: None,
                site_id: "a".into(),
                site_name: "A".into(),
                embed_url: None,
                headers: None,
                subtitles: None,
            },
            ScrapedStream {
                id: "2".into(),
                url: "https://b.com/1080.m3u8".into(),
                name: "B".into(),
                title: None,
                quality: Some("1080p".into()),
                languages: None,
                site_id: "b".into(),
                site_name: "B".into(),
                embed_url: None,
                headers: None,
                subtitles: None,
            },
            ScrapedStream {
                id: "3".into(),
                url: "https://c.com/720.m3u8".into(),
                name: "C".into(),
                title: None,
                quality: Some("720p".into()),
                languages: None,
                site_id: "c".into(),
                site_name: "C".into(),
                embed_url: None,
                headers: None,
                subtitles: None,
            },
        ];
        dedupe_and_sort(&mut streams);
        assert_eq!(streams[0].quality, Some("1080p".into()));
        assert_eq!(streams[1].quality, Some("720p".into()));
        assert_eq!(streams[2].quality, Some("480p".into()));
    }

    #[test]
    fn dedupe_and_sort_handles_empty() {
        let mut streams: Vec<ScrapedStream> = vec![];
        dedupe_and_sort(&mut streams);
        assert!(streams.is_empty());
    }

    #[test]
    fn dedupe_and_sort_rejects_search_and_query_pages() {
        let mut streams = vec![
            ScrapedStream {
                id: "search".into(),
                url: "https://cineby.at/es/search?query=Hunter".into(),
                name: "Search".into(),
                title: None,
                quality: None,
                languages: None,
                site_id: "test".into(),
                site_name: "Test".into(),
                embed_url: None,
                headers: None,
                subtitles: None,
            },
            ScrapedStream {
                id: "media".into(),
                url: "https://cdn.example/video/master.m3u8?token=valid".into(),
                name: "Media".into(),
                title: None,
                quality: Some("1080p".into()),
                languages: None,
                site_id: "test".into(),
                site_name: "Test".into(),
                embed_url: None,
                headers: None,
                subtitles: None,
            },
        ];

        dedupe_and_sort(&mut streams);

        assert_eq!(streams.len(), 1);
        assert_eq!(streams[0].id, "media");
    }

    #[tokio::test]
    async fn scrape_streams_rejects_empty_query() {
        let result =
            scrape_streams("".to_string(), "movie".to_string(), None, None, None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn scrape_streams_with_nonexistent_site() {
        let result = scrape_streams(
            "test".to_string(),
            "movie".to_string(),
            None,
            None,
            None,
            Some(vec!["nonexistent".to_string()]),
        )
        .await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn get_scraper_sites_returns_all() {
        let sites = get_scraper_sites().await.unwrap();
        assert!(sites.len() >= 25);
        for site in &sites {
            assert!(!site.id.is_empty());
            assert!(!site.name.is_empty());
            assert!(site.base_url.starts_with("https://"));
        }
    }
}
