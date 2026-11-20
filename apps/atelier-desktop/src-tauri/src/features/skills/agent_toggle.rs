//! Turn one skill off for a single agent, leaving the others alone.
//!
//! An agent sees a skill because its skills folder holds an entry by that
//! name: a symlink into `~/.agents/skills`, or a real folder the agent ships
//! itself (Antigravity's GCP skills, `~/.claude/skills/graphify`). Turning it
//! off parks that entry, link or folder, in a sibling `<folder>-disabled`
//! that no agent reads; turning it on moves it back. relink-skills.sh skips
//! any name parked there, so a relink does not quietly undo the choice.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::disable::check_name;

/// (id, display name, skills folders relative to HOME). Antigravity has two:
/// the app's and the IDE's; one switch covers both.
const AGENTS: &[(&str, &str, &[&str])] = &[
    ("claude-code", "Claude Code", &[".claude/skills"]),
    (
        "antigravity",
        "Antigravity",
        &[".gemini/antigravity/skills", ".gemini/antigravity-ide/skills"],
    ),
];

fn home() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME is not set".to_string())
}

/// The agent's existing skills folders, by real path: `~/.gemini/antigravity/skills`
/// is itself a link to `~/.gemini/config/skills`, and the parking folder
/// must sit beside the real one (where relink-skills.sh looks for it).
fn agent_dirs(home: &Path, agent_id: &str) -> Result<Vec<PathBuf>, String> {
    let (_, _, rels) = AGENTS
        .iter()
        .find(|(id, _, _)| *id == agent_id)
        .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
    let mut dirs: Vec<PathBuf> = rels
        .iter()
        .filter_map(|rel| fs::canonicalize(home.join(rel)).ok())
        .collect();
    dirs.dedup();
    Ok(dirs)
}

fn parked_dir(dir: &Path) -> PathBuf {
    let name = dir.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    dir.with_file_name(format!("{name}-disabled"))
}

fn entry_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| !name.starts_with('.'))
        .collect()
}

#[derive(Serialize)]
pub struct AgentInfo {
    id: String,
    name: String,
}

/// A skill whose only entries are parked: `skills ls` no longer lists it, so
/// the table needs this to keep showing the row.
#[derive(Serialize)]
pub struct ParkedSkill {
    name: String,
    path: String,
}

#[derive(Serialize)]
pub struct AgentStates {
    agents: Vec<AgentInfo>,
    /// skill name → agent id → "on" | "off". Missing = the agent has no
    /// entry for it at all (never linked, or deliberately skipped).
    skills: BTreeMap<String, BTreeMap<String, String>>,
    parked: Vec<ParkedSkill>,
}

#[tauri::command]
pub async fn get_skill_agent_states() -> Result<AgentStates, String> {
    let home = home()?;
    let mut agents = Vec::new();
    let mut skills: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut parked_paths: BTreeMap<String, PathBuf> = BTreeMap::new();

    for (id, name, _) in AGENTS {
        let dirs = agent_dirs(&home, id)?;
        if dirs.is_empty() {
            continue; // agent not installed here
        }
        agents.push(AgentInfo {
            id: (*id).to_string(),
            name: (*name).to_string(),
        });
        for dir in &dirs {
            for skill in entry_names(&parked_dir(dir)) {
                parked_paths
                    .entry(skill.clone())
                    .or_insert_with(|| parked_dir(dir).join(&skill));
                skills
                    .entry(skill)
                    .or_default()
                    .entry((*id).to_string())
                    .or_insert_with(|| "off".to_string());
            }
        }
        // "on" in any of an agent's folders wins over "off" in another.
        for dir in &dirs {
            for skill in entry_names(dir) {
                skills
                    .entry(skill)
                    .or_default()
                    .insert((*id).to_string(), "on".to_string());
            }
        }
    }

    let parked = parked_paths
        .into_iter()
        .filter(|(name, _)| {
            !skills
                .get(name)
                .is_some_and(|states| states.values().any(|s| s == "on"))
        })
        .map(|(name, path)| ParkedSkill {
            name,
            path: path.display().to_string(),
        })
        .collect();

    Ok(AgentStates {
        agents,
        skills,
        parked,
    })
}

#[tauri::command]
pub async fn set_skill_for_agent(
    skill_name: String,
    agent_id: String,
    enabled: bool,
) -> Result<(), String> {
    check_name(&skill_name)?;
    let dirs = agent_dirs(&home()?, &agent_id)?;
    let mut moved = 0;
    for dir in &dirs {
        let parked = parked_dir(dir);
        let (from, to) = if enabled {
            (parked.join(&skill_name), dir.join(&skill_name))
        } else {
            (dir.join(&skill_name), parked.join(&skill_name))
        };
        if from.symlink_metadata().is_err() {
            continue;
        }
        if to.symlink_metadata().is_ok() {
            return Err(format!("{} already exists", to.display()));
        }
        if !enabled {
            fs::create_dir_all(&parked).map_err(|e| e.to_string())?;
        }
        // rename keeps a symlink's link text, relative targets included.
        fs::rename(&from, &to)
            .map_err(|e| format!("Failed to move {}: {e}", from.display()))?;
        moved += 1;
    }
    if moved == 0 {
        let state = if enabled { "parked" } else { "present" };
        return Err(format!("{skill_name} is not {state} for {agent_id}"));
    }
    Ok(())
}

#[cfg(test)]
fn visible_to(home: &Path, agent_id: &str, name: &str) -> bool {
    agent_dirs(home, agent_id)
        .unwrap()
        .iter()
        .any(|dir| dir.join(name).symlink_metadata().is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parks_and_restores_links_and_real_folders_per_agent() {
        let _home_guard = crate::features::skills::TEST_HOME.lock().unwrap();
        use std::os::unix::fs::symlink;
        use tauri::async_runtime::block_on as run;
        let home = std::env::temp_dir().join(format!("atelier-agent-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join(".agents/skills/shared")).unwrap();
        fs::create_dir_all(home.join(".claude/skills/graphify")).unwrap();
        fs::create_dir_all(home.join(".gemini/config/skills/gcp-spark")).unwrap();
        fs::create_dir_all(home.join(".gemini/antigravity")).unwrap();
        symlink(home.join(".gemini/config/skills"), home.join(".gemini/antigravity/skills")).unwrap();
        symlink("../../.agents/skills/shared", home.join(".claude/skills/shared")).unwrap();
        symlink("../../../.agents/skills/shared", home.join(".gemini/config/skills/shared")).unwrap();
        std::env::set_var("HOME", &home);

        // Off for Claude only: Antigravity keeps its link.
        run(set_skill_for_agent("shared".into(), "claude-code".into(), false)).unwrap();
        assert!(!visible_to(&home, "claude-code", "shared"));
        assert!(visible_to(&home, "antigravity", "shared"));
        assert!(home.join(".claude/skills-disabled/shared").symlink_metadata().is_ok());

        // A real folder owned by the agent parks the same way, beside the
        // real path rather than the ~/.gemini/antigravity alias.
        run(set_skill_for_agent("gcp-spark".into(), "antigravity".into(), false)).unwrap();
        assert!(home.join(".gemini/config/skills-disabled/gcp-spark").is_dir());

        let states = run(get_skill_agent_states()).unwrap();
        assert_eq!(states.skills["shared"]["claude-code"], "off");
        assert_eq!(states.skills["shared"]["antigravity"], "on");
        assert_eq!(states.skills["gcp-spark"]["antigravity"], "off");
        assert!(!states.skills["gcp-spark"].contains_key("claude-code"));
        let parked: Vec<_> = states.parked.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(parked, ["gcp-spark"]); // shared is still on for Antigravity

        assert!(run(set_skill_for_agent("shared".into(), "claude-code".into(), false)).is_err());
        run(set_skill_for_agent("shared".into(), "claude-code".into(), true)).unwrap();
        run(set_skill_for_agent("gcp-spark".into(), "antigravity".into(), true)).unwrap();
        assert!(home.join(".claude/skills/shared/").exists()); // link resolves again
        assert!(home.join(".gemini/config/skills/gcp-spark").is_dir());

        fs::remove_dir_all(&home).unwrap();
    }
}
