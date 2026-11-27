mod log_buffer;
mod redaction;

pub use redaction::redact_sensitive_text;

use flowproxy_contracts::{
    ConnectionPage, CoreInfo, CorePreferences, DelayProbeSettings, GroupDelayResult, LogLevel,
    ProfileInfo, ProviderInfo, ProxyGroup, RoutingMode, RuleItem, RuntimeBackend, RuntimeError,
    RuntimeErrorCode, RuntimeLogEntry, RuntimeLogLevel, RuntimeSnapshot, RuntimeState,
    StartupPreferences, SubscriptionSnapshot, SubscriptionUsage, TelemetrySnapshot,
};
use flowproxy_mihomo_manager::MihomoAdapter;
use log_buffer::LogBuffer;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

const DEMO_LOG_CAPACITY: usize = 500;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeChange {
    pub snapshot: RuntimeSnapshot,
    pub logs: Vec<RuntimeLogEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeFailure {
    pub error: RuntimeError,
    pub change: Box<RuntimeChange>,
}

struct RuntimeInner {
    backend: RuntimeBackend,
    state: RuntimeState,
    sequence: u64,
    started_at_ms: Option<i64>,
    last_error: Option<RuntimeError>,
    logs: LogBuffer,
}

pub struct RuntimeManager<A> {
    inner: Mutex<RuntimeInner>,
    operation: Mutex<()>,
    adapter: Mutex<A>,
}

impl<A> RuntimeManager<A>
where
    A: MihomoAdapter,
{
    pub fn new(backend: RuntimeBackend, adapter: A) -> Self {
        Self {
            inner: Mutex::new(RuntimeInner {
                backend,
                state: RuntimeState::Stopped,
                sequence: 0,
                started_at_ms: None,
                last_error: None,
                logs: LogBuffer::new(DEMO_LOG_CAPACITY),
            }),
            operation: Mutex::new(()),
            adapter: Mutex::new(adapter),
        }
    }

    pub fn new_demo(adapter: A) -> Self {
        Self::new(RuntimeBackend::Demo, adapter)
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        snapshot_locked(&self.lock_inner())
    }

    pub fn logs(&self) -> Vec<RuntimeLogEntry> {
        self.lock_inner().logs.entries()
    }

    /// The Runtime's current state, without taking the operation lock.
    ///
    /// Health loops call this on every tick to decide whether a follow-up
    /// action (such as re-applying the system proxy) is worth attempting.
    pub fn state(&self) -> RuntimeState {
        self.lock_inner().state
    }

    pub fn controlled_proxy_endpoint(&self) -> Result<String, RuntimeFailure> {
        let _operation = self.lock_operation();
        {
            let inner = self.lock_inner();
            if inner.state != RuntimeState::Connected {
                let error = RuntimeError::new(
                    RuntimeErrorCode::InvalidState,
                    "The system proxy can only be enabled while the Runtime is connected.",
                    false,
                );
                return Err(failure_locked(&inner, error, Vec::new()));
            }
        }

        let endpoint = self.lock_adapter().controlled_proxy_endpoint();
        let error = match endpoint.as_deref() {
            None => Some(RuntimeError::new(
                RuntimeErrorCode::ApiUnavailable,
                "The Mihomo proxy endpoint is unavailable.",
                true,
            )),
            Some(endpoint) if !validate_controlled_proxy_endpoint(endpoint) => {
                Some(RuntimeError::new(
                    RuntimeErrorCode::ApiUnavailable,
                    "The Mihomo proxy endpoint is not a valid loopback address.",
                    false,
                ))
            }
            Some(_) => None,
        };
        if let Some(error) = error {
            return Err(failure_locked(&self.lock_inner(), error, Vec::new()));
        }

        Ok(endpoint.expect("validated endpoint"))
    }

    pub fn start(&self) -> Result<RuntimeChange, RuntimeFailure> {
        let _operation = self.lock_operation();
        let mut new_logs = Vec::new();
        {
            let mut inner = self.lock_inner();
            match inner.state {
                RuntimeState::Starting
                | RuntimeState::RunningDisconnected
                | RuntimeState::Connected => {
                    let error = RuntimeError::new(
                        RuntimeErrorCode::AlreadyRunning,
                        "FlowProxy Runtime is already running.",
                        false,
                    );
                    return Err(failure_locked(&inner, error, Vec::new()));
                }
                RuntimeState::Stopping => {
                    let error = RuntimeError::new(
                        RuntimeErrorCode::InvalidState,
                        "FlowProxy Runtime is stopping.",
                        true,
                    );
                    return Err(failure_locked(&inner, error, Vec::new()));
                }
                RuntimeState::PermissionRequired => {
                    let error = RuntimeError::new(
                        RuntimeErrorCode::PermissionRequired,
                        "FlowProxy Runtime requires permission before it can start.",
                        false,
                    );
                    return Err(failure_locked(&inner, error, Vec::new()));
                }
                RuntimeState::Stopped | RuntimeState::Error => {}
            }
            begin_start_locked(&mut inner, &mut new_logs);
        }

        let result = self.lock_adapter().start();
        let mut inner = self.lock_inner();
        match result {
            Ok(()) => {
                finish_start_locked(&mut inner, &mut new_logs);
                Ok(change_locked(&inner, new_logs))
            }
            Err(error) => {
                transition_to_error_locked(&mut inner, &mut new_logs, error.clone());
                Err(failure_locked(&inner, error, new_logs))
            }
        }
    }

    pub fn stop(&self) -> Result<RuntimeChange, RuntimeFailure> {
        let _operation = self.lock_operation();
        let mut new_logs = Vec::new();
        let allow_already_stopped = {
            let mut inner = self.lock_inner();
            if inner.state == RuntimeState::Stopped {
                let error = RuntimeError::new(
                    RuntimeErrorCode::NotRunning,
                    "FlowProxy Runtime is not running.",
                    false,
                );
                return Err(failure_locked(&inner, error, Vec::new()));
            }
            if inner.state == RuntimeState::Stopping {
                let error = RuntimeError::new(
                    RuntimeErrorCode::InvalidState,
                    "FlowProxy Runtime is already stopping.",
                    false,
                );
                return Err(failure_locked(&inner, error, Vec::new()));
            }
            let allow_already_stopped = inner.state == RuntimeState::Error;
            begin_stop_locked(&mut inner, &mut new_logs);
            allow_already_stopped
        };

        let result = self.lock_adapter().stop();
        let mut inner = self.lock_inner();
        match result {
            Ok(()) => {
                finish_stop_locked(&mut inner, &mut new_logs);
                Ok(change_locked(&inner, new_logs))
            }
            Err(error) if allow_already_stopped && error.code == RuntimeErrorCode::NotRunning => {
                finish_stop_locked(&mut inner, &mut new_logs);
                Ok(change_locked(&inner, new_logs))
            }
            Err(error) => {
                transition_to_error_locked(&mut inner, &mut new_logs, error.clone());
                Err(failure_locked(&inner, error, new_logs))
            }
        }
    }

    pub fn restart(&self) -> Result<RuntimeChange, RuntimeFailure> {
        let _operation = self.lock_operation();
        let mut new_logs = Vec::new();
        {
            let mut inner = self.lock_inner();
            if !matches!(
                inner.state,
                RuntimeState::RunningDisconnected | RuntimeState::Connected | RuntimeState::Error
            ) {
                let error = RuntimeError::new(
                    RuntimeErrorCode::InvalidState,
                    "FlowProxy Runtime can only restart after it has started.",
                    false,
                );
                return Err(failure_locked(&inner, error, Vec::new()));
            }
            begin_stop_locked(&mut inner, &mut new_logs);
        }

        let stop_result = self.lock_adapter().stop();
        match stop_result {
            Ok(())
            | Err(RuntimeError {
                code: RuntimeErrorCode::NotRunning,
                ..
            }) => {}
            Err(error) => {
                let mut inner = self.lock_inner();
                transition_to_error_locked(&mut inner, &mut new_logs, error.clone());
                return Err(failure_locked(&inner, error, new_logs));
            }
        }

        {
            let mut inner = self.lock_inner();
            finish_stop_locked(&mut inner, &mut new_logs);
            begin_start_locked(&mut inner, &mut new_logs);
        }

        let start_result = self.lock_adapter().start();
        let mut inner = self.lock_inner();
        match start_result {
            Ok(()) => {
                finish_start_locked(&mut inner, &mut new_logs);
                Ok(change_locked(&inner, new_logs))
            }
            Err(error) => {
                transition_to_error_locked(&mut inner, &mut new_logs, error.clone());
                Err(failure_locked(&inner, error, new_logs))
            }
        }
    }

    pub fn simulate_crash(&self) -> Result<RuntimeChange, RuntimeFailure> {
        let _operation = self.lock_operation();
        {
            let inner = self.lock_inner();
            if inner.backend != RuntimeBackend::Demo {
                let error = RuntimeError::new(
                    RuntimeErrorCode::InvalidState,
                    "Crash simulation is only available for the Demo Runtime.",
                    false,
                );
                return Err(failure_locked(&inner, error, Vec::new()));
            }
            if !matches!(
                inner.state,
                RuntimeState::RunningDisconnected | RuntimeState::Connected
            ) {
                let error = RuntimeError::new(
                    RuntimeErrorCode::NotRunning,
                    "The Demo Runtime must be running before a crash can be simulated.",
                    false,
                );
                return Err(failure_locked(&inner, error, Vec::new()));
            }
        }

        let mut new_logs = Vec::new();
        let result = self.lock_adapter().simulate_crash();
        let mut inner = self.lock_inner();
        match result {
            Ok(()) => {
                let error = RuntimeError::new(
                    RuntimeErrorCode::AdapterFailure,
                    "The Demo Runtime simulated an unexpected core exit.",
                    true,
                );
                transition_locked(&mut inner, RuntimeState::Error);
                inner.started_at_ms = None;
                inner.last_error = Some(error.clone());
                push_log_locked(
                    &mut inner,
                    &mut new_logs,
                    RuntimeLogLevel::Error,
                    error.message.clone(),
                    Some(error.code),
                );
                Ok(change_locked(&inner, new_logs))
            }
            Err(error) => {
                transition_to_error_locked(&mut inner, &mut new_logs, error.clone());
                Err(failure_locked(&inner, error, new_logs))
            }
        }
    }

    pub fn poll_health(&self) -> Option<RuntimeChange> {
        let _operation = self.lock_operation();
        let observed_sequence = {
            let inner = self.lock_inner();
            if matches!(
                inner.state,
                RuntimeState::RunningDisconnected | RuntimeState::Connected | RuntimeState::Error
            ) {
                inner.sequence
            } else {
                return None;
            }
        };

        let (health_result, adapter_logs) = {
            let mut adapter = self.lock_adapter();
            let health_result = adapter.health();
            let logs = adapter.take_logs();
            (health_result, logs)
        };

        let mut new_logs = Vec::new();
        let mut inner = self.lock_inner();
        let published = apply_health_poll_locked(
            &mut inner,
            observed_sequence,
            health_result,
            adapter_logs,
            &mut new_logs,
        );

        published.then(|| change_locked(&inner, new_logs))
    }

    pub fn core_info(&self) -> Result<CoreInfo, RuntimeFailure> {
        self.adapter_data("core information", A::core_info)
    }

    pub fn telemetry(&self) -> Result<TelemetrySnapshot, RuntimeFailure> {
        self.adapter_data("telemetry", A::telemetry)
    }

    pub fn proxy_groups(&self) -> Result<Vec<ProxyGroup>, RuntimeFailure> {
        self.adapter_data("proxy groups", A::proxy_groups)
    }

    pub fn select_proxy(&self, group: &str, proxy: &str) -> Result<(), RuntimeFailure> {
        self.adapter_data("proxy selection", |adapter| {
            adapter.select_proxy(group, proxy)
        })
    }

    pub fn test_proxy_delay(&self, proxy: &str, timeout_ms: u32) -> Result<u32, RuntimeFailure> {
        self.adapter_data("proxy delay", |adapter| {
            adapter.test_proxy_delay(proxy, timeout_ms)
        })
    }

    pub fn test_group_delay(
        &self,
        group: &str,
        timeout_ms: u32,
    ) -> Result<GroupDelayResult, RuntimeFailure> {
        self.adapter_data("group delay", |adapter| {
            adapter.test_group_delay(group, timeout_ms)
        })
    }

    pub fn core_preferences(&self) -> Result<CorePreferences, RuntimeFailure> {
        self.adapter_data("core preferences", A::core_preferences)
    }

    pub fn update_core_preferences(
        &self,
        mode: Option<RoutingMode>,
        log_level: Option<LogLevel>,
    ) -> Result<CorePreferences, RuntimeFailure> {
        self.adapter_data("core preference updates", |adapter| {
            adapter.update_core_preferences(mode, log_level)
        })
    }

    pub fn connections(&self) -> Result<ConnectionPage, RuntimeFailure> {
        self.adapter_data("active connections", A::connections)
    }

    pub fn close_connection(&self, connection_id: &str) -> Result<(), RuntimeFailure> {
        self.adapter_data("connection control", |adapter| {
            adapter.close_connection(connection_id)
        })
    }

    /// Closes every open connection in one call.
    pub fn close_all_connections(&self) -> Result<(), RuntimeFailure> {
        self.adapter_data("connection control", A::close_all_connections)
    }

    pub fn rules(&self) -> Result<Vec<RuleItem>, RuntimeFailure> {
        self.adapter_data("rules", A::rules)
    }

    /// Providers the active profile declares, as reported by the core.
    pub fn providers(&self) -> Result<Vec<ProviderInfo>, RuntimeFailure> {
        self.adapter_data("providers", A::providers)
    }

    /// Returns the stored profile metadata.
    ///
    /// Unlike the other adapter data calls this does not require a connected
    /// Runtime: it reflects the configuration on disk, which is exactly what an
    /// operator needs to see before starting the core.
    /// Read-only summary of the stored subscription for the offline UI.
    ///
    /// Like [`Self::profiles`] this works while the Runtime is stopped, because
    /// it reads the document from disk instead of the control API.
    pub fn subscription_snapshot(&self) -> Result<SubscriptionSnapshot, RuntimeFailure> {
        let _operation = self.lock_operation();
        let result = {
            let mut adapter = self.lock_adapter();
            adapter.subscription_snapshot()
        };
        match result {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                let mut inner = self.lock_inner();
                let mut logs = Vec::new();
                inner.last_error = Some(error.clone());
                push_log_locked(
                    &mut inner,
                    &mut logs,
                    RuntimeLogLevel::Warn,
                    error.message.clone(),
                    Some(error.code),
                );
                Err(failure_locked(&inner, error, logs))
            }
        }
    }

    pub fn profiles(&self) -> Result<Vec<ProfileInfo>, RuntimeFailure> {
        let _operation = self.lock_operation();
        let result = {
            let mut adapter = self.lock_adapter();
            adapter.profiles()
        };
        match result {
            Ok(profiles) => Ok(profiles),
            Err(error) => {
                let mut inner = self.lock_inner();
                let mut logs = Vec::new();
                inner.last_error = Some(error.clone());
                push_log_locked(
                    &mut inner,
                    &mut logs,
                    RuntimeLogLevel::Warn,
                    error.message.clone(),
                    Some(error.code),
                );
                Err(failure_locked(&inner, error, logs))
            }
        }
    }

    /// Installs a subscription and makes it the active profile.
    ///
    /// Unlike [`Self::adapter_data`] this is allowed while the Runtime is
    /// stopped: an operator has to import a subscription *before* the core can
    /// start with it. It is still serialised against start/stop through the
    /// operation lock.
    pub fn import_subscription(&self, name: &str, yaml: &str) -> Result<(), RuntimeFailure> {
        self.adapter_mutation("subscription import", |adapter| {
            adapter.import_subscription(name, yaml)
        })
    }

    /// Removes the imported subscription so the Runtime falls back to the
    /// built-in direct profile.
    pub fn clear_subscription(&self) -> Result<(), RuntimeFailure> {
        self.adapter_mutation("subscription removal", A::clear_subscription)
    }

    /// Removes one subscription by id.
    pub fn remove_subscription(&self, id: &str) -> Result<(), RuntimeFailure> {
        self.adapter_mutation("subscription removal", |adapter| {
            adapter.remove_subscription(id)
        })
    }

    /// Selects the subscription the next start launches with.
    pub fn activate_subscription(&self, id: &str) -> Result<(), RuntimeFailure> {
        self.adapter_mutation("subscription activation", |adapter| {
            adapter.activate_subscription(id)
        })
    }

    /// Replaces the operator's custom rules for one subscription.
    pub fn set_subscription_rules(&self, id: &str, rules: &[String]) -> Result<(), RuntimeFailure> {
        self.adapter_mutation("subscription overrides", |adapter| {
            adapter.set_subscription_rules(id, rules)
        })
    }

    /// Replaces the operator's override YAML for one subscription.
    pub fn set_subscription_override_yaml(
        &self,
        id: &str,
        yaml: Option<&str>,
    ) -> Result<(), RuntimeFailure> {
        self.adapter_mutation("subscription overrides", |adapter| {
            adapter.set_subscription_override_yaml(id, yaml)
        })
    }

    /// Sets the values the adapter writes into the next generated profile.
    ///
    /// This does not touch the running core: the preferences take effect the
    /// next time the Runtime starts or restarts.
    pub fn apply_startup_preferences(&self, preferences: StartupPreferences) {
        let _operation = self.lock_operation();
        self.lock_adapter().set_startup_preferences(preferences);
    }

    /// Sets the target used by latency probes.
    pub fn apply_delay_probe(&self, probe: DelayProbeSettings) {
        let _operation = self.lock_operation();
        self.lock_adapter().set_delay_probe(probe);
    }

    /// Records the source URL for the next subscription import.
    pub fn set_pending_subscription_url(&self, url: Option<String>) {
        let _operation = self.lock_operation();
        self.lock_adapter().set_pending_subscription_url(url);
    }

    /// Records the usage header captured with the next subscription import.
    pub fn set_pending_subscription_usage(&self, usage: Option<SubscriptionUsage>) {
        let _operation = self.lock_operation();
        self.lock_adapter().set_pending_subscription_usage(usage);
    }

    /// Names the stored subscription the next import replaces instead of
    /// creating a new entry. `None` imports as a new subscription.
    pub fn set_pending_subscription_target(&self, id: Option<String>) {
        let _operation = self.lock_operation();
        self.lock_adapter().set_pending_subscription_target(id);
    }

    /// Returns the URL the stored subscription was imported from.
    ///
    /// Reads the metadata file, so it works while the Runtime is stopped.
    pub fn subscription_source_url(&self) -> Option<String> {
        let _operation = self.lock_operation();
        self.lock_adapter().subscription_source_url()
    }

    fn adapter_mutation(
        &self,
        resource: &str,
        operation: impl FnOnce(&mut A) -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeFailure> {
        let _operation = self.lock_operation();
        let result = {
            let mut adapter = self.lock_adapter();
            operation(&mut adapter)
        };
        match result {
            Ok(()) => Ok(()),
            Err(error) => {
                let mut inner = self.lock_inner();
                let mut logs = Vec::new();
                inner.last_error = Some(error.clone());
                push_log_locked(
                    &mut inner,
                    &mut logs,
                    RuntimeLogLevel::Warn,
                    format!("{resource} failed: {}", error.message),
                    Some(error.code),
                );
                Err(failure_locked(&inner, error, logs))
            }
        }
    }

    fn adapter_data<T>(
        &self,
        resource: &str,
        operation: impl FnOnce(&mut A) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeFailure> {
        let _operation = self.lock_operation();
        {
            let inner = self.lock_inner();
            if inner.state != RuntimeState::Connected {
                let error = RuntimeError::new(
                    RuntimeErrorCode::InvalidState,
                    format!("{resource} are unavailable until the Runtime is connected."),
                    false,
                );
                return Err(failure_locked(&inner, error, Vec::new()));
            }
        }

        let result = {
            let mut adapter = self.lock_adapter();
            operation(&mut adapter)
        };
        match result {
            Ok(data) => Ok(data),
            Err(error) => {
                let mut inner = self.lock_inner();
                let mut logs = Vec::new();
                inner.last_error = Some(error.clone());
                push_log_locked(
                    &mut inner,
                    &mut logs,
                    RuntimeLogLevel::Warn,
                    error.message.clone(),
                    Some(error.code),
                );
                Err(failure_locked(&inner, error, logs))
            }
        }
    }

    fn lock_inner(&self) -> MutexGuard<'_, RuntimeInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_operation(&self) -> MutexGuard<'_, ()> {
        self.operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_adapter(&self) -> MutexGuard<'_, A> {
        self.adapter
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn validate_controlled_proxy_endpoint(endpoint: &str) -> bool {
    let Some((host, port)) = endpoint.rsplit_once(':') else {
        return false;
    };
    if host != "127.0.0.1"
        || port.is_empty()
        || !port.bytes().all(|byte| byte.is_ascii_digit())
        || !port.parse::<u16>().is_ok_and(|value| value > 0)
    {
        return false;
    }
    true
}

fn begin_start_locked(inner: &mut RuntimeInner, new_logs: &mut Vec<RuntimeLogEntry>) {
    transition_locked(inner, RuntimeState::Starting);
    inner.last_error = None;
    push_log_locked(
        inner,
        new_logs,
        RuntimeLogLevel::Info,
        "Starting the FlowProxy Runtime.",
        None,
    );
}

fn finish_start_locked(inner: &mut RuntimeInner, new_logs: &mut Vec<RuntimeLogEntry>) {
    transition_locked(inner, RuntimeState::RunningDisconnected);
    inner.started_at_ms = Some(now_ms());
    inner.last_error = None;
    push_log_locked(
        inner,
        new_logs,
        RuntimeLogLevel::Info,
        "FlowProxy Runtime is running without a verified core connection.",
        None,
    );
}

fn begin_stop_locked(inner: &mut RuntimeInner, new_logs: &mut Vec<RuntimeLogEntry>) {
    transition_locked(inner, RuntimeState::Stopping);
    push_log_locked(
        inner,
        new_logs,
        RuntimeLogLevel::Info,
        "Stopping the FlowProxy Runtime.",
        None,
    );
}

fn finish_stop_locked(inner: &mut RuntimeInner, new_logs: &mut Vec<RuntimeLogEntry>) {
    transition_locked(inner, RuntimeState::Stopped);
    inner.started_at_ms = None;
    inner.last_error = None;
    push_log_locked(
        inner,
        new_logs,
        RuntimeLogLevel::Info,
        "FlowProxy Runtime stopped.",
        None,
    );
}

fn apply_health_poll_locked(
    inner: &mut RuntimeInner,
    observed_sequence: u64,
    health_result: Result<(), RuntimeError>,
    adapter_logs: Vec<String>,
    new_logs: &mut Vec<RuntimeLogEntry>,
) -> bool {
    if inner.sequence != observed_sequence {
        return false;
    }

    let mut published = false;
    for message in adapter_logs {
        push_log_locked(inner, new_logs, RuntimeLogLevel::Info, message, None);
        published = true;
    }

    match health_result {
        Ok(()) if inner.state == RuntimeState::RunningDisconnected => {
            transition_locked(inner, RuntimeState::Connected);
            inner.last_error = None;
            push_log_locked(
                inner,
                new_logs,
                RuntimeLogLevel::Info,
                "FlowProxy Runtime verified the Mihomo core connection.",
                None,
            );
            published = true;
        }
        Ok(()) => {}
        Err(error) => {
            let changed =
                inner.state != RuntimeState::Error || inner.last_error.as_ref() != Some(&error);
            if changed {
                transition_to_error_locked(inner, new_logs, error);
            }
            published |= changed;
        }
    }

    published
}

fn transition_to_error_locked(
    inner: &mut RuntimeInner,
    new_logs: &mut Vec<RuntimeLogEntry>,
    error: RuntimeError,
) {
    transition_locked(inner, RuntimeState::Error);
    inner.started_at_ms = None;
    inner.last_error = Some(error.clone());
    push_log_locked(
        inner,
        new_logs,
        RuntimeLogLevel::Error,
        error.message.clone(),
        Some(error.code),
    );
}

fn transition_locked(inner: &mut RuntimeInner, state: RuntimeState) {
    inner.state = state;
    inner.sequence = inner.sequence.saturating_add(1);
}

fn push_log_locked(
    inner: &mut RuntimeInner,
    new_logs: &mut Vec<RuntimeLogEntry>,
    level: RuntimeLogLevel,
    message: impl Into<String>,
    error_code: Option<RuntimeErrorCode>,
) {
    let entry = inner.logs.push(level, message.into(), error_code, now_ms());
    new_logs.push(entry);
}

fn snapshot_locked(inner: &RuntimeInner) -> RuntimeSnapshot {
    RuntimeSnapshot {
        backend: inner.backend,
        state: inner.state,
        sequence: inner.sequence,
        started_at_ms: inner.started_at_ms,
        last_error: inner.last_error.clone(),
        log_count: inner.logs.len(),
    }
}

fn change_locked(inner: &RuntimeInner, logs: Vec<RuntimeLogEntry>) -> RuntimeChange {
    RuntimeChange {
        snapshot: snapshot_locked(inner),
        logs,
    }
}

fn failure_locked(
    inner: &RuntimeInner,
    error: RuntimeError,
    logs: Vec<RuntimeLogEntry>,
) -> RuntimeFailure {
    RuntimeFailure {
        error,
        change: Box::new(change_locked(inner, logs)),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{apply_health_poll_locked, RuntimeChange, RuntimeFailure, RuntimeManager};
    use flowproxy_contracts::{
        ConnectionPage, CoreInfo, CorePreferences, GroupDelayResult, LogLevel, ProfileInfo,
        ProxyGroup, ProxyNode, RoutingMode, RuleItem, RuntimeBackend, RuntimeError,
        RuntimeErrorCode, RuntimeState, TelemetrySnapshot,
    };
    use flowproxy_mihomo_manager::{FakeMihomoAdapter, MihomoAdapter};
    use std::sync::{Arc, Mutex};

    fn expect_success(result: Result<RuntimeChange, RuntimeFailure>) -> RuntimeChange {
        result.unwrap_or_else(|failure| panic!("runtime operation failed: {failure:?}"))
    }

    #[test]
    fn runtime_starts_stopped_and_starts_in_disconnected_demo_state() {
        let runtime = RuntimeManager::new_demo(FakeMihomoAdapter::new());

        let initial = runtime.snapshot();
        assert_eq!(initial.backend, RuntimeBackend::Demo);
        assert_eq!(initial.state, RuntimeState::Stopped);
        assert_eq!(initial.sequence, 0);
        assert_eq!(initial.started_at_ms, None);

        let change = expect_success(runtime.start());

        assert_eq!(change.snapshot.state, RuntimeState::RunningDisconnected);
        assert_eq!(change.snapshot.sequence, 2);
        assert!(change.snapshot.started_at_ms.is_some());
        assert_eq!(change.snapshot.log_count, 2);
        assert_eq!(change.logs.len(), 2);
    }

    #[test]
    fn duplicate_start_is_stable_and_does_not_increment_sequence_or_logs() {
        let runtime = RuntimeManager::new_demo(FakeMihomoAdapter::new());
        let running = expect_success(runtime.start());

        let failure = runtime.start().expect_err("duplicate start must fail");

        assert_eq!(failure.error.code, RuntimeErrorCode::AlreadyRunning);
        assert_eq!(failure.change.snapshot, running.snapshot);
        assert!(failure.change.logs.is_empty());
    }

    #[test]
    fn concurrent_start_calls_create_only_one_running_state() {
        let runtime = Arc::new(RuntimeManager::new_demo(FakeMihomoAdapter::new()));
        let first = Arc::clone(&runtime);
        let second = Arc::clone(&runtime);

        let first_start = std::thread::spawn(move || first.start());
        let second_start = std::thread::spawn(move || second.start());
        let results = [
            first_start.join().expect("first start thread"),
            second_start.join().expect("second start thread"),
        ];

        let successes = results.iter().filter(|result| result.is_ok()).count();
        let failures = results
            .iter()
            .filter(|result| {
                result
                    .as_ref()
                    .is_err_and(|failure| failure.error.code == RuntimeErrorCode::AlreadyRunning)
            })
            .count();

        assert_eq!(successes, 1);
        assert_eq!(failures, 1);
        assert_eq!(runtime.snapshot().state, RuntimeState::RunningDisconnected);
    }

    #[test]
    fn stop_returns_to_stopped_and_duplicate_stop_is_reported() {
        let runtime = RuntimeManager::new_demo(FakeMihomoAdapter::new());
        expect_success(runtime.start());

        let stopped = expect_success(runtime.stop());
        assert_eq!(stopped.snapshot.state, RuntimeState::Stopped);
        assert_eq!(stopped.snapshot.started_at_ms, None);

        let failure = runtime.stop().expect_err("duplicate stop must fail");
        assert_eq!(failure.error.code, RuntimeErrorCode::NotRunning);
        assert_eq!(failure.change.snapshot, stopped.snapshot);
    }

    #[test]
    fn restart_cycles_the_runtime_and_rejects_stopped_runtime() {
        let runtime = RuntimeManager::new_demo(FakeMihomoAdapter::new());
        let stopped_failure = runtime
            .restart()
            .expect_err("restart from stopped must fail");
        assert_eq!(stopped_failure.error.code, RuntimeErrorCode::InvalidState);

        expect_success(runtime.start());
        let restarted = expect_success(runtime.restart());

        assert_eq!(restarted.snapshot.state, RuntimeState::RunningDisconnected);
        assert!(restarted.snapshot.sequence >= 6);
        assert!(restarted.logs.len() >= 4);
    }

    #[test]
    fn simulated_crash_moves_demo_runtime_to_error() {
        let runtime = RuntimeManager::new_demo(FakeMihomoAdapter::new());
        expect_success(runtime.start());

        let crashed = expect_success(runtime.simulate_crash());

        assert_eq!(crashed.snapshot.state, RuntimeState::Error);
        assert_eq!(
            crashed.snapshot.last_error.as_ref().map(|error| error.code),
            Some(RuntimeErrorCode::AdapterFailure)
        );
        assert_eq!(crashed.snapshot.started_at_ms, None);
        assert_eq!(
            crashed.logs.last().map(|entry| entry.level),
            Some(flowproxy_contracts::RuntimeLogLevel::Error)
        );
    }

    #[test]
    fn only_demo_backend_exposes_crash_simulation() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, FakeMihomoAdapter::new());
        expect_success(runtime.start());

        let failure = runtime
            .simulate_crash()
            .expect_err("production backend cannot simulate crash");

        assert_eq!(failure.error.code, RuntimeErrorCode::InvalidState);
        assert_eq!(
            failure.change.snapshot.state,
            RuntimeState::RunningDisconnected
        );
    }

    #[derive(Default)]
    struct FailingAdapter {
        running: bool,
        fail_start: bool,
        fail_stop: bool,
    }

    impl MihomoAdapter for FailingAdapter {
        fn start(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            if self.fail_start {
                return Err(flowproxy_contracts::RuntimeError::new(
                    RuntimeErrorCode::AdapterFailure,
                    "start failed",
                    true,
                ));
            }
            self.running = true;
            Ok(())
        }

        fn stop(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            if self.fail_stop {
                return Err(flowproxy_contracts::RuntimeError::new(
                    RuntimeErrorCode::AdapterFailure,
                    "stop failed",
                    true,
                ));
            }
            self.running = false;
            Ok(())
        }

        fn simulate_crash(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            self.running = false;
            Ok(())
        }

        fn is_running(&mut self) -> bool {
            self.running
        }
    }

    #[test]
    fn adapter_failures_are_observable_in_error_state() {
        let start_runtime = RuntimeManager::new_demo(FailingAdapter {
            fail_start: true,
            ..FailingAdapter::default()
        });
        let start_failure = start_runtime.start().expect_err("start must fail");
        assert_eq!(start_failure.error.code, RuntimeErrorCode::AdapterFailure);
        assert_eq!(start_failure.change.snapshot.state, RuntimeState::Error);
        assert_eq!(
            start_failure
                .change
                .snapshot
                .last_error
                .as_ref()
                .map(|error| error.code),
            Some(RuntimeErrorCode::AdapterFailure)
        );

        let stop_runtime = RuntimeManager::new_demo(FailingAdapter {
            fail_stop: true,
            ..FailingAdapter::default()
        });
        expect_success(stop_runtime.start());
        let stop_failure = stop_runtime.stop().expect_err("stop must fail");
        assert_eq!(stop_failure.error.code, RuntimeErrorCode::AdapterFailure);
        assert_eq!(stop_failure.change.snapshot.state, RuntimeState::Error);
    }

    #[test]
    fn snapshots_and_logs_are_safe_to_clone_for_event_delivery() {
        let runtime = RuntimeManager::new_demo(FakeMihomoAdapter::new());
        let change = expect_success(runtime.start());
        let snapshot = change.snapshot.clone();
        let logs = runtime.logs();

        expect_success(runtime.stop());

        assert_eq!(snapshot.state, RuntimeState::RunningDisconnected);
        assert_eq!(logs, change.logs);
    }

    #[derive(Debug, Default)]
    struct RecordingAdapter {
        operations: Arc<Mutex<Vec<&'static str>>>,
    }

    impl MihomoAdapter for RecordingAdapter {
        fn start(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            self.operations
                .lock()
                .expect("operations lock")
                .push("start");
            Ok(())
        }

        fn stop(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            self.operations
                .lock()
                .expect("operations lock")
                .push("stop");
            Ok(())
        }

        fn simulate_crash(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            Ok(())
        }

        fn is_running(&mut self) -> bool {
            true
        }
    }

    #[test]
    fn restart_uses_stop_then_start_exactly_once() {
        let operations = Arc::new(Mutex::new(Vec::new()));
        let runtime = RuntimeManager::new_demo(RecordingAdapter {
            operations: Arc::clone(&operations),
        });
        expect_success(runtime.start());

        expect_success(runtime.restart());

        assert_eq!(
            *operations.lock().expect("operations lock"),
            vec!["start", "stop", "start"]
        );
    }

    #[derive(Debug)]
    struct SlowStartAdapter {
        started: std::sync::mpsc::Sender<()>,
        release: std::sync::mpsc::Receiver<()>,
        running: bool,
    }

    impl MihomoAdapter for SlowStartAdapter {
        fn start(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            self.started.send(()).expect("signal start entered");
            self.release.recv().expect("wait for test release");
            self.running = true;
            Ok(())
        }

        fn stop(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            self.running = false;
            Ok(())
        }

        fn simulate_crash(&mut self) -> Result<(), flowproxy_contracts::RuntimeError> {
            self.running = false;
            Ok(())
        }

        fn is_running(&mut self) -> bool {
            self.running
        }
    }

    #[test]
    fn snapshot_read_remains_available_while_adapter_start_is_blocked() {
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let runtime = Arc::new(RuntimeManager::new_demo(SlowStartAdapter {
            started: started_tx,
            release: release_rx,
            running: false,
        }));
        let operation_runtime = Arc::clone(&runtime);
        let start_thread = std::thread::spawn(move || operation_runtime.start());

        started_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("adapter start entered");
        let snapshot_runtime = Arc::clone(&runtime);
        let (snapshot_tx, snapshot_rx) = std::sync::mpsc::channel();
        let snapshot_thread = std::thread::spawn(move || {
            snapshot_tx
                .send(snapshot_runtime.snapshot())
                .expect("send snapshot");
        });
        let snapshot = snapshot_rx
            .recv_timeout(std::time::Duration::from_millis(150))
            .expect("snapshot must not wait for adapter start");

        assert_eq!(snapshot.state, RuntimeState::Starting);
        release_tx.send(()).expect("release adapter start");
        start_thread
            .join()
            .expect("join start thread")
            .expect("start succeeds");
        snapshot_thread.join().expect("join snapshot thread");
    }

    #[derive(Debug)]
    struct RuntimeDataAdapter {
        running: bool,
        health_error: Option<RuntimeError>,
        logs: Vec<String>,
        core_info_block: Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>,
        proxy_endpoint: Option<String>,
        imported_subscription: Option<(String, String)>,
    }

    impl RuntimeDataAdapter {
        fn healthy() -> Self {
            Self {
                running: false,
                health_error: None,
                logs: Vec::new(),
                core_info_block: None,
                proxy_endpoint: None,
                imported_subscription: None,
            }
        }
    }

    impl MihomoAdapter for RuntimeDataAdapter {
        fn start(&mut self) -> Result<(), RuntimeError> {
            self.running = true;
            Ok(())
        }

        fn stop(&mut self) -> Result<(), RuntimeError> {
            self.running = false;
            Ok(())
        }

        fn simulate_crash(&mut self) -> Result<(), RuntimeError> {
            self.running = false;
            Ok(())
        }

        fn is_running(&mut self) -> bool {
            self.running
        }

        fn health(&mut self) -> Result<(), RuntimeError> {
            match &self.health_error {
                Some(error) => Err(error.clone()),
                None if self.running => Ok(()),
                None => Err(RuntimeError::new(
                    RuntimeErrorCode::CoreUnavailable,
                    "test core exited",
                    true,
                )),
            }
        }

        fn controlled_proxy_endpoint(&mut self) -> Option<String> {
            self.proxy_endpoint.clone()
        }

        fn core_info(&mut self) -> Result<CoreInfo, RuntimeError> {
            if let Some((entered, release)) = &self.core_info_block {
                entered.send(()).expect("signal core info entered");
                release.recv().expect("wait for core info release");
            }
            Ok(CoreInfo {
                backend: RuntimeBackend::Mihomo,
                version: "v1.19.33".to_owned(),
                pid: Some(42),
            })
        }

        fn proxy_groups(&mut self) -> Result<Vec<ProxyGroup>, RuntimeError> {
            Ok(vec![ProxyGroup {
                name: "FlowProxy Direct".to_owned(),
                group_type: "Selector".to_owned(),
                selected: "DIRECT".to_owned(),
                nodes: vec![ProxyNode {
                    name: "DIRECT".to_owned(),
                    proxy_type: "Direct".to_owned(),
                    udp: true,
                    delay_ms: None,
                    alive: true,
                }],
            }])
        }

        fn connections(&mut self) -> Result<ConnectionPage, RuntimeError> {
            Ok(ConnectionPage {
                upload_total_bytes: 0,
                download_total_bytes: 0,
                memory_bytes: 0,
                connections: Vec::new(),
            })
        }

        fn telemetry(&mut self) -> Result<TelemetrySnapshot, RuntimeError> {
            Ok(TelemetrySnapshot {
                state: RuntimeState::Connected,
                timestamp_ms: 1_760_000_000_000,
                upload_bps: 100,
                download_bps: 200,
                total_upload_bytes: 1_000,
                total_download_bytes: 2_000,
                memory_bytes: 3_000,
                active_connections: 0,
            })
        }

        fn select_proxy(&mut self, group: &str, proxy: &str) -> Result<(), RuntimeError> {
            if group == "FlowProxy Direct" && proxy == "DIRECT" {
                Ok(())
            } else {
                Err(RuntimeError::new(
                    RuntimeErrorCode::SelectionFailed,
                    "test proxy selection failed",
                    true,
                ))
            }
        }

        fn test_proxy_delay(&mut self, proxy: &str, _timeout_ms: u32) -> Result<u32, RuntimeError> {
            if proxy == "DIRECT" {
                Ok(12)
            } else {
                Err(RuntimeError::new(
                    RuntimeErrorCode::AdapterFailure,
                    "test delay check failed",
                    true,
                ))
            }
        }

        fn test_group_delay(
            &mut self,
            group: &str,
            _timeout_ms: u32,
        ) -> Result<GroupDelayResult, RuntimeError> {
            if group == "FlowProxy Direct" {
                Ok(GroupDelayResult {
                    group: group.to_owned(),
                    delays: vec![flowproxy_contracts::DelaySample {
                        proxy: "DIRECT".to_owned(),
                        delay_ms: 12,
                    }],
                })
            } else {
                Err(RuntimeError::new(
                    RuntimeErrorCode::AdapterFailure,
                    "test group delay check failed",
                    true,
                ))
            }
        }

        fn core_preferences(&mut self) -> Result<CorePreferences, RuntimeError> {
            Ok(CorePreferences {
                mode: Some(RoutingMode::Rule),
                log_level: Some(LogLevel::Warning),
                ipv6: Some(false),
            })
        }

        fn update_core_preferences(
            &mut self,
            mode: Option<RoutingMode>,
            log_level: Option<LogLevel>,
        ) -> Result<CorePreferences, RuntimeError> {
            Ok(CorePreferences {
                mode,
                log_level,
                ipv6: Some(false),
            })
        }

        fn close_connection(&mut self, connection_id: &str) -> Result<(), RuntimeError> {
            if connection_id == "connection-1" {
                Ok(())
            } else {
                Err(RuntimeError::new(
                    RuntimeErrorCode::ConnectionNotFound,
                    "test connection was not found",
                    false,
                ))
            }
        }

        fn rules(&mut self) -> Result<Vec<RuleItem>, RuntimeError> {
            Ok(vec![RuleItem {
                index: 0,
                rule_type: "Match".to_owned(),
                payload: String::new(),
                proxy: "FlowProxy Direct".to_owned(),
            }])
        }

        fn profiles(&mut self) -> Result<Vec<ProfileInfo>, RuntimeError> {
            Ok(vec![ProfileInfo {
                id: "flowproxy-direct".to_owned(),
                name: "FlowProxy Direct".to_owned(),
                active: true,
                updated_at_ms: None,
                source: None,
                proxy_count: None,
            }])
        }

        fn import_subscription(&mut self, name: &str, yaml: &str) -> Result<(), RuntimeError> {
            if yaml.trim().is_empty() {
                return Err(RuntimeError::new(
                    RuntimeErrorCode::SubscriptionInvalid,
                    "the test subscription is empty",
                    false,
                ));
            }
            self.imported_subscription = Some((name.to_owned(), yaml.to_owned()));
            Ok(())
        }

        fn clear_subscription(&mut self) -> Result<(), RuntimeError> {
            self.imported_subscription = None;
            Ok(())
        }

        fn remove_subscription(&mut self, _id: &str) -> Result<(), RuntimeError> {
            self.imported_subscription = None;
            Ok(())
        }

        fn take_logs(&mut self) -> Vec<String> {
            std::mem::take(&mut self.logs)
        }
    }

    #[test]
    fn subscription_import_works_while_the_runtime_is_stopped() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, RuntimeDataAdapter::healthy());

        runtime
            .import_subscription("My nodes", "proxies:\n  - name: A\n")
            .unwrap_or_else(|failure| panic!("import failed: {failure:?}"));
    }

    #[test]
    fn subscription_import_failure_is_reported_without_changing_state() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, RuntimeDataAdapter::healthy());

        let failure = runtime
            .import_subscription("Empty", "   ")
            .expect_err("an empty subscription must fail");

        assert_eq!(failure.error.code, RuntimeErrorCode::SubscriptionInvalid);
        assert_eq!(failure.change.snapshot.state, RuntimeState::Stopped);
    }

    #[test]
    fn subscription_can_be_cleared() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, RuntimeDataAdapter::healthy());

        runtime
            .import_subscription("My nodes", "proxies:\n  - name: A\n")
            .expect("import should succeed");
        runtime
            .clear_subscription()
            .unwrap_or_else(|failure| panic!("clear failed: {failure:?}"));
    }

    #[test]
    fn health_poll_connects_a_real_backend() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, RuntimeDataAdapter::healthy());
        expect_success(runtime.start());

        let change = runtime
            .poll_health()
            .expect("healthy runtime must publish a change");

        assert_eq!(change.snapshot.state, RuntimeState::Connected);
        assert_eq!(change.logs.len(), 1);
        assert!(change.logs[0].message.contains("verified"));
    }

    #[test]
    fn controlled_proxy_endpoint_requires_a_connected_runtime() {
        let runtime = RuntimeManager::new(
            RuntimeBackend::Mihomo,
            RuntimeDataAdapter {
                proxy_endpoint: Some("127.0.0.1:49152".to_owned()),
                ..RuntimeDataAdapter::healthy()
            },
        );
        expect_success(runtime.start());

        let failure = runtime
            .controlled_proxy_endpoint()
            .expect_err("disconnected Runtime cannot expose a system proxy endpoint");

        assert_eq!(failure.error.code, RuntimeErrorCode::InvalidState);
        assert_eq!(
            failure.change.snapshot.state,
            RuntimeState::RunningDisconnected
        );
    }

    #[test]
    fn controlled_proxy_endpoint_returns_only_a_verified_loopback_endpoint() {
        let runtime = RuntimeManager::new(
            RuntimeBackend::Mihomo,
            RuntimeDataAdapter {
                proxy_endpoint: Some("127.0.0.1:49152".to_owned()),
                ..RuntimeDataAdapter::healthy()
            },
        );
        expect_success(runtime.start());
        runtime.poll_health().expect("connect runtime");

        assert_eq!(
            runtime
                .controlled_proxy_endpoint()
                .expect("expose verified endpoint"),
            "127.0.0.1:49152"
        );
    }

    #[test]
    fn controlled_proxy_endpoint_rejects_missing_or_unsafe_addresses() {
        for endpoint in [
            None,
            Some(String::new()),
            Some("localhost:49152".to_owned()),
            Some("192.168.1.2:49152".to_owned()),
            Some("127.0.0.1:0".to_owned()),
            Some("127.0.0.1:not-a-port".to_owned()),
            Some("127.0.0.1:65536".to_owned()),
        ] {
            let runtime = RuntimeManager::new(
                RuntimeBackend::Mihomo,
                RuntimeDataAdapter {
                    proxy_endpoint: endpoint,
                    ..RuntimeDataAdapter::healthy()
                },
            );
            expect_success(runtime.start());
            runtime.poll_health().expect("connect runtime");

            let failure = runtime
                .controlled_proxy_endpoint()
                .expect_err("unsafe endpoint must be rejected");

            assert_eq!(failure.error.code, RuntimeErrorCode::ApiUnavailable);
            assert_eq!(failure.change.snapshot.state, RuntimeState::Connected);
        }
    }

    #[test]
    fn controlled_proxy_endpoint_disappears_after_the_core_exits() {
        let runtime = RuntimeManager::new(
            RuntimeBackend::Mihomo,
            RuntimeDataAdapter {
                proxy_endpoint: Some("127.0.0.1:49152".to_owned()),
                ..RuntimeDataAdapter::healthy()
            },
        );
        expect_success(runtime.start());
        runtime.poll_health().expect("connect runtime");

        expect_success(runtime.stop());

        let failure = runtime
            .controlled_proxy_endpoint()
            .expect_err("stopped Runtime cannot expose a proxy endpoint");
        assert_eq!(failure.error.code, RuntimeErrorCode::InvalidState);
        assert_eq!(failure.change.snapshot.state, RuntimeState::Stopped);
    }

    #[test]
    fn health_poll_marks_an_exited_core_as_error() {
        let runtime = RuntimeManager::new(
            RuntimeBackend::Mihomo,
            RuntimeDataAdapter {
                health_error: Some(RuntimeError::new(
                    RuntimeErrorCode::CoreUnavailable,
                    "The Mihomo core process exited unexpectedly.",
                    true,
                )),
                ..RuntimeDataAdapter::healthy()
            },
        );
        expect_success(runtime.start());

        let change = runtime
            .poll_health()
            .expect("unexpected core exit must publish a change");

        assert_eq!(change.snapshot.state, RuntimeState::Error);
        assert_eq!(
            change.snapshot.last_error.as_ref().map(|error| error.code),
            Some(RuntimeErrorCode::CoreUnavailable)
        );
        assert_eq!(change.snapshot.started_at_ms, None);
    }

    #[test]
    fn stale_health_poll_cannot_overwrite_a_newer_runtime_state() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, RuntimeDataAdapter::healthy());
        expect_success(runtime.start());
        let observed_sequence = runtime.snapshot().sequence;
        expect_success(runtime.stop());

        let mut inner = runtime.lock_inner();
        let previous_state = inner.state;
        let previous_sequence = inner.sequence;
        let previous_log_count = inner.logs.len();
        let mut new_logs = Vec::new();
        let published = apply_health_poll_locked(
            &mut inner,
            observed_sequence,
            Err(RuntimeError::new(
                RuntimeErrorCode::CoreUnavailable,
                "stale health result",
                true,
            )),
            vec!["stale adapter log".to_owned()],
            &mut new_logs,
        );

        assert!(!published);
        assert_eq!(inner.state, previous_state);
        assert_eq!(inner.sequence, previous_sequence);
        assert_eq!(inner.logs.len(), previous_log_count);
        assert!(new_logs.is_empty());
    }

    #[test]
    fn slow_adapter_data_does_not_block_snapshot_reads() {
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let runtime = Arc::new(RuntimeManager::new(
            RuntimeBackend::Mihomo,
            RuntimeDataAdapter {
                core_info_block: Some((entered_tx, release_rx)),
                ..RuntimeDataAdapter::healthy()
            },
        ));
        expect_success(runtime.start());
        runtime.poll_health().expect("connect runtime");

        let operation_runtime = Arc::clone(&runtime);
        let operation = std::thread::spawn(move || operation_runtime.core_info());
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("core info entered");

        let (snapshot_tx, snapshot_rx) = std::sync::mpsc::channel();
        let snapshot_runtime = Arc::clone(&runtime);
        std::thread::spawn(move || {
            snapshot_tx
                .send(snapshot_runtime.snapshot())
                .expect("send snapshot");
        });
        let snapshot = snapshot_rx
            .recv_timeout(std::time::Duration::from_millis(150))
            .expect("snapshot must not wait for core info");
        assert_eq!(snapshot.state, RuntimeState::Connected);

        release_tx.send(()).expect("release core info");
        operation
            .join()
            .expect("join core info")
            .expect("core info succeeds");
    }

    #[test]
    fn adapter_logs_are_redacted_and_published_by_health_poll() {
        let runtime = RuntimeManager::new(
            RuntimeBackend::Mihomo,
            RuntimeDataAdapter {
                logs: vec!["token=super-secret core ready".to_owned()],
                ..RuntimeDataAdapter::healthy()
            },
        );
        expect_success(runtime.start());

        let change = runtime.poll_health().expect("publish health change");
        let logs = runtime.logs();

        assert!(logs
            .iter()
            .any(|entry| entry.message.contains("core ready")));
        assert!(logs
            .iter()
            .all(|entry| !entry.message.contains("super-secret")));
        assert!(change
            .logs
            .iter()
            .any(|entry| entry.message.contains("core ready")));
    }

    #[test]
    fn typed_adapter_data_is_exposed_only_after_connection() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, RuntimeDataAdapter::healthy());
        expect_success(runtime.start());
        let disconnected = runtime
            .proxy_groups()
            .expect_err("disconnected Runtime has no proxy data");
        assert_eq!(disconnected.error.code, RuntimeErrorCode::InvalidState);

        runtime.poll_health().expect("connect runtime");
        let groups = runtime.proxy_groups().expect("read proxy groups");
        let connections = runtime.connections().expect("read connections");
        let info = runtime.core_info().expect("read core info");

        assert_eq!(groups[0].selected, "DIRECT");
        assert!(connections.connections.is_empty());
        assert_eq!(info.version, "v1.19.33");
    }

    #[test]
    fn typed_adapter_commands_forward_data_after_connection() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, RuntimeDataAdapter::healthy());
        expect_success(runtime.start());
        runtime.poll_health().expect("connect runtime");

        runtime
            .select_proxy("FlowProxy Direct", "DIRECT")
            .expect("select proxy");
        assert_eq!(
            runtime
                .test_proxy_delay("DIRECT", 5_000)
                .expect("test delay"),
            12
        );
        runtime
            .close_connection("connection-1")
            .expect("close connection");

        let telemetry = runtime.telemetry().expect("read telemetry");
        assert_eq!(telemetry.download_bps, 200);
        assert_eq!(runtime.rules().expect("read rules")[0].rule_type, "Match");
        assert!(runtime.profiles().expect("read profiles")[0].active);
    }

    #[test]
    fn boxed_adapter_supports_typed_runtime_data() {
        let adapter: Box<dyn MihomoAdapter> = Box::new(RuntimeDataAdapter::healthy());
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, adapter);
        expect_success(runtime.start());
        runtime.poll_health().expect("connect runtime");

        let groups = runtime.proxy_groups().expect("read proxy groups");

        assert_eq!(groups[0].selected, "DIRECT");
    }

    #[test]
    fn business_command_failure_does_not_mark_the_core_as_crashed() {
        let runtime = RuntimeManager::new(RuntimeBackend::Mihomo, RuntimeDataAdapter::healthy());
        expect_success(runtime.start());
        runtime.poll_health().expect("connect runtime");

        let selection_failure = runtime
            .select_proxy("FlowProxy Direct", "MISSING")
            .expect_err("missing proxy must fail");
        let connection_failure = runtime
            .close_connection("missing")
            .expect_err("missing connection must fail");

        assert_eq!(
            selection_failure.error.code,
            RuntimeErrorCode::SelectionFailed
        );
        assert_eq!(
            connection_failure.error.code,
            RuntimeErrorCode::ConnectionNotFound
        );
        assert_eq!(runtime.snapshot().state, RuntimeState::Connected);
        assert!(runtime
            .logs()
            .iter()
            .any(|entry| entry.message.contains("selection failed")));
    }
}
