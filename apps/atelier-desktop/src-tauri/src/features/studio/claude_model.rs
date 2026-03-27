use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeCapabilities {
    pub(crate) models: Vec<ClaudeModelCapability>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeModelCapability {
    pub(crate) base_model: String,
    pub(crate) options: Vec<ClaudeContextWindowOption>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeContextWindowOption {
    pub(crate) value: String,
    pub(crate) is_default: Option<bool>,
}

fn claude_model_capabilities_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/lib/claude-model-capabilities.json")
}

pub(crate) fn load_claude_model_capabilities() -> Result<ClaudeCapabilities, String> {
    let path = claude_model_capabilities_path();
    let json = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read Claude model capabilities {:?}: {}", path, error))?;

    serde_json::from_str(&json)
        .map_err(|error| format!("Failed to parse Claude model capabilities {:?}: {}", path, error))
}

pub(crate) fn format_claude_model(base_model: &str, context_window: &str) -> Result<String, String> {
    let base_model = base_model.trim();
    let context_window = context_window.trim();

    if base_model.is_empty() {
        return Err("Claude model is required".to_string());
    }

    if base_model.contains('[') && base_model.ends_with(']') {
        return Ok(base_model.to_string());
    }

    let capabilities = load_claude_model_capabilities()?;
    let model = capabilities
        .models
        .iter()
        .find(|model| model.base_model == base_model)
        .ok_or_else(|| format!("Unsupported Claude model: {base_model}"))?;

    let option = model
        .options
        .iter()
        .find(|option| option.value == context_window)
        .ok_or_else(|| {
            format!(
                "Unsupported Claude context window '{context_window}' for model '{base_model}'"
            )
        })?;

    if option.is_default.unwrap_or(false) || context_window == "default" {
        Ok(base_model.to_string())
    } else {
        Ok(format!("{base_model}[{context_window}]"))
    }
}

pub(crate) fn supports_multiple_context_windows(base_model: &str) -> bool {
    load_claude_model_capabilities()
        .ok()
        .and_then(|capabilities| {
            capabilities
                .models
                .into_iter()
                .find(|model| model.base_model == base_model)
        })
        .is_some_and(|model| model.options.len() > 1)
}

pub(crate) fn default_context_window(base_model: &str) -> Option<&'static str> {
    let capabilities = load_claude_model_capabilities().ok()?;
    let model = capabilities
        .models
        .into_iter()
        .find(|model| model.base_model == base_model)?;

    model
        .options
        .iter()
        .find(|option| option.is_default.unwrap_or(false))
        .map(|_| "default")
}

#[cfg(test)]
mod tests {
    use super::{
        default_context_window, format_claude_model, load_claude_model_capabilities,
        supports_multiple_context_windows,
    };

    #[test]
    fn load_claude_model_capabilities_reads_shared_json_resource() {
        let capabilities =
            load_claude_model_capabilities().expect("shared Claude model capabilities should load");

        assert!(capabilities
            .models
            .iter()
            .any(|model| model.base_model == "claude-opus-4-6"));
    }

    #[test]
    fn format_claude_model_leaves_default_context_window_unsuffixed() {
        assert_eq!(
            format_claude_model("claude-opus-4-6", "default").as_deref(),
            Ok("claude-opus-4-6")
        );
    }

    #[test]
    fn format_claude_model_adds_suffix_for_one_million_context_window() {
        assert_eq!(
            format_claude_model("claude-opus-4-6", "1m").as_deref(),
            Ok("claude-opus-4-6[1m]")
        );
    }

    #[test]
    fn format_claude_model_rejects_unsupported_base_model_context_window_combinations() {
        assert!(format_claude_model("claude-opus-4-6", "200k").is_err());
        assert!(format_claude_model("claude-sonnet-4-5", "1m").is_err());
    }

    #[test]
    fn format_claude_model_preserves_exact_full_model_ids_without_alias_rewriting() {
        assert_eq!(
            format_claude_model("claude-opus-4-6[1m]", "default").as_deref(),
            Ok("claude-opus-4-6[1m]")
        );
    }

    #[test]
    fn claude_model_helpers_expose_context_window_support_metadata() {
        assert!(supports_multiple_context_windows("claude-opus-4-6"));
        assert_eq!(default_context_window("claude-opus-4-6"), Some("default"));
        assert!(!supports_multiple_context_windows("claude-sonnet-4-5"));
        assert_eq!(default_context_window("claude-sonnet-4-5"), None);
    }
}
