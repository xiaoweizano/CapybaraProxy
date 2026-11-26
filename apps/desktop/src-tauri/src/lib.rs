mod settings;
mod tray_strings;
mod system_integration;

use flowproxy_contracts::{
    CommandResult, ConnectionPage, CoreInfo, CorePreferences, GroupDelayResult, LogLevel,
    ProfileInfo, ProxyGroup, RoutingMode, RuleItem, RuntimeBackend, RuntimeError, RuntimeErrorCode,
    DelayProbeSettings, RuntimeLogEntry, RuntimeSnapshot, StartupPreferences, SubscriptionSnapshot,
    TelemetrySnapshot,
};
use flowproxy_mihomo_manager::{MihomoAdapter, MihomoCoreAdapter, UnavailableMihomoAdapter};
use flowproxy_runtime::{RuntimeChange, RuntimeFailure, RuntimeManager};
use settings::{CloseBehavior, DesktopSettings, SettingsStore, SettingsStoreError};
use std::fmt::Display;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use system_integration::{
    IntegrationFailure, NativePlatform, SystemIntegration, SystemIntegrationEvent,
    SystemIntegrationStatus,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "flowproxy";
const TRAY_TOGGLE_CONNECTION_ID: &str = "toggle-connection";
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

type DesktopAdapter = Box<dyn MihomoAdapter>;
type DesktopIntegration = SystemIntegration<RuntimeManager<DesktopAdapter>, NativePlatform>;

struct AppState {
    runtime: Arc<RuntimeManager<DesktopAdapter>>,
    system_integration: Arc<DesktopIntegration>,
    settings_store: SettingsStore,
    settings: Mutex<DesktopSettings>,
    exit_gate: ExitGate,
}

impl AppState {
    fn new(
        runtime: Arc<RuntimeManager<DesktopAdapter>>,
        system_integration: Arc<DesktopIntegration>,
        settings_store: SettingsStore,
        settings: DesktopSettings,
    ) -> Self {
        Self {
            runtime,
            system_integration,
            settings_store,
            settings: Mutex::new(settings),
            exit_gate: ExitGate::default(),
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
        self.runtime.apply_startup_preferences(startup_preferences(&settings));
        self.runtime.apply_delay_probe(delay_probe_settings(&settings));
        Ok(settings)
    }
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
    eprintln!("FlowProxy native window error while {action}: {error}");
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

fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<AppState>();
    let runtime = state.runtime.snapshot();
    let language = state.settings().language;
    let strings = tray_strings::tray_strings(language);
    let (connection_label, connection_enabled) =
        tray_strings::connection_label(language, runtime.state);
    let connection = MenuItem::with_id(
        app,
        TRAY_TOGGLE_CONNECTION_ID,
        connection_label,
        connection_enabled,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", strings.show, true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", strings.exit, true, None::<&str>)?;
    Menu::with_items(app, &[&connection, &show, &exit])
}

fn refresh_tray_menu(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        eprintln!("FlowProxy native error: the tray icon is unavailable.");
        return;
    };
    match build_tray_menu(app).and_then(|menu| tray.set_menu(Some(menu))) {
        Ok(()) => {}
        Err(error) => log_native_error("refreshing the tray menu", error),
    }
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

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = build_tray_menu(app.handle())?;
    let language = app.state::<AppState>().settings().language;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(tray_strings::tray_strings(language).tooltip)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_TOGGLE_CONNECTION_ID => {
                let state = app.state::<AppState>();
                run_tray_connection_action(app, state.inner());
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
    run_data_command(&app, state.runtime.select_proxy(&group, &proxy))
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
    run_data_command(
        &app,
        state
            .runtime
            .test_proxy_delay(&proxy, bounded_delay_timeout(timeout_ms)),
    )
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
    run_data_command(
        &app,
        state
            .runtime
            .test_group_delay(&group, bounded_delay_timeout(timeout_ms)),
    )
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
    run_data_command(
        &app,
        state.runtime.update_core_preferences(mode, log_level),
    )
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
fn get_rules(app: tauri::AppHandle, state: State<'_, AppState>) -> CommandResult<Vec<RuleItem>> {
    run_data_command(&app, state.runtime.rules())
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
) -> CommandResult<Vec<ProfileInfo>> {
    let document = match (yaml, url) {
        (Some(yaml), _) if !yaml.trim().is_empty() => {
            // Pasted text goes through the same normalisation as a download so
            // a base64 share-link list works either way.
            flowproxy_mihomo_manager::subscription_convert::normalize(&yaml)
        }
        (_, Some(url)) => match flowproxy_mihomo_manager::subscription_fetch::fetch(&url) {
            Ok(document) => {
                // Remembered so the subscription can be refreshed automatically
                // and re-downloaded on demand.
                state.runtime.set_pending_subscription_url(Some(url));
                document
            }
            Err(error) => return CommandResult::failure(error),
        },
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

    let document = match flowproxy_mihomo_manager::subscription_fetch::fetch(&url) {
        Ok(document) => document,
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

    // Reuse the stored name so the profile keeps its identity across refreshes.
    let name = state
        .runtime
        .profiles()
        .ok()
        .and_then(|profiles| profiles.into_iter().next())
        .map(|profile| profile.name)
        .unwrap_or_else(|| "Imported subscription".to_owned());
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
    let result = std::thread::Builder::new()
        .name("flowproxy-runtime-health".to_owned())
        .spawn(move || {
            let mut last_subscription_refresh =
                std::time::Instant::now() - AUTO_REFRESH_INITIAL_DELAY;
            loop {
                let window_visible = app
                    .get_webview_window(MAIN_WINDOW_LABEL)
                    .and_then(|window| window.is_visible().ok())
                    .unwrap_or(true);
                std::thread::sleep(runtime_health_interval(window_visible));
                let state = app.state::<AppState>();
                let outcome = state.system_integration.poll_health();
                let runtime_changed = outcome.runtime_change.is_some();
                if let Some(change) = outcome.runtime_change {
                    emit_runtime_change(&app, &change);
                }
                if let Some(error) = outcome.integration_error {
                    emit_system_integration_event(&app, SystemIntegrationEvent::Error { error });
                } else if outcome.integration_changed {
                    emit_integration_status(&app, state.system_integration.as_ref());
                }
                if runtime_changed {
                    refresh_tray_menu(&app);
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

/// Re-downloads the stored subscription once its configured interval elapsed.
///
/// The check runs from the health loop because that is the only place with a
/// periodic wake-up; the download itself uses the same fetch path as an import,
/// so a provider failure surfaces as a Runtime log entry rather than a panic.
fn maybe_refresh_subscription(
    app: &tauri::AppHandle,
    state: &AppState,
    last_refresh: &mut std::time::Instant,
) {
    let settings = state.settings();
    if settings.subscription_update_hours == 0 {
        return;
    }
    let interval = Duration::from_secs(u64::from(settings.subscription_update_hours) * 60 * 60);
    if last_refresh.elapsed() < interval.max(AUTO_REFRESH_MIN_SPACING) {
        return;
    }

    let Some(url) = state.runtime.subscription_source_url() else {
        return;
    };
    *last_refresh = std::time::Instant::now();

    let Ok(document) = flowproxy_mihomo_manager::subscription_fetch::fetch(&url) else {
        // A failed refresh keeps the last good document; the next tick retries.
        return;
    };
    if document.len() > MAX_SUBSCRIPTION_YAML_BYTES {
        return;
    }

    let name = state
        .runtime
        .profiles()
        .ok()
        .and_then(|profiles| profiles.into_iter().next())
        .map(|profile| profile.name)
        .unwrap_or_else(|| "Imported subscription".to_owned());

    state.runtime.set_pending_subscription_url(Some(url));
    match state.runtime.import_subscription(&name, &document) {
        Ok(()) => {
            // The webview re-reads profiles and the offline snapshot when this
            // event arrives, so an automatic refresh shows up without a click.
            if let Err(error) = app.emit(SUBSCRIPTION_UPDATED_EVENT, &name) {
                log_native_error("publishing the subscription update", error);
            }
        }
        Err(failure) => {
            // A stale upstream that produces an invalid document must not
            // replace the working one; the next tick retries.
            log_native_error("refreshing the subscription automatically", &failure.error);
        }
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
            get_telemetry,
            get_proxy_groups,
            select_proxy,
            test_proxy_delay,
            test_group_delay,
            get_core_preferences,
            set_core_preferences,
            get_connections,
            close_connection,
            get_rules,
            get_profiles,
            get_subscription_snapshot,
            import_subscription,
            clear_subscription,
            refresh_subscription,
            get_runtime_logs,
            get_settings,
            save_settings,
            apply_ui_scale,
            get_system_integration_status,
            set_system_proxy_enabled,
            set_launch_at_login_enabled,
            request_application_exit,
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
            app.manage(AppState::new(
                runtime,
                system_integration,
                settings_store,
                loaded_settings.settings.clone(),
            ));
            install_tray(app)?;
            spawn_runtime_health_loop(app.handle().clone());
            restore_window_preferences(app.handle(), &loaded_settings.settings);
            show_main_window(app.handle());
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
        AppState::new(runtime, system_integration, store, settings)
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
