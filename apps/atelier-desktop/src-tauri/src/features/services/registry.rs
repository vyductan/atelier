use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// How a service is run.
/// - `process`: Atelier generates a launchd agent for `cmd` and owns it.
/// - `launchd`: an existing launchd agent identified by `label`.
/// - `remote`: nothing to run locally, only `health` is probed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceKind {
    Process,
    Launchd,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDef {
    pub id: String,
    pub kind: ServiceKind,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub cmd: Option<String>,
    /// Run before unloading, for commands that start detached work (e.g. `supabase start`).
    #[serde(default)]
    pub stop_cmd: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub health: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub log: Option<String>,
    /// Overrides the icon the UI infers from `kind`/`cmd` (e.g. `database`).
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub keep_alive: bool,
}

/// Which listening sockets a `known` entry describes; every field given must match.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct KnownMatch {
    /// lsof's command name (often cut to 9 chars) or the executable's file name.
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    /// launchd job label.
    #[serde(default)]
    pub label: Option<String>,
}

/// A note on a port nobody registered as a service: what it is, which group
/// it belongs to, whether to fold it away.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownListener {
    #[serde(rename = "match")]
    pub matcher: KnownMatch,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub hide: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RegistryFile {
    #[serde(default)]
    services: Vec<ServiceDef>,
    #[serde(default)]
    known: Vec<KnownListener>,
}

const SEED: &str = r#"# Atelier services registry.
# kind: process  -> Atelier runs `cmd` as a launchd agent (dev.atelier.svc.<id>), logs in ~/.atelier/logs/<id>.log
# kind: launchd  -> existing launchd agent `label`
# kind: remote   -> only `health` is probed
# icon (optional): database | container | book-open | cloud | cog | globe | terminal | server | bot
# known: notes on ports no service claims, e.g.
#   - match: { command: socat1, port: 8045 }   # also: label (launchd job)
#     note: what it is
#     group: Antigravity Tools
#     hide: true                              # fold into the hidden list
services:
  - id: vyductan-web
    name: vyductan.dev (local)
    group: vyductan.dev
    kind: process
    cwd: ~/Developer/vyductan/apps/vyductan.dev
    cmd: pnpm dev:web
    port: 3000
    url: http://localhost:3000

  - id: supabase-e2e
    name: Supabase (e2e)
    group: vyductan.dev
    kind: process
    cwd: ~/Developer/vyductan/apps/vyductan.dev/apps/e2e
    cmd: supabase start
    stop_cmd: supabase stop
    port: 55421
    health: http://127.0.0.1:55421/rest/v1/
    url: http://127.0.0.1:55423

  - id: test-lab
    name: Test Lab
    group: tools
    kind: process
    cwd: ~/Developer/vyductan/apps/test-lab
    cmd: pnpm dev
    port: 5180
    url: http://127.0.0.1:5180

  - id: voice-agent
    name: Voice agent gate
    group: tools
    kind: launchd
    label: dev.vyductan.voice-agent
    port: 7860

  - id: vyductan-prod
    name: vyductan.dev (prod)
    group: vyductan.dev
    kind: remote
    health: https://vyductan.dev
    url: https://vyductan.dev
"#;

pub fn atelier_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".atelier")
}

pub fn config_path() -> PathBuf {
    atelier_dir().join("services.yaml")
}

pub fn expand_home(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => dirs::home_dir().unwrap_or_default().join(rest),
        None if path == "~" => dirs::home_dir().unwrap_or_default(),
        None => PathBuf::from(path),
    }
}

/// Reads the registry, writing the seed file on first run.
pub fn load() -> Result<Vec<ServiceDef>, String> {
    load_file().map(|file| file.services)
}

/// Notes on unregistered ports (`known:` in services.yaml).
pub fn load_known() -> Result<Vec<KnownListener>, String> {
    load_file().map(|file| file.known)
}

fn load_file() -> Result<RegistryFile, String> {
    let path = config_path();
    if !path.exists() {
        std::fs::create_dir_all(atelier_dir()).map_err(|e| e.to_string())?;
        std::fs::write(&path, SEED).map_err(|e| e.to_string())?;
    }

    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file: RegistryFile = serde_yaml::from_str(&contents)
        .map_err(|e| format!("{}: {}", path.display(), e))?;

    let mut seen = std::collections::HashSet::new();
    for def in &file.services {
        if !seen.insert(def.id.as_str()) {
            return Err(format!("duplicate service id `{}`", def.id));
        }
        match def.kind {
            ServiceKind::Process if def.cmd.is_none() => {
                return Err(format!("service `{}`: kind process needs `cmd`", def.id))
            }
            ServiceKind::Launchd if def.label.is_none() => {
                return Err(format!("service `{}`: kind launchd needs `label`", def.id))
            }
            ServiceKind::Remote if def.health.is_none() => {
                return Err(format!("service `{}`: kind remote needs `health`", def.id))
            }
            _ => {}
        }
    }

    Ok(file)
}

pub fn find(id: &str) -> Result<ServiceDef, String> {
    load()?
        .into_iter()
        .find(|def| def.id == id)
        .ok_or_else(|| format!("unknown service `{}`", id))
}
