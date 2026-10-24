//! Stopping a service that runs outside Atelier: a dev server started in a
//! terminal (or orphaned when that terminal closed) holds the registered port,
//! but there is no Atelier launchd job to boot out.

use std::process::Command;
use std::time::{Duration, Instant};

const GRACE: Duration = Duration::from_secs(5);
const AFTER_KILL: Duration = Duration::from_secs(2);

/// Process group leaders that must never be signalled as a group: signalling
/// a shell's group would take the user's terminal session (or more) with it.
const PROTECTED_LEADERS: &[&str] = &[
    "zsh", "bash", "fish", "sh", "dash", "login", "tmux", "screen", "launchd", "sshd",
];

#[derive(Debug, PartialEq, Eq)]
pub enum KillTarget {
    /// The whole job, like Ctrl+C in the terminal that started it (pnpm, vite, esbuild…).
    Group(u32),
    /// Only the listening process, when its group is not safe to signal.
    Process(u32),
}

/// Picks what to signal for the process listening on a service's port.
/// `leader` is the command of the group leader if it is still alive.
pub fn choose_target(
    listener_pid: u32,
    pgid: u32,
    own_pgid: u32,
    leader: Option<&str>,
) -> KillTarget {
    let leader_name = leader
        .map(|command| command.rsplit('/').next().unwrap_or(command).trim_start_matches('-'))
        .unwrap_or("");
    let unsafe_group = pgid <= 1
        || pgid == own_pgid
        || PROTECTED_LEADERS.contains(&leader_name);
    if unsafe_group {
        KillTarget::Process(listener_pid)
    } else {
        KillTarget::Group(pgid)
    }
}

fn listener_pid(port: u16) -> Option<u32> {
    let output = Command::new("lsof")
        .args(["-t", "-nP", &format!("-iTCP:{}", port), "-sTCP:LISTEN"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .and_then(|line| line.trim().parse().ok())
}

fn ps_field(pid: u32, field: &str) -> Option<String> {
    let output = Command::new("ps")
        .args(["-o", &format!("{}=", field), "-p", &pid.to_string()])
        .output()
        .ok()?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !value.is_empty()).then_some(value)
}

fn signal(target: &KillTarget, sig: &str) {
    let arg = match target {
        KillTarget::Group(pgid) => format!("-{}", pgid),
        KillTarget::Process(pid) => pid.to_string(),
    };
    let _ = Command::new("kill").args([&format!("-{}", sig), "--", &arg]).output();
}

fn wait_until_free(port: u16, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if listener_pid(port).is_none() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    listener_pid(port).is_none()
}

/// True when something listens on `port` (used to tell an unmanaged service
/// from one that is simply down).
pub fn is_listening(port: u16) -> bool {
    listener_pid(port).is_some()
}

/// SIGTERM the job holding `port`, escalate to SIGKILL after a grace period,
/// and fail if the port is still taken.
pub fn stop(port: u16) -> Result<(), String> {
    let pid = listener_pid(port).ok_or_else(|| format!("nothing is listening on port {}", port))?;
    let pgid: u32 = ps_field(pid, "pgid")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let own_pgid: u32 = ps_field(std::process::id(), "pgid")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let leader = if pgid > 1 { ps_field(pgid, "comm") } else { None };
    let target = choose_target(pid, pgid, own_pgid, leader.as_deref());

    signal(&target, "TERM");
    if wait_until_free(port, GRACE) {
        return Ok(());
    }
    signal(&target, "KILL");
    if wait_until_free(port, AFTER_KILL) {
        return Ok(());
    }
    Err(format!("port {} is still in use after SIGKILL (pid {})", port, pid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signals_the_whole_job_for_an_orphaned_dev_server() {
        // pnpm dev's group whose leader (the old shell job) is gone.
        assert_eq!(choose_target(31073, 31031, 500, None), KillTarget::Group(31031));
        assert_eq!(choose_target(31073, 31032, 500, Some("node")), KillTarget::Group(31032));
    }

    #[test]
    fn never_signals_a_shell_or_system_group() {
        assert_eq!(choose_target(42, 40, 500, Some("-zsh")), KillTarget::Process(42));
        assert_eq!(choose_target(42, 40, 500, Some("/opt/homebrew/bin/fish")), KillTarget::Process(42));
        assert_eq!(choose_target(42, 1, 500, Some("launchd")), KillTarget::Process(42));
        assert_eq!(choose_target(42, 0, 500, None), KillTarget::Process(42));
    }

    #[test]
    fn never_signals_atelier_itself() {
        assert_eq!(choose_target(42, 500, 500, Some("node")), KillTarget::Process(42));
    }
}
