use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::Manager;

fn resolve_task_snapshot_path_from_app_data_dir(
    app_data_dir: &Path,
    file_path: &str,
) -> Result<PathBuf, String> {
    let requested_path = Path::new(file_path);
    if requested_path.is_absolute() {
        return Err("task snapshot path must be relative".to_string());
    }

    if requested_path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("task snapshot path cannot contain parent traversal".to_string());
    }

    let resolved_path = app_data_dir.join(requested_path);
    if !resolved_path.starts_with(app_data_dir) {
        return Err("task snapshot path must stay within app data dir".to_string());
    }

    Ok(resolved_path)
}

fn resolve_task_snapshot_path<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    file_path: &str,
) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;

    resolve_task_snapshot_path_from_app_data_dir(&app_data_dir, file_path)
}

#[tauri::command]
pub fn read_scheduled_task_snapshot<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_path: String,
) -> Result<String, String> {
    let snapshot_path = resolve_task_snapshot_path(&app_handle, &file_path)?;
    std::fs::read_to_string(&snapshot_path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => "ENOENT: scheduled task snapshot not found".to_string(),
        _ => format!("failed to read scheduled task snapshot: {error}"),
    })
}

#[tauri::command]
pub fn write_scheduled_task_snapshot<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_path: String,
    contents: String,
) -> Result<(), String> {
    let snapshot_path = resolve_task_snapshot_path(&app_handle, &file_path)?;

    if let Some(parent) = snapshot_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create scheduled task snapshot directory: {error}"))?;
    }

    std::fs::write(&snapshot_path, contents)
        .map_err(|error| format!("failed to write scheduled task snapshot: {error}"))
}

fn claude_scheduled_tasks_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".claude").join("scheduled-tasks"))
}

fn validate_claude_scheduled_task_dir_name(task_dir_name: &str) -> Result<&str, String> {
    if task_dir_name.is_empty()
        || task_dir_name == "."
        || task_dir_name == ".."
        || task_dir_name.contains('/')
        || task_dir_name.contains('\\')
        || Path::new(task_dir_name).components().count() != 1
    {
        return Err("invalid Claude scheduled task directory name".to_string());
    }

    Ok(task_dir_name)
}

fn collect_claude_scheduled_task_files(tasks_dir: &Path) -> Result<Vec<String>, String> {
    let mut task_dirs = Vec::new();

    for entry_result in std::fs::read_dir(tasks_dir)
        .map_err(|error| format!("failed to read Claude scheduled tasks directory: {error}"))?
    {
        let entry = entry_result.map_err(|error| {
            format!(
                "failed to enumerate Claude scheduled task entry in {}: {error}",
                tasks_dir.display()
            )
        })?;

        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "failed to inspect Claude scheduled task entry {}: {error}",
                path.display()
            )
        })?;
        if !file_type.is_dir() {
            continue;
        }

        let skill_file_path = path.join("SKILL.md");
        match std::fs::metadata(&skill_file_path) {
            Ok(metadata) => {
                if !metadata.is_file() {
                    continue;
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "failed to inspect Claude scheduled task file {}: {error}",
                    skill_file_path.display()
                ));
            }
        }

        let file_name = entry.file_name().into_string().map_err(|_| {
            format!(
                "Claude scheduled task directory name is not valid UTF-8: {}",
                path.display()
            )
        })?;

        task_dirs.push(file_name);
    }

    task_dirs.sort();
    Ok(task_dirs)
}

#[tauri::command]
pub fn list_claude_scheduled_task_files() -> Result<Vec<String>, String> {
    let tasks_dir = claude_scheduled_tasks_dir()?;
    if !tasks_dir.exists() {
        return Ok(Vec::new());
    }

    collect_claude_scheduled_task_files(&tasks_dir)
}

#[tauri::command]
pub fn read_claude_scheduled_task_file(task_dir_name: String) -> Result<String, String> {
    let task_dir_name = validate_claude_scheduled_task_dir_name(&task_dir_name)?;
    let task_dir = claude_scheduled_tasks_dir()?.join(task_dir_name);
    let file_path = task_dir.join("SKILL.md");

    std::fs::read_to_string(&file_path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => "ENOENT: Claude scheduled task file not found".to_string(),
        _ => format!("failed to read Claude scheduled task file: {error}"),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        collect_claude_scheduled_task_files, resolve_task_snapshot_path_from_app_data_dir,
        validate_claude_scheduled_task_dir_name,
    };

    #[test]
    fn validate_claude_scheduled_task_dir_name_accepts_single_directory_name() {
        let validated = validate_claude_scheduled_task_dir_name("daily-review")
            .expect("single task directory name should be accepted");

        assert_eq!(validated, "daily-review");
    }

    #[test]
    fn validate_claude_scheduled_task_dir_name_rejects_traversal_and_separators() {
        for invalid in ["", ".", "..", "nested/task", "nested\\task", "../escape"] {
            assert!(
                validate_claude_scheduled_task_dir_name(invalid).is_err(),
                "{invalid:?} should be rejected"
            );
        }
    }

    #[test]
    fn resolve_task_snapshot_path_rejects_parent_traversal() {
        let app_data_dir = std::env::temp_dir().join(format!(
            "atelier-task-snapshot-parent-traversal-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&app_data_dir).expect("app data dir should be created");

        let error = resolve_task_snapshot_path_from_app_data_dir(&app_data_dir, "../outside.json")
            .expect_err("parent traversal should be rejected");

        let _ = std::fs::remove_dir_all(&app_data_dir);

        assert!(error.contains("cannot contain parent traversal"));
    }

    #[test]
    fn resolve_task_snapshot_path_rejects_paths_that_escape_app_data_dir() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-task-snapshot-escape-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let app_data_dir = temp_root.join("app-data");
        std::fs::create_dir_all(&app_data_dir).expect("app data dir should be created");

        let error = resolve_task_snapshot_path_from_app_data_dir(
            &app_data_dir,
            "snapshots/../../outside.json",
        )
        .expect_err("escaping path should be rejected");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(error.contains("cannot contain parent traversal"));
    }

    #[test]
    fn resolve_task_snapshot_path_accepts_nested_relative_paths_inside_app_data_dir() {
        let app_data_dir = std::env::temp_dir().join(format!(
            "atelier-task-snapshot-relative-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&app_data_dir).expect("app data dir should be created");

        let resolved = resolve_task_snapshot_path_from_app_data_dir(
            &app_data_dir,
            "snapshots/task-1/state.json",
        )
        .expect("nested relative path should be accepted");

        let _ = std::fs::remove_dir_all(&app_data_dir);

        assert_eq!(resolved, app_data_dir.join("snapshots/task-1/state.json"));
    }

    #[test]
    fn collect_claude_scheduled_task_files_lists_valid_task_directories() {
        let tasks_dir = std::env::temp_dir().join(format!(
            "atelier-claude-scheduled-tasks-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let valid_a = tasks_dir.join("daily-review");
        let valid_b = tasks_dir.join("weekly-report");
        let ignored_dir = tasks_dir.join("notes");
        let ignored_file = tasks_dir.join("README.md");

        std::fs::create_dir_all(&valid_a).expect("first task dir should be created");
        std::fs::create_dir_all(&valid_b).expect("second task dir should be created");
        std::fs::create_dir_all(&ignored_dir).expect("ignored dir should be created");
        std::fs::write(valid_a.join("SKILL.md"), "# daily").expect("first skill should be written");
        std::fs::write(valid_b.join("SKILL.md"), "# weekly").expect("second skill should be written");
        std::fs::write(&ignored_file, "ignored").expect("ignored file should be written");

        let listed = collect_claude_scheduled_task_files(&tasks_dir)
            .expect("valid scheduled task directories should be listed");

        let _ = std::fs::remove_dir_all(&tasks_dir);

        assert_eq!(listed, vec!["daily-review", "weekly-report"]);
    }

    #[cfg(unix)]
    #[test]
    fn collect_claude_scheduled_task_files_reports_skill_file_inspection_errors() {
        use std::os::unix::fs::PermissionsExt;

        let tasks_dir = std::env::temp_dir().join(format!(
            "atelier-claude-scheduled-tasks-permission-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let valid_dir = tasks_dir.join("daily-review");
        let blocked_dir = tasks_dir.join("blocked-task");

        std::fs::create_dir_all(&valid_dir).expect("valid task dir should be created");
        std::fs::create_dir_all(&blocked_dir).expect("blocked task dir should be created");
        std::fs::write(valid_dir.join("SKILL.md"), "# daily").expect("skill file should be written");
        std::fs::write(blocked_dir.join("SKILL.md"), "# blocked").expect("blocked skill should be written");

        let original_permissions = std::fs::metadata(&blocked_dir)
            .expect("blocked dir metadata should be readable")
            .permissions();
        let mut blocked_permissions = original_permissions.clone();
        blocked_permissions.set_mode(0o000);
        std::fs::set_permissions(&blocked_dir, blocked_permissions)
            .expect("blocked dir permissions should be updated");

        let error = collect_claude_scheduled_task_files(&tasks_dir)
            .expect_err("skill file inspection errors should be surfaced instead of ignored");

        std::fs::set_permissions(&blocked_dir, original_permissions)
            .expect("blocked dir permissions should be restored");
        let _ = std::fs::remove_dir_all(&tasks_dir);

        assert!(
            error.contains("failed to inspect Claude scheduled task file")
                || error.contains("Permission denied")
        );
    }
}
