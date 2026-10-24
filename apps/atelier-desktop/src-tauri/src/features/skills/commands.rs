use std::process::{Command, Output};

fn run_pnpm(args: &[&str]) -> std::io::Result<Output> {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("pnpm");
        for arg in args {
            cmd.arg(arg);
        }
        cmd.output()
    } else {
        // Ensure common bin directories (Homebrew, npm global, pnpm) are in PATH
        let script = format!(
            "export PATH=\"$PATH:$HOME/.local/share/pnpm:$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin\"; pnpm {}",
            args.join(" ")
        );
        Command::new("/bin/sh")
            .arg("-c")
            .arg(script)
            .output()
    }
}

#[tauri::command]
pub async fn install_skill(skill_source: String) -> Result<(), String> {
    let output = run_pnpm(&["dlx", "skills", "add", &skill_source, "--global", "--yes"])
        .map_err(|error| format!("Failed to run pnpm dlx skills add: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let error_msg = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(format!("{}", error_msg.trim()));
    }

    Ok(())
}

#[tauri::command]
pub async fn search_skills(query: String, limit: Option<u32>) -> Result<String, String> {
    let limit_val = limit.unwrap_or(20);
    let url = format!("https://skills.sh/api/search?q={}&limit={}", query, limit_val);
    
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
        
    let text = response.text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
        
    Ok(text)
}

#[tauri::command]
pub async fn get_installed_skills() -> Result<String, String> {
    let output = run_pnpm(&["dlx", "skills", "ls", "--global", "--json"])
        .map_err(|error| format!("Failed to run pnpm dlx skills ls: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let error_msg = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(format!("{}", error_msg.trim()));
    }

    let mut parsed_output = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Augment with 'source' from ~/.agents/.skill-lock.json to support workspace group UI mapping
    let home = std::env::var("HOME").unwrap_or_else(|_| String::from("~"));
    let lockfile_path = std::path::Path::new(&home).join(".agents").join(".skill-lock.json");

    if let Ok(lock_content) = std::fs::read_to_string(lockfile_path) {
        if let Ok(mut parsed_ls) = serde_json::from_str::<serde_json::Value>(&parsed_output) {
            if let Ok(lock_json) = serde_json::from_str::<serde_json::Value>(&lock_content) {
                if let Some(skills_lock) = lock_json.get("skills").and_then(|s| s.as_object()) {
                    if let Some(ls_array) = parsed_ls.as_array_mut() {
                        for item in ls_array.iter_mut() {
                            if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                                if let Some(skill_lock_data) = skills_lock.get(name) {
                                    if let Some(source) = skill_lock_data.get("source") {
                                        if let Some(obj) = item.as_object_mut() {
                                            obj.insert("source".to_string(), source.clone());
                                        }
                                    }
                                    if let Some(installed_at) = skill_lock_data.get("installedAt") {
                                        if let Some(obj) = item.as_object_mut() {
                                            obj.insert("installedAt".to_string(), installed_at.clone());
                                        }
                                    }
                                    if let Some(updated_at) = skill_lock_data.get("updatedAt") {
                                        if let Some(obj) = item.as_object_mut() {
                                            obj.insert("updatedAt".to_string(), updated_at.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            parsed_output = parsed_ls.to_string();
        }
    }

    Ok(parsed_output)
}

#[tauri::command]
pub async fn uninstall_skill(skill_name: String) -> Result<(), String> {
    let output = run_pnpm(&["dlx", "skills", "rm", &skill_name, "--global", "--yes"])
        .map_err(|error| format!("Failed to run pnpm dlx skills rm: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let error_msg = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(format!("{}", error_msg.trim()));
    }

    Ok(())
}

#[tauri::command]
pub async fn enable_skill_for_agent(skill_source: String, skill_name: String, agent_name: String) -> Result<(), String> {
    let output = run_pnpm(&["dlx", "skills", "add", &skill_source, "--skill", &skill_name, "--agent", &agent_name, "--global", "--yes"])
        .map_err(|error| format!("Failed to run pnpm dlx skills add: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let error_msg = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(format!("{}", error_msg.trim()));
    }

    Ok(())
}

#[tauri::command]
pub async fn disable_skill_for_agent(skill_name: String, agent_name: String) -> Result<(), String> {
    let output = run_pnpm(&["dlx", "skills", "rm", &skill_name, "--agent", &agent_name, "--global", "--yes"])
        .map_err(|error| format!("Failed to run pnpm dlx skills rm: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let error_msg = if stderr.trim().is_empty() { stdout } else { stderr };
        return Err(format!("{}", error_msg.trim()));
    }

    Ok(())
}

#[tauri::command]
pub async fn get_detected_agents() -> Result<Vec<String>, String> {
    let mut agents = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();
    let home_path = std::path::Path::new(&home);

    if home_path.join(".claude").exists() || home_path.join(".claude.json").exists() || std::path::Path::new("/usr/local/bin/claude").exists() {
        agents.push("claude-code".to_string());
    }
    
    if home_path.join(".gemini").exists() || std::path::Path::new("/usr/local/bin/gemini").exists() {
        agents.push("gemini-cli".to_string());
    }

    if std::path::Path::new("/Applications/Cursor.app").exists() || home_path.join("AppData/Local/Programs/Cursor").exists() {
        agents.push("cursor".to_string());
    }
    
    if std::path::Path::new("/Applications/Windsurf.app").exists() || home_path.join("AppData/Local/Programs/Windsurf").exists() {
        agents.push("windsurf".to_string());
    }

    if home_path.join(".gemini/antigravity").exists() || home_path.join(".antigravity").exists() {
        agents.push("antigravity".to_string());
    }
    if home_path.join(".roo").exists() || home_path.join(".vscode/extensions").read_dir().map_or(false, |mut i| i.any(|e| e.unwrap().file_name().to_string_lossy().contains("rooveterinaryinc.roo-cline"))) {
        agents.push("roo-code".to_string());
    }
    if home_path.join(".cline").exists() || home_path.join(".vscode/extensions").read_dir().map_or(false, |mut i| i.any(|e| e.unwrap().file_name().to_string_lossy().contains("saoudrizwan.claude-dev"))) {
        agents.push("cline".to_string());
    }

    Ok(agents)
}

/// Per-skill usage counted from Claude Code transcripts and Antigravity
/// conversations. The first call scans everything (seconds); later calls only
/// read what changed.
#[tauri::command]
pub async fn get_skill_usage() -> Result<super::usage::SkillUsageReport, String> {
    tokio::task::spawn_blocking(super::usage::collect)
        .await
        .map_err(|e| e.to_string())
}
