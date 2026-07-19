use reqwest::Client;
use std::time::Duration;

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT_SECS: u64 = 12;

pub fn build_scraper_client() -> Result<Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::ACCEPT,
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            .parse()
            .map_err(|e| format!("Invalid Accept header: {}", e))?,
    );
    headers.insert(
        reqwest::header::ACCEPT_LANGUAGE,
        "en-US,en;q=0.9,es;q=0.8"
            .parse()
            .map_err(|e| format!("Invalid Accept-Language header: {}", e))?,
    );

    Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .user_agent(DEFAULT_USER_AGENT)
        .default_headers(headers)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

#[allow(dead_code)]
pub fn build_request_for_site(
    client: &Client,
    url: &str,
    referer: &str,
) -> reqwest::RequestBuilder {
    client.get(url).header(reqwest::header::REFERER, referer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_scraper_client_succeeds() {
        let client = build_scraper_client();
        assert!(client.is_ok(), "Client build failed: {:?}", client.err());
    }

    #[test]
    fn build_request_for_site_sets_referer() {
        let client = build_scraper_client().unwrap();
        let req =
            build_request_for_site(&client, "https://example.com/page", "https://example.com");
        let built = req.build().unwrap();
        assert_eq!(
            built.headers().get(reqwest::header::REFERER).unwrap(),
            "https://example.com"
        );
    }

    #[test]
    fn build_request_for_site_sets_method_get() {
        let client = build_scraper_client().unwrap();
        let req =
            build_request_for_site(&client, "https://example.com/page", "https://example.com");
        let built = req.build().unwrap();
        assert_eq!(built.method(), reqwest::Method::GET);
    }
}
