use crate::binary::{random_hex, resolve_verified_binary, VerifiedMihomoBinary};
use crate::config::ConfigStore;
use crate::control_api::{
    close_connection, parse_connections, parse_proxy_groups, parse_rules, select_proxy, test_delay,
    LoopbackApiClient,
};
use crate::MihomoAdapter;
use flowproxy_contracts::{
    ConnectionPage, CoreInfo, ProfileInfo, ProxyGroup, RuleItem, RuntimeBackend, RuntimeError,
    RuntimeErrorCode, RuntimeState, TelemetrySnapshot,
};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_CAPTURED_LOGS: usize = 500;
const MAX_PROFILE_VALIDATOR_OUTPUT_BYTES: usize = 64 * 1024;
const API_START_TIMEOUT: Duration = Duration::from_secs(5);
const PROFILE_VALIDATION_TIMEOUT: Duration = Duration::from_secs(10);

pub struct MihomoCoreAdapter {
    binary: VerifiedMihomoBinary,
    config_store: ConfigStore,
    child: Option<Child>,
    log_pump: Option<LogPump>,
    client: Option<LoopbackApiClient>,
    proxy_port: Option<u16>,
    telemetry_sample: Option<TelemetrySample>,
    pending_logs: VecDeque<String>,
}

struct TelemetrySample {
    sampled_at: Instant,
    upload_bytes: u64,
    download_bytes: u64,
}

struct LogPump {
    receiver: Receiver<String>,
    workers: Vec<JoinHandle<()>>,
}

impl MihomoCoreAdapter {
    pub fn discover(config_directory: PathBuf) -> Result<Self, RuntimeError> {
        let binary = resolve_verified_binary(default_binary_candidates(&config_directory))?;
        Ok(Self::new(
            binary,
            ConfigStore::new(config_directory.join("config.yaml")),
        ))
    }

    pub fn new(binary: VerifiedMihomoBinary, config_store: ConfigStore) -> Self {
        Self {
            binary,
            config_store,
            child: None,
            log_pump: None,
            client: None,
            proxy_port: None,
            telemetry_sample: None,
            pending_logs: VecDeque::new(),
        }
    }

    pub fn binary_digest(&self) -> &str {
        self.binary.digest()
    }

    fn client(&self) -> Result<&LoopbackApiClient, RuntimeError> {
        self.client
            .as_ref()
            .ok_or_else(|| api_error("The local Mihomo control API is not connected."))
    }

    fn start_core(&mut self) -> Result<(), RuntimeError> {
        if self.child.is_some() || self.is_running() {
            return Err(RuntimeError::new(
                RuntimeErrorCode::AlreadyRunning,
                "The Mihomo core is already running.",
                false,
            ));
        }

        let previous_profile = self.config_store.snapshot()?;
        match self.start_core_with_profile() {
            Ok(()) => Ok(()),
            Err(error) => {
                if let Err(restore_error) = self.config_store.restore(previous_profile.as_deref()) {
                    return Err(RuntimeError::new(
                        error.code,
                        format!(
                            "{} The previous Mihomo profile could not be restored: {}",
                            error.message, restore_error.message
                        ),
                        false,
                    ));
                }
                Err(error)
            }
        }
    }

    fn start_core_with_profile(&mut self) -> Result<(), RuntimeError> {
        let (api_port, proxy_port) = reserve_loopback_ports()?;
        let secret = random_hex(32)?;
        let profile = crate::render_direct_profile(api_port, proxy_port, &secret)?;
        let binary_path = self.binary.path().to_path_buf();
        self.config_store.activate(&profile, |candidate| {
            validate_profile(&binary_path, candidate, &secret)
        })?;

        let config_path = self.config_store.path().to_path_buf();
        let working_directory = config_path
            .parent()
            .ok_or_else(|| {
                RuntimeError::new(
                    RuntimeErrorCode::ConfigInvalid,
                    "The Mihomo configuration path has no parent directory.",
                    false,
                )
            })?
            .to_path_buf();

        let mut command = Command::new(self.binary.path());
        command
            .arg("-d")
            .arg(&working_directory)
            .arg("-f")
            .arg(&config_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console_window(&mut command);

        let mut child = command.spawn().map_err(|error| {
            RuntimeError::new(
                RuntimeErrorCode::CoreUnavailable,
                format!("The Mihomo core could not be started: {error}"),
                true,
            )
        })?;
        let log_pump = match LogPump::capture(&mut child) {
            Ok(log_pump) => log_pump,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        self.child = Some(child);
        self.log_pump = Some(log_pump);
        self.client = Some(LoopbackApiClient::new(
            &format!("http://127.0.0.1:{api_port}"),
            &secret,
        )?);
        self.proxy_port = Some(proxy_port);
        self.telemetry_sample = None;

        let deadline = Instant::now() + API_START_TIMEOUT;
        loop {
            self.drain_core_logs();
            if !self.process_is_alive() {
                self.cleanup_failed_start();
                return Err(RuntimeError::new(
                    RuntimeErrorCode::CoreUnavailable,
                    "The Mihomo core exited before its control API became ready.",
                    true,
                ));
            }

            if self.client()?.get_json("/version").is_ok() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                self.cleanup_failed_start();
                return Err(RuntimeError::new(
                    RuntimeErrorCode::ApiUnavailable,
                    "The Mihomo control API did not become ready in time.",
                    true,
                ));
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    fn stop_core(&mut self) -> Result<(), RuntimeError> {
        let Some(mut child) = self.child.take() else {
            self.client = None;
            self.proxy_port = None;
            return Err(RuntimeError::new(
                RuntimeErrorCode::NotRunning,
                "The Mihomo core is not running.",
                false,
            ));
        };

        match child.try_wait() {
            Ok(Some(_)) => {}
            Ok(None) => {
                if let Err(error) = child.kill() {
                    self.child = Some(child);
                    return Err(RuntimeError::new(
                        RuntimeErrorCode::CoreUnavailable,
                        format!("The Mihomo core could not be stopped: {error}"),
                        true,
                    ));
                }
            }
            Err(error) => {
                self.child = Some(child);
                return Err(RuntimeError::new(
                    RuntimeErrorCode::CoreUnavailable,
                    format!("The Mihomo core process state could not be read: {error}"),
                    true,
                ));
            }
        }
        if let Err(error) = child.wait() {
            self.child = Some(child);
            return Err(RuntimeError::new(
                RuntimeErrorCode::CoreUnavailable,
                format!("The Mihomo core process could not be reaped: {error}"),
                true,
            ));
        }

        self.client = None;
        self.proxy_port = None;
        self.telemetry_sample = None;
        self.clear_finished_core_session();
        Ok(())
    }

    fn cleanup_failed_start(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.client = None;
        self.proxy_port = None;
        self.telemetry_sample = None;
        self.clear_finished_core_session();
    }

    fn process_is_alive(&mut self) -> bool {
        let Some(child) = self.child.as_mut() else {
            return false;
        };
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => {
                self.child = None;
                self.client = None;
                self.proxy_port = None;
                self.telemetry_sample = None;
                self.clear_finished_core_session();
                false
            }
            Err(_) => false,
        }
    }

    fn clear_finished_core_session(&mut self) {
        if let Some(log_pump) = self.log_pump.as_mut() {
            for worker in log_pump.workers.drain(..) {
                let _ = worker.join();
            }
        }
        self.drain_core_logs();
        self.log_pump = None;
    }

    fn drain_core_logs(&mut self) {
        let Some(log_pump) = self.log_pump.as_ref() else {
            return;
        };
        for line in log_pump.receiver.try_iter() {
            if self.pending_logs.len() == MAX_CAPTURED_LOGS {
                self.pending_logs.pop_front();
            }
            self.pending_logs.push_back(line);
        }
    }

    fn ensure_healthy(&mut self) -> Result<(), RuntimeError> {
        if !self.process_is_alive() {
            return Err(RuntimeError::new(
                RuntimeErrorCode::CoreUnavailable,
                "The Mihomo core process exited unexpectedly.",
                true,
            ));
        }
        self.client()?;
        Ok(())
    }

    fn fetch_connections(&mut self) -> Result<ConnectionPage, RuntimeError> {
        self.ensure_healthy()?;
        let payload = self.client()?.get_json("/connections")?;
        parse_connections(&payload)
    }
}

impl MihomoAdapter for MihomoCoreAdapter {
    fn start(&mut self) -> Result<(), RuntimeError> {
        self.start_core()
    }

    fn stop(&mut self) -> Result<(), RuntimeError> {
        self.stop_core()
    }

    fn simulate_crash(&mut self) -> Result<(), RuntimeError> {
        Err(RuntimeError::new(
            RuntimeErrorCode::InvalidState,
            "Crash simulation is unavailable for a real Mihomo core.",
            false,
        ))
    }

    fn is_running(&mut self) -> bool {
        self.process_is_alive()
    }

    fn health(&mut self) -> Result<(), RuntimeError> {
        self.ensure_healthy()?;
        self.client()?.get_json("/version")?;
        Ok(())
    }

    fn controlled_proxy_endpoint(&mut self) -> Option<String> {
        if !self.process_is_alive() {
            return None;
        }
        self.proxy_port
            .filter(|port| *port > 0)
            .map(|port| format!("127.0.0.1:{port}"))
    }

    fn core_info(&mut self) -> Result<CoreInfo, RuntimeError> {
        self.ensure_healthy()?;
        let payload = self.client()?.get_json("/version")?;
        Ok(CoreInfo {
            backend: RuntimeBackend::Mihomo,
            version: payload
                .get("version")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(crate::LOCKED_MIHOMO_VERSION)
                .to_owned(),
            pid: self.child.as_ref().map(Child::id),
        })
    }

    fn telemetry(&mut self) -> Result<TelemetrySnapshot, RuntimeError> {
        let page = self.fetch_connections()?;
        let sampled_at = Instant::now();
        let (upload_bps, download_bps) = self
            .telemetry_sample
            .as_ref()
            .map(|previous| {
                let elapsed_seconds = sampled_at
                    .saturating_duration_since(previous.sampled_at)
                    .as_secs_f64()
                    .max(0.001);
                (
                    rate_per_second(
                        page.upload_total_bytes,
                        previous.upload_bytes,
                        elapsed_seconds,
                    ),
                    rate_per_second(
                        page.download_total_bytes,
                        previous.download_bytes,
                        elapsed_seconds,
                    ),
                )
            })
            .unwrap_or((0, 0));
        self.telemetry_sample = Some(TelemetrySample {
            sampled_at,
            upload_bytes: page.upload_total_bytes,
            download_bytes: page.download_total_bytes,
        });

        Ok(TelemetrySnapshot {
            state: RuntimeState::Connected,
            timestamp_ms: now_ms(),
            upload_bps,
            download_bps,
            total_upload_bytes: page.upload_total_bytes,
            total_download_bytes: page.download_total_bytes,
            memory_bytes: page.memory_bytes,
            active_connections: page.connections.len(),
        })
    }

    fn proxy_groups(&mut self) -> Result<Vec<ProxyGroup>, RuntimeError> {
        self.ensure_healthy()?;
        let payload = self.client()?.get_json("/proxies")?;
        parse_proxy_groups(&payload)
    }

    fn select_proxy(&mut self, group: &str, proxy: &str) -> Result<(), RuntimeError> {
        self.ensure_healthy()?;
        select_proxy(self.client()?, group, proxy)
    }

    fn test_proxy_delay(&mut self, proxy: &str, timeout_ms: u32) -> Result<u32, RuntimeError> {
        self.ensure_healthy()?;
        test_delay(self.client()?, proxy, timeout_ms)
    }

    fn connections(&mut self) -> Result<ConnectionPage, RuntimeError> {
        self.fetch_connections()
    }

    fn close_connection(&mut self, connection_id: &str) -> Result<(), RuntimeError> {
        self.ensure_healthy()?;
        close_connection(self.client()?, connection_id)
    }

    fn rules(&mut self) -> Result<Vec<RuleItem>, RuntimeError> {
        self.ensure_healthy()?;
        let payload = self.client()?.get_json("/rules")?;
        parse_rules(&payload)
    }

    fn profiles(&mut self) -> Result<Vec<ProfileInfo>, RuntimeError> {
        let updated_at_ms = self
            .config_store
            .path()
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_ms);
        Ok(vec![ProfileInfo {
            id: "flowproxy-direct".to_owned(),
            name: "FlowProxy Direct".to_owned(),
            active: true,
            updated_at_ms,
        }])
    }

    fn take_logs(&mut self) -> Vec<String> {
        self.drain_core_logs();
        self.pending_logs.drain(..).collect()
    }
}

impl Drop for MihomoCoreAdapter {
    fn drop(&mut self) {
        let _ = self.stop_core();
    }
}

impl LogPump {
    fn capture(child: &mut Child) -> Result<Self, RuntimeError> {
        let stdout = child.stdout.take().ok_or_else(|| {
            RuntimeError::new(
                RuntimeErrorCode::CoreUnavailable,
                "The Mihomo stdout pipe is unavailable.",
                true,
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            RuntimeError::new(
                RuntimeErrorCode::CoreUnavailable,
                "The Mihomo stderr pipe is unavailable.",
                true,
            )
        })?;
        let (sender, receiver) = mpsc::sync_channel(MAX_CAPTURED_LOGS);
        let stdout_sender = sender.clone();
        let stderr_sender = sender;
        let stdout_worker = thread::Builder::new()
            .name("flowproxy-mihomo-stdout".to_owned())
            .spawn(move || read_lines(stdout, stdout_sender))
            .map_err(|error| {
                RuntimeError::new(
                    RuntimeErrorCode::CoreUnavailable,
                    format!("The Mihomo stdout reader could not start: {error}"),
                    true,
                )
            })?;
        let stderr_worker = match thread::Builder::new()
            .name("flowproxy-mihomo-stderr".to_owned())
            .spawn(move || read_lines(stderr, stderr_sender))
        {
            Ok(worker) => worker,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_worker.join();
                return Err(RuntimeError::new(
                    RuntimeErrorCode::CoreUnavailable,
                    format!("The Mihomo stderr reader could not start: {error}"),
                    true,
                ));
            }
        };

        Ok(Self {
            receiver,
            workers: vec![stdout_worker, stderr_worker],
        })
    }
}

fn read_lines(reader: impl Read, sender: SyncSender<String>) {
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end_matches(['\r', '\n']);
                if !trimmed.is_empty() {
                    let bounded = trimmed.chars().take(1_024).collect::<String>();
                    match sender.try_send(bounded) {
                        Ok(()) | Err(TrySendError::Full(_)) => {}
                        Err(TrySendError::Disconnected(_)) => break,
                    }
                }
            }
            Err(_) => break,
        }
    }
}

fn validate_profile(binary: &Path, candidate: &Path, secret: &str) -> Result<(), RuntimeError> {
    let mut command = Command::new(binary);
    command
        .arg("-t")
        .arg("-f")
        .arg(candidate)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut command);
    let output = run_profile_validator(&mut command, PROFILE_VALIDATION_TIMEOUT)?;
    if output.status.success() {
        return Ok(());
    }
    let message = profile_validation_detail(&output.stdout, &output.stderr, secret)
        .map(|detail| format!("Mihomo rejected the generated profile: {detail}"))
        .unwrap_or_else(|| "Mihomo rejected the generated profile.".to_owned());
    Err(RuntimeError::new(
        RuntimeErrorCode::ConfigInvalid,
        message,
        false,
    ))
}

fn profile_validation_detail(stdout: &[u8], stderr: &[u8], secret: &str) -> Option<String> {
    let stdout = String::from_utf8_lossy(stdout);
    let stderr = String::from_utf8_lossy(stderr);
    let mut detail = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if detail.is_empty() {
        return None;
    }
    if !secret.is_empty() {
        detail = detail.replace(secret, "[REDACTED]");
    }
    Some(detail.chars().take(512).collect())
}

fn run_profile_validator(command: &mut Command, timeout: Duration) -> Result<Output, RuntimeError> {
    let mut child = command.spawn().map_err(|error| {
        RuntimeError::new(
            RuntimeErrorCode::CoreUnavailable,
            format!("The Mihomo profile validator could not start: {error}"),
            true,
        )
    })?;

    let stdout_reader = child.stdout.take().map(spawn_output_reader);
    let stderr_reader = child.stderr.take().map(spawn_output_reader);
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(20));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_output_reader(stdout_reader);
                let _ = join_output_reader(stderr_reader);
                return Err(RuntimeError::new(
                    RuntimeErrorCode::CoreUnavailable,
                    format!(
                        "The Mihomo profile validator timed out after {} ms.",
                        timeout.as_millis()
                    ),
                    true,
                ));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_output_reader(stdout_reader);
                let _ = join_output_reader(stderr_reader);
                return Err(RuntimeError::new(
                    RuntimeErrorCode::CoreUnavailable,
                    format!("The Mihomo profile validator could not be monitored: {error}"),
                    true,
                ));
            }
        }
    };

    Ok(Output {
        status,
        stdout: join_output_reader(stdout_reader)?,
        stderr: join_output_reader(stderr_reader)?,
    })
}

fn spawn_output_reader(
    mut pipe: impl Read + Send + 'static,
) -> JoinHandle<std::io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut output = Vec::new();
        let mut exceeded_limit = false;
        let mut buffer = [0_u8; 8192];
        loop {
            let read = pipe.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            let remaining = MAX_PROFILE_VALIDATOR_OUTPUT_BYTES.saturating_sub(output.len());
            let retained = read.min(remaining);
            output.extend_from_slice(&buffer[..retained]);
            exceeded_limit |= retained < read;
        }
        if exceeded_limit {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "The Mihomo profile validator output exceeded the 64 KiB limit.",
            ));
        }
        Ok(output)
    })
}

fn join_output_reader(
    reader: Option<JoinHandle<std::io::Result<Vec<u8>>>>,
) -> Result<Vec<u8>, RuntimeError> {
    let Some(reader) = reader else {
        return Ok(Vec::new());
    };
    reader
        .join()
        .map_err(|_| {
            RuntimeError::new(
                RuntimeErrorCode::CoreUnavailable,
                "The Mihomo profile validator output reader stopped unexpectedly.",
                true,
            )
        })?
        .map_err(|error| {
            RuntimeError::new(
                RuntimeErrorCode::CoreUnavailable,
                format!("The Mihomo profile validator output could not be read: {error}"),
                true,
            )
        })
}

fn reserve_loopback_ports() -> Result<(u16, u16), RuntimeError> {
    let first = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        RuntimeError::new(
            RuntimeErrorCode::ApiUnavailable,
            format!("A loopback port could not be reserved: {error}"),
            true,
        )
    })?;
    let first_port = first
        .local_addr()
        .map_err(|error| {
            RuntimeError::new(
                RuntimeErrorCode::ApiUnavailable,
                format!("The reserved loopback port could not be read: {error}"),
                true,
            )
        })?
        .port();
    let second = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        RuntimeError::new(
            RuntimeErrorCode::ApiUnavailable,
            format!("A second loopback port could not be reserved: {error}"),
            true,
        )
    })?;
    let second_port = second
        .local_addr()
        .map_err(|error| {
            RuntimeError::new(
                RuntimeErrorCode::ApiUnavailable,
                format!("The second loopback port could not be read: {error}"),
                true,
            )
        })?
        .port();
    drop(second);
    drop(first);
    Ok((first_port, second_port))
}

fn default_binary_candidates(config_directory: &Path) -> Vec<PathBuf> {
    let explicit = std::env::var_os("FLOWPROXY_MIHOMO_PATH").map(PathBuf::from);
    let executable = std::env::current_exe().ok();
    build_binary_candidates(explicit, executable.as_deref(), config_directory)
}

fn build_binary_candidates(
    explicit: Option<PathBuf>,
    executable: Option<&Path>,
    config_directory: &Path,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(explicit) = explicit {
        candidates.push(explicit);
    }
    if let Some(executable) = executable {
        if let Some(directory) = executable.parent() {
            candidates.push(directory.join("mihomo.exe"));
            candidates.push(directory.join("resources").join("mihomo.exe"));
            candidates.push(directory.join("mihomo").join("mihomo.exe"));
        }
    }
    candidates.push(config_directory.join("mihomo.exe"));
    candidates
}

fn rate_per_second(current: u64, previous: u64, elapsed_seconds: f64) -> u64 {
    let delta = current.saturating_sub(previous);
    ((delta as f64) / elapsed_seconds).round() as u64
}

fn system_time_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn now_ms() -> i64 {
    system_time_ms(SystemTime::now()).unwrap_or(0)
}

fn api_error(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::ApiUnavailable, message, true)
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::{
        build_binary_candidates, profile_validation_detail, rate_per_second, read_lines,
        reserve_loopback_ports, run_profile_validator, LogPump, MihomoCoreAdapter,
    };
    use crate::binary::VerifiedMihomoBinary;
    use crate::config::ConfigStore;
    use crate::control_api::LoopbackApiClient;
    use crate::MihomoAdapter;
    use flowproxy_contracts::RuntimeErrorCode;
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::{Duration, Instant};

    #[test]
    fn telemetry_rates_use_elapsed_time_and_ignore_counter_resets() {
        assert_eq!(rate_per_second(1_500, 500, 2.0), 500);
        assert_eq!(rate_per_second(100, 500, 1.0), 0);
    }

    #[test]
    fn reserved_loopback_ports_are_distinct_and_non_zero() {
        let (api, proxy) = reserve_loopback_ports().expect("reserve loopback ports");
        assert!(api > 0);
        assert!(proxy > 0);
        assert_ne!(api, proxy);
    }

    #[test]
    fn controlled_proxy_endpoint_requires_a_live_owned_core() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 5",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn live child");
        let mut adapter = MihomoCoreAdapter::new(
            VerifiedMihomoBinary::test_fixture(),
            ConfigStore::new(directory.path().join("config.yaml")),
        );
        adapter.child = Some(child);
        adapter.proxy_port = Some(49_153);

        assert_eq!(
            adapter.controlled_proxy_endpoint().as_deref(),
            Some("127.0.0.1:49153")
        );
    }

    #[test]
    fn controlled_proxy_endpoint_is_cleared_after_the_core_exits() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let mut child = Command::new("cmd.exe")
            .args(["/C", "exit", "0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn short-lived child");
        let deadline = Instant::now() + Duration::from_secs(2);
        while child
            .try_wait()
            .expect("read short-lived child state")
            .is_none()
        {
            assert!(Instant::now() < deadline, "short-lived child did not exit");
            thread::sleep(Duration::from_millis(10));
        }
        let mut adapter = MihomoCoreAdapter::new(
            VerifiedMihomoBinary::test_fixture(),
            ConfigStore::new(directory.path().join("config.yaml")),
        );
        adapter.child = Some(child);
        adapter.proxy_port = Some(49_153);

        assert_eq!(adapter.controlled_proxy_endpoint(), None);
        assert!(adapter.proxy_port.is_none());
        assert!(adapter.child.is_none());
    }

    #[test]
    fn exited_core_session_joins_log_workers_and_clears_connection_state() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let mut child = Command::new("cmd.exe")
            .args(["/C", "exit", "0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn short-lived child");
        let deadline = Instant::now() + Duration::from_secs(2);
        while child
            .try_wait()
            .expect("read short-lived child state")
            .is_none()
        {
            assert!(Instant::now() < deadline, "short-lived child did not exit");
            thread::sleep(Duration::from_millis(10));
        }

        let first_finished = Arc::new(AtomicBool::new(false));
        let second_finished = Arc::new(AtomicBool::new(false));
        let first_flag = Arc::clone(&first_finished);
        let second_flag = Arc::clone(&second_finished);
        let (_sender, receiver) = mpsc::channel();
        let workers = vec![
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(100));
                first_flag.store(true, Ordering::Release);
            }),
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(100));
                second_flag.store(true, Ordering::Release);
            }),
        ];

        let mut adapter = MihomoCoreAdapter::new(
            VerifiedMihomoBinary::test_fixture(),
            ConfigStore::new(directory.path().join("config.yaml")),
        );
        adapter.child = Some(child);
        adapter.log_pump = Some(LogPump { receiver, workers });
        adapter.client = Some(
            LoopbackApiClient::new("http://127.0.0.1:49152", "0123456789abcdef")
                .expect("fixture API client"),
        );
        adapter.proxy_port = Some(49153);

        assert!(!adapter.process_is_alive());

        assert!(adapter.child.is_none());
        assert!(adapter.log_pump.is_none());
        assert!(adapter.client.is_none());
        assert!(adapter.proxy_port.is_none());
        assert!(first_finished.load(Ordering::Acquire));
        assert!(second_finished.load(Ordering::Acquire));
    }

    #[test]
    fn log_reader_drops_excess_lines_without_blocking() {
        let source = b"one\ntwo\nthree\nfour\n".as_slice();
        let (sender, receiver) = mpsc::sync_channel(2);

        read_lines(source, sender);

        let lines = receiver.try_iter().collect::<Vec<_>>();
        assert_eq!(lines, vec!["one".to_owned(), "two".to_owned()]);
    }

    #[test]
    fn profile_validator_timeout_kills_a_hung_process() {
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 5",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let started = Instant::now();

        let error = run_profile_validator(&mut command, Duration::from_millis(150))
            .expect_err("hung validator must time out");

        assert_eq!(error.code, RuntimeErrorCode::CoreUnavailable);
        assert!(error.message.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn profile_validator_output_reader_rejects_excess_output() {
        let reader = super::spawn_output_reader(Cursor::new(vec![b'x'; 64 * 1024 + 1]));

        let error = super::join_output_reader(Some(reader))
            .expect_err("validator output above the limit must be rejected");

        assert_eq!(error.code, RuntimeErrorCode::CoreUnavailable);
        assert!(error.message.contains("exceeded"));
    }

    #[test]
    fn profile_validation_detail_includes_stdout_stderr_and_is_bounded() {
        let secret = "debug0123456789abcdef";
        let stdout = format!("stdout:{secret}:{}\n", "a".repeat(280));
        let stderr = format!("stderr:{secret}:{}\n", "b".repeat(280));

        let detail = profile_validation_detail(stdout.as_bytes(), stderr.as_bytes(), secret)
            .expect("validator output should produce an error detail");

        assert!(detail.contains("stdout:"));
        assert!(detail.contains("stderr:"));
        assert!(!detail.contains(secret));
        assert!(detail.contains("[REDACTED]"));
        assert_eq!(detail.chars().count(), 512);
    }

    #[test]
    fn stop_core_terminates_a_running_child_without_an_idle_grace_period() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 5",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn long-lived child");
        let mut adapter = MihomoCoreAdapter::new(
            VerifiedMihomoBinary::test_fixture(),
            ConfigStore::new(directory.path().join("config.yaml")),
        );
        adapter.child = Some(child);

        let started = Instant::now();
        adapter.stop_core().expect("force-stop fixture child");

        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(adapter.child.is_none());
    }

    #[test]
    fn binary_candidates_do_not_embed_developer_install_paths() {
        let executable = PathBuf::from(r"C:\Program Files\FlowProxy\flowproxy.exe");
        let config_directory = PathBuf::from(r"C:\Users\person\AppData\Roaming\FlowProxy");
        let candidates = build_binary_candidates(None, Some(&executable), &config_directory);

        assert_eq!(
            candidates,
            vec![
                PathBuf::from(r"C:\Program Files\FlowProxy\mihomo.exe"),
                PathBuf::from(r"C:\Program Files\FlowProxy\resources\mihomo.exe"),
                PathBuf::from(r"C:\Program Files\FlowProxy\mihomo\mihomo.exe"),
                PathBuf::from(r"C:\Users\person\AppData\Roaming\FlowProxy\mihomo.exe"),
            ]
        );
    }
}
