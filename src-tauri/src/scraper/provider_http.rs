use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{header::HeaderMap, Method, Url};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::IpAddr, sync::Arc, time::Duration};
use tokio::sync::Semaphore;

const MAX_REQUEST_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_CONCURRENT_REQUESTS: usize = 16;

pub struct ProviderHttpState {
    client: reqwest::Client,
    semaphore: Arc<Semaphore>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHttpRequest {
    url: String,
    method: Option<String>,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    body_base64: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHttpResponse {
    status: u16,
    status_text: String,
    url: String,
    headers: HashMap<String, String>,
    body_base64: String,
}

impl Default for ProviderHttpState {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .cookie_store(true)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 || !is_safe_url(attempt.url()) {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .expect("provider HTTP client must be constructible");
        Self {
            client,
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS)),
        }
    }
}

fn is_safe_url(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if normalized == "localhost" || normalized.ends_with(".localhost") {
        return false;
    }
    match normalized.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_multicast())
        }
        Ok(IpAddr::V6(ip)) => {
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_unique_local()
                || ip.is_unicast_link_local())
        }
        Err(_) => true,
    }
}

fn response_headers(headers: &HeaderMap) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for name in headers.keys() {
        let values = headers
            .get_all(name)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>()
            .join(", ");
        if !values.is_empty() {
            result.insert(name.as_str().to_string(), values);
        }
    }
    result
}

#[tauri::command]
pub async fn provider_http_request(
    state: tauri::State<'_, ProviderHttpState>,
    request: ProviderHttpRequest,
) -> Result<ProviderHttpResponse, String> {
    let url = Url::parse(request.url.trim())
        .map_err(|error| format!("Provider URL is invalid: {error}"))?;
    if !is_safe_url(&url) {
        return Err("Provider URL is not allowed".to_string());
    }

    let method_name = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase();
    if !matches!(
        method_name.as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "HEAD"
    ) {
        return Err(format!("Provider HTTP method {method_name} is not allowed"));
    }
    let method = Method::from_bytes(method_name.as_bytes())
        .map_err(|error| format!("Provider HTTP method is invalid: {error}"))?;
    let body = match request.body {
        Some(body) if request.body_base64.unwrap_or(false) => STANDARD
            .decode(body)
            .map_err(|error| format!("Provider request body is not valid base64: {error}"))?,
        Some(body) => body.into_bytes(),
        None => Vec::new(),
    };
    if body.len() > MAX_REQUEST_BODY_BYTES {
        return Err("Provider request body exceeds 2 MiB".to_string());
    }

    let _permit = state
        .semaphore
        .acquire()
        .await
        .map_err(|_| "Provider HTTP queue is unavailable".to_string())?;
    let mut builder = state.client.request(method, url);
    for (name, value) in request.headers {
        let normalized = name.trim().to_ascii_lowercase();
        if matches!(
            normalized.as_str(),
            "host" | "content-length" | "connection" | "transfer-encoding"
        ) {
            continue;
        }
        let Ok(name) = reqwest::header::HeaderName::from_bytes(normalized.as_bytes()) else {
            continue;
        };
        let Ok(value) = reqwest::header::HeaderValue::from_str(value.trim()) else {
            continue;
        };
        builder = builder.header(name, value);
    }
    if !body.is_empty() {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("Provider request failed: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
    {
        return Err("Provider response exceeds 16 MiB".to_string());
    }
    let status = response.status();
    let final_url = response.url().to_string();
    let headers = response_headers(response.headers());
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Provider response body failed: {error}"))?;
    if bytes.len() > MAX_RESPONSE_BODY_BYTES {
        return Err("Provider response exceeds 16 MiB".to_string());
    }

    Ok(ProviderHttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or_default().to_string(),
        url: final_url,
        headers,
        body_base64: STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_local_provider_urls() {
        for url in [
            "http://localhost/test",
            "http://127.0.0.1/test",
            "http://10.0.0.1/test",
            "http://[::1]/test",
            "file:///etc/passwd",
        ] {
            assert!(!is_safe_url(&Url::parse(url).unwrap()));
        }
    }

    #[test]
    fn allows_public_provider_urls() {
        assert!(is_safe_url(
            &Url::parse("https://raw.githubusercontent.com/org/repo/main/manifest.json").unwrap()
        ));
        assert!(is_safe_url(
            &Url::parse("https://api.themoviedb.org/3/movie/1").unwrap()
        ));
    }
}
