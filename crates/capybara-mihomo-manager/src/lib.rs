mod binary;
mod config;
mod control_api;
mod core_adapter;
pub mod core_versions;
pub mod subscription;
pub mod subscription_convert;
pub mod subscription_fetch;
pub mod subscription_preview;
pub mod subscription_store;
mod system_proxy;

use capybara_contracts::{
    ConnectionPage, CoreInfo, CorePreferences, DelayProbeSettings, GroupDelayResult, LogLevel,
    ProfileInfo, ProviderInfo, ProxyGroup, RoutingMode, RuleItem, RuntimeError, RuntimeErrorCode,
    StartupPreferences, SubscriptionSnapshot, SubscriptionUsage, TelemetrySnapshot,
};

pub use binary::{
    resolve_verified_binary, sha256_file, verify_binary_file, verify_binary_version,
    VerifiedMihomoBinary, LOCKED_MIHOMO_SHA256, LOCKED_MIHOMO_VERSION,
};
pub use config::{render_direct_profile, render_direct_profile_with, ConfigStore};
pub use control_api::{parse_connections, parse_proxy_groups, parse_rules, LoopbackApiClient};
pub use core_adapter::MihomoCoreAdapter;
pub use core_versions::{CoreVersion, CoreVersionStore};

pub fn validate_loopback_endpoint(endpoint: &str) -> Result<(), RuntimeError> {
    let authority = endpoint.strip_prefix("http://").ok_or_else(|| {
        RuntimeError::new(
            RuntimeErrorCode::ApiUnavailable,
            "The Mihomo control API must use plain loopback HTTP.",
            false,
        )
    })?;
    let (host, port) = authority.split_once(':').ok_or_else(|| {
        RuntimeError::new(
            RuntimeErrorCode::ApiUnavailable,
            "The Mihomo control API endpoint is invalid.",
            false,
        )
    })?;
    let valid_port = !port.is_empty()
        && port.bytes().all(|byte| byte.is_ascii_digit())
        && port.parse::<u16>().is_ok_and(|value| value > 0);

    if host != "127.0.0.1" || !valid_port {
        return Err(RuntimeError::new(
            RuntimeErrorCode::ApiUnavailable,
            "The Mihomo control API must bind to 127.0.0.1.",
            false,
        ));
    }

    Ok(())
}

pub trait MihomoAdapter: Send {
    fn start(&mut self) -> Result<(), RuntimeError>;
    fn stop(&mut self) -> Result<(), RuntimeError>;
    fn simulate_crash(&mut self) -> Result<(), RuntimeError>;
    fn is_running(&mut self) -> bool;

    fn health(&mut self) -> Result<(), RuntimeError> {
        if self.is_running() {
            Ok(())
        } else {
            Err(RuntimeError::new(
                RuntimeErrorCode::NotRunning,
                "The Mihomo adapter is not running.",
                false,
            ))
        }
    }

    fn controlled_proxy_endpoint(&mut self) -> Option<String> {
        None
    }

    fn core_info(&mut self) -> Result<CoreInfo, RuntimeError> {
        Err(unsupported_adapter_data("core information"))
    }

    fn telemetry(&mut self) -> Result<TelemetrySnapshot, RuntimeError> {
        Err(unsupported_adapter_data("telemetry"))
    }

    fn proxy_groups(&mut self) -> Result<Vec<ProxyGroup>, RuntimeError> {
        Err(unsupported_adapter_data("proxy groups"))
    }

    fn select_proxy(&mut self, _group: &str, _proxy: &str) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("proxy selection"))
    }

    fn test_proxy_delay(&mut self, _proxy: &str, _timeout_ms: u32) -> Result<u32, RuntimeError> {
        Err(unsupported_adapter_data("proxy delay checks"))
    }

    /// Probes every node of one group in a single request.
    fn test_group_delay(
        &mut self,
        _group: &str,
        _timeout_ms: u32,
    ) -> Result<GroupDelayResult, RuntimeError> {
        Err(unsupported_adapter_data("group delay checks"))
    }

    /// Reads the routing mode and log level the core is running with.
    fn core_preferences(&mut self) -> Result<CorePreferences, RuntimeError> {
        Err(unsupported_adapter_data("core preferences"))
    }

    /// Changes routing mode and/or log level without restarting the core.
    fn update_core_preferences(
        &mut self,
        _mode: Option<RoutingMode>,
        _log_level: Option<LogLevel>,
    ) -> Result<CorePreferences, RuntimeError> {
        Err(unsupported_adapter_data("core preference updates"))
    }

    /// Sets the values written into the next generated profile.
    ///
    /// Adapters that cannot render a profile keep the no-op default.
    fn set_startup_preferences(&mut self, _preferences: StartupPreferences) {}

    /// Sets the target used by latency probes.
    ///
    /// Adapters without a control API keep the no-op default.
    fn set_delay_probe(&mut self, _probe: DelayProbeSettings) {}

    /// Records the URL the next import came from, so the document can be
    /// refreshed later. A pasted document has no source and passes `None`.
    fn set_pending_subscription_url(&mut self, _url: Option<String>) {}

    /// Records the usage header that came with the document being imported.
    /// A pasted document passes `None` so stale numbers cannot survive it.
    fn set_pending_subscription_usage(&mut self, _usage: Option<SubscriptionUsage>) {}

    /// Names the stored subscription the next import should replace. `None`
    /// creates a new entry, which is what a first import does.
    fn set_pending_subscription_target(&mut self, _id: Option<String>) {}

    fn connections(&mut self) -> Result<ConnectionPage, RuntimeError> {
        Err(unsupported_adapter_data("active connections"))
    }

    fn close_connection(&mut self, _connection_id: &str) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("connection control"))
    }

    /// Closes every open connection. The default reports the capability as
    /// unsupported, matching [`close_connection`](Self::close_connection).
    fn close_all_connections(&mut self) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("connection control"))
    }

    fn rules(&mut self) -> Result<Vec<RuleItem>, RuntimeError> {
        Err(unsupported_adapter_data("rules"))
    }

    /// Providers the active profile declares. Read-only by design.
    fn providers(&mut self) -> Result<Vec<ProviderInfo>, RuntimeError> {
        Err(unsupported_adapter_data("providers"))
    }

    fn profiles(&mut self) -> Result<Vec<ProfileInfo>, RuntimeError> {
        Err(unsupported_adapter_data("profiles"))
    }

    /// Installs a subscription document as the active profile.
    ///
    /// Adapters that cannot persist configuration keep the default
    /// implementation, which reports the capability as unsupported.
    fn import_subscription(&mut self, _name: &str, _yaml: &str) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("subscription import"))
    }

    /// Removes the imported subscription and returns to the direct profile.
    fn clear_subscription(&mut self) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("subscription removal"))
    }

    /// Removes one subscription by id, whether or not it is active.
    fn remove_subscription(&mut self, _id: &str) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("subscription removal"))
    }

    /// Makes a stored subscription the one the next start uses.
    fn activate_subscription(&mut self, _id: &str) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("subscription activation"))
    }

    /// Replaces the operator's custom rules for one subscription.
    fn set_subscription_rules(&mut self, _id: &str, _rules: &[String]) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("subscription overrides"))
    }

    /// Replaces the operator's override YAML for one subscription.
    fn set_subscription_override_yaml(
        &mut self,
        _id: &str,
        _yaml: Option<&str>,
    ) -> Result<(), RuntimeError> {
        Err(unsupported_adapter_data("subscription overrides"))
    }

    /// Read-only summary of the stored subscription for the offline UI.
    ///
    /// Unlike the other data methods this must work while the core is stopped:
    /// it reads the document from disk and never touches the control API.
    fn subscription_snapshot(&mut self) -> Result<SubscriptionSnapshot, RuntimeError> {
        Err(unsupported_adapter_data("subscription summary"))
    }

    /// Returns the URL the stored subscription was imported from, if any.
    fn subscription_source_url(&mut self) -> Option<String> {
        None
    }

    fn take_logs(&mut self) -> Vec<String> {
        Vec::new()
    }
}

impl<T> MihomoAdapter for Box<T>
where
    T: MihomoAdapter + ?Sized,
{
    fn start(&mut self) -> Result<(), RuntimeError> {
        self.as_mut().start()
    }

    fn stop(&mut self) -> Result<(), RuntimeError> {
        self.as_mut().stop()
    }

    fn simulate_crash(&mut self) -> Result<(), RuntimeError> {
        self.as_mut().simulate_crash()
    }

    fn is_running(&mut self) -> bool {
        self.as_mut().is_running()
    }

    fn set_startup_preferences(&mut self, preferences: StartupPreferences) {
        self.as_mut().set_startup_preferences(preferences)
    }

    fn set_delay_probe(&mut self, probe: DelayProbeSettings) {
        self.as_mut().set_delay_probe(probe)
    }

    fn set_pending_subscription_url(&mut self, url: Option<String>) {
        self.as_mut().set_pending_subscription_url(url)
    }

    fn set_pending_subscription_usage(&mut self, usage: Option<SubscriptionUsage>) {
        self.as_mut().set_pending_subscription_usage(usage)
    }

    fn set_pending_subscription_target(&mut self, id: Option<String>) {
        self.as_mut().set_pending_subscription_target(id)
    }

    fn health(&mut self) -> Result<(), RuntimeError> {
        self.as_mut().health()
    }

    fn controlled_proxy_endpoint(&mut self) -> Option<String> {
        self.as_mut().controlled_proxy_endpoint()
    }

    fn core_info(&mut self) -> Result<CoreInfo, RuntimeError> {
        self.as_mut().core_info()
    }

    fn telemetry(&mut self) -> Result<TelemetrySnapshot, RuntimeError> {
        self.as_mut().telemetry()
    }

    fn proxy_groups(&mut self) -> Result<Vec<ProxyGroup>, RuntimeError> {
        self.as_mut().proxy_groups()
    }

    fn select_proxy(&mut self, group: &str, proxy: &str) -> Result<(), RuntimeError> {
        self.as_mut().select_proxy(group, proxy)
    }

    fn test_proxy_delay(&mut self, proxy: &str, timeout_ms: u32) -> Result<u32, RuntimeError> {
        self.as_mut().test_proxy_delay(proxy, timeout_ms)
    }

    fn test_group_delay(
        &mut self,
        group: &str,
        timeout_ms: u32,
    ) -> Result<GroupDelayResult, RuntimeError> {
        self.as_mut().test_group_delay(group, timeout_ms)
    }

    fn core_preferences(&mut self) -> Result<CorePreferences, RuntimeError> {
        self.as_mut().core_preferences()
    }

    fn update_core_preferences(
        &mut self,
        mode: Option<RoutingMode>,
        log_level: Option<LogLevel>,
    ) -> Result<CorePreferences, RuntimeError> {
        self.as_mut().update_core_preferences(mode, log_level)
    }

    fn connections(&mut self) -> Result<ConnectionPage, RuntimeError> {
        self.as_mut().connections()
    }

    fn close_connection(&mut self, connection_id: &str) -> Result<(), RuntimeError> {
        self.as_mut().close_connection(connection_id)
    }

    fn close_all_connections(&mut self) -> Result<(), RuntimeError> {
        self.as_mut().close_all_connections()
    }

    fn rules(&mut self) -> Result<Vec<RuleItem>, RuntimeError> {
        self.as_mut().rules()
    }

    fn providers(&mut self) -> Result<Vec<ProviderInfo>, RuntimeError> {
        self.as_mut().providers()
    }

    fn profiles(&mut self) -> Result<Vec<ProfileInfo>, RuntimeError> {
        self.as_mut().profiles()
    }

    fn import_subscription(&mut self, name: &str, yaml: &str) -> Result<(), RuntimeError> {
        self.as_mut().import_subscription(name, yaml)
    }

    fn clear_subscription(&mut self) -> Result<(), RuntimeError> {
        self.as_mut().clear_subscription()
    }

    fn remove_subscription(&mut self, id: &str) -> Result<(), RuntimeError> {
        self.as_mut().remove_subscription(id)
    }

    fn activate_subscription(&mut self, id: &str) -> Result<(), RuntimeError> {
        self.as_mut().activate_subscription(id)
    }

    fn set_subscription_rules(&mut self, id: &str, rules: &[String]) -> Result<(), RuntimeError> {
        self.as_mut().set_subscription_rules(id, rules)
    }

    fn set_subscription_override_yaml(
        &mut self,
        id: &str,
        yaml: Option<&str>,
    ) -> Result<(), RuntimeError> {
        self.as_mut().set_subscription_override_yaml(id, yaml)
    }

    fn subscription_snapshot(&mut self) -> Result<SubscriptionSnapshot, RuntimeError> {
        self.as_mut().subscription_snapshot()
    }

    fn subscription_source_url(&mut self) -> Option<String> {
        self.as_mut().subscription_source_url()
    }

    fn take_logs(&mut self) -> Vec<String> {
        self.as_mut().take_logs()
    }
}

fn unsupported_adapter_data(resource: &str) -> RuntimeError {
    RuntimeError::new(
        RuntimeErrorCode::InvalidState,
        format!("{resource} are unavailable for this Runtime backend."),
        false,
    )
}

#[derive(Debug, Default)]
pub struct FakeMihomoAdapter {
    running: bool,
}

impl FakeMihomoAdapter {
    pub fn new() -> Self {
        Self::default()
    }
}

impl MihomoAdapter for FakeMihomoAdapter {
    fn start(&mut self) -> Result<(), RuntimeError> {
        if self.running {
            return Err(RuntimeError::new(
                RuntimeErrorCode::AlreadyRunning,
                "The fake Mihomo adapter is already running.",
                false,
            ));
        }

        self.running = true;
        Ok(())
    }

    fn stop(&mut self) -> Result<(), RuntimeError> {
        if !self.running {
            return Err(RuntimeError::new(
                RuntimeErrorCode::NotRunning,
                "The fake Mihomo adapter is not running.",
                false,
            ));
        }

        self.running = false;
        Ok(())
    }

    fn simulate_crash(&mut self) -> Result<(), RuntimeError> {
        if !self.running {
            return Err(RuntimeError::new(
                RuntimeErrorCode::NotRunning,
                "The fake Mihomo adapter is not running.",
                false,
            ));
        }

        self.running = false;
        Ok(())
    }

    fn is_running(&mut self) -> bool {
        self.running
    }
}

#[derive(Debug)]
pub struct UnavailableMihomoAdapter {
    reason: RuntimeError,
}

impl UnavailableMihomoAdapter {
    pub fn new(reason: RuntimeError) -> Self {
        Self { reason }
    }
}

impl MihomoAdapter for UnavailableMihomoAdapter {
    fn start(&mut self) -> Result<(), RuntimeError> {
        Err(self.reason.clone())
    }

    fn stop(&mut self) -> Result<(), RuntimeError> {
        Err(RuntimeError::new(
            RuntimeErrorCode::NotRunning,
            "The Mihomo core is unavailable and is not running.",
            false,
        ))
    }

    fn simulate_crash(&mut self) -> Result<(), RuntimeError> {
        Err(RuntimeError::new(
            RuntimeErrorCode::NotRunning,
            "The Mihomo core is unavailable and cannot crash.",
            false,
        ))
    }

    fn is_running(&mut self) -> bool {
        false
    }

    fn health(&mut self) -> Result<(), RuntimeError> {
        Err(self.reason.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        render_direct_profile, validate_loopback_endpoint, verify_binary_file, ConfigStore,
        FakeMihomoAdapter, MihomoAdapter, UnavailableMihomoAdapter,
    };
    use capybara_contracts::{RuntimeError, RuntimeErrorCode};

    #[test]
    fn fake_adapter_starts_and_stops_without_process_side_effects() {
        let mut adapter = FakeMihomoAdapter::new();

        assert!(!adapter.is_running());
        adapter.start().expect("start fake adapter");
        assert!(adapter.is_running());
        adapter.stop().expect("stop fake adapter");
        assert!(!adapter.is_running());
    }

    #[test]
    fn fake_adapter_rejects_duplicate_start_and_stop() {
        let mut adapter = FakeMihomoAdapter::new();

        let stop_error = adapter.stop().expect_err("initial stop must fail");
        assert_eq!(stop_error.code, RuntimeErrorCode::NotRunning);

        adapter.start().expect("start fake adapter");
        let start_error = adapter.start().expect_err("duplicate start must fail");
        assert_eq!(start_error.code, RuntimeErrorCode::AlreadyRunning);
    }

    #[test]
    fn fake_adapter_can_simulate_a_crash_only_while_running() {
        let mut adapter = FakeMihomoAdapter::new();

        let stopped_error = adapter
            .simulate_crash()
            .expect_err("stopped adapter cannot crash");
        assert_eq!(stopped_error.code, RuntimeErrorCode::NotRunning);

        adapter.start().expect("start fake adapter");
        adapter
            .simulate_crash()
            .expect("simulate running adapter crash");
        assert!(!adapter.is_running());
    }

    #[test]
    fn unavailable_adapter_preserves_the_discovery_error() {
        let reason = RuntimeError::new(
            RuntimeErrorCode::CoreUnavailable,
            "The locked Mihomo binary is unavailable.",
            false,
        );
        let mut adapter = UnavailableMihomoAdapter::new(reason.clone());

        assert_eq!(adapter.start().expect_err("start must fail"), reason);
        assert_eq!(
            adapter.stop().expect_err("stop must fail").code,
            RuntimeErrorCode::NotRunning
        );
        assert!(!adapter.is_running());
    }

    #[test]
    fn binary_verification_rejects_content_that_does_not_match_the_locked_hash() {
        let directory = tempfile::tempdir().expect("temporary binary directory");
        let binary = directory.path().join("mihomo.exe");
        std::fs::write(&binary, b"not the locked Mihomo binary").expect("write fixture binary");

        let error = verify_binary_file(
            &binary,
            "1cde41cfffd3de0aedad63c0a8515e1ce5eea507e8133aed0f637d316c93800a",
        )
        .expect_err("hash mismatch must be rejected");

        assert_eq!(error.code, RuntimeErrorCode::CoreUnavailable);
    }

    #[test]
    fn binary_verification_accepts_only_matching_content() {
        let directory = tempfile::tempdir().expect("temporary binary directory");
        let binary = directory.path().join("mihomo.exe");
        std::fs::write(&binary, b"locked mihomo fixture").expect("write fixture binary");

        let digest = verify_binary_file(
            &binary,
            "c0fdf39d59bbaf3450899a4c14622ec3fbdf5ae2569c38f8e40bd09a52e8813e",
        )
        .expect("matching hash is accepted");

        assert_eq!(
            digest,
            "c0fdf39d59bbaf3450899a4c14622ec3fbdf5ae2569c38f8e40bd09a52e8813e"
        );
    }

    #[test]
    fn rendered_profile_forces_loopback_and_disables_privileged_features() {
        let profile = render_direct_profile(49_152, 49_153, "0123456789abcdef")
            .expect("render safe direct profile");

        assert!(profile.contains("external-controller: 127.0.0.1:49152"));
        assert!(profile.contains("secret: 0123456789abcdef"));
        assert!(profile.contains("allow-lan: false"));
        assert!(profile.contains("bind-address: 127.0.0.1"));
        assert!(profile.contains("mixed-port: 49153"));
        assert!(profile.contains("enable: false"));
        assert!(profile.contains("listeners: []"));
        assert!(profile.contains("MATCH,CapybaraProxy Direct"));
        assert!(!profile.contains("0.0.0.0"));
        assert!(!profile.contains("::"));
    }

    #[test]
    fn rendered_profile_preserves_yaml_nesting() {
        let profile = render_direct_profile(49_152, 49_153, "0123456789abcdef")
            .expect("render safe direct profile");

        assert!(profile.contains("tun:\n  enable: false\nproxy-groups:\n"));
        assert!(profile.contains(
            "proxy-groups:\n  - name: CapybaraProxy Direct\n    type: select\n    proxies:\n      - DIRECT\n"
        ));
    }

    #[test]
    fn control_api_rejects_non_loopback_endpoints_before_network_access() {
        for endpoint in [
            "http://192.168.1.2:9090",
            "https://127.0.0.1:9090",
            "http://127.0.0.1.evil.example:9090",
            "http://[::1]:9090",
        ] {
            let error = validate_loopback_endpoint(endpoint)
                .expect_err("non-loopback endpoint must be rejected");
            assert_eq!(error.code, RuntimeErrorCode::ApiUnavailable);
        }

        validate_loopback_endpoint("http://127.0.0.1:9090").expect("loopback endpoint is accepted");
    }

    #[test]
    fn profile_activation_keeps_the_previous_file_when_validation_fails() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let store = ConfigStore::new(directory.path().join("config.yaml"));
        store
            .activate("safe: old\n", |_| Ok(()))
            .expect("activate initial profile");

        let error = store
            .activate("safe: new\n", |_| {
                Err(RuntimeError::new(
                    RuntimeErrorCode::ConfigInvalid,
                    "candidate profile rejected",
                    false,
                ))
            })
            .expect_err("invalid candidate must not be activated");

        assert_eq!(error.code, RuntimeErrorCode::ConfigInvalid);
        assert_eq!(
            std::fs::read_to_string(store.path()).expect("read active profile"),
            "safe: old\n"
        );
        assert_eq!(
            std::fs::read_dir(directory.path())
                .expect("read config directory")
                .count(),
            1
        );
    }

    #[test]
    fn profile_activation_replaces_content_after_validation_succeeds() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let store = ConfigStore::new(directory.path().join("config.yaml"));
        store
            .activate("safe: old\n", |_| Ok(()))
            .expect("activate initial profile");

        store
            .activate("safe: validated\n", |candidate| {
                assert_eq!(
                    std::fs::read_to_string(candidate).expect("read candidate"),
                    "safe: validated\n"
                );
                Ok(())
            })
            .expect("activate validated profile");

        assert_eq!(
            std::fs::read_to_string(store.path()).expect("read active profile"),
            "safe: validated\n"
        );
        assert_eq!(
            std::fs::read_dir(directory.path())
                .expect("read config directory")
                .count(),
            1
        );
    }

    #[test]
    fn config_snapshot_can_restore_or_remove_the_active_profile() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let store = ConfigStore::new(directory.path().join("config.yaml"));
        store
            .activate("safe: previous\n", |_| Ok(()))
            .expect("activate previous profile");
        let previous = store.snapshot().expect("snapshot previous profile");

        store
            .activate("safe: candidate\n", |_| Ok(()))
            .expect("activate candidate profile");
        store
            .restore(previous.as_deref())
            .expect("restore previous profile");

        assert_eq!(
            std::fs::read_to_string(store.path()).expect("read restored profile"),
            "safe: previous\n"
        );

        store.restore(None).expect("remove active profile");
        assert!(!store.path().exists());
    }
}
