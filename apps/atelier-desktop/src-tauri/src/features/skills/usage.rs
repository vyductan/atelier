//! Counts how often each skill is used, from the agents' own history:
//!
//! - Claude Code: `~/.claude/projects/*/*.jsonl` transcripts. A `Skill` tool
//!   call is the model loading a skill; `<command-name>/x</command-name>` in a
//!   user turn is the user typing a slash command.
//! - Antigravity: `~/.gemini/antigravity/conversations/*.db` (SQLite, one per
//!   conversation). A `view_file` of `.../skills/<name>/SKILL.md` (step type 15)
//!   is the agent loading a skill; "requested you read and use the "x" skill"
//!   (step type 14) is the user asking for one. Older `.pb` conversations are
//!   encrypted and cannot be read.
//!
//! Scanning is incremental: transcripts are append-only, so each file resumes
//! from the last complete line it read; a conversation database is rescanned
//! only when its size or mtime changes. The cache lives in
//! `~/.atelier/cache/skill-usage.json`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

const CACHE_VERSION: u32 = 1;
const DAY_SECS: i64 = 24 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UsageKind {
    ClaudeAuto,
    ClaudeSlash,
    AntigravityLoad,
    AntigravityRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageEvent {
    pub skill: String,
    pub kind: UsageKind,
    /// Unix seconds; 0 when the source carried no timestamp.
    pub ts: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct FileEntry {
    size: u64,
    mtime: i64,
    /// Byte offset just past the last complete line read (transcripts only).
    offset: u64,
    events: Vec<UsageEvent>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Cache {
    version: u32,
    files: HashMap<String, FileEntry>,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsage {
    pub name: String,
    pub claude_auto: u32,
    pub claude_slash: u32,
    pub antigravity_load: u32,
    pub antigravity_request: u32,
    pub total: u32,
    pub last_30_days: u32,
    /// RFC 3339, or None when no event carried a timestamp.
    pub last_used: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageReport {
    pub skills: Vec<SkillUsage>,
    /// Earliest event seen, so the UI can say how far back counts go.
    pub since: Option<String>,
    pub scanned_files: usize,
}

// ---------------------------------------------------------------- parsing --

/// Plugin skills are invoked as `plugin:skill`; installed skills are listed by
/// the bare name, so usage is keyed by the part after the last colon.
fn normalize_skill(name: &str) -> Option<String> {
    let name = name.trim().trim_start_matches('/');
    let name = name.rsplit(':').next().unwrap_or(name);
    (!name.is_empty()).then(|| name.to_string())
}

fn parse_rfc3339(ts: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|t| t.timestamp())
        .unwrap_or(0)
}

/// Events from one transcript line. Cheap substring checks run first because
/// almost no line mentions a skill and the files total gigabytes.
pub fn parse_transcript_line(line: &str) -> Vec<UsageEvent> {
    let has_tool = line.contains("\"Skill\"");
    let has_command = line.contains("<command-name>");
    if !has_tool && !has_command {
        return Vec::new();
    }
    let Ok(record) = serde_json::from_str::<serde_json::Value>(line) else {
        return Vec::new();
    };
    let ts = record
        .get("timestamp")
        .and_then(|t| t.as_str())
        .map_or(0, parse_rfc3339);
    let content = record.pointer("/message/content");
    let mut events = Vec::new();

    match record.get("type").and_then(|t| t.as_str()) {
        Some("assistant") if has_tool => {
            for part in content.and_then(|c| c.as_array()).into_iter().flatten() {
                let is_skill_call = part.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                    && part.get("name").and_then(|n| n.as_str()) == Some("Skill");
                if !is_skill_call {
                    continue;
                }
                if let Some(skill) = part
                    .pointer("/input/skill")
                    .and_then(|s| s.as_str())
                    .and_then(normalize_skill)
                {
                    events.push(UsageEvent { skill, kind: UsageKind::ClaudeAuto, ts });
                }
            }
        }
        Some("user") if has_command => {
            let text = match content {
                Some(serde_json::Value::String(text)) => text.clone(),
                Some(serde_json::Value::Array(parts)) => parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join(" "),
                _ => String::new(),
            };
            let mut rest = text.as_str();
            while let Some(start) = rest.find("<command-name>") {
                rest = &rest[start + "<command-name>".len()..];
                let Some(end) = rest.find("</command-name>") else { break };
                if let Some(skill) = normalize_skill(&rest[..end]) {
                    events.push(UsageEvent { skill, kind: UsageKind::ClaudeSlash, ts });
                }
                rest = &rest[end..];
            }
        }
        _ => {}
    }

    events
}

fn find_bytes(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

/// Skill name from `.../skills/<name>/SKILL.md`.
fn skill_from_path(path: &str) -> Option<String> {
    let dir = path.strip_suffix("/SKILL.md")?;
    let (parent, name) = dir.rsplit_once('/')?;
    (parent.ends_with("/skills") || parent == "skills")
        .then(|| normalize_skill(name))
        .flatten()
}

/// Skills loaded by a type-15 step payload: `view_file` calls whose
/// `AbsolutePath` is a SKILL.md. Other tools touching a SKILL.md (edits,
/// searches) are not uses.
pub fn parse_antigravity_loads(payload: &[u8]) -> Vec<String> {
    const KEY: &[u8] = b"\"AbsolutePath\":\"";
    let mut skills = Vec::new();
    let mut cursor = 0;
    while let Some(at) = find_bytes(payload, KEY, cursor) {
        let start = at + KEY.len();
        let Some(len) = payload[start..].iter().position(|b| *b == b'"') else { break };
        cursor = start + len;
        // The tool name sits in the protobuf fields just before the JSON args.
        let before = &payload[at.saturating_sub(64)..at];
        if find_bytes(before, b"view_file", 0).is_none() {
            continue;
        }
        if let Some(skill) = std::str::from_utf8(&payload[start..cursor])
            .ok()
            .and_then(skill_from_path)
        {
            skills.push(skill);
        }
    }
    skills
}

/// Skills the user asked for in a type-14 step.
pub fn parse_antigravity_requests(payload: &[u8]) -> Vec<String> {
    const PREFIX: &[u8] = b"read and use the \"";
    let mut skills = Vec::new();
    let mut cursor = 0;
    while let Some(at) = find_bytes(payload, PREFIX, cursor) {
        let start = at + PREFIX.len();
        let Some(len) = payload[start..].iter().position(|b| *b == b'"') else { break };
        cursor = start + len;
        if payload[cursor..].starts_with(b"\" skill") {
            if let Some(skill) = std::str::from_utf8(&payload[start..cursor])
                .ok()
                .and_then(normalize_skill)
            {
                skills.push(skill);
            }
        }
    }
    skills
}

/// Step metadata opens with a protobuf Timestamp: field 1 (`0a len`) holding
/// field 1 seconds (`08 varint`).
pub fn parse_step_timestamp(metadata: &[u8]) -> i64 {
    if metadata.len() < 4 || metadata[0] != 0x0a || metadata[2] != 0x08 {
        return 0;
    }
    let mut value: i64 = 0;
    let mut shift = 0;
    for byte in metadata.iter().skip(3).take(10) {
        value |= i64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return value;
        }
        shift += 7;
    }
    0
}

// --------------------------------------------------------------- scanning --

fn file_stamp(path: &Path) -> Option<(u64, i64)> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    Some((meta.len(), mtime))
}

fn scan_transcript(path: &Path, entry: &mut FileEntry, size: u64, mtime: i64) {
    // A file that shrank was rewritten; anything else is an append.
    if size < entry.offset {
        *entry = FileEntry::default();
    }
    let Ok(mut file) = std::fs::File::open(path) else { return };
    if file.seek(SeekFrom::Start(entry.offset)).is_err() {
        return;
    }
    let mut reader = BufReader::new(file);
    let mut offset = entry.offset;
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                // A line without its newline is still being written; reread it next time.
                if !line.ends_with('\n') {
                    break;
                }
                offset += read as u64;
                entry.events.extend(parse_transcript_line(&line));
            }
        }
    }
    entry.offset = offset;
    entry.size = size;
    entry.mtime = mtime;
}

fn open_conversation(path: &Path) -> Option<rusqlite::Connection> {
    use rusqlite::OpenFlags;
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI;
    // Read-only sees steps still in the WAL; `immutable` is the fallback when
    // the WAL index cannot be opened, at the cost of missing those.
    let readable = |c: &rusqlite::Connection| {
        c.query_row("select count(*) from steps", [], |_| Ok(())).is_ok()
    };
    rusqlite::Connection::open_with_flags(path, flags)
        .ok()
        .filter(readable)
        .or_else(|| {
            let uri = format!("file:{}?immutable=1", path.display());
            rusqlite::Connection::open_with_flags(uri, flags).ok()
        })
}

fn scan_conversation(path: &Path) -> Vec<UsageEvent> {
    let Some(conn) = open_conversation(path) else { return Vec::new() };
    let Ok(mut stmt) = conn.prepare(
        "select step_type, metadata, step_payload from steps \
         where step_type in (14, 15) \
           and (instr(step_payload, cast('SKILL.md' as blob)) > 0 \
             or instr(step_payload, cast('read and use the' as blob)) > 0)",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<Vec<u8>>>(1)?.unwrap_or_default(),
            row.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default(),
        ))
    });
    let Ok(rows) = rows else { return Vec::new() };

    let mut events = Vec::new();
    for (step_type, metadata, payload) in rows.flatten() {
        let ts = parse_step_timestamp(&metadata);
        let (kind, skills) = match step_type {
            15 => (UsageKind::AntigravityLoad, parse_antigravity_loads(&payload)),
            14 => (UsageKind::AntigravityRequest, parse_antigravity_requests(&payload)),
            _ => continue,
        };
        events.extend(skills.into_iter().map(|skill| UsageEvent { skill, kind, ts }));
    }
    events
}

fn cache_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".atelier")
        .join("cache")
        .join("skill-usage.json")
}

fn load_cache() -> Cache {
    std::fs::read_to_string(cache_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Cache>(&s).ok())
        .filter(|c| c.version == CACHE_VERSION)
        .unwrap_or(Cache { version: CACHE_VERSION, ..Default::default() })
}

fn save_cache(cache: &Cache) {
    let path = cache_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(cache) {
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(tmp, path);
        }
    }
}

fn list_files(dir: &Path, min_depth: usize, max_depth: usize, ext: &str) -> Vec<PathBuf> {
    walkdir::WalkDir::new(dir)
        .min_depth(min_depth)
        .max_depth(max_depth)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == ext))
        .map(|e| e.into_path())
        .collect()
}

pub fn aggregate(events: impl Iterator<Item = UsageEvent>, now: i64) -> (Vec<SkillUsage>, Option<i64>) {
    let mut by_skill: BTreeMap<String, SkillUsage> = BTreeMap::new();
    let mut last: HashMap<String, i64> = HashMap::new();
    let mut earliest: Option<i64> = None;

    for event in events {
        let usage = by_skill.entry(event.skill.clone()).or_insert_with(|| SkillUsage {
            name: event.skill.clone(),
            ..Default::default()
        });
        match event.kind {
            UsageKind::ClaudeAuto => usage.claude_auto += 1,
            UsageKind::ClaudeSlash => usage.claude_slash += 1,
            UsageKind::AntigravityLoad => usage.antigravity_load += 1,
            UsageKind::AntigravityRequest => usage.antigravity_request += 1,
        }
        // An Antigravity request is followed by the load it triggers; count the use once.
        if event.kind != UsageKind::AntigravityRequest {
            usage.total += 1;
            if event.ts > 0 && now - event.ts <= 30 * DAY_SECS {
                usage.last_30_days += 1;
            }
        }
        if event.ts > 0 {
            let seen = last.entry(event.skill.clone()).or_insert(0);
            *seen = (*seen).max(event.ts);
            earliest = Some(earliest.map_or(event.ts, |e| e.min(event.ts)));
        }
    }

    let to_rfc3339 = |ts: i64| {
        chrono::DateTime::from_timestamp(ts, 0).map(|t| t.to_rfc3339())
    };
    let skills = by_skill
        .into_values()
        .map(|mut usage| {
            usage.last_used = last.get(&usage.name).copied().and_then(to_rfc3339);
            usage
        })
        .collect();
    (skills, earliest)
}

/// Scans new history and returns per-skill usage. Blocking; run off the async runtime.
pub fn collect() -> SkillUsageReport {
    let home = dirs::home_dir().unwrap_or_default();
    let mut cache = load_cache();
    let mut seen = HashSet::new();

    // Depth 2 is a session transcript; subagents write theirs under
    // `<session>/subagents/` (depth 4) and workflow agents under
    // `<session>/subagents/workflows/<run>/` (depth 6). Their skill calls count too.
    for path in list_files(&home.join(".claude/projects"), 2, 6, "jsonl") {
        let Some((size, mtime)) = file_stamp(&path) else { continue };
        let key = path.display().to_string();
        let entry = cache.files.entry(key.clone()).or_default();
        if entry.size != size || entry.mtime != mtime {
            scan_transcript(&path, entry, size, mtime);
        }
        seen.insert(key);
    }

    for path in list_files(&home.join(".gemini/antigravity/conversations"), 1, 1, "db") {
        // The WAL holds the newest steps, so it counts toward "changed".
        let wal = PathBuf::from(format!("{}-wal", path.display()));
        let Some((db_size, db_mtime)) = file_stamp(&path) else { continue };
        let (wal_size, wal_mtime) = file_stamp(&wal).unwrap_or((0, 0));
        let (size, mtime) = (db_size + wal_size, db_mtime.max(wal_mtime));
        let key = path.display().to_string();
        let entry = cache.files.entry(key.clone()).or_default();
        if entry.size != size || entry.mtime != mtime {
            *entry = FileEntry { size, mtime, offset: 0, events: scan_conversation(&path) };
        }
        seen.insert(key);
    }

    // Deleted transcripts and conversations take their counts with them.
    cache.files.retain(|key, _| seen.contains(key));
    save_cache(&cache);

    let now = chrono::Utc::now().timestamp();
    let (skills, earliest) = aggregate(
        cache.files.values().flat_map(|f| f.events.iter().cloned()),
        now,
    );
    SkillUsageReport {
        skills,
        since: earliest.and_then(|ts| chrono::DateTime::from_timestamp(ts, 0)).map(|t| t.to_rfc3339()),
        scanned_files: cache.files.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_skill_tool_calls() {
        let line = r#"{"type":"assistant","timestamp":"2026-10-06T10:00:00Z","message":{"content":[{"type":"text","text":"hi"},{"type":"tool_use","id":"t1","name":"Skill","input":{"skill":"archify"}},{"type":"tool_use","id":"t2","name":"Skill","input":{"skill":"anthropic-skills:docs"}}]}}"#;
        let events = parse_transcript_line(line);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], UsageEvent { skill: "archify".into(), kind: UsageKind::ClaudeAuto, ts: 1_791_280_800 });
        assert_eq!(events[1].skill, "docs");
    }

    #[test]
    fn parses_claude_slash_commands_in_string_and_array_content() {
        let as_string = r#"{"type":"user","timestamp":"2026-09-18T00:00:00Z","message":{"content":"<command-name>/grill-with-docs</command-name><command-args></command-args>"}}"#;
        let as_array = r#"{"type":"user","message":{"content":[{"type":"text","text":"<command-name>/implement</command-name>"}]}}"#;
        assert_eq!(parse_transcript_line(as_string)[0].skill, "grill-with-docs");
        assert_eq!(parse_transcript_line(as_string)[0].kind, UsageKind::ClaudeSlash);
        let events = parse_transcript_line(as_array);
        assert_eq!((events[0].skill.as_str(), events[0].ts), ("implement", 0));
    }

    #[test]
    fn ignores_other_tools_and_mentions_in_plain_text() {
        let other_tool = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/x/Skill"}}]}}"#;
        let text_mention = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"use the \"Skill\" tool"}]}}"#;
        let tool_result = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"\"Skill\" <command-name>/x</command-name>"}]}}"#;
        assert!(parse_transcript_line(other_tool).is_empty());
        assert!(parse_transcript_line(text_mention).is_empty());
        // Only `text` parts are scanned, so a pasted transcript in a tool result is not a use.
        assert!(parse_transcript_line(tool_result).is_empty());
        assert!(parse_transcript_line("not json \"Skill\"").is_empty());
    }

    #[test]
    fn parses_antigravity_view_file_loads_only() {
        let payload = b"\x12\x0ccall_1149296\x1a\tview_file\"{\"AbsolutePath\":\"/Users/me/.gemini/config/skills/to-spec/SKILL.md\",\"toolAction\":\"View\"}";
        assert_eq!(parse_antigravity_loads(payload), vec!["to-spec"]);
        let edit = b"\x1a\rwrite_to_file\"{\"AbsolutePath\":\"/Users/me/.agents/skills/tdd/SKILL.md\"}";
        assert!(parse_antigravity_loads(edit).is_empty());
        let not_skill = b"\x1a\tview_file\"{\"AbsolutePath\":\"/repo/docs/SKILL.md\"}";
        assert!(parse_antigravity_loads(not_skill).is_empty());
    }

    #[test]
    fn parses_antigravity_requests() {
        let payload = b"The user has requested you read and use the \"to-spec\" skill. The path";
        assert_eq!(parse_antigravity_requests(payload), vec!["to-spec"]);
        assert!(parse_antigravity_requests(b"read and use the \"x\" file").is_empty());
    }

    #[test]
    fn decodes_step_timestamps() {
        // Captured from a real step: 2026-09-18 14:27:54 UTC.
        let metadata = [0x0a, 0x0c, 0x08, 0xea, 0x94, 0xb5, 0xd5, 0x06, 0x10, 0xc0];
        assert_eq!(parse_step_timestamp(&metadata), 1_789_741_674);
        assert_eq!(parse_step_timestamp(&[0x12, 0x00]), 0);
        assert_eq!(parse_step_timestamp(&[]), 0);
    }

    #[test]
    fn aggregates_counts_windows_and_last_use() {
        let now = 1_800_000_000;
        let ev = |skill: &str, kind, ts| UsageEvent { skill: skill.into(), kind, ts };
        let (skills, earliest) = aggregate(
            vec![
                ev("tdd", UsageKind::ClaudeAuto, now - 40 * DAY_SECS),
                ev("tdd", UsageKind::ClaudeSlash, now - DAY_SECS),
                ev("tdd", UsageKind::AntigravityRequest, now - 2 * DAY_SECS),
                ev("tdd", UsageKind::AntigravityLoad, now - 2 * DAY_SECS),
                ev("pr", UsageKind::ClaudeAuto, 0),
            ]
            .into_iter(),
            now,
        );
        let tdd = skills.iter().find(|s| s.name == "tdd").unwrap();
        assert_eq!((tdd.claude_auto, tdd.claude_slash, tdd.antigravity_load, tdd.antigravity_request), (1, 1, 1, 1));
        // The request and the load it triggered are one use.
        assert_eq!(tdd.total, 3);
        assert_eq!(tdd.last_30_days, 2);
        assert_eq!(tdd.last_used.as_deref(), chrono::DateTime::from_timestamp(now - DAY_SECS, 0).map(|t| t.to_rfc3339()).as_deref());
        let pr = skills.iter().find(|s| s.name == "pr").unwrap();
        assert_eq!((pr.total, pr.last_30_days, pr.last_used.clone()), (1, 0, None));
        assert_eq!(earliest, Some(now - 40 * DAY_SECS));
    }

    #[test]
    fn resumes_transcripts_from_the_last_complete_line() {
        let dir = std::env::temp_dir().join(format!("atelier-usage-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let call = |skill: &str| format!(r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"Skill","input":{{"skill":"{skill}"}}}}]}}}}"#);

        std::fs::write(&path, format!("{}\n{}", call("a"), call("b"))).unwrap();
        let mut entry = FileEntry::default();
        let (size, mtime) = file_stamp(&path).unwrap();
        scan_transcript(&path, &mut entry, size, mtime);
        // "b" has no trailing newline yet, so it is left for the next scan.
        assert_eq!(entry.events.iter().map(|e| e.skill.as_str()).collect::<Vec<_>>(), vec!["a"]);

        std::fs::write(&path, format!("{}\n{}\n{}\n", call("a"), call("b"), call("c"))).unwrap();
        let (size, mtime) = file_stamp(&path).unwrap();
        scan_transcript(&path, &mut entry, size, mtime);
        assert_eq!(entry.events.iter().map(|e| e.skill.as_str()).collect::<Vec<_>>(), vec!["a", "b", "c"]);

        std::fs::write(&path, format!("{}\n", call("z"))).unwrap();
        let (size, mtime) = file_stamp(&path).unwrap();
        scan_transcript(&path, &mut entry, size, mtime);
        assert_eq!(entry.events.iter().map(|e| e.skill.as_str()).collect::<Vec<_>>(), vec!["z"]);
        let _ = std::fs::remove_dir_all(dir);
    }
}

