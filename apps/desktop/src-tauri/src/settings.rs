use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) const SETTINGS_VERSION: u32 = 1;
pub(crate) const SETTINGS_FILE_NAME: &str = "settings.json";
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Theme {
    #[default]
    CyberFlow,
    WarmFlow,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloseBehavior {
    #[default]
    HideToTray,
    ExitApplication,
}

/// Interface language. `English` is the default so existing installations keep
/// their current appearance after the upgrade.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Language {
    #[default]
    English,
    SimplifiedChinese,
}

/// Core log verbosity written into every generated profile.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CoreLogLevel {
    Silent,
    Error,
    #[default]
    Warning,
    Info,
    Debug,
}

impl CoreLogLevel {
    #[allow(dead_code)] // Kept for settings fixtures and future profile writers.
    pub(crate) fn as_wire_value(self) -> &'static str {
        match self {
            Self::Silent => "silent",
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Info => "info",
            Self::Debug => "debug",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct DesktopSettings {
    pub version: u32,
    pub theme: Theme,
    pub close_behavior: CloseBehavior,
    /// Added after the first release. `#[serde(default)]` keeps older
    /// `settings.json` files loadable without a version bump.
    #[serde(default)]
    pub language: Language,
    /// Interface scale in percent. Stored as a plain integer so a hand-edited
    /// file cannot smuggle in a fractional value; the UI clamps it on load.
    #[serde(default = "default_ui_scale")]
    pub ui_scale: u32,
    /// Core log verbosity; written into the generated profile.
    #[serde(default)]
    pub log_level: CoreLogLevel,
    /// Whether the core may use IPv6 for outbound connections.
    #[serde(default)]
    pub ipv6: bool,
    /// URL the core requests to measure node latency.
    #[serde(default = "default_delay_probe_url")]
    pub delay_probe_url: String,
    /// Latency probe timeout in milliseconds.
    #[serde(default = "default_delay_timeout_ms")]
    pub delay_timeout_ms: u32,
    /// Automatic subscription refresh interval in hours. `0` disables it.
    #[serde(default)]
    pub subscription_update_hours: u32,
    /// Remembered window size for the next launch, in physical pixels. `None`
    /// means the window has never been resized by the operator.
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
}

pub(crate) const MIN_UI_SCALE: u32 = 85;
pub(crate) const MAX_UI_SCALE: u32 = 140;
pub(crate) const MIN_DELAY_TIMEOUT_MS: u32 = 1_000;
pub(crate) const MAX_DELAY_TIMEOUT_MS: u32 = 10_000;
pub(crate) const DEFAULT_DELAY_PROBE_URL: &str = "http://www.gstatic.com/generate_204";

fn default_ui_scale() -> u32 {
    100
}

fn default_delay_probe_url() -> String {
    DEFAULT_DELAY_PROBE_URL.to_owned()
}

fn default_delay_timeout_ms() -> u32 {
    5_000
}

fn clamp_ui_scale(value: u32) -> u32 {
    value.clamp(MIN_UI_SCALE, MAX_UI_SCALE)
}

/// A probe URL must be an http(s) target the core can request.
fn is_valid_probe_url(value: &str) -> bool {
    let trimmed = value.trim();
    (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
        && trimmed.len() <= 2048
        && !trimmed.chars().any(char::is_control)
}

impl DesktopSettings {
    /// Returns the settings with every value forced into its valid range.
    ///
    /// `settings.json` is a user-editable file, so validation happens on load
    /// and on save rather than trusting the caller.
    pub(crate) fn normalized(mut self) -> Self {
        self.ui_scale = clamp_ui_scale(self.ui_scale);
        self.delay_timeout_ms = self
            .delay_timeout_ms
            .clamp(MIN_DELAY_TIMEOUT_MS, MAX_DELAY_TIMEOUT_MS);
        // 0 disables automatic refresh; anything else is bounded so a
        // hand-edited file cannot trigger a refresh storm.
        self.subscription_update_hours = self.subscription_update_hours.min(24 * 7);
        if !is_valid_probe_url(&self.delay_probe_url) {
            self.delay_probe_url = DEFAULT_DELAY_PROBE_URL.to_owned();
        }
        self.window_width = self.window_width.map(|width| width.clamp(820, 7680));
        self.window_height = self.window_height.map(|height| height.clamp(680, 4320));
        if self.window_width.is_none() || self.window_height.is_none() {
            self.window_width = None;
            self.window_height = None;
        }
        self
    }
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            theme: Theme::CyberFlow,
            close_behavior: CloseBehavior::HideToTray,
            language: Language::English,
            ui_scale: default_ui_scale(),
            log_level: CoreLogLevel::Warning,
            ipv6: false,
            delay_probe_url: default_delay_probe_url(),
            delay_timeout_ms: default_delay_timeout_ms(),
            subscription_update_hours: 0,
            window_width: None,
            window_height: None,
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct LoadedSettings {
    pub settings: DesktopSettings,
    pub warning: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub(crate) fn new(config_directory: impl AsRef<Path>) -> Self {
        Self {
            path: config_directory.as_ref().join(SETTINGS_FILE_NAME),
        }
    }

    pub(crate) fn load(&self) -> LoadedSettings {
        let contents = match fs::read_to_string(&self.path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return LoadedSettings {
                    settings: DesktopSettings::default(),
                    warning: None,
                };
            }
            Err(error) => {
                return LoadedSettings {
                    settings: DesktopSettings::default(),
                    warning: Some(format!(
                        "FlowProxy settings could not be read; defaults were restored: {error}"
                    )),
                };
            }
        };

        let settings = match serde_json::from_str::<DesktopSettings>(&contents) {
            Ok(settings) if settings.version == SETTINGS_VERSION => settings,
            Ok(settings) => {
                return LoadedSettings {
                    settings: DesktopSettings::default(),
                    warning: Some(format!(
                        "FlowProxy settings version {} is unsupported; defaults were restored.",
                        settings.version
                    )),
                };
            }
            Err(error) => {
                return LoadedSettings {
                    settings: DesktopSettings::default(),
                    warning: Some(format!(
                        "FlowProxy settings could not be read; defaults were restored: {error}"
                    )),
                };
            }
        };

        LoadedSettings {
            settings: settings.normalized(),
            warning: None,
        }
    }

    pub(crate) fn save(&self, settings: &DesktopSettings) -> Result<(), SettingsStoreError> {
        if settings.version != SETTINGS_VERSION {
            return Err(SettingsStoreError::new(format!(
                "Cannot save unsupported FlowProxy settings version {}.",
                settings.version
            )));
        }
        let settings = &settings.clone().normalized();

        let parent = self.path.parent().ok_or_else(|| {
            SettingsStoreError::new("FlowProxy settings path has no parent directory.")
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            SettingsStoreError::new(format!(
                "Could not create the FlowProxy settings directory: {error}"
            ))
        })?;

        let (temporary_path, mut temporary_file) = self.create_temporary_file(parent)?;
        let guard = TemporaryFileGuard::new(temporary_path);

        serde_json::to_writer_pretty(&mut temporary_file, settings).map_err(|error| {
            SettingsStoreError::new(format!("Could not serialize FlowProxy settings: {error}"))
        })?;
        temporary_file.sync_all().map_err(|error| {
            SettingsStoreError::new(format!("Could not flush FlowProxy settings: {error}"))
        })?;
        drop(temporary_file);

        fs::rename(guard.path(), &self.path).map_err(|error| {
            SettingsStoreError::new(format!(
                "Could not replace FlowProxy settings atomically: {error}"
            ))
        })?;
        guard.commit();
        Ok(())
    }

    fn create_temporary_file(&self, parent: &Path) -> Result<(PathBuf, File), SettingsStoreError> {
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(
            ".{SETTINGS_FILE_NAME}.{}.{}.tmp",
            std::process::id(),
            sequence
        ));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| {
                SettingsStoreError::new(format!(
                    "Could not create a temporary FlowProxy settings file: {error}"
                ))
            })?;
        Ok((path, file))
    }
}

#[derive(Debug)]
pub(crate) struct SettingsStoreError {
    message: String,
}

impl SettingsStoreError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for SettingsStoreError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SettingsStoreError {}

struct TemporaryFileGuard {
    path: PathBuf,
    committed: bool,
}

impl TemporaryFileGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for TemporaryFileGuard {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CloseBehavior, CoreLogLevel, DesktopSettings, Language, SettingsStore, Theme,
        SETTINGS_FILE_NAME, SETTINGS_VERSION,
    };
    use std::fs;
    use tempfile::TempDir;

    fn temporary_store() -> (TempDir, SettingsStore) {
        let directory = tempfile::tempdir().expect("temporary settings directory");
        let store = SettingsStore::new(directory.path());
        (directory, store)
    }

    #[test]
    fn missing_settings_file_loads_defaults_without_warning() {
        let (_directory, store) = temporary_store();

        let loaded = store.load();

        assert_eq!(loaded.settings, DesktopSettings::default());
        assert_eq!(loaded.settings.version, SETTINGS_VERSION);
        assert_eq!(loaded.settings.theme, Theme::CyberFlow);
        assert_eq!(loaded.settings.close_behavior, CloseBehavior::HideToTray);
        assert_eq!(loaded.settings.language, Language::English);
        assert_eq!(loaded.warning, None);
    }

    #[test]
    fn settings_written_before_language_existed_still_load() {
        let (directory, store) = temporary_store();
        fs::write(
            directory.path().join(SETTINGS_FILE_NAME),
            r#"{"version":1,"theme":"warm_flow","close_behavior":"exit_application"}"#,
        )
        .expect("write legacy settings");

        let loaded = store.load();

        assert_eq!(loaded.warning, None);
        assert_eq!(loaded.settings.theme, Theme::WarmFlow);
        assert_eq!(
            loaded.settings.close_behavior,
            CloseBehavior::ExitApplication
        );
        assert_eq!(loaded.settings.language, Language::English);
    }

    #[test]
    fn language_round_trips_through_json() {
        let (_directory, store) = temporary_store();
        let expected = DesktopSettings {
            version: SETTINGS_VERSION,
            theme: Theme::CyberFlow,
            close_behavior: CloseBehavior::HideToTray,
            language: Language::SimplifiedChinese,
            ui_scale: 120,
            log_level: CoreLogLevel::Info,
            ipv6: true,
            delay_probe_url: "https://cp.cloudflare.com/generate_204".to_owned(),
            delay_timeout_ms: 3_000,
            subscription_update_hours: 12,
            window_width: Some(1280),
            window_height: Some(820),
        };

        store.save(&expected).expect("save settings");
        let loaded = store.load();

        assert_eq!(loaded.settings, expected);
        assert_eq!(loaded.warning, None);
    }

    #[test]
    fn settings_round_trip_through_versioned_json() {
        let (_directory, store) = temporary_store();
        let expected = DesktopSettings {
            version: SETTINGS_VERSION,
            theme: Theme::WarmFlow,
            close_behavior: CloseBehavior::ExitApplication,
            ..DesktopSettings::default()
        };

        store.save(&expected).expect("save settings");
        let loaded = store.load();

        assert_eq!(loaded.settings, expected);
        assert_eq!(loaded.warning, None);
    }

    #[test]
    fn corrupt_json_falls_back_to_defaults_with_warning() {
        let (directory, store) = temporary_store();
        fs::write(directory.path().join(SETTINGS_FILE_NAME), "{not-json")
            .expect("write corrupt settings");

        let loaded = store.load();

        assert_eq!(loaded.settings, DesktopSettings::default());
        assert!(loaded
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("could not be read")));
    }

    #[test]
    fn unsupported_version_falls_back_to_defaults_with_warning() {
        let (directory, store) = temporary_store();
        fs::write(
            directory.path().join(SETTINGS_FILE_NAME),
            r#"{"version":99,"theme":"warm_flow","close_behavior":"exit_application"}"#,
        )
        .expect("write unsupported settings");

        let loaded = store.load();

        assert_eq!(loaded.settings, DesktopSettings::default());
        assert!(loaded
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("unsupported")));
    }

    #[test]
    fn save_replaces_existing_file_without_leaving_temporary_files() {
        let (directory, store) = temporary_store();
        store
            .save(&DesktopSettings::default())
            .expect("save defaults");
        store
            .save(&DesktopSettings {
                version: SETTINGS_VERSION,
                theme: Theme::WarmFlow,
                close_behavior: CloseBehavior::HideToTray,
                ..DesktopSettings::default()
            })
            .expect("replace settings");

        let files = fs::read_dir(directory.path())
            .expect("read settings directory")
            .map(|entry| entry.expect("settings entry").file_name())
            .collect::<Vec<_>>();

        assert_eq!(files, vec![std::ffi::OsString::from(SETTINGS_FILE_NAME)]);
        assert_eq!(store.load().settings.theme, Theme::WarmFlow);
    }

    #[test]
    fn save_rejects_unsupported_version_without_writing() {
        let (directory, store) = temporary_store();
        let invalid = DesktopSettings {
            version: SETTINGS_VERSION + 1,
            ..DesktopSettings::default()
        };

        let error = store.save(&invalid).expect_err("reject future version");

        assert!(error.to_string().contains("unsupported"));
        assert!(!directory.path().join(SETTINGS_FILE_NAME).exists());
    }
}
