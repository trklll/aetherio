use super::generic::build_search_url;
use super::sites::ScraperSite;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScrapeEntryTarget {
    pub url: String,
    pub is_detail_page: bool,
}

fn tmdb_id(external_id: Option<&str>) -> Option<&str> {
    external_id?
        .strip_prefix("tmdb:")
        .filter(|value| !value.is_empty() && value.chars().all(|char| char.is_ascii_digit()))
}

fn query_target(site: &ScraperSite, path: &str, query: &str) -> ScrapeEntryTarget {
    ScrapeEntryTarget {
        url: build_search_url(site.base_url, path, query),
        is_detail_page: false,
    }
}

pub fn build_entry_target(
    site: &ScraperSite,
    query: &str,
    media_type: &str,
    external_id: Option<&str>,
    season: Option<u32>,
    episode: Option<u32>,
) -> ScrapeEntryTarget {
    match site.id {
        "cineby" => {
            if let Some(id) = tmdb_id(external_id) {
                let content_type = if media_type == "movie" { "movie" } else { "tv" };
                let mut url = format!("{}/es/{}/{}?play=true", site.base_url, content_type, id);
                if content_type == "tv" {
                    if let Some(value) = season {
                        url.push_str(&format!("&season={value}"));
                    }
                    if let Some(value) = episode {
                        url.push_str(&format!("&episode={value}"));
                    }
                }
                return ScrapeEntryTarget {
                    url,
                    is_detail_page: true,
                };
            }
            query_target(site, "/es/search?query={query}", query)
        }
        "rive" => query_target(site, "/search?query={query}", query),
        "flixer" => query_target(site, "/search?query={query}", query),
        "miruro" => query_target(site, "/search?query={query}", query),
        "kickassanime" => query_target(site, "/search?query={query}", query),
        "animetsu" => query_target(site, "/search?query={query}", query),
        _ => query_target(site, site.search_path, query),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scraper::sites::{get_site_by_id, SiteCategory};

    #[test]
    fn cineby_uses_tmdb_detail_page() {
        let site = get_site_by_id("cineby").unwrap();
        let target = build_entry_target(
            &site,
            "The Last of Us",
            "series",
            Some("tmdb:100088"),
            Some(1),
            Some(2),
        );
        assert!(target.is_detail_page);
        assert_eq!(
            target.url,
            "https://cineby.at/es/tv/100088?play=true&season=1&episode=2"
        );
    }

    #[test]
    fn anime_adapters_use_encoded_query_parameters() {
        let site = get_site_by_id("miruro").unwrap();
        assert_eq!(site.category, SiteCategory::Anime);
        let target = build_entry_target(&site, "Naruto Shippuden", "anime", None, None, None);
        assert!(!target.is_detail_page);
        assert_eq!(
            target.url,
            "https://miruro.to/search?query=Naruto%20Shippuden"
        );
    }
}
