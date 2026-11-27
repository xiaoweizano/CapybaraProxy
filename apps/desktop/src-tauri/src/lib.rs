mod diagnostics;
mod logging;
mod settings;
mod speed_icon;
mod substore;
mod system_integration;
mod traffic;
mod tray_strings;
mod tray_summary;

use flowproxy_contracts::{
    CommandResult, ConnectionPage, CoreInfo, CorePreferences, DelayHistory, DelayHistoryEntry,
    DelayProbeSettings, GroupDelayResult, LogLevel, ProfileInfo, ProviderInfo, ProxyGroup,
    RoutingMode, RuleItem, RuntimeBackend, RuntimeError, RuntimeErrorCode, RuntimeLogEntry,
    RuntimeSnapshot, RuntimeState, StartupPreferences, SubscriptionSnapshot, TelemetrySnapshot,
};
use flowproxy_mihomo_manager::{MihomoAdapter, MihomoCoreAdapter, UnavailableMihomoAdapter};
use flowproxy_runtime::{RuntimeChange, RuntimeFailure, RuntimeManager};
use logging::LogFileStore;
use settings::{
    CloseBehavior, DesktopSettings, SettingsStore, SettingsStoreError, TraySpeedDisplay,
};
use std::collections::VecDeque;
use std::fmt::Display;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use system_integration::{
    IntegrationFailure, NativePlatform, SystemIntegration, SystemIntegrationEvent,
    SystemIntegrationStatus,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};
use tray_summary::TraySummary;

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "flowproxy";
const TRAY_TOGGLE_CONNECTION_ID: &str = "toggle-connection";
const TRAY_STATUS_ID: &str = "tray-status";
const TRAY_NODE_ID: &str = "tray-node";
/// Prefix of the tray routing-mode entries; the suffix is the wire value.
const TRAY_MODE_PREFIX: &str = "tray-mode-";
const TRAY_OPEN_LOGS_ID: &str = "tray-open-logs";
const APP_VISIBILITY_EVENT: &str = "app-visibility";
const RUNTIME_STATE_EVENT: &str = "runtime-state-changed";
const RUNTIME_LOG_EVENT: &str = "runtime-log";
const SYSTEM_INTEGRATION_EVENT: &str = "system-integration-changed";
const SUBSCRIPTION_UPDATED_EVENT: &str = "subscription-updated";
const RUNTIME_HEALTH_VISIBLE_INTERVAL: Duration = Duration::from_millis(1_500);
const RUNTIME_HEALTH_HIDDEN_INTERVAL: Duration = Duration::from_millis(5_000);
const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_DELAY_TIMEOUT_MS: u32 = 10_000;
/// Upper bound for subscription documents pasted or downloaded into the app.
const MAX_SUBSCRIPTION_YAML_BYTES: usize = 8 * 1024 * 1024;

/// How many latency measurements are kept for the history view.
const MAX_DELAY_HISTORY_ENTRIES: usize = 2_000;

/// Wall-clock time in epoch milliseconds.
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

/// Today's date as `YYYY-MM-DD` in local time.
///
/// The traffic ledger is keyed by this rather than by an epoch, so a day
/// boundary matches the operator's clock instead of UTC.
fn local_date() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format_date(seconds as i64 + flowproxy_platform::local_utc_offset_seconds())
}

/// Converts a Unix timestamp in seconds to `YYYY-MM-DD`.
///
/// Implemented here rather than through a date crate: the ledger only needs
/// a stable day key, and a new dependency for one call is not worth it.
fn format_date(unix_seconds: i64) -> String {
    let days = unix_seconds.div_euclid(86_400);
    // Civil-from-days, after Howard Hinnant's algorithm.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    };
    if month <= 2 {
        year += 1;
    }
    format!("{year:04}-{month:02}-{day:02}")
}

type DesktopAdapter = Box<dyn MihomoAdapter>;
type DesktopIntegration = SystemIntegration<RuntimeManager<DesktopAdapter>, NativePlatform>;

struct AppState {
    runtime: Arc<RuntimeManager<DesktopAdapter>>,
    system_integration: Arc<DesktopIntegration>,
    settings_store: SettingsStore,
    settings: Mutex<DesktopSettings>,
    exit_gate: ExitGate,
    logs: Arc<LogFileStore>,
    /// Summary last rendered into the tray, used to skip redundant rebuilds.
    tray_summary: Mutex<Option<TraySummary>>,
    /// Per-day transfer counters that survive a core restart.
    traffic: traffic::TrafficLedger,
    /// Installed core builds, when a settings directory is known.
    core_versions: Option<flowproxy_mihomo_manager::CoreVersionStore>,
    /// Last connection counters seen, so the ledger only adds the delta.
    traffic_sample: Mutex<Option<(u64, u64)>>,
    /// Recent latency measurements, oldest first. Bounded so a long session
    /// cannot grow it without limit.
    delay_history: Mutex<VecDeque<DelayHistoryEntry>>,
}

impl AppState {
    fn new(
        runtime: Arc<RuntimeManager<DesktopAdapter>>,
        system_integration: Arc<DesktopIntegration>,
        settings_store: SettingsStore,
        settings: DesktopSettings,
        logs: Arc<LogFileStore>,
        settings_directory: Option<PathBuf>,
    ) -> Self {
        logs.configure(settings.log_to_file, settings.log_retention_days);
        Self {
            runtime,
            system_integration,
            settings_store,
            settings: Mutex::new(settings),
            exit_gate: ExitGate::default(),
            logs,
            tray_summary: Mutex::new(None),
            core_versions: settings_directory.as_ref().map(|directory| {
                flowproxy_mihomo_manager::CoreVersionStore::new(directory.join("cores"))
            }),
            traffic: traffic::TrafficLedger::new(settings_directory.unwrap_or_default()),
            traffic_sample: Mutex::new(None),
            delay_history: Mutex::new(VecDeque::new()),
        }
    }

    /// The routing mode the core reports, or `None` while it is down.
    ///
    /// The tray marks the active entry from this; a stopped core has no mode
    /// to show, and its entries are disabled anyway.
    fn current_routing_mode(&self) -> Option<RoutingMode> {
        self.runtime
            .core_preferences()
            .ok()
            .and_then(|preferences| preferences.mode)
    }

    /// Adds the delta since the previous telemetry sample to today's row.
    ///
    /// The core's totals restart at zero with it, so a sample smaller than the
    /// previous one means the core restarted: the new value is the delta on its
    /// own. A write failure is logged and otherwise ignored — the live rates
    /// are unaffected.
    fn accumulate_traffic(&self, upload: u64, download: u64) {
        let delta = {
            let mut sample = self
                .traffic_sample
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let delta = match *sample {
                Some((previous_upload, previous_download))
                    if upload >= previous_upload && download >= previous_download =>
                {
                    (upload - previous_upload, download - previous_download)
                }
                _ => (upload, download),
            };
            *sample = Some((upload, download));
            delta
        };

        if delta == (0, 0) {
            return;
        }
        if let Err(error) = self.traffic.record(&local_date(), delta.0, delta.1) {
            log_native_error("recording the daily traffic total", error);
        }
    }

    /// Cumulative upload/download counters, or `None` while the core is down.
    ///
    /// A separate read from the tray summary: the summary only asks for
    /// telemetry when the rates are displayed, while the ledger always wants
    /// the totals.
    fn daily_counters(&self) -> Option<(u64, u64)> {
        if !matches!(
            self.runtime.snapshot().state,
            RuntimeState::Connected | RuntimeState::RunningDisconnected
        ) {
            // A stopped core resets its counters on the next start, so the
            // previous sample must not be used as a baseline then.
            *self
                .traffic_sample
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
            return None;
        }
        self.runtime
            .telemetry()
            .ok()
            .map(|telemetry| (telemetry.total_upload_bytes, telemetry.total_download_bytes))
    }

    /// Appends one measurement, dropping the oldest entries past the cap.
    fn record_delay(&self, proxy: &str, delay_ms: u32) {
        let entry = DelayHistoryEntry {
            proxy: proxy.to_owned(),
            delay_ms,
            timestamp_ms: now_ms(),
        };
        let mut history = self
            .delay_history
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        history.push_back(entry);
        while history.len() > MAX_DELAY_HISTORY_ENTRIES {
            history.pop_front();
        }
    }

    fn delay_history(&self) -> DelayHistory {
        let history = self
            .delay_history
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        DelayHistory {
            entries: history.iter().cloned().collect(),
            now_ms: now_ms(),
        }
    }

    fn close_behavior(&self) -> CloseBehavior {
        self.settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .close_behavior
    }

    fn settings(&self) -> DesktopSettings {
        self.settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn update_settings(
        &self,
        settings: DesktopSettings,
    ) -> Result<DesktopSettings, SettingsStoreError> {
        let mut current = self
            .settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let settings = settings.normalized();
        self.settings_store.save(&settings)?;
        *current = settings.clone();
        // The core's log level and IPv6 switch are baked into the profile, so
        // the adapter needs them before the next start or restart.
        self.runtime
            .apply_startup_preferences(startup_preferences(&settings));
        self.runtime
            .apply_delay_probe(delay_probe_settings(&settings));
        self.logs
            .configure(settings.log_to_file, settings.log_retention_days);
        // The bypass list is part of the system proxy, not the profile; apply
        // it right away so the UI reflects what the OS now holds. A backend
        // failure is reported through the integration status, not the save.
        if let Err(failure) = self
            .system_integration
            .set_proxy_bypass(settings.proxy_bypass.clone())
        {
            log_native_error("applying the proxy bypass list", &failure.error);
        }
        Ok(settings)
    }

    /// Reads the tray summary from the Runtime.
    ///
    /// Rates come from the Runtime's telemetry sample, the same one the
    /// Overview page uses. Asking for it here keeps the tray in sync when the
    /// window is hidden and the webview has stopped sampling; while the window
    /// is visible the two callers alternate and the rates are measured over
    /// whichever window happened since the previous call, so the value stays
    /// correct but is a little noisier than a single sampler.
    ///
    /// The current node costs a `/proxies` request and the rates cost a
    /// `/connections` request, so each is only fetched when something shows
    /// it: `refresh_node` for the node (callers clear it when nothing could
    /// have changed), and the tray display settings for the rates.
    fn read_tray_summary(&self, refresh_node: bool) -> TraySummary {
        let snapshot = self.runtime.snapshot();
        let settings = self.settings();
        let shows_node = settings.tray_show_info;
        let shows_rates = settings.tray_show_info
            || !matches!(settings.tray_speed_display, TraySpeedDisplay::Off);
        // Reuse the cached node unless the caller knows it may have moved.
        let cached_node = if refresh_node {
            None
        } else {
            self.stored_tray_summary().and_then(|cached| cached.node)
        };
        let mut summary = TraySummary {
            state: snapshot.state,
            node: if shows_node { cached_node } else { None },
            upload_bps: None,
            download_bps: None,
        };
        if !summary.is_running() {
            // A stopped core has no selected node; keeping the last one would
            // make the tray claim a route that is not in effect.
            summary.node = None;
            return summary;
        }

        if shows_node && summary.node.is_none() {
            if let Ok(groups) = self.runtime.proxy_groups() {
                summary.node = groups
                    .iter()
                    .find(|group| !group.selected.is_empty())
                    .map(|group| group.selected.clone());
            }
        }
        if shows_rates {
            if let Ok(telemetry) = self.runtime.telemetry() {
                summary.upload_bps = Some(telemetry.upload_bps);
                summary.download_bps = Some(telemetry.download_bps);
            }
        }
        summary
    }

    fn stored_tray_summary(&self) -> Option<TraySummary> {
        self.tray_summary
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn store_tray_summary(&self, summary: TraySummary) {
        *self
            .tray_summary
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(summary);
    }
}

/// Process-wide log sink so `log_native_error`, which has no `AppState`, still
/// reaches the file. Installed once during `setup`.
static LOG_SINK: OnceLock<Arc<LogFileStore>> = OnceLock::new();

fn install_log_sink(logs: Arc<LogFileStore>) {
    let _ = LOG_SINK.set(logs);
}

/// Maps persisted desktop settings onto the values the adapter bakes into the
/// next generated profile.
fn delay_probe_settings(settings: &DesktopSettings) -> DelayProbeSettings {
    DelayProbeSettings {
        url: settings.delay_probe_url.clone(),
        timeout_ms: settings.delay_timeout_ms,
    }
    .normalized()
}

fn startup_preferences(settings: &DesktopSettings) -> StartupPreferences {
    StartupPreferences {
        log_level: match settings.log_level {
            settings::CoreLogLevel::Silent => LogLevel::Silent,
            settings::CoreLogLevel::Error => LogLevel::Error,
            settings::CoreLogLevel::Warning => LogLevel::Warning,
            settings::CoreLogLevel::Info => LogLevel::Info,
            settings::CoreLogLevel::Debug => LogLevel::Debug,
        },
        ipv6: settings.ipv6,
        unified_delay: settings.unified_delay,
        tcp_concurrent: settings.tcp_concurrent,
        proxy_port: settings.fixed_proxy_port.unwrap_or(0),
    }
}
#[derive(Default)]
struct ExitGate {
    started: AtomicBool,
}

impl ExitGate {
    fn try_begin(&self) -> bool {
        self.started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn reset(&self) {
        self.started.store(false, Ordering::Release);
    }
}

fn log_native_error(action: &str, error: impl Display) {
    let message = error.to_string();
    eprintln!("FlowProxy native window error while {action}: {message}");
    if let Some(logs) = LOG_SINK.get() {
        logs.write_native_error(action, &message);
    }
}

#[cfg(any(debug_assertions, test))]
fn map_runtime_result(
    result: Result<RuntimeChange, RuntimeFailure>,
) -> CommandResult<RuntimeSnapshot> {
    match result {
        Ok(change) => CommandResult::success(change.snapshot),
        Err(failure) => CommandResult::failure(failure.error),
    }
}

fn map_data_result<T>(
    result: Result<T, RuntimeFailure>,
    publish_failure: impl FnOnce(&RuntimeChange),
) -> CommandResult<T> {
    match result {
        Ok(data) => CommandResult::success(data),
        Err(failure) => {
            publish_failure(&failure.change);
            CommandResult::failure(failure.error)
        }
    }
}

fn map_settings_error(error: SettingsStoreError) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::SettingsIo, error.to_string(), true)
}

fn emit_runtime_change(app: &tauri::AppHandle, change: &RuntimeChange) {
    if let Err(error) = app.emit(RUNTIME_STATE_EVENT, &change.snapshot) {
        log_native_error("publishing the Runtime state", error);
    }
    for entry in &change.logs {
        if let Some(state) = app.try_state::<AppState>() {
            state.logs.write(entry.level, &entry.message);
        }
        if let Err(error) = app.emit(RUNTIME_LOG_EVENT, entry) {
            log_native_error("publishing a Runtime log entry", error);
        }
    }
}

fn emit_system_integration_event(app: &tauri::AppHandle, event: SystemIntegrationEvent) {
    if let Err(error) = app.emit(SYSTEM_INTEGRATION_EVENT, event) {
        log_native_error("publishing system integration state", error);
    }
}

fn emit_integration_status(app: &tauri::AppHandle, integration: &DesktopIntegration) {
    match integration.status() {
        Ok(status) => emit_system_integration_event(app, SystemIntegrationEvent::Status { status }),
        Err(error) => emit_system_integration_event(app, SystemIntegrationEvent::Error { error }),
    }
}

#[cfg(debug_assertions)]
fn run_runtime_command(
    app: &tauri::AppHandle,
    result: Result<RuntimeChange, RuntimeFailure>,
) -> CommandResult<RuntimeSnapshot> {
    match &result {
        Ok(change) => emit_runtime_change(app, change),
        Err(failure) => emit_runtime_change(app, &failure.change),
    }
    map_runtime_result(result)
}

fn publish_integration_failure(
    app: &tauri::AppHandle,
    failure: IntegrationFailure,
) -> RuntimeError {
    if let Some(change) = failure.runtime_change {
        emit_runtime_change(app, &change);
    }
    emit_system_integration_event(
        app,
        SystemIntegrationEvent::Error {
            error: failure.error.clone(),
        },
    );
    failure.error
}

fn run_integrated_runtime_command(
    app: &tauri::AppHandle,
    integration: &DesktopIntegration,
    result: Result<RuntimeChange, IntegrationFailure>,
) -> CommandResult<RuntimeSnapshot> {
    let command_result = match result {
        Ok(change) => {
            emit_runtime_change(app, &change);
            emit_integration_status(app, integration);
            CommandResult::success(change.snapshot)
        }
        Err(failure) => CommandResult::failure(publish_integration_failure(app, failure)),
    };
    refresh_tray_menu(app);
    command_result
}

fn run_data_command<T>(
    app: &tauri::AppHandle,
    result: Result<T, RuntimeFailure>,
) -> CommandResult<T> {
    map_data_result(result, |change| emit_runtime_change(app, change))
}

fn validate_identifier(
    label: &str,
    value: &str,
    code: RuntimeErrorCode,
) -> Result<(), RuntimeError> {
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_LENGTH
        || value.chars().any(char::is_control)
    {
        return Err(RuntimeError::new(
            code,
            format!("The {label} is empty, too long, or contains invalid characters."),
            false,
        ));
    }
    Ok(())
}

fn bounded_delay_timeout(timeout_ms: u32) -> u32 {
    timeout_ms.clamp(1, MAX_DELAY_TIMEOUT_MS)
}

fn runtime_health_interval(window_visible: bool) -> Duration {
    if window_visible {
        RUNTIME_HEALTH_VISIBLE_INTERVAL
    } else {
        RUNTIME_HEALTH_HIDDEN_INTERVAL
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if let Err(error) = window.unminimize() {
            log_native_error("unminimizing the main window", error);
        }

        if let Err(error) = window.show() {
            log_native_error("showing the main window", error);
            return;
        }

        if let Err(error) = window.set_focus() {
            log_native_error("focusing the main window", error);
        }

        if let Err(error) = window.emit(APP_VISIBILITY_EVENT, false) {
            log_native_error("notifying the webview that the window is visible", error);
        }
    }
}

/// Restores the interface scale and the window size remembered from the last
/// session.
///
/// Every step is best-effort: a window that cannot be resized or zoomed simply
/// keeps its configured default, and the operator can change both again from
/// Settings.
fn restore_window_preferences(app: &tauri::AppHandle, settings: &DesktopSettings) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if let Err(error) = window.set_zoom(f64::from(settings.ui_scale) / 100.0) {
            log_native_error("restoring the interface scale", error);
        }

        if let (Some(width), Some(height)) = (settings.window_width, settings.window_height) {
            if let Err(error) = window.set_size(tauri::PhysicalSize::new(width, height)) {
                log_native_error("restoring the main window size", error);
            }
        }
    }
}

/// Persists the current window size so the next launch reopens at the same
/// size. Minimized and maximized sizes are skipped — they describe the window
/// state, not the operator's preferred size.
fn remember_window_size(window: &tauri::Window) {
    if window.is_minimized().unwrap_or(true) || window.is_maximized().unwrap_or(false) {
        return;
    }
    let Ok(size) = window.inner_size() else {
        return;
    };
    if size.width == 0 || size.height == 0 {
        return;
    }

    let app = window.app_handle();
    let state = app.state::<AppState>();
    let mut current = state.settings();
    if current.window_width == Some(size.width) && current.window_height == Some(size.height) {
        return;
    }
    current.window_width = Some(size.width);
    current.window_height = Some(size.height);

    if let Err(error) = state.update_settings(current) {
        log_native_error("remembering the main window size", &error);
    }
}

/// Builds the tray menu.
///
/// The state and current-node lines are disabled items: they report, they do
/// not act. They are only rebuilt when the state or the node changes (see
/// [`refresh_tray`]), so the every-tick path costs one tooltip update.
fn build_tray_menu(
    app: &tauri::AppHandle,
    summary: &TraySummary,
    mode: Option<RoutingMode>,
) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<AppState>();
    let settings = state.settings();
    let language = settings.language;
    let strings = tray_strings::tray_strings(language);
    let (connection_label, connection_enabled) =
        tray_strings::connection_label(language, summary.state);

    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::with_capacity(6);
    if settings.tray_show_info {
        let status = format!(
            "{}: {}",
            strings.status,
            tray_strings::state_label(language, summary.state)
        );
        items.push(MenuItem::with_id(
            app,
            TRAY_STATUS_ID,
            status,
            false,
            None::<&str>,
        )?);
        let node = summary.node.as_deref().unwrap_or(strings.no_node);
        items.push(MenuItem::with_id(
            app,
            TRAY_NODE_ID,
            format!("{}: {node}", strings.node),
            false,
            None::<&str>,
        )?);
    }

    items.push(MenuItem::with_id(
        app,
        TRAY_TOGGLE_CONNECTION_ID,
        connection_label,
        connection_enabled,
        None::<&str>,
    )?);
    // Routing mode is hot-reloadable in Mihomo, so the tray can switch it
    // without restarting the core. The entries are disabled while it is down.
    let core_running = matches!(
        summary.state,
        RuntimeState::Connected | RuntimeState::RunningDisconnected
    );
    for (value, label) in [
        (RoutingMode::Rule, strings.mode_rule),
        (RoutingMode::Global, strings.mode_global),
        (RoutingMode::Direct, strings.mode_direct),
    ] {
        // The active mode is marked in the label: a check-mark menu item
        // needs its own state plumbing, and the label reads in both themes.
        let label = if mode == Some(value) {
            format!("✓ {label}")
        } else {
            label.to_owned()
        };
        items.push(MenuItem::with_id(
            app,
            format!("{TRAY_MODE_PREFIX}{}", value.as_wire_value()),
            label,
            core_running,
            None::<&str>,
        )?);
    }

    items.push(MenuItem::with_id(
        app,
        TRAY_OPEN_LOGS_ID,
        strings.open_logs,
        true,
        None::<&str>,
    )?);
    items.push(MenuItem::with_id(
        app,
        "show",
        strings.show,
        true,
        None::<&str>,
    )?);
    items.push(MenuItem::with_id(
        app,
        "exit",
        strings.exit,
        true,
        None::<&str>,
    )?);

    let references: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|item| item as _).collect();
    Menu::with_items(app, &references)
}

/// Updates the tray menu, tooltip and icon from the current Runtime state.
///
/// Each of the three is updated independently so a rate change never triggers
/// a menu rebuild:
/// - menu: only when the state or node changed;
/// - tooltip: on every call (it is a cheap `NIM_MODIFY`);
/// - icon: only when the rendered rate text changed.
fn refresh_tray(app: &tauri::AppHandle, state: &AppState, summary: TraySummary) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        log_native_error("reading the tray icon", "the tray icon is unavailable");
        return;
    };
    let settings = state.settings();
    let language = settings.language;
    let speed = summary.speed_label();

    let previous = state.stored_tray_summary();
    let menu_changed = match previous.as_ref() {
        Some(previous) => previous.needs_menu_refresh(&summary),
        None => true,
    };
    if menu_changed {
        let mode = state.current_routing_mode();
        match build_tray_menu(app, &summary, mode).and_then(|menu| tray.set_menu(Some(menu))) {
            Ok(()) => {}
            Err(error) => log_native_error("refreshing the tray menu", error),
        }
    }

    if settings.tray_show_info {
        let tooltip = tray_strings::tooltip(
            language,
            summary.state,
            summary.node.as_deref(),
            speed.as_deref(),
        );
        if let Err(error) = tray.set_tooltip(Some(tooltip)) {
            log_native_error("updating the tray tooltip", error);
        }
    } else if let Err(error) = tray.set_tooltip(Some(tray_strings::tray_strings(language).tooltip))
    {
        log_native_error("resetting the tray tooltip", error);
    }

    // The icon is the expensive part of the tick (a bitmap plus a main-thread
    // round trip), so the icon is only redrawn when the rate text changed and
    // the operator asked for the icon display. Switching the mode back to
    // tooltip/off while a speed icon is showing restores the app icon once.
    let previous_speed = previous
        .as_ref()
        .and_then(|previous| previous.speed_label());
    let wants_speed_icon =
        matches!(settings.tray_speed_display, TraySpeedDisplay::Icon) && speed.is_some();
    if wants_speed_icon && previous_speed != speed {
        let image = speed_icon::render(summary.upload_bps, summary.download_bps);
        if let Err(error) = tray.set_icon(Some(image)) {
            log_native_error("updating the tray speed icon", error);
        }
    } else if !wants_speed_icon && previous_speed.is_some() {
        if let Some(icon) = app.default_window_icon() {
            if let Err(error) = tray.set_icon(Some(icon.clone())) {
                log_native_error("restoring the tray icon", error);
            }
        }
    }

    state.store_tray_summary(summary);
}

/// Rebuilds the tray from a fresh read.
///
/// Used after a lifecycle or settings change, which is exactly when the
/// selected node may have moved, so the node is re-read here.
fn refresh_tray_menu(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let summary = state.read_tray_summary(true);
    refresh_tray(app, state.inner(), summary);
}

fn run_tray_connection_action(app: &tauri::AppHandle, state: &AppState) {
    let runtime = state.runtime.snapshot();
    let result = match runtime.state {
        flowproxy_contracts::RuntimeState::Stopped | flowproxy_contracts::RuntimeState::Error => {
            Some(state.system_integration.start_runtime())
        }
        flowproxy_contracts::RuntimeState::RunningDisconnected
        | flowproxy_contracts::RuntimeState::Connected => {
            Some(state.system_integration.stop_runtime())
        }
        _ => None,
    };

    if let Some(result) = result {
        if let CommandResult::Failure(error) =
            run_integrated_runtime_command(app, state.system_integration.as_ref(), result)
        {
            log_native_error("performing the tray connection action", error);
        }
    }
    refresh_tray_menu(app);
}

/// Switches the routing mode from the tray.
///
/// Goes through the same runtime call the Proxies page uses, so the webview
/// learns about the change through the usual state events.
fn run_tray_mode_action(app: &tauri::AppHandle, state: &AppState, mode: &str) {
    let Some(mode) = RoutingMode::parse(mode) else {
        return;
    };
    match state.runtime.update_core_preferences(Some(mode), None) {
        Ok(_) => refresh_tray_menu(app),
        Err(failure) => {
            emit_runtime_change(app, &failure.change);
            log_native_error("switching the routing mode from the tray", &failure.error);
        }
    }
}

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let initial_summary = app.state::<AppState>().read_tray_summary(true);
    let initial_mode = app.state::<AppState>().current_routing_mode();
    let menu = build_tray_menu(app.handle(), &initial_summary, initial_mode)?;
    let language = app.state::<AppState>().settings().language;
    let tooltip = tray_strings::tooltip(
        language,
        initial_summary.state,
        initial_summary.node.as_deref(),
        initial_summary.speed_label().as_deref(),
    );

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(tooltip)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_TOGGLE_CONNECTION_ID => {
                let state = app.state::<AppState>();
                run_tray_connection_action(app, state.inner());
            }
            TRAY_OPEN_LOGS_ID => {
                let state = app.state::<AppState>();
                if let Err(error) = logging::open_directory(&state.logs) {
                    log_native_error("opening the log directory from the tray", error);
                }
            }
            id if id.starts_with(TRAY_MODE_PREFIX) => {
                let mode = id.trim_start_matches(TRAY_MODE_PREFIX);
                let state = app.state::<AppState>();
                run_tray_mode_action(app, state.inner(), mode);
            }
            "show" => show_main_window(app),
            "exit" => {
                let state = app.state::<AppState>();
                if let Err(error) = request_controlled_exit(app, state.inner()) {
                    log_native_error("performing the tray Exit action", error);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[tauri::command]
fn get_runtime_snapshot(state: State<'_, AppState>) -> CommandResult<RuntimeSnapshot> {
    CommandResult::success(state.runtime.snapshot())
}

#[tauri::command]
fn start_runtime(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<RuntimeSnapshot> {
    run_integrated_runtime_command(
        &app,
        state.system_integration.as_ref(),
        state.system_integration.start_runtime(),
    )
}

#[tauri::command]
fn stop_runtime(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<RuntimeSnapshot> {
    run_integrated_runtime_command(
        &app,
        state.system_integration.as_ref(),
        state.system_integration.stop_runtime(),
    )
}

#[tauri::command]
fn restart_runtime(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<RuntimeSnapshot> {
    run_integrated_runtime_command(
        &app,
        state.system_integration.as_ref(),
        state.system_integration.restart_runtime(),
    )
}

#[tauri::command]
fn get_system_integration_status(
    state: State<'_, AppState>,
) -> CommandResult<SystemIntegrationStatus> {
    match state.system_integration.status() {
        Ok(status) => CommandResult::success(status),
        Err(error) => CommandResult::failure(error),
    }
}

#[tauri::command]
fn set_system_proxy_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> CommandResult<SystemIntegrationStatus> {
    match state.system_integration.set_system_proxy_enabled(enabled) {
        Ok(status) => {
            persist_system_proxy_choice(state.inner(), enabled);
            emit_system_integration_event(
                &app,
                SystemIntegrationEvent::Status {
                    status: status.clone(),
                },
            );
            CommandResult::success(status)
        }
        Err(failure) => CommandResult::failure(publish_integration_failure(&app, failure)),
    }
}

/// Remembers whether the operator wants FlowProxy to own the system proxy.
///
/// The OS value is restored on every exit, so without this a relaunch would
/// leave the system proxy off even though the operator turned it on. A save
/// failure is logged and ignored: the toggle already took effect.
fn persist_system_proxy_choice(state: &AppState, enabled: bool) {
    let mut settings = state.settings();
    if settings.system_proxy_enabled == enabled {
        return;
    }
    settings.system_proxy_enabled = enabled;
    let settings = settings.normalized();
    if let Err(error) = state.settings_store.save(&settings) {
        log_native_error("remembering the system proxy choice", error);
        return;
    }
    *state
        .settings
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = settings;
}

#[tauri::command]
fn set_launch_at_login_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> CommandResult<SystemIntegrationStatus> {
    match state
        .system_integration
        .set_launch_at_login_enabled(enabled)
    {
        Ok(status) => {
            emit_system_integration_event(
                &app,
                SystemIntegrationEvent::Status {
                    status: status.clone(),
                },
            );
            CommandResult::success(status)
        }
        Err(failure) => CommandResult::failure(publish_integration_failure(&app, failure)),
    }
}

#[tauri::command]
fn get_core_info(app: tauri::AppHandle, state: State<'_, AppState>) -> CommandResult<CoreInfo> {
    run_data_command(&app, state.runtime.core_info())
}

#[tauri::command]
fn get_telemetry(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<TelemetrySnapshot> {
    run_data_command(&app, state.runtime.telemetry())
}

#[tauri::command]
fn get_proxy_groups(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProxyGroup>> {
    run_data_command(&app, state.runtime.proxy_groups())
}

#[tauri::command]
fn select_proxy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    group: String,
    proxy: String,
) -> CommandResult<()> {
    if let Err(error) = validate_identifier(
        "proxy group name",
        &group,
        RuntimeErrorCode::SelectionFailed,
    ) {
        return CommandResult::failure(error);
    }
    if let Err(error) = validate_identifier("proxy name", &proxy, RuntimeErrorCode::SelectionFailed)
    {
        return CommandResult::failure(error);
    }
    let result = run_data_command(&app, state.runtime.select_proxy(&group, &proxy));
    // The tray shows the selected node, so a successful switch has to reach it
    // without waiting for the next state change.
    if matches!(result, CommandResult::Success(_)) {
        refresh_tray_menu(&app);
    }
    result
}

#[tauri::command]
fn test_proxy_delay(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    proxy: String,
    timeout_ms: u32,
) -> CommandResult<u32> {
    if let Err(error) = validate_identifier("proxy name", &proxy, RuntimeErrorCode::SelectionFailed)
    {
        return CommandResult::failure(error);
    }
    let result = run_data_command(
        &app,
        state
            .runtime
            .test_proxy_delay(&proxy, bounded_delay_timeout(timeout_ms)),
    );
    if let CommandResult::Success(delay) = &result {
        state.record_delay(&proxy, *delay);
    }
    result
}

#[tauri::command]
fn test_group_delay(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    group: String,
    timeout_ms: u32,
) -> CommandResult<GroupDelayResult> {
    if let Err(error) = validate_identifier(
        "proxy group name",
        &group,
        RuntimeErrorCode::SelectionFailed,
    ) {
        return CommandResult::failure(error);
    }
    let result = run_data_command(
        &app,
        state
            .runtime
            .test_group_delay(&group, bounded_delay_timeout(timeout_ms)),
    );
    if let CommandResult::Success(samples) = &result {
        for sample in &samples.delays {
            state.record_delay(&sample.proxy, sample.delay_ms);
        }
    }
    result
}

/// Returns the latency history recorded so far.
#[tauri::command]
fn get_delay_history(state: State<'_, AppState>) -> CommandResult<DelayHistory> {
    CommandResult::success(state.delay_history())
}

/// Returns today's accumulated transfer, plus the last seven days.
#[tauri::command]
fn get_traffic_today(state: State<'_, AppState>) -> CommandResult<traffic::TrafficSummary> {
    CommandResult::success(state.traffic.summary())
}

#[tauri::command]
fn get_core_preferences(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<CorePreferences> {
    run_data_command(&app, state.runtime.core_preferences())
}

#[tauri::command]
fn set_core_preferences(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mode: Option<RoutingMode>,
    log_level: Option<LogLevel>,
) -> CommandResult<CorePreferences> {
    run_data_command(&app, state.runtime.update_core_preferences(mode, log_level))
}

#[tauri::command]
fn get_connections(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<ConnectionPage> {
    run_data_command(&app, state.runtime.connections())
}

#[tauri::command]
fn close_connection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> CommandResult<()> {
    if let Err(error) = validate_identifier(
        "connection identifier",
        &connection_id,
        RuntimeErrorCode::ConnectionNotFound,
    ) {
        return CommandResult::failure(error);
    }
    run_data_command(&app, state.runtime.close_connection(&connection_id))
}

#[tauri::command]
fn close_all_connections(app: tauri::AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    run_data_command(&app, state.runtime.close_all_connections())
}

#[tauri::command]
fn get_rules(app: tauri::AppHandle, state: State<'_, AppState>) -> CommandResult<Vec<RuleItem>> {
    run_data_command(&app, state.runtime.rules())
}

/// Providers the active profile declares. Read-only by design.
#[tauri::command]
fn get_providers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProviderInfo>> {
    run_data_command(&app, state.runtime.providers())
}

#[tauri::command]
fn get_profiles(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProfileInfo>> {
    run_data_command(&app, state.runtime.profiles())
}

/// Returns the stored subscription's groups and rules so the pages have
/// something to show while the Runtime is stopped.
#[tauri::command]
fn get_subscription_snapshot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<SubscriptionSnapshot> {
    run_data_command(&app, state.runtime.subscription_snapshot())
}

/// Imports a subscription from pasted YAML or, when `url` is given, downloads
/// it first. The download happens before the Runtime lock is taken so a slow
/// upstream cannot block start/stop.
#[tauri::command]
fn import_subscription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    yaml: Option<String>,
    url: Option<String>,
    target: Option<String>,
) -> CommandResult<Vec<ProfileInfo>> {
    // A target means "replace that entry"; a fresh import clears it so an
    // earlier refresh target cannot leak into an unrelated import.
    state.runtime.set_pending_subscription_target(target);
    let document = match (yaml, url) {
        (Some(yaml), _) if !yaml.trim().is_empty() => {
            // A pasted document has no download and therefore no usage header;
            // clearing it keeps an earlier import's numbers out of the UI.
            state.runtime.set_pending_subscription_usage(None);
            // Pasted text goes through the same normalisation as a download so
            // a base64 share-link list works either way.
            flowproxy_mihomo_manager::subscription_convert::normalize(&yaml)
        }
        (_, Some(url)) => {
            let user_agent = state.settings().subscription_user_agent;
            match flowproxy_mihomo_manager::subscription_fetch::fetch_with_user_agent(
                &url,
                user_agent.as_deref(),
            ) {
                Ok((document, usage)) => {
                    // Remembered so the subscription can be refreshed automatically
                    // and re-downloaded on demand.
                    state.runtime.set_pending_subscription_url(Some(url));
                    state
                        .runtime
                        .set_pending_subscription_usage((!usage.is_empty()).then_some(usage));
                    document
                }
                Err(error) => return CommandResult::failure(error),
            }
        }
        _ => {
            return CommandResult::failure(RuntimeError::new(
                RuntimeErrorCode::SubscriptionInvalid,
                "Provide subscription YAML or a subscription URL.",
                false,
            ))
        }
    };

    if document.len() > MAX_SUBSCRIPTION_YAML_BYTES {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::SubscriptionInvalid,
            format!(
                "The subscription is larger than the {} MiB limit.",
                MAX_SUBSCRIPTION_YAML_BYTES / (1024 * 1024)
            ),
            false,
        ));
    }

    if let Err(error) = validate_identifier(
        "subscription name",
        &name,
        RuntimeErrorCode::SubscriptionInvalid,
    ) {
        return CommandResult::failure(error);
    }

    if let Err(failure) = state.runtime.import_subscription(&name, &document) {
        emit_runtime_change(&app, &failure.change);
        return CommandResult::failure(failure.error);
    }

    CommandResult::success(state.runtime.profiles().unwrap_or_default())
}

/// Re-downloads the stored subscription from the URL it was imported from.
///
/// Unlike [`import_subscription`] this takes no arguments: the URL comes from
/// the stored subscription metadata, so a provider token is never sent back to
/// the webview. A subscription that was pasted rather than downloaded has no
/// source URL and reports a clear error.
#[tauri::command]
fn refresh_subscription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProfileInfo>> {
    let Some(url) = state.runtime.subscription_source_url() else {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::SubscriptionInvalid,
            "This subscription was pasted rather than downloaded, so it has no URL to refresh from. Import it again with its URL to enable refreshing.",
            false,
        ));
    };

    let user_agent = state.settings().subscription_user_agent;
    let (document, usage) =
        match flowproxy_mihomo_manager::subscription_fetch::fetch_with_user_agent(
            &url,
            user_agent.as_deref(),
        ) {
            Ok(result) => result,
            Err(error) => return CommandResult::failure(error),
        };

    if document.len() > MAX_SUBSCRIPTION_YAML_BYTES {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::SubscriptionInvalid,
            format!(
                "The subscription is larger than the {} MiB limit.",
                MAX_SUBSCRIPTION_YAML_BYTES / (1024 * 1024)
            ),
            false,
        ));
    }

    // Reuse the active entry's id and name so a refresh updates it in place
    // instead of adding a duplicate subscription.
    let active = state
        .runtime
        .subscription_snapshot()
        .ok()
        .map(|snapshot| (snapshot.id, snapshot.name));
    let (active_id, name) = match active {
        Some((id, name)) => (
            id,
            name.unwrap_or_else(|| "Imported subscription".to_owned()),
        ),
        None => (None, "Imported subscription".to_owned()),
    };
    if let Err(error) = validate_identifier(
        "subscription name",
        &name,
        RuntimeErrorCode::SubscriptionInvalid,
    ) {
        return CommandResult::failure(error);
    }

    // The import path stores the source URL again; keep it so a second refresh
    // still knows where the document came from.
    state.runtime.set_pending_subscription_url(Some(url));
    state.runtime.set_pending_subscription_target(active_id);
    state
        .runtime
        .set_pending_subscription_usage((!usage.is_empty()).then_some(usage));
    if let Err(failure) = state.runtime.import_subscription(&name, &document) {
        emit_runtime_change(&app, &failure.change);
        return CommandResult::failure(failure.error);
    }

    CommandResult::success(state.runtime.profiles().unwrap_or_default())
}

#[tauri::command]
fn clear_subscription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProfileInfo>> {
    if let Err(failure) = state.runtime.clear_subscription() {
        emit_runtime_change(&app, &failure.change);
        return CommandResult::failure(failure.error);
    }

    CommandResult::success(state.runtime.profiles().unwrap_or_default())
}

/// Removes one subscription from the library by id.
#[tauri::command]
fn remove_subscription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<ProfileInfo>> {
    if let Err(failure) = state.runtime.remove_subscription(&id) {
        emit_runtime_change(&app, &failure.change);
        return CommandResult::failure(failure.error);
    }
    publish_subscription_update(&app, None);
    CommandResult::success(state.runtime.profiles().unwrap_or_default())
}

/// Makes a stored subscription the one the next start launches with.
#[tauri::command]
fn activate_subscription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<ProfileInfo>> {
    if let Err(failure) = state.runtime.activate_subscription(&id) {
        emit_runtime_change(&app, &failure.change);
        return CommandResult::failure(failure.error);
    }
    publish_subscription_update(&app, None);
    CommandResult::success(state.runtime.profiles().unwrap_or_default())
}

/// Replaces the operator's custom rules for one subscription, then re-checks
/// the assembled profile so a bad rule fails here rather than at the next start.
#[tauri::command]
fn set_subscription_rules(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    rules: Vec<String>,
) -> CommandResult<Vec<ProfileInfo>> {
    if let Err(failure) = state.runtime.set_subscription_rules(&id, &rules) {
        emit_runtime_change(&app, &failure.change);
        return CommandResult::failure(failure.error);
    }
    publish_subscription_update(&app, None);
    CommandResult::success(state.runtime.profiles().unwrap_or_default())
}

/// Replaces the operator's override YAML for one subscription.
#[tauri::command]
fn set_subscription_override_yaml(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    yaml: Option<String>,
) -> CommandResult<Vec<ProfileInfo>> {
    if let Err(failure) = state
        .runtime
        .set_subscription_override_yaml(&id, yaml.as_deref())
    {
        emit_runtime_change(&app, &failure.change);
        return CommandResult::failure(failure.error);
    }
    publish_subscription_update(&app, None);
    CommandResult::success(state.runtime.profiles().unwrap_or_default())
}

/// Tells every window the subscription library changed.
fn publish_subscription_update(app: &tauri::AppHandle, name: Option<&str>) {
    if let Err(error) = app.emit(SUBSCRIPTION_UPDATED_EVENT, name) {
        log_native_error("publishing the subscription update", error);
    }
}

#[tauri::command]
fn simulate_runtime_crash(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<RuntimeSnapshot> {
    #[cfg(debug_assertions)]
    {
        run_runtime_command(&app, state.runtime.simulate_crash())
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = (&app, &state);
        CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::InvalidState,
            "Crash simulation is unavailable in a release build.",
            false,
        ))
    }
}

#[tauri::command]
fn get_runtime_logs(state: State<'_, AppState>) -> CommandResult<Vec<RuntimeLogEntry>> {
    CommandResult::success(state.runtime.logs())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> CommandResult<DesktopSettings> {
    CommandResult::success(state.settings())
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    settings: DesktopSettings,
) -> CommandResult<DesktopSettings> {
    match state.update_settings(settings) {
        Ok(settings) => {
            // The tray menu is built in Rust, so it has to be rebuilt when the
            // interface language changes.
            refresh_tray_menu(&app);
            CommandResult::success(settings)
        }
        Err(error) => CommandResult::failure(map_settings_error(error)),
    }
}

/// Applies the interface scale to the main webview.
///
/// The stylesheets size everything in `rem` off the root font size, but zooming
/// the webview as well keeps native scrollbars, pointer targets and the OS
/// font-metrics baseline in step with the text.
#[tauri::command]
fn apply_ui_scale(app: tauri::AppHandle, scale: u32) -> CommandResult<u32> {
    let scale = scale.clamp(settings::MIN_UI_SCALE, settings::MAX_UI_SCALE);
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            "The main window is unavailable.",
            true,
        ));
    };
    match window.set_zoom(f64::from(scale) / 100.0) {
        Ok(()) => CommandResult::success(scale),
        Err(error) => CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            format!("The interface scale could not be applied: {error}"),
            true,
        )),
    }
}

#[tauri::command]
fn request_application_exit(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    match request_controlled_exit(&app, state.inner()) {
        Ok(()) => CommandResult::success(()),
        Err(error) => CommandResult::failure(error),
    }
}

fn request_controlled_exit(app: &tauri::AppHandle, state: &AppState) -> Result<(), RuntimeError> {
    if !state.exit_gate.try_begin() {
        return Ok(());
    }

    match state.system_integration.stop_runtime() {
        Ok(change) => {
            emit_runtime_change(app, &change);
            app.exit(0);
            Ok(())
        }
        Err(failure) if failure.error.code == RuntimeErrorCode::NotRunning => {
            if let Some(change) = failure.runtime_change {
                emit_runtime_change(app, &change);
            }
            app.exit(0);
            Ok(())
        }
        Err(failure) => {
            state.exit_gate.reset();
            Err(publish_integration_failure(app, failure))
        }
    }
}

fn spawn_runtime_health_loop(app: tauri::AppHandle) {
    let launch_refresh_pending = app
        .state::<AppState>()
        .settings()
        .update_subscription_on_launch;
    let result = std::thread::Builder::new()
        .name("flowproxy-runtime-health".to_owned())
        .spawn(move || {
            let mut last_subscription_refresh = Instant::now() - AUTO_REFRESH_INITIAL_DELAY;
            let mut launch_refresh_pending = launch_refresh_pending;
            loop {
                let window_visible = app
                    .get_webview_window(MAIN_WINDOW_LABEL)
                    .and_then(|window| window.is_visible().ok())
                    .unwrap_or(true);
                std::thread::sleep(runtime_health_interval(window_visible));
                let state = app.state::<AppState>();
                let outcome = state.system_integration.poll_health();
                let outcome_state_changed = outcome.runtime_change.is_some();
                if let Some(change) = outcome.runtime_change {
                    emit_runtime_change(&app, &change);
                }
                if let Some(error) = outcome.integration_error {
                    emit_system_integration_event(&app, SystemIntegrationEvent::Error { error });
                } else if outcome.integration_changed {
                    emit_integration_status(&app, state.system_integration.as_ref());
                }
                // Two independent reasons to touch the tray: the core state
                // changed, or the live rate did. Both are read from the same
                // cheap summary, so the pipeline runs on every tick and the
                // menu is only rebuilt when the state or node actually moved.
                // The node is re-read only when the core state moved; a node
                // switch from the Proxies page refreshes the tray through
                // `refresh_tray_menu` instead of a `/proxies` poll per tick.
                let state_changed = outcome_state_changed;
                let summary = state.read_tray_summary(state_changed);
                // The same tick also feeds the daily ledger: the cumulative
                // counters are only available while the core runs, and the
                // window may be hidden for hours.
                if let Some(totals) = state.daily_counters() {
                    state.accumulate_traffic(totals.0, totals.1);
                }
                refresh_tray(&app, state.inner(), summary);

                if launch_refresh_pending {
                    launch_refresh_pending = false;
                    if refresh_stored_subscription(&app, state.inner()).is_some() {
                        last_subscription_refresh = Instant::now();
                    }
                }
                maybe_refresh_subscription(&app, state.inner(), &mut last_subscription_refresh);
            }
        });

    if let Err(error) = result {
        log_native_error("starting the Runtime health monitor", error);
    }
}

/// How long after launch the first automatic refresh check may run.
const AUTO_REFRESH_INITIAL_DELAY: Duration = Duration::from_secs(30);
/// Minimum spacing between checks, so a short interval cannot spin the loop.
const AUTO_REFRESH_MIN_SPACING: Duration = Duration::from_secs(60);

/// Re-applies the saved system-proxy choice after a launch.
///
/// The OS was restored to the operator's own settings on the previous exit, so
/// the proxy is off at this point by design. This waits for the core to
/// connect and then enables FlowProxy's proxy again, which is what "I turned it
/// on last time" should mean. A core that never connects leaves the OS
/// untouched.
fn spawn_restore_system_proxy(app: tauri::AppHandle) {
    let result = std::thread::Builder::new()
        .name("flowproxy-restore-system-proxy".to_owned())
        .spawn(move || {
            // The core starts on its own thread and can take a few seconds;
            // poll cheaply rather than sleeping for a fixed worst case.
            let deadline = Instant::now() + Duration::from_secs(30);
            while Instant::now() < deadline {
                let state = app.state::<AppState>();
                if state.runtime.state() == RuntimeState::Connected {
                    let outcome = state.system_integration.restore_enabled_proxy();
                    if let Some(error) = outcome.integration_error {
                        log_native_error("restoring the system proxy at launch", &error);
                        emit_system_integration_event(
                            &app,
                            SystemIntegrationEvent::Error { error },
                        );
                    } else if outcome.integration_changed {
                        emit_integration_status(&app, state.system_integration.as_ref());
                    }
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            log_native_error(
                "restoring the system proxy at launch",
                "the core did not connect within 30 seconds; the system proxy stays as it is",
            );
        });
    if let Err(error) = result {
        log_native_error("starting the system-proxy restore worker", error);
    }
}

/// Connects the core once at launch when the operator asked for it.
///
/// Runs on its own thread so a slow core start never delays the window. The
/// system proxy is left alone: a launch-time connect starts the core, and the
/// operator's existing system-proxy preference is applied on the next start
/// through the Settings switch.
fn spawn_auto_connect(app: tauri::AppHandle) {
    let result = std::thread::Builder::new()
        .name("flowproxy-auto-connect".to_owned())
        .spawn(move || {
            let state = app.state::<AppState>();
            match state.system_integration.start_runtime() {
                Ok(change) => emit_runtime_change(&app, &change),
                Err(failure) => {
                    if let Some(change) = failure.runtime_change {
                        emit_runtime_change(&app, &change);
                    }
                    log_native_error("connecting automatically at launch", &failure.error);
                }
            }
        });
    if let Err(error) = result {
        log_native_error("starting the auto-connect worker", error);
    }
}

/// Downloads the stored subscription again and activates it.
///
/// Shared by the launch-time refresh and the interval-based one so both take
/// exactly the same path: same size cap, same validation, same error surface.
/// Returns the profile name when the document was accepted.
fn refresh_stored_subscription(app: &tauri::AppHandle, state: &AppState) -> Option<String> {
    let url = state.runtime.subscription_source_url()?;
    let user_agent = state.settings().subscription_user_agent;
    let (document, usage) =
        match flowproxy_mihomo_manager::subscription_fetch::fetch_with_user_agent(
            &url,
            user_agent.as_deref(),
        ) {
            Ok(result) => result,
            Err(error) => {
                log_native_error("downloading the stored subscription", error);
                return None;
            }
        };
    if document.len() > MAX_SUBSCRIPTION_YAML_BYTES {
        log_native_error(
            "refreshing the stored subscription",
            "the downloaded document exceeds the size limit",
        );
        return None;
    }

    let active = state
        .runtime
        .subscription_snapshot()
        .ok()
        .map(|snapshot| (snapshot.id, snapshot.name));
    let (active_id, name) = match active {
        Some((id, name)) => (
            id,
            name.unwrap_or_else(|| "Imported subscription".to_owned()),
        ),
        None => (None, "Imported subscription".to_owned()),
    };

    state.runtime.set_pending_subscription_url(Some(url));
    state.runtime.set_pending_subscription_target(active_id);
    state
        .runtime
        .set_pending_subscription_usage((!usage.is_empty()).then_some(usage));
    match state.runtime.import_subscription(&name, &document) {
        Ok(()) => {
            // The webview re-reads profiles and the offline snapshot when this
            // event arrives, so an automatic refresh shows up without a click.
            publish_subscription_update(app, Some(&name));
            // The new nodes only take effect once the core reads them, which
            // happens on the next start. Restarting here is what the operator
            // asked for by enabling the setting; a stopped core stays stopped.
            if state.settings().restart_after_subscription_update {
                restart_after_refresh(app, state);
            }
            Some(name)
        }
        Err(failure) => {
            // A stale upstream that produces an invalid document must not
            // replace the working one; the next tick retries.
            log_native_error("refreshing the subscription automatically", &failure.error);
            None
        }
    }
}

/// Restarts a running core so a freshly refreshed subscription takes effect.
///
/// Goes through the system integration so the system proxy is restored and
/// re-applied around the restart, exactly like the manual Restart button. A
/// stopped or failed core is left alone: an automatic refresh must not start a
/// core the operator shut down.
fn restart_after_refresh(app: &tauri::AppHandle, state: &AppState) {
    let snapshot = state.runtime.snapshot();
    if !matches!(
        snapshot.state,
        RuntimeState::Connected | RuntimeState::RunningDisconnected
    ) {
        return;
    }
    match state.system_integration.restart_runtime() {
        Ok(change) => emit_runtime_change(app, &change),
        Err(failure) => {
            if let Some(change) = failure.runtime_change {
                emit_runtime_change(app, &change);
            }
            log_native_error("restarting after a subscription refresh", &failure.error);
        }
    }
}

/// Re-downloads the stored subscription once its configured interval elapsed.
///
/// The check runs from the health loop because that is the only place with a
/// periodic wake-up; the download itself uses the same fetch path as an import,
/// so a provider failure surfaces as a Runtime log entry rather than a panic.
fn maybe_refresh_subscription(
    app: &tauri::AppHandle,
    state: &AppState,
    last_refresh: &mut Instant,
) {
    let settings = state.settings();
    if settings.subscription_update_hours == 0 {
        return;
    }
    let interval = Duration::from_secs(u64::from(settings.subscription_update_hours) * 60 * 60);
    if last_refresh.elapsed() < interval.max(AUTO_REFRESH_MIN_SPACING) {
        return;
    }

    *last_refresh = Instant::now();
    refresh_stored_subscription(app, state);
}

/// Lists the subscriptions stored on the configured Sub-Store backend.
///
/// Takes the address and token from the caller so the settings page can test a
/// draft before it is saved; an empty token is allowed by backends that do not
/// require authentication.
#[tauri::command]
fn list_substore_subscriptions(
    url: String,
    token: String,
) -> CommandResult<Vec<substore::SubStoreSubscription>> {
    match substore::list(&url, &token) {
        Ok(subscriptions) => CommandResult::success(subscriptions),
        Err(error) => CommandResult::failure(error),
    }
}

/// Imports one of the subscriptions listed by Sub-Store.
///
/// The URL comes from the backend's list, so this is the same download path as
/// an operator-pasted URL; the profile is named after the Sub-Store entry.
#[tauri::command]
fn import_substore_subscription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    url: String,
) -> CommandResult<Vec<ProfileInfo>> {
    if let Err(error) = validate_identifier(
        "subscription name",
        &name,
        RuntimeErrorCode::SubscriptionInvalid,
    ) {
        return CommandResult::failure(error);
    }
    let user_agent = state.settings().subscription_user_agent;
    let (document, usage) =
        match flowproxy_mihomo_manager::subscription_fetch::fetch_with_user_agent(
            &url,
            user_agent.as_deref(),
        ) {
            Ok(result) => result,
            Err(error) => return CommandResult::failure(error),
        };
    if document.len() > MAX_SUBSCRIPTION_YAML_BYTES {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::SubscriptionInvalid,
            format!(
                "The subscription is larger than the {} MiB limit.",
                MAX_SUBSCRIPTION_YAML_BYTES / (1024 * 1024)
            ),
            false,
        ));
    }

    state.runtime.set_pending_subscription_url(Some(url));
    state
        .runtime
        .set_pending_subscription_usage((!usage.is_empty()).then_some(usage));
    if let Err(failure) = state.runtime.import_subscription(&name, &document) {
        emit_runtime_change(&app, &failure.change);
        return CommandResult::failure(failure.error);
    }

    let profiles = state.runtime.profiles().unwrap_or_default();
    // The subscription page refreshes its list on this event, which is also
    // where the user lands after importing from Settings.
    publish_subscription_update(&app, Some(&name));
    CommandResult::success(profiles)
}

/// Lists the bundled core plus every registered build.
#[tauri::command]
fn get_core_versions(
    state: State<'_, AppState>,
) -> CommandResult<Vec<flowproxy_mihomo_manager::CoreVersion>> {
    let Some(store) = state.core_versions.as_ref() else {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            "The core versions directory is unavailable.",
            false,
        ));
    };
    match store.list() {
        Ok(versions) => CommandResult::success(versions),
        Err(error) => CommandResult::failure(error),
    }
}

/// Registers a build the operator placed in the cores directory.
#[tauri::command]
fn register_core_version(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<flowproxy_mihomo_manager::CoreVersion>> {
    let Some(store) = state.core_versions.as_ref() else {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            "The core versions directory is unavailable.",
            false,
        ));
    };
    if let Err(error) = store.register(&id) {
        return CommandResult::failure(error);
    }
    match store.list() {
        Ok(versions) => CommandResult::success(versions),
        Err(error) => CommandResult::failure(error),
    }
}

/// Switches the core the next start uses. `None` restores the bundled build.
#[tauri::command]
fn activate_core_version(
    state: State<'_, AppState>,
    id: Option<String>,
) -> CommandResult<Vec<flowproxy_mihomo_manager::CoreVersion>> {
    let Some(store) = state.core_versions.as_ref() else {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            "The core versions directory is unavailable.",
            false,
        ));
    };
    if let Err(error) = store.activate(id.as_deref()) {
        return CommandResult::failure(error);
    }
    match store.list() {
        Ok(versions) => CommandResult::success(versions),
        Err(error) => CommandResult::failure(error),
    }
}

/// Opens the directory an operator drops a new core build into.
#[tauri::command]
fn open_core_versions_directory(state: State<'_, AppState>) -> CommandResult<String> {
    let Some(store) = state.core_versions.as_ref() else {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            "The core versions directory is unavailable.",
            false,
        ));
    };
    let directory = store.directory().to_path_buf();
    if let Err(error) = fs::create_dir_all(&directory) {
        return CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            format!("The core versions directory could not be created: {error}"),
            true,
        ));
    }
    match logging::open_path(&directory) {
        Ok(()) => CommandResult::success(directory.to_string_lossy().into_owned()),
        Err(error) => CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            format!("The core versions directory could not be opened: {error}"),
            true,
        )),
    }
}
/// Writes a redacted diagnostic bundle and opens the folder that holds it.
///
/// Everything stays local: the file is written beside the log files and the
/// folder is opened in the platform file manager. A bug report can attach it.
#[tauri::command]
fn export_diagnostics(app: tauri::AppHandle, state: State<'_, AppState>) -> CommandResult<String> {
    let snapshot = state.runtime.snapshot();
    let core = state.runtime.core_info().ok();
    let subscription = state.runtime.subscription_snapshot().ok();
    let settings = state.settings();
    let target = app
        .path()
        .download_dir()
        .or_else(|_| app.path().desktop_dir())
        .unwrap_or_else(|_| state.logs.directory().to_path_buf());

    let input = diagnostics::DiagnosticInput {
        app_version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        settings: &settings,
        runtime: &snapshot,
        core: core.as_ref(),
        subscription: subscription.as_ref(),
        log_directory: state.logs.directory(),
    };

    match diagnostics::write_bundle(&target, &input) {
        Ok(path) => {
            if let Err(error) = diagnostics::open_folder(&target) {
                log_native_error("opening the diagnostics folder", error);
            }
            CommandResult::success(path.to_string_lossy().into_owned())
        }
        Err(error) => CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            format!("The diagnostic bundle could not be written: {error}"),
            true,
        )),
    }
}

/// Opens the directory that holds the rotating log files.
#[tauri::command]
fn open_log_directory(state: State<'_, AppState>) -> CommandResult<String> {
    let path = state.logs.directory().to_path_buf();
    match logging::open_directory(&state.logs) {
        Ok(()) => CommandResult::success(path.to_string_lossy().into_owned()),
        Err(error) => CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            format!("The log directory could not be opened: {error}"),
            true,
        )),
    }
}

/// Deletes every log file FlowProxy created and reports how many were removed.
#[tauri::command]
fn clear_log_files(state: State<'_, AppState>) -> CommandResult<u32> {
    match logging::clear(&state.logs) {
        Ok(removed) => CommandResult::success(removed as u32),
        Err(error) => CommandResult::failure(RuntimeError::new(
            RuntimeErrorCode::Internal,
            format!("The log files could not be removed: {error}"),
            true,
        )),
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            start_runtime,
            stop_runtime,
            restart_runtime,
            simulate_runtime_crash,
            get_core_info,
            get_core_versions,
            register_core_version,
            activate_core_version,
            open_core_versions_directory,
            get_telemetry,
            get_proxy_groups,
            select_proxy,
            test_proxy_delay,
            test_group_delay,
            get_delay_history,
            get_traffic_today,
            get_core_preferences,
            set_core_preferences,
            get_connections,
            close_connection,
            close_all_connections,
            get_rules,
            get_providers,
            get_profiles,
            get_subscription_snapshot,
            import_subscription,
            clear_subscription,
            remove_subscription,
            activate_subscription,
            set_subscription_rules,
            set_subscription_override_yaml,
            refresh_subscription,
            get_runtime_logs,
            get_settings,
            save_settings,
            apply_ui_scale,
            get_system_integration_status,
            set_system_proxy_enabled,
            set_launch_at_login_enabled,
            request_application_exit,
            list_substore_subscriptions,
            import_substore_subscription,
            open_log_directory,
            export_diagnostics,
            clear_log_files,
        ])
        .setup(|app| {
            let config_directory = app.path().app_config_dir()?;
            let settings_store = SettingsStore::new(config_directory.clone());
            let loaded_settings = settings_store.load();
            if let Some(warning) = loaded_settings.warning {
                log_native_error("loading persisted settings", warning);
            }

            let adapter: DesktopAdapter =
                match MihomoCoreAdapter::discover(config_directory.join("mihomo")) {
                    Ok(adapter) => Box::new(adapter),
                    Err(error) => {
                        log_native_error("discovering the locked Mihomo core", &error);
                        Box::new(UnavailableMihomoAdapter::new(error))
                    }
                };
            let runtime = Arc::new(RuntimeManager::new(RuntimeBackend::Mihomo, adapter));
            runtime.apply_startup_preferences(startup_preferences(&loaded_settings.settings));
            runtime.apply_delay_probe(delay_probe_settings(&loaded_settings.settings));
            let executable = std::env::current_exe()?;
            let system_integration = Arc::new(SystemIntegration::new(
                runtime.clone(),
                NativePlatform::new(&config_directory),
                executable,
            ));
            if let Err(error) = system_integration.recover_on_startup() {
                log_native_error("recovering the system proxy on startup", error);
            }
            if let Err(failure) =
                system_integration.set_proxy_bypass(loaded_settings.settings.proxy_bypass.clone())
            {
                log_native_error("applying the saved proxy bypass list", &failure.error);
            }
            let log_directory = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| config_directory.join("logs"));
            let logs = Arc::new(LogFileStore::new(log_directory));
            install_log_sink(logs.clone());
            app.manage(AppState::new(
                runtime,
                system_integration,
                settings_store,
                loaded_settings.settings.clone(),
                logs,
                Some(config_directory.clone()),
            ));
            {
                let state = app.state::<AppState>();
                state.logs.prune();
            }
            install_tray(app)?;
            spawn_runtime_health_loop(app.handle().clone());
            if loaded_settings.settings.auto_connect {
                spawn_auto_connect(app.handle().clone());
            }
            if loaded_settings.settings.system_proxy_enabled {
                spawn_restore_system_proxy(app.handle().clone());
            }
            restore_window_preferences(app.handle(), &loaded_settings.settings);
            if loaded_settings.settings.silent_start {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    if let Err(error) = window.hide() {
                        log_native_error("hiding the main window on a silent start", error);
                    }
                    if let Err(error) = window.emit(APP_VISIBILITY_EVENT, true) {
                        log_native_error(
                            "notifying the webview that the window started hidden",
                            error,
                        );
                    }
                }
            } else {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                let behavior = state.close_behavior();

                api.prevent_close();
                match behavior {
                    CloseBehavior::HideToTray => {
                        if let Err(error) = window.hide() {
                            log_native_error("hiding the main window to the tray", error);
                        } else if let Err(error) = window.emit(APP_VISIBILITY_EVENT, true) {
                            log_native_error(
                                "notifying the webview that the window is hidden",
                                error,
                            );
                        }
                    }
                    CloseBehavior::ExitApplication => {
                        if let Err(error) =
                            request_controlled_exit(window.app_handle(), state.inner())
                        {
                            log_native_error("performing the exit-on-close action", error);
                        }
                    }
                }
            } else if let WindowEvent::Resized(_) = event {
                match window.is_minimized() {
                    Ok(minimized) => {
                        if let Err(error) = window.emit(APP_VISIBILITY_EVENT, minimized) {
                            log_native_error("publishing main window minimized state", error);
                        }
                    }
                    Err(error) => {
                        log_native_error("reading main window minimized state", error);
                    }
                }
                remember_window_size(window);
            } else if let WindowEvent::Focused(true) = event {
                if let Err(error) = window.emit(APP_VISIBILITY_EVENT, false) {
                    log_native_error("publishing main window focus state", error);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run FlowProxy desktop application");
}

#[cfg(test)]
mod tests {
    use super::{
        bounded_delay_timeout, map_data_result, map_runtime_result, runtime_health_interval,
        validate_identifier, AppState, DesktopAdapter, ExitGate, NativePlatform, SystemIntegration,
        MAX_IDENTIFIER_LENGTH,
    };
    use crate::settings::{CloseBehavior, DesktopSettings, SettingsStore, Theme, SETTINGS_VERSION};
    use flowproxy_contracts::{CommandResult, RuntimeBackend, RuntimeErrorCode, RuntimeState};
    use flowproxy_mihomo_manager::FakeMihomoAdapter;
    use flowproxy_runtime::RuntimeManager;
    use serde_json::json;
    use std::path::Path;
    use std::sync::Arc;
    use std::time::Duration;

    fn fake_runtime() -> RuntimeManager<DesktopAdapter> {
        RuntimeManager::new(RuntimeBackend::Mihomo, Box::new(FakeMihomoAdapter::new()))
    }

    fn test_app_state(
        directory: &Path,
        store: SettingsStore,
        settings: DesktopSettings,
    ) -> AppState {
        let runtime = Arc::new(fake_runtime());
        let system_integration = Arc::new(SystemIntegration::new(
            runtime.clone(),
            NativePlatform::new(directory),
            directory.join("FlowProxy.exe"),
        ));
        let logs = Arc::new(crate::logging::LogFileStore::new(directory.join("logs")));
        AppState::new(
            runtime,
            system_integration,
            store,
            settings,
            logs,
            Some(directory.to_path_buf()),
        )
    }

    #[test]
    fn app_state_uses_the_rust_settings_snapshot_for_close_behavior() {
        let directory = tempfile::tempdir().expect("temporary settings directory");
        let store = SettingsStore::new(directory.path());
        let settings = DesktopSettings {
            version: SETTINGS_VERSION,
            theme: Theme::CyberFlow,
            close_behavior: CloseBehavior::ExitApplication,
            ..DesktopSettings::default()
        };
        let state = test_app_state(directory.path(), store, settings);

        assert_eq!(state.close_behavior(), CloseBehavior::ExitApplication);
    }

    #[test]
    fn save_settings_updates_close_behavior_only_after_persisting() {
        let directory = tempfile::tempdir().expect("temporary settings directory");
        let store = SettingsStore::new(directory.path());
        let state = test_app_state(directory.path(), store.clone(), DesktopSettings::default());
        let updated = DesktopSettings {
            version: SETTINGS_VERSION,
            theme: Theme::WarmFlow,
            close_behavior: CloseBehavior::ExitApplication,
            ..DesktopSettings::default()
        };

        state
            .update_settings(updated.clone())
            .expect("persist settings");

        assert_eq!(state.settings(), updated);
        assert_eq!(state.close_behavior(), CloseBehavior::ExitApplication);
        assert_eq!(store.load().settings, updated);
    }

    #[test]
    fn failed_settings_validation_keeps_the_previous_snapshot() {
        let directory = tempfile::tempdir().expect("temporary settings directory");
        let store = SettingsStore::new(directory.path());
        let state = test_app_state(directory.path(), store, DesktopSettings::default());
        let invalid = DesktopSettings {
            version: SETTINGS_VERSION + 1,
            theme: Theme::WarmFlow,
            close_behavior: CloseBehavior::ExitApplication,
            ..DesktopSettings::default()
        };

        state
            .update_settings(invalid)
            .expect_err("unsupported version must fail");

        assert_eq!(state.settings(), DesktopSettings::default());
        assert_eq!(state.close_behavior(), CloseBehavior::HideToTray);
    }

    #[test]
    fn exit_gate_allows_only_one_controlled_exit_attempt() {
        let gate = ExitGate::default();

        assert!(gate.try_begin());
        assert!(!gate.try_begin());
        gate.reset();
        assert!(gate.try_begin());
    }

    #[test]
    fn runtime_result_mapping_preserves_success_snapshot() {
        let runtime = fake_runtime();
        let outcome = runtime.start();
        let snapshot = outcome.as_ref().expect("runtime starts").snapshot.clone();

        let mapped = map_runtime_result(outcome);

        assert_eq!(
            serde_json::to_value(mapped).expect("serialize mapped result"),
            json!({
                "ok": true,
                "data": snapshot
            })
        );
    }

    #[test]
    fn runtime_result_mapping_preserves_structured_failure() {
        let runtime = fake_runtime();
        runtime.start().expect("initial runtime start");
        let failure = runtime.start().expect_err("duplicate runtime start fails");

        let mapped = map_runtime_result(Err(failure));

        match mapped {
            CommandResult::Failure(error) => {
                assert_eq!(error.code, RuntimeErrorCode::AlreadyRunning);
            }
            CommandResult::Success(_) => panic!("expected failure result"),
        }
        assert_eq!(runtime.snapshot().state, RuntimeState::RunningDisconnected);
    }

    #[test]
    fn adapter_result_mapping_publishes_runtime_failure_logs() {
        let runtime = fake_runtime();
        let failure = runtime
            .proxy_groups()
            .expect_err("disconnected Runtime has no proxy data");
        let expected_logs = failure.change.logs.clone();
        let mut published_logs = Vec::new();

        let mapped: CommandResult<()> = map_data_result(Err(failure), |change| {
            published_logs = change.logs.clone();
        });

        match mapped {
            CommandResult::Failure(error) => {
                assert_eq!(error.code, RuntimeErrorCode::InvalidState);
            }
            CommandResult::Success(_) => panic!("expected failure result"),
        }
        assert_eq!(published_logs, expected_logs);
    }

    #[test]
    fn command_inputs_reject_empty_control_characters_and_oversized_values() {
        for invalid in ["", "line\nbreak", &"x".repeat(MAX_IDENTIFIER_LENGTH + 1)] {
            let error =
                validate_identifier("proxy name", invalid, RuntimeErrorCode::SelectionFailed)
                    .expect_err("invalid command input must be rejected");
            assert_eq!(error.code, RuntimeErrorCode::SelectionFailed);
        }

        validate_identifier(
            "proxy name",
            "Tokyo Edge 01",
            RuntimeErrorCode::SelectionFailed,
        )
        .expect("normal proxy names are accepted");
    }

    #[test]
    fn proxy_delay_timeout_is_bounded() {
        assert_eq!(bounded_delay_timeout(0), 1);
        assert_eq!(bounded_delay_timeout(5_000), 5_000);
        assert_eq!(bounded_delay_timeout(u32::MAX), 10_000);
    }

    #[test]
    fn hidden_window_uses_a_slower_runtime_health_poll() {
        assert_eq!(runtime_health_interval(true), Duration::from_millis(1_500));
        assert_eq!(runtime_health_interval(false), Duration::from_millis(5_000));
    }
}
