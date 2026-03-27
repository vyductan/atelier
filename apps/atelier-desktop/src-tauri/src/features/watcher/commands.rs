use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

fn build_watch_path() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let watch_path = home_dir.join(".claude").join("projects");

    if !watch_path.exists() {
        return Err(format!("Session watch path does not exist: {}", watch_path.display()));
    }

    Ok(watch_path)
}

#[derive(Clone, Serialize)]
struct SessionsChangedPayload {
    path: String,
    kind: String,
}

fn build_kind_label(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(_) => Some("modify"),
        EventKind::Remove(_) => Some("remove"),
        _ => None,
    }
}

fn is_top_level_project_session_file(path: &std::path::Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(project_dir) = path.parent().and_then(|parent| parent.file_name()).and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(projects_dir) = path
        .parent()
        .and_then(|parent| parent.parent())
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
    else {
        return false;
    };
    let Some(claude_dir) = path
        .parent()
        .and_then(|parent| parent.parent())
        .and_then(|parent| parent.parent())
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
    else {
        return false;
    };

    if project_dir.is_empty() || projects_dir != "projects" || claude_dir != ".claude" {
        return false;
    }

    let ext = path.extension().and_then(|extension| extension.to_str()).unwrap_or("");
    file_name == "sessions-index.json" || ext == "jsonl"
}

fn build_relevant_session_payload(event: &Event) -> Option<SessionsChangedPayload> {
    let kind = build_kind_label(&event.kind)?;
    let path = event
        .paths
        .iter()
        .find(|path| is_top_level_project_session_file(path))?;

    Some(SessionsChangedPayload {
        path: path.display().to_string(),
        kind: kind.to_string(),
    })
}

pub fn start_fs_watcher(app: AppHandle) {
    let watch_path = match build_watch_path() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("{error}");
            return;
        }
    };

    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

        let mut watcher = match RecommendedWatcher::new(
            tx,
            Config::default().with_poll_interval(Duration::from_secs(2)),
        ) {
            Ok(w) => w,
            Err(error) => {
                eprintln!("Failed to create session watcher: {error}");
                return;
            }
        };

        if let Err(error) = watcher.watch(&watch_path, RecursiveMode::Recursive) {
            eprintln!("Failed to watch session path {}: {error}", watch_path.display());
            return;
        }

        // Keep watcher alive
        let _watcher = watcher;

        for res in rx {
            match res {
                Ok(event) => {
                    if let Some(payload) = build_relevant_session_payload(&event) {
                        if let Err(error) = app.emit("sessions-changed", payload) {
                            eprintln!("Failed to emit sessions-changed event: {error}");
                        }
                    }
                }
                Err(error) => {
                    eprintln!("Session watcher event error: {error}");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::build_relevant_session_payload;
    use notify::{Event, EventKind};
    use std::path::PathBuf;

    #[test]
    fn build_relevant_session_payload_ignores_non_change_events_for_session_files() {
        let event = Event {
            kind: EventKind::Any,
            paths: vec![PathBuf::from(
                "/Users/demo/.claude/projects/project/session.jsonl",
            )],
            attrs: Default::default(),
        };

        let payload = build_relevant_session_payload(&event);

        assert!(payload.is_none());
    }

    #[test]
    fn build_relevant_session_payload_ignores_subagent_session_files() {
        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![PathBuf::from(
                "/Users/demo/.claude/projects/project/parent/subagents/child.jsonl",
            )],
            attrs: Default::default(),
        };

        let payload = build_relevant_session_payload(&event);

        assert!(payload.is_none());
    }
}
