//! Rotating log files for Runtime and native events.
//!
//! The Runtime keeps a bounded in-memory buffer; this module mirrors the same
//! entries to `%APPDATA%\<identifier>\logs` so a problem reported by the
//! operator still exists after the process exits. Every line goes through the
//! Runtime's redaction first, so a subscription URL or API token never reaches
//! the disk.
//!
//! Writes are best-effort: a read-only profile or a locked file must never take
//! the core or the UI down, so all I/O errors are swallowed after the first
//! report.

use flowproxy_contracts::RuntimeLogLevel;
use flowproxy_runtime::redact_sensitive_text;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Prefix of every file this module creates; `prune` only touches these.
const FILE_PREFIX: &str = "flowproxy-";
const FILE_SUFFIX: &str = ".log";

/// Owns the open file and the date it belongs to.
///
/// A single file per day keeps `prune` trivial: compare the filename's date
/// with the retention window instead of reading every file's timestamp.
pub(crate) struct LogFileStore {
    directory: PathBuf,
    state: Mutex<LogFileState>,
}

#[derive(Default)]
struct LogFileState {
    /// `YYYY-MM-DD` of the currently open file.
    day: Option<String>,
    file: Option<File>,
    enabled: bool,
    retention_days: u32,
}

impl LogFileStore {
    pub(crate) fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            state: Mutex::new(LogFileState {
                day: None,
                file: None,
                enabled: true,
                retention_days: 7,
            }),
        }
    }

    /// Applies the operator's preferences and drops the open handle when
    /// logging was just turned off.
    pub(crate) fn configure(&self, enabled: bool, retention_days: u32) {
        let mut state = self.lock();
        state.enabled = enabled;
        state.retention_days = retention_days;
        if !enabled {
            state.file = None;
            state.day = None;
        }
    }

    /// Deletes files outside the retention window. Called on launch and when
    /// the day rolls over.
    pub(crate) fn prune(&self) {
        let mut state = self.lock();
        self.prune_locked(&mut state);
    }

    /// Caller must hold the lock; the day-rollover path already has it.
    fn prune_locked(&self, state: &mut LogFileState) {
        let retention_days = state.retention_days.max(1);
        let cutoff = today_minus(retention_days);
        let Ok(entries) = fs::read_dir(&self.directory) else {
            return;
        };

        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some(day) = parse_log_file_day(name) else {
                continue;
            };
            if day < cutoff {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    pub(crate) fn write(&self, level: RuntimeLogLevel, message: &str) {
        let mut state = self.lock();
        if !state.enabled {
            return;
        }

        let day = utc_day_string(now_epoch_seconds());
        let rolled_over = state.day.as_deref() != Some(day.as_str());
        if rolled_over || state.file.is_none() {
            state.file = None;
            if rolled_over {
                // A long-running session can cross many days; prune here rather
                // than waiting for the next launch.
                self.prune_locked(&mut state);
            }
            state.day = Some(day.clone());
            if let Some(file) = self.open_day(&day) {
                state.file = Some(file);
            }
        }

        let Some(file) = state.file.as_mut() else {
            return;
        };
        let timestamp = iso8601(now_epoch_seconds());
        let line = format!(
            "[{timestamp}] [{}] {}\n",
            level_label(level),
            redact_sensitive_text(message)
        );
        // A failed write only loses this line; the next one retries.
        let _ = file.write_all(line.as_bytes());
    }

    /// Writes a line that did not come from the Runtime (window, tray or
    /// platform errors). It is redacted like every other line.
    pub(crate) fn write_native_error(&self, action: &str, message: &str) {
        self.write(
            RuntimeLogLevel::Error,
            &format!("Native error while {action}: {message}"),
        );
    }

    pub(crate) fn directory(&self) -> &Path {
        &self.directory
    }

    fn open_day(&self, day: &str) -> Option<File> {
        fs::create_dir_all(&self.directory).ok()?;
        let path = self
            .directory
            .join(format!("{FILE_PREFIX}{day}{FILE_SUFFIX}"));
        OpenOptions::new().create(true).append(true).open(path).ok()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, LogFileState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Deletes every log file this module created. The open handle is closed first
/// so Windows can remove the file.
pub(crate) fn clear(store: &LogFileStore) -> std::io::Result<usize> {
    {
        let mut state = store.lock();
        state.file = None;
        state.day = None;
    }
    let entries = match fs::read_dir(store.directory()) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    };

    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if parse_log_file_day(name).is_some() && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

fn level_label(level: RuntimeLogLevel) -> &'static str {
    match level {
        RuntimeLogLevel::Info => "info",
        RuntimeLogLevel::Warn => "warn",
        RuntimeLogLevel::Error => "error",
    }
}

/// Extracts `YYYY-MM-DD` from `flowproxy-YYYY-MM-DD.log`.
fn parse_log_file_day(name: &str) -> Option<String> {
    let rest = name.strip_prefix(FILE_PREFIX)?;
    let day = rest.strip_suffix(FILE_SUFFIX)?;
    let bytes = day.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
    {
        return None;
    }
    Some(day.to_owned())
}

fn now_epoch_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

/// UTC date of `epoch_seconds`, without pulling in a calendar crate.
///
/// Uses the civil-from-days algorithm (Howard Hinnant) so the file name is
/// stable regardless of the operator's timezone.
fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { y + 1 } else { y }, month, day)
}

fn utc_day_string(epoch_seconds: i64) -> String {
    let days = epoch_seconds.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn today_minus(days: u32) -> String {
    utc_day_string(now_epoch_seconds() - i64::from(days) * 86_400)
}

fn iso8601(epoch_seconds: i64) -> String {
    let days = epoch_seconds.div_euclid(86_400);
    let seconds_of_day = epoch_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Opens the log directory in the platform file manager.
/// Opens any folder in the platform file manager.
pub(crate) fn open_path(directory: &std::path::Path) -> std::io::Result<()> {
    open_directory_path(directory)
}

pub(crate) fn open_directory(store: &LogFileStore) -> std::io::Result<()> {
    open_directory_path(store.directory())
}

fn open_directory_path(path: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(path)?;

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer.exe").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(path).spawn();

    result.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{
        clear, iso8601, parse_log_file_day, utc_day_string, LogFileStore, FILE_PREFIX, FILE_SUFFIX,
    };
    use flowproxy_contracts::RuntimeLogLevel;
    use std::fs;

    fn store(directory: &std::path::Path) -> LogFileStore {
        LogFileStore::new(directory.to_path_buf())
    }

    #[test]
    fn writes_one_file_per_day_and_appends() {
        let directory = tempfile::tempdir().expect("temporary log directory");
        let logs = store(directory.path());

        logs.write(RuntimeLogLevel::Info, "first line");
        logs.write(RuntimeLogLevel::Error, "second line");

        let files = fs::read_dir(directory.path())
            .expect("read log directory")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1);
        let contents = fs::read_to_string(directory.path().join(&files[0])).expect("read log");
        assert!(contents.contains("first line"));
        assert!(contents.contains("second line"));
        assert!(contents.contains("[error]"));
    }

    #[test]
    fn disabled_logging_writes_nothing() {
        let directory = tempfile::tempdir().expect("temporary log directory");
        let logs = store(directory.path());
        logs.configure(false, 7);

        logs.write(RuntimeLogLevel::Info, "must not appear");

        assert_eq!(
            fs::read_dir(directory.path())
                .expect("read log directory")
                .count(),
            0
        );
    }

    #[test]
    fn lines_are_redacted_before_they_reach_the_disk() {
        let directory = tempfile::tempdir().expect("temporary log directory");
        let logs = store(directory.path());

        logs.write(
            RuntimeLogLevel::Info,
            "fetch https://user:secret@example.com/sub token=abc123",
        );

        let entry = fs::read_dir(directory.path())
            .expect("read log directory")
            .flatten()
            .next()
            .expect("one log file");
        let contents = fs::read_to_string(entry.path()).expect("read log");
        assert!(!contents.contains("secret"));
        assert!(!contents.contains("abc123"));
        assert!(contents.contains("[REDACTED]"));
    }

    #[test]
    fn prune_removes_files_outside_the_retention_window() {
        let directory = tempfile::tempdir().expect("temporary log directory");
        let logs = store(directory.path());
        let old = format!("{FILE_PREFIX}2000-01-01{FILE_SUFFIX}");
        let unrelated = "notes.txt";
        fs::write(directory.path().join(&old), "old").expect("write old log");
        fs::write(directory.path().join(unrelated), "keep").expect("write unrelated file");

        logs.prune();

        assert!(!directory.path().join(old).exists());
        assert!(directory.path().join(unrelated).exists());
    }

    #[test]
    fn clear_removes_only_this_modules_files() {
        let directory = tempfile::tempdir().expect("temporary log directory");
        let logs = store(directory.path());
        logs.write(RuntimeLogLevel::Info, "line");
        fs::write(directory.path().join("notes.txt"), "keep").expect("write unrelated file");

        let removed = clear(&logs).expect("clear logs");

        assert_eq!(removed, 1);
        assert!(directory.path().join("notes.txt").exists());
    }

    #[test]
    fn parses_only_this_modules_file_names() {
        assert_eq!(
            parse_log_file_day("flowproxy-2026-11-26.log").as_deref(),
            Some("2026-11-26")
        );
        assert_eq!(parse_log_file_day("flowproxy-2026-11-26.txt"), None);
        assert_eq!(parse_log_file_day("flowproxy-2026-1-26.log"), None);
        assert_eq!(parse_log_file_day("other-2026-11-26.log"), None);
    }

    #[test]
    fn date_helpers_agree_on_known_epochs() {
        assert_eq!(utc_day_string(0), "1970-01-01");
        assert_eq!(utc_day_string(1_700_000_000), "2023-11-14");
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(1_700_000_000), "2023-11-14T22:13:20Z");
    }
}
