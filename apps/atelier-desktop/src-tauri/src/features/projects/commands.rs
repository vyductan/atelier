use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;
use chrono::{DateTime, Utc};

use crate::features::projects::ProjectInfo;
use crate::features::sessions::SessionIndex;

/// Get the path to the .claude/projects directory
fn get_claude_projects_dir() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    Ok(home_dir.join(".claude").join("projects"))
}

fn extract_cwd_from_first_jsonl(dir_path: &std::path::Path) -> Option<String> {
    use std::io::BufRead;
    for entry in walkdir::WalkDir::new(dir_path).max_depth(1).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            if let Ok(file) = fs::File::open(path) {
                let reader = std::io::BufReader::new(file);
                for line in reader.lines().take(50).flatten() {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(cwd) = json.get("cwd").and_then(|v| v.as_str()) {
                            return Some(cwd.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

/// Extract project name from path
fn extract_project_name(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string()
}

fn collect_walkdir_entries<I>(entries: I, context: &str) -> Result<Vec<walkdir::DirEntry>, String>
where
    I: IntoIterator<Item = Result<walkdir::DirEntry, walkdir::Error>>,
{
    entries
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("{context}: {error}"))
}

fn read_session_index(index_path: &std::path::Path) -> Result<SessionIndex, String> {
    let content = fs::read_to_string(index_path)
        .map_err(|error| format!("Failed to read sessions-index.json at {:?}: {}", index_path, error))?;

    serde_json::from_str::<SessionIndex>(&content)
        .map_err(|error| format!("Failed to parse sessions-index.json at {:?}: {}", index_path, error))
}

/// List all Claude Code projects with session counts
#[tauri::command]
pub async fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let projects_dir = get_claude_projects_dir()?;

    if !projects_dir.exists() {
        return Ok(Vec::new());
    }

    let mut projects = Vec::new();

    // Iterate through each directory in .claude/projects/
    for entry in collect_walkdir_entries(
        WalkDir::new(&projects_dir)
            .min_depth(1)
            .max_depth(1)
            .into_iter(),
        "Failed to read Claude projects directory",
    )? {
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let escaped_path = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let index_path = path.join("sessions-index.json");
        let mut original_path = String::new();
        let mut session_count = 0;
        let mut indexed_session_ids = std::collections::HashSet::new();

        if index_path.exists() {
            if let Ok(index) = read_session_index(&index_path) {
                original_path = index.original_path.clone();
                session_count = index.entries.len();
                for entry in index.entries {
                    indexed_session_ids.insert(entry.session_id);
                }
            }
        }

        if original_path.is_empty() {
            if let Some(cwd) = extract_cwd_from_first_jsonl(&path) {
                original_path = cwd;
            } else {
                original_path = escaped_path.replace("-", "/");
            }
        }

        let mut has_jsonl = false;
        for entry in collect_walkdir_entries(
            WalkDir::new(&path).max_depth(1).into_iter(),
            &format!("Failed to read Claude project sessions at {:?}", path),
        )? {
            let entry_path = entry.path();
            if entry_path.is_file()
                && entry_path.extension().and_then(|s| s.to_str()) == Some("jsonl")
            {
                has_jsonl = true;
                if let Some(filename) = entry_path.file_stem().and_then(|s| s.to_str()) {
                    let session_id = filename.to_string();
                    if !indexed_session_ids.contains(&session_id) {
                        session_count += 1;
                    }
                }
            }
        }

        if !has_jsonl && !index_path.exists() {
            continue;
        }

        let metadata_target = if index_path.exists() { &index_path } else { path };
        let metadata = fs::metadata(metadata_target)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let modified_time = metadata.modified()
            .map_err(|e| format!("Failed to get modified time: {}", e))?;

        let datetime: DateTime<Utc> = modified_time.into();
        let last_modified = datetime.to_rfc3339();

        let is_missing = !std::path::Path::new(&original_path).exists();

        projects.push(ProjectInfo {
            path: original_path.clone(),
            name: extract_project_name(&original_path),
            session_count,
            last_modified,
            escaped_path,
            is_missing,
        });
    }

    // Sort by last modified (most recent first)
    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    Ok(projects)
}

/// Update the original path of a Claude Code project
#[tauri::command]
pub async fn update_workspace_path(
    escaped_path: String,
    new_path: String,
) -> Result<Vec<ProjectInfo>, String> {
    let projects_dir = get_claude_projects_dir()?;
    let project_dir = projects_dir.join(&escaped_path);
    if !project_dir.exists() {
        return Err("Project directory not found".to_string());
    }

    let index_path = project_dir.join("sessions-index.json");
    if !index_path.exists() {
        return Err("Session index not found".to_string());
    }

    let mut index = read_session_index(&index_path)?;
    index.original_path = new_path.clone();

    for entry in &mut index.entries {
        entry.project_path = new_path.clone();
    }

    let content = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Failed to serialize index: {}", e))?;
    
    fs::write(&index_path, content)
        .map_err(|e| format!("Failed to write updated session index: {}", e))?;

    // Return the updated projects list
    list_projects().await
}


#[cfg(test)]
mod tests {
    use super::{collect_walkdir_entries, read_session_index};
    use crate::features::sessions::SessionIndex;
    use walkdir::WalkDir;

    #[test]
    fn collect_walkdir_entries_surfaces_traversal_errors() {
        let error = collect_walkdir_entries(
            WalkDir::new("/definitely-missing-atelier-projects-dir")
                .min_depth(1)
                .max_depth(1)
                .into_iter(),
            "Failed to read Claude projects directory",
        )
        .expect_err("missing project dir should surface traversal error");

        assert!(error.contains("Failed to read Claude projects directory"));
        assert!(error.contains("No such file") || error.contains("no such file"));
    }

    #[test]
    fn read_session_index_surfaces_read_errors() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-project-index-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_root).expect("temp dir should be created");
        let index_path = temp_root.join("sessions-index.json");

        let error = read_session_index(&index_path)
            .expect_err("missing index file should surface read error");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(error.contains("Failed to read sessions-index.json"));
    }

    #[test]
    fn read_session_index_surfaces_parse_errors() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-project-index-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_root).expect("temp dir should be created");
        let index_path = temp_root.join("sessions-index.json");
        std::fs::write(&index_path, b"{not-valid-json")
            .expect("invalid index file should be written");

        let error = read_session_index(&index_path)
            .expect_err("invalid json should surface parse error");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(error.contains("Failed to parse sessions-index.json"));
    }

    #[test]
    fn read_session_index_reads_valid_index_files() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-project-index-valid-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_root).expect("temp dir should be created");
        let index_path = temp_root.join("sessions-index.json");
        std::fs::write(
            &index_path,
            serde_json::json!({
                "version": 1,
                "originalPath": "/tmp/demo",
                "entries": []
            })
            .to_string(),
        )
        .expect("valid index file should be written");

        let index = read_session_index(&index_path)
            .expect("valid json should parse into a session index");

        let _ = std::fs::remove_dir_all(&temp_root);

        let expected = SessionIndex {
            version: 1,
            original_path: "/tmp/demo".to_string(),
            entries: vec![],
        };
        assert_eq!(index.version, expected.version);
        assert_eq!(index.original_path, expected.original_path);
        assert_eq!(index.entries.len(), expected.entries.len());
    }
}
