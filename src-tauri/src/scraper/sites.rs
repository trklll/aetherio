use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SiteCategory {
    Aggregator,
    DedicatedServer,
    MultiServer,
    Anime,
    FreeWithAds,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SearchStyle {
    UrlSlug,
    QueryParam,
    #[allow(dead_code)]
    PostBody,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScraperSite {
    pub id: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    pub category: SiteCategory,
    pub search_style: SearchStyle,
    pub search_path: &'static str,
    pub types: &'static [&'static str],
    pub enabled_by_default: bool,
}

const DEFAULT_SCRAPER_SITE_IDS: &[&str] = &[
    "cineby",
    "rive",
    "flixer",
    "miruro",
    "kickassanime",
    "animetsu",
    "okru",
];

pub fn all_recommended_sites() -> Vec<ScraperSite> {
    vec![
        ScraperSite {
            id: "okru",
            name: "OK.ru",
            base_url: "https://ok.ru",
            category: SiteCategory::DedicatedServer,
            search_style: SearchStyle::QueryParam,
            search_path: "/video/search?st.v.sq={query}",
            types: &["movie"],
            enabled_by_default: true,
        },
        // ── Stream Aggregators ────────────────────────────────────────────
        ScraperSite {
            id: "cineby",
            name: "Cineby",
            base_url: "https://cineby.at",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "rive",
            name: "Rive",
            base_url: "https://www.rivestream.app",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "flixer",
            name: "Flixer",
            base_url: "https://flixer.su",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "popcornmovies",
            name: "PopcornMovies",
            base_url: "https://popcornmovies.io",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "67movies",
            name: "67Movies",
            base_url: "https://67movies.nl",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "coreflix",
            name: "Coreflix",
            base_url: "https://coreflix.tv",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "flickystream",
            name: "FlickyStream",
            base_url: "https://flickystream.su",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "bcine",
            name: "bCine",
            base_url: "https://bcine.ru",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "shuttletv",
            name: "ShuttleTV",
            base_url: "https://shuttletv.su",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "goated",
            name: "GOATED",
            base_url: "https://goated.cx",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "nextbox",
            name: "Nextbox",
            base_url: "https://nextbox.uno",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "cinema_bz",
            name: "Cinema.BZ",
            base_url: "https://cinema.bz",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "smashystream",
            name: "SmashyStream",
            base_url: "https://smashystream.xyz",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "movienight",
            name: "Movie Night",
            base_url: "https://movienig.ht",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        // ── P-Stream Forks ────────────────────────────────────────────────
        ScraperSite {
            id: "aether",
            name: "Aether",
            base_url: "https://aether.bar",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "zstream",
            name: "Z-Stream",
            base_url: "https://zstream.mov",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "streamwatch",
            name: "StreamWatch",
            base_url: "https://streamwatch.online",
            category: SiteCategory::Aggregator,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        // ── Dedicated Server ──────────────────────────────────────────────
        ScraperSite {
            id: "bingr",
            name: "Bingr",
            base_url: "https://bingr.one",
            category: SiteCategory::DedicatedServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "nepu",
            name: "NEPU",
            base_url: "https://nepu.to",
            category: SiteCategory::DedicatedServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "watchflux",
            name: "WatchFlux",
            base_url: "https://watchflux.tv",
            category: SiteCategory::DedicatedServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "m4uhd",
            name: "M4uHD",
            base_url: "https://m4uhd.vip",
            category: SiteCategory::DedicatedServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        // ── Multi-Server ──────────────────────────────────────────────────
        ScraperSite {
            id: "cinemaos",
            name: "CinemaOS",
            base_url: "https://cinemaos.live",
            category: SiteCategory::MultiServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "primeshows",
            name: "Primeshows",
            base_url: "https://www.primeshows.org",
            category: SiteCategory::MultiServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "aurorascreen",
            name: "AuroraScreen",
            base_url: "https://www.aurorascreen.org",
            category: SiteCategory::MultiServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "anixtv",
            name: "Anixtv",
            base_url: "https://anixx.fun",
            category: SiteCategory::MultiServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "hydrahd",
            name: "HydraHD",
            base_url: "https://hydrahd.com",
            category: SiteCategory::MultiServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "vidbox",
            name: "Vidbox",
            base_url: "https://vidbox.dev",
            category: SiteCategory::MultiServer,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: true,
        },
        // ── Anime ─────────────────────────────────────────────────────────
        ScraperSite {
            id: "miruro",
            name: "Miruro",
            base_url: "https://miruro.to",
            category: SiteCategory::Anime,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search?query={query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "kickassanime",
            name: "KickAssAnime",
            base_url: "https://kaa.lt",
            category: SiteCategory::Anime,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search?query={query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "animetsu",
            name: "Animetsu",
            base_url: "https://animetsu.net",
            category: SiteCategory::Anime,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search?query={query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        ScraperSite {
            id: "animex",
            name: "AnimeX",
            base_url: "https://animex.one",
            category: SiteCategory::Anime,
            search_style: SearchStyle::UrlSlug,
            search_path: "/search/{query}",
            types: &["movie", "series", "anime"],
            enabled_by_default: true,
        },
        // ── Free w/ Ads ───────────────────────────────────────────────────
        ScraperSite {
            id: "tubi",
            name: "Tubi",
            base_url: "https://tubitv.com",
            category: SiteCategory::FreeWithAds,
            search_style: SearchStyle::QueryParam,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: false,
        },
        ScraperSite {
            id: "plex",
            name: "Plex",
            base_url: "https://watch.plex.tv",
            category: SiteCategory::FreeWithAds,
            search_style: SearchStyle::QueryParam,
            search_path: "/search/{query}",
            types: &["movie", "series"],
            enabled_by_default: false,
        },
    ]
}

pub fn get_site_by_id(id: &str) -> Option<ScraperSite> {
    all_recommended_sites().into_iter().find(|s| s.id == id)
}

pub fn enabled_sites() -> Vec<ScraperSite> {
    all_recommended_sites()
        .into_iter()
        .filter(is_enabled_by_default)
        .collect()
}

pub fn is_enabled_by_default(site: &ScraperSite) -> bool {
    site.enabled_by_default && DEFAULT_SCRAPER_SITE_IDS.contains(&site.id)
}

pub fn sites_for_type(media_type: &str) -> Vec<ScraperSite> {
    let normalized = match media_type {
        "tv" => "series",
        other => other,
    };
    enabled_sites()
        .into_iter()
        .filter(|s| s.types.contains(&normalized))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_sites_have_unique_ids() {
        let sites = all_recommended_sites();
        let mut ids: Vec<&str> = sites.iter().map(|s| s.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), sites.len(), "Duplicate site IDs found");
    }

    #[test]
    fn all_sites_have_valid_urls() {
        for site in all_recommended_sites() {
            assert!(
                site.base_url.starts_with("https://"),
                "Site {} has invalid URL: {}",
                site.id,
                site.base_url
            );
            assert!(
                !site.base_url.ends_with('/'),
                "Site {} base_url should not end with /: {}",
                site.id,
                site.base_url
            );
        }
    }

    #[test]
    fn all_sites_have_search_path() {
        for site in all_recommended_sites() {
            assert!(
                site.search_path.contains("{query}"),
                "Site {} search_path missing {{query}}: {}",
                site.id,
                site.search_path
            );
        }
    }

    #[test]
    fn all_sites_have_non_empty_types() {
        for site in all_recommended_sites() {
            assert!(!site.types.is_empty(), "Site {} has no types", site.id);
        }
    }

    #[test]
    fn get_site_by_id_works() {
        let site = get_site_by_id("cineby");
        assert!(site.is_some());
        assert_eq!(site.unwrap().name, "Cineby");
    }

    #[test]
    fn get_site_by_id_returns_none_for_unknown() {
        assert!(get_site_by_id("nonexistent_site").is_none());
    }

    #[test]
    fn sites_for_type_movie() {
        let movie_sites = sites_for_type("movie");
        assert!(!movie_sites.is_empty(), "Should have movie sites");
        for site in &movie_sites {
            assert!(
                site.types.contains(&"movie"),
                "Site {} listed for movie but doesn't support it",
                site.id
            );
        }
    }

    #[test]
    fn sites_for_type_anime() {
        let anime_sites = sites_for_type("anime");
        assert!(!anime_sites.is_empty(), "Should have anime sites");
        for site in &anime_sites {
            assert!(
                site.types.contains(&"anime"),
                "Site {} listed for anime but doesn't support it",
                site.id
            );
        }
    }

    #[test]
    fn sites_for_type_tv_maps_to_series() {
        let tv_sites = sites_for_type("tv");
        let series_sites = sites_for_type("series");
        assert_eq!(tv_sites.len(), series_sites.len());
    }

    #[test]
    fn enabled_sites_excludes_disabled() {
        let enabled = enabled_sites();
        assert_eq!(enabled.len(), DEFAULT_SCRAPER_SITE_IDS.len());
        for site in &enabled {
            assert!(
                site.enabled_by_default,
                "Site {} should be enabled",
                site.id
            );
            assert!(DEFAULT_SCRAPER_SITE_IDS.contains(&site.id));
        }
    }

    #[test]
    fn total_recommended_site_count() {
        let sites = all_recommended_sites();
        assert!(
            sites.len() >= 25,
            "Expected at least 25 recommended sites, got {}",
            sites.len()
        );
    }
}
