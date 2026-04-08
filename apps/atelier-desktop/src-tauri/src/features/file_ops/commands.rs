use std::{
    collections::{HashSet, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    process::Stdio,
};
use tauri::Manager;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use walkdir::WalkDir;

const IGNORED_DIRS: &[&str] = &["node_modules", "dist", ".turbo", ".next", ".git"];

fn is_ignored(entry: &walkdir::DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    IGNORED_DIRS.contains(&name.as_ref())
}

fn latest_modified_from_walkdir<I>(entries: I) -> Result<std::time::SystemTime, String>
where
    I: IntoIterator<Item = Result<walkdir::DirEntry, walkdir::Error>>,
{
    let mut max_time: Option<std::time::SystemTime> = None;

    for entry in entries {
        let entry = entry.map_err(|error| format!("failed to read @acme tree: {error}"))?;

        let metadata = entry
            .metadata()
            .map_err(|error| format!("failed to read @acme metadata: {error}"))?;
        let modified = metadata
            .modified()
            .map_err(|error| format!("failed to read @acme modified time: {error}"))?;

        match max_time {
            Some(current_max) => {
                if modified > current_max {
                    max_time = Some(modified);
                }
            }
            None => max_time = Some(modified),
        }
    }

    max_time.ok_or_else(|| "Not Found".to_string())
}

fn acme_rsync_args(src_root: &str, dest_root: &str) -> Vec<String> {
    let src_path = if src_root.ends_with('/') {
        src_root.to_string()
    } else {
        format!("{src_root}/")
    };
    let dest_path = if dest_root.ends_with('/') {
        dest_root.to_string()
    } else {
        format!("{dest_root}/")
    };

    vec![
        "-av".to_string(),
        "--delete".to_string(),
        "--exclude=node_modules".to_string(),
        "--exclude=dist".to_string(),
        "--exclude=.turbo".to_string(),
        "--exclude=.next".to_string(),
        "--exclude=.git".to_string(),
        "--filter=dir-merge,- .gitignore".to_string(),
        format!("{src_path}@acme/"),
        format!("{dest_path}@acme/"),
    ]
}

fn preview_acme_rsync_args(src_root: &str, dest_root: &str) -> Vec<String> {
    let mut args = acme_rsync_args(src_root, dest_root);
    args.insert(2, "--dry-run".to_string());
    args.insert(3, "--itemize-changes".to_string());
    args
}

fn run_rsync(args: Vec<String>, context: &str) -> Result<std::process::Output, String> {
    std::process::Command::new("rsync")
        .args(args)
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "rsync command is unavailable on this system".to_string()
            } else {
                format!("failed to run {context}: {error}")
            }
        })
}

fn build_acme_gitignore_matcher(root: &Path) -> Result<Gitignore, String> {
    let mut builder = GitignoreBuilder::new(root);
    let gitignore_path = root.join(".gitignore");

    if let Some(error) = builder.add(gitignore_path) {
        return Err(format!("failed to load @acme/.gitignore: {error}"));
    }

    builder
        .build()
        .map_err(|e| format!("failed to build @acme gitignore matcher: {e}"))
}

fn parse_git_status_porcelain(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .flat_map(|line| {
            let trimmed = line.trim_end();
            if trimmed.len() < 4 {
                return Vec::new();
            }

            trimmed[3..]
                .trim()
                .split(" -> ")
                .filter(|path| path.starts_with("@acme/"))
                .map(|path| path.to_string())
                .collect::<Vec<_>>()
        })
        .collect()
}

fn parse_nested_acme_git_status_porcelain(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .flat_map(|line| {
            let trimmed = line.trim_end();
            if trimmed.len() < 4 {
                return Vec::new();
            }

            trimmed[3..]
                .trim()
                .split(" -> ")
                .filter(|path| !path.is_empty())
                .map(|path| format!("@acme/{path}"))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn resolve_git_repo_root(root: &str) -> Result<Option<String>, String> {
    let output = std::process::Command::new("git")
        .args(["-C", root, "rev-parse", "--show-toplevel"])
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "git command is unavailable on this system".to_string()
            } else {
                format!("failed to resolve git repo root: {error}")
            }
        })?;

    if !output.status.success() {
        return Ok(None);
    }

    let repo_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if repo_root.is_empty() {
        return Ok(None);
    }

    Ok(Some(repo_root))
}

fn is_git_repo(root: &str) -> bool {
    std::process::Command::new("git")
        .args(["-C", root, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn resolve_primary_repo_path(path: &str) -> Option<String> {
    if is_git_repo(path) {
        return Some(path.to_string());
    }

    let nested_acme = Path::new(path).join("@acme");
    let nested_acme_str = nested_acme.to_string_lossy().to_string();
    if is_git_repo(&nested_acme_str) {
        return Some(nested_acme_str);
    }

    None
}

fn get_dirty_acme_paths(root: &str) -> Result<Vec<String>, String> {
    let Some(repo_path) = resolve_primary_repo_path(root) else {
        return Ok(vec![]);
    };

    let Some(repo_root) = resolve_git_repo_root(&repo_path)? else {
        return Ok(vec![]);
    };

    let repo_path_buf = Path::new(&repo_path);
    let repo_root_buf = Path::new(&repo_root);
    let repo_path_is_acme = repo_path_buf
        .file_name()
        .and_then(|name| name.to_str())
        == Some("@acme");
    let repo_root_is_acme = repo_root_buf
        .file_name()
        .and_then(|name| name.to_str())
        == Some("@acme");
    let is_nested_acme_repo = repo_path_is_acme && repo_root_is_acme;
    let pathspec = if is_nested_acme_repo { "." } else { "@acme" };

    let output = std::process::Command::new("git")
        .args(["-C", &repo_root, "status", "--porcelain", "--", pathspec])
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "git command is unavailable on this system".to_string()
            } else {
                format!("failed to run git status: {error}")
            }
        })?;

    if !output.status.success() {
        return Err(format!(
            "git status failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if is_nested_acme_repo {
        Ok(parse_nested_acme_git_status_porcelain(&stdout))
    } else {
        Ok(parse_git_status_porcelain(&stdout))
    }
}

fn get_repo_dirty_paths(root: &str) -> Result<Vec<String>, String> {
    if !is_git_repo(root) {
        return Ok(vec![]);
    }

    let Some(repo_root) = resolve_git_repo_root(root)? else {
        return Ok(vec![]);
    };

    let output = std::process::Command::new("git")
        .args(["-C", &repo_root, "status", "--porcelain"])
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "git command is unavailable on this system".to_string()
            } else {
                format!("failed to run git status: {error}")
            }
        })?;

    if !output.status.success() {
        return Err(format!(
            "git status failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect())
}

fn parse_rev_list_counts(stdout: &str) -> Result<(usize, usize), String> {
    let trimmed = stdout.trim();
    let mut parts = trimmed.split_whitespace();
    let behind = parts
        .next()
        .ok_or_else(|| "missing behind count".to_string())?
        .parse::<usize>()
        .map_err(|error| format!("invalid behind count: {error}"))?;
    let ahead = parts
        .next()
        .ok_or_else(|| "missing ahead count".to_string())?
        .parse::<usize>()
        .map_err(|error| format!("invalid ahead count: {error}"))?;

    Ok((behind, ahead))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtreeSyncSettingsPayload {
    pub repo_root: String,
    pub prefix: String,
    pub remote: String,
    pub branch: String,
    pub squash: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SyncProfilePayload {
    pub id: String,
    pub project_path: String,
    pub mode: String,
    pub primary_path: Option<String>,
    pub subtree: Option<SubtreeSyncSettingsPayload>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubtreeSyncStatusPayload {
    pub mode: String,
    pub state: String,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub dirty: bool,
    pub message: Option<String>,
}

fn subtree_misconfigured_status(message: &str) -> SubtreeSyncStatusPayload {
    SubtreeSyncStatusPayload {
        mode: "subtree".to_string(),
        state: "misconfigured".to_string(),
        ahead_count: 0,
        behind_count: 0,
        dirty: false,
        message: Some(message.to_string()),
    }
}

fn subtree_missing_status(message: &str) -> SubtreeSyncStatusPayload {
    SubtreeSyncStatusPayload {
        mode: "subtree".to_string(),
        state: "missing_subtree".to_string(),
        ahead_count: 0,
        behind_count: 0,
        dirty: false,
        message: Some(message.to_string()),
    }
}

fn subtree_status_payload(
    state: &str,
    ahead_count: usize,
    behind_count: usize,
    dirty: bool,
) -> SubtreeSyncStatusPayload {
    SubtreeSyncStatusPayload {
        mode: "subtree".to_string(),
        state: state.to_string(),
        ahead_count,
        behind_count,
        dirty,
        message: None,
    }
}

fn validate_subtree_profile(
    profile: &SyncProfilePayload,
) -> Result<&SubtreeSyncSettingsPayload, SubtreeSyncStatusPayload> {
    if profile.mode != "subtree" {
        return Err(subtree_misconfigured_status("sync profile mode must be subtree"));
    }

    let Some(settings) = profile.subtree.as_ref() else {
        return Err(subtree_misconfigured_status("subtree settings are required"));
    };

    if settings.repo_root.trim().is_empty() {
        return Err(subtree_misconfigured_status("subtree repoRoot is required"));
    }

    if settings.remote.trim().is_empty() {
        return Err(subtree_misconfigured_status("subtree remote is required"));
    }

    if settings.branch.trim().is_empty() {
        return Err(subtree_misconfigured_status("subtree branch is required"));
    }

    if settings.prefix != "@acme" {
        return Err(subtree_misconfigured_status("subtree prefix must be @acme"));
    }

    if !is_git_repo(&settings.repo_root) {
        return Err(subtree_misconfigured_status(
            "subtree repoRoot must be inside a git work tree",
        ));
    }

    Ok(settings)
}

fn run_git_command(root: &str, args: &[&str], context: &str) -> Result<std::process::Output, String> {
    std::process::Command::new("git")
        .args(["-C", root])
        .args(args)
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "git command is unavailable on this system".to_string()
            } else {
                format!("failed to run {context}: {error}")
            }
        })
}

fn subtree_head_ref(repo_root: &str, prefix: &str) -> Result<String, SubtreeSyncStatusPayload> {
    let output = run_git_command(
        repo_root,
        &["subtree", "split", "--prefix", prefix, "HEAD"],
        "git subtree split",
    )
    .map_err(|error| subtree_misconfigured_status(&error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not exist; use 'git subtree add'") {
            return Err(subtree_missing_status(
                "subtree prefix @acme is missing from the current branch",
            ));
        }

        return Err(subtree_misconfigured_status(&format!(
            "git subtree split failed: {}",
            stderr
        )));
    }

    let split_head = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if split_head.is_empty() {
        return Err(subtree_misconfigured_status(
            "git subtree split returned an empty revision",
        ));
    }

    Ok(split_head)
}

fn subtree_source_ref(
    repo_root: &str,
    remote: &str,
    branch: &str,
) -> Result<String, SubtreeSyncStatusPayload> {
    let source_ref = format!("{remote}/{branch}");
    let output = run_git_command(repo_root, &["rev-parse", &source_ref], "git rev-parse")
        .map_err(|error| subtree_misconfigured_status(&error))?;

    if !output.status.success() {
        return Err(subtree_misconfigured_status(
            "subtree source ref could not be resolved",
        ));
    }

    let source_sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if source_sha.is_empty() {
        return Err(subtree_misconfigured_status(
            "subtree source ref could not be resolved",
        ));
    }

    Ok(source_sha)
}

fn git_is_ancestor(
    repo_root: &str,
    ancestor: &str,
    descendant: &str,
) -> Result<bool, SubtreeSyncStatusPayload> {
    let output = run_git_command(
        repo_root,
        &["merge-base", "--is-ancestor", ancestor, descendant],
        "git merge-base",
    )
    .map_err(|error| subtree_misconfigured_status(&error))?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(subtree_misconfigured_status(&format!(
            "git merge-base failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))),
    }
}

fn get_subtree_sync_status(profile: &SyncProfilePayload) -> SubtreeSyncStatusPayload {
    let settings = match validate_subtree_profile(profile) {
        Ok(settings) => settings,
        Err(status) => return status,
    };

    let dirty = match get_dirty_acme_paths(&settings.repo_root) {
        Ok(paths) => !paths.is_empty(),
        Err(error) => return subtree_misconfigured_status(&error),
    };

    let split_head = match subtree_head_ref(&settings.repo_root, &settings.prefix) {
        Ok(split_head) => split_head,
        Err(status) => return status,
    };

    let source_sha = match subtree_source_ref(&settings.repo_root, &settings.remote, &settings.branch)
    {
        Ok(source_sha) => source_sha,
        Err(status) => return status,
    };

    let state = if split_head == source_sha {
        "clean"
    } else {
        let split_is_ancestor =
            match git_is_ancestor(&settings.repo_root, &split_head, &source_sha) {
                Ok(value) => value,
                Err(status) => return status,
            };
        let source_is_ancestor =
            match git_is_ancestor(&settings.repo_root, &source_sha, &split_head) {
                Ok(value) => value,
                Err(status) => return status,
            };

        if split_is_ancestor {
            "behind"
        } else if source_is_ancestor {
            "ahead"
        } else {
            "diverged"
        }
    };

    let revision_range = format!("{}/{}...{}", settings.remote, settings.branch, split_head);
    let output = match run_git_command(
        &settings.repo_root,
        &["rev-list", "--left-right", "--count", &revision_range],
        "git rev-list",
    ) {
        Ok(output) => output,
        Err(error) => return subtree_misconfigured_status(&error),
    };

    if !output.status.success() {
        return subtree_misconfigured_status(&format!(
            "git rev-list failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let (behind_count, ahead_count) =
        match parse_rev_list_counts(&String::from_utf8_lossy(&output.stdout)) {
            Ok(counts) => counts,
            Err(error) => return subtree_misconfigured_status(&error),
        };

    subtree_status_payload(state, ahead_count, behind_count, dirty)
}

fn subtree_apply_args(prefix: &str, remote: &str, branch: &str, squash: bool) -> Vec<String> {
    let mut args = vec![
        "subtree".to_string(),
        "pull".to_string(),
        format!("--prefix={prefix}"),
        remote.to_string(),
        branch.to_string(),
    ];

    if squash {
        args.push("--squash".to_string());
    }

    args
}

fn patch_show_args(commit: &str, relative_to: Option<&str>, pathspec: Option<&str>) -> Vec<String> {
    let mut args = vec!["show".to_string(), "--format=email".to_string()];

    if let Some(relative_to) = relative_to {
        args.push(format!("--relative={relative_to}"));
    }

    args.push(commit.to_string());

    if let Some(pathspec) = pathspec {
        args.push("--".to_string());
        args.push(pathspec.to_string());
    }

    args
}

fn patch_id_for_commit(
    repo_root: &str,
    commit: &str,
    relative_to: Option<&str>,
    pathspec: Option<&str>,
) -> Result<Option<String>, String> {
    let args = patch_show_args(commit, relative_to, pathspec);
    let arg_refs = args.iter().map(|arg| arg.as_str()).collect::<Vec<_>>();
    let show_output = run_git_command(repo_root, &arg_refs, "git show")?;

    if !show_output.status.success() {
        return Err(format!(
            "git show failed while computing patch id for {commit}: {}",
            String::from_utf8_lossy(&show_output.stderr)
        ));
    }

    let mut patch_id = std::process::Command::new("git")
        .args(["patch-id", "--stable"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "git command is unavailable on this system".to_string()
            } else {
                format!("failed to run git patch-id: {error}")
            }
        })?;

    if let Some(stdin) = patch_id.stdin.as_mut() {
        stdin
            .write_all(&show_output.stdout)
            .map_err(|error| format!("failed to write patch input to git patch-id: {error}"))?;
    }

    let output = patch_id
        .wait_with_output()
        .map_err(|error| format!("failed to read git patch-id output: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "git patch-id failed for {commit}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let patch_id = stdout
        .split_whitespace()
        .next()
        .map(str::to_string)
        .filter(|value| !value.is_empty());

    Ok(patch_id)
}

fn collect_patch_ids(
    repo_root: &str,
    relative_to: Option<&str>,
    pathspec: Option<&str>,
) -> Result<HashSet<String>, String> {
    let output = run_git_command(repo_root, &["rev-list", "--reverse", "HEAD"], "git rev-list")?;

    if !output.status.success() {
        return Err(format!(
            "git rev-list failed while collecting patch ids: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let mut patch_ids = HashSet::new();
    for commit in String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(patch_id) = patch_id_for_commit(repo_root, commit, relative_to, pathspec)? {
            patch_ids.insert(patch_id);
        }
    }

    Ok(patch_ids)
}

fn collect_unapplied_patch_commits(
    source_repo: &str,
    source_relative_to: Option<&str>,
    source_pathspec: Option<&str>,
    destination_patch_ids: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let output = run_git_command(source_repo, &["rev-list", "--reverse", "HEAD"], "git rev-list")?;

    if !output.status.success() {
        return Err(format!(
            "git rev-list failed while collecting source commits: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let mut commits = Vec::new();
    for commit in String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(patch_id) = patch_id_for_commit(
            source_repo,
            commit,
            source_relative_to,
            source_pathspec,
        )? {
            if !destination_patch_ids.contains(&patch_id) {
                commits.push(commit.to_string());
            }
        }
    }

    Ok(commits)
}

fn apply_patch_commit(
    source_repo: &str,
    commit: &str,
    source_relative_to: Option<&str>,
    source_pathspec: Option<&str>,
    destination_repo: &str,
    destination_directory: Option<&str>,
) -> Result<(), String> {
    let show_args = patch_show_args(commit, source_relative_to, source_pathspec);
    let show_arg_refs = show_args.iter().map(|arg| arg.as_str()).collect::<Vec<_>>();
    let show_output = run_git_command(source_repo, &show_arg_refs, "git show")?;

    if !show_output.status.success() {
        return Err(format!(
            "git show failed while preparing patch for {commit}: {}",
            String::from_utf8_lossy(&show_output.stderr)
        ));
    }

    let mut am_command = std::process::Command::new("git");
    am_command.arg("-C").arg(destination_repo).arg("am").arg("--3way");

    if let Some(directory) = destination_directory {
        am_command.arg(format!("--directory={directory}"));
    }

    let mut am_child = am_command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "git command is unavailable on this system".to_string()
            } else {
                format!("failed to run git am: {error}")
            }
        })?;

    if let Some(stdin) = am_child.stdin.as_mut() {
        stdin
            .write_all(&show_output.stdout)
            .map_err(|error| format!("failed to write patch input to git am: {error}"))?;
    }

    let output = am_child
        .wait_with_output()
        .map_err(|error| format!("failed to read git am output: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "git am failed for {commit}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

fn subtree_add_args(prefix: &str, remote: &str, branch: &str, squash: bool) -> Vec<String> {
    let mut args = vec![
        "subtree".to_string(),
        "add".to_string(),
        format!("--prefix={prefix}"),
        remote.to_string(),
        branch.to_string(),
    ];

    if squash {
        args.push("--squash".to_string());
    }

    args
}

fn parse_rsync_itemized_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("sending ")
        || trimmed.starts_with("sent ")
        || trimmed.starts_with("total size is")
        || trimmed.starts_with("Transfer starting:")
    {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let marker = parts.next()?;

    let path = parts.collect::<Vec<_>>().join(" ");
    if path.is_empty() {
        return None;
    }

    if marker.starts_with("*deleting") {
        return Some((path, "deleted".to_string()));
    }

    if marker.len() < 3 {
        return None;
    }

    let file_type = marker.chars().nth(1)?;
    if file_type != 'f' {
        return None;
    }

    let attrs: String = marker.chars().skip(2).collect();
    if attrs.chars().all(|ch| ch == '.') {
        return None;
    }

    if marker.contains('+') {
        return Some((path, "added".to_string()));
    }

    if attrs.contains('c') || attrs.contains('s') {
        return Some((path, "modified".to_string()));
    }

    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoMetadata {
    pub branch: String,
    pub last_commit_message: String,
    pub last_updated: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryRemoteStatus {
    pub upstream_branch: Option<String>,
    pub working_tree_dirty: bool,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SyncChangeType {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreviewFile {
    pub path: String,
    pub change_type: SyncChangeType,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreviewSummary {
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SyncConflictKind {
    Text,
    Binary,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SyncConflictResolution {
    Current,
    Incoming,
    Both,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreviewConflict {
    pub path: String,
    pub kind: SyncConflictKind,
    pub allowed_resolutions: Vec<SyncConflictResolution>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SyncPreviewFileAction {
    Keep,
    Delete,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreviewDecision {
    pub path: String,
    pub kind: SyncChangeType,
    pub allowed_actions: Vec<SyncPreviewFileAction>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictTextSide {
    pub label: String,
    pub content: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictDetail {
    pub path: String,
    pub kind: SyncConflictKind,
    pub current: Option<SyncConflictTextSide>,
    pub incoming: Option<SyncConflictTextSide>,
    pub both_preview: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictResolutionSelection {
    pub path: String,
    pub resolution: SyncConflictResolution,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreviewFileActionSelection {
    pub path: String,
    pub action: SyncPreviewFileAction,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RsyncConflictExecutionRequest {
    pub src: String,
    pub dest: String,
    pub direction: String,
    pub fingerprint: String,
    pub resolutions: Vec<SyncConflictResolutionSelection>,
    #[serde(default)]
    pub file_actions: Vec<SyncPreviewFileActionSelection>,
}

#[derive(Debug, PartialEq, Eq)]
enum ResolvedFileAction {
    KeepCurrent,
    ApplyIncoming,
    WriteBoth(String),
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreviewResult {
    pub files: Vec<SyncPreviewFile>,
    pub summary: SyncPreviewSummary,
    pub conflicts: Vec<SyncPreviewConflict>,
    pub decisions: Vec<SyncPreviewDecision>,
    pub fingerprint: String,
}

#[tauri::command]
pub fn get_latest_modified(path: String) -> Result<String, String> {
    let acme_path = Path::new(&path).join("@acme");
    if !acme_path.exists() || !acme_path.is_dir() {
        return Err("Not Found".to_string());
    }

    let time = latest_modified_from_walkdir(
        WalkDir::new(&acme_path)
            .into_iter()
            .filter_entry(|entry| !is_ignored(entry)),
    )?;

    let datetime: DateTime<Local> = time.into();
    Ok(datetime.format("%Y-%m-%d %H:%M:%S").to_string())
}

#[tauri::command]
pub fn get_repo_metadata(path: String) -> Result<RepoMetadata, String> {
    let repo_path = resolve_primary_repo_path(&path)
        .ok_or_else(|| "Selected primary path is not inside a git work tree".to_string())?;

    let branch_output = run_git_command(&repo_path, &["branch", "--show-current"], "git branch")?;
    if !branch_output.status.success() {
        return Err(format!(
            "git branch failed: {}",
            String::from_utf8_lossy(&branch_output.stderr)
        ));
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();
    if branch.is_empty() {
        return Err("Failed to resolve current branch".to_string());
    }

    let commit_output = run_git_command(&repo_path, &["log", "-1", "--pretty=%s"], "git log")?;
    if !commit_output.status.success() {
        return Err(format!(
            "git log failed: {}",
            String::from_utf8_lossy(&commit_output.stderr)
        ));
    }

    let last_commit_message = String::from_utf8_lossy(&commit_output.stdout).trim().to_string();
    if last_commit_message.is_empty() {
        return Err("Failed to resolve latest commit message".to_string());
    }

    let time = latest_modified_from_walkdir(
        WalkDir::new(&repo_path)
            .into_iter()
            .filter_entry(|entry| !is_ignored(entry)),
    )?;
    let datetime: DateTime<Local> = time.into();
    let last_updated = datetime.format("%Y-%m-%d %H:%M:%S").to_string();

    Ok(RepoMetadata {
        branch,
        last_commit_message,
        last_updated,
    })
}

#[tauri::command]
pub fn get_repo_remote_status(path: String) -> Result<PrimaryRemoteStatus, String> {
    let repo_path = resolve_primary_repo_path(&path)
        .ok_or_else(|| "Selected primary path is not inside a git work tree".to_string())?;

    let status_output = run_git_command(&repo_path, &["status", "--porcelain"], "git status")?;
    if !status_output.status.success() {
        return Err(format!(
            "git status failed: {}",
            String::from_utf8_lossy(&status_output.stderr)
        ));
    }

    let working_tree_dirty = !String::from_utf8_lossy(&status_output.stdout)
        .trim()
        .is_empty();

    let upstream_output = run_git_command(
        &repo_path,
        &["rev-parse", "--abbrev-ref", "@{upstream}"],
        "git rev-parse",
    )?;
    if !upstream_output.status.success() {
        return Ok(PrimaryRemoteStatus {
            upstream_branch: None,
            working_tree_dirty,
            ahead_count: 0,
            behind_count: 0,
            status: "unknown".to_string(),
            message: Some("No upstream branch configured".to_string()),
        });
    }

    let upstream_branch = String::from_utf8_lossy(&upstream_output.stdout)
        .trim()
        .to_string();
    if upstream_branch.is_empty() {
        return Ok(PrimaryRemoteStatus {
            upstream_branch: None,
            working_tree_dirty,
            ahead_count: 0,
            behind_count: 0,
            status: "unknown".to_string(),
            message: Some("Could not determine remote sync status".to_string()),
        });
    }

    let rev_list_output = run_git_command(
        &repo_path,
        &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
        "git rev-list",
    )?;
    if !rev_list_output.status.success() {
        return Ok(PrimaryRemoteStatus {
            upstream_branch: Some(upstream_branch),
            working_tree_dirty,
            ahead_count: 0,
            behind_count: 0,
            status: "unknown".to_string(),
            message: Some("Could not determine remote sync status".to_string()),
        });
    }

    let (behind_count, ahead_count) =
        parse_rev_list_counts(&String::from_utf8_lossy(&rev_list_output.stdout))?;

    let status = if working_tree_dirty || ahead_count > 0 {
        "unpublished"
    } else {
        "synced"
    };

    Ok(PrimaryRemoteStatus {
        upstream_branch: Some(upstream_branch),
        working_tree_dirty,
        ahead_count,
        behind_count,
        status: status.to_string(),
        message: None,
    })
}

fn validate_relative_preview_path(relative_path: &str) -> Result<(), String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err("relative_path must be a relative path".to_string());
    }

    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("relative_path cannot contain parent traversal".to_string());
    }

    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum DiffTarget {
    Existing(PathBuf),
    Empty,
}

fn resolve_diff_targets(
    src_root: &str,
    dest_root: &str,
    relative_path: &str,
    change_type: &str,
) -> (DiffTarget, DiffTarget) {
    let src_file = Path::new(src_root).join("@acme").join(relative_path);
    let dest_file = Path::new(dest_root).join("@acme").join(relative_path);

    match change_type {
        "added" => (DiffTarget::Empty, DiffTarget::Existing(src_file)),
        "deleted" => (DiffTarget::Existing(dest_file), DiffTarget::Empty),
        _ => (
            DiffTarget::Existing(dest_file),
            DiffTarget::Existing(src_file),
        ),
    }
}

fn run_unified_diff(command_name: &str, left: &Path, right: &Path) -> Result<String, String> {
    let output = std::process::Command::new(command_name)
        .args([
            "-u",
            left.to_str()
                .ok_or_else(|| "invalid left diff path".to_string())?,
            right
                .to_str()
                .ok_or_else(|| "invalid right diff path".to_string())?,
        ])
        .output()
        .map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                "diff command is unavailable on this system".to_string()
            } else {
                format!("failed to run diff: {error}")
            }
        })?;

    match output.status.code() {
        Some(0) => Ok(String::new()),
        Some(1) => Ok(String::from_utf8_lossy(&output.stdout).to_string()),
        _ => Err(format!(
            "diff failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )),
    }
}

fn is_probably_text(bytes: &[u8]) -> bool {
    if bytes.contains(&0) {
        return false;
    }

    std::str::from_utf8(bytes).is_ok()
}

fn classify_conflict_kind(
    current_bytes: &[u8],
    incoming_bytes: &[u8],
) -> Option<SyncConflictKind> {
    if current_bytes == incoming_bytes {
        return None;
    }

    if is_probably_text(current_bytes) && is_probably_text(incoming_bytes) {
        Some(SyncConflictKind::Text)
    } else {
        Some(SyncConflictKind::Binary)
    }
}

fn allowed_resolutions_for_conflict_kind(
    kind: &SyncConflictKind,
) -> Vec<SyncConflictResolution> {
    match kind {
        SyncConflictKind::Text => vec![
            SyncConflictResolution::Current,
            SyncConflictResolution::Incoming,
            SyncConflictResolution::Both,
        ],
        SyncConflictKind::Binary => vec![
            SyncConflictResolution::Current,
            SyncConflictResolution::Incoming,
        ],
    }
}

fn classify_preview_conflict(
    path: &str,
    current_bytes: Option<&[u8]>,
    incoming_bytes: Option<&[u8]>,
) -> Option<SyncPreviewConflict> {
    let (Some(current_bytes), Some(incoming_bytes)) = (current_bytes, incoming_bytes) else {
        return None;
    };

    let kind = classify_conflict_kind(current_bytes, incoming_bytes)?;

    Some(SyncPreviewConflict {
        path: path.to_string(),
        allowed_resolutions: allowed_resolutions_for_conflict_kind(&kind),
        kind,
    })
}

fn read_optional_file_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to read file bytes for {}: {error}", path.display())),
    }
}

fn build_preview_fingerprint(
    files: &[SyncPreviewFile],
    conflicts: &[SyncPreviewConflict],
    decisions: &[SyncPreviewDecision],
    src_root: &str,
    dest_root: &str,
) -> Result<String, String> {
    let mut hasher = DefaultHasher::new();
    src_root.hash(&mut hasher);
    dest_root.hash(&mut hasher);

    for file in files {
        file.path.hash(&mut hasher);
        file.change_type.hash(&mut hasher);

        let src_path = Path::new(src_root).join("@acme").join(&file.path);
        let dest_path = Path::new(dest_root).join("@acme").join(&file.path);

        for path in [&src_path, &dest_path] {
            path.to_string_lossy().hash(&mut hasher);

            match std::fs::metadata(path) {
                Ok(metadata) => {
                    metadata.len().hash(&mut hasher);
                    let modified = metadata
                        .modified()
                        .map_err(|error| {
                            format!(
                                "failed to read preview fingerprint modified time for {}: {error}",
                                path.display()
                            )
                        })?
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|error| {
                            format!(
                                "failed to normalize preview fingerprint modified time for {}: {error}",
                                path.display()
                            )
                        })?
                        .as_nanos();
                    modified.hash(&mut hasher);
                }
                Err(error) if error.kind() == ErrorKind::NotFound => {
                    0_u8.hash(&mut hasher);
                }
                Err(error) => {
                    return Err(format!(
                        "failed to read preview fingerprint metadata for {}: {error}",
                        path.display()
                    ));
                }
            }
        }
    }

    for conflict in conflicts {
        conflict.path.hash(&mut hasher);
        conflict.kind.hash(&mut hasher);
        for resolution in &conflict.allowed_resolutions {
            resolution.hash(&mut hasher);
        }
    }

    for decision in decisions {
        decision.path.hash(&mut hasher);
        decision.kind.hash(&mut hasher);
        for action in &decision.allowed_actions {
            action.hash(&mut hasher);
        }
    }

    Ok(format!("{:016x}", hasher.finish()))
}

fn conflict_label_for_direction(direction: &str, side: SyncConflictResolution) -> &'static str {
    match (direction, side) {
        ("to-primary", SyncConflictResolution::Current) => "Ours (Primary)",
        ("to-primary", SyncConflictResolution::Incoming) => "Theirs (Project)",
        ("from-primary", SyncConflictResolution::Current) => "Ours (Project)",
        ("from-primary", SyncConflictResolution::Incoming) => "Theirs (Primary)",
        (_, SyncConflictResolution::Current) => "Ours",
        (_, SyncConflictResolution::Incoming) => "Theirs",
        (_, SyncConflictResolution::Both) => "Both",
    }
}

fn normalize_conflict_text(content: &str) -> String {
    if content.ends_with('\n') {
        content.to_string()
    } else {
        format!("{content}\n")
    }
}

fn conflict_marker_label_for_direction(
    direction: &str,
    side: SyncConflictResolution,
) -> String {
    let label = conflict_label_for_direction(direction, side);

    if let Some((base, context)) = label.split_once(" ") {
        format!("{} {}", base.to_uppercase(), context)
    } else {
        label.to_uppercase()
    }
}

fn build_conflict_marker_output(current: &str, incoming: &str, direction: &str) -> String {
    format!(
        "<<<<<<< {}\n{}=======\n{}>>>>>>> {}\n",
        conflict_marker_label_for_direction(direction, SyncConflictResolution::Current),
        normalize_conflict_text(current),
        normalize_conflict_text(incoming),
        conflict_marker_label_for_direction(direction, SyncConflictResolution::Incoming),
    )
}


fn resolve_conflict_action(
    kind: &SyncConflictKind,
    current_bytes: &[u8],
    incoming_bytes: &[u8],
    resolution: SyncConflictResolution,
    direction: &str,
) -> Result<ResolvedFileAction, String> {
    match resolution {
        SyncConflictResolution::Current => Ok(ResolvedFileAction::KeepCurrent),
        SyncConflictResolution::Incoming => Ok(ResolvedFileAction::ApplyIncoming),
        SyncConflictResolution::Both => {
            if *kind != SyncConflictKind::Text {
                return Err("binary conflicts do not support both resolution".to_string());
            }

            let current = std::str::from_utf8(current_bytes)
                .map_err(|error| format!("failed to decode current conflict text: {error}"))?;
            let incoming = std::str::from_utf8(incoming_bytes)
                .map_err(|error| format!("failed to decode incoming conflict text: {error}"))?;

            Ok(ResolvedFileAction::WriteBoth(build_conflict_marker_output(
                current,
                incoming,
                direction,
            )))
        }
    }
}

fn apply_resolved_file_action(
    dest_root: &str,
    relative_path: &str,
    incoming_bytes: &[u8],
    action: ResolvedFileAction,
) -> Result<(), String> {
    let target = Path::new(dest_root).join("@acme").join(relative_path);

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create resolved conflict parent directory for {}: {error}",
                target.display()
            )
        })?;
    }

    match action {
        ResolvedFileAction::KeepCurrent => Ok(()),
        ResolvedFileAction::ApplyIncoming => std::fs::write(&target, incoming_bytes).map_err(|error| {
            format!("failed to write incoming conflict resolution for {}: {error}", target.display())
        }),
        ResolvedFileAction::WriteBoth(content) => std::fs::write(&target, content).map_err(|error| {
            format!("failed to write merged conflict resolution for {}: {error}", target.display())
        }),
    }
}

fn collect_preview_conflicts(
    src_root: &str,
    dest_root: &str,
    files: &[SyncPreviewFile],
    opposite_files: &[SyncPreviewFile],
) -> Result<Vec<SyncPreviewConflict>, String> {
    let opposite_modified_paths = opposite_files
        .iter()
        .filter(|file| file.change_type == SyncChangeType::Modified)
        .map(|file| file.path.as_str())
        .collect::<std::collections::HashSet<_>>();
    let mut conflicts = Vec::new();

    for preview_file in files {
        if preview_file.change_type != SyncChangeType::Modified
            || !opposite_modified_paths.contains(preview_file.path.as_str())
        {
            continue;
        }

        let src_bytes = read_optional_file_bytes(&Path::new(src_root).join("@acme").join(&preview_file.path))?;
        let dest_bytes = read_optional_file_bytes(&Path::new(dest_root).join("@acme").join(&preview_file.path))?;

        if let Some(conflict) = classify_preview_conflict(&preview_file.path, dest_bytes.as_deref(), src_bytes.as_deref()) {
            conflicts.push(conflict);
        }
    }

    Ok(conflicts)
}

fn parse_preview_files(
    src_root: &str,
    dest_root: &str,
) -> Result<(Vec<SyncPreviewFile>, SyncPreviewSummary), String> {
    let output = run_rsync(preview_acme_rsync_args(src_root, dest_root), "rsync dry-run")?;

    if !output.status.success() {
        return Err(format!(
            "rsync dry-run failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let gitignore = build_acme_gitignore_matcher(&Path::new(src_root).join("@acme"))?;

    let mut files = Vec::new();
    let mut summary = SyncPreviewSummary {
        added: 0,
        modified: 0,
        deleted: 0,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some((path, change_type)) = parse_rsync_itemized_line(line) {
            if path.ends_with('/') {
                continue;
            }

            if gitignore
                .matched_path_or_any_parents(Path::new(&path), false)
                .is_ignore()
            {
                continue;
            }

            let change_type = match change_type.as_str() {
                "added" => {
                    summary.added += 1;
                    SyncChangeType::Added
                }
                "deleted" => {
                    summary.deleted += 1;
                    SyncChangeType::Deleted
                }
                _ => {
                    summary.modified += 1;
                    SyncChangeType::Modified
                }
            };

            files.push(SyncPreviewFile { path, change_type });
        }
    }

    Ok((files, summary))
}

fn build_preview_decisions(
    src_root: &str,
    dest_root: &str,
    direction: &str,
    files: &[SyncPreviewFile],
) -> Vec<SyncPreviewDecision> {
    if direction != "to-primary" {
        return Vec::new();
    }

    files
        .iter()
        .filter_map(|file| {
            let src_file = Path::new(src_root).join("@acme").join(&file.path);
            let dest_file = Path::new(dest_root).join("@acme").join(&file.path);

            match file.change_type {
                SyncChangeType::Added if src_file.exists() && !dest_file.exists() => {
                    Some(SyncPreviewDecision {
                        path: file.path.clone(),
                        kind: SyncChangeType::Added,
                        allowed_actions: vec![
                            SyncPreviewFileAction::Keep,
                            SyncPreviewFileAction::Delete,
                        ],
                    })
                }
                SyncChangeType::Deleted if !src_file.exists() && dest_file.exists() => {
                    Some(SyncPreviewDecision {
                        path: file.path.clone(),
                        kind: SyncChangeType::Deleted,
                        allowed_actions: vec![
                            SyncPreviewFileAction::Keep,
                            SyncPreviewFileAction::Delete,
                        ],
                    })
                }
                _ => None,
            }
        })
        .collect()
}

fn build_preview_snapshot(
    src_root: &str,
    dest_root: &str,
    direction: &str,
) -> Result<(
    Vec<SyncPreviewFile>,
    SyncPreviewSummary,
    Vec<SyncPreviewConflict>,
    Vec<SyncPreviewDecision>,
    String,
), String> {
    let (files, summary) = parse_preview_files(src_root, dest_root)?;
    let (opposite_files, _opposite_summary) = parse_preview_files(dest_root, src_root)?;
    let conflicts = collect_preview_conflicts(src_root, dest_root, &files, &opposite_files)?;
    let decisions = build_preview_decisions(src_root, dest_root, direction, &files);
    let fingerprint =
        build_preview_fingerprint(&files, &conflicts, &decisions, src_root, dest_root)?;

    Ok((files, summary, conflicts, decisions, fingerprint))
}

struct PreviewExecutionSnapshot {
    conflicts: Vec<SyncPreviewConflict>,
    decisions: Vec<SyncPreviewDecision>,
}

fn ensure_preview_fingerprint_matches(
    src_root: &str,
    dest_root: &str,
    direction: &str,
    fingerprint: &str,
) -> Result<PreviewExecutionSnapshot, String> {
    let (_files, _summary, conflicts, decisions, current_fingerprint) =
        build_preview_snapshot(src_root, dest_root, direction)?;

    if current_fingerprint != fingerprint {
        return Err("Conflict preview is stale. Refresh preview and try again.".to_string());
    }

    Ok(PreviewExecutionSnapshot {
        conflicts,
        decisions,
    })
}

fn read_conflict_bytes(
    src_root: &str,
    dest_root: &str,
    relative_path: &str,
) -> Result<(Vec<u8>, Vec<u8>, SyncConflictKind), String> {
    validate_relative_preview_path(relative_path)?;

    let current_path = Path::new(dest_root).join("@acme").join(relative_path);
    let incoming_path = Path::new(src_root).join("@acme").join(relative_path);
    let current_bytes = read_optional_file_bytes(&current_path)?
        .ok_or_else(|| format!("current conflict file not found: {relative_path}"))?;
    let incoming_bytes = read_optional_file_bytes(&incoming_path)?
        .ok_or_else(|| format!("incoming conflict file not found: {relative_path}"))?;

    let kind = classify_conflict_kind(&current_bytes, &incoming_bytes)
        .ok_or_else(|| format!("{relative_path} is not a conflict"))?;

    Ok((current_bytes, incoming_bytes, kind))
}

fn build_sync_conflict_detail(
    src_root: &str,
    dest_root: &str,
    relative_path: &str,
    direction: &str,
) -> Result<SyncConflictDetail, String> {
    let (current_bytes, incoming_bytes, kind) =
        read_conflict_bytes(src_root, dest_root, relative_path)?;

    match kind {
        SyncConflictKind::Text => {
            let current = std::str::from_utf8(&current_bytes)
                .map_err(|error| format!("failed to decode current conflict text: {error}"))?
                .to_string();
            let incoming = std::str::from_utf8(&incoming_bytes)
                .map_err(|error| format!("failed to decode incoming conflict text: {error}"))?
                .to_string();

            Ok(SyncConflictDetail {
                path: relative_path.to_string(),
                kind: SyncConflictKind::Text,
                current: Some(SyncConflictTextSide {
                    label: conflict_label_for_direction(direction, SyncConflictResolution::Current)
                        .to_string(),
                    content: current.clone(),
                }),
                incoming: Some(SyncConflictTextSide {
                    label: conflict_label_for_direction(direction, SyncConflictResolution::Incoming)
                        .to_string(),
                    content: incoming.clone(),
                }),
                both_preview: Some(build_conflict_marker_output(&current, &incoming, direction)),
                message: None,
            })
        }
        SyncConflictKind::Binary => Ok(SyncConflictDetail {
            path: relative_path.to_string(),
            kind: SyncConflictKind::Binary,
            current: None,
            incoming: None,
            both_preview: None,
            message: Some(
                "Binary conflict preview is unavailable; choose Ours or Theirs.".to_string(),
            ),
        }),
    }
}

fn execute_rsync_sync_internal_with_dirty_override(
    src: &str,
    dest: &str,
    allowed_dirty_paths: &[String],
) -> Result<(), String> {
    ensure_rsync_sync_destination_is_clean(dest, allowed_dirty_paths)?;

    let output = run_rsync(acme_rsync_args(src, dest), "rsync sync")?;

    if !output.status.success() {
        return Err(format!(
            "rsync sync failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn preview_sync_changes(
    src: String,
    dest: String,
    direction: String,
) -> Result<SyncPreviewResult, String> {
    let (files, summary, conflicts, decisions, fingerprint) =
        build_preview_snapshot(&src, &dest, &direction)?;

    Ok(SyncPreviewResult {
        files,
        summary,
        conflicts,
        decisions,
        fingerprint,
    })
}

#[tauri::command]
pub fn get_sync_conflict_detail(
    src: String,
    dest: String,
    relative_path: String,
    direction: String,
) -> Result<SyncConflictDetail, String> {
    build_sync_conflict_detail(&src, &dest, &relative_path, &direction)
}

#[tauri::command]
pub fn preview_sync_file_diff(
    src: String,
    dest: String,
    relative_path: String,
    change_type: String,
) -> Result<String, String> {
    validate_relative_preview_path(&relative_path)?;
    let (left, right) = resolve_diff_targets(&src, &dest, &relative_path, &change_type);
    let temp_empty_path = std::env::temp_dir().join(format!(
        "atelier-diff-empty-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("failed to build temp diff path: {e}"))?
            .as_nanos()
    ));
    let needs_empty_side = matches!(left, DiffTarget::Empty) || matches!(right, DiffTarget::Empty);

    if needs_empty_side {
        std::fs::write(&temp_empty_path, b"")
            .map_err(|e| format!("failed to create empty diff file: {e}"))?;
    }

    let left_path = match &left {
        DiffTarget::Existing(path) => path,
        DiffTarget::Empty => &temp_empty_path,
    };
    let right_path = match &right {
        DiffTarget::Existing(path) => path,
        DiffTarget::Empty => &temp_empty_path,
    };

    let diff_result = run_unified_diff("diff", left_path, right_path);

    if needs_empty_side {
        let _ = std::fs::remove_file(&temp_empty_path);
    }

    diff_result
}

fn ensure_rsync_sync_destination_is_clean(
    dest: &str,
    allowed_dirty_paths: &[String],
) -> Result<(), String> {
    let dirty_paths = get_dirty_acme_paths(dest)?;
    let blocking_dirty_paths = dirty_paths
        .into_iter()
        .filter(|path| !allowed_dirty_paths.contains(path))
        .collect::<Vec<_>>();

    if !blocking_dirty_paths.is_empty() {
        return Err(format!(
            "refusing to sync into repo with local @acme changes: {}",
            blocking_dirty_paths.join(", ")
        ));
    }

    Ok(())
}

fn execute_rsync_sync_internal(src: &str, dest: &str) -> Result<(), String> {
    execute_rsync_sync_internal_with_dirty_override(src, dest, &[])
}

#[tauri::command]
pub fn execute_rsync_sync(src: String, dest: String) -> Result<(), String> {
    execute_rsync_sync_internal(&src, &dest)
}

#[tauri::command]
pub fn execute_rsync_conflict_resolutions(
    request: RsyncConflictExecutionRequest,
) -> Result<(), String> {
    let snapshot = ensure_preview_fingerprint_matches(
        &request.src,
        &request.dest,
        &request.direction,
        &request.fingerprint,
    )?;
    let mut allowed_dirty_paths = Vec::new();
    let mut pending_file_deletes = Vec::new();
    let mut pending_file_restores = Vec::new();

    for selection in &request.resolutions {
        let conflict = snapshot
            .conflicts
            .iter()
            .find(|conflict| conflict.path == selection.path)
            .ok_or_else(|| {
                format!(
                    "Conflict preview is stale for {}. Refresh preview and try again.",
                    selection.path
                )
            })?;

        if !conflict.allowed_resolutions.contains(&selection.resolution) {
            return Err(format!(
                "resolution {:?} is not allowed for {}",
                selection.resolution, selection.path
            ));
        }

        let (current_bytes, incoming_bytes, _kind) =
            read_conflict_bytes(&request.src, &request.dest, &selection.path)?;

        let action = resolve_conflict_action(
            &conflict.kind,
            &current_bytes,
            &incoming_bytes,
            selection.resolution,
            &request.direction,
        )?;

        apply_resolved_file_action(&request.dest, &selection.path, &incoming_bytes, action)?;
        allowed_dirty_paths.push(format!("@acme/{}", selection.path));
    }

    for decision in &snapshot.decisions {
        let has_selection = request
            .file_actions
            .iter()
            .any(|selection| selection.path == decision.path);

        if !has_selection {
            return Err(format!(
                "missing required file action for {}. Refresh preview and try again.",
                decision.path
            ));
        }
    }

    for selection in &request.file_actions {
        let decision = snapshot
            .decisions
            .iter()
            .find(|decision| decision.path == selection.path)
            .ok_or_else(|| {
                format!(
                    "preview action is not allowed for {}. Refresh preview and try again.",
                    selection.path
                )
            })?;

        if !decision.allowed_actions.contains(&selection.action) {
            return Err(format!(
                "preview action {:?} is not allowed for {}",
                selection.action, selection.path
            ));
        }

        match (&decision.kind, &selection.action) {
            (SyncChangeType::Deleted, SyncPreviewFileAction::Keep) => {
                pending_file_restores.push(selection.path.clone());
                allowed_dirty_paths.push(format!("@acme/{}", selection.path));
            }
            (_, SyncPreviewFileAction::Keep) => {}
            (_, SyncPreviewFileAction::Delete) => {
                pending_file_deletes.push(selection.path.clone());
                allowed_dirty_paths.push(format!("@acme/{}", selection.path));
            }
        }
    }

    let _ = &request.direction;

    ensure_rsync_sync_destination_is_clean(&request.dest, &allowed_dirty_paths)?;

    for relative_path in &pending_file_restores {
        let source = Path::new(&request.dest).join("@acme").join(relative_path);
        let target = Path::new(&request.src).join("@acme").join(relative_path);

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create restore parent directory for {}: {error}",
                    target.display()
                )
            })?;
        }

        std::fs::copy(&source, &target).map_err(|error| {
            format!(
                "failed to restore {} from destination before sync: {error}",
                relative_path
            )
        })?;
    }

    for relative_path in pending_file_deletes {
        delete_sync_file(request.src.clone(), relative_path)?;
    }

    execute_rsync_sync_internal_with_dirty_override(
        &request.src,
        &request.dest,
        &allowed_dirty_paths,
    )
}

#[tauri::command]
pub fn get_rsync_git_safety(root: String) -> Result<Vec<String>, String> {
    get_dirty_acme_paths(&root)
}

#[tauri::command]
pub fn get_sync_status(profile: SyncProfilePayload) -> Result<SubtreeSyncStatusPayload, String> {
    Ok(get_subtree_sync_status(&profile))
}

#[tauri::command]
pub fn preview_subtree_sync(
    profile: SyncProfilePayload,
    direction: String,
) -> Result<SubtreeSyncStatusPayload, String> {
    let mut status = get_subtree_sync_status(&profile);

    if status.message.is_none() {
        status.message = Some(match direction.as_str() {
            "to-primary" => "Previewing subtree push to primary".to_string(),
            "from-primary" => "Previewing subtree pull from primary".to_string(),
            _ => "Previewing subtree sync".to_string(),
        });
    }

    Ok(status)
}

#[tauri::command]
pub fn execute_subtree_sync(
    profile: SyncProfilePayload,
    direction: String,
) -> Result<(), String> {
    let settings = validate_subtree_profile(&profile).map_err(|status| {
        status
            .message
            .unwrap_or_else(|| "subtree profile is misconfigured".to_string())
    })?;

    let dirty_paths = get_repo_dirty_paths(&settings.repo_root)?;
    if !dirty_paths.is_empty() {
        return Err(format!(
            "refusing subtree sync with dirty git repo: {}",
            dirty_paths.join(", ")
        ));
    }

    match direction.as_str() {
        "from-primary" => {
            let args = subtree_apply_args(
                &settings.prefix,
                &settings.remote,
                &settings.branch,
                settings.squash,
            );
            let arg_refs = args.iter().map(|arg| arg.as_str()).collect::<Vec<_>>();
            let output = run_git_command(&settings.repo_root, &arg_refs, "git subtree pull")?;

            if !output.status.success() {
                return Err(format!(
                    "git subtree pull failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(())
        }
        "to-primary" => Err(
            "subtree push is not implemented yet; use pull-only subtree mode for MVP"
                .to_string(),
        ),
        _ => Err(format!("unsupported subtree sync direction: {direction}")),
    }
}

#[tauri::command]
pub fn execute_patch_sync(
    profile: SyncProfilePayload,
    direction: String,
) -> Result<(), String> {
    if profile.mode != "patch" {
        return Err("sync profile mode must be patch".to_string());
    }

    let primary_root = profile
        .primary_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| "patch sync requires a primary path".to_string())?;
    let project_root = profile.project_path.as_str();

    if !is_git_repo(primary_root) {
        return Err("patch sync primary path must be inside a git work tree".to_string());
    }

    if !is_git_repo(project_root) {
        return Err("patch sync project path must be inside a git work tree".to_string());
    }

    let (source_repo, source_relative_to, source_pathspec, destination_repo, destination_directory) =
        match direction.as_str() {
            "from-primary" => (primary_root, None, None, project_root, Some("@acme")),
            "to-primary" => (project_root, Some("@acme"), Some("@acme"), primary_root, None),
            _ => return Err(format!("unsupported patch sync direction: {direction}")),
        };

    let source_dirty_paths = get_repo_dirty_paths(source_repo)?;
    if !source_dirty_paths.is_empty() {
        return Err(format!(
            "refusing patch sync from dirty git repo: {}",
            source_dirty_paths.join(", ")
        ));
    }

    let destination_dirty_paths = get_repo_dirty_paths(destination_repo)?;
    if !destination_dirty_paths.is_empty() {
        return Err(format!(
            "refusing patch sync with dirty git repo: {}",
            destination_dirty_paths.join(", ")
        ));
    }

    let destination_patch_ids = match direction.as_str() {
        "from-primary" => collect_patch_ids(destination_repo, Some("@acme"), Some("@acme"))?,
        "to-primary" => collect_patch_ids(destination_repo, None, None)?,
        _ => unreachable!(),
    };

    let commits_to_apply = collect_unapplied_patch_commits(
        source_repo,
        source_relative_to,
        source_pathspec,
        &destination_patch_ids,
    )?;

    for commit in commits_to_apply {
        apply_patch_commit(
            source_repo,
            &commit,
            source_relative_to,
            source_pathspec,
            destination_repo,
            destination_directory,
        )?;
    }

    Ok(())
}

#[tauri::command]
pub fn execute_subtree_add(profile: SyncProfilePayload) -> Result<(), String> {
    let settings = validate_subtree_profile(&profile).map_err(|status| {
        status
            .message
            .unwrap_or_else(|| "subtree profile is misconfigured".to_string())
    })?;

    let args = subtree_add_args(
        &settings.prefix,
        &settings.remote,
        &settings.branch,
        settings.squash,
    );
    let arg_refs = args.iter().map(|arg| arg.as_str()).collect::<Vec<_>>();
    let output = run_git_command(&settings.repo_root, &arg_refs, "git subtree add")?;

    if !output.status.success() {
        return Err(format!(
            "git subtree add failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn delete_sync_file(root: String, relative_path: String) -> Result<(), String> {
    validate_relative_preview_path(&relative_path)?;

    let target = Path::new(&root).join("@acme").join(&relative_path);
    if !target.exists() {
        return Ok(());
    }

    std::fs::remove_file(&target)
        .map_err(|e| format!("failed to delete sync file {relative_path}: {e}"))
}

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
pub fn read_task_snapshot<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_path: String,
) -> Result<String, String> {
    let snapshot_path = resolve_task_snapshot_path(&app_handle, &file_path)?;
    std::fs::read_to_string(&snapshot_path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => "ENOENT: task snapshot not found".to_string(),
        _ => format!("failed to read task snapshot: {error}"),
    })
}

#[tauri::command]
pub fn write_task_snapshot<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_path: String,
    contents: String,
) -> Result<(), String> {
    let snapshot_path = resolve_task_snapshot_path(&app_handle, &file_path)?;

    if let Some(parent) = snapshot_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create task snapshot directory: {error}"))?;
    }

    std::fs::write(&snapshot_path, contents)
        .map_err(|error| format!("failed to write task snapshot: {error}"))
}


#[tauri::command]
pub async fn read_global_claude_config() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let config_path = home.join(".claude").join("settings.json");
    if !config_path.exists() {
        return Ok(r#"{"permissions":{"allow":[],"deny":[]}}"#.to_string());
    }
    std::fs::read_to_string(&config_path)
        .map_err(|e| format!("failed to read global claude config: {}", e))
}

#[tauri::command]
pub async fn write_global_claude_config(contents: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let config_path = home.join(".claude").join("settings.json");
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create .claude directory: {}", e))?;
    }
    std::fs::write(&config_path, contents)
        .map_err(|e| format!("failed to write global claude config: {}", e))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CodexManagedSettings {
    approval_policy: String,
    sandbox_mode: String,
}

fn codex_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".codex").join("config.toml"))
}

fn is_mutating_claude_permission(rule: &str) -> bool {
    ["Bash(", "Edit(", "Write(", "MultiEdit(", "NotebookEdit("]
        .iter()
        .any(|prefix| rule.starts_with(prefix))
}

fn infer_codex_policy_from_claude_permissions(
    allow: &[String],
    deny: &[String],
) -> CodexManagedSettings {
    let approval_policy = if deny.is_empty() {
        "on-request"
    } else {
        "untrusted"
    };

    let sandbox_mode = if allow
        .iter()
        .chain(deny.iter())
        .any(|rule| is_mutating_claude_permission(rule))
    {
        "workspace-write"
    } else {
        "read-only"
    };

    CodexManagedSettings {
        approval_policy: approval_policy.to_string(),
        sandbox_mode: sandbox_mode.to_string(),
    }
}

fn render_codex_setting_line(key: &str, value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!(r#"{key} = "{escaped}""#)
}

fn write_codex_managed_settings(
    contents: &str,
    approval_policy: &str,
    sandbox_mode: &str,
) -> String {
    let mut output = Vec::new();
    let mut inserted_missing_keys = false;
    let mut saw_approval_policy = false;
    let mut saw_sandbox_mode = false;
    let mut in_top_level = true;

    for line in contents.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('[') && !inserted_missing_keys {
            if !saw_approval_policy {
                output.push(render_codex_setting_line("approval_policy", approval_policy));
            }
            if !saw_sandbox_mode {
                output.push(render_codex_setting_line("sandbox_mode", sandbox_mode));
            }
            inserted_missing_keys = true;
            in_top_level = false;
        }

        if in_top_level && trimmed.starts_with("approval_policy") {
            saw_approval_policy = true;
            output.push(render_codex_setting_line("approval_policy", approval_policy));
            continue;
        }

        if in_top_level && trimmed.starts_with("sandbox_mode") {
            saw_sandbox_mode = true;
            output.push(render_codex_setting_line("sandbox_mode", sandbox_mode));
            continue;
        }

        output.push(line.to_string());
    }

    if !inserted_missing_keys {
        if !saw_approval_policy {
            output.push(render_codex_setting_line("approval_policy", approval_policy));
        }
        if !saw_sandbox_mode {
            output.push(render_codex_setting_line("sandbox_mode", sandbox_mode));
        }
    }

    let mut result = output.join("\n");
    if !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

fn open_path_in_editor(editor: &str, path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let app_name = match editor {
            "code" => "Visual Studio Code",
            "cursor" => "Cursor",
            "antigravity" => "Antigravity",
            _ => editor,
        };
        std::process::Command::new("/usr/bin/open")
            .arg("-a")
            .arg(app_name)
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open editor '{}': {}", editor, e))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        std::process::Command::new(editor)
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open editor '{}': {}", editor, e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn sync_claude_permissions_to_codex(
    allow: Vec<String>,
    deny: Vec<String>,
) -> Result<(), String> {
    let config_path = codex_config_path()?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create .codex directory: {}", e))?;
    }

    let existing = if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .map_err(|e| format!("failed to read global codex config: {}", e))?
    } else {
        String::new()
    };

    let mapped = infer_codex_policy_from_claude_permissions(&allow, &deny);
    let next = write_codex_managed_settings(
        &existing,
        &mapped.approval_policy,
        &mapped.sandbox_mode,
    );

    std::fs::write(&config_path, next)
        .map_err(|e| format!("failed to write global codex config: {}", e))
}

#[tauri::command]
pub fn ensure_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("failed to create directory: {}", e))?;
    
    // Workaround for Claude Code 2.1.81 bug where an empty directory without a .env file 
    // causes the internal Bash initialization to crash continuously.
    let env_path = std::path::Path::new(&path).join(".env");
    if !env_path.exists() {
        let _ = std::fs::File::create(env_path);
    }
    
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
pub async fn test_claude_spawn(project_path: String) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let cwd = std::path::PathBuf::from(&project_path);
    let mut child = match tokio::process::Command::new("claude")
        .args(&[
            "--verbose",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
        ])
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return Err(format!("Spawn err: {}", e)),
    };

    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();

    let _write_task = tokio::spawn(async move {
        let msg = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": "Please review my ~/.claude/settings.json 'allow' and 'deny' lists" }
        });
        let line = format!("{}\n", serde_json::to_string(&msg).unwrap());
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        if let Err(e) = stdin.write_all(line.as_bytes()).await {
            return format!("stdin write err: {}", e);
        }
        if let Err(e) = stdin.flush().await {
            return format!("stdin flush err: {}", e);
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(5000)).await;
        "wrote ok".to_string()
    });

    let mut out_str = String::new();
    let mut err_str = String::new();
    
    let out_task = tokio::spawn(async move {
        stdout.read_to_string(&mut out_str).await.unwrap_or_default();
        out_str
    });
    
    let err_task = tokio::spawn(async move {
        stderr.read_to_string(&mut err_str).await.unwrap_or_default();
        err_str
    });

    let status = child.wait().await.unwrap();
    let out_res = out_task.await.unwrap();
    let err_res = err_task.await.unwrap();
    
    Ok(format!("Status: {}\nSTDOUT: {}\nSTDERR: {}", status, out_res, err_res))
}

#[tauri::command]
pub async fn open_global_claude_config(editor: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let config_path = home.join(".claude").join("settings.json");
    if !config_path.exists() {
        return Err("Configuration file not found. Ensure it is created before opening.".to_string());
    }

    open_path_in_editor(&editor, &config_path)
}

#[tauri::command]
pub async fn open_global_codex_config(editor: String) -> Result<(), String> {
    let config_path = codex_config_path()?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create .codex directory: {}", e))?;
    }
    if !config_path.exists() {
        std::fs::write(&config_path, "")
            .map_err(|e| format!("failed to create global codex config: {}", e))?;
    }

    open_path_in_editor(&editor, &config_path)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use walkdir::WalkDir;

    use super::{
        acme_rsync_args,
        build_acme_gitignore_matcher,
        build_conflict_marker_output,
        build_preview_snapshot,
        build_sync_conflict_detail,
        classify_conflict_kind,
        classify_preview_conflict,
        execute_patch_sync,
        execute_rsync_conflict_resolutions,
        get_dirty_acme_paths,
        get_latest_modified,
        get_repo_metadata,
        get_repo_remote_status,
        get_sync_status,
        infer_codex_policy_from_claude_permissions,
        is_git_repo,
        latest_modified_from_walkdir,
        resolve_conflict_action,
        parse_git_status_porcelain,
        parse_rev_list_counts,
        parse_rsync_itemized_line,
        preview_acme_rsync_args,
        preview_sync_changes,
        resolve_diff_targets,
        resolve_task_snapshot_path_from_app_data_dir,
        run_unified_diff,
        subtree_apply_args,
        subtree_add_args,
        execute_subtree_add,
        validate_relative_preview_path,
        write_codex_managed_settings,
        DiffTarget,
        RsyncConflictExecutionRequest,
        SyncChangeType,
        SyncConflictKind,
        SyncConflictResolution,
        SyncConflictResolutionSelection,
        SyncPreviewFileAction,
        SyncPreviewFileActionSelection,
        SyncProfilePayload,
        SyncPreviewConflict,
        SubtreeSyncSettingsPayload,
    };

    #[test]
    fn claude_permissions_with_denies_map_to_untrusted_workspace_write() {
        let mapped = infer_codex_policy_from_claude_permissions(
            &["Bash(git status)".to_string()],
            &["Bash(git push *)".to_string()],
        );

        assert_eq!(mapped.approval_policy, "untrusted");
        assert_eq!(mapped.sandbox_mode, "workspace-write");
    }

    #[test]
    fn codex_sync_updates_managed_keys_without_dropping_model() {
        let next = write_codex_managed_settings(
            "model = \"gpt-5.4\"\n",
            "on-request",
            "read-only",
        );

        assert!(next.contains("model = \"gpt-5.4\""));
        assert!(next.contains("approval_policy = \"on-request\""));
        assert!(next.contains("sandbox_mode = \"read-only\""));
    }

    #[test]
    fn parse_git_status_porcelain_ignores_non_acme_paths_and_short_lines() {
        let dirty = parse_git_status_porcelain(" M @acme/button.tsx\n?? README.md\nA\n");
        assert_eq!(dirty, vec!["@acme/button.tsx"]);
    }

    #[test]
    fn parse_git_status_porcelain_returns_paths_under_acme() {
        let dirty = parse_git_status_porcelain(" M @acme/button.tsx\n?? @acme/new.tsx\n");
        assert_eq!(dirty, vec!["@acme/button.tsx", "@acme/new.tsx"]);
    }

    #[test]
    fn parse_git_status_porcelain_splits_rename_paths_under_acme() {
        let dirty = parse_git_status_porcelain("R  @acme/old.tsx -> @acme/new.tsx\n");
        assert_eq!(dirty, vec!["@acme/old.tsx", "@acme/new.tsx"]);
    }

    #[test]
    fn is_git_repo_returns_false_for_missing_path() {
        assert!(!is_git_repo("/definitely/not/a/repo"));
    }

    #[test]
    fn get_dirty_acme_paths_supports_nested_acme_repo_root() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-dirty-acme-nested-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let acme_root = temp_root.join("@acme");
        let components_dir = acme_root.join("components");
        std::fs::create_dir_all(&components_dir).expect("nested @acme repo dir should be created");
        std::fs::write(components_dir.join("button.tsx"), b"export const Button = 1;\n")
            .expect("initial acme file should be written");

        let init_status = std::process::Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&acme_root)
            .status()
            .expect("git init should run");
        assert!(init_status.success(), "git init should succeed");

        let add_status = std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&acme_root)
            .status()
            .expect("git add should run");
        assert!(add_status.success(), "git add should succeed");

        let commit_status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ])
            .current_dir(&acme_root)
            .status()
            .expect("git commit should run");
        assert!(commit_status.success(), "git commit should succeed");

        std::fs::write(components_dir.join("button.tsx"), b"export const Button = 2;\n")
            .expect("updated acme file should be written");

        let dirty_paths = get_dirty_acme_paths(temp_root.to_string_lossy().as_ref())
            .expect("dirty path lookup should succeed");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(dirty_paths, vec!["@acme/components/button.tsx"]);
    }

    #[test]
    fn get_dirty_acme_paths_does_not_treat_repo_subdirectory_as_nested_acme_repo() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-dirty-acme-subdir-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let acme_components_dir = temp_root.join("@acme/components");
        let docs_dir = temp_root.join("docs");
        std::fs::create_dir_all(&acme_components_dir).expect("@acme components dir should be created");
        std::fs::create_dir_all(&docs_dir).expect("docs dir should be created");
        std::fs::write(acme_components_dir.join("button.tsx"), b"export const Button = 1;\n")
            .expect("initial acme file should be written");
        std::fs::write(docs_dir.join("note.txt"), b"hello\n")
            .expect("initial docs file should be written");

        let init_status = std::process::Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&temp_root)
            .status()
            .expect("git init should run");
        assert!(init_status.success(), "git init should succeed");

        let add_status = std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&temp_root)
            .status()
            .expect("git add should run");
        assert!(add_status.success(), "git add should succeed");

        let commit_status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ])
            .current_dir(&temp_root)
            .status()
            .expect("git commit should run");
        assert!(commit_status.success(), "git commit should succeed");

        std::fs::write(docs_dir.join("note.txt"), b"updated\n")
            .expect("updated docs file should be written");

        let dirty_paths = get_dirty_acme_paths(acme_components_dir.to_string_lossy().as_ref())
            .expect("dirty path lookup should succeed");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(dirty_paths, Vec::<String>::new());
    }

    #[test]
    fn parse_rev_list_counts_reads_behind_and_ahead() {
        let counts = parse_rev_list_counts("3\t1\n").unwrap();
        assert_eq!(counts, (3, 1));
    }

    #[test]
    fn subtree_misconfigured_status_marks_invalid_prefix() {
        let profile = SyncProfilePayload {
            id: "profile-1".to_string(),
            project_path: "/repo/project".to_string(),
            mode: "subtree".to_string(),
            primary_path: Some("/repo/primary".to_string()),
            subtree: Some(SubtreeSyncSettingsPayload {
                repo_root: "/repo/project".to_string(),
                prefix: "packages/ui".to_string(),
                remote: "origin".to_string(),
                branch: "main".to_string(),
                squash: true,
            }),
        };

        let status = get_sync_status(profile).expect("status command should not error");

        assert_eq!(status.state, "misconfigured");
        assert_eq!(status.mode, "subtree");
        assert_eq!(status.message.as_deref(), Some("subtree prefix must be @acme"));
    }

    #[test]
    fn subtree_apply_args_builds_pull_command_with_prefix() {
        let args = subtree_apply_args("@acme", "origin", "main", true);
        assert!(args.contains(&"pull".to_string()));
        assert!(args.contains(&"--prefix=@acme".to_string()));
        assert!(args.contains(&"origin".to_string()));
        assert!(args.contains(&"main".to_string()));
    }

    #[test]
    fn subtree_add_args_builds_add_command_without_squash() {
        let args = subtree_add_args("@acme", "origin", "main", false);

        assert_eq!(
            args,
            vec![
                "subtree".to_string(),
                "add".to_string(),
                "--prefix=@acme".to_string(),
                "origin".to_string(),
                "main".to_string(),
            ]
        );
    }

    #[test]
    fn subtree_add_args_builds_add_command_with_squash() {
        let args = subtree_add_args("@acme", "origin", "main", true);

        assert_eq!(
            args,
            vec![
                "subtree".to_string(),
                "add".to_string(),
                "--prefix=@acme".to_string(),
                "origin".to_string(),
                "main".to_string(),
                "--squash".to_string(),
            ]
        );
    }

    #[test]
    fn conflict_classification_returns_none_for_one_sided_change() {
        let conflict = classify_preview_conflict(
            "components/button.tsx",
            Some(b"current only"),
            None,
        );

        assert_eq!(conflict, None);
    }

    #[test]
    fn conflict_classification_returns_none_for_same_content() {
        let conflict = classify_preview_conflict(
            "components/button.tsx",
            Some(b"shared text"),
            Some(b"shared text"),
        );

        assert_eq!(conflict, None);
    }

    #[test]
    fn conflict_classification_returns_text_conflict_for_different_text() {
        let conflict = classify_preview_conflict(
            "components/button.tsx",
            Some(b"const label = \"current\";\n"),
            Some(b"const label = \"incoming\";\n"),
        );

        assert_eq!(
            conflict,
            Some(SyncPreviewConflict {
                path: "components/button.tsx".to_string(),
                kind: SyncConflictKind::Text,
                allowed_resolutions: vec![
                    SyncConflictResolution::Current,
                    SyncConflictResolution::Incoming,
                    SyncConflictResolution::Both,
                ],
            })
        );
    }

    #[test]
    fn conflict_classification_returns_binary_conflict_for_binary_content() {
        let conflict = classify_preview_conflict(
            "assets/logo.png",
            Some(&[0, 159, 146, 150]),
            Some(&[0, 159, 146, 151]),
        );

        assert_eq!(
            conflict,
            Some(SyncPreviewConflict {
                path: "assets/logo.png".to_string(),
                kind: SyncConflictKind::Binary,
                allowed_resolutions: vec![
                    SyncConflictResolution::Current,
                    SyncConflictResolution::Incoming,
                ],
            })
        );
    }

    #[test]
    fn classify_conflict_kind_returns_none_for_same_bytes() {
        let kind = classify_conflict_kind(b"same", b"same");
        assert_eq!(kind, None);
    }

    #[test]
    fn build_conflict_marker_output_uses_git_style_markers_for_push_and_pull() {
        let push_merged =
            build_conflict_marker_output("current line\n", "incoming line\n", "to-primary");
        let pull_merged =
            build_conflict_marker_output("current line\n", "incoming line\n", "from-primary");

        assert_eq!(
            push_merged,
            "<<<<<<< OURS (Primary)\ncurrent line\n=======\nincoming line\n>>>>>>> THEIRS (Project)\n"
        );
        assert_eq!(
            pull_merged,
            "<<<<<<< OURS (Project)\ncurrent line\n=======\nincoming line\n>>>>>>> THEIRS (Primary)\n"
        );
    }

    #[test]
    fn resolve_conflict_action_rejects_both_for_binary_conflicts() {
        let error = resolve_conflict_action(
            &SyncConflictKind::Binary,
            &[0, 159, 146, 150],
            &[0, 159, 146, 151],
            SyncConflictResolution::Both,
            "from-primary",
        )
        .expect_err("binary both resolution should be rejected");

        assert!(error.contains("binary conflicts do not support both resolution"));
    }

    #[test]
    fn build_preview_snapshot_marks_same_path_changes_as_conflicts_without_git_dirty_state() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-preview-conflict-snapshot-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let src_root = temp_root.join("src-root");
        let dest_root = temp_root.join("dest-root");
        std::fs::create_dir_all(src_root.join("@acme/components"))
            .expect("src components dir should be created");
        std::fs::create_dir_all(dest_root.join("@acme/components"))
            .expect("dest components dir should be created");
        std::fs::write(src_root.join("@acme/.gitignore"), b"")
            .expect("src gitignore should be written");
        std::fs::write(dest_root.join("@acme/.gitignore"), b"")
            .expect("dest gitignore should be written");
        std::fs::write(
            src_root.join("@acme/components/button.tsx"),
            b"export const button = 'incoming';\n",
        )
        .expect("src file should be written");
        std::fs::write(
            dest_root.join("@acme/components/button.tsx"),
            b"export const button = 'current';\n",
        )
        .expect("dest file should be written");

        let (files, summary, conflicts, decisions, _fingerprint) = build_preview_snapshot(
            src_root.to_string_lossy().as_ref(),
            dest_root.to_string_lossy().as_ref(),
            "to-primary",
        )
        .expect("preview snapshot should succeed");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(summary.modified, 1);
        assert_eq!(summary.added, 0);
        assert_eq!(summary.deleted, 0);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "components/button.tsx");
        assert_eq!(files[0].change_type, SyncChangeType::Modified);
        assert!(decisions.is_empty());
        assert_eq!(
            conflicts,
            vec![SyncPreviewConflict {
                path: "components/button.tsx".to_string(),
                kind: SyncConflictKind::Text,
                allowed_resolutions: vec![
                    SyncConflictResolution::Current,
                    SyncConflictResolution::Incoming,
                    SyncConflictResolution::Both,
                ],
            }]
        );
    }

    #[test]
    fn preview_sync_changes_emits_decisions_for_push_when_source_is_git_repo() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-preview-push-git-source-decisions-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let project_root = temp_root.join("project-root");
        let primary_root = temp_root.join("primary-root");
        std::fs::create_dir_all(project_root.join("@acme/tokens"))
            .expect("project tokens dir should be created");
        std::fs::create_dir_all(primary_root.join("@acme/tokens"))
            .expect("primary tokens dir should be created");
        std::fs::write(project_root.join("@acme/.gitignore"), b"")
            .expect("project gitignore should be written");
        std::fs::write(primary_root.join("@acme/.gitignore"), b"")
            .expect("primary gitignore should be written");
        std::fs::write(
            primary_root.join("@acme/tokens/from-primary.ts"),
            b"export const token = 'primary';\n",
        )
        .expect("primary token file should be written");

        std::process::Command::new("git")
            .args(["init", "-b", "main", project_root.to_string_lossy().as_ref()])
            .output()
            .expect("project git repo should initialize");
        std::process::Command::new("git")
            .args(["init", "-b", "main", primary_root.to_string_lossy().as_ref()])
            .output()
            .expect("primary git repo should initialize");
        let add_status = std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&primary_root)
            .status()
            .expect("git add should run");
        assert!(add_status.success(), "git add should succeed");
        let commit_status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ])
            .current_dir(&primary_root)
            .status()
            .expect("git commit should run");
        assert!(commit_status.success(), "git commit should succeed");

        let push_result = preview_sync_changes(
            project_root.to_string_lossy().into_owned(),
            primary_root.to_string_lossy().into_owned(),
            "to-primary".to_string(),
        )
        .expect("push preview should succeed");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(push_result.files.len(), 1);
        assert_eq!(push_result.files[0].path, "tokens/from-primary.ts");
        assert_eq!(push_result.files[0].change_type, SyncChangeType::Deleted);
        assert_eq!(push_result.decisions.len(), 1);
        assert_eq!(push_result.decisions[0].path, "tokens/from-primary.ts");
        assert_eq!(push_result.decisions[0].kind, SyncChangeType::Deleted);
        assert_eq!(
            push_result.decisions[0].allowed_actions,
            vec![SyncPreviewFileAction::Keep, SyncPreviewFileAction::Delete]
        );
    }

    #[test]
    fn preview_sync_changes_emits_decisions_only_for_push_added_files() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-preview-push-added-decisions-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let project_root = temp_root.join("project-root");
        let primary_root = temp_root.join("primary-root");
        std::fs::create_dir_all(project_root.join("@acme/tokens"))
            .expect("project tokens dir should be created");
        std::fs::create_dir_all(primary_root.join("@acme/tokens"))
            .expect("primary tokens dir should be created");
        std::fs::write(project_root.join("@acme/.gitignore"), b"")
            .expect("project gitignore should be written");
        std::fs::write(primary_root.join("@acme/.gitignore"), b"")
            .expect("primary gitignore should be written");
        std::fs::write(
            project_root.join("@acme/tokens/new.ts"),
            b"export const token = 'new';\n",
        )
        .expect("project token file should be written");

        std::process::Command::new("git")
            .args(["init", primary_root.to_string_lossy().as_ref()])
            .output()
            .expect("primary git repo should initialize");

        let push_result = preview_sync_changes(
            project_root.to_string_lossy().into_owned(),
            primary_root.to_string_lossy().into_owned(),
            "to-primary".to_string(),
        )
        .expect("push preview should succeed");
        let pull_result = preview_sync_changes(
            primary_root.to_string_lossy().into_owned(),
            project_root.to_string_lossy().into_owned(),
            "from-primary".to_string(),
        )
        .expect("pull preview should succeed");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(push_result.files.len(), 1);
        assert_eq!(push_result.files[0].path, "tokens/new.ts");
        assert_eq!(push_result.files[0].change_type, SyncChangeType::Added);
        assert_eq!(push_result.decisions.len(), 1);
        assert_eq!(push_result.decisions[0].path, "tokens/new.ts");
        assert_eq!(push_result.decisions[0].kind, SyncChangeType::Added);
        assert_eq!(
            push_result.decisions[0].allowed_actions,
            vec![SyncPreviewFileAction::Keep, SyncPreviewFileAction::Delete]
        );

        assert_eq!(pull_result.files.len(), 1);
        assert_eq!(pull_result.files[0].path, "tokens/new.ts");
        assert_eq!(pull_result.files[0].change_type, SyncChangeType::Deleted);
        assert!(pull_result.decisions.is_empty());
    }

    #[test]
    fn preview_sync_changes_keeps_pull_added_files_decisions_empty() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-preview-pull-added-no-decisions-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let project_root = temp_root.join("project-root");
        let primary_root = temp_root.join("primary-root");
        std::fs::create_dir_all(project_root.join("@acme/tokens"))
            .expect("project tokens dir should be created");
        std::fs::create_dir_all(primary_root.join("@acme/tokens"))
            .expect("primary tokens dir should be created");
        std::fs::write(project_root.join("@acme/.gitignore"), b"")
            .expect("project gitignore should be written");
        std::fs::write(primary_root.join("@acme/.gitignore"), b"")
            .expect("primary gitignore should be written");
        std::fs::write(
            primary_root.join("@acme/tokens/from-primary.ts"),
            b"export const token = 'primary';\n",
        )
        .expect("primary token file should be written");

        std::process::Command::new("git")
            .args(["init", primary_root.to_string_lossy().as_ref()])
            .output()
            .expect("primary git repo should initialize");

        let pull_result = preview_sync_changes(
            primary_root.to_string_lossy().into_owned(),
            project_root.to_string_lossy().into_owned(),
            "from-primary".to_string(),
        )
        .expect("pull preview should succeed");
        let push_result = preview_sync_changes(
            project_root.to_string_lossy().into_owned(),
            primary_root.to_string_lossy().into_owned(),
            "to-primary".to_string(),
        )
        .expect("push preview should succeed");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(pull_result.files.len(), 1);
        assert_eq!(pull_result.files[0].path, "tokens/from-primary.ts");
        assert_eq!(pull_result.files[0].change_type, SyncChangeType::Added);
        assert!(pull_result.decisions.is_empty());

        assert_eq!(push_result.files.len(), 1);
        assert_eq!(push_result.files[0].path, "tokens/from-primary.ts");
        assert_eq!(push_result.files[0].change_type, SyncChangeType::Deleted);
        assert_eq!(push_result.decisions.len(), 1);
        assert_eq!(push_result.decisions[0].path, "tokens/from-primary.ts");
        assert_eq!(push_result.decisions[0].kind, SyncChangeType::Deleted);
        assert_eq!(
            push_result.decisions[0].allowed_actions,
            vec![SyncPreviewFileAction::Keep, SyncPreviewFileAction::Delete]
        );
    }

    #[test]
    fn execute_rsync_conflict_resolutions_restores_deleted_files_for_keep_action() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-execute-preview-restore-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let project_root = temp_root.join("project-root");
        let primary_root = temp_root.join("primary-root");
        std::fs::create_dir_all(project_root.join("@acme/tokens"))
            .expect("project tokens dir should be created");
        std::fs::create_dir_all(primary_root.join("@acme/tokens"))
            .expect("primary tokens dir should be created");
        std::fs::write(project_root.join("@acme/.gitignore"), b"")
            .expect("project gitignore should be written");
        std::fs::write(primary_root.join("@acme/.gitignore"), b"")
            .expect("primary gitignore should be written");
        std::fs::write(
            primary_root.join("@acme/tokens/from-primary.ts"),
            b"export const token = 'primary';\n",
        )
        .expect("primary token file should be written");

        std::process::Command::new("git")
            .args(["init", "-b", "main", primary_root.to_string_lossy().as_ref()])
            .output()
            .expect("primary git repo should initialize");
        let add_status = std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&primary_root)
            .status()
            .expect("git add should run");
        assert!(add_status.success(), "git add should succeed");
        let commit_status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ])
            .current_dir(&primary_root)
            .status()
            .expect("git commit should run");
        assert!(commit_status.success(), "git commit should succeed");

        let preview = preview_sync_changes(
            project_root.to_string_lossy().into_owned(),
            primary_root.to_string_lossy().into_owned(),
            "to-primary".to_string(),
        )
        .expect("push preview should succeed");

        let request = RsyncConflictExecutionRequest {
            src: project_root.to_string_lossy().into_owned(),
            dest: primary_root.to_string_lossy().into_owned(),
            direction: "to-primary".to_string(),
            fingerprint: preview.fingerprint,
            resolutions: vec![],
            file_actions: vec![SyncPreviewFileActionSelection {
                path: "tokens/from-primary.ts".to_string(),
                action: SyncPreviewFileAction::Keep,
            }],
        };

        execute_rsync_conflict_resolutions(request)
            .expect("keep action should restore deleted file");

        assert!(project_root.join("@acme/tokens/from-primary.ts").exists());
        assert!(primary_root.join("@acme/tokens/from-primary.ts").exists());
        assert_eq!(
            std::fs::read_to_string(project_root.join("@acme/tokens/from-primary.ts"))
                .expect("restored file should be readable"),
            "export const token = 'primary';\n"
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn build_sync_conflict_detail_maps_labels_for_push_and_pull() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-conflict-detail-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let src_root = temp_root.join("src-root");
        let dest_root = temp_root.join("dest-root");
        std::fs::create_dir_all(src_root.join("@acme/components"))
            .expect("src conflict dir should be created");
        std::fs::create_dir_all(dest_root.join("@acme/components"))
            .expect("dest conflict dir should be created");
        std::fs::write(
            src_root.join("@acme/components/button.tsx"),
            b"incoming version\n",
        )
        .expect("src file should be written");
        std::fs::write(
            dest_root.join("@acme/components/button.tsx"),
            b"current version\n",
        )
        .expect("dest file should be written");

        let push_detail = build_sync_conflict_detail(
            src_root.to_string_lossy().as_ref(),
            dest_root.to_string_lossy().as_ref(),
            "components/button.tsx",
            "to-primary",
        )
        .expect("push detail should build");
        let pull_detail = build_sync_conflict_detail(
            src_root.to_string_lossy().as_ref(),
            dest_root.to_string_lossy().as_ref(),
            "components/button.tsx",
            "from-primary",
        )
        .expect("pull detail should build");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(
            push_detail.current.expect("push current side").label,
            "Ours (Primary)"
        );
        assert_eq!(
            push_detail.incoming.expect("push incoming side").label,
            "Theirs (Project)"
        );
        assert_eq!(
            pull_detail.current.expect("pull current side").label,
            "Ours (Project)"
        );
        assert_eq!(
            pull_detail.incoming.expect("pull incoming side").label,
            "Theirs (Primary)"
        );
    }

    #[test]
    fn parse_rsync_itemized_added_line() {
        let parsed = parse_rsync_itemized_line(">f+++++++++ components/button.tsx");
        assert_eq!(
            parsed,
            Some(("components/button.tsx".to_string(), "added".to_string()))
        );
    }

    #[test]
    fn parse_rsync_itemized_modified_line() {
        let parsed = parse_rsync_itemized_line(">f.st...... components/card.tsx");
        assert_eq!(
            parsed,
            Some((
                "components/card.tsx".to_string(),
                "modified".to_string()
            ))
        );
    }

    #[test]
    fn parse_rsync_itemized_deleted_line() {
        let parsed = parse_rsync_itemized_line("*deleting   components/old.tsx");
        assert_eq!(
            parsed,
            Some(("components/old.tsx".to_string(), "deleted".to_string()))
        );
    }

    #[test]
    fn parse_rsync_itemized_ignores_header_lines() {
        let parsed = parse_rsync_itemized_line("sending incremental file list");
        assert_eq!(parsed, None);
    }

    #[test]
    fn parse_rsync_itemized_ignores_transfer_starting_summary_line() {
        let parsed = parse_rsync_itemized_line("Transfer starting: 1411 files");
        assert_eq!(parsed, None);
    }

    #[test]
    fn parse_rsync_itemized_ignores_unchanged_file_line() {
        let parsed = parse_rsync_itemized_line(">f....... AGENTS.md");
        assert_eq!(parsed, None);
    }

    #[test]
    fn resolve_diff_targets_for_added_uses_empty_left_side() {
        let (left, right) = resolve_diff_targets(
            "/tmp/source",
            "/tmp/dest",
            "components/button.tsx",
            "added",
        );

        assert_eq!(left, DiffTarget::Empty);
        assert_eq!(
            right,
            DiffTarget::Existing(Path::new("/tmp/source").join("@acme/components/button.tsx"))
        );
    }

    #[test]
    fn resolve_diff_targets_for_deleted_uses_empty_right_side() {
        let (left, right) = resolve_diff_targets(
            "/tmp/source",
            "/tmp/dest",
            "components/old.tsx",
            "deleted",
        );

        assert_eq!(
            left,
            DiffTarget::Existing(Path::new("/tmp/dest").join("@acme/components/old.tsx"))
        );
        assert_eq!(right, DiffTarget::Empty);
    }

    #[test]
    fn resolve_diff_targets_for_modified_uses_both_existing_sides() {
        let (left, right) = resolve_diff_targets(
            "/tmp/source",
            "/tmp/dest",
            "components/card.tsx",
            "modified",
        );

        assert_eq!(
            left,
            DiffTarget::Existing(Path::new("/tmp/dest").join("@acme/components/card.tsx"))
        );
        assert_eq!(
            right,
            DiffTarget::Existing(Path::new("/tmp/source").join("@acme/components/card.tsx"))
        );
    }

    #[test]
    fn run_unified_diff_reports_missing_binary_clearly() {
        let temp_dir = std::env::temp_dir();
        let unique_suffix = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        );
        let left = temp_dir.join(format!("atelier-left-{unique_suffix}.txt"));
        let right = temp_dir.join(format!("atelier-right-{unique_suffix}.txt"));
        std::fs::write(&left, "a\n").expect("left temp file should be written");
        std::fs::write(&right, "b\n").expect("right temp file should be written");

        let error = run_unified_diff("definitely-not-a-real-diff-binary", &left, &right)
            .expect_err("missing diff binary should error");

        let _ = std::fs::remove_file(&left);
        let _ = std::fs::remove_file(&right);

        assert!(error.contains("diff command is unavailable"));
    }

    #[test]
    fn validate_relative_preview_path_rejects_absolute_path() {
        let result = validate_relative_preview_path("/etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn validate_relative_preview_path_rejects_parent_traversal() {
        let result = validate_relative_preview_path("../secrets.txt");
        assert!(result.is_err());
    }

    #[test]
    fn validate_relative_preview_path_accepts_normal_relative_path() {
        let result = validate_relative_preview_path("components/button.tsx");
        assert!(result.is_ok());
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

        let error = resolve_task_snapshot_path_from_app_data_dir(&app_data_dir, "snapshots/../../outside.json")
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
    fn acme_gitignore_matcher_ignores_cache_dirs_via_parent_match() {
        let acme_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../@acme");
        let matcher =
            build_acme_gitignore_matcher(&acme_root).expect("gitignore matcher should build");

        assert!(matcher
            .matched_path_or_any_parents(Path::new("eslint-config/.cache/meta.json"), false)
            .is_ignore());
        assert!(matcher
            .matched_path_or_any_parents(Path::new("prettier-config/.cache/state"), false)
            .is_ignore());
        assert!(matcher
            .matched_path_or_any_parents(Path::new("ui/.cache/build.log"), false)
            .is_ignore());
        assert!(!matcher
            .matched_path_or_any_parents(Path::new("ui/src/components/button.tsx"), false)
            .is_ignore());
    }

    #[test]
    fn acme_rsync_args_applies_acme_gitignore_filter() {
        let args = acme_rsync_args("/tmp/source", "/tmp/dest");
        assert!(args.iter().any(|arg| arg == "--filter=dir-merge,- .gitignore"));
    }

    #[test]
    fn preview_acme_rsync_args_reuses_base_rsync_args_and_adds_dry_run_flags() {
        let preview_args = preview_acme_rsync_args("/tmp/source", "/tmp/dest");

        assert_eq!(preview_args[0], "-av");
        assert_eq!(preview_args[1], "--delete");
        assert_eq!(preview_args[2], "--dry-run");
        assert_eq!(preview_args[3], "--itemize-changes");
        assert_eq!(preview_args[4], "--exclude=node_modules");
        assert_eq!(preview_args.last(), Some(&"/tmp/dest/@acme/".to_string()));
    }

    #[test]
    fn get_latest_modified_ignores_pnpm_workspace_yaml_changes() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-latest-modified-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let acme_root = temp_root.join("@acme");
        std::fs::create_dir_all(&acme_root).expect("temp @acme dir should be created");
        std::thread::sleep(std::time::Duration::from_secs(1));
        std::fs::write(acme_root.join("tokens.txt"), b"alpha")
            .expect("acme file should be written");
        let initial = get_latest_modified(temp_root.to_string_lossy().to_string())
            .expect("initial latest modified should exist");

        std::thread::sleep(std::time::Duration::from_secs(1));
        std::fs::write(temp_root.join("pnpm-workspace.yaml"), b"packages:\n  - apps/*\n")
            .expect("pnpm workspace file should be written");
        let after_pnpm = get_latest_modified(temp_root.to_string_lossy().to_string())
            .expect("latest modified should still exist");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(after_pnpm, initial);
    }

    #[test]
    fn get_repo_metadata_supports_primary_repo_root_without_nested_acme_dir() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-primary-repo-root-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_root).expect("temp repo root should be created");
        std::fs::write(temp_root.join("package.json"), b"{}")
            .expect("repo root file should be written");

        let init_status = std::process::Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&temp_root)
            .status()
            .expect("git init should run");
        assert!(init_status.success(), "git init should succeed");

        let add_status = std::process::Command::new("git")
            .args(["add", "package.json"])
            .current_dir(&temp_root)
            .status()
            .expect("git add should run");
        assert!(add_status.success(), "git add should succeed");

        let commit_status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ])
            .current_dir(&temp_root)
            .status()
            .expect("git commit should run");
        assert!(commit_status.success(), "git commit should succeed");

        let result = get_repo_metadata(temp_root.to_string_lossy().to_string());

        let _ = std::fs::remove_dir_all(&temp_root);

        let metadata = result.expect("repo metadata should resolve for repo root");
        assert_eq!(metadata.branch, "main");
        assert_eq!(metadata.last_commit_message, "initial commit");
        assert_ne!(metadata.last_updated, "Unknown");
    }

    #[test]
    fn get_repo_metadata_supports_primary_parent_path_with_nested_acme_repo() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-primary-parent-root-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let acme_root = temp_root.join("@acme");
        std::fs::create_dir_all(&acme_root).expect("nested @acme repo root should be created");
        std::fs::write(acme_root.join("package.json"), b"{}")
            .expect("nested repo file should be written");

        let init_status = std::process::Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&acme_root)
            .status()
            .expect("git init should run");
        assert!(init_status.success(), "git init should succeed");

        let add_status = std::process::Command::new("git")
            .args(["add", "package.json"])
            .current_dir(&acme_root)
            .status()
            .expect("git add should run");
        assert!(add_status.success(), "git add should succeed");

        let commit_status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ])
            .current_dir(&acme_root)
            .status()
            .expect("git commit should run");
        assert!(commit_status.success(), "git commit should succeed");

        let result = get_repo_metadata(temp_root.to_string_lossy().to_string());

        let _ = std::fs::remove_dir_all(&temp_root);

        let metadata = result.expect("repo metadata should resolve from nested @acme repo");
        assert_eq!(metadata.branch, "main");
        assert_eq!(metadata.last_commit_message, "initial commit");
        assert_ne!(metadata.last_updated, "Unknown");
    }

    #[test]
    fn execute_rsync_conflict_resolutions_applies_delete_file_actions_before_sync() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-execute-preview-delete-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let project_root = temp_root.join("project-root");
        let primary_root = temp_root.join("primary-root");
        std::fs::create_dir_all(project_root.join("@acme/tokens"))
            .expect("project tokens dir should be created");
        std::fs::create_dir_all(primary_root.join("@acme/tokens"))
            .expect("primary tokens dir should be created");
        std::fs::write(project_root.join("@acme/.gitignore"), b"")
            .expect("project gitignore should be written");
        std::fs::write(primary_root.join("@acme/.gitignore"), b"")
            .expect("primary gitignore should be written");
        std::fs::write(
            project_root.join("@acme/tokens/new.ts"),
            b"export const token = 'new';\n",
        )
        .expect("project token file should be written");

        std::process::Command::new("git")
            .args(["init", "-b", "main", primary_root.to_string_lossy().as_ref()])
            .output()
            .expect("primary git repo should initialize");
        let add_status = std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&primary_root)
            .status()
            .expect("git add should run");
        assert!(add_status.success(), "git add should succeed");
        let commit_status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ])
            .current_dir(&primary_root)
            .status()
            .expect("git commit should run");
        assert!(commit_status.success(), "git commit should succeed");

        let preview = preview_sync_changes(
            project_root.to_string_lossy().into_owned(),
            primary_root.to_string_lossy().into_owned(),
            "to-primary".to_string(),
        )
        .expect("push preview should succeed");

        let request = RsyncConflictExecutionRequest {
            src: project_root.to_string_lossy().into_owned(),
            dest: primary_root.to_string_lossy().into_owned(),
            direction: "to-primary".to_string(),
            fingerprint: preview.fingerprint,
            resolutions: vec![],
            file_actions: vec![SyncPreviewFileActionSelection {
                path: "tokens/new.ts".to_string(),
                action: SyncPreviewFileAction::Delete,
            }],
        };

        execute_rsync_conflict_resolutions(request)
            .expect("delete file action should succeed");

        assert!(!project_root.join("@acme/tokens/new.ts").exists());
        assert!(!primary_root.join("@acme/tokens/new.ts").exists());

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn execute_rsync_conflict_resolutions_rejects_stale_fingerprint() {
        let request = RsyncConflictExecutionRequest {
            src: "/tmp/source".to_string(),
            dest: "/tmp/dest".to_string(),
            direction: "to-primary".to_string(),
            fingerprint: "stale-fingerprint".to_string(),
            resolutions: vec![SyncConflictResolutionSelection {
                path: "components/button.tsx".to_string(),
                resolution: SyncConflictResolution::Current,
            }],
            file_actions: vec![SyncPreviewFileActionSelection {
                path: "tokens/new.ts".to_string(),
                action: SyncPreviewFileAction::Delete,
            }],
        };

        let error = execute_rsync_conflict_resolutions(request)
            .expect_err("stale fingerprint should be rejected");

        assert!(error.contains("Conflict preview is stale") || error.contains("rsync dry-run failed") || error.contains("failed to load @acme/.gitignore"));
    }

    #[test]
    fn execute_rsync_conflict_resolutions_rejects_missing_file_actions_for_preview_decisions() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-execute-preview-missing-action-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let project_root = temp_root.join("project-root");
        let primary_root = temp_root.join("primary-root");
        std::fs::create_dir_all(project_root.join("@acme/tokens"))
            .expect("project tokens dir should be created");
        std::fs::create_dir_all(primary_root.join("@acme/tokens"))
            .expect("primary tokens dir should be created");
        std::fs::write(project_root.join("@acme/.gitignore"), b"")
            .expect("project gitignore should be written");
        std::fs::write(primary_root.join("@acme/.gitignore"), b"")
            .expect("primary gitignore should be written");
        std::fs::write(
            primary_root.join("@acme/tokens/from-primary.ts"),
            b"export const token = 'primary';\n",
        )
        .expect("primary token file should be written");

        std::process::Command::new("git")
            .args(["init", "-b", "main", primary_root.to_string_lossy().as_ref()])
            .output()
            .expect("primary git repo should initialize");
        let add_status = std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&primary_root)
            .status()
            .expect("git add should run");
        assert!(add_status.success(), "git add should succeed");
        let commit_status = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ])
            .current_dir(&primary_root)
            .status()
            .expect("git commit should run");
        assert!(commit_status.success(), "git commit should succeed");

        let preview = preview_sync_changes(
            project_root.to_string_lossy().into_owned(),
            primary_root.to_string_lossy().into_owned(),
            "to-primary".to_string(),
        )
        .expect("push preview should succeed");

        let request = RsyncConflictExecutionRequest {
            src: project_root.to_string_lossy().into_owned(),
            dest: primary_root.to_string_lossy().into_owned(),
            direction: "to-primary".to_string(),
            fingerprint: preview.fingerprint,
            resolutions: vec![],
            file_actions: vec![],
        };

        let error = execute_rsync_conflict_resolutions(request)
            .expect_err("missing preview file action should be rejected");

        assert!(error.contains("missing required file action"));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn execute_rsync_conflict_resolutions_rejects_file_actions_missing_from_preview_decisions() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-execute-preview-invalid-action-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let project_root = temp_root.join("project-root");
        let primary_root = temp_root.join("primary-root");
        std::fs::create_dir_all(project_root.join("@acme/components"))
            .expect("project components dir should be created");
        std::fs::create_dir_all(primary_root.join("@acme/components"))
            .expect("primary components dir should be created");
        std::fs::write(project_root.join("@acme/.gitignore"), b"")
            .expect("project gitignore should be written");
        std::fs::write(primary_root.join("@acme/.gitignore"), b"")
            .expect("primary gitignore should be written");
        std::fs::write(
            project_root.join("@acme/components/button.tsx"),
            b"project version\n",
        )
        .expect("project file should be written");
        std::fs::write(
            primary_root.join("@acme/components/button.tsx"),
            b"primary version\n",
        )
        .expect("primary file should be written");

        std::process::Command::new("git")
            .args(["init", primary_root.to_string_lossy().as_ref()])
            .output()
            .expect("primary git repo should initialize");

        let preview = preview_sync_changes(
            project_root.to_string_lossy().into_owned(),
            primary_root.to_string_lossy().into_owned(),
            "to-primary".to_string(),
        )
        .expect("push preview should succeed");

        let request = RsyncConflictExecutionRequest {
            src: project_root.to_string_lossy().into_owned(),
            dest: primary_root.to_string_lossy().into_owned(),
            direction: "to-primary".to_string(),
            fingerprint: preview.fingerprint,
            resolutions: vec![],
            file_actions: vec![SyncPreviewFileActionSelection {
                path: "components/button.tsx".to_string(),
                action: SyncPreviewFileAction::Delete,
            }],
        };

        let error = execute_rsync_conflict_resolutions(request)
            .expect_err("invalid preview file action should be rejected");

        assert!(error.contains("preview action is not allowed"));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    fn git_status_success(root: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .expect("git command should run");
        assert!(status.success(), "git command should succeed: {:?}", args);
    }

    fn create_remote_status_fixture(name: &str) -> (PathBuf, PathBuf) {
        let temp_root = std::env::temp_dir().join(format!(
            "{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let remote_root = temp_root.join("remote.git");
        let repo_root = temp_root.join("repo");

        std::fs::create_dir_all(&temp_root).expect("temp root should be created");
        git_status_success(&temp_root, &["init", "--bare", remote_root.to_string_lossy().as_ref()]);
        std::fs::create_dir_all(&repo_root).expect("repo root should be created");
        git_status_success(&repo_root, &["init", "-b", "main"]);
        std::fs::write(repo_root.join("package.json"), b"{}")
            .expect("repo file should be written");
        git_status_success(&repo_root, &["add", "package.json"]);
        git_status_success(
            &repo_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ],
        );
        git_status_success(
            &repo_root,
            &[
                "remote",
                "add",
                "origin",
                remote_root.to_string_lossy().as_ref(),
            ],
        );
        git_status_success(&repo_root, &["push", "-u", "origin", "main"]);

        (temp_root, repo_root)
    }

    fn create_subtree_status_fixture(name: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        let temp_root = std::env::temp_dir().join(format!(
            "{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let remote_root = temp_root.join("remote.git");
        let source_root = temp_root.join("source");
        let project_root = temp_root.join("project");

        std::fs::create_dir_all(&temp_root).expect("temp root should be created");
        git_status_success(&temp_root, &["init", "--bare", remote_root.to_string_lossy().as_ref()]);

        std::fs::create_dir_all(&source_root).expect("source root should be created");
        git_status_success(&source_root, &["init", "-b", "main"]);
        std::fs::write(source_root.join("package.json"), b"{}")
            .expect("source file should be written");
        git_status_success(&source_root, &["add", "package.json"]);
        git_status_success(
            &source_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial source commit",
            ],
        );
        git_status_success(
            &source_root,
            &[
                "remote",
                "add",
                "origin",
                remote_root.to_string_lossy().as_ref(),
            ],
        );
        git_status_success(&source_root, &["push", "-u", "origin", "main"]);

        std::fs::create_dir_all(&project_root).expect("project root should be created");
        git_status_success(&project_root, &["init", "-b", "main"]);
        git_status_success(
            &project_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "--allow-empty",
                "-m",
                "initial project commit",
            ],
        );
        git_status_success(
            &project_root,
            &[
                "remote",
                "add",
                "origin",
                remote_root.to_string_lossy().as_ref(),
            ],
        );
        git_status_success(&project_root, &["fetch", "origin"]);
        git_status_success(
            &project_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "subtree",
                "add",
                "--prefix=@acme",
                "origin",
                "main",
            ],
        );

        (temp_root, remote_root, source_root, project_root)
    }

    fn subtree_fixture_profile(repo_root: &Path, branch: &str) -> SyncProfilePayload {
        SyncProfilePayload {
            id: "profile-1".to_string(),
            project_path: repo_root.to_string_lossy().into_owned(),
            mode: "subtree".to_string(),
            primary_path: None,
            subtree: Some(SubtreeSyncSettingsPayload {
                repo_root: repo_root.to_string_lossy().into_owned(),
                prefix: "@acme".to_string(),
                remote: "origin".to_string(),
                branch: branch.to_string(),
                squash: false,
            }),
        }
    }

    fn push_source_commit(temp_root: &Path, remote_root: &Path, clone_name: &str, contents: &[u8]) {
        let peer_root = temp_root.join(clone_name);
        git_status_success(
            temp_root,
            &[
                "clone",
                remote_root.to_string_lossy().as_ref(),
                peer_root.to_string_lossy().as_ref(),
            ],
        );
        std::fs::write(peer_root.join("package.json"), contents)
            .expect("peer source file should be written");
        git_status_success(&peer_root, &["add", "package.json"]);
        git_status_success(
            &peer_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "source update",
            ],
        );
        git_status_success(&peer_root, &["push", "origin", "main"]);
    }

    fn commit_project_subtree_change(project_root: &Path, contents: &[u8], message: &str) {
        std::fs::write(project_root.join("@acme/package.json"), contents)
            .expect("project subtree file should be written");
        git_status_success(&project_root, &["add", "@acme/package.json"]);
        git_status_success(
            &project_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                message,
            ],
        );
    }

    fn create_subtree_add_fixture(name: &str) -> (PathBuf, PathBuf) {
        let temp_root = std::env::temp_dir().join(format!(
            "{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let remote_root = temp_root.join("remote.git");
        let source_root = temp_root.join("source");
        let project_root = temp_root.join("project");

        std::fs::create_dir_all(&temp_root).expect("temp root should be created");
        git_status_success(&temp_root, &["init", "--bare", remote_root.to_string_lossy().as_ref()]);

        std::fs::create_dir_all(&source_root).expect("source root should be created");
        git_status_success(&source_root, &["init", "-b", "main"]);
        std::fs::write(source_root.join("package.json"), b"{}")
            .expect("source package file should be written");
        std::fs::write(source_root.join("button.tsx"), b"export const Button = 1;\n")
            .expect("source subtree file should be written");
        git_status_success(&source_root, &["add", "."]);
        git_status_success(
            &source_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial source commit",
            ],
        );
        git_status_success(
            &source_root,
            &[
                "remote",
                "add",
                "origin",
                remote_root.to_string_lossy().as_ref(),
            ],
        );
        git_status_success(&source_root, &["push", "-u", "origin", "main"]);

        std::fs::create_dir_all(&project_root).expect("project root should be created");
        git_status_success(&project_root, &["init", "-b", "main"]);
        std::fs::write(project_root.join("README.md"), b"# project\n")
            .expect("project readme should be written");
        git_status_success(&project_root, &["add", "README.md"]);
        git_status_success(
            &project_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial project commit",
            ],
        );
        git_status_success(
            &project_root,
            &[
                "remote",
                "add",
                "origin",
                remote_root.to_string_lossy().as_ref(),
            ],
        );
        git_status_success(&project_root, &["fetch", "origin"]);

        (temp_root, project_root)
    }

    fn subtree_add_fixture_profile(repo_root: &Path, squash: bool) -> SyncProfilePayload {
        SyncProfilePayload {
            id: "profile-1".to_string(),
            project_path: repo_root.to_string_lossy().into_owned(),
            mode: "subtree".to_string(),
            primary_path: None,
            subtree: Some(SubtreeSyncSettingsPayload {
                repo_root: repo_root.to_string_lossy().into_owned(),
                prefix: "@acme".to_string(),
                remote: "origin".to_string(),
                branch: "main".to_string(),
                squash,
            }),
        }
    }

    fn create_patch_sync_fixture(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let temp_root = std::env::temp_dir().join(format!(
            "{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let primary_root = temp_root.join("primary");
        let project_root = temp_root.join("project");

        std::fs::create_dir_all(&primary_root).expect("primary root should be created");
        std::fs::create_dir_all(project_root.join("@acme")).expect("project @acme dir should be created");

        git_status_success(&primary_root, &["init", "-b", "main"]);
        git_status_success(&project_root, &["init", "-b", "main"]);

        std::fs::write(primary_root.join("package.json"), b"{}\n")
            .expect("primary package file should be written");
        std::fs::write(primary_root.join("button.tsx"), b"export const Button = 1;\n")
            .expect("primary button file should be written");
        git_status_success(&primary_root, &["add", "."]);
        git_status_success(
            &primary_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial primary commit",
            ],
        );

        std::fs::write(project_root.join("README.md"), b"# project\n")
            .expect("project readme should be written");
        std::fs::write(project_root.join("@acme/button.tsx"), b"export const Button = 1;\n")
            .expect("project button file should be written");
        git_status_success(&project_root, &["add", "."]);
        git_status_success(
            &project_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial project commit",
            ],
        );

        (temp_root, primary_root, project_root)
    }

    fn patch_fixture_profile(project_root: &Path, primary_root: &Path) -> SyncProfilePayload {
        SyncProfilePayload {
            id: "patch-profile-1".to_string(),
            project_path: project_root.to_string_lossy().into_owned(),
            mode: "patch".to_string(),
            primary_path: Some(primary_root.to_string_lossy().into_owned()),
            subtree: None,
        }
    }

    #[test]
    fn execute_patch_sync_applies_primary_commits_into_project_acme() {
        let (temp_root, primary_root, project_root) =
            create_patch_sync_fixture("atelier-patch-sync-pull");
        std::fs::write(primary_root.join("button.tsx"), b"export const Button = 2;\n")
            .expect("updated primary file should be written");
        git_status_success(&primary_root, &["add", "button.tsx"]);
        git_status_success(
            &primary_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "primary update",
            ],
        );

        let result = execute_patch_sync(
            patch_fixture_profile(&project_root, &primary_root),
            "from-primary".to_string(),
        );
        let synced_contents = std::fs::read_to_string(project_root.join("@acme/button.tsx"))
            .expect("project button file should be readable after patch sync");

        let _ = std::fs::remove_dir_all(&temp_root);

        result.expect("patch pull should succeed");
        assert!(synced_contents.contains("Button = 2"));
    }

    #[test]
    fn execute_patch_sync_applies_project_acme_commits_back_into_primary() {
        let (temp_root, primary_root, project_root) =
            create_patch_sync_fixture("atelier-patch-sync-push");
        std::fs::write(project_root.join("@acme/button.tsx"), b"export const Button = 3;\n")
            .expect("updated project file should be written");
        git_status_success(&project_root, &["add", "@acme/button.tsx"]);
        git_status_success(
            &project_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "project update",
            ],
        );

        let result = execute_patch_sync(
            patch_fixture_profile(&project_root, &primary_root),
            "to-primary".to_string(),
        );
        let synced_contents = std::fs::read_to_string(primary_root.join("button.tsx"))
            .expect("primary button file should be readable after patch sync");

        let _ = std::fs::remove_dir_all(&temp_root);

        result.expect("patch push should succeed");
        assert!(synced_contents.contains("Button = 3"));
    }

    #[test]
    fn execute_patch_sync_rejects_dirty_destination_repo() {
        let (temp_root, primary_root, project_root) =
            create_patch_sync_fixture("atelier-patch-sync-dirty-dest");
        std::fs::write(primary_root.join("button.tsx"), b"export const Button = 2;\n")
            .expect("updated primary file should be written");
        git_status_success(&primary_root, &["add", "button.tsx"]);
        git_status_success(
            &primary_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "primary update",
            ],
        );
        std::fs::write(project_root.join("draft.txt"), b"dirty\n")
            .expect("dirty project file should be written");

        let error = execute_patch_sync(
            patch_fixture_profile(&project_root, &primary_root),
            "from-primary".to_string(),
        )
        .expect_err("dirty destination should be rejected");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(error.contains("refusing patch sync with dirty git repo"));
    }

    #[test]
    fn execute_patch_sync_rejects_dirty_source_repo() {
        let (temp_root, primary_root, project_root) =
            create_patch_sync_fixture("atelier-patch-sync-dirty-source");
        std::fs::write(project_root.join("@acme/button.tsx"), b"export const Button = 4;\n")
            .expect("dirty source file should be written");

        let error = execute_patch_sync(
            patch_fixture_profile(&project_root, &primary_root),
            "to-primary".to_string(),
        )
        .expect_err("dirty source should be rejected");

        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(error.contains("refusing patch sync from dirty git repo"));
    }

    #[test]
    fn get_sync_status_marks_subtree_clean_when_split_head_matches_source_ref() {
        let (temp_root, _remote_root, _source_root, project_root) =
            create_subtree_status_fixture("atelier-subtree-status-clean");

        let result = get_sync_status(subtree_fixture_profile(&project_root, "main"));

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("status should resolve");
        assert_eq!(status.mode, "subtree");
        assert_eq!(status.state, "clean");
        assert_eq!(status.ahead_count, 0);
        assert_eq!(status.behind_count, 0);
        assert!(!status.dirty);
    }

    #[test]
    fn get_sync_status_marks_subtree_behind_when_source_ref_contains_newer_commit() {
        let (temp_root, remote_root, _source_root, project_root) =
            create_subtree_status_fixture("atelier-subtree-status-behind");
        push_source_commit(
            &temp_root,
            &remote_root,
            "peer-behind",
            br#"{"name":"behind"}"#,
        );
        git_status_success(&project_root, &["fetch", "origin"]);

        let result = get_sync_status(subtree_fixture_profile(&project_root, "main"));

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("status should resolve");
        assert_eq!(status.mode, "subtree");
        assert_eq!(status.state, "behind");
        assert_eq!(status.ahead_count, 0);
        assert!(status.behind_count > 0);
    }

    #[test]
    fn get_sync_status_marks_subtree_ahead_when_split_head_contains_newer_commit() {
        let (temp_root, _remote_root, _source_root, project_root) =
            create_subtree_status_fixture("atelier-subtree-status-ahead");
        commit_project_subtree_change(
            &project_root,
            br#"{"name":"ahead"}"#,
            "project subtree update",
        );

        let result = get_sync_status(subtree_fixture_profile(&project_root, "main"));

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("status should resolve");
        assert_eq!(status.mode, "subtree");
        assert_eq!(status.state, "ahead");
        assert!(status.ahead_count > 0);
        assert_eq!(status.behind_count, 0);
    }

    #[test]
    fn get_sync_status_marks_subtree_diverged_when_source_and_split_differ_both_ways() {
        let (temp_root, remote_root, _source_root, project_root) =
            create_subtree_status_fixture("atelier-subtree-status-diverged");
        push_source_commit(
            &temp_root,
            &remote_root,
            "peer-diverged",
            br#"{"name":"remote-diverged"}"#,
        );
        git_status_success(&project_root, &["fetch", "origin"]);
        commit_project_subtree_change(
            &project_root,
            br#"{"name":"project-diverged"}"#,
            "project diverged update",
        );

        let result = get_sync_status(subtree_fixture_profile(&project_root, "main"));

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("status should resolve");
        assert_eq!(status.mode, "subtree");
        assert_eq!(status.state, "diverged");
        assert!(status.ahead_count > 0);
        assert!(status.behind_count > 0);
    }

    #[test]
    fn get_sync_status_marks_subtree_missing_when_prefix_is_absent_from_head() {
        let (temp_root, _remote_root, _source_root, project_root) =
            create_subtree_status_fixture("atelier-subtree-status-missing-prefix");
        git_status_success(&project_root, &["rm", "-r", "@acme"]);
        git_status_success(
            &project_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "remove subtree prefix",
            ],
        );

        let result = get_sync_status(subtree_fixture_profile(&project_root, "main"));

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("status should resolve");
        assert_eq!(status.mode, "subtree");
        assert_eq!(status.state, "missing_subtree");
        assert_eq!(status.ahead_count, 0);
        assert_eq!(status.behind_count, 0);
        assert!(!status.dirty);
        assert_eq!(
            status.message.as_deref(),
            Some("subtree prefix @acme is missing from the current branch")
        );
    }

    #[test]
    fn get_sync_status_marks_subtree_misconfigured_when_source_ref_is_missing() {
        let (temp_root, _remote_root, _source_root, project_root) =
            create_subtree_status_fixture("atelier-subtree-status-missing-source");

        let result = get_sync_status(subtree_fixture_profile(&project_root, "missing-branch"));

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("status should resolve");
        assert_eq!(status.mode, "subtree");
        assert_eq!(status.state, "misconfigured");
        assert_eq!(
            status.message.as_deref(),
            Some("subtree source ref could not be resolved")
        );
    }

    #[test]
    fn execute_subtree_add_restores_missing_subtree_without_squash() {
        let (temp_root, project_root) =
            create_subtree_add_fixture("atelier-subtree-add-without-squash");
        let profile = subtree_add_fixture_profile(&project_root, false);

        let result = execute_subtree_add(profile);
        let acme_exists = project_root.join("@acme").exists();

        let _ = std::fs::remove_dir_all(&temp_root);

        result.expect("subtree add should succeed");
        assert!(acme_exists, "@acme subtree should exist after subtree add");
    }

    #[test]
    fn execute_subtree_add_restores_missing_subtree_with_squash() {
        let (temp_root, project_root) = create_subtree_add_fixture("atelier-subtree-add-with-squash");
        let profile = subtree_add_fixture_profile(&project_root, true);

        let result = execute_subtree_add(profile);
        let acme_exists = project_root.join("@acme").exists();

        let _ = std::fs::remove_dir_all(&temp_root);

        result.expect("subtree add should succeed");
        assert!(acme_exists, "@acme subtree should exist after subtree add");
    }

    #[test]
    fn get_repo_remote_status_returns_synced_for_clean_repo_with_upstream() {
        let (temp_root, repo_root) =
            create_remote_status_fixture("atelier-remote-status-synced");

        let result = get_repo_remote_status(repo_root.to_string_lossy().to_string());

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("remote status should resolve");
        assert_eq!(status.upstream_branch.as_deref(), Some("origin/main"));
        assert!(!status.working_tree_dirty);
        assert_eq!(status.ahead_count, 0);
        assert_eq!(status.behind_count, 0);
        assert_eq!(status.status, "synced");
        assert_eq!(status.message, None);
    }

    #[test]
    fn get_repo_remote_status_marks_dirty_repo_as_unpublished() {
        let (temp_root, repo_root) =
            create_remote_status_fixture("atelier-remote-status-dirty");
        std::fs::write(repo_root.join("dirty.txt"), b"draft")
            .expect("dirty file should be written");

        let result = get_repo_remote_status(repo_root.to_string_lossy().to_string());

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("remote status should resolve");
        assert_eq!(status.upstream_branch.as_deref(), Some("origin/main"));
        assert!(status.working_tree_dirty);
        assert_eq!(status.ahead_count, 0);
        assert_eq!(status.behind_count, 0);
        assert_eq!(status.status, "unpublished");
        assert_eq!(status.message, None);
    }

    #[test]
    fn get_repo_remote_status_marks_ahead_repo_as_unpublished() {
        let (temp_root, repo_root) =
            create_remote_status_fixture("atelier-remote-status-ahead");
        std::fs::write(repo_root.join("package.json"), br#"{"name":"ahead"}"#)
            .expect("repo file should be updated");
        git_status_success(&repo_root, &["add", "package.json"]);
        git_status_success(
            &repo_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "ahead commit",
            ],
        );

        let result = get_repo_remote_status(repo_root.to_string_lossy().to_string());

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("remote status should resolve");
        assert_eq!(status.upstream_branch.as_deref(), Some("origin/main"));
        assert!(!status.working_tree_dirty);
        assert_eq!(status.ahead_count, 1);
        assert_eq!(status.behind_count, 0);
        assert_eq!(status.status, "unpublished");
        assert_eq!(status.message, None);
    }

    #[test]
    fn get_repo_remote_status_returns_synced_for_behind_only_repo() {
        let (temp_root, repo_root) =
            create_remote_status_fixture("atelier-remote-status-behind");
        let peer_root = temp_root.join("peer");

        git_status_success(
            &temp_root,
            &[
                "clone",
                temp_root.join("remote.git").to_string_lossy().as_ref(),
                peer_root.to_string_lossy().as_ref(),
            ],
        );
        std::fs::write(peer_root.join("package.json"), br#"{"name":"behind"}"#)
            .expect("peer file should be updated");
        git_status_success(&peer_root, &["add", "package.json"]);
        git_status_success(
            &peer_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "behind commit",
            ],
        );
        git_status_success(&peer_root, &["push"]);
        git_status_success(&repo_root, &["fetch", "origin"]);

        let result = get_repo_remote_status(repo_root.to_string_lossy().to_string());

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("remote status should resolve");
        assert_eq!(status.upstream_branch.as_deref(), Some("origin/main"));
        assert!(!status.working_tree_dirty);
        assert_eq!(status.ahead_count, 0);
        assert_eq!(status.behind_count, 1);
        assert_eq!(status.status, "synced");
        assert_eq!(status.message, None);
    }

    #[test]
    fn get_repo_remote_status_returns_unknown_without_upstream() {
        let temp_root = std::env::temp_dir().join(format!(
            "atelier-remote-status-no-upstream-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_root).expect("temp root should be created");
        git_status_success(&temp_root, &["init", "-b", "main"]);
        std::fs::write(temp_root.join("package.json"), b"{}")
            .expect("repo file should be written");
        git_status_success(&temp_root, &["add", "package.json"]);
        git_status_success(
            &temp_root,
            &[
                "-c",
                "user.name=Atelier Test",
                "-c",
                "user.email=atelier@example.com",
                "commit",
                "-m",
                "initial commit",
            ],
        );

        let result = get_repo_remote_status(temp_root.to_string_lossy().to_string());

        let _ = std::fs::remove_dir_all(&temp_root);

        let status = result.expect("remote status should resolve");
        assert_eq!(status.upstream_branch, None);
        assert!(!status.working_tree_dirty);
        assert_eq!(status.ahead_count, 0);
        assert_eq!(status.behind_count, 0);
        assert_eq!(status.status, "unknown");
        assert_eq!(status.message.as_deref(), Some("No upstream branch configured"));
    }

    #[test]
    fn latest_modified_from_walkdir_reports_traversal_errors() {
        let walkdir_error = WalkDir::new("/definitely-missing-atelier-dir")
            .into_iter()
            .next()
            .expect("walkdir should yield a result for the root")
            .expect_err("missing root should produce a traversal error");

        let error = latest_modified_from_walkdir(vec![Err(walkdir_error)])
            .expect_err("walkdir traversal errors should be surfaced");

        assert!(error.contains("failed to read @acme tree"));
        assert!(error.contains("No such file") || error.contains("no such file"));
    }

    #[cfg(unix)]
    #[test]
    fn latest_modified_from_walkdir_reports_modified_time_read_errors() {
        use std::os::unix::fs::PermissionsExt;

        let temp_root = std::env::temp_dir().join(format!(
            "atelier-latest-modified-perms-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let child = temp_root.join("secret.txt");
        std::fs::create_dir_all(&temp_root).expect("temp dir should be created");
        std::fs::write(&child, b"secret").expect("temp file should be created");
        std::fs::set_permissions(&temp_root, std::fs::Permissions::from_mode(0o000))
            .expect("permissions should be updated");

        let result = latest_modified_from_walkdir(WalkDir::new(&temp_root).into_iter());

        std::fs::set_permissions(&temp_root, std::fs::Permissions::from_mode(0o755))
            .expect("permissions should be restorable");
        let _ = std::fs::remove_dir_all(&temp_root);

        let error = result.expect_err("metadata failures should be surfaced");
        assert!(error.contains("failed to read @acme tree") || error.contains("failed to read @acme metadata") || error.contains("failed to read @acme modified time"));
    }
}
