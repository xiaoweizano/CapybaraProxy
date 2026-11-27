use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize, Serializer};
use std::fmt::{Display, Formatter};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeBackend {
    Demo,
    Mihomo,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeState {
    Stopped,
    Starting,
    RunningDisconnected,
    Connected,
    Stopping,
    Error,
    PermissionRequired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeErrorCode {
    AlreadyRunning,
    NotRunning,
    InvalidState,
    AdapterFailure,
    CoreUnavailable,
    ConfigInvalid,
    ApiUnavailable,
    SelectionFailed,
    ConnectionNotFound,
    PermissionRequired,
    SettingsIo,
    PlatformIntegration,
    SubscriptionInvalid,
    Internal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeError {
    pub code: RuntimeErrorCode,
    pub message: String,
    pub retryable: bool,
}

impl RuntimeError {
    pub fn new(code: RuntimeErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }
}

impl Display for RuntimeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RuntimeError {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeSnapshot {
    pub backend: RuntimeBackend,
    pub state: RuntimeState,
    pub sequence: u64,
    pub started_at_ms: Option<i64>,
    pub last_error: Option<RuntimeError>,
    pub log_count: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeLogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeLogEntry {
    pub sequence: u64,
    pub timestamp_ms: i64,
    pub level: RuntimeLogLevel,
    pub message: String,
    pub error_code: Option<RuntimeErrorCode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CoreInfo {
    pub backend: RuntimeBackend,
    pub version: String,
    pub pid: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProxyNode {
    pub name: String,
    pub proxy_type: String,
    pub udp: bool,
    pub delay_ms: Option<u32>,
    pub alive: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProxyGroup {
    pub name: String,
    pub group_type: String,
    pub selected: String,
    pub nodes: Vec<ProxyNode>,
}

/// Routing mode exposed by the core.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutingMode {
    Rule,
    Global,
    Direct,
}

impl RoutingMode {
    pub fn as_wire_value(self) -> &'static str {
        match self {
            Self::Rule => "rule",
            Self::Global => "global",
            Self::Direct => "direct",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "rule" => Some(Self::Rule),
            "global" => Some(Self::Global),
            "direct" => Some(Self::Direct),
            _ => None,
        }
    }
}

/// Core log verbosity exposed by the control API.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Silent,
    Error,
    Warning,
    Info,
    Debug,
}

impl LogLevel {
    pub fn as_wire_value(self) -> &'static str {
        match self {
            Self::Silent => "silent",
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Info => "info",
            Self::Debug => "debug",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "silent" => Some(Self::Silent),
            "error" => Some(Self::Error),
            "warning" | "warn" => Some(Self::Warning),
            "info" => Some(Self::Info),
            "debug" => Some(Self::Debug),
            _ => None,
        }
    }
}

/// Runtime settings an operator can change without restarting the core.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct CorePreferences {
    /// `None` when the core has not reported a mode yet (for example while it
    /// is stopped).
    pub mode: Option<RoutingMode>,
    pub log_level: Option<LogLevel>,
    /// `None` on a core too old to report it.
    pub ipv6: Option<bool>,
}

/// Values baked into every generated profile.
///
/// Unlike [`CorePreferences`] these are known while the core is stopped, so
/// they can be written into the next configuration file.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StartupPreferences {
    pub log_level: LogLevel,
    pub ipv6: bool,
    /// Merges latency measurements for the same node across groups.
    pub unified_delay: bool,
    /// Lets the core open several connections to one host in parallel.
    pub tcp_concurrent: bool,
    /// Fixed mixed-port; `0` reserves a free port on every start.
    pub proxy_port: u16,
}

impl StartupPreferences {
    /// True when every value matches the defaults, which lets the profile
    /// writer leave the subscription's own value in place.
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

impl Default for StartupPreferences {
    fn default() -> Self {
        Self {
            log_level: LogLevel::Warning,
            ipv6: false,
            unified_delay: true,
            tcp_concurrent: true,
            proxy_port: 0,
        }
    }
}

/// Target used for latency probes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DelayProbeSettings {
    /// URL the core requests through a proxy to measure its latency.
    pub url: String,
    pub timeout_ms: u32,
}

pub const DEFAULT_DELAY_PROBE_URL: &str = "http://www.gstatic.com/generate_204";
pub const DEFAULT_DELAY_TIMEOUT_MS: u32 = 5_000;
pub const MIN_DELAY_TIMEOUT_MS: u32 = 1_000;
pub const MAX_DELAY_TIMEOUT_MS: u32 = 10_000;

impl Default for DelayProbeSettings {
    fn default() -> Self {
        Self {
            url: DEFAULT_DELAY_PROBE_URL.to_owned(),
            timeout_ms: DEFAULT_DELAY_TIMEOUT_MS,
        }
    }
}

impl DelayProbeSettings {
    /// Returns the settings with the timeout inside the supported range.
    pub fn normalized(mut self) -> Self {
        self.timeout_ms = self
            .timeout_ms
            .clamp(MIN_DELAY_TIMEOUT_MS, MAX_DELAY_TIMEOUT_MS);
        if self.url.trim().is_empty() {
            self.url = DEFAULT_DELAY_PROBE_URL.to_owned();
        }
        self
    }

    /// True when the URL can be sent to the core as a probe target.
    pub fn has_valid_url(&self) -> bool {
        let url = self.url.trim();
        (url.starts_with("http://") || url.starts_with("https://"))
            && url.len() <= 2048
            && !url.chars().any(char::is_control)
    }
}

/// One node's measured delay.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DelaySample {
    pub proxy: String,
    pub delay_ms: u32,
}

/// Result of probing every node in a proxy group.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct GroupDelayResult {
    pub group: String,
    /// Nodes that answered the probe. Nodes that timed out are absent rather
    /// than reported as zero.
    pub delays: Vec<DelaySample>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TelemetrySnapshot {
    pub state: RuntimeState,
    pub timestamp_ms: i64,
    pub upload_bps: u64,
    pub download_bps: u64,
    pub total_upload_bytes: u64,
    pub total_download_bytes: u64,
    pub memory_bytes: u64,
    pub active_connections: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ConnectionSummary {
    pub id: String,
    pub host: String,
    pub destination_ip: String,
    pub destination_port: u16,
    pub network: String,
    pub rule: String,
    pub rule_payload: String,
    pub chains: Vec<String>,
    pub upload_bytes: u64,
    pub download_bytes: u64,
    pub started_at_ms: i64,
}

/// Traffic and expiry numbers a provider sends in its `subscription-userinfo`
/// response header.
///
/// Every field is optional: providers omit what they do not track, and a pasted
/// subscription has no header at all.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct SubscriptionUsage {
    /// Bytes downloaded through the provider so far.
    #[serde(default)]
    pub upload_bytes: Option<u64>,
    #[serde(default)]
    pub download_bytes: Option<u64>,
    /// Total allowance in bytes. `0` is how many providers spell "unlimited".
    #[serde(default)]
    pub total_bytes: Option<u64>,
    /// Expiry as an epoch timestamp in seconds.
    #[serde(default)]
    pub expire_at_ms: Option<i64>,
}

impl SubscriptionUsage {
    /// True when the provider reported nothing worth showing.
    pub fn is_empty(&self) -> bool {
        self.upload_bytes.is_none()
            && self.download_bytes.is_none()
            && self.total_bytes.is_none()
            && self.expire_at_ms.is_none()
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct SubscriptionSnapshot {
    /// Groups and nodes read from the imported document. Does not reflect a
    /// running core; it exists so the UI has something to show while stopped.
    pub groups: Vec<ProxyGroup>,
    pub rules: Vec<RuleItem>,
    /// True when a subscription is stored on disk.
    pub has_subscription: bool,
    /// Where the document was downloaded from, when it was imported by URL.
    /// `None` for a pasted document, which cannot be refreshed automatically.
    #[serde(default)]
    pub source_url: Option<String>,
    /// Timestamp of the last successful import, in epoch milliseconds.
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
    /// Name the operator gave the subscription.
    #[serde(default)]
    pub name: Option<String>,
    /// Usage and expiry from the provider, captured at the last import.
    #[serde(default)]
    pub usage: Option<SubscriptionUsage>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ConnectionPage {
    pub upload_total_bytes: u64,
    pub download_total_bytes: u64,
    pub memory_bytes: u64,
    pub connections: Vec<ConnectionSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuleItem {
    pub index: usize,
    pub rule_type: String,
    pub payload: String,
    pub proxy: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProfileInfo {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub updated_at_ms: Option<i64>,
    /// Where the active profile came from, when it was imported.
    #[serde(default)]
    pub source: Option<String>,
    /// Number of proxy nodes the active profile declares.
    #[serde(default)]
    pub proxy_count: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommandResult<T> {
    Success(T),
    Failure(RuntimeError),
}

impl<T> CommandResult<T> {
    pub fn success(data: T) -> Self {
        Self::Success(data)
    }

    pub fn failure(error: RuntimeError) -> Self {
        Self::Failure(error)
    }
}

impl<T> Serialize for CommandResult<T>
where
    T: Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Success(data) => {
                let mut result = serializer.serialize_struct("CommandResult", 2)?;
                result.serialize_field("ok", &true)?;
                result.serialize_field("data", data)?;
                result.end()
            }
            Self::Failure(error) => {
                let mut result = serializer.serialize_struct("CommandResult", 2)?;
                result.serialize_field("ok", &false)?;
                result.serialize_field("error", error)?;
                result.end()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CommandResult, ConnectionPage, ConnectionSummary, CoreInfo, ProfileInfo, ProxyGroup,
        ProxyNode, RuleItem, RuntimeBackend, RuntimeError, RuntimeErrorCode, RuntimeLogEntry,
        RuntimeLogLevel, RuntimeSnapshot, RuntimeState, TelemetrySnapshot,
    };
    use serde_json::json;

    #[test]
    fn runtime_contracts_use_stable_snake_case_wire_values() {
        assert_eq!(
            serde_json::to_value(RuntimeState::RunningDisconnected).expect("serialize state"),
            json!("running_disconnected")
        );
        assert_eq!(
            serde_json::to_value(RuntimeBackend::Demo).expect("serialize backend"),
            json!("demo")
        );
        assert_eq!(
            serde_json::to_value(RuntimeErrorCode::AlreadyRunning).expect("serialize error code"),
            json!("already_running")
        );
    }

    #[test]
    fn command_results_have_stable_success_and_failure_shapes() {
        let snapshot = RuntimeSnapshot {
            backend: RuntimeBackend::Demo,
            state: RuntimeState::Stopped,
            sequence: 0,
            started_at_ms: None,
            last_error: None,
            log_count: 0,
        };

        assert_eq!(
            serde_json::to_value(CommandResult::success(snapshot)).expect("serialize success"),
            json!({
                "ok": true,
                "data": {
                    "backend": "demo",
                    "state": "stopped",
                    "sequence": 0,
                    "started_at_ms": null,
                    "last_error": null,
                    "log_count": 0
                }
            })
        );

        let error = RuntimeError::new(
            RuntimeErrorCode::AlreadyRunning,
            "FlowProxy Runtime is already running.",
            false,
        );
        assert_eq!(
            serde_json::to_value(CommandResult::<()>::failure(error)).expect("serialize failure"),
            json!({
                "ok": false,
                "error": {
                    "code": "already_running",
                    "message": "FlowProxy Runtime is already running.",
                    "retryable": false
                }
            })
        );
    }

    #[test]
    fn error_code_does_not_depend_on_display_message() {
        let english = RuntimeError::new(
            RuntimeErrorCode::AlreadyRunning,
            "FlowProxy Runtime is already running.",
            false,
        );
        let translated = RuntimeError::new(
            RuntimeErrorCode::AlreadyRunning,
            "Runtime is already active.",
            false,
        );

        assert_eq!(english.code, translated.code);
    }

    #[test]
    fn platform_integration_error_has_a_stable_wire_value() {
        assert_eq!(
            serde_json::to_value(RuntimeErrorCode::PlatformIntegration)
                .expect("serialize platform integration error"),
            json!("platform_integration")
        );
    }

    #[test]
    fn runtime_error_display_uses_the_safe_human_message() {
        let error = RuntimeError::new(
            RuntimeErrorCode::AdapterFailure,
            "Demo Runtime could not be started.",
            true,
        );

        assert_eq!(error.to_string(), "Demo Runtime could not be started.");
    }

    #[test]
    fn log_entries_expose_bounded_metadata_and_stable_levels() {
        let entry = RuntimeLogEntry {
            sequence: 7,
            timestamp_ms: 1_760_000_000_000,
            level: RuntimeLogLevel::Warn,
            message: "Demo Runtime stopped.".to_owned(),
            error_code: Some(RuntimeErrorCode::NotRunning),
        };

        assert_eq!(
            serde_json::to_value(entry).expect("serialize log entry"),
            json!({
                "sequence": 7,
                "timestamp_ms": 1_760_000_000_000_i64,
                "level": "warn",
                "message": "Demo Runtime stopped.",
                "error_code": "not_running"
            })
        );
    }

    #[test]
    fn phase_three_contracts_use_stable_snake_case_wire_values() {
        let core = CoreInfo {
            backend: RuntimeBackend::Mihomo,
            version: "v1.19.33".to_owned(),
            pid: Some(42),
        };
        let proxy = ProxyNode {
            name: "DIRECT".to_owned(),
            proxy_type: "Direct".to_owned(),
            udp: true,
            delay_ms: Some(12),
            alive: true,
        };
        let group = ProxyGroup {
            name: "FlowProxy Direct".to_owned(),
            group_type: "Selector".to_owned(),
            selected: "DIRECT".to_owned(),
            nodes: vec![proxy],
        };
        let telemetry = TelemetrySnapshot {
            state: RuntimeState::Connected,
            timestamp_ms: 1_760_000_000_000,
            upload_bps: 512,
            download_bps: 4_096,
            total_upload_bytes: 10_000,
            total_download_bytes: 20_000,
            memory_bytes: 30_000,
            active_connections: 3,
        };

        assert_eq!(
            serde_json::to_value(core).expect("serialize core info"),
            json!({
                "backend": "mihomo",
                "version": "v1.19.33",
                "pid": 42
            })
        );
        assert_eq!(
            serde_json::to_value(group).expect("serialize proxy group"),
            json!({
                "name": "FlowProxy Direct",
                "group_type": "Selector",
                "selected": "DIRECT",
                "nodes": [{
                    "name": "DIRECT",
                    "proxy_type": "Direct",
                    "udp": true,
                    "delay_ms": 12,
                    "alive": true
                }]
            })
        );
        assert_eq!(
            serde_json::to_value(telemetry).expect("serialize telemetry"),
            json!({
                "state": "connected",
                "timestamp_ms": 1_760_000_000_000_i64,
                "upload_bps": 512,
                "download_bps": 4096,
                "total_upload_bytes": 10000,
                "total_download_bytes": 20000,
                "memory_bytes": 30000,
                "active_connections": 3
            })
        );
    }

    #[test]
    fn phase_three_command_payloads_have_stable_shapes() {
        let connection = ConnectionSummary {
            id: "connection-1".to_owned(),
            host: "example.com".to_owned(),
            destination_ip: "203.0.113.10".to_owned(),
            destination_port: 443,
            network: "tcp".to_owned(),
            rule: "MATCH".to_owned(),
            rule_payload: String::new(),
            chains: vec!["DIRECT".to_owned()],
            upload_bytes: 120,
            download_bytes: 4_800,
            started_at_ms: 1_760_000_000_000,
        };
        let page = ConnectionPage {
            upload_total_bytes: 120,
            download_total_bytes: 4_800,
            memory_bytes: 16_384,
            connections: vec![connection],
        };
        let rule = RuleItem {
            index: 0,
            rule_type: "MATCH".to_owned(),
            payload: String::new(),
            proxy: "FlowProxy Direct".to_owned(),
        };
        let profile = ProfileInfo {
            id: "flowproxy-direct".to_owned(),
            name: "FlowProxy Direct".to_owned(),
            active: true,
            updated_at_ms: None,
            source: None,
            proxy_count: None,
        };

        assert_eq!(
            serde_json::to_value(page).expect("serialize connection page"),
            json!({
                "upload_total_bytes": 120,
                "download_total_bytes": 4800,
                "memory_bytes": 16384,
                "connections": [{
                    "id": "connection-1",
                    "host": "example.com",
                    "destination_ip": "203.0.113.10",
                    "destination_port": 443,
                    "network": "tcp",
                    "rule": "MATCH",
                    "rule_payload": "",
                    "chains": ["DIRECT"],
                    "upload_bytes": 120,
                    "download_bytes": 4800,
                    "started_at_ms": 1_760_000_000_000_i64
                }]
            })
        );
        assert_eq!(
            serde_json::to_value(rule).expect("serialize rule"),
            json!({
                "index": 0,
                "rule_type": "MATCH",
                "payload": "",
                "proxy": "FlowProxy Direct"
            })
        );
        assert_eq!(
            serde_json::to_value(profile).expect("serialize profile"),
            json!({
                "id": "flowproxy-direct",
                "name": "FlowProxy Direct",
                "active": true,
                "updated_at_ms": null,
                "source": null,
                "proxy_count": null
            })
        );
    }

    #[test]
    fn phase_three_error_codes_are_stable_and_machine_readable() {
        for (code, expected) in [
            (RuntimeErrorCode::CoreUnavailable, "core_unavailable"),
            (RuntimeErrorCode::ConfigInvalid, "config_invalid"),
            (RuntimeErrorCode::ApiUnavailable, "api_unavailable"),
            (RuntimeErrorCode::SelectionFailed, "selection_failed"),
            (RuntimeErrorCode::ConnectionNotFound, "connection_not_found"),
            (
                RuntimeErrorCode::SubscriptionInvalid,
                "subscription_invalid",
            ),
        ] {
            assert_eq!(
                serde_json::to_value(code).expect("serialize error code"),
                json!(expected)
            );
        }
    }
}
