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
    delete_sync_file, ensure_directory, execute_rsync_conflict_resolutions, execute_rsync_sync,
    execute_subtree_add, execute_subtree_sync, get_latest_modified, get_repo_metadata,
    get_repo_remote_status, get_rsync_git_safety, get_sync_conflict_detail, get_sync_status,
    preview_subtree_sync, preview_sync_changes, preview_sync_file_diff, read_global_claude_config,
    open_global_claude_config,
    open_global_codex_config, sync_claude_permissions_to_codex,
    read_task_snapshot, write_global_claude_config, write_task_snapshot,
};
use features::studio::start_studio_server;
use features::watcher::start_fs_watcher;
use features::workspace::{
    get_workspace_diff, get_workspace_file_content, get_workspace_status,
};
use features::skills::commands::{
    get_installed_skills, install_skill, search_skills, uninstall_skill, enable_skill_for_agent, disable_skill_for_agent,
    get_detected_agents, get_skill_usage,
};
use features::skills::disable::{disable_skill, enable_skill, list_disabled_skills};
use features::skills::agent_toggle::{get_skill_agent_states, set_skill_for_agent};
use features::skills::content::{get_skill_files, open_skill_path, read_skill_file};
use features::skills::meta::get_skill_meta;
use features::skills::plugins::{get_plugin_skills, set_plugin_enabled};
use features::skills::updates::{check_skill_updates, update_skill};
use features::power::{get_wake_schedule, set_wake_schedule};
use features::services::commands::{
    get_services_order, list_services, open_services_config, read_service_log, restart_service,
    save_services_order, start_service, stop_service,
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
        // Remembers size and position across launches; the config size is
        // only the first-run default.
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
            get_skill_usage,
            get_plugin_skills,
            get_skill_meta,
            get_skill_files,
            read_skill_file,
            open_skill_path,
            set_plugin_enabled,
            disable_skill,
            enable_skill,
            list_disabled_skills,
            get_skill_agent_states,
            set_skill_for_agent,
            check_skill_updates,
            update_skill,
            list_services,
            start_service,
            stop_service,
            restart_service,
            read_service_log,
            open_services_config,
            get_services_order,
            save_services_order,
            get_wake_schedule,
            set_wake_schedule,
        ])
        .setup(|app| {
            start_fs_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
