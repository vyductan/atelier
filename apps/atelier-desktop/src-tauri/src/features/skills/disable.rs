//! Disable a skill for every agent at once, without uninstalling it.
//!
//! skills.sh has no disable: each skill is one real folder in
//! `~/.agents/skills/<name>` and every agent sees it through a symlink into
//! that folder. Disabling therefore moves three things aside, and enabling
//! puts them back:
//!
//! - the folder → `~/.agents/skills-disabled/<name>`
//! - its `~/.agents/.skill-lock.json` entry → `skills-disabled/.skill-lock.json`.
//!   Left in place, `skills update` re-downloads the skill into
//!   `~/.agents/skills` the next time upstream changes.
//! - the agents' symlinks to it (removed, recorded, recreated on enable), so no
//!   agent is left holding a dangling link.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};

const LOCK_FILE: &str = ".skill-lock.json";

fn agents_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(Path::new(&home).join(".agents"))
}

/// The name becomes a path segment, so it must be exactly one.
fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.starts_with('.')
        || name.contains('/')
        || name.contains('\\')
    {
        return Err(format!("Invalid skill name: {name:?}"));
    }
    Ok(())
}

fn read_lock(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(json!({ "version": 3, "skills": {} }))
        }
        Err(e) => Err(format!("Failed to read {}: {e}", path.display())),
    }
}

/// Write to a sibling temp file and rename, so a crash never leaves the
/// skills CLI a half-written lock file.
fn write_lock(path: &Path, lock: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(lock).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.atelier-tmp");
    fs::write(&tmp, text + "\n")
        .and_then(|()| fs::rename(&tmp, path))
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

fn skills_map(lock: &mut Value) -> Result<&mut Map<String, Value>, String> {
    if !lock.get("skills").is_some_and(Value::is_object) {
        lock["skills"] = json!({});
    }
    lock["skills"]
        .as_object_mut()
        .ok_or_else(|| "Lock file has no skills object".to_string())
}

/// Agent skill folders: `~/.<agent>/skills` and `~/.<agent>/<sub>/skills`
/// (e.g. `~/.gemini/config/skills`). Deduped by real path, since some are
/// themselves symlinks to another (`~/.gemini/antigravity/skills`).
fn agent_skill_dirs(home: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let Ok(entries) = fs::read_dir(home) else {
        return candidates;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        let is_hidden = entry.file_name().to_string_lossy().starts_with('.');
        // ~/.agents/skills is the store itself, not an agent's view of it.
        if !is_hidden || !dir.is_dir() || entry.file_name() == ".agents" {
            continue;
        }
        candidates.push(dir.join("skills"));
        if let Ok(subs) = fs::read_dir(&dir) {
            for sub in subs.flatten() {
                if sub.path().is_dir() {
                    candidates.push(sub.path().join("skills"));
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|dir| dir.is_dir())
        .filter(|dir| fs::canonicalize(dir).is_ok_and(|real| seen.insert(real)))
        .collect()
}

/// Every symlink in an agent folder that resolves to `target`, with its raw
/// link text so it can be recreated byte for byte.
fn links_to(home: &Path, target: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut links = Vec::new();
    for dir in agent_skill_dirs(home) {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(raw) = fs::read_link(&path) else {
                continue;
            };
            if fs::canonicalize(&path).is_ok_and(|real| real == target) {
                links.push((path, raw));
            }
        }
    }
    links
}

#[tauri::command]
pub async fn disable_skill(skill_name: String) -> Result<(), String> {
    check_name(&skill_name)?;
    let agents = agents_dir()?;
    let home = agents.parent().unwrap_or(&agents).to_path_buf();
    let src = agents.join("skills").join(&skill_name);
    let disabled_dir = agents.join("skills-disabled");
    let dst = disabled_dir.join(&skill_name);

    let real = fs::canonicalize(&src)
        .map_err(|e| format!("{skill_name} is not in {}: {e}", src.display()))?;
    if dst.symlink_metadata().is_ok() {
        return Err(format!("{} already exists", dst.display()));
    }
    let links = links_to(&home, &real);

    fs::create_dir_all(&disabled_dir).map_err(|e| e.to_string())?;
    fs::rename(&src, &dst).map_err(|e| format!("Failed to move {skill_name}: {e}"))?;

    // The folder is already aside; from here on a failure is reported but
    // `enable_skill` can still put everything back.
    let lock_path = agents.join(LOCK_FILE);
    let disabled_lock_path = disabled_dir.join(LOCK_FILE);
    let mut lock = read_lock(&lock_path)?;
    let mut disabled_lock = read_lock(&disabled_lock_path)?;
    if let Some(entry) = skills_map(&mut lock)?.remove(&skill_name) {
        skills_map(&mut disabled_lock)?.insert(skill_name.clone(), entry);
        write_lock(&disabled_lock_path, &disabled_lock)?;
        write_lock(&lock_path, &lock)?;
    }

    let mut recorded = Vec::new();
    for (path, raw) in links {
        if fs::remove_file(&path).is_ok() {
            recorded.push(json!({ "path": path, "target": raw }));
        }
    }
    if !recorded.is_empty() {
        if !disabled_lock.get("links").is_some_and(Value::is_object) {
            disabled_lock["links"] = json!({});
        }
        disabled_lock["links"][&skill_name] = Value::Array(recorded);
        write_lock(&disabled_lock_path, &disabled_lock)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn enable_skill(skill_name: String) -> Result<(), String> {
    check_name(&skill_name)?;
    let agents = agents_dir()?;
    let disabled_dir = agents.join("skills-disabled");
    let src = disabled_dir.join(&skill_name);
    let dst = agents.join("skills").join(&skill_name);

    if src.symlink_metadata().is_err() {
        return Err(format!("{skill_name} is not disabled"));
    }
    if dst.symlink_metadata().is_ok() {
        return Err(format!(
            "{} already exists (reinstalled while disabled?)",
            dst.display()
        ));
    }
    fs::rename(&src, &dst).map_err(|e| format!("Failed to move {skill_name}: {e}"))?;

    let lock_path = agents.join(LOCK_FILE);
    let disabled_lock_path = disabled_dir.join(LOCK_FILE);
    let mut lock = read_lock(&lock_path)?;
    let mut disabled_lock = read_lock(&disabled_lock_path)?;
    let links = disabled_lock
        .get_mut("links")
        .and_then(Value::as_object_mut)
        .and_then(|links| links.remove(&skill_name));
    if let Some(entry) = skills_map(&mut disabled_lock)?.remove(&skill_name) {
        skills_map(&mut lock)?.insert(skill_name.clone(), entry);
        write_lock(&lock_path, &lock)?;
    }
    write_lock(&disabled_lock_path, &disabled_lock)?;

    let mut failed = Vec::new();
    for link in links.as_ref().and_then(Value::as_array).into_iter().flatten() {
        let (Some(path), Some(target)) = (
            link.get("path").and_then(Value::as_str),
            link.get("target").and_then(Value::as_str),
        ) else {
            continue;
        };
        let path = Path::new(path);
        if path.symlink_metadata().is_ok() {
            continue; // something already sits there; leave it alone
        }
        if std::os::unix::fs::symlink(target, path).is_err() {
            failed.push(path.display().to_string());
        }
    }
    if failed.is_empty() {
        Ok(())
    } else {
        Err(format!("Enabled, but could not relink: {}", failed.join(", ")))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisabledSkill {
    name: String,
    path: String,
    source: Option<String>,
    installed_at: Option<String>,
    updated_at: Option<String>,
}

#[tauri::command]
pub async fn list_disabled_skills() -> Result<Vec<DisabledSkill>, String> {
    let disabled_dir = agents_dir()?.join("skills-disabled");
    let Ok(entries) = fs::read_dir(&disabled_dir) else {
        return Ok(Vec::new());
    };
    let lock = read_lock(&disabled_dir.join(LOCK_FILE))?;
    let field = |name: &str, key: &str| {
        lock.get("skills")
            .and_then(|skills| skills.get(name))
            .and_then(|entry| entry.get(key))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let mut skills: Vec<DisabledSkill> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if name.starts_with('.') {
                return None;
            }
            Some(DisabledSkill {
                source: field(&name, "source"),
                installed_at: field(&name, "installedAt"),
                updated_at: field(&name, "updatedAt"),
                path: entry.path().display().to_string(),
                name,
            })
        })
        .collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_names_that_are_not_one_segment() {
        for bad in ["", ".", "..", "../x", "a/b", ".skill-lock.json"] {
            assert!(check_name(bad).is_err(), "{bad:?} should be rejected");
        }
        assert!(check_name("grill-with-docs").is_ok());
    }

    /// The only test that touches HOME, so it cannot race another test.
    #[test]
    fn disable_then_enable_round_trips_folder_lock_and_links() {
        use std::os::unix::fs::symlink;
        let home = std::env::temp_dir().join(format!("atelier-disable-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        let agents = home.join(".agents");
        fs::create_dir_all(agents.join("skills/alpha")).unwrap();
        fs::write(agents.join("skills/alpha/SKILL.md"), "x").unwrap();
        fs::write(
            agents.join(LOCK_FILE),
            r#"{"version":3,"skills":{"zeta":{"source":"z"},"alpha":{"source":"me/skills"}}}"#,
        )
        .unwrap();
        fs::create_dir_all(home.join(".claude/skills")).unwrap();
        fs::create_dir_all(home.join(".gemini/config/skills")).unwrap();
        symlink("../../.agents/skills/alpha", home.join(".claude/skills/alpha")).unwrap();
        symlink("../../../.agents/skills/alpha", home.join(".gemini/config/skills/alpha")).unwrap();
        // A folder that is itself a link to another must not be visited twice.
        symlink(home.join(".gemini/config/skills"), home.join(".gemini/antigravity")).unwrap();
        std::env::set_var("HOME", &home);
        use tauri::async_runtime::block_on as run;

        run(disable_skill("alpha".into())).unwrap();
        assert!(!agents.join("skills/alpha").exists());
        assert!(agents.join("skills-disabled/alpha/SKILL.md").exists());
        assert!(home.join(".claude/skills/alpha").symlink_metadata().is_err());
        assert!(home.join(".gemini/config/skills/alpha").symlink_metadata().is_err());
        let lock = read_lock(&agents.join(LOCK_FILE)).unwrap();
        assert!(lock["skills"].get("alpha").is_none());
        assert_eq!(lock["skills"]["zeta"]["source"], "z");
        let listed = run(list_disabled_skills()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].source.as_deref(), Some("me/skills"));
        assert!(run(disable_skill("alpha".into())).is_err());

        run(enable_skill("alpha".into())).unwrap();
        assert!(agents.join("skills/alpha/SKILL.md").exists());
        assert!(home.join(".claude/skills/alpha/SKILL.md").exists());
        assert!(home.join(".gemini/config/skills/alpha/SKILL.md").exists());
        let lock = read_lock(&agents.join(LOCK_FILE)).unwrap();
        assert_eq!(lock["skills"]["alpha"]["source"], "me/skills");
        // Key order survives, so the skills CLI's file does not churn.
        let keys: Vec<_> = lock["skills"].as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["zeta", "alpha"]);
        assert!(run(list_disabled_skills()).unwrap().is_empty());

        fs::remove_dir_all(&home).unwrap();
    }
}
