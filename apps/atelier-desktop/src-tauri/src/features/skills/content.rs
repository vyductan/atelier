//! Read-only view into a skill: the files it ships and their text, plus
//! "open in editor" / "reveal in Finder". Only paths under the agents' own
//! folders (`~/.agents`, `~/.claude`, …) are served, so the UI cannot be used
//! to read arbitrary files.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Folders skills, commands, agents and plugins live under.
const AGENT_DIRS: &[&str] = &[
    ".agents", ".claude", ".gemini", ".codex", ".cursor", ".windsurf", ".roo", ".cline",
];
const MAX_FILES: usize = 300;
const MAX_DEPTH: usize = 5;
const MAX_BYTES: u64 = 1024 * 1024;
/// The editor Atelier hands files to.
const EDITOR_APP: &str = "Antigravity IDE";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFiles {
    /// Folder the file list is relative to.
    pub root: String,
    /// The file to show first (`SKILL.md`, or the item's own file).
    pub main: String,
    /// Relative paths, `main` first, then sorted; hidden files skipped.
    pub files: Vec<String>,
    /// More files existed than `MAX_FILES`.
    pub truncated: bool,
}

fn allowed_roots(home: &Path) -> Vec<PathBuf> {
    AGENT_DIRS
        .iter()
        .filter_map(|dir| home.join(dir).canonicalize().ok())
        .collect()
}

/// Canonical form of `path`, if it exists and sits inside an agent folder.
fn checked(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let real = path
        .canonicalize()
        .map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if roots.iter().any(|root| real.starts_with(root)) {
        Ok(real)
    } else {
        Err(format!("{} is outside the agents' folders", path.display()))
    }
}

fn home() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME is not set".to_string())
}

fn walk(dir: &Path, base: &Path, depth: usize, out: &mut Vec<String>, truncated: &mut bool) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = read.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if name.starts_with('.') || name == "node_modules" || name == "__pycache__" {
            continue;
        }
        if path.is_dir() {
            if depth < MAX_DEPTH {
                walk(&path, base, depth + 1, out, truncated);
            }
        } else if out.len() >= MAX_FILES {
            *truncated = true;
            return;
        } else if let Ok(rel) = path.strip_prefix(base) {
            out.push(rel.to_string_lossy().into_owned());
        }
    }
}

/// What to show for an item path: a skill folder (or its `SKILL.md`) lists
/// the whole folder; any other file (command, agent, `.mcp.json`, …) is shown alone.
pub fn list_files(path: &Path, roots: &[PathBuf]) -> Result<SkillFiles, String> {
    let real = checked(path, roots)?;
    let skill_dir = if real.is_dir() {
        Some(real.clone())
    } else if real.file_name().is_some_and(|n| n == "SKILL.md") {
        real.parent().map(Path::to_path_buf)
    } else {
        None
    };

    if let Some(dir) = skill_dir {
        let mut files = Vec::new();
        let mut truncated = false;
        walk(&dir, &dir, 0, &mut files, &mut truncated);
        let main = "SKILL.md".to_string();
        if let Some(i) = files.iter().position(|f| *f == main) {
            files.remove(i);
            files.insert(0, main.clone());
        }
        return Ok(SkillFiles { root: dir.to_string_lossy().into_owned(), main, files, truncated });
    }

    let parent = real.parent().ok_or("File has no folder")?;
    let name = real
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Unreadable file name")?
        .to_string();
    Ok(SkillFiles {
        root: parent.to_string_lossy().into_owned(),
        main: name.clone(),
        files: vec![name],
        truncated: false,
    })
}

/// Text of `rel` inside `root`; refuses escapes (`..`, symlinks out), big or binary files.
pub fn read_file(root: &Path, rel: &str, roots: &[PathBuf]) -> Result<String, String> {
    let root = checked(root, roots)?;
    let real = checked(&root.join(rel), roots)?;
    if !real.starts_with(&root) {
        return Err(format!("{rel} is outside the skill"));
    }
    let size = fs::metadata(&real).map_err(|e| e.to_string())?.len();
    if size > MAX_BYTES {
        return Err(format!("{rel} is {} KB, too big to preview", size / 1024));
    }
    let bytes = fs::read(&real).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| format!("{rel} is not a text file"))
}

#[tauri::command]
pub async fn get_skill_files(path: String) -> Result<SkillFiles, String> {
    let roots = allowed_roots(&home()?);
    tokio::task::spawn_blocking(move || list_files(Path::new(&path), &roots))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_skill_file(root: String, rel: String) -> Result<String, String> {
    let roots = allowed_roots(&home()?);
    tokio::task::spawn_blocking(move || read_file(Path::new(&root), &rel, &roots))
        .await
        .map_err(|e| e.to_string())?
}

/// `reveal`: select it in Finder; otherwise open it in the editor.
#[tauri::command]
pub async fn open_skill_path(path: String, reveal: bool) -> Result<(), String> {
    let real = checked(Path::new(&path), &allowed_roots(&home()?))?;
    let mut command = std::process::Command::new("/usr/bin/open");
    if reveal {
        command.arg("-R");
    } else {
        command.args(["-a", EDITOR_APP]);
    }
    command
        .arg(&real)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open {}: {e}", real.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(name: &str) -> (PathBuf, Vec<PathBuf>) {
        let tmp = std::env::temp_dir().join(format!("atelier-content-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let skill = tmp.join("home/.agents/skills/demo");
        for (rel, text) in [
            ("SKILL.md", "---\nname: demo\n---\nbody"),
            ("references/a.md", "ref"),
            ("scripts/run.sh", "echo"),
            (".hidden", "x"),
        ] {
            let path = skill.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        fs::write(skill.join("blob.bin"), [0xff, 0xfe, 0x00]).unwrap();
        fs::write(tmp.join("home/secret.txt"), "nope").unwrap();
        let roots = allowed_roots(&tmp.join("home"));
        (tmp, roots)
    }

    #[test]
    fn lists_a_skill_folder_with_skill_md_first() {
        let (tmp, roots) = setup("list");
        let skill = tmp.join("home/.agents/skills/demo");
        let listed = list_files(&skill.join("SKILL.md"), &roots).unwrap();
        assert_eq!(listed.main, "SKILL.md");
        assert_eq!(listed.files, ["SKILL.md", "blob.bin", "references/a.md", "scripts/run.sh"]);
        let single = list_files(&skill.join("references/a.md"), &roots).unwrap();
        assert_eq!(single.files, ["a.md"]);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn reads_text_inside_the_skill_only() {
        let (tmp, roots) = setup("read");
        let skill = tmp.join("home/.agents/skills/demo");
        assert_eq!(read_file(&skill, "references/a.md", &roots).unwrap(), "ref");
        assert!(read_file(&skill, "../../../secret.txt", &roots).is_err());
        assert!(read_file(&skill, "blob.bin", &roots).unwrap_err().contains("not a text file"));
        assert!(list_files(&tmp.join("home/secret.txt"), &roots).is_err());
        let _ = fs::remove_dir_all(&tmp);
    }
}
