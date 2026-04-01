use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use walkdir::WalkDir;
use serde_json::Value;

use crate::features::sessions::{SessionEntry, SessionIndex, ClaudeModelOptions};

fn collect_walkdir_entries<I>(entries: I, context: &str) -> Result<Vec<walkdir::DirEntry>, String>
where
    I: IntoIterator<Item = Result<walkdir::DirEntry, walkdir::Error>>,
{
    entries
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("{context}: {error}"))
}

fn build_unavailable_session_prompt(fallback_prompt: &str) -> String {
    format!("{fallback_prompt} (session unavailable)")
}

fn build_session_entry_from_file(
    path: &std::path::Path,
    project_path: &str,
    fallback_prompt: &str,
    is_sidechain: bool,
) -> Result<SessionEntry, String> {
    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("Failed to derive session id from {:?}", path))?
        .to_string();
    let full_path = path.to_string_lossy().to_string();

    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            if error.kind() == std::io::ErrorKind::NotFound
                || error.kind() == std::io::ErrorKind::PermissionDenied
            {
                return Ok(SessionEntry {
                    session_id,
                    full_path,
                    file_mtime: 0,
                    first_prompt: build_unavailable_session_prompt(fallback_prompt),
                    summary: None,
                    message_count: 0,
                    created: String::new(),
                    modified: String::new(),
                    git_branch: None,
                    project_path: project_path.to_string(),
                    claude_model: None,
                    claude_context_window: None,
                    claude_model_options: None,
                    is_sidechain,
                    children: None,
                });
            }

            return Err(format!("Failed to read session metadata at {:?}: {}", path, error));
        }
    };

    let modified = metadata
        .modified()
        .map_err(|error| format!("Failed to read session modified time at {:?}: {}", path, error))?;
    use chrono::{DateTime, Utc};
    let datetime: DateTime<Utc> = modified.into();
    let modified_str = datetime.to_rfc3339();
    let first_prompt = match parse_jsonl_first_prompt(path) {
        Ok(Some(prompt)) => prompt,
        Ok(None) => fallback_prompt.to_string(),
        Err(error)
            if error.contains("Failed to parse session JSONL")
                || error.contains("Failed to read session file")
                || error.contains("Failed to open session file") =>
        {
            fallback_prompt.to_string()
        }
        Err(error) => return Err(error),
    };

    Ok(SessionEntry {
        session_id,
        full_path,
        file_mtime: datetime.timestamp_millis(),
        first_prompt,
        summary: None,
        message_count: 0,
        created: modified_str.clone(),
        modified: modified_str,
        git_branch: None,
        project_path: project_path.to_string(),
        claude_model: None,
        claude_context_window: None,
        claude_model_options: None,
        is_sidechain,
        children: None,
    })
}

static PROJECTS_ROOT_OVERRIDE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn projects_root_override() -> &'static Mutex<Option<PathBuf>> {
    PROJECTS_ROOT_OVERRIDE.get_or_init(|| Mutex::new(None))
}

fn validate_claude_context_window(
    claude_context_window: Option<String>,
) -> Result<Option<String>, String> {
    match claude_context_window.as_deref() {
        Some("default") | Some("1m") | None => Ok(claude_context_window),
        Some(value) => Err(format!("Invalid claudeContextWindow value: {}", value)),
    }
}

/// Get the path to a project's directory in .claude/projects
fn get_project_dir(escaped_path: &str) -> Result<PathBuf, String> {
    if let Some(root) = projects_root_override()
        .lock()
        .map_err(|_| "Failed to access projects root override".to_string())?
        .clone()
    {
        return Ok(root.join(escaped_path));
    }

    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    Ok(home_dir.join(".claude").join("projects").join(escaped_path))
}

/// Parse JSONL file to extract first user message
fn parse_jsonl_first_prompt(file_path: &std::path::Path) -> Result<Option<String>, String> {
    let file = fs::File::open(file_path)
        .map_err(|error| format!("Failed to open session file {:?}: {}", file_path, error))?;
    let reader = BufReader::new(file);

    let mut first_user_prompt: Option<String> = None;

    for line in reader.lines() {
        let line = line
            .map_err(|error| format!("Failed to read session file {:?}: {}", file_path, error))?;
        let json = serde_json::from_str::<Value>(&line)
            .map_err(|error| format!("Failed to parse session JSONL {:?}: {}", file_path, error))?;

        // Highest priority: custom title set via /rename
        if json.get("type").and_then(|t| t.as_str()) == Some("custom-title") {
            if let Some(title) = json.get("customTitle").and_then(|t| t.as_str()) {
                // Strip surrounding quotes if present
                let clean = title.trim().trim_matches('"');
                if !clean.is_empty() {
                    return Ok(Some(clean.to_string()));
                }
            }
        }

        // Fallback: first user message
        if first_user_prompt.is_none() {
            let content = if json.get("type").and_then(|t| t.as_str()) == Some("user") {
                json.get("message").and_then(|m| m.get("content"))
            } else if json.get("role").and_then(|r| r.as_str()) == Some("user") {
                json.get("content")
            } else {
                None
            };

            if let Some(content) = content {
                let text = if let Some(s) = content.as_str() {
                    s.to_string()
                } else if let Some(arr) = content.as_array() {
                    arr.iter()
                        .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                        .filter(|t| !t.trim_start().starts_with('<'))
                        .collect::<Vec<_>>()
                        .join(" ")
                } else {
                    String::new()
                };

                let trimmed = text.trim().to_string();
                if !trimmed.is_empty() {
                    first_user_prompt = Some(trimmed);
                }
            }
        }
    }

    Ok(first_user_prompt)
}

/// Get sessions for a specific project (includes all .jsonl files, not just indexed)
#[tauri::command]
pub async fn get_project_sessions(
    escaped_path: String,
    include_sidechains: Option<bool>,
    include_unindexed: Option<bool>,
) -> Result<SessionIndex, String> {
    let include_sidechains = include_sidechains.unwrap_or(true);
    let include_unindexed = include_unindexed.unwrap_or(true);
    let project_dir = get_project_dir(&escaped_path)?;
    let index_path = project_dir.join("sessions-index.json");

    // Read the official index first
    let mut index: SessionIndex = if index_path.exists() {
        let content = fs::read_to_string(&index_path)
            .map_err(|e| format!("Failed to read sessions-index.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse sessions-index.json: {}", e))?
    } else {
        // If no index, create empty one
        SessionIndex {
            version: 1,
            entries: Vec::new(),
            original_path: String::new(),
        }
    };

    if include_unindexed {
        // Scan for all .jsonl files in the project directory
        let mut all_session_ids: std::collections::HashSet<String> =
            index.entries.iter().map(|e| e.session_id.clone()).collect();

        for entry in collect_walkdir_entries(
            WalkDir::new(&project_dir)
                .max_depth(1)
                .into_iter(),
            &format!("Failed to read project sessions at {:?}", project_dir),
        )? {
            let path = entry.path();

            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                let session_id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| format!("Failed to derive session id from {:?}", path))?
                    .to_string();

                if !all_session_ids.contains(&session_id) {
                    let entry = build_session_entry_from_file(
                        path,
                        &index.original_path,
                        "(Not indexed)",
                        false,
                    )?;

                    index.entries.push(entry);
                    all_session_ids.insert(session_id);
                }
            }
        }
    }

    if include_sidechains {
        // Scan for subagent sessions (in subdirectories)
        for parent_entry in &mut index.entries {
            let session_dir = project_dir.join(&parent_entry.session_id);
            let subagents_dir = session_dir.join("subagents");

            if subagents_dir.exists() && subagents_dir.is_dir() {
                let mut children = Vec::new();

                for entry in collect_walkdir_entries(
                    WalkDir::new(&subagents_dir)
                        .max_depth(1)
                        .into_iter(),
                    &format!("Failed to read subagent sessions at {:?}", subagents_dir),
                )? {
                    let path = entry.path();

                    if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                        let child = build_session_entry_from_file(
                            path,
                            &index.original_path,
                            "(Subagent)",
                            true,
                        )?;

                        children.push(child);
                    }
                }

                if !children.is_empty() {
                    parent_entry.children = Some(children);
                }
            }
        }
    }

    // Sort by modified date (newest first)
    index.entries.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::{
        build_session_entry_from_file, parse_jsonl_first_prompt, update_session_model_metadata,
        validate_claude_context_window,
    };
    use crate::features::sessions::{SessionEntry, SessionIndex};

    #[test]
    fn parse_jsonl_first_prompt_surfaces_missing_file_errors() {
        let path = std::env::temp_dir().join(format!(
            "atelier-session-missing-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));

        let error = parse_jsonl_first_prompt(&path)
            .expect_err("missing session files should surface open failures");

        assert!(error.contains("Failed to open session file"));
    }

    #[test]
    fn parse_jsonl_first_prompt_surfaces_json_parse_errors() {
        let path = std::env::temp_dir().join(format!(
            "atelier-session-invalid-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::write(&path, b"{not-valid-json\n")
            .expect("invalid session file should be written");

        let error = parse_jsonl_first_prompt(&path)
            .expect_err("invalid jsonl should surface parse failures");

        let _ = std::fs::remove_file(&path);

        assert!(error.contains("Failed to parse session JSONL"));
    }

    #[test]
    fn parse_jsonl_first_prompt_reads_custom_titles() {
        let path = std::env::temp_dir().join(format!(
            "atelier-session-valid-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::write(
            &path,
            b"{\"type\":\"custom-title\",\"customTitle\":\"Demo Session\"}\n",
        )
        .expect("valid session file should be written");

        let prompt = parse_jsonl_first_prompt(&path)
            .expect("valid jsonl should parse")
            .expect("custom title should be returned");

        let _ = std::fs::remove_file(&path);

        assert_eq!(prompt, "Demo Session");
    }

    #[test]
    fn build_session_entry_from_file_falls_back_when_prompt_preview_is_corrupted() {
        let path = std::env::temp_dir().join(format!(
            "atelier-session-corrupt-preview-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::write(
            &path,
            b"{\"type\":\"user\",\"message\":{\"content\":\"hello\"}}\n{not-valid-json\n",
        )
        .expect("corrupted session file should be written");

        let entry = build_session_entry_from_file(&path, "/tmp/demo", "(Not indexed)", false)
            .expect("corrupted preview should not break the whole session list");

        let _ = std::fs::remove_file(&path);

        assert_eq!(entry.first_prompt, "(Not indexed)");
    }

    #[test]
    fn build_session_entry_from_file_falls_back_when_prompt_preview_cannot_be_read() {
        let path = std::env::temp_dir().join(format!(
            "atelier-session-unreadable-preview-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::write(
            &path,
            [
                b'{', b'"', b't', b'y', b'p', b'e', b'"', b':', b'"', b'u', b's', b'e', b'r',
                b'"', b',', b'"', b'm', b'e', b's', b's', b'a', b'g', b'e', b'"', b':', b'{',
                b'"', b'c', b'o', b'n', b't', b'e', b'n', b't', b'"', b':', b'"', b'h', b'i',
                b'"', b'}', b'}', b'\n', 0xff, b'\n',
            ],
        )
        .expect("invalid utf8 session file should be written");

        let entry = build_session_entry_from_file(&path, "/tmp/demo", "(Not indexed)", false)
            .expect("unreadable preview should not break the whole session list");

        let _ = std::fs::remove_file(&path);

        assert_eq!(entry.first_prompt, "(Not indexed)");
    }

    #[test]
    fn build_session_entry_from_file_falls_back_when_session_file_is_missing() {
        let path = std::env::temp_dir().join(format!(
            "atelier-session-missing-entry-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));

        let entry = build_session_entry_from_file(&path, "/tmp/demo", "(Not indexed)", false)
            .expect("missing session files should degrade instead of breaking the whole session list");

        assert_eq!(entry.first_prompt, "(Not indexed) (session unavailable)");
        assert_eq!(entry.session_id, path.file_stem().unwrap().to_string_lossy());
    }

    #[test]
    fn legacy_session_index_without_model_metadata_still_deserializes() {
        let json = r#"{
          "version": 1,
          "entries": [
            {
              "sessionId": "session-1",
              "fullPath": "/tmp/session-1.jsonl",
              "fileMtime": 1,
              "firstPrompt": "hello",
              "summary": "summary",
              "messageCount": 2,
              "created": "2026-03-27T00:00:00Z",
              "modified": "2026-03-27T00:00:00Z",
              "gitBranch": "main",
              "projectPath": "/tmp/project",
              "isSidechain": false
            }
          ],
          "originalPath": "/tmp/project"
        }"#;

        let index: SessionIndex =
            serde_json::from_str(json).expect("legacy index should deserialize");

        assert_eq!(index.entries.len(), 1);
        assert_eq!(index.entries[0].session_id, "session-1");
        assert_eq!(index.entries[0].claude_model, None);
        assert_eq!(index.entries[0].claude_context_window, None);
    }

    #[test]
    fn session_entry_serialization_preserves_model_metadata_fields() {
        let entry = SessionEntry {
            session_id: "session-1".to_string(),
            full_path: "/tmp/session-1.jsonl".to_string(),
            file_mtime: 1,
            first_prompt: "hello".to_string(),
            summary: Some("summary".to_string()),
            message_count: 2,
            created: "2026-03-27T00:00:00Z".to_string(),
            modified: "2026-03-27T00:00:00Z".to_string(),
            git_branch: Some("main".to_string()),
            project_path: "/tmp/project".to_string(),
            claude_model: Some("claude-sonnet-4-5".to_string()),
            claude_context_window: Some("1m".to_string()),
            claude_model_options: None,
            is_sidechain: false,
            children: None,
        };

        let value = serde_json::to_value(&entry).expect("session entry should serialize");

        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["claudeModel"], "claude-sonnet-4-5");
        assert_eq!(value["claudeContextWindow"], "1m");
    }

    #[test]
    fn validate_claude_context_window_rejects_invalid_values() {
        let error = validate_claude_context_window(Some("unexpected-value".to_string()))
            .expect_err("invalid context window should be rejected");

        assert_eq!(error, "Invalid claudeContextWindow value: unexpected-value");
    }

    fn unique_temp_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "atelier-session-metadata-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ))
    }

    fn make_session_entry(session_id: &str) -> SessionEntry {
        SessionEntry {
            session_id: session_id.to_string(),
            full_path: format!("/tmp/{session_id}.jsonl"),
            file_mtime: 1,
            first_prompt: format!("prompt for {session_id}"),
            summary: Some(format!("summary for {session_id}")),
            message_count: 2,
            created: "2026-03-27T00:00:00Z".to_string(),
            modified: "2026-03-27T00:00:00Z".to_string(),
            git_branch: Some("main".to_string()),
            project_path: "/tmp/project".to_string(),
            claude_model: Some(format!("model-for-{session_id}")),
            claude_context_window: Some("default".to_string()),
            claude_model_options: None,
            is_sidechain: false,
            children: Some(vec![SessionEntry {
                session_id: format!("{session_id}-child"),
                full_path: format!("/tmp/{session_id}-child.jsonl"),
                file_mtime: 2,
                first_prompt: "child prompt".to_string(),
                summary: None,
                message_count: 1,
                created: "2026-03-27T00:00:00Z".to_string(),
                modified: "2026-03-27T00:00:00Z".to_string(),
                git_branch: None,
                project_path: "/tmp/project".to_string(),
                claude_model: None,
                claude_context_window: None,
                claude_model_options: None,
                is_sidechain: true,
                children: None,
            }]),
        }
    }

    #[tokio::test]
    async fn update_session_model_metadata_updates_only_matching_entry() {
        let temp_root = unique_temp_path("projects-root");
        let escaped_path = "workspace__tmp_project";
        let project_dir = temp_root.join(escaped_path);
        std::fs::create_dir_all(&project_dir).expect("project directory should be created");

        let index_path = project_dir.join("sessions-index.json");
        let index = SessionIndex {
            version: 1,
            original_path: "/tmp/project".to_string(),
            entries: vec![make_session_entry("session-1"), make_session_entry("session-2")],
        };
        std::fs::write(
            &index_path,
            serde_json::to_string_pretty(&index).expect("index should serialize"),
        )
        .expect("index should be written");

        {
            let mut override_root = super::projects_root_override()
                .lock()
                .expect("projects root override should lock");
            *override_root = Some(temp_root.clone());
        }

        let update_result = update_session_model_metadata(
            escaped_path.to_string(),
            "session-1".to_string(),
            Some("claude-sonnet-4-5".to_string()),
            Some("1m".to_string()),
            Some(ClaudeModelOptions {
                thinking: Some(true),
                effort: Some("max".to_string()),
                fast_mode: Some(true),
            })
        )
        .await;

        let updated: SessionIndex = serde_json::from_str(
            &std::fs::read_to_string(&index_path).expect("updated index should be readable"),
        )
        .expect("updated index should deserialize");

        {
            let mut override_root = super::projects_root_override()
                .lock()
                .expect("projects root override should lock");
            *override_root = None;
        }
        let _ = std::fs::remove_dir_all(&temp_root);

        update_result.expect("metadata update should succeed");

        assert_eq!(updated.entries.len(), 2);
        assert_eq!(updated.entries[0].session_id, "session-1");
        assert_eq!(updated.entries[0].claude_model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(updated.entries[0].claude_context_window.as_deref(), Some("1m"));
        assert_eq!(
            updated.entries[0].claude_model_options,
            Some(ClaudeModelOptions {
                thinking: Some(true),
                effort: Some("max".to_string()),
                fast_mode: Some(true),
            })
        );
        assert_eq!(updated.entries[1].session_id, "session-2");
        assert_eq!(updated.entries[1].claude_model.as_deref(), Some("model-for-session-2"));
        assert_eq!(updated.entries[1].claude_context_window.as_deref(), Some("default"));
        assert!(updated.entries[1].claude_model_options.is_none());
        assert!(updated.entries[0].children.is_some());
        assert!(updated.entries[1].children.is_some());
        assert_eq!(updated.entries[1].summary.as_deref(), Some("summary for session-2"));
    }

    #[tokio::test]
    async fn update_session_model_metadata_can_clear_both_fields_explicitly() {
        let temp_root = unique_temp_path("projects-root-clear");
        let escaped_path = "workspace__tmp_project";
        let project_dir = temp_root.join(escaped_path);
        std::fs::create_dir_all(&project_dir).expect("project directory should be created");

        let index_path = project_dir.join("sessions-index.json");
        let index = SessionIndex {
            version: 1,
            original_path: "/tmp/project".to_string(),
            entries: vec![make_session_entry("session-1")],
        };
        std::fs::write(
            &index_path,
            serde_json::to_string_pretty(&index).expect("index should serialize"),
        )
        .expect("index should be written");

        {
            let mut override_root = super::projects_root_override()
                .lock()
                .expect("projects root override should lock");
            *override_root = Some(temp_root.clone());
        }

        let update_result = update_session_model_metadata(
            escaped_path.to_string(),
            "session-1".to_string(),
            None,
            None,
            None,
        )
        .await;

        let updated: SessionIndex = serde_json::from_str(
            &std::fs::read_to_string(&index_path).expect("updated index should be readable"),
        )
        .expect("updated index should deserialize");

        {
            let mut override_root = super::projects_root_override()
                .lock()
                .expect("projects root override should lock");
            *override_root = None;
        }
        let _ = std::fs::remove_dir_all(&temp_root);

        update_result.expect("explicit metadata clearing should succeed");

        assert_eq!(updated.entries[0].claude_model, None);
        assert_eq!(updated.entries[0].claude_context_window, None);
        assert!(updated.entries[0].claude_model_options.is_none());
    }

    #[tokio::test]
    async fn update_session_model_metadata_rejects_invalid_context_window_values() {
        let temp_root = unique_temp_path("projects-root-invalid-context-window");
        let escaped_path = "workspace__tmp_project";
        let project_dir = temp_root.join(escaped_path);
        std::fs::create_dir_all(&project_dir).expect("project directory should be created");

        let index_path = project_dir.join("sessions-index.json");
        let index = SessionIndex {
            version: 1,
            original_path: "/tmp/project".to_string(),
            entries: vec![make_session_entry("session-1")],
        };
        let original_content = serde_json::to_string_pretty(&index).expect("index should serialize");
        std::fs::write(&index_path, &original_content).expect("index should be written");

        {
            let mut override_root = super::projects_root_override()
                .lock()
                .expect("projects root override should lock");
            *override_root = Some(temp_root.clone());
        }

        let update_result = update_session_model_metadata(
            escaped_path.to_string(),
            "session-1".to_string(),
            Some("claude-sonnet-4-5".to_string()),
            Some("unexpected-value".to_string()),
            None,
        )
        .await;

        let persisted_content =
            std::fs::read_to_string(&index_path).expect("index should remain readable");

        {
            let mut override_root = super::projects_root_override()
                .lock()
                .expect("projects root override should lock");
            *override_root = None;
        }
        let _ = std::fs::remove_dir_all(&temp_root);

        let error = update_result.expect_err("invalid context window should be rejected");
        assert_eq!(error, "Invalid claudeContextWindow value: unexpected-value");
        assert_eq!(persisted_content, original_content);
    }
}

/// Delete a session (move to trash or permanently delete)
#[tauri::command]
pub async fn delete_session(
    session_id: String,
    escaped_path: String,
    permanent: bool,
) -> Result<(), String> {
    let project_dir = get_project_dir(&escaped_path)?;
    let index_path = project_dir.join("sessions-index.json");
    let session_file = project_dir.join(format!("{}.jsonl", session_id));

    // Read current index
    let content = fs::read_to_string(&index_path)
        .map_err(|e| format!("Failed to read sessions-index.json: {}", e))?;

    let mut index: SessionIndex = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse sessions-index.json: {}", e))?;

    // Remove session from index
    index.entries.retain(|entry| entry.session_id != session_id);

    // Delete or trash the session file
    if session_file.exists() {
        if permanent {
            fs::remove_file(&session_file)
                .map_err(|e| format!("Failed to delete session file: {}", e))?;
        } else {
            trash::delete(&session_file)
                .map_err(|e| format!("Failed to move session to trash: {}", e))?;
        }
    }

    // Write updated index atomically (temp file + rename)
    let temp_path = project_dir.join("sessions-index.json.tmp");
    let updated_content = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Failed to serialize updated index: {}", e))?;

    fs::write(&temp_path, updated_content)
        .map_err(|e| format!("Failed to write temporary index: {}", e))?;

    fs::rename(&temp_path, &index_path)
        .map_err(|e| format!("Failed to update sessions-index.json: {}", e))?;

    Ok(())
}

/// Update persisted model metadata for a single top-level session entry
#[tauri::command]
pub async fn update_session_model_metadata(
    escaped_path: String,
    session_id: String,
    claude_model: Option<String>,
    claude_context_window: Option<String>,
    claude_model_options: Option<ClaudeModelOptions>,
) -> Result<(), String> {
    let claude_context_window = validate_claude_context_window(claude_context_window)?;
    let project_dir = get_project_dir(&escaped_path)?;
    let index_path = project_dir.join("sessions-index.json");

    let content = fs::read_to_string(&index_path)
        .map_err(|e| format!("Failed to read sessions-index.json: {}", e))?;

    let mut index: SessionIndex = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse sessions-index.json: {}", e))?;

    let entry = index
        .entries
        .iter_mut()
        .find(|entry| entry.session_id == session_id)
        .ok_or_else(|| format!("Session not found in index: {}", session_id))?;

    entry.claude_model = claude_model;
    entry.claude_context_window = claude_context_window;
    entry.claude_model_options = claude_model_options;

    let temp_path = project_dir.join("sessions-index.json.tmp");
    let updated_content = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Failed to serialize updated index: {}", e))?;

    fs::write(&temp_path, updated_content)
        .map_err(|e| format!("Failed to write temporary index: {}", e))?;

    fs::rename(&temp_path, &index_path)
        .map_err(|e| format!("Failed to update sessions-index.json: {}", e))?;

    Ok(())
}

/// Search sessions by query string
#[tauri::command]
pub async fn search_sessions(
    escaped_path: String,
    query: String,
) -> Result<Vec<SessionEntry>, String> {
    let index = get_project_sessions(escaped_path, None, None).await?;

    let query_lower = query.to_lowercase();

    let results: Vec<SessionEntry> = index
        .entries
        .into_iter()
        .filter(|entry| {
            entry.first_prompt.to_lowercase().contains(&query_lower)
                || entry
                    .summary
                    .as_ref()
                    .map(|s| s.to_lowercase().contains(&query_lower))
                    .unwrap_or(false)
                || entry
                    .git_branch
                    .as_ref()
                    .map(|b| b.to_lowercase().contains(&query_lower))
                    .unwrap_or(false)
        })
        .collect();

    Ok(results)
}

/// Read session messages from JSONL file
#[tauri::command]
pub async fn read_session_messages(session_path: String) -> Result<Vec<serde_json::Value>, String> {
    let file = fs::File::open(&session_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;

    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                let msg_type = json.get("type").and_then(|t| t.as_str());
                // Stream-JSON format: {"type":"user"|"assistant","message":{...}}
                if matches!(msg_type, Some("user") | Some("assistant")) {
                    if let Some(msg) = json.get("message") {
                        messages.push(msg.clone());
                    }
                }
                // Legacy flat format: {"role":"user"|"assistant","content":...}
                else if json.get("role").is_some() {
                    messages.push(json);
                }
            }
        }
    }

    Ok(messages)
}

/// Read the cwd from the first line of a JSONL session file
#[tauri::command]
pub async fn get_session_cwd(session_path: String) -> Result<Option<String>, String> {
    let file = fs::File::open(&session_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;

    let reader = BufReader::new(file);
    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                if let Some(cwd) = json.get("cwd").and_then(|c| c.as_str()) {
                    return Ok(Some(cwd.to_string()));
                }
            }
        }
    }
    Ok(None)
}

/// Rename a session by appending a custom-title entry to the JSONL file
#[tauri::command]
pub async fn rename_session(
    session_path: String,
    title: String,
) -> Result<(), String> {
    use std::io::Write;

    let entry = serde_json::json!({
        "type": "custom-title",
        "customTitle": title,
    });

    let line = serde_json::to_string(&entry)
        .map_err(|e| format!("Failed to serialize rename entry: {}", e))?;

    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&session_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;

    writeln!(file, "{}", line)
        .map_err(|e| format!("Failed to write rename entry: {}", e))?;

    Ok(())
}

/// Extract plain text from a message content value
fn extract_text_from_content(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(arr) = content.as_array() {
        return arr
            .iter()
            .filter_map(|item| {
                // text blocks
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    item.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

/// Export a session as plain text. 
/// If `output_path` is not empty, it saves to disk. 
/// Always returns the exported text.
#[tauri::command]
pub async fn export_session(
    session_path: String,
    output_path: String,
) -> Result<String, String> {
    use std::io::Write;

    let file = fs::File::open(&session_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;

    let reader = BufReader::new(file);

    let mut _title: Option<String> = None;
    let mut _session_id = String::new();
    let mut messages: Vec<(String, String)> = Vec::new(); // (role, text)

    // Extract session ID from path (filename without extension)
    if let Some(stem) = std::path::Path::new(&session_path)
        .file_stem()
        .and_then(|s| s.to_str())
    {
        _session_id = stem.to_string();
    }

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let Ok(json) = serde_json::from_str::<Value>(&line) else { continue };

        // Custom title
        if json.get("type").and_then(|t| t.as_str()) == Some("custom-title") {
            if let Some(t) = json.get("customTitle").and_then(|t| t.as_str()) {
                let clean = t.trim().trim_matches('"');
                if !clean.is_empty() {
                    _title = Some(clean.to_string());
                }
            }
            continue;
        }

        // Stream-JSON format: {"type":"user"|"assistant","message":{...}}
        let msg_type = json.get("type").and_then(|t| t.as_str());
        if matches!(msg_type, Some("user") | Some("assistant")) {
            if let Some(msg) = json.get("message") {
                let role = msg_type.unwrap_or("unknown").to_string();
                if let Some(content) = msg.get("content") {
                    let text = extract_text_from_content(content);
                    if !text.trim().is_empty() {
                        messages.push((role, text));
                    }
                }
            }
            continue;
        }

        // Legacy flat format: {"role":"user"|"assistant","content":...}
        if let Some(role) = json.get("role").and_then(|r| r.as_str()) {
            if matches!(role, "user" | "assistant") {
                if let Some(content) = json.get("content") {
                    let text = extract_text_from_content(content);
                    if !text.trim().is_empty() {
                        messages.push((role.to_string(), text));
                    }
                }
            }
        }
    }

    // Build Plain Text
    let mut text_output = String::new();

    for (role, text) in &messages {
        match role.as_str() {
            "user" => {
                text_output.push_str("User: ");
            }
            "assistant" => {
                text_output.push_str("Claude: ");
            }
            other => {
                text_output.push_str(&format!("{}: ", other));
            }
        }
        text_output.push_str(text.trim());
        text_output.push_str("\n\n");
    }

    // Write to output path if provided
    if !output_path.is_empty() {
        let mut out_file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&output_path)
            .map_err(|e| format!("Failed to create output file: {}", e))?;

        out_file
            .write_all(text_output.as_bytes())
            .map_err(|e| format!("Failed to write plain text: {}", e))?;
    }

    Ok(text_output)
}

/// Export a Claude session as a Codex-compatible JSONL file.
/// Saves to ~/.codex/sessions/YYYY/MM/DD/<title>-<timestamp>-<uuid>.jsonl
/// Returns the path of the saved file.
#[tauri::command]
pub async fn export_session_to_codex(session_path: String) -> Result<String, String> {
    use std::io::Write;
    use std::time::SystemTime;

    let file = fs::File::open(&session_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = BufReader::new(file);

    let mut title: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut first_timestamp: Option<String> = None;
    let mut session_id: Option<String> = None;
    let mut messages: Vec<(String, String)> = Vec::new(); // (role, text)

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let Ok(json) = serde_json::from_str::<Value>(&line) else { continue };

        if json.get("type").and_then(|t| t.as_str()) == Some("custom-title") {
            if let Some(t) = json.get("customTitle").and_then(|t| t.as_str()) {
                let clean = t.trim().trim_matches('"');
                if !clean.is_empty() {
                    title = Some(clean.to_string());
                }
            }
            continue;
        }

        if cwd.is_none() {
            if let Some(c) = json.get("cwd").and_then(|c| c.as_str()) {
                cwd = Some(c.to_string());
            }
        }
        if first_timestamp.is_none() {
            if let Some(ts) = json.get("timestamp").and_then(|t| t.as_str()) {
                first_timestamp = Some(ts.to_string());
            }
        }
        // Grab sessionId from stream-JSON entries
        if session_id.is_none() {
            if let Some(sid) = json.get("sessionId").and_then(|s| s.as_str()) {
                session_id = Some(sid.to_string());
            }
        }

        let msg_type = json.get("type").and_then(|t| t.as_str());
        if matches!(msg_type, Some("user") | Some("assistant")) {
            if let Some(msg) = json.get("message") {
                let role = msg_type.unwrap_or("unknown").to_string();
                if let Some(content) = msg.get("content") {
                    let text = extract_text_from_content(content);
                    if !text.trim().is_empty() {
                        messages.push((role, text));
                    }
                }
            }
            continue;
        }

        // Legacy flat format
        if let Some(role) = json.get("role").and_then(|r| r.as_str()) {
            if matches!(role, "user" | "assistant") {
                if let Some(content) = json.get("content") {
                    let text = extract_text_from_content(content);
                    if !text.trim().is_empty() {
                        messages.push((role.to_string(), text));
                    }
                }
            }
        }
    }

    // Build the output directory: ~/.codex/sessions/YYYY/MM/DD
    let now = chrono::Local::now();
    let date_dir = now.format("%Y/%m/%d").to_string();
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let out_dir = std::path::Path::new(&home)
        .join(".codex")
        .join("sessions")
        .join(&date_dir);
    fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Build filename: <slug>-<timestamp>-<uuid>.jsonl
    let raw_title = title.clone().unwrap_or_else(|| {
        messages
            .first()
            .map(|(_, text)| text.trim().chars().take(40).collect())
            .unwrap_or_else(|| "session".to_string())
    });
    let slug: String = raw_title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let slug = if slug.is_empty() { "session".to_string() } else { slug };

    let ts = now.format("%Y-%m-%dT%H-%M-%S").to_string();
    let uid = {
        // Simple random-ish uuid using SystemTime as entropy source
        let ns = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos();
        format!("{:08x}-{:04x}-7{:03x}-{:04x}-{:012x}",
            ns, (ns >> 16) & 0xffff, (ns >> 4) & 0xfff,
            0x8000 | ((ns >> 2) & 0x3fff), (ns as u64) << 16 | (ns as u64 & 0xffff))
    };
    let filename = format!("{}-{}-{}.jsonl", &slug[..slug.len().min(30)], ts, uid);
    let out_path = out_dir.join(&filename);

    // Write JSONL output
    let mut out_file =
        fs::File::create(&out_path).map_err(|e| format!("Failed to create file: {}", e))?;

    let session_uuid = uid.clone();
    let cwd_val = cwd.clone().unwrap_or_else(|| ".".to_string());
    let timestamp_val = first_timestamp.clone().unwrap_or_else(|| now.to_rfc3339());

    // Line 1: session_meta
    let meta = serde_json::json!({
        "timestamp": timestamp_val,
        "type": "session_meta",
        "payload": {
            "id": session_uuid,
            "timestamp": timestamp_val,
            "cwd": cwd_val,
            "originator": "Atelier Desktop",
            "source": "atelier"
        }
    });
    writeln!(out_file, "{}", serde_json::to_string(&meta).unwrap())
        .map_err(|e| format!("Write error: {}", e))?;

    // Lines 2+: response_item messages
    for (role, text) in &messages {
        let codex_role = match role.as_str() {
            "user" => "user",
            _ => "assistant",
        };
        let item = serde_json::json!({
            "timestamp": timestamp_val,
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": codex_role,
                "content": [{ "type": "input_text", "text": text.trim() }]
            }
        });
        writeln!(out_file, "{}", serde_json::to_string(&item).unwrap())
            .map_err(|e| format!("Write error: {}", e))?;
    }

    // Register the thread in Codex's SQLite database (best-effort, don't fail if it errors)
    let first_msg = messages
        .first()
        .map(|(_, t)| t.trim().chars().take(200).collect::<String>())
        .unwrap_or_default();
    let codex_title = title.clone().unwrap_or_else(|| first_msg.chars().take(60).collect());

    let created_at_secs = now.timestamp();
    let _ = insert_codex_thread(
        &session_uuid,
        &out_path.to_string_lossy(),
        &cwd_val,
        &codex_title,
        &first_msg,
        created_at_secs,
    );

    Ok(out_path.to_string_lossy().to_string())
}

/// Generate a structured Markdown handoff document from a session.
/// If `output_path` is not empty, saves to disk and returns the path.
/// Otherwise returns the markdown text.
#[tauri::command]
pub async fn generate_session_handoff(
    session_path: String,
    output_path: String,
) -> Result<String, String> {
    use std::io::Write;

    let file = fs::File::open(&session_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = BufReader::new(file);

    let mut title: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut messages: Vec<(String, String)> = Vec::new(); // (role, text)

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let Ok(json) = serde_json::from_str::<Value>(&line) else { continue };

        // Custom title
        if json.get("type").and_then(|t| t.as_str()) == Some("custom-title") {
            if let Some(t) = json.get("customTitle").and_then(|t| t.as_str()) {
                let clean = t.trim().trim_matches('"');
                if !clean.is_empty() {
                    title = Some(clean.to_string());
                }
            }
            continue;
        }

        // cwd
        if cwd.is_none() {
            if let Some(c) = json.get("cwd").and_then(|c| c.as_str()) {
                cwd = Some(c.to_string());
            }
        }

        // Stream-JSON format
        let msg_type = json.get("type").and_then(|t| t.as_str());
        if matches!(msg_type, Some("user") | Some("assistant")) {
            if let Some(msg) = json.get("message") {
                let role = msg_type.unwrap_or("unknown").to_string();
                if let Some(content) = msg.get("content") {
                    let text = extract_text_from_content(content);
                    if !text.trim().is_empty() {
                        messages.push((role, text));
                    }
                }
            }
            continue;
        }

        // Legacy flat format
        if let Some(role) = json.get("role").and_then(|r| r.as_str()) {
            if matches!(role, "user" | "assistant") {
                if let Some(content) = json.get("content") {
                    let text = extract_text_from_content(content);
                    if !text.trim().is_empty() {
                        messages.push((role.to_string(), text));
                    }
                }
            }
        }
    }

    // --- Build handoff document ---
    let session_title = title.clone().unwrap_or_else(|| {
        messages
            .first()
            .map(|(_, t)| t.trim().chars().take(80).collect())
            .unwrap_or_else(|| "Untitled Session".to_string())
    });

    let now = chrono::Local::now();
    let mut md = String::new();

    md.push_str(&format!("# Context Handoff: {}\n\n", session_title));
    md.push_str(&format!(
        "> Generated: {}  \n",
        now.format("%Y-%m-%d %H:%M")
    ));
    if let Some(ref c) = cwd {
        md.push_str(&format!("> Working directory: `{}`\n", c));
    }
    md.push('\n');

    // Original goal = first user message
    if let Some((_, first_user)) = messages.iter().find(|(r, _)| r == "user") {
        md.push_str("## 🎯 Original Goal\n\n");
        md.push_str(first_user.trim());
        md.push_str("\n\n");
    }

    // Conversation summary (last N exchanges)
    let window = 6usize; // last 3 user+assistant pairs
    let recent = if messages.len() > window {
        &messages[messages.len() - window..]
    } else {
        &messages[..]
    };

    md.push_str("## 💬 Recent Conversation\n\n");
    for (role, text) in recent {
        let label = if role == "user" { "**User**" } else { "**Assistant**" };
        md.push_str(&format!("{}\n\n", label));
        // Indent each line of the message for readability
        for line in text.trim().lines() {
            md.push_str(&format!("> {}\n", line));
        }
        md.push('\n');
    }

    // Last assistant response in full
    if let Some((_, last_assistant)) = messages.iter().rev().find(|(r, _)| r == "assistant") {
        md.push_str("## 🤖 Last Assistant Response\n\n");
        md.push_str(last_assistant.trim());
        md.push_str("\n\n");
    }

    md.push_str("## ⏭️ Instructions for Next Session\n\n");
    md.push_str("This is a handoff from a Claude Code session. Please:\n\n");
    md.push_str("1. Read the original goal and conversation above carefully.\n");
    md.push_str("2. Understand the current state of the project.\n");
    md.push_str("3. Continue from where the last assistant left off.\n");
    md.push_str("4. Ask for clarification if anything is unclear before proceeding.\n");

    // Write to file or return as text
    if !output_path.is_empty() {
        let mut out_file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&output_path)
            .map_err(|e| format!("Failed to create output file: {}", e))?;
        out_file
            .write_all(md.as_bytes())
            .map_err(|e| format!("Failed to write handoff file: {}", e))?;
        Ok(output_path)
    } else {
        Ok(md)
    }
}

fn insert_codex_thread(

    session_uuid: &str,
    rollout_path: &str,
    cwd: &str,
    title: &str,
    first_user_message: &str,
    created_at_secs: i64,
) -> Result<(), String> {
    use rusqlite::{Connection, params};

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let db_path = std::path::Path::new(&home).join(".codex").join("state_5.sqlite");

    // If the DB doesn't exist, skip silently
    if !db_path.exists() {
        return Ok(());
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open Codex db: {}", e))?;

    // Upsert: ignore if already exists
    let sandbox_policy = r#"{"type":"workspace-write","writable_roots":[],"network_access":false}"#;
    conn.execute(
        "INSERT OR IGNORE INTO threads
            (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
             first_user_message, archived, has_user_event, tokens_used,
             sandbox_policy, approval_mode, memory_mode)
         VALUES (?1, ?2, ?3, ?3, 'atelier', 'anthropic', ?4, ?5, ?6, 0, 1, 0, ?7, 'on-request', 'enabled')",
        params![
            session_uuid,
            rollout_path,
            created_at_secs,
            cwd,
            title,
            first_user_message,
            sandbox_policy,
        ],
    ).map_err(|e| format!("Failed to insert thread row: {}", e))?;

    Ok(())
}


