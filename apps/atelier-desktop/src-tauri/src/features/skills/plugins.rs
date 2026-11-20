//! Skills and slash commands that Claude Code plugins bring along.
//!
//! skills.sh never sees these: a plugin lives in
//! `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, recorded in
//! `~/.claude/plugins/installed_plugins.json`, and is switched on or off as a
//! whole by `enabledPlugins` in `~/.claude/settings.json`. Inside, each
//! `skills/<name>/SKILL.md` is a skill and each `commands/<name>.md` a slash
//! command; Claude Code invokes both as `<plugin>:<name>`. A plugin can also
//! bring subagents (`agents/<name>.md`), MCP servers (`.mcp.json` or
//! `mcpServers` in its manifest) and hooks (`hooks/hooks.json` or `hooks`).
//!
//! Read-only: Atelier lists them, the plugin manager owns them.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkill {
    /// Bare name, as in the folder or file.
    pub name: String,
    /// `<plugin>:<name>`, the key Claude Code invokes it by.
    pub invoke_name: String,
    pub plugin: String,
    pub marketplace: String,
    /// "skill", "command", "agent", "mcp" or "hook".
    pub kind: String,
    pub path: String,
    /// Whether `enabledPlugins` turns the plugin on.
    pub enabled: bool,
    /// One-line summary for kinds without a Markdown description:
    /// an MCP server's URL or command, a hook's commands.
    pub detail: Option<String>,
    pub installed_at: Option<String>,
    pub updated_at: Option<String>,
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Sorted entries of `dir` that `keep` accepts, mapped to (name, path).
fn entries(dir: &Path, keep: impl Fn(&Path) -> Option<(String, PathBuf)>) -> Vec<(String, PathBuf)> {
    let mut found: Vec<_> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| keep(&entry.path()))
        .collect();
    found.sort();
    found
}

/// `${CLAUDE_PLUGIN_ROOT}/x` reads as `x`; the plugin is already named by the group.
fn short_command(command: &str) -> String {
    command
        .replace("\"${CLAUDE_PLUGIN_ROOT}/", "\"")
        .replace("${CLAUDE_PLUGIN_ROOT}/", "")
}

/// A manifest field that is either inline JSON or a path (relative to the
/// plugin root) to a JSON file; falls back to `default_file`.
fn inline_or_file(root: &Path, manifest: &Value, field: &str, default_file: &str) -> Option<(Value, PathBuf)> {
    match manifest.get(field) {
        Some(Value::String(rel)) => {
            let path = root.join(rel.trim_start_matches("./"));
            Some((read_json(&path)?, path))
        }
        Some(inline @ Value::Object(_)) => Some((inline.clone(), root.join(".claude-plugin/plugin.json"))),
        _ => {
            let path = root.join(default_file);
            Some((read_json(&path)?, path))
        }
    }
}

/// (server name, "http · url" / "stdio · command args").
fn mcp_servers(root: &Path, manifest: &Value) -> Vec<(String, PathBuf, String)> {
    let Some((json, path)) = inline_or_file(root, manifest, "mcpServers", ".mcp.json") else {
        return Vec::new();
    };
    // `.mcp.json` may wrap its servers in `mcpServers` or list them bare.
    let servers = json.get("mcpServers").unwrap_or(&json);
    let Some(servers) = servers.as_object() else { return Vec::new() };
    servers
        .iter()
        .filter_map(|(name, config)| {
            let config = config.as_object()?;
            let text = |key: &str| config.get(key).and_then(Value::as_str);
            let detail = if let Some(url) = text("url") {
                format!("{} · {url}", text("type").unwrap_or("http"))
            } else {
                let args: Vec<_> = config
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                let line = std::iter::once(text("command").unwrap_or("?"))
                    .chain(args)
                    .collect::<Vec<_>>()
                    .join(" ");
                format!("stdio · {}", short_command(&line))
            };
            Some((name.clone(), path.clone(), detail))
        })
        .collect()
}

/// One entry per hook event, its commands joined (with the matcher, if any).
fn hook_events(root: &Path, manifest: &Value) -> Vec<(String, PathBuf, String)> {
    let Some((json, path)) = inline_or_file(root, manifest, "hooks", "hooks/hooks.json") else {
        return Vec::new();
    };
    // `hooks.json` wraps events in `hooks`; an inline manifest field is the map itself.
    let events = json.get("hooks").filter(|h| h.is_object()).unwrap_or(&json);
    let Some(events) = events.as_object() else { return Vec::new() };
    events
        .iter()
        .filter_map(|(event, groups)| {
            let lines: Vec<String> = groups
                .as_array()?
                .iter()
                .flat_map(|group| {
                    let matcher = group
                        .get("matcher")
                        .and_then(Value::as_str)
                        .filter(|m| !m.is_empty() && *m != "*");
                    group
                        .get("hooks")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(move |hook| {
                            let what = hook
                                .get("command")
                                .and_then(Value::as_str)
                                .map(short_command)
                                .or_else(|| hook.get("type").and_then(Value::as_str).map(str::to_string))?;
                            Some(match matcher {
                                Some(m) => format!("[{m}] {what}"),
                                None => what,
                            })
                        })
                })
                .collect();
            (!lines.is_empty()).then(|| (event.clone(), path.clone(), lines.join(" · ")))
        })
        .collect()
}

/// Plugin skills from a Claude home folder (`~/.claude`).
pub fn scan(claude_dir: &Path) -> Vec<PluginSkill> {
    let Some(installed) = read_json(&claude_dir.join("plugins/installed_plugins.json")) else {
        return Vec::new();
    };
    let enabled = read_json(&claude_dir.join("settings.json"))
        .and_then(|settings| settings.get("enabledPlugins").cloned())
        .unwrap_or(Value::Null);

    let mut keys: Vec<_> = installed
        .get("plugins")
        .and_then(Value::as_object)
        .map(|plugins| plugins.iter().collect())
        .unwrap_or_default();
    keys.sort_by(|a, b| a.0.cmp(b.0));

    let mut skills = Vec::new();
    for (key, installs) in keys {
        let (plugin, marketplace) = key.split_once('@').unwrap_or((key.as_str(), ""));
        // One entry per scope; a user-scope install is the one that applies everywhere.
        let installs = installs.as_array().map(Vec::as_slice).unwrap_or_default();
        let Some(install) = installs
            .iter()
            .find(|i| i.get("scope").and_then(Value::as_str) == Some("user"))
            .or_else(|| installs.first())
        else {
            continue;
        };
        let Some(root) = install.get("installPath").and_then(Value::as_str).map(PathBuf::from) else {
            continue;
        };
        let text = |field: &str| install.get(field).and_then(Value::as_str).map(str::to_string);
        let is_enabled = enabled.get(key).and_then(Value::as_bool).unwrap_or(false);

        let found_skills = entries(&root.join("skills"), |path| {
            let manifest = path.join("SKILL.md");
            if !manifest.is_file() {
                return None;
            }
            Some((path.file_name()?.to_str()?.to_string(), manifest))
        });
        let found_commands = entries(&root.join("commands"), |path| {
            if path.extension()? != "md" {
                return None;
            }
            Some((path.file_stem()?.to_str()?.to_string(), path.to_path_buf()))
        });

        let found_agents = entries(&root.join("agents"), |path| {
            if path.extension()? != "md" {
                return None;
            }
            Some((path.file_stem()?.to_str()?.to_string(), path.to_path_buf()))
        });
        let manifest = read_json(&root.join(".claude-plugin/plugin.json")).unwrap_or(Value::Null);

        let mut push = |kind: &str, name: String, path: PathBuf, detail: Option<String>| {
            skills.push(PluginSkill {
                invoke_name: format!("{plugin}:{name}"),
                name,
                plugin: plugin.to_string(),
                marketplace: marketplace.to_string(),
                kind: kind.to_string(),
                path: path.to_string_lossy().into_owned(),
                enabled: is_enabled,
                detail,
                installed_at: text("installedAt"),
                updated_at: text("lastUpdated"),
            });
        };
        for (kind, found) in [("skill", found_skills), ("command", found_commands), ("agent", found_agents)] {
            for (name, path) in found {
                push(kind, name, path, None);
            }
        }
        for (name, path, detail) in mcp_servers(&root, &manifest) {
            push("mcp", name, path, Some(detail));
        }
        for (name, path, detail) in hook_events(&root, &manifest) {
            push("hook", name, path, Some(detail));
        }
    }
    skills
}

/// `<plugin>@<marketplace>`, nothing that the CLI could read as a flag.
fn check_plugin_id(id: &str) -> Result<(), String> {
    let ok = id.split_once('@').is_some_and(|(plugin, marketplace)| {
        [plugin, marketplace].iter().all(|part| {
            !part.is_empty()
                && !part.starts_with('-')
                && part.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    });
    ok.then_some(()).ok_or_else(|| format!("Invalid plugin id: {id:?}"))
}

/// Reads the `--json` result line of `claude plugin enable|disable`.
/// "Already in that state" counts as done: the switch only wants the end state.
pub fn interpret_toggle_output(stdout: &str, stderr: &str) -> Result<(), String> {
    let result = stdout
        .lines()
        .find_map(|line| serde_json::from_str::<Value>(line.trim()).ok());
    let Some(result) = result else {
        let detail = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(format!("claude plugin gave no result: {}", detail.trim()));
    };
    let failed = result.get("outcome").and_then(Value::as_str) == Some("failed");
    let settled = result.get("alreadyInGoalState").and_then(Value::as_bool) == Some(true);
    if failed && !settled {
        return Err(result
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("claude plugin failed")
            .to_string());
    }
    Ok(())
}

/// Turns a whole plugin on or off for Claude Code (user scope), through the
/// CLI so `settings.json` is written the way Claude Code expects. Sessions
/// already running keep what they loaded until they reload.
#[tauri::command]
pub async fn set_plugin_enabled(plugin_id: String, enabled: bool) -> Result<(), String> {
    check_plugin_id(&plugin_id)?;
    let verb = if enabled { "enable" } else { "disable" };
    let home = std::env::var("HOME").unwrap_or_default();
    let local = Path::new(&home).join(".local/bin/claude");
    // The app's PATH comes from fix_path_env; fall back to the native installer's spot.
    let program = if local.is_file() { local } else { PathBuf::from("claude") };
    let output = tokio::process::Command::new(program)
        .args(["plugin", verb, &plugin_id, "--scope", "user", "--json"])
        .output()
        .await
        .map_err(|e| format!("Failed to run claude plugin {verb}: {e}"))?;
    interpret_toggle_output(
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    )
}

#[tauri::command]
pub async fn get_plugin_skills() -> Result<Vec<PluginSkill>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let claude_dir = Path::new(&home).join(".claude");
    tokio::task::spawn_blocking(move || scan(&claude_dir))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn lists_skills_and_commands_of_installed_plugins() {
        let tmp = std::env::temp_dir().join(format!("atelier-plugins-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let review = tmp.join("plugins/cache/official/review/1.0");
        let caveman = tmp.join("plugins/cache/cave/caveman/abc");
        write(&review.join("commands/review-pr.md"), "---\n---\n");
        write(&review.join("commands/notes.txt"), "not a command");
        write(&caveman.join("skills/caveman-review/SKILL.md"), "---\n---\n");
        write(&caveman.join("agents/grunt.md"), "---\nname: grunt\n---\n");
        write(
            &caveman.join(".claude-plugin/plugin.json"),
            r#"{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"node \"${CLAUDE_PLUGIN_ROOT}/src/start.js\""}]}]}}"#,
        );
        write(&caveman.join(".mcp.json"), r#"{"tasks":{"type":"http","url":"https://x.dev/mcp"}}"#);
        write(
            &review.join("hooks/hooks.json"),
            r#"{"hooks":{"PostToolUse":[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"bash ${CLAUDE_PLUGIN_ROOT}/hooks/check.sh"}]}]}}"#,
        );
        write(
            &review.join(".mcp.json"),
            r#"{"mcpServers":{"pw":{"command":"npx","args":["@playwright/mcp"]}}}"#,
        );
        fs::create_dir_all(caveman.join("skills/empty-folder")).unwrap();
        write(
            &tmp.join("plugins/installed_plugins.json"),
            &serde_json::json!({ "version": 2, "plugins": {
                "review@official": [
                    { "scope": "project", "installPath": "/nowhere" },
                    { "scope": "user", "installPath": review, "installedAt": "2026-01-01T00:00:00Z" }
                ],
                "caveman@cave": [{ "scope": "user", "installPath": caveman }],
                "gone@official": [{ "scope": "user", "installPath": tmp.join("missing") }]
            }})
            .to_string(),
        );
        write(&tmp.join("settings.json"), r#"{"enabledPlugins":{"caveman@cave":true,"review@official":false}}"#);

        let skills = scan(&tmp);
        let _ = fs::remove_dir_all(&tmp);

        let summary: Vec<_> = skills
            .iter()
            .map(|s| (s.invoke_name.as_str(), s.kind.as_str(), s.enabled))
            .collect();
        assert_eq!(
            summary,
            [
                ("caveman:caveman-review", "skill", true),
                ("caveman:grunt", "agent", true),
                ("caveman:tasks", "mcp", true),
                ("caveman:SessionStart", "hook", true),
                ("review:review-pr", "command", false),
                ("review:pw", "mcp", false),
                ("review:PostToolUse", "hook", false),
            ]
        );
        let detail = |i: usize| skills[i].detail.as_deref();
        assert_eq!(detail(2), Some("http · https://x.dev/mcp"));
        assert_eq!(detail(3), Some("node \"src/start.js\""));
        assert_eq!(detail(5), Some("stdio · npx @playwright/mcp"));
        assert_eq!(detail(6), Some("[Edit|Write] bash hooks/check.sh"));
        assert_eq!(skills[4].marketplace, "official");
        assert_eq!(skills[4].installed_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    }

    #[test]
    fn toggle_output_counts_already_in_goal_state_as_done() {
        let done = r#"{"command":"enable","outcome":"success","plugin":"a@b"}"#;
        let settled = r#"{"command":"disable","outcome":"failed","message":"already disabled","failureCode":"already_in_goal_state","alreadyInGoalState":true}"#;
        let failed = r#"{"command":"enable","outcome":"failed","message":"Plugin \"x@y\" not found"}"#;
        assert_eq!(interpret_toggle_output(done, ""), Ok(()));
        assert_eq!(interpret_toggle_output(&format!("{settled}\n✘ human line"), ""), Ok(()));
        assert_eq!(interpret_toggle_output(failed, ""), Err("Plugin \"x@y\" not found".into()));
        assert!(interpret_toggle_output("", "boom").unwrap_err().contains("boom"));
    }

    #[test]
    fn plugin_ids_cannot_smuggle_flags() {
        assert!(check_plugin_id("pr-review-toolkit@claude-plugins-official").is_ok());
        for bad in ["--all", "-x@y", "a", "a@", "@b", "a b@c", "a@b;rm"] {
            assert!(check_plugin_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn no_manifest_means_no_plugin_skills() {
        assert!(scan(Path::new("/definitely/not/here")).is_empty());
    }
}
