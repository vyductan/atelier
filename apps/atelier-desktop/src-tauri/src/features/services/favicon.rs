use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use base64::Engine;

use super::registry::{atelier_dir, ServiceDef};

const MAX_BYTES: usize = 64 * 1024;
const MAX_HTML_BYTES: usize = 512 * 1024;
const TIMEOUT: Duration = Duration::from_secs(3);
/// Favicons rarely change; refetch at most daily, and only while the service answers.
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// Page whose favicon represents the service: the UI `url` first, since
/// `health` often points at an API without one.
pub fn page_url(def: &ServiceDef) -> Option<String> {
    def.url
        .clone()
        .or_else(|| def.health.clone())
        .or_else(|| def.port.map(|port| format!("http://localhost:{}/", port)))
}

/// `icon:` given as a site (`https://stripe.com`): draw that site's favicon,
/// for services with no page of their own (`stripe listen`).
pub fn icon_site(def: &ServiceDef) -> Option<&str> {
    def.icon
        .as_deref()
        .map(str::trim)
        .filter(|icon| icon.starts_with("https://") || icon.starts_with("http://"))
}

/// Cache file name: the id, plus a hash of the chosen site so editing
/// `icon:` fetches the new one instead of waiting out the old cache.
fn cache_key(def: &ServiceDef) -> String {
    use std::hash::{Hash, Hasher};
    match icon_site(def) {
        Some(site) => {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            site.hash(&mut hasher);
            format!("{}-{:x}", def.id, hasher.finish())
        }
        None => def.id.clone(),
    }
}

fn cache_path(id: &str) -> PathBuf {
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    atelier_dir()
        .join("cache")
        .join("favicons")
        .join(format!("{}.dataurl", safe))
}

/// The cached data URL. An empty cache file records "this service has no favicon".
pub fn cached(def: &ServiceDef) -> Option<String> {
    let contents = std::fs::read_to_string(cache_path(&cache_key(def))).ok()?;
    let contents = contents.trim();
    (!contents.is_empty()).then(|| contents.to_string())
}

pub fn is_stale(id: &str) -> bool {
    std::fs::metadata(cache_path(id))
        .and_then(|m| m.modified())
        .map(|modified| {
            SystemTime::now()
                .duration_since(modified)
                .map_or(true, |age| age > STALE_AFTER)
        })
        .unwrap_or(true)
}

fn write_cache(id: &str, data_url: Option<&str>) {
    let path = cache_path(id);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, data_url.unwrap_or_default());
}

/// Splits one tag body (`rel="icon" href=/x.svg`) into lowercase names and values.
fn parse_attributes(tag: &str) -> Vec<(String, String)> {
    let mut attributes = Vec::new();
    let mut rest = tag;

    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '/');
        let name_end = rest
            .find(|c: char| c.is_whitespace() || c == '=' || c == '/' || c == '>')
            .unwrap_or(rest.len());
        if name_end == 0 {
            break;
        }
        let name = rest[..name_end].to_ascii_lowercase();
        rest = rest[name_end..].trim_start();

        let mut value = String::new();
        if let Some(after_eq) = rest.strip_prefix('=') {
            let after_eq = after_eq.trim_start();
            if let Some(quote) = after_eq.chars().next().filter(|c| *c == '"' || *c == '\'') {
                let body = &after_eq[1..];
                let end = body.find(quote).unwrap_or(body.len());
                value = body[..end].to_string();
                rest = body.get(end + 1..).unwrap_or("");
            } else {
                let end = after_eq
                    .find(|c: char| c.is_whitespace() || c == '>')
                    .unwrap_or(after_eq.len());
                value = after_eq[..end].to_string();
                rest = &after_eq[end..];
            }
        }
        attributes.push((name, value));
    }

    attributes
}

/// href of the best icon `<link>` in the page: `rel="icon"` / `"shortcut icon"`,
/// else `apple-touch-icon` (large, but better than nothing).
pub fn parse_icon_href(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut fallback = None;
    let mut cursor = 0;

    while let Some(start) = lower[cursor..].find("<link") {
        let tag_start = cursor + start + "<link".len();
        let Some(len) = lower[tag_start..].find('>') else {
            break;
        };
        cursor = tag_start + len;
        // Byte offsets agree between `html` and `lower`: ASCII lowercasing keeps lengths.
        let attributes = parse_attributes(&html[tag_start..cursor]);
        let get = |name: &str| {
            attributes
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| v.trim().to_string())
        };
        let (Some(rel), Some(href)) = (get("rel"), get("href")) else {
            continue;
        };
        if href.is_empty() {
            continue;
        }
        let rel = rel.to_ascii_lowercase();
        let tokens: Vec<&str> = rel.split_whitespace().collect();
        if tokens.contains(&"icon") {
            return Some(href);
        }
        if fallback.is_none() && tokens.iter().any(|t| t.starts_with("apple-touch-icon")) {
            fallback = Some(href);
        }
    }

    fallback
}

/// Image type from the response header, else from the bytes. `None` means
/// "not an image" (e.g. a login page served in place of /favicon.ico).
fn image_mime(content_type: Option<&str>, bytes: &[u8]) -> Option<String> {
    if let Some(content_type) = content_type {
        let mime = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        if mime.starts_with("image/") {
            return Some(mime);
        }
        if !mime.is_empty() && mime != "application/octet-stream" {
            return None;
        }
    }
    if bytes.starts_with(b"\x89PNG") {
        Some("image/png".into())
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon".into())
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif".into())
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg".into())
    } else if String::from_utf8_lossy(&bytes[..bytes.len().min(256)]).contains("<svg") {
        Some("image/svg+xml".into())
    } else {
        None
    }
}

async fn read_limited(response: reqwest::Response, limit: usize) -> Option<Vec<u8>> {
    if response.content_length().is_some_and(|len| len as usize > limit) {
        return None;
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > limit {
            return None;
        }
    }
    Some(bytes)
}

async fn fetch_image(client: &reqwest::Client, url: reqwest::Url) -> Option<String> {
    let response = client.get(url).timeout(TIMEOUT).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = read_limited(response, MAX_BYTES).await?;
    let mime = image_mime(content_type.as_deref(), &bytes)?;
    Some(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

async fn discover(client: &reqwest::Client, page: &str) -> Option<String> {
    let page = reqwest::Url::parse(page).ok()?;

    // Redirects are followed, so `base` is the page that actually rendered
    // and relative hrefs like `./favicon.svg` resolve against it.
    let mut base = page.clone();
    let mut href = None;
    if let Ok(response) = client.get(page.clone()).timeout(TIMEOUT).send().await {
        base = response.url().clone();
        if let Some(html) = read_limited(response, MAX_HTML_BYTES).await {
            href = parse_icon_href(&String::from_utf8_lossy(&html));
        }
    }

    if let Some(href) = href {
        if href.starts_with("data:image/") {
            return (href.len() <= MAX_BYTES * 4 / 3 + 64).then_some(href);
        }
        if let Some(found) = match base.join(&href) {
            Ok(url) => fetch_image(client, url).await,
            Err(_) => None,
        } {
            return Some(found);
        }
    }

    fetch_image(client, base.join("/favicon.ico").ok()?).await
}

/// Refetches the favicon into the cache when it is stale. For the service's
/// own page, call only while it answers, so a stopped service keeps its last
/// known icon; an `icon:` site can be fetched any time.
pub async fn refresh(client: &reqwest::Client, def: &ServiceDef) {
    let key = cache_key(def);
    if !is_stale(&key) {
        return;
    }
    let Some(page) = icon_site(def).map(str::to_string).or_else(|| page_url(def)) else {
        return;
    };
    let found = discover(client, &page).await;
    write_cache(&key, found.as_deref());
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_rel_icon() {
        let html = r#"<head><link rel="stylesheet" href="/a.css"><link rel="icon" href="/favicon-dev.svg"/></head>"#;
        assert_eq!(parse_icon_href(html).as_deref(), Some("/favicon-dev.svg"));
    }

    #[test]
    fn handles_shortcut_icon_any_order_and_quotes() {
        let html = "<LINK HREF='./favicon.svg' type=\"image/svg+xml\" REL='Shortcut Icon'>";
        assert_eq!(parse_icon_href(html).as_deref(), Some("./favicon.svg"));
    }

    #[test]
    fn handles_unquoted_attributes() {
        let html = "<link rel=icon href=/static/fav.png>";
        assert_eq!(parse_icon_href(html).as_deref(), Some("/static/fav.png"));
    }

    #[test]
    fn prefers_icon_over_apple_touch_icon() {
        let html = r#"<link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/fav.ico">"#;
        assert_eq!(parse_icon_href(html).as_deref(), Some("/fav.ico"));
    }

    #[test]
    fn falls_back_to_apple_touch_icon() {
        let html = r#"<link rel="apple-touch-icon-precomposed" href="/apple.png">"#;
        assert_eq!(parse_icon_href(html).as_deref(), Some("/apple.png"));
    }

    #[test]
    fn ignores_rel_tokens_that_only_contain_icon() {
        // `mask-icon` is Safari's pinned-tab mask, not a favicon.
        let html = r#"<link rel="mask-icon" href="/mask.svg"><link rel="preload" href="/icon.png">"#;
        assert_eq!(parse_icon_href(html), None);
    }

    #[test]
    fn skips_icon_links_without_href() {
        let html = r#"<link rel="icon"><link rel="icon" href="/real.svg">"#;
        assert_eq!(parse_icon_href(html).as_deref(), Some("/real.svg"));
    }

    #[test]
    fn returns_none_without_links() {
        assert_eq!(parse_icon_href("<html><body>hi</body></html>"), None);
    }

    #[test]
    fn resolves_relative_hrefs_against_the_final_page() {
        let base = reqwest::Url::parse("http://localhost:6006/?path=/docs").unwrap();
        assert_eq!(base.join("./favicon.svg").unwrap().as_str(), "http://localhost:6006/favicon.svg");
        let nested = reqwest::Url::parse("http://127.0.0.1:54433/project/default").unwrap();
        assert_eq!(nested.join("favicon.ico").unwrap().as_str(), "http://127.0.0.1:54433/project/favicon.ico");
        assert_eq!(nested.join("/favicon.ico").unwrap().as_str(), "http://127.0.0.1:54433/favicon.ico");
    }

    #[test]
    fn detects_image_types() {
        assert_eq!(image_mime(Some("image/svg+xml; charset=utf-8"), b"").as_deref(), Some("image/svg+xml"));
        assert_eq!(image_mime(None, b"\x89PNG\r\n").as_deref(), Some("image/png"));
        assert_eq!(image_mime(Some("application/octet-stream"), &[0, 0, 1, 0]).as_deref(), Some("image/x-icon"));
        assert_eq!(image_mime(None, br#"<?xml version="1.0"?><svg xmlns="x">"#).as_deref(), Some("image/svg+xml"));
    }

    #[test]
    fn rejects_html_served_as_favicon() {
        assert_eq!(image_mime(Some("text/html; charset=UTF-8"), b"<html>"), None);
        assert_eq!(image_mime(None, b"<!doctype html><html>"), None);
    }

    fn def_with_icon(icon: Option<&str>) -> ServiceDef {
        serde_yaml::from_str(&format!(
            "id: stripe\nkind: process\ncmd: stripe listen\n{}",
            icon.map(|i| format!("icon: {}\n", i)).unwrap_or_default()
        ))
        .unwrap()
    }

    #[test]
    fn takes_only_urls_as_icon_sites() {
        assert_eq!(icon_site(&def_with_icon(Some("https://stripe.com"))), Some("https://stripe.com"));
        assert_eq!(icon_site(&def_with_icon(Some("database"))), None);
        assert_eq!(icon_site(&def_with_icon(None)), None);
    }

    #[test]
    fn keys_the_cache_by_icon_site() {
        let plain = cache_key(&def_with_icon(None));
        let stripe = cache_key(&def_with_icon(Some("https://stripe.com")));
        let other = cache_key(&def_with_icon(Some("https://example.com")));
        assert_eq!(plain, "stripe");
        assert!(stripe.starts_with("stripe-"));
        assert_ne!(stripe, other);
    }

    #[test]
    fn sanitizes_cache_file_names() {
        let path = cache_path("../evil id");
        assert_eq!(path.file_name().unwrap(), "___evil_id.dataurl");
    }
}
