//! One-time migration from the pre-rename installation.
//!
//! The product was renamed, and the app identifier changed with it, so the
//! config directory moved. Without this module every upgrading installation
//! would look empty: no settings, no subscriptions, no logs.
//!
//! The migration copies rather than moves, and only when the new directory has
//! no settings file yet. A copy leaves the old install runnable while the
//! operator checks the new build; the old directory can be removed later by
//! hand.

use std::fs;
use std::path::{Path, PathBuf};

/// Identifier the app used before the rename.
///
/// Spelled in one place so a future rename only has to change this constant.
const PREVIOUS_IDENTIFIER: &str = "com.flowproxy.desktop";
const SETTINGS_FILE_NAME: &str = "settings.json";

/// Outcome of a migration attempt, for logging.
#[derive(Debug, Eq, PartialEq)]
pub enum MigrationOutcome {
    /// Nothing to do: the new directory already holds settings.
    NotNeeded,
    /// There was no previous installation to copy from.
    NoPreviousInstallation,
    /// Settings were copied across.
    Copied { files: usize },
    /// The copy failed; the caller logs it and continues with defaults.
    Failed(String),
}

/// Copies the previous config directory into `target` when it is empty.
///
/// `legacy_directory` is the old identifier's config directory. The whole tree
/// is copied because subscriptions, the traffic ledger, the system-proxy
/// journal and the core version index all live under it.
pub fn migrate_config_directory(
    legacy_directory: Option<&Path>,
    target: &Path,
) -> MigrationOutcome {
    let Some(legacy) = legacy_directory else {
        return MigrationOutcome::NotNeeded;
    };
    if legacy == target || !legacy.is_dir() {
        return MigrationOutcome::NoPreviousInstallation;
    }
    // Only migrate into an untouched installation: a settings file in the new
    // directory means the operator already ran the renamed build.
    if target.join(SETTINGS_FILE_NAME).exists() {
        return MigrationOutcome::NotNeeded;
    }

    match copy_tree(legacy, target) {
        Ok(files) => MigrationOutcome::Copied { files },
        Err(error) => MigrationOutcome::Failed(error),
    }
}

/// Copies `source` into `target` recursively, creating directories as needed.
///
/// Existing files in `target` are left alone: this runs before anything writes
/// to the new directory, so a collision can only mean a partially migrated
/// tree from an interrupted run, and keeping the newer copy is the safer side.
fn copy_tree(source: &Path, target: &Path) -> Result<usize, String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("could not create {}: {error}", target.display()))?;

    let mut copied = 0;
    let entries = fs::read_dir(source).map_err(|error| {
        format!(
            "could not read the previous config directory {}: {error}",
            source.display()
        )
    })?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => return Err(format!("could not read a config entry: {error}")),
        };
        let path = entry.path();
        let destination = target.join(entry.file_name());
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => return Err(format!("could not inspect {}: {error}", path.display())),
        };

        if file_type.is_dir() {
            copied += copy_tree(&path, &destination)?;
        } else if file_type.is_file() {
            if destination.exists() {
                continue;
            }
            fs::copy(&path, &destination).map_err(|error| {
                format!(
                    "could not copy {} to {}: {error}",
                    path.display(),
                    destination.display()
                )
            })?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// The previous identifier's config directory, when it exists.
///
/// Tauri names a config directory after the bundle identifier, so the old path
/// is the platform's config base joined with the previous identifier.
pub fn previous_config_directory() -> Option<PathBuf> {
    let base = base_config_directory()?;
    let candidate = base.join(PREVIOUS_IDENTIFIER);
    candidate.is_dir().then_some(candidate)
}

fn base_config_directory() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(|home| {
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
            })
            .filter(|path| path.is_dir())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .filter(|path| path.is_dir())
    }
}

#[cfg(test)]
mod tests {
    use super::{migrate_config_directory, MigrationOutcome};
    use std::fs;

    /// Test fixture name: the constant itself, so the tests do not drift from
    /// the real identifier.
    const LEGACY: &str = super::PREVIOUS_IDENTIFIER;
    const CURRENT: &str = "com.example.current";

    #[test]
    fn copies_an_existing_tree_into_an_empty_target() {
        let root = tempfile::tempdir().expect("temporary directory");
        let legacy = root.path().join(LEGACY);
        fs::create_dir_all(legacy.join("mihomo").join("subscriptions")).expect("legacy tree");
        fs::write(legacy.join("settings.json"), r#"{"version":1}"#).expect("legacy settings");
        fs::write(
            legacy
                .join("mihomo")
                .join("subscriptions")
                .join("sub-a.yaml"),
            "proxies: []",
        )
        .expect("legacy subscription");
        let target = root.path().join(CURRENT);

        let outcome = migrate_config_directory(Some(&legacy), &target);

        assert_eq!(outcome, MigrationOutcome::Copied { files: 2 });
        assert!(target.join("settings.json").is_file());
        assert!(target
            .join("mihomo")
            .join("subscriptions")
            .join("sub-a.yaml")
            .is_file());
        // The source is left in place so the old build still runs.
        assert!(legacy.join("settings.json").is_file());
    }

    #[test]
    fn does_not_overwrite_an_installation_that_already_ran() {
        let root = tempfile::tempdir().expect("temporary directory");
        let legacy = root.path().join(LEGACY);
        let target = root.path().join(CURRENT);
        fs::create_dir_all(&legacy).expect("legacy");
        fs::create_dir_all(&target).expect("target");
        fs::write(legacy.join("settings.json"), "old").expect("legacy settings");
        fs::write(target.join("settings.json"), "new").expect("new settings");

        let outcome = migrate_config_directory(Some(&legacy), &target);

        assert_eq!(outcome, MigrationOutcome::NotNeeded);
        assert_eq!(
            fs::read_to_string(target.join("settings.json")).expect("read"),
            "new"
        );
    }

    #[test]
    fn a_missing_legacy_directory_is_not_an_error() {
        let root = tempfile::tempdir().expect("temporary directory");
        let target = root.path().join(CURRENT);

        let outcome = migrate_config_directory(Some(&root.path().join("gone")), &target);

        assert_eq!(outcome, MigrationOutcome::NoPreviousInstallation);
        assert!(!target.exists());
    }

    #[test]
    fn existing_files_in_the_target_are_kept() {
        let root = tempfile::tempdir().expect("temporary directory");
        let legacy = root.path().join(LEGACY);
        let target = root.path().join(CURRENT);
        fs::create_dir_all(&legacy).expect("legacy");
        fs::create_dir_all(&target).expect("target");
        fs::write(legacy.join("traffic.json"), "old").expect("legacy ledger");
        fs::write(target.join("traffic.json"), "new").expect("new ledger");

        migrate_config_directory(Some(&legacy), &target);

        assert_eq!(
            fs::read_to_string(target.join("traffic.json")).expect("read"),
            "new"
        );
    }

    #[test]
    fn the_previous_identifier_is_the_one_the_app_shipped_with() {
        // Guards against a careless rename: the constant must keep pointing at
        // the old install, not at the current identifier.
        assert_eq!(LEGACY, "com.flowproxy.desktop");
    }
}
