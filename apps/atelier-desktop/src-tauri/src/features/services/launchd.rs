use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::registry::{atelier_dir, expand_home, ServiceDef};

const MANAGED_PREFIX: &str = "dev.atelier.svc.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchdState {
    pub label: String,
    pub loaded: bool,
    pub pid: Option<u32>,
    pub last_exit_code: Option<i32>,
}

fn uid() -> String {
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "501".to_string())
}

fn domain() -> String {
    format!("gui/{}", uid())
}

pub fn managed_label(id: &str) -> String {
    format!("{}{}", MANAGED_PREFIX, id)
}

pub fn label_for(def: &ServiceDef) -> Option<String> {
    match def.kind {
        super::registry::ServiceKind::Process => Some(managed_label(&def.id)),
        super::registry::ServiceKind::Launchd => def.label.clone(),
        super::registry::ServiceKind::Remote => None,
    }
}

fn agent_plist_path(label: &str) -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join("Library/LaunchAgents")
        .join(format!("{}.plist", label))
}

pub fn managed_log_path(id: &str) -> PathBuf {
    atelier_dir().join("logs").join(format!("{}.log", id))
}

/// Where a service writes its output: explicit `log`, our own log for managed
/// agents, or the StandardOutPath of an existing agent's plist.
pub fn log_path(def: &ServiceDef) -> Option<PathBuf> {
    if let Some(log) = &def.log {
        return Some(expand_home(log));
    }
    match def.kind {
        super::registry::ServiceKind::Process => Some(managed_log_path(&def.id)),
        super::registry::ServiceKind::Launchd => {
            let plist = agent_plist_path(def.label.as_deref()?);
            let output = Command::new("plutil")
                .args(["-extract", "StandardOutPath", "raw", "-o", "-"])
                .arg(&plist)
                .output()
                .ok()?;
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (output.status.success() && !path.is_empty()).then(|| PathBuf::from(path))
        }
        super::registry::ServiceKind::Remote => None,
    }
}

/// `launchctl print` output is not a stable format, but `pid = N` and
/// `last exit code = N` have been present since 10.10.
fn parse_print(label: &str, output: &str) -> LaunchdState {
    let mut pid = None;
    let mut last_exit_code = None;
    for line in output.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("pid = ") {
            pid = value.parse().ok();
        } else if let Some(value) = line.strip_prefix("last exit code = ") {
            // "78: EX_CONFIG" or "(never exited)"
            last_exit_code = value.split(':').next().and_then(|v| v.trim().parse().ok());
        }
    }
    LaunchdState {
        label: label.to_string(),
        loaded: true,
        pid,
        last_exit_code,
    }
}

pub fn state(label: &str) -> LaunchdState {
    let output = Command::new("launchctl")
        .args(["print", &format!("{}/{}", domain(), label)])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            parse_print(label, &String::from_utf8_lossy(&output.stdout))
        }
        _ => LaunchdState {
            label: label.to_string(),
            loaded: false,
            pid: None,
            last_exit_code: None,
        },
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render_plist(def: &ServiceDef, label: &str, log: &str) -> String {
    let cmd = def.cmd.as_deref().unwrap_or_default();
    let cwd = def
        .cwd
        .as_deref()
        .map(|c| expand_home(c).display().to_string())
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().display().to_string());

    let mut env = String::new();
    if !def.env.is_empty() {
        env.push_str("  <key>EnvironmentVariables</key>\n  <dict>\n");
        for (key, value) in &def.env {
            env.push_str(&format!(
                "    <key>{}</key><string>{}</string>\n",
                xml_escape(key),
                xml_escape(value)
            ));
        }
        env.push_str("  </dict>\n");
    }

    // A login shell gives the job the same PATH (pnpm, supabase, node) as a terminal.
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>{cmd}</string>
  </array>
  <key>WorkingDirectory</key><string>{cwd}</string>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><{keep_alive}/>
{env}</dict>
</plist>
"#,
        label = xml_escape(label),
        cmd = xml_escape(cmd),
        cwd = xml_escape(&cwd),
        log = xml_escape(log),
        keep_alive = if def.keep_alive { "true" } else { "false" },
        env = env,
    )
}

fn run(cmd: &mut Command) -> Result<(), String> {
    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = if stderr.trim().is_empty() { stdout } else { stderr };
    Err(message.trim().to_string())
}

fn run_shell(script: &str, cwd: Option<&str>) -> Result<(), String> {
    let mut cmd = Command::new("/bin/zsh");
    cmd.args(["-lc", script]);
    if let Some(cwd) = cwd {
        cmd.current_dir(expand_home(cwd));
    }
    run(&mut cmd)
}

/// How long to wait for a booted-out job to leave launchd. `launchctl bootout`
/// returns while a slow-exiting job (turbo flushing its cache) is still
/// being removed, and a bootstrap in that window fails with
/// "Bootstrap failed: 5: Input/output error".
const UNLOAD_TIMEOUT: Duration = Duration::from_secs(20);

fn bootout(label: &str) {
    // Fails when the job is not loaded, which is the state we want anyway.
    let _ = run(Command::new("launchctl").args(["bootout", &format!("{}/{}", domain(), label)]));
    let started = Instant::now();
    while state(label).loaded && started.elapsed() < UNLOAD_TIMEOUT {
        std::thread::sleep(Duration::from_millis(250));
    }
}

pub fn start(def: &ServiceDef) -> Result<(), String> {
    let label = label_for(def).ok_or("remote services cannot be started")?;

    match def.kind {
        super::registry::ServiceKind::Process => {
            let log = managed_log_path(&def.id);
            std::fs::create_dir_all(log.parent().unwrap()).map_err(|e| e.to_string())?;
            // Generated plists live in ~/.atelier so they never load at login on their own.
            let plist = atelier_dir().join("launchd").join(format!("{}.plist", label));
            std::fs::create_dir_all(plist.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(&plist, render_plist(def, &label, &log.display().to_string()))
                .map_err(|e| e.to_string())?;

            bootout(&label);
            run(Command::new("launchctl").args(["bootstrap", &domain()]).arg(&plist))
        }
        _ => {
            if !state(&label).loaded {
                run(Command::new("launchctl")
                    .args(["bootstrap", &domain()])
                    .arg(agent_plist_path(&label)))?;
            }
            run(Command::new("launchctl").args(["kickstart", &format!("{}/{}", domain(), label)]))
        }
    }
}

pub fn stop(def: &ServiceDef) -> Result<(), String> {
    let label = label_for(def).ok_or("remote services cannot be stopped")?;
    if let Some(stop_cmd) = &def.stop_cmd {
        run_shell(stop_cmd, def.cwd.as_deref())?;
    }
    bootout(&label);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_launchctl_print() {
        let out = "gui/501/x = {\n\tactive count = 1\n\tstate = running\n\tpid = 4242\n\tlast exit code = 78: EX_CONFIG\n}";
        let state = parse_print("x", out);
        assert!(state.loaded);
        assert_eq!(state.pid, Some(4242));
        assert_eq!(state.last_exit_code, Some(78));
    }

    #[test]
    fn escapes_command_in_plist() {
        let def: ServiceDef = serde_yaml::from_str(
            "id: a\nkind: process\ncmd: 'pnpm dev && echo \"<ok>\"'\ncwd: /tmp\nenv: {PORT: '1'}",
        )
        .unwrap();
        let plist = render_plist(&def, "dev.atelier.svc.a", "/tmp/a.log");
        assert!(plist.contains("<string>pnpm dev &amp;&amp; echo &quot;&lt;ok&gt;&quot;</string>"));
        assert!(plist.contains("<key>PORT</key><string>1</string>"));
        assert!(plist.contains("<key>KeepAlive</key><false/>"));
    }
}
