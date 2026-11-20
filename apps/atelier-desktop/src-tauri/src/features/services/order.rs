use serde::{Deserialize, Serialize};

use super::registry::atelier_dir;

/// Display order chosen by drag and drop. Kept out of services.yaml because
/// rewriting the YAML would drop the user's comments. Ids or groups missing
/// here (new entries) fall back to their services.yaml order in the UI.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServicesOrder {
    #[serde(default)]
    pub groups: Vec<String>,
    #[serde(default)]
    pub services: Vec<String>,
}

fn order_path() -> std::path::PathBuf {
    atelier_dir().join("services-order.json")
}

/// A missing or unreadable file is "no custom order", not an error.
pub fn load() -> ServicesOrder {
    std::fs::read_to_string(order_path())
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

pub fn save(order: &ServicesOrder) -> Result<(), String> {
    let path = order_path();
    std::fs::create_dir_all(atelier_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(order).map_err(|e| e.to_string())?;
    // Write then rename, so a crash mid-write never leaves half a file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_default_to_empty() {
        let order: ServicesOrder = serde_json::from_str(r#"{"groups":["nlabs"]}"#).unwrap();
        assert_eq!(order, ServicesOrder { groups: vec!["nlabs".into()], services: vec![] });
    }
}
