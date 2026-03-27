use serde::{Deserialize, Serialize};

/// Represents a Claude Code project with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// Original project path (e.g., /Users/user/project)
    pub path: String,

    /// Project name (extracted from path)
    pub name: String,

    /// Number of sessions in this project
    pub session_count: usize,

    /// Last modified timestamp (ISO 8601)
    pub last_modified: String,

    /// Escaped path used for filesystem lookup
    pub escaped_path: String,

    /// Whether the original workspace path is missing from disk
    pub is_missing: bool,
}
