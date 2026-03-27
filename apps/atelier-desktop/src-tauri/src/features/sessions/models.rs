use serde::{Deserialize, Deserializer, Serialize};

/// Represents the sessions-index.json file structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionIndex {
    pub version: u32,
    pub entries: Vec<SessionEntry>,
    #[serde(rename = "originalPath")]
    pub original_path: String,
}

fn deserialize_claude_context_window<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    Ok(match value.as_deref() {
        Some("default") | Some("1m") => value,
        _ => None,
    })
}

/// Represents a single session entry in the index
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEntry {
    #[serde(rename = "sessionId")]
    pub session_id: String,

    #[serde(rename = "fullPath")]
    pub full_path: String,

    #[serde(rename = "fileMtime")]
    pub file_mtime: i64,

    #[serde(rename = "firstPrompt")]
    pub first_prompt: String,

    pub summary: Option<String>,

    #[serde(rename = "messageCount")]
    pub message_count: u32,

    pub created: String,
    pub modified: String,

    #[serde(rename = "gitBranch")]
    pub git_branch: Option<String>,

    #[serde(rename = "projectPath")]
    pub project_path: String,

    #[serde(rename = "claudeModel", default)]
    pub claude_model: Option<String>,

    #[serde(
        rename = "claudeContextWindow",
        default,
        deserialize_with = "deserialize_claude_context_window"
    )]
    pub claude_context_window: Option<String>,

    #[serde(rename = "isSidechain")]
    pub is_sidechain: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SessionEntry>>,
}

#[cfg(test)]
mod tests {
    use super::{SessionEntry, SessionIndex};

    fn make_session_entry(session_id: &str) -> SessionEntry {
        SessionEntry {
            session_id: session_id.to_string(),
            full_path: format!("/tmp/{session_id}.jsonl"),
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
            is_sidechain: false,
            children: None,
        }
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
        let entry = make_session_entry("session-1");

        let value = serde_json::to_value(&entry).expect("session entry should serialize");

        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["claudeModel"], "claude-sonnet-4-5");
        assert_eq!(value["claudeContextWindow"], "1m");
    }

    #[test]
    fn unknown_claude_context_window_degrades_to_none() {
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
              "claudeModel": "claude-sonnet-4-5",
              "claudeContextWindow": "unexpected-value",
              "isSidechain": false
            }
          ],
          "originalPath": "/tmp/project"
        }"#;

        let index: SessionIndex =
            serde_json::from_str(json).expect("index with unknown context window should deserialize");

        assert_eq!(index.entries[0].claude_model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(index.entries[0].claude_context_window, None);
    }
}
