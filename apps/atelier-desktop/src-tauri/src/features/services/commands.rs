use std::io::{Read, Seek, SeekFrom};
use std::process::Command;

use serde::Serialize;

use super::discovery::{self, Listener};
use super::favicon;
use super::health::{self, HealthResult};
use super::launchd::{self, LaunchdState};
use super::order;
use super::registry::{self, KnownListener, ServiceDef, ServiceKind};
use super::unmanaged;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub def: ServiceDef,
    pub launchd: Option<LaunchdState>,
    pub listener: Option<Listener>,
    pub health: Option<HealthResult>,
    pub log_path: Option<String>,
    /// Cached favicon as a data URL; kept while the service is down.
    pub favicon: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicesSnapshot {
    pub config_path: String,
    pub config_error: Option<String>,
    pub services: Vec<ServiceStatus>,
    /// Listening sockets no registered service claims.
    pub unregistered: Vec<Listener>,
    /// Notes on unregistered ports from services.yaml.
    pub known: Vec<KnownListener>,
}

/// Probe target: explicit `health`, else the root of the local port.
/// `localhost` rather than 127.0.0.1: Vite binds only [::1] by default, and
/// the connector tries every address `localhost` resolves to.
fn health_url(def: &ServiceDef) -> Option<String> {
    def.health
        .clone()
        .or_else(|| def.port.map(|port| format!("http://localhost:{}/", port)))
}

#[tauri::command]
pub async fn list_services() -> Result<ServicesSnapshot, String> {
    let (defs, config_error) = match registry::load() {
        Ok(defs) => (defs, None),
        Err(error) => (Vec::new(), Some(error)),
    };

    let (listeners, local) = tokio::task::spawn_blocking({
        let defs = defs.clone();
        move || {
            let listeners = discovery::listeners().unwrap_or_default();
            let local: Vec<(Option<LaunchdState>, Option<String>)> = defs
                .iter()
                .map(|def| {
                    (
                        launchd::label_for(def).map(|label| launchd::state(&label)),
                        launchd::log_path(def).map(|p| p.display().to_string()),
                    )
                })
                .collect();
            (listeners, local)
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let client = health::client();
    let favicon_client = favicon::client();
    let mut probes = tokio::task::JoinSet::new();
    let mut icons = tokio::task::JoinSet::new();
    for (index, def) in defs.iter().enumerate() {
        let own_favicon = favicon::icon_site(def).is_none();
        if !own_favicon {
            // A chosen site's icon does not depend on the service answering.
            let favicon_client = favicon_client.clone();
            let def = def.clone();
            icons.spawn(async move { favicon::refresh(&favicon_client, &def).await });
        }
        if let Some(url) = health_url(def) {
            let client = client.clone();
            let favicon_client = favicon_client.clone();
            let def = def.clone();
            probes.spawn(async move {
                let result = health::probe(&client, url).await;
                if own_favicon && result.status_code.is_some_and(|code| code < 500) {
                    favicon::refresh(&favicon_client, &def).await;
                }
                (index, result)
            });
        }
    }
    let mut health_results: Vec<Option<HealthResult>> = vec![None; defs.len()];
    while icons.join_next().await.is_some() {}
    while let Some(result) = probes.join_next().await {
        if let Ok((index, result)) = result {
            health_results[index] = Some(result);
        }
    }

    let claimed: std::collections::HashSet<u16> = defs.iter().filter_map(|d| d.port).collect();
    let unregistered = listeners
        .iter()
        .filter(|l| !claimed.contains(&l.port))
        .cloned()
        .collect();

    let services = defs
        .into_iter()
        .zip(local)
        .zip(health_results)
        .map(|((def, (launchd, log_path)), health)| ServiceStatus {
            listener: def
                .port
                .and_then(|port| listeners.iter().find(|l| l.port == port).cloned()),
            favicon: favicon::cached(&def),
            def,
            launchd,
            health,
            log_path,
        })
        .collect();

    Ok(ServicesSnapshot {
        config_path: registry::config_path().display().to_string(),
        config_error,
        services,
        unregistered,
        // A broken file already shows as config_error; notes just go missing.
        known: registry::load_known().unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn start_service(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || launchd::start(&registry::find(&id)?))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stop_service(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || stop_any(&registry::find(&id)?))
        .await
        .map_err(|e| e.to_string())?
}

/// Port held by a process that Atelier's launchd job does not own: a dev
/// server started in a terminal, or orphaned when that terminal closed.
fn unmanaged_port(def: &ServiceDef) -> Option<u16> {
    if def.kind != ServiceKind::Process {
        return None;
    }
    let port = def.port?;
    let label = launchd::label_for(def)?;
    (!launchd::state(&label).loaded && unmanaged::is_listening(port)).then_some(port)
}

/// Stops the service however it runs: Atelier's own job is booted out, a
/// process outside Atelier is signalled through its process group.
fn stop_any(def: &ServiceDef) -> Result<(), String> {
    match unmanaged_port(def) {
        Some(port) => unmanaged::stop(port),
        None => launchd::stop(def),
    }
}

#[tauri::command]
pub async fn restart_service(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let def = registry::find(&id)?;
        // For an unmanaged service this hands it over to Atelier.
        stop_any(&def)?;
        launchd::start(&def)
    })
    .await
    .map_err(|e| e.to_string())?
}

const LOG_TAIL_BYTES: u64 = 64 * 1024;

/// Last `lines` lines of the service log, reading at most the final 64 KB.
#[tauri::command]
pub async fn read_service_log(id: String, lines: Option<usize>) -> Result<String, String> {
    let def = registry::find(&id)?;
    let path = launchd::log_path(&def).ok_or("this service has no log file")?;
    let mut file = match std::fs::File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(format!("{}: {}", path.display(), error)),
    };

    let len = file.metadata().map_err(|e| e.to_string())?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(LOG_TAIL_BYTES)))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

    let text = strip_ansi(&String::from_utf8_lossy(&bytes));
    // Spinners redraw with `\r`; only the last redraw of a line is what a terminal would show.
    let all: Vec<&str> = text
        .lines()
        .map(|line| line.rsplit('\r').next().unwrap_or(line))
        .collect();
    let keep = lines.unwrap_or(300);
    Ok(all[all.len().saturating_sub(keep)..].join("\n"))
}

/// Removes terminal escape sequences: CSI (`ESC [ … final`), OSC
/// (`ESC ] … BEL` or `ESC ] … ESC \`) and two-byte `ESC x` sequences.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('[') => {
                // Parameter and intermediate bytes, then one final byte in @..~.
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            Some(']') => {
                while let Some(c) = chars.next() {
                    if c == '\u{7}' {
                        break;
                    }
                    if c == '\u{1b}' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::strip_ansi;

    #[test]
    fn strips_csi_colors_and_keeps_text() {
        assert_eq!(
            strip_ansi("\u{1b}[38;2;255;71;133m│\u{1b}[39m ready \u{1b}[1mok\u{1b}[0m"),
            "│ ready ok"
        );
    }

    #[test]
    fn strips_osc_hyperlinks() {
        assert_eq!(
            strip_ansi("\u{1b}]8;;https://x.dev\u{7}link\u{1b}]8;;\u{1b}\\ done"),
            "link done"
        );
    }

    #[test]
    fn strips_cursor_moves_and_unicode_survives() {
        assert_eq!(strip_ansi("\u{1b}[2K\u{1b}[1G● 1.02 s"), "● 1.02 s");
    }
}

#[tauri::command]
pub async fn open_services_config() -> Result<(), String> {
    registry::load().ok();
    Command::new("open")
        .arg("-t")
        .arg(registry::config_path())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_services_order() -> Result<order::ServicesOrder, String> {
    Ok(order::load())
}

#[tauri::command]
pub async fn save_services_order(order: order::ServicesOrder) -> Result<(), String> {
    tokio::task::spawn_blocking(move || order::save(&order))
        .await
        .map_err(|e| e.to_string())?
}
