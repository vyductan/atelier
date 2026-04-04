use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};

const MAX_PREVIEW_BYTES: u64 = 256 * 1024;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatusFile {
    pub path: String,
    pub status: String,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatusPayload {
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub worktree_label: Option<String>,
    pub total_changed: usize,
    pub changed_files: Vec<WorkspaceStatusFile>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiffPayload {
    pub is_git_repo: bool,
    pub file_path: Option<String>,
    pub status: Option<String>,
    pub unified_diff: String,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContentPayload {
    pub file_path: String,
    pub content: String,
    pub exists: bool,
    pub is_binary: bool,
    pub too_large: bool,
}

fn workspace_label(project_path: &Path) -> Option<String> {
    project_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
}

fn run_git_command(project_path: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(project_path)
        .output()
        .map_err(|error| format!("Failed to run git {}: {}", args.join(" "), error))
}

fn is_git_repo(project_path: &Path) -> Result<bool, String> {
    let output = run_git_command(project_path, &["rev-parse", "--is-inside-work-tree"])?;

    if !output.status.success() {
        return Ok(false);
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
}

fn read_branch(project_path: &Path) -> Result<Option<String>, String> {
    let output = run_git_command(project_path, &["branch", "--show-current"])?;

    if !output.status.success() {
        return Ok(None);
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        Ok(None)
    } else {
        Ok(Some(branch))
    }
}

fn parse_status_code(code: &str) -> String {
    if code.contains('?') {
        return "untracked".to_string();
    }
    if code.contains('R') {
        return "renamed".to_string();
    }
    if code.contains('A') {
        return "added".to_string();
    }
    if code.contains('D') {
        return "deleted".to_string();
    }

    "modified".to_string()
}

fn parse_status_line(line: &str) -> Option<WorkspaceStatusFile> {
    if line.len() < 4 {
        return None;
    }

    let code = &line[..2];
    let raw_path = line[3..].trim();
    if raw_path.is_empty() {
        return None;
    }

    let path = if code.contains('R') {
        raw_path
            .split(" -> ")
            .last()
            .map(|value| value.to_string())
            .unwrap_or_else(|| raw_path.to_string())
    } else {
        raw_path.to_string()
    };

    Some(WorkspaceStatusFile {
        path,
        status: parse_status_code(code),
    })
}

fn read_changed_files(project_path: &Path, file_path: Option<&str>) -> Result<Vec<WorkspaceStatusFile>, String> {
    let mut args = vec!["status", "--short"];
    if let Some(file_path) = file_path {
        args.push("--");
        args.push(file_path);
    }

    let output = run_git_command(project_path, &args)?;
    if !output.status.success() {
        return Err(format!(
            "git status failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().filter_map(parse_status_line).collect())
}

fn neutral_status_payload() -> WorkspaceStatusPayload {
    WorkspaceStatusPayload {
        is_git_repo: false,
        branch: None,
        worktree_label: None,
        total_changed: 0,
        changed_files: Vec::new(),
    }
}

fn neutral_diff_payload() -> WorkspaceDiffPayload {
    WorkspaceDiffPayload {
        is_git_repo: false,
        file_path: None,
        status: None,
        unified_diff: String::new(),
    }
}

fn neutral_file_content_payload(file_path: String) -> WorkspaceFileContentPayload {
    WorkspaceFileContentPayload {
        file_path,
        content: String::new(),
        exists: false,
        is_binary: false,
        too_large: false,
    }
}

fn resolve_workspace_file_path(project_path: &Path, file_path: &str) -> Result<PathBuf, String> {
    let file_path = Path::new(file_path);

    if file_path.is_absolute()
        || file_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("File path must stay within the workspace.".to_string());
    }

    Ok(project_path.join(file_path))
}

fn is_binary_content(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

fn read_workspace_file_content(
    project_path: &Path,
    file_path: &str,
) -> Result<WorkspaceFileContentPayload, String> {
    let absolute_path = resolve_workspace_file_path(project_path, file_path)?;

    if !absolute_path.exists() || !absolute_path.is_file() {
        return Ok(neutral_file_content_payload(file_path.to_string()));
    }

    let metadata = fs::metadata(&absolute_path)
        .map_err(|error| format!("Failed to read file metadata {}: {}", file_path, error))?;

    if metadata.len() > MAX_PREVIEW_BYTES {
        return Ok(WorkspaceFileContentPayload {
            file_path: file_path.to_string(),
            content: String::new(),
            exists: true,
            is_binary: false,
            too_large: true,
        });
    }

    let bytes = fs::read(&absolute_path)
        .map_err(|error| format!("Failed to read file content {}: {}", file_path, error))?;

    if is_binary_content(&bytes) {
        return Ok(WorkspaceFileContentPayload {
            file_path: file_path.to_string(),
            content: String::new(),
            exists: true,
            is_binary: true,
            too_large: false,
        });
    }

    let content = String::from_utf8(bytes).map_err(|_| "Preview unavailable for this file type.".to_string())?;

    Ok(WorkspaceFileContentPayload {
        file_path: file_path.to_string(),
        content,
        exists: true,
        is_binary: false,
        too_large: false,
    })
}

fn build_untracked_diff(project_path: &Path, file_path: &str) -> Result<String, String> {
    let absolute_path = project_path.join(file_path);
    let bytes = fs::read(&absolute_path)
        .map_err(|error| format!("Failed to read untracked file {}: {}", file_path, error))?;

    let mut diff_lines = vec![
        format!("diff --git a/{0} b/{0}", file_path),
        "new file mode 100644".to_string(),
        "--- /dev/null".to_string(),
        format!("+++ b/{}", file_path),
    ];

    let content = match String::from_utf8(bytes) {
        Ok(content) => content,
        Err(_) => {
            diff_lines.push("@@ -0,0 +1 @@".to_string());
            diff_lines.push("+[binary file]".to_string());
            return Ok(diff_lines.join("\n"));
        }
    };

    if content.is_empty() {
        diff_lines.push("@@ -0,0 +1 @@".to_string());
    } else {
        diff_lines.push(format!("@@ -0,0 +1,{} @@", content.lines().count().max(1)));
        diff_lines.extend(content.lines().map(|line| format!("+{}", line)));
        if content.ends_with('\n') {
            diff_lines.push(String::new());
        }
    }

    Ok(diff_lines.join("\n"))
}

fn read_git_diff(project_path: &Path, args: &[&str], label: &str) -> Result<String, String> {
    let output = run_git_command(project_path, args)?;
    if !output.status.success() {
        return Err(format!(
            "{} failed: {}",
            label,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn build_workspace_diff(
    project_path: &Path,
    file_path: &str,
    status: Option<&str>,
) -> Result<String, String> {
    if matches!(status, Some("untracked")) {
        return build_untracked_diff(project_path, file_path);
    }

    let working_tree_diff = read_git_diff(project_path, &["diff", "--", file_path], "git diff")?;
    let cached_diff = read_git_diff(
        project_path,
        &["diff", "--cached", "--", file_path],
        "git diff --cached",
    )?;

    if working_tree_diff.is_empty() {
        return Ok(cached_diff);
    }

    if cached_diff.is_empty() {
        return Ok(working_tree_diff);
    }

    Ok(format!("{}\n{}", cached_diff.trim_end(), working_tree_diff))
}

#[tauri::command]
pub async fn get_workspace_status(project_path: String) -> Result<WorkspaceStatusPayload, String> {
    let project_path = PathBuf::from(&project_path);

    if !project_path.exists() {
        return Ok(neutral_status_payload());
    }

    if !is_git_repo(&project_path)? {
        return Ok(neutral_status_payload());
    }

    let changed_files = read_changed_files(&project_path, None)?;

    Ok(WorkspaceStatusPayload {
        is_git_repo: true,
        branch: read_branch(&project_path)?,
        worktree_label: workspace_label(&project_path),
        total_changed: changed_files.len(),
        changed_files,
    })
}

#[tauri::command]
pub async fn get_workspace_diff(
    project_path: String,
    file_path: String,
) -> Result<WorkspaceDiffPayload, String> {
    let project_path = PathBuf::from(&project_path);

    if !project_path.exists() {
        return Ok(neutral_diff_payload());
    }

    if !is_git_repo(&project_path)? {
        return Ok(neutral_diff_payload());
    }

    let changed_files = read_changed_files(&project_path, Some(&file_path))?;
    let status = changed_files.first().map(|file| file.status.clone());
    let unified_diff = build_workspace_diff(&project_path, &file_path, status.as_deref())?;

    Ok(WorkspaceDiffPayload {
        is_git_repo: true,
        file_path: Some(file_path),
        status,
        unified_diff,
    })
}

#[tauri::command]
pub async fn get_workspace_file_content(
    project_path: String,
    file_path: String,
) -> Result<WorkspaceFileContentPayload, String> {
    let project_path = PathBuf::from(&project_path);
    read_workspace_file_content(&project_path, &file_path)
}

#[cfg(test)]
mod tests {
    use super::{
        is_binary_content, parse_status_code, parse_status_line, read_workspace_file_content,
        resolve_workspace_file_path, workspace_label, MAX_PREVIEW_BYTES,
    };
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parse_status_code_maps_supported_git_states() {
        assert_eq!(parse_status_code(" M"), "modified");
        assert_eq!(parse_status_code("A "), "added");
        assert_eq!(parse_status_code(" D"), "deleted");
        assert_eq!(parse_status_code("R "), "renamed");
        assert_eq!(parse_status_code("??"), "untracked");
    }

    #[test]
    fn parse_status_line_uses_new_path_for_renames() {
        let parsed = parse_status_line("R  old-name.ts -> new-name.ts")
            .expect("rename line should parse");

        assert_eq!(parsed.path, "new-name.ts");
        assert_eq!(parsed.status, "renamed");
    }

    fn make_temp_dir() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("atelier-workspace-preview-{}", unique));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn workspace_label_reads_last_path_segment() {
        assert_eq!(workspace_label(Path::new("/tmp/demo-worktree")), Some("demo-worktree".to_string()));
    }

    #[test]
    fn resolve_workspace_file_path_rejects_parent_segments() {
        let result = resolve_workspace_file_path(Path::new("/tmp/project"), "../secret.txt");
        assert!(result.is_err());
    }

    #[test]
    fn is_binary_content_detects_nul_bytes() {
        assert!(is_binary_content(&[1, 0, 2]));
        assert!(!is_binary_content(b"plain text"));
    }

    #[test]
    fn read_workspace_file_content_returns_text_payload_for_existing_file() {
        let dir = make_temp_dir();
        let file_path = dir.join("src-app.tsx");
        fs::write(&file_path, "export const App = () => null;\n").expect("write file");

        let payload = read_workspace_file_content(&dir, "src-app.tsx").expect("read preview");

        assert_eq!(payload.file_path, "src-app.tsx");
        assert_eq!(payload.content, "export const App = () => null;\n");
        assert!(payload.exists);
        assert!(!payload.is_binary);
        assert!(!payload.too_large);

        fs::remove_dir_all(dir).expect("remove temp dir");
    }

    #[test]
    fn read_workspace_file_content_returns_neutral_payload_for_missing_file() {
        let dir = make_temp_dir();

        let payload = read_workspace_file_content(&dir, "missing.txt").expect("read preview");

        assert_eq!(payload.file_path, "missing.txt");
        assert_eq!(payload.content, "");
        assert!(!payload.exists);
        assert!(!payload.is_binary);
        assert!(!payload.too_large);

        fs::remove_dir_all(dir).expect("remove temp dir");
    }

    #[test]
    fn read_workspace_file_content_returns_binary_payload() {
        let dir = make_temp_dir();
        let file_path = dir.join("image.bin");
        fs::write(&file_path, [0_u8, 159, 146, 150]).expect("write binary file");

        let payload = read_workspace_file_content(&dir, "image.bin").expect("read preview");

        assert_eq!(payload.file_path, "image.bin");
        assert_eq!(payload.content, "");
        assert!(payload.exists);
        assert!(payload.is_binary);
        assert!(!payload.too_large);

        fs::remove_dir_all(dir).expect("remove temp dir");
    }

    #[test]
    fn read_workspace_file_content_returns_too_large_payload() {
        let dir = make_temp_dir();
        let file_path = dir.join("large.txt");
        let content = vec![b'a'; (MAX_PREVIEW_BYTES as usize) + 1];
        fs::write(&file_path, content).expect("write large file");

        let payload = read_workspace_file_content(&dir, "large.txt").expect("read preview");

        assert_eq!(payload.file_path, "large.txt");
        assert_eq!(payload.content, "");
        assert!(payload.exists);
        assert!(!payload.is_binary);
        assert!(payload.too_large);

        fs::remove_dir_all(dir).expect("remove temp dir");
    }
}


