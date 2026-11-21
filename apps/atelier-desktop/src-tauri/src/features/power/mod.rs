//! Daily wake of this Mac, so routines scheduled while it sleeps run on time.
//!
//! macOS keeps one repeating power-on/wake event (`pmset repeat`). Reading it
//! needs no privilege; setting or cancelling it needs root, so `set_wake_schedule`
//! goes through `osascript ... with administrator privileges`: macOS shows its
//! own password dialog and the person types the password there, never the app.
//!
//! `pmset repeat cancel` drops every repeating event, a repeating shutdown or
//! sleep included. The wake switch owns that slot.

use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeSchedule {
    /// A repeating wake or power-on event is set.
    pub enabled: bool,
    /// Its time as "HH:MM" (24h), when it could be read.
    pub time: Option<String>,
    /// The line pmset printed, shown as is.
    pub raw: Option<String>,
}

/// Reads the "Repeating power events:" block of `pmset -g sched`.
pub fn parse_schedule(output: &str) -> WakeSchedule {
    let mut in_repeat = false;
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.ends_with(':') && !trimmed.contains(" at ") {
            in_repeat = trimmed.starts_with("Repeating power events");
            continue;
        }
        if in_repeat && trimmed.starts_with("wake") {
            let time = trimmed
                .split_once(" at ")
                .and_then(|(_, rest)| rest.split_whitespace().next())
                .and_then(to_24h);
            return WakeSchedule {
                enabled: true,
                time,
                raw: Some(trimmed.to_string()),
            };
        }
    }
    WakeSchedule {
        enabled: false,
        time: None,
        raw: None,
    }
}

/// "8:55AM" -> "08:55", "12:05AM" -> "00:05", "1:30PM" -> "13:30".
fn to_24h(clock: &str) -> Option<String> {
    let upper = clock.to_ascii_uppercase();
    let (digits, pm) = if let Some(d) = upper.strip_suffix("PM") {
        (d, true)
    } else if let Some(d) = upper.strip_suffix("AM") {
        (d, false)
    } else {
        (upper.as_str(), false)
    };
    let mut parts = digits.split(':');
    let hour: u32 = parts.next()?.parse().ok()?;
    let minute: u32 = parts.next()?.parse().ok()?;
    if minute > 59 || hour > 23 {
        return None;
    }
    let hour = match (upper.ends_with('M'), pm, hour) {
        (true, false, 12) => 0,
        (true, true, h) if h < 12 => h + 12,
        (_, _, h) => h,
    };
    Some(format!("{hour:02}:{minute:02}"))
}

/// Strict "HH:MM": the value ends up inside a root shell command.
pub fn valid_time(time: &str) -> bool {
    let b = time.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && [0, 1, 3, 4].iter().all(|&i| b[i].is_ascii_digit())
        && time[..2].parse::<u32>().is_ok_and(|h| h < 24)
        && time[3..].parse::<u32>().is_ok_and(|m| m < 60)
}

fn read_schedule() -> Result<WakeSchedule, String> {
    let out = Command::new("/usr/bin/pmset")
        .args(["-g", "sched"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(parse_schedule(&String::from_utf8_lossy(&out.stdout)))
}

#[tauri::command]
pub async fn get_wake_schedule() -> Result<WakeSchedule, String> {
    read_schedule()
}

/// Turns the daily wake on at `time` ("HH:MM", every day) or off.
#[tauri::command]
pub async fn set_wake_schedule(enabled: bool, time: String) -> Result<WakeSchedule, String> {
    let command = if enabled {
        if !valid_time(&time) {
            return Err(format!("invalid time {time:?}, expected HH:MM"));
        }
        format!("/usr/bin/pmset repeat wakeorpoweron MTWRFSU {time}:00")
    } else {
        "/usr/bin/pmset repeat cancel".to_string()
    };
    let script = format!("do shell script \"{command}\" with administrator privileges");
    let out = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        // -128: the person pressed Cancel in the password dialog.
        return Err(if err.contains("-128") {
            "cancelled".to_string()
        } else {
            err.trim().to_string()
        });
    }
    read_schedule()
}

/// How long before the routine the Mac is woken, so it is up when the routine fires.
const LEAD_MINUTES: u32 = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineWake {
    /// "HH:MM": a few minutes before `routine_time`.
    pub time: String,
    /// The routine the Mac is woken for, and its time.
    pub routine_name: String,
    pub routine_time: String,
}

/// Minutes after midnight of an enabled daily routine, with its name.
fn daily_times(routines: &serde_json::Value) -> Vec<(u32, String)> {
    let mut out = Vec::new();
    for r in routines["routines"].as_array().into_iter().flatten() {
        if r["enabled"] != serde_json::Value::Bool(true) || r["schedule"]["type"] != "daily" {
            continue;
        }
        let Some(time) = r["schedule"]["time"].as_str().filter(|t| valid_time(t)) else {
            continue;
        };
        let minutes = time[..2].parse::<u32>().unwrap() * 60 + time[3..].parse::<u32>().unwrap();
        out.push((minutes, r["name"].as_str().unwrap_or("?").to_string()));
    }
    out.sort();
    out
}

/// Night runs end before this (bl3q `ngu_may.sh` stops trying to sleep at 06:00).
const NIGHT_END_MINUTES: u32 = 6 * 60;

/// bl3q `ngu_may.sh` puts the Mac to sleep after the night's runs
/// (00:00–06:00); the rest of the day it stays awake. So the routine that
/// needs a wake is the first one after the last night run (the 09:00 run
/// after the 00:00 one), or the earliest one when nothing runs at night.
pub fn routine_wake(routines: &serde_json::Value) -> Option<RoutineWake> {
    let times = daily_times(routines);
    let last_night = times.iter().rposition(|(m, _)| *m < NIGHT_END_MINUTES);
    let (at, name) = match last_night {
        Some(i) => times.get(i + 1).or(times.first())?,
        None => times.first()?,
    };
    let wake = (at + 24 * 60 - LEAD_MINUTES) % (24 * 60);
    Some(RoutineWake {
        time: format!("{:02}:{:02}", wake / 60, wake % 60),
        routine_name: name.clone(),
        routine_time: format!("{:02}:{:02}", at / 60, at % 60),
    })
}

/// The wake time the OpenMausBot routines need, or None when none is daily.
#[tauri::command]
pub async fn get_routine_wake() -> Result<Option<RoutineWake>, String> {
    let token_path = dirs::home_dir()
        .ok_or("no home directory")?
        .join(".atelier/openmausbot/secrets/omb-client-token");
    let token = std::fs::read_to_string(&token_path)
        .map_err(|_| "cannot read the OpenMausBot client token".to_string())?;
    let body: serde_json::Value = reqwest::Client::new()
        .get("http://127.0.0.1:28799/api/routines")
        .bearer_auth(token.trim())
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("OpenMausBot: {}", e.status().map_or("not reachable".into(), |s| s.to_string())))?
        .json()
        .await
        .map_err(|_| "OpenMausBot: unreadable routines".to_string())?;
    Ok(routine_wake(&body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_daily_wake() {
        let out = "Repeating power events:\n  wakepoweron at 8:55AM every day\nScheduled power events:\n [0]  wake at 11/21/2026 00:44:41 by 'com.apple.x'\n";
        assert_eq!(
            parse_schedule(out),
            WakeSchedule {
                enabled: true,
                time: Some("08:55".into()),
                raw: Some("wakepoweron at 8:55AM every day".into()),
            }
        );
    }

    #[test]
    fn one_off_system_wakes_are_not_the_switch() {
        let out = "Scheduled power events:\n [0]  wake at 11/20/2026 23:45:49 by 'com.apple.alarm'\n";
        assert!(!parse_schedule(out).enabled);
    }

    #[test]
    fn a_repeating_shutdown_alone_is_not_a_wake() {
        let out = "Repeating power events:\n  shutdown at 11:00PM every day\n";
        assert!(!parse_schedule(out).enabled);
    }

    #[test]
    fn clock_conversion() {
        assert_eq!(to_24h("12:05AM").as_deref(), Some("00:05"));
        assert_eq!(to_24h("12:30PM").as_deref(), Some("12:30"));
        assert_eq!(to_24h("1:30PM").as_deref(), Some("13:30"));
        assert_eq!(to_24h("8:55").as_deref(), Some("08:55"));
    }

    fn routines(list: &[(&str, &str, bool)]) -> serde_json::Value {
        serde_json::json!({ "routines": list.iter().map(|(name, time, enabled)| serde_json::json!({
            "name": name, "enabled": enabled, "schedule": { "type": "daily", "time": time },
        })).collect::<Vec<_>>() })
    }

    #[test]
    fn wakes_before_the_first_routine_after_the_night_runs() {
        let r = routines(&[
            ("cos 21", "21:00", true),
            ("cos 10", "10:00", true),
            ("gom 20", "20:00", true),
            ("bl3q 09", "09:00", true),
            ("bl3q 00", "00:00", true),
        ]);
        let w = routine_wake(&r).unwrap();
        assert_eq!((w.time.as_str(), w.routine_name.as_str()), ("08:55", "bl3q 09"));
    }

    #[test]
    fn disabled_and_non_daily_routines_do_not_count() {
        let mut r = routines(&[("a", "09:00", true), ("off", "05:00", false)]);
        r["routines"].as_array_mut().unwrap().push(serde_json::json!({
            "name": "weekly", "enabled": true, "schedule": { "type": "weekly", "time": "04:00" },
        }));
        assert_eq!(routine_wake(&r).unwrap().time, "08:55");
        assert_eq!(routine_wake(&routines(&[])), None);
    }

    #[test]
    fn without_night_runs_the_earliest_routine_counts() {
        let r = routines(&[("b", "10:00", true), ("a", "07:30", true)]);
        assert_eq!(routine_wake(&r).unwrap().time, "07:25");
    }

    #[test]
    fn only_night_runs_wrap_back_to_the_first() {
        let r = routines(&[("late", "00:03", true)]);
        assert_eq!(routine_wake(&r).unwrap().time, "23:58");
    }

    #[test]
    fn time_must_be_strict() {
        assert!(valid_time("08:55"));
        assert!(!valid_time("8:55"));
        assert!(!valid_time("24:00"));
        assert!(!valid_time("08:55\"; rm"));
        assert!(!valid_time("08:5x"));
    }
}
