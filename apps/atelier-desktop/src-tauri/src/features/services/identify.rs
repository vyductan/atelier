//! Who a listening process is: its executable, the app bundle it ships in
//! (or its parent's), and the launchd job that started it, so a port nobody
//! registered explains itself.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use super::discovery::Listener;

/// Executables macOS itself ships; their ports are system services.
const SYSTEM_PREFIXES: &[&str] = &["/usr/libexec/", "/usr/sbin/", "/sbin/", "/System/"];

/// Where launchd plists live, user agents first.
const PLIST_DIRS: &[&str] = &[
    "~/Library/LaunchAgents",
    "/Library/LaunchAgents",
    "/Library/LaunchDaemons",
    "/System/Library/LaunchAgents",
    "/System/Library/LaunchDaemons",
];

/// Outermost `.app` bundle in an executable path: helpers nested in
/// `Frameworks/Helper.app` belong to the app that ships them.
pub fn app_name(exe: &str) -> Option<String> {
    exe.split('/')
        .find_map(|segment| segment.strip_suffix(".app"))
        .filter(|name| !name.is_empty())
        .map(String::from)
}

pub fn is_system(exe: &str) -> bool {
    SYSTEM_PREFIXES.iter().any(|prefix| exe.starts_with(prefix))
}

struct Proc {
    ppid: u32,
    exe: String,
}

/// `ps -axo pid=,ppid=,comm=`: two numbers, then the executable path, which
/// may contain spaces (`/Applications/Antigravity Tools.app/...`).
fn parse_ps(output: &str) -> BTreeMap<u32, Proc> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.trim_start().splitn(2, char::is_whitespace);
            let pid = fields.next()?.parse().ok()?;
            let rest = fields.next()?.trim_start();
            let mut fields = rest.splitn(2, char::is_whitespace);
            let ppid = fields.next()?.parse().ok()?;
            let exe = fields.next()?.trim().to_string();
            Some((pid, Proc { ppid, exe }))
        })
        .collect()
}

/// `launchctl list`: `PID\tStatus\tLabel`, `-` for jobs that are not running.
/// `application.*` entries are GUI apps launchd tracks, not jobs anyone wrote.
fn parse_launchctl_list(output: &str) -> BTreeMap<u32, String> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let pid = fields.next()?.parse().ok()?;
            let label = fields.nth(1)?.trim();
            (!label.is_empty() && !label.starts_with("application."))
                .then(|| (pid, label.to_string()))
        })
        .collect()
}

fn plist_for(label: &str) -> Option<String> {
    PLIST_DIRS.iter().find_map(|dir| {
        let path = super::registry::expand_home(dir).join(format!("{}.plist", label));
        path.exists().then(|| path.display().to_string())
    })
}

/// Fills in exe/app/launchd fields. Best effort: a failing `ps` or
/// `launchctl` leaves the fields empty rather than failing the listing.
pub fn annotate(listeners: &mut [Listener]) {
    if listeners.is_empty() {
        return;
    }
    let procs = Command::new("ps")
        .args(["-axo", "pid=,ppid=,comm="])
        .output()
        .map(|output| parse_ps(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default();
    let jobs = Command::new("launchctl")
        .arg("list")
        .output()
        .map(|output| parse_launchctl_list(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default();

    for listener in listeners {
        let Some(proc) = procs.get(&listener.pid) else {
            continue;
        };
        // Only the direct parent: further up is the shell and the terminal
        // app, which would claim every dev server started from a terminal.
        listener.app = app_name(&proc.exe).or_else(|| {
            procs
                .get(&proc.ppid)
                .filter(|_| proc.ppid > 1)
                .and_then(|parent| app_name(&parent.exe))
        });
        listener.system = is_system(&proc.exe);
        listener.launchd_label = jobs.get(&listener.pid).cloned();
        listener.launchd_plist = listener.launchd_label.as_deref().and_then(plist_for);
        // ps reports a path only for real executables; node rewrites its
        // title (`next-server (v16)`), which is no path at all.
        listener.exe = Path::new(&proc.exe)
            .is_absolute()
            .then(|| proc.exe.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_outermost_app_bundle() {
        assert_eq!(
            app_name("/Applications/Antigravity Tools.app/Contents/MacOS/antigravity-tools").as_deref(),
            Some("Antigravity Tools")
        );
        assert_eq!(
            app_name("/Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper.app/Contents/MacOS/OrbStack Helper")
                .as_deref(),
            Some("OrbStack")
        );
        assert_eq!(app_name("/opt/homebrew/bin/socat"), None);
    }

    #[test]
    fn tells_system_executables() {
        assert!(is_system("/usr/libexec/rapportd"));
        assert!(is_system("/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter"));
        assert!(!is_system("/opt/homebrew/bin/socat"));
        assert!(!is_system("/usr/local/bin/node"));
    }

    #[test]
    fn parses_ps_with_spaces_in_paths() {
        let procs = parse_ps(
            "  632     1 /usr/libexec/rapportd\n29981     1 /Applications/Antigravity Tools.app/Contents/MacOS/antigravity-tools\n65733 65726 next-server (v16.3.8)\n",
        );
        assert_eq!(procs[&632].exe, "/usr/libexec/rapportd");
        assert_eq!(
            procs[&29981].exe,
            "/Applications/Antigravity Tools.app/Contents/MacOS/antigravity-tools"
        );
        assert_eq!(procs[&65733].ppid, 65726);
        assert_eq!(procs[&65733].exe, "next-server (v16.3.8)");
    }

    #[test]
    fn parses_launchctl_list_skipping_stopped_jobs_and_apps() {
        let jobs = parse_launchctl_list(
            "PID\tStatus\tLabel\n-\t0\tcom.apple.progressd\n862\t0\tdev.vyductan.antigravity-relay\n43215\t0\tapplication.com.google.Chrome.1.2\n",
        );
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[&862], "dev.vyductan.antigravity-relay");
    }
}
