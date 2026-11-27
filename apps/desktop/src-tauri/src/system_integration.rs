use capybara_contracts::{RuntimeError, RuntimeErrorCode, RuntimeState};
use capybara_mihomo_manager::MihomoAdapter;
use capybara_platform::{
    PlatformCapabilities, PlatformError, PlatformErrorKind, ProxyRecovery, StartupActionOutcome,
    StartupState, SystemProxySnapshot,
};
use capybara_runtime::{RuntimeChange, RuntimeFailure, RuntimeManager};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformKind {
    Windows,
    #[cfg_attr(windows, allow(dead_code))]
    Macos,
    #[cfg_attr(windows, allow(dead_code))]
    Linux,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemProxyState {
    Disabled,
    Enabled,
    ManagedInactive,
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemProxyStatus {
    pub state: SystemProxyState,
    pub managed: bool,
    pub active: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchAtLoginState {
    Disabled,
    Enabled,
    Conflict,
}

#[derive(Clone, Debug, Serialize)]
pub struct LaunchAtLoginStatus {
    pub state: LaunchAtLoginState,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemIntegrationStatus {
    pub platform: PlatformKind,
    pub capabilities: PlatformCapabilities,
    pub system_proxy: SystemProxyStatus,
    pub launch_at_login: LaunchAtLoginStatus,
    pub last_error: Option<RuntimeError>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SystemIntegrationEvent {
    Status { status: SystemIntegrationStatus },
    Error { error: RuntimeError },
}

#[derive(Clone, Debug)]
pub struct IntegrationFailure {
    pub error: RuntimeError,
    pub runtime_change: Option<Box<RuntimeChange>>,
}

impl IntegrationFailure {
    fn platform(error: RuntimeError) -> Self {
        Self {
            error,
            runtime_change: None,
        }
    }

    fn runtime(failure: RuntimeFailure) -> Self {
        Self {
            error: failure.error,
            runtime_change: Some(failure.change),
        }
    }
}

#[derive(Clone, Debug)]
pub struct HealthOutcome {
    pub runtime_change: Option<RuntimeChange>,
    pub integration_error: Option<RuntimeError>,
    pub integration_changed: bool,
}

pub trait RuntimeControl: Send + Sync {
    fn controlled_proxy_endpoint(&self) -> Result<String, RuntimeFailure>;
    fn start(&self) -> Result<RuntimeChange, RuntimeFailure>;
    fn stop(&self) -> Result<RuntimeChange, RuntimeFailure>;
    fn restart(&self) -> Result<RuntimeChange, RuntimeFailure>;
    fn poll_health(&self) -> Option<RuntimeChange>;
    fn state(&self) -> RuntimeState;
}

impl<A> RuntimeControl for RuntimeManager<A>
where
    A: MihomoAdapter,
{
    fn controlled_proxy_endpoint(&self) -> Result<String, RuntimeFailure> {
        RuntimeManager::controlled_proxy_endpoint(self)
    }

    fn start(&self) -> Result<RuntimeChange, RuntimeFailure> {
        RuntimeManager::start(self)
    }

    fn stop(&self) -> Result<RuntimeChange, RuntimeFailure> {
        RuntimeManager::stop(self)
    }

    fn restart(&self) -> Result<RuntimeChange, RuntimeFailure> {
        RuntimeManager::restart(self)
    }

    fn poll_health(&self) -> Option<RuntimeChange> {
        RuntimeManager::poll_health(self)
    }

    fn state(&self) -> RuntimeState {
        RuntimeManager::state(self)
    }
}

pub trait PlatformControl: Send {
    fn platform(&self) -> PlatformKind;
    fn capabilities(&mut self) -> PlatformCapabilities;
    fn recover_proxy(&mut self) -> Result<ProxyRecovery, PlatformError>;
    fn proxy_snapshot(&mut self) -> Result<SystemProxySnapshot, PlatformError>;
    fn enable_proxy(&mut self, endpoint: &str, bypass: Option<&str>) -> Result<(), PlatformError>;
    fn startup_status(&mut self, executable: &Path) -> Result<StartupState, PlatformError>;
    fn enable_startup(&mut self, executable: &Path) -> Result<StartupActionOutcome, PlatformError>;
    fn disable_startup(&mut self, executable: &Path)
        -> Result<StartupActionOutcome, PlatformError>;
}

pub struct SystemIntegration<R, P> {
    runtime: Arc<R>,
    platform: Mutex<P>,
    executable: PathBuf,
    lifecycle: Mutex<()>,
    pending_proxy_enable: Mutex<bool>,
    /// Bypass list applied with every system-proxy enable. Stored here rather
    /// than passed on each call so the re-enable after a restart uses the same
    /// list the operator configured.
    proxy_bypass: Mutex<Option<String>>,
    last_error: Mutex<Option<RuntimeError>>,
}

impl<R, P> SystemIntegration<R, P>
where
    R: RuntimeControl,
    P: PlatformControl,
{
    pub fn new(runtime: Arc<R>, platform: P, executable: PathBuf) -> Self {
        Self {
            runtime,
            platform: Mutex::new(platform),
            executable,
            lifecycle: Mutex::new(()),
            pending_proxy_enable: Mutex::new(false),
            proxy_bypass: Mutex::new(None),
            last_error: Mutex::new(None),
        }
    }

    pub fn recover_on_startup(&self) -> Result<SystemIntegrationStatus, RuntimeError> {
        if self.lock_platform().platform() != PlatformKind::Windows {
            self.clear_last_error();
            return self.status();
        }

        let result = {
            let mut platform = self.lock_platform();
            platform.recover_proxy()
        };
        match result {
            Ok(_) => {
                self.clear_last_error();
                self.status()
            }
            Err(error) => {
                let runtime_error = self.record_platform_error("recover the system proxy", &error);
                Err(runtime_error)
            }
        }
    }

    pub fn status(&self) -> Result<SystemIntegrationStatus, RuntimeError> {
        let (platform_kind, capabilities) = {
            let mut platform = self.lock_platform();
            let platform_kind = platform.platform();
            let capabilities = platform.capabilities();
            (platform_kind, capabilities)
        };

        if platform_kind != PlatformKind::Windows {
            return Ok(SystemIntegrationStatus {
                platform: platform_kind,
                capabilities,
                system_proxy: SystemProxyStatus {
                    state: SystemProxyState::Disabled,
                    managed: false,
                    active: false,
                },
                launch_at_login: LaunchAtLoginStatus {
                    state: LaunchAtLoginState::Disabled,
                    enabled: false,
                },
                last_error: self.last_error(),
            });
        }

        let (proxy_snapshot, startup_state) = {
            let mut platform = self.lock_platform();
            let proxy_snapshot = platform
                .proxy_snapshot()
                .map_err(|error| self.record_platform_error("read the system proxy", &error))?;
            let startup_state = platform.startup_status(&self.executable).map_err(|error| {
                self.record_platform_error("read launch-at-login settings", &error)
            })?;
            (proxy_snapshot, startup_state)
        };

        let proxy_state = if proxy_snapshot.managed && proxy_snapshot.active {
            SystemProxyState::Enabled
        } else if proxy_snapshot.managed {
            SystemProxyState::ManagedInactive
        } else {
            SystemProxyState::Disabled
        };
        let launch_state = match startup_state {
            StartupState::Enabled => LaunchAtLoginState::Enabled,
            StartupState::Disabled => LaunchAtLoginState::Disabled,
            StartupState::Conflict => LaunchAtLoginState::Conflict,
        };

        Ok(SystemIntegrationStatus {
            platform: platform_kind,
            capabilities,
            system_proxy: SystemProxyStatus {
                state: proxy_state,
                managed: proxy_snapshot.managed,
                active: proxy_snapshot.active,
            },
            launch_at_login: LaunchAtLoginStatus {
                enabled: startup_state == StartupState::Enabled,
                state: launch_state,
            },
            last_error: self.last_error(),
        })
    }

    pub fn set_system_proxy_enabled(
        &self,
        enabled: bool,
    ) -> Result<SystemIntegrationStatus, IntegrationFailure> {
        let _lifecycle = self.lock_lifecycle();

        if enabled {
            let endpoint = self
                .runtime
                .controlled_proxy_endpoint()
                .map_err(IntegrationFailure::runtime)?;
            let existing = {
                let mut platform = self.lock_platform();
                platform
                    .proxy_snapshot()
                    .map_err(|error| self.platform_failure("read the system proxy", &error))?
            };

            if existing.managed && existing.active {
                self.clear_last_error();
                return self.status().map_err(IntegrationFailure::platform);
            }

            if existing.managed {
                let recovery = {
                    let mut platform = self.lock_platform();
                    platform.recover_proxy()
                };
                if let Err(error) = recovery {
                    return Err(self.platform_failure("release the existing system proxy", &error));
                }
            }

            let bypass = self.proxy_bypass();
            let result = {
                let mut platform = self.lock_platform();
                platform.enable_proxy(&endpoint, bypass.as_deref())
            };
            if let Err(error) = result {
                return Err(self.platform_failure("enable the system proxy", &error));
            }
        } else {
            let result = {
                let mut platform = self.lock_platform();
                platform.recover_proxy()
            };
            if let Err(error) = result {
                return Err(self.platform_failure("restore the system proxy", &error));
            }
        }

        self.clear_last_error();
        self.status().map_err(IntegrationFailure::platform)
    }

    pub fn set_launch_at_login_enabled(
        &self,
        enabled: bool,
    ) -> Result<SystemIntegrationStatus, IntegrationFailure> {
        let _lifecycle = self.lock_lifecycle();
        let result = {
            let mut platform = self.lock_platform();
            if enabled {
                platform.enable_startup(&self.executable)
            } else {
                platform.disable_startup(&self.executable)
            }
        };

        if let Err(error) = result {
            return Err(self.platform_failure("update launch-at-login settings", &error));
        }

        self.clear_last_error();
        self.status().map_err(IntegrationFailure::platform)
    }

    pub fn start_runtime(&self) -> Result<RuntimeChange, IntegrationFailure> {
        let _lifecycle = self.lock_lifecycle();
        self.runtime.start().map_err(IntegrationFailure::runtime)
    }

    pub fn stop_runtime(&self) -> Result<RuntimeChange, IntegrationFailure> {
        let _lifecycle = self.lock_lifecycle();
        self.restore_before_runtime_lifecycle("restore the system proxy before stopping")?;
        *self.lock_pending() = false;
        self.runtime.stop().map_err(IntegrationFailure::runtime)
    }

    pub fn restart_runtime(&self) -> Result<RuntimeChange, IntegrationFailure> {
        let _lifecycle = self.lock_lifecycle();
        let proxy_was_active = {
            let mut platform = self.lock_platform();
            let snapshot = platform
                .proxy_snapshot()
                .map_err(|error| self.platform_failure("read the system proxy", &error))?;
            snapshot.managed && snapshot.active
        };
        self.restore_before_runtime_lifecycle("restore the system proxy before restarting")?;
        *self.lock_pending() = proxy_was_active;

        let change = self.runtime.restart();
        match change {
            Ok(change) => {
                if change.snapshot.state == RuntimeState::Connected {
                    self.complete_pending_proxy_enable();
                }
                Ok(change)
            }
            Err(failure) => {
                *self.lock_pending() = false;
                Err(IntegrationFailure::runtime(failure))
            }
        }
    }

    pub fn poll_health(&self) -> HealthOutcome {
        let Some(change) = self.runtime.poll_health() else {
            return HealthOutcome {
                runtime_change: None,
                integration_error: None,
                integration_changed: false,
            };
        };

        let mut integration_error = None;
        let mut integration_changed = false;
        if change.snapshot.state == RuntimeState::Error {
            *self.lock_pending() = false;
            let result = {
                let mut platform = self.lock_platform();
                platform.recover_proxy()
            };
            match result {
                Ok(_) => {
                    self.clear_last_error();
                    integration_changed = true;
                }
                Err(error) => {
                    integration_error = Some(self.record_platform_error(
                        "recover the system proxy after the Runtime exited",
                        &error,
                    ));
                }
            }
        } else if change.snapshot.state == RuntimeState::Connected && *self.lock_pending() {
            integration_changed = true;
            if let Some(error) = self.complete_pending_proxy_enable() {
                integration_error = Some(error);
            }
        }

        HealthOutcome {
            runtime_change: Some(change),
            integration_error,
            integration_changed,
        }
    }

    fn restore_before_runtime_lifecycle(&self, action: &str) -> Result<(), IntegrationFailure> {
        let result = {
            let mut platform = self.lock_platform();
            platform.recover_proxy()
        };
        match result {
            Ok(_) => {
                self.clear_last_error();
                Ok(())
            }
            Err(error) => Err(self.platform_failure(action, &error)),
        }
    }

    fn complete_pending_proxy_enable(&self) -> Option<RuntimeError> {
        if !*self.lock_pending() {
            return None;
        }
        *self.lock_pending() = false;

        let endpoint = match self.runtime.controlled_proxy_endpoint() {
            Ok(endpoint) => endpoint,
            Err(failure) => {
                let error = failure.error.clone();
                self.record_error(error.clone());
                return Some(error);
            }
        };
        let bypass = self.proxy_bypass();
        let result = {
            let mut platform = self.lock_platform();
            platform.enable_proxy(&endpoint, bypass.as_deref())
        };
        match result {
            Ok(()) => {
                self.clear_last_error();
                None
            }
            Err(error) => Some(
                self.record_platform_error("restore the system proxy after restarting", &error),
            ),
        }
    }

    fn platform_failure(&self, action: &str, error: &PlatformError) -> IntegrationFailure {
        let runtime_error = self.record_platform_error(action, error);
        IntegrationFailure::platform(runtime_error)
    }

    /// Re-applies an operator's saved "system proxy on" choice after a launch.
    ///
    /// The OS keeps whatever the operator's proxy client left behind, and
    /// CapybaraProxy restores the journal on exit, so a fresh launch starts with
    /// the proxy pointing somewhere else. This re-enables it once the core is
    /// connected, but never touches a proxy CapybaraProxy does not already own
    /// unless the operator asked for it in settings.
    pub fn restore_enabled_proxy(&self) -> HealthOutcome {
        let mut integration_error = None;
        let mut integration_changed = false;

        if self.runtime.state() != RuntimeState::Connected {
            return HealthOutcome {
                runtime_change: None,
                integration_error,
                integration_changed,
            };
        }

        let snapshot_result = {
            let mut platform = self.lock_platform();
            platform.proxy_snapshot()
        };
        let existing = match snapshot_result {
            Ok(snapshot) => snapshot,
            Err(error) => {
                return HealthOutcome {
                    runtime_change: None,
                    integration_error: Some(
                        self.record_platform_error("read the system proxy", &error),
                    ),
                    integration_changed: false,
                }
            }
        };

        if existing.managed && existing.active {
            return HealthOutcome {
                runtime_change: None,
                integration_error: None,
                integration_changed: false,
            };
        }

        match self.set_system_proxy_enabled(true) {
            Ok(_) => integration_changed = true,
            Err(failure) => integration_error = Some(failure.error),
        }

        HealthOutcome {
            runtime_change: None,
            integration_error,
            integration_changed,
        }
    }

    fn record_platform_error(&self, action: &str, error: &PlatformError) -> RuntimeError {
        eprintln!("CapybaraProxy platform error while attempting to {action}: {error}");
        let runtime_error = RuntimeError::new(
            RuntimeErrorCode::PlatformIntegration,
            format!(
                "CapybaraProxy could not {action}. Review the current network settings before continuing."
            ),
            matches!(
                error.kind,
                PlatformErrorKind::JournalIo
                    | PlatformErrorKind::BackendFailure
                    | PlatformErrorKind::RestoreFailed
            ),
        );
        self.record_error(runtime_error.clone());
        runtime_error
    }

    fn record_error(&self, error: RuntimeError) {
        *self.lock_last_error() = Some(error);
    }

    fn clear_last_error(&self) {
        *self.lock_last_error() = None;
    }

    fn last_error(&self) -> Option<RuntimeError> {
        self.lock_last_error().clone()
    }

    fn lock_platform(&self) -> MutexGuard<'_, P> {
        self.platform
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_lifecycle(&self) -> MutexGuard<'_, ()> {
        self.lifecycle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Replaces the bypass list applied with the next enable, and re-applies
    /// it to an already managed proxy so the change takes effect immediately.
    pub fn set_proxy_bypass(
        &self,
        bypass: Option<String>,
    ) -> Result<SystemIntegrationStatus, IntegrationFailure> {
        let bypass = bypass
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        {
            let mut current = self
                .proxy_bypass
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *current = bypass.clone();
        }

        let managed = {
            let mut platform = self.lock_platform();
            platform
                .proxy_snapshot()
                .map(|snapshot| snapshot.managed && snapshot.active)
                .map_err(|error| self.platform_failure("read the system proxy", &error))?
        };

        if managed {
            let endpoint = self
                .runtime
                .controlled_proxy_endpoint()
                .map_err(IntegrationFailure::runtime)?;
            // Rewriting the bypass list requires a fresh enable: the registry
            // value is written as a whole.
            {
                let mut platform = self.lock_platform();
                platform
                    .recover_proxy()
                    .map_err(|error| self.platform_failure("refresh the system proxy", &error))?;
            }
            let result = {
                let mut platform = self.lock_platform();
                platform.enable_proxy(&endpoint, bypass.as_deref())
            };
            if let Err(error) = result {
                return Err(self.platform_failure("apply the system proxy bypass list", &error));
            }
        }

        self.clear_last_error();
        self.status().map_err(IntegrationFailure::platform)
    }

    /// The configured bypass list, if the operator set one.
    pub fn proxy_bypass(&self) -> Option<String> {
        self.proxy_bypass
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn lock_pending(&self) -> MutexGuard<'_, bool> {
        self.pending_proxy_enable
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_last_error(&self) -> MutexGuard<'_, Option<RuntimeError>> {
        self.last_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(windows)]
pub use windows_platform::NativePlatform;

#[cfg(windows)]
mod windows_platform {
    use super::{
        PlatformControl, PlatformError, PlatformKind, ProxyRecovery, StartupActionOutcome,
        StartupState, SystemProxySnapshot,
    };
    use capybara_platform::{
        capabilities_from_windows_probe, registry_proxy_backend, registry_startup_backend,
        PlatformCapabilities, RealRegistry, RealWinInetNotifier, StartupManager,
        SystemProxyManager, WindowsProxyBackend, WindowsStartupBackend,
    };
    use std::path::Path;

    type WindowsProxy = WindowsProxyBackend<RealRegistry, RealWinInetNotifier>;
    type WindowsStartup = WindowsStartupBackend<RealRegistry>;

    pub struct NativePlatform {
        proxy: SystemProxyManager<WindowsProxy>,
        startup: StartupManager<WindowsStartup>,
    }

    impl NativePlatform {
        pub fn new(config_directory: &Path) -> Self {
            Self {
                proxy: SystemProxyManager::new(
                    config_directory.join("system-proxy.json"),
                    registry_proxy_backend(),
                ),
                startup: StartupManager::new(registry_startup_backend()),
            }
        }
    }

    impl PlatformControl for NativePlatform {
        fn platform(&self) -> PlatformKind {
            PlatformKind::Windows
        }

        fn capabilities(&mut self) -> PlatformCapabilities {
            capabilities_from_windows_probe()
        }

        fn recover_proxy(&mut self) -> Result<ProxyRecovery, PlatformError> {
            self.proxy.recover()
        }

        fn proxy_snapshot(&mut self) -> Result<SystemProxySnapshot, PlatformError> {
            self.proxy.snapshot()
        }

        fn enable_proxy(
            &mut self,
            endpoint: &str,
            bypass: Option<&str>,
        ) -> Result<(), PlatformError> {
            self.proxy.enable_with_overrides(endpoint, bypass)
        }

        fn startup_status(&mut self, executable: &Path) -> Result<StartupState, PlatformError> {
            self.startup.status(executable).map(|status| status.state)
        }

        fn enable_startup(
            &mut self,
            executable: &Path,
        ) -> Result<StartupActionOutcome, PlatformError> {
            self.startup.enable(executable)
        }

        fn disable_startup(
            &mut self,
            executable: &Path,
        ) -> Result<StartupActionOutcome, PlatformError> {
            self.startup.disable(executable)
        }
    }
}

#[cfg(not(windows))]
pub use unsupported_platform::NativePlatform;

#[cfg(not(windows))]
mod unsupported_platform {
    use super::{
        PlatformControl, PlatformError, PlatformKind, ProxyRecovery, StartupActionOutcome,
        StartupState, SystemProxySnapshot,
    };
    use capybara_platform::{
        unverified_capabilities, PlatformCapabilities, PlatformError, PlatformErrorKind,
    };
    use std::path::Path;

    pub struct NativePlatform;

    impl NativePlatform {
        pub fn new(_config_directory: &Path) -> Self {
            Self
        }
    }

    impl PlatformControl for NativePlatform {
        fn platform(&self) -> PlatformKind {
            #[cfg(target_os = "macos")]
            {
                PlatformKind::Macos
            }
            #[cfg(target_os = "linux")]
            {
                PlatformKind::Linux
            }
        }

        fn capabilities(&mut self) -> PlatformCapabilities {
            unverified_capabilities(
                "System integration is implemented and verified on Windows only.",
            )
        }

        fn recover_proxy(&mut self) -> Result<ProxyRecovery, PlatformError> {
            Err(unsupported())
        }

        fn proxy_snapshot(&mut self) -> Result<SystemProxySnapshot, PlatformError> {
            Err(unsupported())
        }

        fn enable_proxy(
            &mut self,
            _endpoint: &str,
            _bypass: Option<&str>,
        ) -> Result<(), PlatformError> {
            Err(unsupported())
        }

        fn startup_status(&mut self, _executable: &Path) -> Result<StartupState, PlatformError> {
            Err(unsupported())
        }

        fn enable_startup(
            &mut self,
            _executable: &Path,
        ) -> Result<StartupActionOutcome, PlatformError> {
            Err(unsupported())
        }

        fn disable_startup(
            &mut self,
            _executable: &Path,
        ) -> Result<StartupActionOutcome, PlatformError> {
            Err(unsupported())
        }
    }

    fn unsupported() -> PlatformError {
        PlatformError {
            kind: PlatformErrorKind::BackendFailure,
            message: "Native system integration is unavailable on this platform.".to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        IntegrationFailure, LaunchAtLoginState, PlatformControl, PlatformKind, RuntimeControl,
        StartupActionOutcome, StartupState, SystemIntegration,
    };
    use capybara_contracts::{
        RuntimeBackend, RuntimeError, RuntimeErrorCode, RuntimeSnapshot, RuntimeState,
    };
    use capybara_platform::{
        CapabilityState, CapabilityStatus, PlatformCapabilities, PlatformError, PlatformErrorKind,
        ProxyRecovery, SystemProxySnapshot,
    };
    use capybara_runtime::{RuntimeChange, RuntimeFailure};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use std::time::Duration;

    fn snapshot(state: RuntimeState, sequence: u64) -> RuntimeSnapshot {
        RuntimeSnapshot {
            backend: RuntimeBackend::Mihomo,
            state,
            sequence,
            started_at_ms: (state != RuntimeState::Stopped).then_some(1_760_000_000_000),
            last_error: None,
            log_count: 0,
        }
    }

    fn change(state: RuntimeState, sequence: u64) -> RuntimeChange {
        RuntimeChange {
            snapshot: snapshot(state, sequence),
            logs: Vec::new(),
        }
    }

    struct FakeRuntime {
        snapshot: Mutex<RuntimeSnapshot>,
        endpoint: Mutex<Option<String>>,
        health: Mutex<Option<RuntimeChange>>,
        stop_delay: Mutex<Duration>,
        active_stops: AtomicUsize,
        max_active_stops: AtomicUsize,
        events: Arc<Mutex<Vec<String>>>,
    }

    impl FakeRuntime {
        fn new(state: RuntimeState, events: Arc<Mutex<Vec<String>>>) -> Self {
            Self {
                snapshot: Mutex::new(snapshot(state, 1)),
                endpoint: Mutex::new(Some("127.0.0.1:49153".to_owned())),
                health: Mutex::new(None),
                stop_delay: Mutex::new(Duration::ZERO),
                active_stops: AtomicUsize::new(0),
                max_active_stops: AtomicUsize::new(0),
                events,
            }
        }

        fn snapshot(&self) -> RuntimeSnapshot {
            self.snapshot.lock().expect("runtime snapshot").clone()
        }

        fn set_snapshot(&self, next: RuntimeSnapshot) {
            *self.snapshot.lock().expect("runtime snapshot") = next;
        }

        fn set_health(&self, next: RuntimeChange) {
            *self.health.lock().expect("runtime health") = Some(next);
        }

        fn record(&self, event: &str) {
            self.events
                .lock()
                .expect("event log")
                .push(event.to_owned());
        }
    }

    impl RuntimeControl for FakeRuntime {
        fn controlled_proxy_endpoint(&self) -> Result<String, RuntimeFailure> {
            self.record("runtime.endpoint");
            let current = self.snapshot();
            if current.state != RuntimeState::Connected {
                return Err(RuntimeFailure {
                    error: RuntimeError::new(
                        RuntimeErrorCode::InvalidState,
                        "Runtime is not connected.",
                        false,
                    ),
                    change: Box::new(RuntimeChange {
                        snapshot: current,
                        logs: Vec::new(),
                    }),
                });
            }
            self.endpoint
                .lock()
                .expect("runtime endpoint")
                .clone()
                .ok_or_else(|| RuntimeFailure {
                    error: RuntimeError::new(
                        RuntimeErrorCode::ApiUnavailable,
                        "Runtime endpoint is unavailable.",
                        true,
                    ),
                    change: Box::new(change(RuntimeState::Connected, 1)),
                })
        }

        fn start(&self) -> Result<RuntimeChange, RuntimeFailure> {
            self.record("runtime.start");
            let next = snapshot(RuntimeState::RunningDisconnected, 2);
            self.set_snapshot(next.clone());
            Ok(RuntimeChange {
                snapshot: next,
                logs: Vec::new(),
            })
        }

        fn stop(&self) -> Result<RuntimeChange, RuntimeFailure> {
            self.record("runtime.stop");
            let active = self.active_stops.fetch_add(1, Ordering::AcqRel) + 1;
            self.max_active_stops.fetch_max(active, Ordering::AcqRel);
            let stop_delay = *self.stop_delay.lock().expect("stop delay");
            if !stop_delay.is_zero() {
                thread::sleep(stop_delay);
            }
            self.active_stops.fetch_sub(1, Ordering::AcqRel);
            let next = snapshot(RuntimeState::Stopped, 3);
            self.set_snapshot(next.clone());
            Ok(RuntimeChange {
                snapshot: next,
                logs: Vec::new(),
            })
        }

        fn restart(&self) -> Result<RuntimeChange, RuntimeFailure> {
            self.record("runtime.restart");
            let next = snapshot(RuntimeState::RunningDisconnected, 4);
            self.set_snapshot(next.clone());
            Ok(RuntimeChange {
                snapshot: next,
                logs: Vec::new(),
            })
        }

        fn state(&self) -> RuntimeState {
            self.snapshot().state
        }

        fn poll_health(&self) -> Option<RuntimeChange> {
            self.record("runtime.health");
            let next = self.health.lock().expect("runtime health").take();
            if let Some(change) = &next {
                self.set_snapshot(change.snapshot.clone());
            }
            next
        }
    }

    struct FakePlatform {
        platform_kind: PlatformKind,
        proxy: SystemProxySnapshot,
        startup: StartupState,
        fail_recover: bool,
        fail_status_reads: bool,
        events: Arc<Mutex<Vec<String>>>,
    }

    impl FakePlatform {
        fn new(events: Arc<Mutex<Vec<String>>>) -> Self {
            Self {
                platform_kind: PlatformKind::Windows,
                proxy: SystemProxySnapshot {
                    managed: false,
                    active: false,
                    endpoint: None,
                },
                startup: StartupState::Disabled,
                fail_recover: false,
                fail_status_reads: false,
                events,
            }
        }

        fn record(&self, event: &str) {
            self.events
                .lock()
                .expect("event log")
                .push(event.to_owned());
        }
    }

    impl PlatformControl for FakePlatform {
        fn platform(&self) -> PlatformKind {
            self.platform_kind.clone()
        }

        fn capabilities(&mut self) -> PlatformCapabilities {
            if self.platform_kind != PlatformKind::Windows {
                return capybara_platform::unverified_capabilities(
                    "System integration is verified on Windows only.",
                );
            }

            let available = || CapabilityStatus {
                state: CapabilityState::Available,
                message: "Available.".to_owned(),
            };
            PlatformCapabilities {
                system_proxy: available(),
                launch_at_login: available(),
                tun: CapabilityStatus {
                    state: CapabilityState::Blocked,
                    message: "Not elevated.".to_owned(),
                },
            }
        }

        fn recover_proxy(&mut self) -> Result<ProxyRecovery, PlatformError> {
            self.record("platform.recover");
            if self.fail_recover {
                return Err(PlatformError {
                    kind: PlatformErrorKind::RestoreFailed,
                    message: "simulated recovery failure".to_owned(),
                });
            }
            if self.proxy.managed {
                self.proxy = SystemProxySnapshot {
                    managed: false,
                    active: false,
                    endpoint: None,
                };
                Ok(ProxyRecovery::Restored)
            } else {
                Ok(ProxyRecovery::NothingToRecover)
            }
        }

        fn proxy_snapshot(&mut self) -> Result<SystemProxySnapshot, PlatformError> {
            self.record("platform.snapshot");
            if self.fail_status_reads {
                return Err(PlatformError {
                    kind: PlatformErrorKind::BackendFailure,
                    message: "simulated unsupported proxy backend".to_owned(),
                });
            }
            Ok(self.proxy.clone())
        }

        fn enable_proxy(
            &mut self,
            endpoint: &str,
            _bypass: Option<&str>,
        ) -> Result<(), PlatformError> {
            self.record("platform.enable");
            self.proxy = SystemProxySnapshot {
                managed: true,
                active: true,
                endpoint: Some(endpoint.to_owned()),
            };
            Ok(())
        }

        fn startup_status(&mut self, _executable: &Path) -> Result<StartupState, PlatformError> {
            self.record("platform.startup_status");
            if self.fail_status_reads {
                return Err(PlatformError {
                    kind: PlatformErrorKind::BackendFailure,
                    message: "simulated unsupported startup backend".to_owned(),
                });
            }
            Ok(self.startup.clone())
        }

        fn enable_startup(
            &mut self,
            _executable: &Path,
        ) -> Result<StartupActionOutcome, PlatformError> {
            self.startup = StartupState::Enabled;
            Ok(StartupActionOutcome::Changed(
                capybara_platform::StartupStatus {
                    state: self.startup.clone(),
                    command: None,
                    expected_command: String::new(),
                },
            ))
        }

        fn disable_startup(
            &mut self,
            _executable: &Path,
        ) -> Result<StartupActionOutcome, PlatformError> {
            self.startup = StartupState::Disabled;
            Ok(StartupActionOutcome::Changed(
                capybara_platform::StartupStatus {
                    state: self.startup.clone(),
                    command: None,
                    expected_command: String::new(),
                },
            ))
        }
    }

    type FakeIntegration = Arc<SystemIntegration<FakeRuntime, FakePlatform>>;
    type SharedEvents = Arc<Mutex<Vec<String>>>;

    fn integration(
        runtime_state: RuntimeState,
    ) -> (FakeIntegration, Arc<FakeRuntime>, SharedEvents) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let runtime = Arc::new(FakeRuntime::new(runtime_state, events.clone()));
        let platform = FakePlatform::new(events.clone());
        let integration = Arc::new(SystemIntegration::new(
            runtime.clone(),
            platform,
            PathBuf::from(r"C:\Program Files\CapybaraProxy\CapybaraProxy.exe"),
        ));
        (integration, runtime, events)
    }

    #[test]
    fn startup_recovery_runs_before_status_is_exposed() {
        let (integration, _runtime, events) = integration(RuntimeState::Stopped);

        let status = integration
            .recover_on_startup()
            .expect("startup recovery succeeds");

        assert_eq!(
            events
                .lock()
                .expect("event log")
                .first()
                .map(String::as_str),
            Some("platform.recover")
        );
        assert_eq!(status.platform, PlatformKind::Windows);
        assert!(!status.system_proxy.managed);
        assert_eq!(status.launch_at_login.state, LaunchAtLoginState::Disabled);
    }

    #[test]
    fn restore_enabled_proxy_leaves_a_stopped_core_alone() {
        let (integration, _runtime, events) = integration(RuntimeState::Stopped);

        let outcome = integration.restore_enabled_proxy();

        assert!(outcome.integration_error.is_none());
        assert!(!outcome.integration_changed);
        assert!(
            !events
                .lock()
                .expect("event log")
                .iter()
                .any(|event| event == "platform.enable"),
            "a stopped core must never touch the system proxy"
        );
    }

    #[test]
    fn restore_enabled_proxy_reapplies_the_bypass_list_once_connected() {
        let (integration, _runtime, events) = integration(RuntimeState::Connected);
        integration
            .set_proxy_bypass(Some("localhost;*.internal".to_owned()))
            .expect("save the bypass list");

        let outcome = integration.restore_enabled_proxy();

        assert!(outcome.integration_error.is_none());
        assert!(outcome.integration_changed);
        assert!(events
            .lock()
            .expect("event log")
            .iter()
            .any(|event| event == "platform.enable"));
    }

    #[test]
    fn restore_enabled_proxy_is_a_no_op_when_the_proxy_is_already_active() {
        let (integration, _runtime, events) = integration(RuntimeState::Connected);
        integration
            .set_system_proxy_enabled(true)
            .expect("enable the system proxy");

        let enables_before = events
            .lock()
            .expect("event log")
            .iter()
            .filter(|event| *event == "platform.enable")
            .count();
        let outcome = integration.restore_enabled_proxy();

        assert!(!outcome.integration_changed);
        assert_eq!(
            events
                .lock()
                .expect("event log")
                .iter()
                .filter(|event| *event == "platform.enable")
                .count(),
            enables_before,
            "an already-active managed proxy must not be enabled twice"
        );
    }

    #[test]
    fn non_windows_status_remains_unverified_without_reading_backends() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let runtime = Arc::new(FakeRuntime::new(RuntimeState::Stopped, events.clone()));
        let mut platform = FakePlatform::new(events.clone());
        platform.platform_kind = PlatformKind::Macos;
        platform.fail_status_reads = true;
        let integration = SystemIntegration::new(
            runtime,
            platform,
            PathBuf::from("/Applications/CapybaraProxy.app"),
        );

        let status = integration
            .status()
            .expect("unverified platform status remains readable");

        assert_eq!(status.platform, PlatformKind::Macos);
        assert_eq!(
            status.capabilities.system_proxy.state,
            CapabilityState::Unverified
        );
        assert_eq!(
            status.capabilities.launch_at_login.state,
            CapabilityState::Unverified
        );
        assert_eq!(status.capabilities.tun.state, CapabilityState::Unverified);
        assert_eq!(status.system_proxy.state, super::SystemProxyState::Disabled);
        assert_eq!(status.launch_at_login.state, LaunchAtLoginState::Disabled);
        assert!(events.lock().expect("event log").is_empty());
    }

    #[test]
    fn non_windows_startup_recovery_skips_unimplemented_proxy_backend() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let runtime = Arc::new(FakeRuntime::new(RuntimeState::Stopped, events.clone()));
        let mut platform = FakePlatform::new(events.clone());
        platform.platform_kind = PlatformKind::Linux;
        platform.fail_recover = true;
        let integration = SystemIntegration::new(
            runtime,
            platform,
            PathBuf::from("/usr/bin/capybara-desktop"),
        );

        let status = integration
            .recover_on_startup()
            .expect("unverified platform startup remains usable");

        assert_eq!(status.platform, PlatformKind::Linux);
        assert_eq!(
            status.capabilities.system_proxy.state,
            CapabilityState::Unverified
        );
        assert!(events.lock().expect("event log").is_empty());
    }

    #[test]
    fn stop_is_aborted_when_system_proxy_recovery_fails() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let runtime = Arc::new(FakeRuntime::new(RuntimeState::Connected, events.clone()));
        let mut platform = FakePlatform::new(events.clone());
        platform.fail_recover = true;
        let integration = SystemIntegration::new(
            runtime,
            platform,
            PathBuf::from(r"C:\Program Files\CapybaraProxy\CapybaraProxy.exe"),
        );

        let failure = integration
            .stop_runtime()
            .expect_err("recovery failure must abort stop");

        assert_eq!(failure.error.code, RuntimeErrorCode::PlatformIntegration);
        assert!(!events
            .lock()
            .expect("event log")
            .iter()
            .any(|event| event == "runtime.stop"));
    }

    #[test]
    fn restart_reenables_only_after_the_replacement_runtime_connects() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let runtime = Arc::new(FakeRuntime::new(RuntimeState::Connected, events.clone()));
        let mut platform = FakePlatform::new(events.clone());
        platform.proxy = SystemProxySnapshot {
            managed: true,
            active: true,
            endpoint: Some("127.0.0.1:49153".to_owned()),
        };
        let integration = SystemIntegration::new(
            runtime.clone(),
            platform,
            PathBuf::from(r"C:\Program Files\CapybaraProxy\CapybaraProxy.exe"),
        );

        integration.restart_runtime().expect("runtime restarts");
        assert!(!events
            .lock()
            .expect("event log")
            .iter()
            .any(|event| event == "platform.enable"));

        runtime.set_health(change(RuntimeState::Connected, 5));
        let outcome = integration.poll_health();

        assert!(outcome.integration_error.is_none());
        assert!(outcome.integration_changed);
        let events = events.lock().expect("event log");
        let recover_index = events
            .iter()
            .position(|event| event == "platform.recover")
            .expect("proxy recovery");
        let restart_index = events
            .iter()
            .position(|event| event == "runtime.restart")
            .expect("runtime restart");
        let enable_index = events
            .iter()
            .position(|event| event == "platform.enable")
            .expect("proxy re-enable");
        assert!(recover_index < restart_index);
        assert!(restart_index < enable_index);
    }

    #[test]
    fn unexpected_runtime_exit_restores_owned_proxy_before_publishing() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let runtime = Arc::new(FakeRuntime::new(RuntimeState::Connected, events.clone()));
        let mut platform = FakePlatform::new(events.clone());
        platform.proxy = SystemProxySnapshot {
            managed: true,
            active: true,
            endpoint: Some("127.0.0.1:49153".to_owned()),
        };
        let integration = SystemIntegration::new(
            runtime.clone(),
            platform,
            PathBuf::from(r"C:\Program Files\CapybaraProxy\CapybaraProxy.exe"),
        );
        runtime.set_health(change(RuntimeState::Error, 6));

        let outcome = integration.poll_health();

        assert_eq!(
            outcome
                .runtime_change
                .as_ref()
                .map(|change| change.snapshot.state),
            Some(RuntimeState::Error)
        );
        assert!(outcome.integration_changed);
        let events = events.lock().expect("event log");
        assert_eq!(events.last().map(String::as_str), Some("platform.recover"));
    }

    #[test]
    fn concurrent_lifecycle_requests_are_serialized() {
        let (integration, runtime, _events) = integration(RuntimeState::Connected);
        *runtime.stop_delay.lock().expect("stop delay") = Duration::from_millis(40);
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();

        for _ in 0..2 {
            let integration = integration.clone();
            let barrier = barrier.clone();
            handles.push(thread::spawn(move || {
                barrier.wait();
                let _ = integration.stop_runtime();
            }));
        }
        barrier.wait();
        for handle in handles {
            handle.join().expect("lifecycle thread");
        }

        assert_eq!(runtime.max_active_stops.load(Ordering::Acquire), 1);
    }

    #[test]
    fn system_proxy_enable_uses_only_the_runtime_controlled_endpoint() {
        let (integration, _runtime, events) = integration(RuntimeState::Connected);

        let status = integration
            .set_system_proxy_enabled(true)
            .expect("enable system proxy");

        assert!(status.system_proxy.active);
        let events = events.lock().expect("event log");
        let endpoint_index = events
            .iter()
            .position(|event| event == "runtime.endpoint")
            .expect("runtime endpoint request");
        let enable_index = events
            .iter()
            .position(|event| event == "platform.enable")
            .expect("platform enable");
        assert!(endpoint_index < enable_index);
    }

    #[test]
    fn system_proxy_enable_is_rejected_while_runtime_is_disconnected() {
        let (integration, _runtime, events) = integration(RuntimeState::RunningDisconnected);

        let failure: IntegrationFailure = integration
            .set_system_proxy_enabled(true)
            .expect_err("disconnected Runtime cannot enable the proxy");

        assert_eq!(failure.error.code, RuntimeErrorCode::InvalidState);
        assert!(!events
            .lock()
            .expect("event log")
            .iter()
            .any(|event| event == "platform.enable"));
    }
}
