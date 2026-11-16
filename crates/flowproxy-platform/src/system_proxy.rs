use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const JOURNAL_VERSION: u32 = 1;
const MAX_JOURNAL_BYTES: u64 = 64 * 1024;
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlatformErrorKind {
    InvalidEndpoint,
    InvalidExecutablePath,
    NotManaged,
    AlreadyManaged,
    JournalCorrupt,
    JournalIo,
    BackendFailure,
    RestoreFailed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformError {
    pub kind: PlatformErrorKind,
    pub message: String,
}

impl Display for PlatformError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for PlatformError {}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProxySettings {
    pub enabled: Option<bool>,
    pub server: Option<String>,
}

pub trait ProxyBackend {
    fn read(&mut self) -> Result<ProxySettings, PlatformError>;
    fn write_enabled(&mut self, value: Option<bool>) -> Result<(), PlatformError>;
    fn write_server(&mut self, value: Option<&str>) -> Result<(), PlatformError>;
    fn refresh(&mut self) -> Result<(), PlatformError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProxyRecovery {
    Restored,
    ReleasedExternalChange,
    NothingToRecover,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SystemProxySnapshot {
    pub managed: bool,
    pub active: bool,
    pub endpoint: Option<String>,
}

pub struct SystemProxyManager<B> {
    journal_path: PathBuf,
    backend: B,
}

impl<B> SystemProxyManager<B>
where
    B: ProxyBackend,
{
    pub fn new(journal_path: PathBuf, backend: B) -> Self {
        Self {
            journal_path,
            backend,
        }
    }

    pub fn enable(&mut self, endpoint: &str) -> Result<(), PlatformError> {
        validate_managed_endpoint(endpoint)?;

        if self.journal_path.exists() {
            return Err(platform_error(
                PlatformErrorKind::AlreadyManaged,
                "FlowProxy already owns a system proxy journal.",
            ));
        }

        let original = self.backend.read()?;
        let journal = ProxyJournal {
            version: JOURNAL_VERSION,
            original: original.clone(),
            managed_server: endpoint.to_owned(),
        };
        write_journal(&self.journal_path, &journal)?;

        let apply_result = self
            .backend
            .write_server(Some(endpoint))
            .and_then(|_| self.backend.write_enabled(Some(true)))
            .and_then(|_| self.backend.refresh());

        if let Err(error) = apply_result {
            return match self.restore(&original) {
                Ok(()) => {
                    remove_journal(&self.journal_path)?;
                    Err(error)
                }
                Err(restore_error) => Err(platform_error(
                    PlatformErrorKind::RestoreFailed,
                    format!(
                        "FlowProxy could not apply or restore the system proxy: {error}; restoration failed: {restore_error}"
                    ),
                )),
            };
        }

        Ok(())
    }

    pub fn disable(&mut self) -> Result<ProxyRecovery, PlatformError> {
        let journal = self.read_journal()?.ok_or_else(|| {
            platform_error(
                PlatformErrorKind::NotManaged,
                "FlowProxy does not own the current system proxy.",
            )
        })?;
        self.release_or_restore(&journal)
    }

    pub fn recover(&mut self) -> Result<ProxyRecovery, PlatformError> {
        let Some(journal) = self.read_journal()? else {
            return Ok(ProxyRecovery::NothingToRecover);
        };
        self.release_or_restore(&journal)
    }

    pub fn snapshot(&mut self) -> Result<SystemProxySnapshot, PlatformError> {
        let Some(journal) = self.read_journal()? else {
            return Ok(SystemProxySnapshot {
                managed: false,
                active: false,
                endpoint: None,
            });
        };
        let current = self.backend.read()?;
        Ok(SystemProxySnapshot {
            managed: true,
            active: matches_managed(&current, &journal.managed_server),
            endpoint: Some(journal.managed_server),
        })
    }

    fn release_or_restore(
        &mut self,
        journal: &ProxyJournal,
    ) -> Result<ProxyRecovery, PlatformError> {
        let current = self.backend.read()?;
        if !matches_managed(&current, &journal.managed_server) {
            remove_journal(&self.journal_path)?;
            return Ok(ProxyRecovery::ReleasedExternalChange);
        }

        self.restore(&journal.original)?;
        remove_journal(&self.journal_path)?;
        Ok(ProxyRecovery::Restored)
    }

    fn restore(&mut self, settings: &ProxySettings) -> Result<(), PlatformError> {
        self.backend
            .write_server(settings.server.as_deref())
            .and_then(|_| self.backend.write_enabled(settings.enabled))
            .and_then(|_| self.backend.refresh())
    }

    fn read_journal(&self) -> Result<Option<ProxyJournal>, PlatformError> {
        let metadata = match fs::metadata(&self.journal_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(platform_error(
                    PlatformErrorKind::JournalIo,
                    format!("FlowProxy could not inspect the system proxy journal: {error}"),
                ));
            }
        };
        if metadata.len() > MAX_JOURNAL_BYTES {
            return Err(platform_error(
                PlatformErrorKind::JournalCorrupt,
                "FlowProxy system proxy journal exceeded the 64 KiB safety limit.",
            ));
        }

        let contents = match fs::read_to_string(&self.journal_path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(platform_error(
                    PlatformErrorKind::JournalIo,
                    "FlowProxy system proxy journal disappeared while it was being read.",
                ));
            }
            Err(error) => {
                return Err(platform_error(
                    PlatformErrorKind::JournalIo,
                    format!("FlowProxy could not read the system proxy journal: {error}"),
                ));
            }
        };

        let journal = serde_json::from_str::<ProxyJournal>(&contents).map_err(|error| {
            platform_error(
                PlatformErrorKind::JournalCorrupt,
                format!("FlowProxy system proxy journal is invalid: {error}"),
            )
        })?;
        if journal.version != JOURNAL_VERSION {
            return Err(platform_error(
                PlatformErrorKind::JournalCorrupt,
                "FlowProxy system proxy journal uses an unsupported version.",
            ));
        }
        validate_managed_endpoint(&journal.managed_server).map_err(|error| {
            platform_error(
                PlatformErrorKind::JournalCorrupt,
                format!("FlowProxy system proxy journal is invalid: {error}"),
            )
        })?;
        Ok(Some(journal))
    }
}

fn validate_managed_endpoint(endpoint: &str) -> Result<(), PlatformError> {
    let Some((host, port)) = endpoint.rsplit_once(':') else {
        return Err(invalid_endpoint());
    };
    let valid_port = !port.is_empty()
        && port.bytes().all(|byte| byte.is_ascii_digit())
        && port.parse::<u16>().is_ok_and(|port| port > 0);
    if host != "127.0.0.1" || !valid_port {
        return Err(invalid_endpoint());
    }
    Ok(())
}

fn invalid_endpoint() -> PlatformError {
    platform_error(
        PlatformErrorKind::InvalidEndpoint,
        "The managed system proxy endpoint must be 127.0.0.1 with a valid port.",
    )
}

fn matches_managed(settings: &ProxySettings, managed_server: &str) -> bool {
    settings.enabled == Some(true) && settings.server.as_deref() == Some(managed_server)
}

fn write_journal(path: &Path, journal: &ProxyJournal) -> Result<(), PlatformError> {
    let parent = path.parent().ok_or_else(|| {
        platform_error(
            PlatformErrorKind::JournalIo,
            "FlowProxy system proxy journal has no parent directory.",
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| journal_io_error("create", error))?;

    let temporary_path = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("system-proxy.json"),
        std::process::id(),
        TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = write_temporary_journal(&temporary_path, journal).and_then(|_| {
        fs::rename(&temporary_path, path).map_err(|error| journal_io_error("replace", error))
    });
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn write_temporary_journal(path: &Path, journal: &ProxyJournal) -> Result<(), PlatformError> {
    let mut file = create_temporary_file(path)?;
    let contents = serde_json::to_vec_pretty(journal).map_err(|error| {
        platform_error(
            PlatformErrorKind::JournalIo,
            format!("FlowProxy could not serialize the system proxy journal: {error}"),
        )
    })?;
    file.write_all(&contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| journal_io_error("write", error))
}

fn create_temporary_file(path: &Path) -> Result<File, PlatformError> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| journal_io_error("create", error))
}

fn remove_journal(path: &Path) -> Result<(), PlatformError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(journal_io_error("remove", error)),
    }
}

fn journal_io_error(action: &str, error: io::Error) -> PlatformError {
    platform_error(
        PlatformErrorKind::JournalIo,
        format!("FlowProxy could not {action} the system proxy journal: {error}"),
    )
}

pub(crate) fn platform_error(kind: PlatformErrorKind, message: impl Into<String>) -> PlatformError {
    PlatformError {
        kind,
        message: message.into(),
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ProxyJournal {
    version: u32,
    original: ProxySettings,
    managed_server: String,
}

#[cfg(test)]
mod tests {
    use super::{
        PlatformError, PlatformErrorKind, ProxyBackend, ProxyRecovery, ProxySettings,
        SystemProxyManager,
    };
    use std::cell::RefCell;
    use std::fs;
    use std::rc::Rc;

    const ORIGINAL_SERVER: &str = "192.168.1.2:7890";
    const MANAGED_SERVER: &str = "127.0.0.1:49153";

    #[derive(Default)]
    struct BackendState {
        settings: ProxySettings,
        fail_server_write: bool,
        refreshes: usize,
        reads: usize,
    }

    #[derive(Clone)]
    struct FakeProxyBackend {
        state: Rc<RefCell<BackendState>>,
    }

    impl FakeProxyBackend {
        fn new(enabled: Option<bool>, server: Option<&str>) -> Self {
            Self {
                state: Rc::new(RefCell::new(BackendState {
                    settings: ProxySettings {
                        enabled,
                        server: server.map(str::to_owned),
                    },
                    ..BackendState::default()
                })),
            }
        }

        fn settings(&self) -> ProxySettings {
            self.state.borrow().settings.clone()
        }

        fn fail_next_server_write(&self) {
            self.state.borrow_mut().fail_server_write = true;
        }

        fn refresh_count(&self) -> usize {
            self.state.borrow().refreshes
        }

        fn read_count(&self) -> usize {
            self.state.borrow().reads
        }

        fn set_external(&self, enabled: bool, server: &str) {
            let mut state = self.state.borrow_mut();
            state.settings.enabled = Some(enabled);
            state.settings.server = Some(server.to_owned());
        }
    }

    impl ProxyBackend for FakeProxyBackend {
        fn read(&mut self) -> Result<ProxySettings, PlatformError> {
            self.state.borrow_mut().reads += 1;
            Ok(self.settings())
        }

        fn write_enabled(&mut self, value: Option<bool>) -> Result<(), PlatformError> {
            self.state.borrow_mut().settings.enabled = value;
            Ok(())
        }

        fn write_server(&mut self, value: Option<&str>) -> Result<(), PlatformError> {
            let mut state = self.state.borrow_mut();
            if state.fail_server_write {
                state.fail_server_write = false;
                return Err(PlatformError {
                    kind: PlatformErrorKind::BackendFailure,
                    message: "simulated registry write failure".to_owned(),
                });
            }
            state.settings.server = value.map(str::to_owned);
            Ok(())
        }

        fn refresh(&mut self) -> Result<(), PlatformError> {
            self.state.borrow_mut().refreshes += 1;
            Ok(())
        }
    }

    fn journal_path(directory: &tempfile::TempDir) -> std::path::PathBuf {
        directory.path().join("system-proxy.json")
    }

    #[test]
    fn enable_persists_original_values_before_applying_the_loopback_endpoint() {
        let directory = tempfile::tempdir().expect("temporary journal directory");
        let backend = FakeProxyBackend::new(Some(false), Some(ORIGINAL_SERVER));
        let mut manager = SystemProxyManager::new(journal_path(&directory), backend.clone());

        manager
            .enable(MANAGED_SERVER)
            .expect("enable managed proxy");

        assert_eq!(
            backend.settings(),
            ProxySettings {
                enabled: Some(true),
                server: Some(MANAGED_SERVER.to_owned()),
            }
        );
        assert_eq!(backend.refresh_count(), 1);
        let journal = fs::read_to_string(journal_path(&directory)).expect("read proxy journal");
        assert!(journal.contains(ORIGINAL_SERVER));
        assert!(journal.contains(MANAGED_SERVER));
        assert!(journal.contains("\"enabled\": false"));
    }

    #[test]
    fn partial_apply_failure_restores_original_values_and_removes_the_journal() {
        let directory = tempfile::tempdir().expect("temporary journal directory");
        let backend = FakeProxyBackend::new(Some(false), Some(ORIGINAL_SERVER));
        backend.fail_next_server_write();
        let mut manager = SystemProxyManager::new(journal_path(&directory), backend.clone());

        let error = manager
            .enable(MANAGED_SERVER)
            .expect_err("simulated registry failure must be returned");

        assert_eq!(error.kind, PlatformErrorKind::BackendFailure);
        assert_eq!(
            backend.settings(),
            ProxySettings {
                enabled: Some(false),
                server: Some(ORIGINAL_SERVER.to_owned()),
            }
        );
        assert!(!journal_path(&directory).exists());
    }

    #[test]
    fn disable_never_overwrites_proxy_values_changed_by_the_user() {
        let directory = tempfile::tempdir().expect("temporary journal directory");
        let backend = FakeProxyBackend::new(Some(false), Some(ORIGINAL_SERVER));
        let mut manager = SystemProxyManager::new(journal_path(&directory), backend.clone());
        manager
            .enable(MANAGED_SERVER)
            .expect("enable managed proxy");
        backend.set_external(true, "10.0.0.2:8080");

        let outcome = manager.disable().expect("release externally changed proxy");

        assert_eq!(outcome, ProxyRecovery::ReleasedExternalChange);
        assert_eq!(
            backend.settings(),
            ProxySettings {
                enabled: Some(true),
                server: Some("10.0.0.2:8080".to_owned()),
            }
        );
        assert!(!journal_path(&directory).exists());
    }

    #[test]
    fn disable_without_a_journal_never_touches_user_proxy_settings() {
        let directory = tempfile::tempdir().expect("temporary journal directory");
        let backend = FakeProxyBackend::new(Some(true), Some(ORIGINAL_SERVER));
        let mut manager = SystemProxyManager::new(journal_path(&directory), backend.clone());

        let error = manager
            .disable()
            .expect_err("user-owned proxy cannot be disabled without a journal");

        assert_eq!(error.kind, PlatformErrorKind::NotManaged);
        assert_eq!(
            backend.settings(),
            ProxySettings {
                enabled: Some(true),
                server: Some(ORIGINAL_SERVER.to_owned()),
            }
        );
    }

    #[test]
    fn corrupt_journal_is_reported_without_mutating_proxy_settings() {
        let directory = tempfile::tempdir().expect("temporary journal directory");
        fs::write(journal_path(&directory), "{not-json").expect("write corrupt journal");
        let backend = FakeProxyBackend::new(Some(true), Some(MANAGED_SERVER));
        let mut manager = SystemProxyManager::new(journal_path(&directory), backend.clone());

        let error = manager
            .disable()
            .expect_err("corrupt journal must not be guessed");

        assert_eq!(error.kind, PlatformErrorKind::JournalCorrupt);
        assert_eq!(
            backend.settings(),
            ProxySettings {
                enabled: Some(true),
                server: Some(MANAGED_SERVER.to_owned()),
            }
        );
    }

    #[test]
    fn recovery_restores_a_managed_proxy_left_by_an_abrupt_exit() {
        let directory = tempfile::tempdir().expect("temporary journal directory");
        let backend = FakeProxyBackend::new(Some(false), Some(ORIGINAL_SERVER));
        let mut manager = SystemProxyManager::new(journal_path(&directory), backend.clone());
        manager
            .enable(MANAGED_SERVER)
            .expect("enable managed proxy");

        let outcome = manager.recover().expect("recover managed proxy");

        assert_eq!(outcome, ProxyRecovery::Restored);
        assert_eq!(
            backend.settings(),
            ProxySettings {
                enabled: Some(false),
                server: Some(ORIGINAL_SERVER.to_owned()),
            }
        );
        assert!(!journal_path(&directory).exists());
    }

    #[test]
    fn oversized_journal_is_rejected_before_reading_or_mutating_proxy_settings() {
        let directory = tempfile::tempdir().expect("temporary journal directory");
        let contents = format!(
            concat!(
                "{{\"version\":1,",
                "\"original\":{{\"enabled\":true,\"server\":\"{managed}\"}},",
                "\"managed_server\":\"{managed}\",",
                "\"padding\":\"{}\"}}"
            ),
            "x".repeat(64 * 1024),
            managed = MANAGED_SERVER
        );
        fs::write(journal_path(&directory), contents).expect("write oversized journal");
        let backend = FakeProxyBackend::new(Some(true), Some(MANAGED_SERVER));
        let mut manager = SystemProxyManager::new(journal_path(&directory), backend.clone());

        let error = manager
            .recover()
            .expect_err("oversized journal must be rejected");

        assert_eq!(error.kind, PlatformErrorKind::JournalCorrupt);
        assert_eq!(backend.read_count(), 0);
        assert_eq!(
            backend.settings(),
            ProxySettings {
                enabled: Some(true),
                server: Some(MANAGED_SERVER.to_owned()),
            }
        );
    }
}
