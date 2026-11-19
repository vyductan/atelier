//! Front matter of skill and command files: the description agents read to
//! decide when to load a skill, plus whatever else the author declared
//! (version, license, allowed-tools, argument-hint, …).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_yaml::Value;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub description: Option<String>,
    /// Other front-matter fields, flattened (`metadata.version` → `version`), in file order.
    pub fields: Vec<(String, String)>,
}

/// A skill folder means its `SKILL.md`; anything else must be a Markdown file.
fn manifest_path(path: &Path) -> Option<PathBuf> {
    if path.is_dir() {
        return Some(path.join("SKILL.md"));
    }
    (path.extension()? == "md").then(|| path.to_path_buf())
}

fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.trim().to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::Sequence(items) => {
            let parts: Vec<_> = items.iter().filter_map(scalar).collect();
            (!parts.is_empty()).then(|| parts.join(", "))
        }
        _ => None,
    }
}

fn flatten(map: &serde_yaml::Mapping, fields: &mut Vec<(String, String)>) {
    for (key, value) in map {
        let Some(key) = key.as_str() else { continue };
        if matches!(key, "name" | "description") {
            continue;
        }
        if let Value::Mapping(inner) = value {
            flatten(inner, fields);
        } else if let Some(text) = scalar(value).filter(|t| !t.is_empty()) {
            fields.push((key.to_string(), text));
        }
    }
}

/// Parses the `---` block at the top of a Markdown file.
pub fn parse(text: &str) -> SkillMeta {
    let text = text.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---") else {
        return SkillMeta::default();
    };
    let Some(end) = rest.find("\n---") else {
        return SkillMeta::default();
    };
    let Ok(Value::Mapping(map)) = serde_yaml::from_str::<Value>(&rest[..end]) else {
        return SkillMeta::default();
    };
    let mut fields = Vec::new();
    flatten(&map, &mut fields);
    SkillMeta {
        description: map
            .get("description")
            .and_then(scalar)
            .filter(|d| !d.is_empty()),
        fields,
    }
}

/// Front matter for each path (skill folder or `.md` file); unreadable ones are left out.
#[tauri::command]
pub async fn get_skill_meta(paths: Vec<String>) -> Result<HashMap<String, SkillMeta>, String> {
    tokio::task::spawn_blocking(move || {
        paths
            .into_iter()
            .filter_map(|path| {
                let text = fs::read_to_string(manifest_path(Path::new(&path))?).ok()?;
                Some((path, parse(&text)))
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_description_and_flattens_the_rest() {
        let meta = parse(
            "---\nname: archify\ndescription: Draw diagrams.\nlicense: MIT\nmetadata:\n  version: \"2.17\"\n  author: tt\nallowed-tools: [Read, Bash]\n---\n# Body\n",
        );
        assert_eq!(meta.description.as_deref(), Some("Draw diagrams."));
        assert_eq!(
            meta.fields,
            [
                ("license".into(), "MIT".into()),
                ("version".into(), "2.17".into()),
                ("author".into(), "tt".into()),
                ("allowed-tools".into(), "Read, Bash".into()),
            ]
        );
    }

    #[test]
    fn no_front_matter_means_nothing() {
        assert_eq!(parse("# Just a heading\n"), SkillMeta::default());
        assert_eq!(parse("---\nnot: [closed\n---\n"), SkillMeta::default());
        assert_eq!(parse("---\ndescription: open forever\n"), SkillMeta::default());
    }

    #[test]
    fn only_markdown_or_skill_folders_are_read() {
        assert_eq!(manifest_path(Path::new("/x/notes.txt")), None);
        assert_eq!(manifest_path(Path::new("/x/cmd.md")), Some(PathBuf::from("/x/cmd.md")));
    }
}
