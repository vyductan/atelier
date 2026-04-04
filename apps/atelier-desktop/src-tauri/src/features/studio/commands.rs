use std::collections::HashMap;
use std::convert::Infallible;
use std::path::PathBuf;

use axum::extract::Query;
use axum::http::HeaderValue;
use axum::response::sse::{Event, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tower_http::cors::CorsLayer;

const PORT: u16 = 3131;

struct ActiveSession {
    stdin: ChildStdin,
    stop_tx: Option<oneshot::Sender<()>>,
}

impl ActiveSession {
    fn new(stdin: ChildStdin, stop_tx: oneshot::Sender<()>) -> Self {
        Self {
            stdin,
            stop_tx: Some(stop_tx),
        }
    }
}

// Global registry: session_id -> active session handle
 type ProcessRegistry = Mutex<HashMap<String, ActiveSession>>;

lazy_static::lazy_static! {
    static ref ACTIVE_SESSIONS: ProcessRegistry = Mutex::new(HashMap::new());
}

const ALLOWED_STUDIO_ORIGINS: [&str; 4] = [
    "http://localhost:1420",
    "http://localhost:3000",
    "http://localhost:5173",
    "tauri://localhost",
];

#[cfg(test)]
fn is_allowed_studio_origin(origin: &str) -> bool {
    ALLOWED_STUDIO_ORIGINS.contains(&origin)
}

pub async fn start_studio_server() {
    let cors = CorsLayer::new()
        .allow_origin(ALLOWED_STUDIO_ORIGINS.map(HeaderValue::from_static))
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
        .allow_headers([axum::http::header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/execute", post(handle_execute))
        .route("/browse", get(handle_browse))
        .route("/session/start", post(handle_session_start))
        .route("/session/send", post(handle_session_send))
        .route("/session/stop", post(handle_session_stop))
        .layer(cors);

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{PORT}"))
        .await
        .expect("Failed to bind studio server");

    println!("[studio] HTTP server listening on http://127.0.0.1:{PORT}");

    axum::serve(listener, app)
        .await
        .expect("Studio server error");
}

fn extract_stream_session_id(line: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(line)
        .ok()?
        .get("session_id")?
        .as_str()
        .map(|session_id| session_id.to_string())
}

fn resolve_registry_session_key(current_key: &str, reported_session_id: Option<&str>) -> Option<String> {
    let reported_session_id = reported_session_id?.trim();

    if reported_session_id.is_empty() || reported_session_id == current_key {
        return None;
    }

    Some(reported_session_id.to_string())
}

fn update_active_session_key(
    registry: &mut HashMap<String, ActiveSession>,
    current_key: &mut String,
    line: &str,
) {
    let Some(next_key) = resolve_registry_session_key(
        current_key,
        extract_stream_session_id(line).as_deref(),
    ) else {
        return;
    };

    if let Some(session) = registry.remove(current_key) {
        registry.insert(next_key.clone(), session);
        *current_key = next_key;
    }
}

fn stop_active_session(
    registry: &mut HashMap<String, ActiveSession>,
    session_id: &str,
) -> bool {
    let Some(mut session) = registry.remove(session_id) else {
        return false;
    };

    if let Some(stop_tx) = session.stop_tx.take() {
        let _ = stop_tx.send(());
    }

    true
}

fn build_initial_session_event_data(session_id: &str) -> String {
    format!(r#"{{"type":"system","session_id":"{session_id}"}}"#)
}

fn stop_session_status(stopped: bool) -> axum::http::StatusCode {
    if stopped {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

async fn write_session_line(stdin: &mut ChildStdin, line: &str) -> std::io::Result<()> {
    stdin.write_all(line.as_bytes()).await?;
    stdin.flush().await
}

fn build_error_event_data(error: &str) -> String {
    serde_json::json!({
        "type": "error",
        "error": error,
    })
    .to_string()
}

fn build_session_output_read_error_event_data(error: &str) -> String {
    build_error_event_data(&format!("failed to read Claude output: {error}"))
}

fn build_session_exit_error_event_data(status: &str) -> String {
    build_error_event_data(&format!("Claude exited with status {status}"))
}

fn handle_session_start_exit_error_event_data(error: &str) -> String {
    build_error_event_data(error)
}

fn build_stop_cleanup_error_event_data(error: &str) -> String {
    build_error_event_data(&format!("Failed to stop active session cleanly: {error}"))
}

fn should_report_stop_cleanup_error(
    process_exited: bool,
    kill_error: Option<&str>,
    wait_error: Option<&str>,
) -> Option<String> {
    match (process_exited, kill_error.map(str::trim), wait_error.map(str::trim)) {
        (_, _, Some(wait_error)) if !wait_error.is_empty() => Some(wait_error.to_string()),
        (true, _, None) => None,
        (false, Some(kill_error), None) if !kill_error.is_empty() => Some(kill_error.to_string()),
        _ => None,
    }
}

fn build_session_stderr_error_suffix(stderr: &str) -> String {
    let stderr = stderr.trim();

    if stderr.is_empty() {
        String::new()
    } else {
        format!(" (stderr: {stderr})")
    }
}

fn build_stderr_collection_error_suffix(error: Option<&str>) -> String {
    match error.map(str::trim) {
        Some("") | None => String::new(),
        Some(error) => format!(" (stderr unavailable: {error})"),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum StudioRuntimeErrorPriority {
    GenericExitFallback,
    MeaningfulStderr,
    StructuredToolOrSkillFailure,
    StructuredRuntimeError,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StudioRuntimeErrorCandidate {
    priority: StudioRuntimeErrorPriority,
    text: String,
}

fn normalized_error_candidate_text(text: &str) -> Option<String> {
    let text = text.trim();

    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn push_studio_runtime_error_candidate(
    candidates: &mut Vec<StudioRuntimeErrorCandidate>,
    priority: StudioRuntimeErrorPriority,
    text: &str,
) {
    let Some(text) = normalized_error_candidate_text(text) else {
        return;
    };

    if candidates.iter().any(|candidate| candidate.text == text) {
        return;
    }

    candidates.push(StudioRuntimeErrorCandidate { priority, text });
}

fn collect_json_string_values(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::String(text) => output.push(text.clone()),
        serde_json::Value::Array(items) => {
            for item in items {
                collect_json_string_values(item, output);
            }
        }
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(serde_json::Value::as_str) {
                output.push(text.to_string());
            }
            if let Some(content) = map.get("content") {
                collect_json_string_values(content, output);
            }
            if let Some(message) = map.get("message") {
                collect_json_string_values(message, output);
            }
            if let Some(error) = map.get("error") {
                collect_json_string_values(error, output);
            }
            if let Some(result) = map.get("result") {
                collect_json_string_values(result, output);
            }
        }
        _ => {}
    }
}

fn push_structured_runtime_error_candidates(
    candidates: &mut Vec<StudioRuntimeErrorCandidate>,
    line: &str,
) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };

    if let Some(error) = value.get("error").and_then(serde_json::Value::as_str) {
        push_studio_runtime_error_candidate(
            candidates,
            StudioRuntimeErrorPriority::StructuredRuntimeError,
            error,
        );
    }

    let is_structured_runtime_error = value
        .get("subtype")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|subtype| subtype == "error");

    if is_structured_runtime_error {
        let mut texts = Vec::new();
        if let Some(result) = value.get("result") {
            collect_json_string_values(result, &mut texts);
        }
        for text in texts {
            push_studio_runtime_error_candidate(
                candidates,
                StudioRuntimeErrorPriority::StructuredRuntimeError,
                &text,
            );
        }
    }

    if let Some(content_items) = value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_array)
    {
        for item in content_items {
            let is_tool_or_skill_failure = item
                .get("type")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|item_type| item_type == "tool_result")
                && item
                    .get("is_error")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);

            if !is_tool_or_skill_failure {
                continue;
            }

            let mut texts = Vec::new();
            if let Some(content) = item.get("content") {
                collect_json_string_values(content, &mut texts);
            }
            for text in texts {
                push_studio_runtime_error_candidate(
                    candidates,
                    StudioRuntimeErrorPriority::StructuredToolOrSkillFailure,
                    &text,
                );
            }
        }
    }
}

fn is_meaningful_stderr(stderr: &str, exit_fallback: &str) -> bool {
    let stderr = stderr.trim();
    let exit_fallback = exit_fallback.trim();

    !stderr.is_empty()
        && !stderr.starts_with("(stderr unavailable:")
        && stderr != exit_fallback
        && stderr != format!("Claude exited with status {exit_fallback}")
}

fn canonical_studio_runtime_error<I, S>(
    stream_lines: I,
    stderr: &str,
    exit_fallback: &str,
) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut candidates = Vec::new();

    for line in stream_lines {
        push_structured_runtime_error_candidates(&mut candidates, line.as_ref());
    }

    if is_meaningful_stderr(stderr, exit_fallback) {
        push_studio_runtime_error_candidate(
            &mut candidates,
            StudioRuntimeErrorPriority::MeaningfulStderr,
            stderr,
        );
    }

    push_studio_runtime_error_candidate(
        &mut candidates,
        StudioRuntimeErrorPriority::GenericExitFallback,
        exit_fallback,
    );

    candidates
        .into_iter()
        .max_by_key(|candidate| candidate.priority)
        .map(|candidate| candidate.text)
}

fn handle_execute_stream_line(line: Result<String, std::io::Error>) -> Option<String> {
    match line {
        Ok(text) => Some(serde_json::to_string(&text).unwrap_or(text)),
        Err(error) => Some(build_session_output_read_error_event_data(&error.to_string())),
    }
}

fn build_execute_exit_event_data(status_code: Option<i32>, stderr: &str) -> Option<String> {
    match status_code {
        Some(0) => None,
        Some(code) => Some(build_session_exit_error_event_data(&format!(
            "exit status: {code}{}",
            build_session_stderr_error_suffix(stderr),
        ))),
        None => Some(build_session_exit_error_event_data(&format!(
            "terminated by signal{}",
            build_session_stderr_error_suffix(stderr),
        ))),
    }
}

// --- /execute ---

#[derive(Deserialize)]
struct ExecutePayload {
    #[serde(rename = "projectPath")]
    project_path: String,
    prompt: String,
}

async fn handle_execute(Json(payload): Json<ExecutePayload>) -> impl IntoResponse {
    let cwd = expand_path(&payload.project_path);
    let prompt = payload.prompt.clone();

    let stream = async_stream::stream! {
        if !cwd.exists() {
            yield Ok::<Event, Infallible>(
                Event::default().data(build_error_event_data("Workspace directory does not exist or was removed"))
            );
            yield Ok(Event::default().data("[DONE]"));
            return;
        }

        let mut child = match Command::new("claude")
            .args(["-p", &prompt])
            .current_dir(&cwd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                yield Ok::<Event, Infallible>(
                    Event::default().data(format!("Error: {e}"))
                );
                yield Ok(Event::default().data("[DONE]"));
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let stderr_task = tokio::spawn(async move {
            let mut stderr_lines = BufReader::new(stderr).lines();
            let mut collected = Vec::new();
            loop {
                match stderr_lines.next_line().await {
                    Ok(Some(line)) => collected.push(line),
                    Ok(None) => break,
                    Err(error) => return (collected.join("\n"), Some(error.to_string())),
                }
            }
            (collected.join("\n"), None)
        });

        let mut stdout_lines = BufReader::new(stdout).lines();
        loop {
            match stdout_lines.next_line().await {
                Ok(Some(line)) => {
                    if let Some(data) = handle_execute_stream_line(Ok(line)) {
                        yield Ok(Event::default().data(data));
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    if let Some(data) = handle_execute_stream_line(Err(error)) {
                        yield Ok(Event::default().data(data));
                    }
                    break;
                }
            }
        }

        let (stderr_output, stderr_collection_error) = match stderr_task.await {
            Ok((output, error)) => (output, error),
            Err(error) => (String::new(), Some(error.to_string())),
        };

        match child.wait().await {
            Ok(status) => {
                let stderr_suffix = format!(
                    "{}{}",
                    build_session_stderr_error_suffix(&stderr_output),
                    build_stderr_collection_error_suffix(stderr_collection_error.as_deref())
                );
                if let Some(data) = build_execute_exit_event_data(status.code(), &stderr_suffix) {
                    yield Ok(Event::default().data(data));
                }
            }
            Err(error) => {
                yield Ok(Event::default().data(build_session_output_read_error_event_data(&error.to_string())));
            }
        }
        yield Ok(Event::default().data("[DONE]"));
    };

    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

// --- /browse ---

#[derive(Deserialize)]
struct BrowseQuery {
    path: Option<String>,
}

#[derive(Serialize)]
struct BrowseResult {
    current: String,
    dirs: Vec<DirEntry>,
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
}

async fn handle_browse(Query(q): Query<BrowseQuery>) -> impl IntoResponse {
    let raw = q.path.unwrap_or_else(|| "~".to_string());
    let dir = expand_path(&raw);

    match tokio::fs::read_dir(&dir).await {
        Ok(mut rd) => {
            let mut dirs = vec![];
            while let Ok(Some(entry)) = rd.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                if let Ok(ft) = entry.file_type().await {
                    if ft.is_dir() {
                        let path = entry.path().to_string_lossy().to_string();
                        dirs.push(DirEntry { name, path });
                    }
                }
            }
            dirs.sort_by(|a, b| a.name.cmp(&b.name));
            Json(BrowseResult {
                current: dir.to_string_lossy().to_string(),
                dirs,
            })
            .into_response()
        }
        Err(e) => (
            axum::http::StatusCode::BAD_REQUEST,
            format!("Cannot read directory: {e}"),
        )
            .into_response(),
    }
}

// --- /session/start ---

#[derive(Deserialize)]
struct SessionStartPayload {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "resumeSessionId")]
    resume_session_id: Option<String>,
    #[serde(rename = "projectPath")]
    project_path: String,
    #[serde(rename = "firstPrompt")]
    first_prompt: Option<String>,
    #[serde(rename = "resolvedModel")]
    resolved_model: Option<String>,
}

fn build_studio_session_args(payload: &SessionStartPayload) -> Vec<String> {
    let mut args = vec![
        "--verbose".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
    ];

    if let Some(ref sid) = payload.resume_session_id {
        args.extend(["--resume".to_string(), sid.clone()]);
    } else if let Some(ref resolved_model) = payload.resolved_model {
        args.extend(["--model".to_string(), resolved_model.clone()]);
    }

    args
}

async fn handle_session_start(Json(payload): Json<SessionStartPayload>) -> impl IntoResponse {
    let cwd = expand_path(&payload.project_path);
    let initial_key = payload
        .session_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let stream = async_stream::stream! {
        let args = build_studio_session_args(&payload);

        if !cwd.exists() {
            yield Ok::<Event, Infallible>(Event::default().data(build_error_event_data("Workspace directory does not exist or was removed")));
            yield Ok(Event::default().data("{\"type\":\"done\"}"));
            return;
        }

        let mut child = match Command::new("claude")
            .args(&args)
            .current_dir(&cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                yield Ok::<Event, Infallible>(Event::default().data(build_error_event_data(&e.to_string())));
                return;
            }
        };

        let (stop_tx, mut stop_rx) = oneshot::channel();
        let mut registry_key = initial_key.clone();

        // Store active session in registry
        if let Some(stdin) = child.stdin.take() {
            let mut registry = ACTIVE_SESSIONS.lock().await;
            registry.insert(registry_key.clone(), ActiveSession::new(stdin, stop_tx));
        }

        if payload.resume_session_id.is_none() {
            yield Ok(Event::default().data(build_initial_session_event_data(&registry_key)));
        }

        // Send first prompt if provided
        if let Some(ref prompt) = payload.first_prompt {
            let msg = serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": prompt }
            });
            let line = format!("{}\n", serde_json::to_string(&msg).unwrap());
            let mut registry = ACTIVE_SESSIONS.lock().await;
            if let Some(session) = registry.get_mut(&registry_key) {
                if let Err(error) = write_session_line(&mut session.stdin, &line).await {
                    registry.remove(&registry_key);
                    let kill_error = child.kill().await.err().map(|kill_error| kill_error.to_string());
                    let wait_error = child.wait().await.err().map(|wait_error| wait_error.to_string());
                    yield Ok(Event::default().data(build_error_event_data(&format!(
                        "failed to deliver first prompt: {error}"
                    ))));
                    if let Some(cleanup_error) = should_report_stop_cleanup_error(
                        wait_error.is_none(),
                        kill_error.as_deref(),
                        wait_error.as_deref(),
                    ) {
                        yield Ok(Event::default().data(build_stop_cleanup_error_event_data(&cleanup_error)));
                    }
                    yield Ok(Event::default().data("{\"type\":\"done\"}"));
                    return;
                }
            }
        }

        let stdout = child.stdout.take().unwrap();
        let stderr_task = child.stderr.take().map(|stderr| {
            tokio::spawn(async move {
                let mut stderr_lines = BufReader::new(stderr).lines();
                let mut collected = Vec::new();
                loop {
                    match stderr_lines.next_line().await {
                        Ok(Some(line)) => collected.push(line),
                        Ok(None) => break,
                        Err(error) => {
                            return (collected.join("\n"), Some(error.to_string()));
                        }
                    }
                }
                (collected.join("\n"), None)
            })
        });
        let mut lines = BufReader::new(stdout).lines();
        let mut emitted_lines = Vec::new();

        loop {
            tokio::select! {
                line = lines.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            if !line.is_empty() {
                                let mut registry = ACTIVE_SESSIONS.lock().await;
                                update_active_session_key(&mut registry, &mut registry_key, &line);
                                drop(registry);
                                emitted_lines.push(line.clone());
                                yield Ok(Event::default().data(line));
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            let mut registry = ACTIVE_SESSIONS.lock().await;
                            registry.remove(&registry_key);
                            yield Ok(Event::default().data(build_session_output_read_error_event_data(&error.to_string())));
                            yield Ok(Event::default().data("{\"type\":\"done\"}"));
                            return;
                        }
                    }
                }
                _ = &mut stop_rx => {
                    let kill_error = child.kill().await.err().map(|kill_error| kill_error.to_string());
                    let wait_error = child.wait().await.err().map(|wait_error| wait_error.to_string());
                    let mut registry = ACTIVE_SESSIONS.lock().await;
                    registry.remove(&registry_key);
                    if let Some(cleanup_error) = should_report_stop_cleanup_error(
                        wait_error.is_none(),
                        kill_error.as_deref(),
                        wait_error.as_deref(),
                    ) {
                        yield Ok(Event::default().data(build_stop_cleanup_error_event_data(&cleanup_error)));
                    }
                    yield Ok(Event::default().data("{\"type\":\"done\"}"));
                    return;
                }
            }
        }

        {
            let mut registry = ACTIVE_SESSIONS.lock().await;
            registry.remove(&registry_key);
        }
        let (stderr_output, stderr_collection_error) = if let Some(stderr_task) = stderr_task {
            match stderr_task.await {
                Ok((output, error)) => (output, error),
                Err(error) => (String::new(), Some(error.to_string())),
            }
        } else {
            (String::new(), None)
        };
        match child.wait().await {
            Ok(status) if status.success() => {}
            Ok(status) => {
                let exit_fallback = status.to_string();
                let stderr_message = stderr_output.trim().to_string();
                let stderr_message_with_suffix = format!(
                    "{}{}",
                    stderr_message,
                    build_stderr_collection_error_suffix(stderr_collection_error.as_deref())
                );
                if let Some(message) = canonical_studio_runtime_error(
                    emitted_lines.iter().map(String::as_str),
                    &stderr_message_with_suffix,
                    &exit_fallback,
                ) {
                    yield Ok(Event::default().data(handle_session_start_exit_error_event_data(&message)));
                }
            }
            Err(error) => {
                yield Ok(Event::default().data(build_session_output_read_error_event_data(&error.to_string())));
            }
        }
        yield Ok(Event::default().data("{\"type\":\"done\"}"));
    };

    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

// --- /session/send ---

#[derive(Deserialize)]
struct SessionSendPayload {
    #[serde(rename = "sessionId")]
    session_id: String,
    message: String,
}

async fn handle_session_send(Json(payload): Json<SessionSendPayload>) -> impl IntoResponse {
    let json_msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": payload.message }
    });
    let line = format!("{}\n", serde_json::to_string(&json_msg).unwrap());

    let mut registry = ACTIVE_SESSIONS.lock().await;
    if let Some(session) = registry.get_mut(&payload.session_id) {
        if write_session_line(&mut session.stdin, &line).await.is_ok() {
            Json(serde_json::json!({"ok": true})).into_response()
        } else {
            registry.remove(&payload.session_id);
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "failed to deliver message"})),
            )
                .into_response()
        }
    } else {
        (
            axum::http::StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "session not active"})),
        )
            .into_response()
    }
}

// --- /session/stop ---

#[derive(Deserialize)]
struct SessionStopPayload {
    #[serde(rename = "sessionId")]
    session_id: String,
}

async fn handle_session_stop(Json(payload): Json<SessionStopPayload>) -> impl IntoResponse {
    let mut registry = ACTIVE_SESSIONS.lock().await;
    let stopped = stop_active_session(&mut registry, &payload.session_id);

    if stopped {
        (
            stop_session_status(true),
            Json(serde_json::json!({"ok": true})),
        )
            .into_response()
    } else {
        (
            stop_session_status(false),
            Json(serde_json::json!({"error": "session not active"})),
        )
            .into_response()
    }
}

fn expand_path(p: &str) -> PathBuf {
    if p.starts_with('~') {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        home.join(p.trim_start_matches("~/").trim_start_matches('~'))
    } else {
        PathBuf::from(p)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_error_event_data, build_execute_exit_event_data,
        build_initial_session_event_data, build_session_exit_error_event_data,
        build_session_output_read_error_event_data, build_session_stderr_error_suffix,
        build_stderr_collection_error_suffix, build_stop_cleanup_error_event_data,
        build_studio_session_args, canonical_studio_runtime_error,
        handle_execute_stream_line, handle_session_send,
        handle_session_start_exit_error_event_data, handle_session_stop,
        is_allowed_studio_origin, is_meaningful_stderr, resolve_registry_session_key,
        should_report_stop_cleanup_error, stop_active_session, stop_session_status,
        update_active_session_key, ActiveSession, SessionSendPayload,
        SessionStartPayload, SessionStopPayload, ACTIVE_SESSIONS,
    };
    use crate::features::studio::claude_model::{
        default_context_window, format_claude_model, load_claude_model_capabilities,
        supports_multiple_context_windows,
    };
    use axum::body::to_bytes;
    use axum::response::IntoResponse;
    use std::collections::HashMap;
    use std::process::Stdio;
    use tokio::process::{ChildStdin, Command};
    use tokio::sync::oneshot;

    #[test]
    fn load_claude_model_capabilities_reads_shared_json_resource() {
        let capabilities =
            load_claude_model_capabilities().expect("shared Claude model capabilities should load");

        assert!(
            capabilities
                .models
                .iter()
                .any(|model| model.base_model == "claude-opus-4-6")
        );
    }

    #[test]
    fn format_claude_model_leaves_default_context_window_unsuffixed() {
        assert_eq!(
            format_claude_model("claude-opus-4-6", "default").as_deref(),
            Ok("claude-opus-4-6")
        );
    }

    #[test]
    fn format_claude_model_adds_suffix_for_one_million_context_window() {
        assert_eq!(
            format_claude_model("claude-opus-4-6", "1m").as_deref(),
            Ok("claude-opus-4-6[1m]")
        );
    }

    #[test]
    fn format_claude_model_rejects_unsupported_base_model_context_window_combinations() {
        assert!(format_claude_model("claude-opus-4-6", "200k").is_err());
        assert!(format_claude_model("claude-sonnet-4-5", "1m").is_err());
    }

    #[test]
    fn format_claude_model_preserves_exact_full_model_ids_without_alias_rewriting() {
        assert_eq!(
            format_claude_model("claude-opus-4-6[1m]", "default").as_deref(),
            Ok("claude-opus-4-6[1m]")
        );
    }

    #[test]
    fn claude_model_helpers_expose_context_window_support_metadata() {
        assert!(supports_multiple_context_windows("claude-opus-4-6"));
        assert_eq!(default_context_window("claude-opus-4-6"), Some("default"));
        assert!(!supports_multiple_context_windows("claude-sonnet-4-5"));
        assert_eq!(default_context_window("claude-sonnet-4-5"), None);
    }

    #[test]
    fn build_studio_session_args_appends_model_for_fresh_starts() {
        let args = build_studio_session_args(&SessionStartPayload {
            session_id: Some("session-123".to_string()),
            resume_session_id: None,
            project_path: "/tmp/project".to_string(),
            first_prompt: Some("Hello".to_string()),
            resolved_model: Some("claude-opus-4-6[1m]".to_string()),
        });

        assert_eq!(
            args,
            vec![
                "--verbose".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--input-format".to_string(),
                "stream-json".to_string(),
                "--model".to_string(),
                "claude-opus-4-6[1m]".to_string(),
            ]
        );
    }

    #[test]
    fn build_studio_session_args_keeps_resume_flows_free_of_model_args() {
        let args = build_studio_session_args(&SessionStartPayload {
            session_id: Some("session-123".to_string()),
            resume_session_id: Some("resume-123".to_string()),
            project_path: "/tmp/project".to_string(),
            first_prompt: None,
            resolved_model: Some("claude-opus-4-6[1m]".to_string()),
        });

        assert_eq!(
            args,
            vec![
                "--verbose".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--input-format".to_string(),
                "stream-json".to_string(),
                "--resume".to_string(),
                "resume-123".to_string(),
            ]
        );
    }

    #[test]
    fn build_initial_session_event_data_exposes_generated_session_id() {
        assert_eq!(
            build_initial_session_event_data("generated-key"),
            r#"{"type":"system","session_id":"generated-key"}"#
        );
    }

    #[test]
    fn stop_session_status_is_not_found_when_nothing_was_stopped() {
        assert_eq!(
            stop_session_status(false),
            axum::http::StatusCode::NOT_FOUND,
        );
    }

    #[test]
    fn is_allowed_studio_origin_accepts_local_app_origins() {
        assert!(is_allowed_studio_origin("http://localhost:1420"));
        assert!(is_allowed_studio_origin("http://localhost:3000"));
        assert!(is_allowed_studio_origin("http://localhost:5173"));
        assert!(is_allowed_studio_origin("tauri://localhost"));
    }

    #[test]
    fn is_allowed_studio_origin_rejects_untrusted_origins() {
        assert!(!is_allowed_studio_origin("https://evil.example"));
        assert!(!is_allowed_studio_origin("null"));
    }

    #[test]
    fn build_error_event_data_escapes_quotes_and_newlines() {
        let json: serde_json::Value = serde_json::from_str(&build_error_event_data(
            "bad \"quote\"\nnext line",
        ))
        .expect("error event should be valid json");

        assert_eq!(
            json,
            serde_json::json!({
                "type": "error",
                "error": "bad \"quote\"\nnext line",
            })
        );
    }

    #[test]
    fn build_session_output_read_error_event_data_surfaces_the_read_failure() {
        let json: serde_json::Value = serde_json::from_str(
            &build_session_output_read_error_event_data("stream broke"),
        )
        .expect("read error event should be valid json");

        assert_eq!(
            json,
            serde_json::json!({
                "type": "error",
                "error": "failed to read Claude output: stream broke",
            })
        );
    }

    #[test]
    fn handle_execute_stream_line_surfaces_read_errors_instead_of_ignoring_them() {
        let event = handle_execute_stream_line(Err(std::io::Error::other("stream broke")))
            .expect("read error should become an event");
        let json: serde_json::Value =
            serde_json::from_str(&event).expect("execute read error event should be valid json");

        assert_eq!(
            json,
            serde_json::json!({
                "type": "error",
                "error": "failed to read Claude output: stream broke",
            })
        );
    }

    #[test]
    fn build_session_exit_error_event_data_surfaces_non_zero_exit_status() {
        let json: serde_json::Value = serde_json::from_str(
            &build_session_exit_error_event_data("exit status: 1"),
        )
        .expect("exit error event should be valid json");

        assert_eq!(
            json,
            serde_json::json!({
                "type": "error",
                "error": "Claude exited with status exit status: 1",
            })
        );
    }

    #[test]
    fn build_execute_exit_event_data_surfaces_non_zero_statuses() {
        let event = build_execute_exit_event_data(Some(1), "").expect(
            "non-zero execute exit status should surface as an error event",
        );
        let json: serde_json::Value =
            serde_json::from_str(&event).expect("execute exit event should be valid json");

        assert_eq!(
            json,
            serde_json::json!({
                "type": "error",
                "error": "Claude exited with status exit status: 1",
            })
        );
    }

    #[test]
    fn build_session_stderr_error_suffix_includes_trimmed_stderr_output() {
        assert_eq!(
            build_session_stderr_error_suffix("\nresume failed\n"),
            " (stderr: resume failed)"
        );
    }

    #[test]
    fn build_session_stderr_error_suffix_is_empty_for_blank_stderr() {
        assert_eq!(build_session_stderr_error_suffix("  \n  "), "");
    }

    #[test]
    fn build_stderr_collection_error_suffix_includes_collection_failure() {
        assert_eq!(
            build_stderr_collection_error_suffix(Some("join failed")),
            " (stderr unavailable: join failed)"
        );
    }

    #[test]
    fn build_stderr_collection_error_suffix_is_empty_without_collection_failure() {
        assert_eq!(build_stderr_collection_error_suffix(None), "");
    }

    #[test]
    fn build_stop_cleanup_error_event_data_surfaces_kill_failures() {
        let json: serde_json::Value = serde_json::from_str(
            &build_stop_cleanup_error_event_data("kill failed"),
        )
        .expect("cleanup error event should be valid json");

        assert_eq!(
            json,
            serde_json::json!({
                "type": "error",
                "error": "Failed to stop active session cleanly: kill failed",
            })
        );
    }

    #[test]
    fn canonical_studio_runtime_error_prefers_structured_runtime_error_over_other_candidates() {
        let error = canonical_studio_runtime_error(
            [
                r#"{"type":"result","subtype":"error","result":"Generic fallback should lose"}"#,
                r#"{"type":"error","error":"Runtime structured error wins"}"#,
            ],
            "stderr should lose",
            "exit status: 1",
        );

        assert_eq!(error.as_deref(), Some("Runtime structured error wins"));
    }

    #[test]
    fn canonical_studio_runtime_error_prefers_tool_or_skill_failure_over_stderr_and_generic_exit() {
        let error = canonical_studio_runtime_error(
            [
                r#"{"type":"assistant","message":{"content":[{"type":"tool_result","is_error":true,"content":"Tool failed decisively"}]}}"#,
            ],
            "stderr should lose",
            "exit status: 1",
        );

        assert_eq!(error.as_deref(), Some("Tool failed decisively"));
    }

    #[test]
    fn canonical_studio_runtime_error_extracts_tool_result_failures_from_user_messages() {
        let error = canonical_studio_runtime_error(
            [
                r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Execute skill: update-config","is_error":true,"tool_use_id":"call_yhVrea7YfiJhG02tNYITWI15"}]}}"#,
            ],
            "stderr should lose",
            "exit status: 1",
        );

        assert_eq!(error.as_deref(), Some("Execute skill: update-config"));
    }

    #[test]
    fn canonical_studio_runtime_error_prefers_meaningful_stderr_over_generic_exit() {
        let error = canonical_studio_runtime_error([""; 0], "resume failed", "exit status: 1");

        assert_eq!(error.as_deref(), Some("resume failed"));
    }

    #[test]
    fn canonical_studio_runtime_error_uses_last_non_empty_candidate_with_same_priority() {
        let error = canonical_studio_runtime_error(
            [
                r#"{"type":"error","error":"first runtime error"}"#,
                r#"{"type":"error","error":"   "}"#,
                r#"{"type":"error","error":"last runtime error"}"#,
            ],
            "stderr should lose",
            "exit status: 1",
        );

        assert_eq!(error.as_deref(), Some("last runtime error"));
    }

    #[test]
    fn canonical_studio_runtime_error_ignores_blank_and_duplicate_candidates() {
        let error = canonical_studio_runtime_error(
            [
                r#"{"type":"assistant","message":{"content":[{"type":"tool_result","is_error":true,"content":"   "},{"type":"tool_result","is_error":true,"content":"same tool error"},{"type":"tool_result","is_error":true,"content":"same tool error"}]}}"#,
            ],
            "same tool error",
            "exit status: 1",
        );

        assert_eq!(error.as_deref(), Some("same tool error"));
    }

    #[test]
    fn handle_session_start_exit_error_event_data_uses_canonical_error_without_generic_prefix() {
        let json: serde_json::Value = serde_json::from_str(
            &handle_session_start_exit_error_event_data("Runtime structured error wins"),
        )
        .expect("session runtime error event should be valid json");

        assert_eq!(
            json,
            serde_json::json!({
                "type": "error",
                "error": "Runtime structured error wins",
            })
        );
    }

    #[test]
    fn is_meaningful_stderr_rejects_suffix_only_collection_text() {
        assert!(!is_meaningful_stderr(
            " (stderr unavailable: join failed)",
            "exit status: 1",
        ));
    }

    #[test]
    fn should_report_stop_cleanup_error_ignores_kill_failures_after_process_exit() {
        assert_eq!(
            should_report_stop_cleanup_error(true, Some("kill failed"), None),
            None,
        );
    }

    #[test]
    fn should_report_stop_cleanup_error_keeps_kill_failures_while_process_is_running() {
        assert_eq!(
            should_report_stop_cleanup_error(false, Some("kill failed"), None),
            Some("kill failed".to_string()),
        );
    }

    #[test]
    fn should_report_stop_cleanup_error_keeps_wait_failures() {
        assert_eq!(
            should_report_stop_cleanup_error(true, Some("kill failed"), Some("wait failed")),
            Some("wait failed".to_string()),
        );
    }

    #[test]
    fn resolve_registry_session_key_uses_stream_reported_session_id_for_new_sessions() {
        assert_eq!(
            resolve_registry_session_key(
                "generated-key",
                Some("claude-session-id"),
            ),
            Some("claude-session-id".to_string())
        );
    }

    #[tokio::test]
    async fn update_active_session_key_rekeys_the_registry() {
        let stdin = spawn_test_stdin().await;
        let (stop_tx, _stop_rx) = oneshot::channel();
        let mut registry = HashMap::new();
        registry.insert(
            "generated-key".to_string(),
            ActiveSession::new(stdin, stop_tx),
        );
        let mut current_key = "generated-key".to_string();

        update_active_session_key(
            &mut registry,
            &mut current_key,
            r#"{"type":"system","session_id":"claude-session-id"}"#,
        );

        assert_eq!(current_key, "claude-session-id");
        assert!(!registry.contains_key("generated-key"));
        assert!(registry.contains_key("claude-session-id"));
    }

    #[tokio::test]
    async fn stop_active_session_notifies_the_running_session_task() {
        let stdin = spawn_test_stdin().await;
        let (stop_tx, stop_rx) = oneshot::channel();
        let mut registry = HashMap::new();
        registry.insert(
            "claude-session-id".to_string(),
            ActiveSession::new(stdin, stop_tx),
        );

        assert!(stop_active_session(&mut registry, "claude-session-id"));
        assert!(stop_rx.await.is_ok());
        assert!(!registry.contains_key("claude-session-id"));
    }

    #[tokio::test]
    async fn handle_session_stop_reports_missing_sessions_explicitly() {
        {
            let mut registry = ACTIVE_SESSIONS.lock().await;
            registry.clear();
        }

        let response = handle_session_stop(axum::Json(SessionStopPayload {
            session_id: "already-exited-session".to_string(),
        }))
        .await
        .into_response();

        assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        let json: serde_json::Value =
            serde_json::from_slice(&body).expect("response body should be json");
        assert_eq!(json, serde_json::json!({"error": "session not active"}));
    }

    #[tokio::test]
    async fn handle_session_send_reports_broken_stdin_instead_of_claiming_success() {
        let stdin = spawn_closed_test_stdin().await;
        let (stop_tx, _stop_rx) = oneshot::channel();
        {
            let mut registry = ACTIVE_SESSIONS.lock().await;
            registry.clear();
            registry.insert(
                "broken-session".to_string(),
                ActiveSession::new(stdin, stop_tx),
            );
        }

        let response = handle_session_send(axum::Json(SessionSendPayload {
            session_id: "broken-session".to_string(),
            message: "hello".to_string(),
        }))
        .await
        .into_response();

        assert_eq!(
            response.status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        );
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        let json: serde_json::Value =
            serde_json::from_slice(&body).expect("response body should be json");
        assert_eq!(json, serde_json::json!({"error": "failed to deliver message"}));

        let mut registry = ACTIVE_SESSIONS.lock().await;
        registry.clear();
    }

    #[cfg(unix)]
    async fn spawn_test_stdin() -> ChildStdin {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("cat >/dev/null")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("test process should spawn");

        child.stdin.take().expect("test process should have stdin")
    }

    #[cfg(windows)]
    async fn spawn_test_stdin() -> ChildStdin {
        let mut child = Command::new("cmd")
            .args(["/C", "more >NUL"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("test process should spawn");

        child.stdin.take().expect("test process should have stdin")
    }

    #[cfg(unix)]
    async fn spawn_closed_test_stdin() -> ChildStdin {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("exit 0")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("closed test process should spawn");

        let stdin = child
            .stdin
            .take()
            .expect("closed test process should have stdin");
        let _ = child.wait().await;
        stdin
    }

    #[cfg(windows)]
    async fn spawn_closed_test_stdin() -> ChildStdin {
        let mut child = Command::new("cmd")
            .args(["/C", "exit /B 0"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("closed test process should spawn");

        let stdin = child
            .stdin
            .take()
            .expect("closed test process should have stdin");
        let _ = child.wait().await;
        stdin
    }
}
