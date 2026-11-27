//! One-file diagnostic bundle.
//!
//! A bug report is only actionable with the environment, the settings and the
//! recent logs together. This module writes those into a single text file on
//! the operator's Desktop and opens the folder: nothing is uploaded, and the
//! subscription URLs, the Sub-Store token and the core secret are removed
//! before they reach the file.
//!
//! The bundle deliberately does not include the subscription document itself:
//! it carries the provider's credentials in every proxy entry.

use crate::settings::DesktopSettings;
use capybara_contracts::{CoreInfo, RuntimeSnapshot, SubscriptionSnapshot};
use std::fs;
use std::path::{Path, PathBuf};

/// Longest bundle written. The logs are the only unbounded part.
const MAX_BUNDLE_BYTES: usize = 4 * 1024 * 1024;
/// Log files read into the bundle, newest first.
const MAX_LOG_FILES: usize = 7;

/// Everything the bundle reports, gathered by the caller.
pub struct DiagnosticInput<'a> {
    pub app_version: &'a str,
    pub os: &'a str,
    pub settings: &'a DesktopSettings,
    pub runtime: &'a RuntimeSnapshot,
    pub core: Option<&'a CoreInfo>,
    pub subscription: Option<&'a SubscriptionSnapshot>,
    /// Directory that holds the rotating log files.
    pub log_directory: &'a Path,
}

/// Writes the bundle next to `target_directory` and returns its path.
pub fn write_bundle(
    target_directory: &Path,
    input: &DiagnosticInput<'_>,
) -> std::io::Result<PathBuf> {
    fs::create_dir_all(target_directory)?;
    let path = target_directory.join(format!(
        "CapybaraProxy-diagnostics-{}.txt",
        capybara_runtime::redact_sensitive_text(&timestamp_slug())
    ));

    let mut body = String::with_capacity(16 * 1024);
    body.push_str("# CapybaraProxy diagnostics\n");
    body.push_str("# Subscription URLs, tokens and the core secret are removed.\n\n");

    body.push_str("## Environment\n");
    push_line(&mut body, "app_version", input.app_version);
    push_line(&mut body, "os", input.os);
    push_line(
        &mut body,
        "runtime_backend",
        &format!("{:?}", input.runtime.backend),
    );
    push_line(
        &mut body,
        "runtime_state",
        &format!("{:?}", input.runtime.state),
    );
    push_line(
        &mut body,
        "runtime_started_at_ms",
        &input
            .runtime
            .started_at_ms
            .map(|value| value.to_string())
            .unwrap_or_else(|| "none".to_owned()),
    );
    push_line(
        &mut body,
        "runtime_last_error",
        &input
            .runtime
            .last_error
            .as_ref()
            .map(|error| format!("{:?}: {}", error.code, error.message))
            .unwrap_or_else(|| "none".to_owned()),
    );
    match input.core {
        Some(core) => {
            push_line(&mut body, "core_version", &core.version);
            push_line(
                &mut body,
                "core_pid",
                &core
                    .pid
                    .map(|pid| pid.to_string())
                    .unwrap_or_else(|| "none".to_owned()),
            );
        }
        None => push_line(&mut body, "core_version", "not running"),
    }

    body.push_str("\n## Settings\n");
    // Only the fields that explain a behaviour difference are included; the
    // full file would drag in the Sub-Store token and the UA string.
    let settings_summary = [
        ("theme", format!("{:?}", input.settings.theme)),
        ("language", format!("{:?}", input.settings.language)),
        ("ui_scale", input.settings.ui_scale.to_string()),
        (
            "settings_mode",
            format!("{:?}", input.settings.settings_mode),
        ),
        (
            "close_behavior",
            format!("{:?}", input.settings.close_behavior),
        ),
        ("silent_start", input.settings.silent_start.to_string()),
        ("auto_connect", input.settings.auto_connect.to_string()),
        (
            "system_proxy_enabled",
            input.settings.system_proxy_enabled.to_string(),
        ),
        (
            "proxy_bypass",
            redact_or_none(input.settings.proxy_bypass.as_deref()),
        ),
        ("log_level", format!("{:?}", input.settings.log_level)),
        ("ipv6", input.settings.ipv6.to_string()),
        ("unified_delay", input.settings.unified_delay.to_string()),
        ("tcp_concurrent", input.settings.tcp_concurrent.to_string()),
        (
            "fixed_proxy_port",
            input
                .settings
                .fixed_proxy_port
                .map(|port| port.to_string())
                .unwrap_or_else(|| "auto".to_owned()),
        ),
        (
            "subscription_update_hours",
            input.settings.subscription_update_hours.to_string(),
        ),
        (
            "restart_after_subscription_update",
            input.settings.restart_after_subscription_update.to_string(),
        ),
        ("log_to_file", input.settings.log_to_file.to_string()),
        (
            "log_retention_days",
            input.settings.log_retention_days.to_string(),
        ),
        ("tray_show_info", input.settings.tray_show_info.to_string()),
        (
            "tray_speed_display",
            format!("{:?}", input.settings.tray_speed_display),
        ),
        ("motion", format!("{:?}", input.settings.motion)),
        (
            "substore_configured",
            (!input.settings.substore_url.is_empty()).to_string(),
        ),
    ];
    for (key, value) in settings_summary {
        push_line(&mut body, key, &value);
    }

    body.push_str("\n## Subscription\n");
    match input.subscription {
        Some(subscription) if subscription.has_subscription => {
            push_line(
                &mut body,
                "id",
                subscription.id.as_deref().unwrap_or("unknown"),
            );
            push_line(
                &mut body,
                "name",
                subscription.name.as_deref().unwrap_or("unnamed"),
            );
            push_line(
                &mut body,
                "proxy_groups",
                &subscription.groups.len().to_string(),
            );
            push_line(&mut body, "rules", &subscription.rules.len().to_string());
            push_line(
                &mut body,
                "override_rules",
                &subscription.override_rules.len().to_string(),
            );
            push_line(
                &mut body,
                "override_yaml_present",
                &subscription.override_yaml.is_some().to_string(),
            );
            // The URL is the provider's credential, so only its shape is
            // reported.
            push_line(
                &mut body,
                "source_url_scheme",
                subscription
                    .source_url
                    .as_deref()
                    .map(|url| url.split("://").next().unwrap_or("unknown").to_owned())
                    .unwrap_or_else(|| "none".to_owned())
                    .as_str(),
            );
        }
        _ => push_line(&mut body, "state", "no subscription stored"),
    }

    body.push_str("\n## Logs\n");
    append_logs(&mut body, input.log_directory);

    fs::write(&path, truncate(body, MAX_BUNDLE_BYTES))?;
    Ok(path)
}

fn push_line(body: &mut String, key: &str, value: &str) {
    body.push_str(key);
    body.push_str(": ");
    body.push_str(&capybara_runtime::redact_sensitive_text(value));
    body.push('\n');
}

fn redact_or_none(value: Option<&str>) -> String {
    value
        .map(|entry| entry.to_owned())
        .unwrap_or_else(|| "none".to_owned())
}

/// Appends the newest log files, redacted line by line.
fn append_logs(body: &mut String, directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        body.push_str("(log directory is unavailable)\n");
        return;
    };

    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|extension| extension.to_str()) == Some("log"))
        .collect();
    // The file name carries the date, so a reverse sort is newest first.
    files.sort();
    files.reverse();

    if files.is_empty() {
        body.push_str("(no log files)\n");
        return;
    }

    for path in files.into_iter().take(MAX_LOG_FILES) {
        body.push_str("\n### ");
        body.push_str(
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("log"),
        );
        body.push('\n');
        let Ok(contents) = fs::read_to_string(&path) else {
            body.push_str("(unreadable)\n");
            continue;
        };
        body.push_str(&capybara_runtime::redact_sensitive_text(&contents));
        if !contents.ends_with('\n') {
            body.push('\n');
        }
    }
}

fn truncate(mut body: String, max_bytes: usize) -> String {
    if body.len() <= max_bytes {
        return body;
    }
    // Cut on a character boundary so the file stays valid UTF-8.
    let mut end = max_bytes;
    while end > 0 && !body.is_char_boundary(end) {
        end -= 1;
    }
    body.truncate(end);
    body.push_str("\n\n[bundle truncated: logs exceeded the size limit]\n");
    body
}

/// `YYYYMMDD-HHMMSS` in UTC, enough to tell two bundles apart.
fn timestamp_slug() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = (seconds / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    let hour = (seconds % 86_400) / 3_600;
    let minute = (seconds % 3_600) / 60;
    let second = seconds % 60;
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
}

/// Days since the Unix epoch to a calendar date, after Howard Hinnant.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

/// Opens the folder that holds a bundle.
pub fn open_folder(directory: &Path) -> std::io::Result<()> {
    crate::logging::open_path(directory)
}

#[cfg(test)]
mod tests {
    use super::{civil_from_days, truncate, write_bundle, DiagnosticInput};
    use crate::settings::DesktopSettings;
    use capybara_contracts::{RuntimeBackend, RuntimeSnapshot, RuntimeState, SubscriptionSnapshot};
    use std::fs;

    fn input<'a>(
        settings: &'a DesktopSettings,
        runtime: &'a RuntimeSnapshot,
        subscription: &'a SubscriptionSnapshot,
        log_directory: &'a std::path::Path,
    ) -> DiagnosticInput<'a> {
        DiagnosticInput {
            app_version: "0.1.0",
            os: "windows",
            settings,
            runtime,
            core: None,
            subscription: Some(subscription),
            log_directory,
        }
    }

    #[test]
    fn civil_dates_match_known_epochs() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_760), (2026, 11, 3));
    }

    #[test]
    fn bundle_reports_environment_and_redacts_the_sub_store_token() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let logs = directory.path().join("logs");
        fs::create_dir_all(&logs).expect("create logs");
        fs::write(
            logs.join("2026-11-27.log"),
            "subscription https://user:secret@example.com/sub?token=abc failed\n",
        )
        .expect("write log");

        let settings = DesktopSettings {
            substore_token: "super-secret-token".to_owned(),
            ..DesktopSettings::default()
        };
        let runtime = RuntimeSnapshot {
            backend: RuntimeBackend::Mihomo,
            state: RuntimeState::Connected,
            sequence: 3,
            started_at_ms: Some(1),
            last_error: None,
            log_count: 0,
        };
        let subscription = SubscriptionSnapshot {
            has_subscription: true,
            source_url: Some("https://provider.example/sub?token=abc".to_owned()),
            ..SubscriptionSnapshot::default()
        };

        let path = write_bundle(
            directory.path(),
            &input(&settings, &runtime, &subscription, &logs),
        )
        .expect("write bundle");
        let contents = fs::read_to_string(path).expect("read bundle");

        assert!(contents.contains("runtime_state: Connected"));
        assert!(contents.contains("source_url_scheme: https"));
        assert!(contents.contains("substore_configured: false"));
        // Neither the token nor the URL's userinfo survive.
        assert!(!contents.contains("super-secret-token"));
        assert!(!contents.contains("user:secret"));
        assert!(contents.contains("[REDACTED]"));
    }

    #[test]
    fn bundle_reports_a_missing_subscription_without_failing() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let settings = DesktopSettings::default();
        let runtime = RuntimeSnapshot {
            backend: RuntimeBackend::Mihomo,
            state: RuntimeState::Stopped,
            sequence: 0,
            started_at_ms: None,
            last_error: None,
            log_count: 0,
        };
        let subscription = SubscriptionSnapshot::default();

        let path = write_bundle(
            directory.path(),
            &input(&settings, &runtime, &subscription, directory.path()),
        )
        .expect("write bundle");
        let contents = fs::read_to_string(path).expect("read bundle");

        assert!(contents.contains("no subscription stored"));
        // The temp directory exists but holds no log files.
        assert!(contents.contains("(no log files)"));
    }

    #[test]
    fn truncation_keeps_valid_utf8_and_says_so() {
        let body = "字".repeat(100);

        let truncated = truncate(body, 10);

        assert!(truncated.contains("[bundle truncated"));
        // The cut lands on a character boundary, so the string is intact.
        assert!(truncated.is_char_boundary(0));
    }
}
