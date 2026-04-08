// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod features;
mod utils;

use features::projects::{list_projects, update_workspace_path};
use features::sessions::{
    delete_session, export_session, export_session_to_codex, generate_session_handoff,
    get_project_sessions, get_session_cwd, read_session_messages, rename_session,
    search_sessions, update_session_model_metadata,
};
use features::file_ops::{
    delete_sync_file, ensure_directory, execute_patch_sync, execute_rsync_conflict_resolutions,
    execute_rsync_sync, execute_subtree_add, execute_subtree_sync, get_latest_modified,
    get_repo_metadata, get_repo_remote_status, get_rsync_git_safety, get_sync_conflict_detail,
    get_sync_status, open_global_claude_config, open_global_codex_config,
    preview_subtree_sync, preview_sync_changes, preview_sync_file_diff,
    read_global_claude_config, read_task_snapshot, sync_claude_permissions_to_codex,
    write_global_claude_config, write_task_snapshot,
};
use features::scheduled_tasks::{
    list_claude_scheduled_task_files, read_claude_scheduled_task_file,
    read_scheduled_task_snapshot, write_scheduled_task_snapshot,
};
use features::studio::start_studio_server;
use features::watcher::start_fs_watcher;
use features::workspace::{
    get_workspace_diff, get_workspace_file_content, get_workspace_status,
};
use features::skills::commands::{
    get_installed_skills, install_skill, search_skills, uninstall_skill, enable_skill_for_agent, disable_skill_for_agent,
    get_detected_agents,
};

fn main() {
    let _ = fix_path_env::fix();

    // Start studio HTTP server in background
    tauri::async_runtime::spawn(async {
        start_studio_server().await;
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            get_project_sessions,
            delete_session,
            update_session_model_metadata,
            search_sessions,
            read_session_messages,
            rename_session,
            get_session_cwd,
            update_workspace_path,
            export_session,
            export_session_to_codex,
            generate_session_handoff,
            get_latest_modified,
            get_repo_metadata,
            get_repo_remote_status,
            preview_sync_changes,
            preview_sync_file_diff,
            get_sync_conflict_detail,
            execute_rsync_sync,
            execute_rsync_conflict_resolutions,
            execute_patch_sync,
            get_rsync_git_safety,
            get_sync_status,
            preview_subtree_sync,
            execute_subtree_sync,
            execute_subtree_add,
            delete_sync_file,
            ensure_directory,
            read_global_claude_config,
            write_global_claude_config,
            open_global_claude_config,
            open_global_codex_config,
            sync_claude_permissions_to_codex,
            read_task_snapshot,
            write_task_snapshot,
            read_scheduled_task_snapshot,
            write_scheduled_task_snapshot,
            list_claude_scheduled_task_files,
            read_claude_scheduled_task_file,
            get_workspace_status,
            get_workspace_diff,
            get_workspace_file_content,
            install_skill,
            search_skills,
            get_installed_skills,
            uninstall_skill,
            enable_skill_for_agent,
            disable_skill_for_agent,
            get_detected_agents,
        ])
        .setup(|app| {
            start_fs_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
