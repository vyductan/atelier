pub mod agent_toggle;
pub mod commands;
pub mod disable;
pub mod content;
pub mod meta;
pub mod plugins;
pub mod updates;
pub mod usage;

/// Tests that point HOME at a temp folder hold this, so they never overlap.
#[cfg(test)]
pub(crate) static TEST_HOME: std::sync::Mutex<()> = std::sync::Mutex::new(());
