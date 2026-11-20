use std::collections::{BTreeMap, HashSet};
use std::process::Command;

use serde::Serialize;

/// A TCP socket in LISTEN state, as reported by lsof.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub pid: u32,
    pub command: String,
    pub address: String,
    pub port: u16,
    pub cwd: Option<String>,
    /// Executable path, when ps reports one (see identify.rs).
    pub exe: Option<String>,
    /// App bundle the process ships in, or its parent's.
    pub app: Option<String>,
    /// Executable ships with macOS.
    pub system: bool,
    pub launchd_label: Option<String>,
    pub launchd_plist: Option<String>,
}

/// `lsof -F` emits one field per line: `p<pid>` opens a process block,
/// `c<command>` names it, and each `n<addr:port>` is one socket in it.
fn parse_listeners(output: &str) -> Vec<Listener> {
    let mut listeners = Vec::new();
    let mut seen = HashSet::new();
    let mut pid = 0u32;
    let mut command = String::new();

    for line in output.lines() {
        let (tag, value) = line.split_at(line.len().min(1));
        match tag {
            "p" => pid = value.parse().unwrap_or(0),
            "c" => command = value.to_string(),
            "n" => {
                let Some((address, port)) = value.rsplit_once(':') else {
                    continue;
                };
                let Ok(port) = port.parse::<u16>() else {
                    continue;
                };
                // IPv4 and IPv6 sockets of one process on one port are a single service.
                if seen.insert((pid, port)) {
                    listeners.push(Listener {
                        pid,
                        command: command.clone(),
                        address: address.to_string(),
                        port,
                        cwd: None,
                        exe: None,
                        app: None,
                        system: false,
                        launchd_label: None,
                        launchd_plist: None,
                    });
                }
            }
            _ => {}
        }
    }

    listeners
}

fn parse_cwds(output: &str) -> BTreeMap<u32, String> {
    let mut cwds = BTreeMap::new();
    let mut pid = 0u32;
    for line in output.lines() {
        let (tag, value) = line.split_at(line.len().min(1));
        match tag {
            "p" => pid = value.parse().unwrap_or(0),
            "n" => {
                cwds.insert(pid, value.to_string());
            }
            _ => {}
        }
    }
    cwds
}

/// Lists every listening TCP socket owned by the current user.
pub fn listeners() -> Result<Vec<Listener>, String> {
    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])
        .output()
        .map_err(|e| format!("Failed to run lsof: {}", e))?;
    // lsof exits 1 when nothing matches; that is an empty list, not an error.
    let mut listeners = parse_listeners(&String::from_utf8_lossy(&output.stdout));

    let pids: Vec<String> = listeners
        .iter()
        .map(|l| l.pid.to_string())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if !pids.is_empty() {
        if let Ok(output) = Command::new("lsof")
            .args(["-a", "-d", "cwd", "-F", "pn", "-p", &pids.join(",")])
            .output()
        {
            let cwds = parse_cwds(&String::from_utf8_lossy(&output.stdout));
            for listener in &mut listeners {
                listener.cwd = cwds.get(&listener.pid).cloned();
            }
        }
    }

    super::identify::annotate(&mut listeners);
    listeners.sort_by_key(|l| l.port);
    Ok(listeners)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_listeners_and_dedupes_ip_families() {
        let out = "p100\ncnode\nn*:3000\nn[::1]:3000\np200\ncpostgres\nn127.0.0.1:55422\n";
        let listeners = parse_listeners(out);
        assert_eq!(listeners.len(), 2);
        assert_eq!(listeners[0].pid, 100);
        assert_eq!(listeners[0].command, "node");
        assert_eq!(listeners[0].port, 3000);
        assert_eq!(listeners[1].address, "127.0.0.1");
        assert_eq!(listeners[1].port, 55422);
    }

    #[test]
    fn parses_cwds() {
        let cwds = parse_cwds("p100\nfcwd\nn/Users/me/app\np200\nfcwd\nn/\n");
        assert_eq!(cwds.get(&100).map(String::as_str), Some("/Users/me/app"));
        assert_eq!(cwds.get(&200).map(String::as_str), Some("/"));
    }
}
