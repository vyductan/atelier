//! Which installed skills have a newer version upstream, and updating one.
//!
//! skills.sh 1.8 has an unlisted `skills check`: it compares each lock
//! entry's `skillFolderHash` with the folder's current tree hash on GitHub
//! and prints `↑ <name> has an update`, changing nothing. There is no JSON
//! mode, so those lines are the interface. Each check costs one GitHub API
//! call per source repo (60/hour without a token): run it on demand, not on
//! a timer.

use super::commands::run_pnpm;

/// `run_pnpm` hands its arguments to `sh -c` unquoted, so a name must not be
/// able to carry shell syntax. skills.sh names are kebab-case anyway.
fn check_safe_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && !name.starts_with(['.', '-'])
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'));
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid skill name: {name:?}"))
    }
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // CSI: ESC [ params… final byte in @..~
            if chars.next() == Some('[') {
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_outdated(stdout: &str) -> Vec<String> {
    let mut names: Vec<String> = strip_ansi(stdout)
        .lines()
        .filter_map(|line| {
            line.trim()
                .strip_prefix('↑')?
                .trim()
                .strip_suffix("has an update")
                .map(|name| name.trim().to_string())
        })
        .filter(|name| !name.is_empty())
        .collect();
    names.sort();
    names.dedup();
    names
}

fn output_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = if stderr.trim().is_empty() { stdout } else { stderr };
    strip_ansi(text.trim())
}

#[tauri::command]
pub async fn check_skill_updates() -> Result<Vec<String>, String> {
    let output = run_pnpm(&["dlx", "skills", "check", "--global"])
        .map_err(|e| format!("Failed to run pnpm dlx skills check: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let outdated = parse_outdated(&stdout);
    // Like `npm outdated`, it exits 1 when it found updates, so the exit
    // code alone cannot tell "updates found" from a failed check.
    if output.status.success() || !outdated.is_empty() {
        return Ok(outdated);
    }
    Err(output_error(&output))
}

#[tauri::command]
pub async fn update_skill(skill_name: String) -> Result<(), String> {
    check_safe_name(&skill_name)?;
    let output = run_pnpm(&["dlx", "skills", "update", &skill_name, "--global", "--yes"])
        .map_err(|e| format!("Failed to run pnpm dlx skills update: {e}"))?;
    let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout));
    // It reports a failed update on stdout and may still exit 0.
    if !output.status.success() || stdout.contains("Failed to update") {
        return Err(output_error(&output));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_outdated_names_from_check_output() {
        let stdout = "\u{1b}[38;5;145mChecking for skill updates…\u{1b}[0m\n\n\
            \u{1b}[38;5;102mChecking skills from source: tt-a1i/archify\u{1b}[0m\u{1b}[K\n\
            \u{1b}[38;5;145m↑ archify has an update\u{1b}[0m\n\
            ↑ grill-with-docs has an update\n\n\
            1 skill(s) can be updated; run npx skills update to install\n";
        assert_eq!(parse_outdated(stdout), ["archify", "grill-with-docs"]);
        assert!(parse_outdated("✓ All global skills are up to date\n").is_empty());
    }

    #[test]
    fn refuses_names_that_could_reach_the_shell() {
        for bad in ["", "-g", ".x", "a b", "a;rm", "$(x)", "a/b", "`x`"] {
            assert!(check_safe_name(bad).is_err(), "{bad:?} should be rejected");
        }
        assert!(check_safe_name("grill-with-docs").is_ok());
    }
}
