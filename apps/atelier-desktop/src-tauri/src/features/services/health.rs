use std::time::{Duration, Instant};

use serde::Serialize;

const TIMEOUT: Duration = Duration::from_secs(3);

/// Raw result of one HTTP probe. Interpreting it (up / degraded / down) is the UI's job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResult {
    pub url: String,
    pub status_code: Option<u16>,
    pub latency_ms: u64,
    pub error: Option<String>,
}

pub async fn probe(client: &reqwest::Client, url: String) -> HealthResult {
    let started = Instant::now();
    let response = client.get(&url).timeout(TIMEOUT).send().await;
    let latency_ms = started.elapsed().as_millis() as u64;

    match response {
        Ok(response) => HealthResult {
            url,
            status_code: Some(response.status().as_u16()),
            latency_ms,
            error: None,
        },
        Err(error) => HealthResult {
            url,
            status_code: None,
            latency_ms,
            error: Some(if error.is_timeout() {
                "timeout".to_string()
            } else if error.is_connect() {
                "connection refused".to_string()
            } else {
                "request failed".to_string()
            }),
        },
    }
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        // Probes target the service itself; following redirects can land on an auth page elsewhere.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_default()
}
