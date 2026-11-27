use crate::binary::map_io_error;
use flowproxy_contracts::{RuntimeError, RuntimeErrorCode, StartupPreferences};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Path of the imported subscription document kept next to the active
    /// configuration. It holds the operator's original YAML.
    pub fn subscription_path(&self) -> Option<PathBuf> {
        let parent = self.path.parent()?;
        let stem = self
            .path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("config");
        Some(parent.join(format!("{stem}.subscription.yaml")))
    }

    pub fn read_subscription(&self) -> Result<Option<String>, RuntimeError> {
        let Some(path) = self.subscription_path() else {
            return Ok(None);
        };
        match fs::read_to_string(&path) {
            Ok(contents) => Ok(Some(contents)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(map_io_error(
                "Could not read the imported Mihomo subscription",
                error,
            )),
        }
    }

    /// Atomically replaces the stored subscription document.
    pub fn write_subscription<F>(&self, contents: &str, validator: F) -> Result<(), RuntimeError>
    where
        F: FnOnce(&Path) -> Result<(), RuntimeError>,
    {
        let target = self.subscription_path().ok_or_else(|| {
            RuntimeError::new(
                RuntimeErrorCode::ConfigInvalid,
                "The Mihomo configuration path has no parent directory.",
                false,
            )
        })?;
        write_atomically(&target, contents, validator)
    }

    pub fn remove_subscription(&self) -> Result<(), RuntimeError> {
        let Some(path) = self.subscription_path() else {
            return Ok(());
        };
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(map_io_error(
                "Could not remove the imported Mihomo subscription",
                error,
            )),
        }
    }

    pub fn snapshot(&self) -> Result<Option<String>, RuntimeError> {
        match fs::read_to_string(&self.path) {
            Ok(contents) => Ok(Some(contents)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(map_io_error(
                "Could not read the active Mihomo profile",
                error,
            )),
        }
    }

    pub fn restore(&self, contents: Option<&str>) -> Result<(), RuntimeError> {
        match contents {
            Some(contents) => self.activate(contents, |_| Ok(())),
            None => match fs::remove_file(&self.path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(map_io_error(
                    "Could not remove the active Mihomo profile",
                    error,
                )),
            },
        }
    }

    pub fn activate<F>(&self, contents: &str, validator: F) -> Result<(), RuntimeError>
    where
        F: FnOnce(&Path) -> Result<(), RuntimeError>,
    {
        write_atomically(&self.path, contents, validator)
    }
}

fn write_atomically<F>(target: &Path, contents: &str, validator: F) -> Result<(), RuntimeError>
where
    F: FnOnce(&Path) -> Result<(), RuntimeError>,
{
    let parent = target.parent().ok_or_else(|| {
        RuntimeError::new(
            RuntimeErrorCode::ConfigInvalid,
            "The Mihomo configuration path has no parent directory.",
            false,
        )
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| map_io_error("Could not create the Mihomo config directory", error))?;

    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary_path = parent.join(format!(
        ".{}.{}.{}.tmp",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("mihomo-config"),
        std::process::id(),
        sequence
    ));
    let mut temporary_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .map_err(|error| map_io_error("Could not create a temporary Mihomo profile", error))?;
    let guard = TemporaryFileGuard::new(temporary_path.clone());

    temporary_file
        .write_all(contents.as_bytes())
        .and_then(|()| temporary_file.sync_all())
        .map_err(|error| map_io_error("Could not flush the temporary Mihomo profile", error))?;
    drop(temporary_file);

    validator(&temporary_path).map_err(|error| {
        RuntimeError::new(
            RuntimeErrorCode::ConfigInvalid,
            error.message,
            error.retryable,
        )
    })?;

    replace_config(&temporary_path, target)?;
    guard.commit();
    Ok(())
}

fn replace_config(temporary_path: &Path, target_path: &Path) -> Result<(), RuntimeError> {
    if !target_path.exists() {
        return fs::rename(temporary_path, target_path)
            .map_err(|error| map_io_error("Could not activate the Mihomo profile", error));
    }

    let backup_path = target_path.with_extension("yaml.previous");
    if backup_path.exists() {
        fs::remove_file(&backup_path)
            .map_err(|error| map_io_error("Could not clear an old Mihomo backup", error))?;
    }
    fs::rename(target_path, &backup_path)
        .map_err(|error| map_io_error("Could not stage the current Mihomo profile", error))?;

    match fs::rename(temporary_path, target_path) {
        Ok(()) => {
            fs::remove_file(backup_path).map_err(|error| {
                map_io_error("Could not remove the Mihomo profile backup", error)
            })?;
            Ok(())
        }
        Err(error) => {
            let restore_result = fs::rename(&backup_path, target_path);
            if let Err(restore_error) = restore_result {
                return Err(RuntimeError::new(
                    RuntimeErrorCode::ConfigInvalid,
                    format!(
                        "Could not activate the Mihomo profile ({error}); the previous profile could not be restored ({restore_error})."
                    ),
                    false,
                ));
            }
            Err(map_io_error(
                "Could not activate the Mihomo profile; the previous profile was restored",
                error,
            ))
        }
    }
}

pub fn render_direct_profile(
    api_port: u16,
    proxy_port: u16,
    secret: &str,
) -> Result<String, RuntimeError> {
    render_direct_profile_with(api_port, proxy_port, secret, StartupPreferences::default())
}

/// Renders the built-in direct profile with the operator's startup settings.
pub fn render_direct_profile_with(
    api_port: u16,
    proxy_port: u16,
    secret: &str,
    preferences: StartupPreferences,
) -> Result<String, RuntimeError> {
    if api_port == 0 || proxy_port == 0 || api_port == proxy_port {
        return Err(RuntimeError::new(
            RuntimeErrorCode::ConfigInvalid,
            "Mihomo loopback ports must be distinct and non-zero.",
            false,
        ));
    }
    if secret.len() < 16
        || !secret
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(RuntimeError::new(
            RuntimeErrorCode::ConfigInvalid,
            "The Mihomo API secret does not meet the Runtime safety policy.",
            false,
        ));
    }

    Ok(format!(
        concat!(
            "# FlowProxy generated direct profile. Do not edit while the core is running.\n",
            "external-controller: 127.0.0.1:{api_port}\n",
            "secret: {secret}\n",
            "allow-lan: false\n",
            "bind-address: 127.0.0.1\n",
            "mode: rule\n",
            "log-level: {log_level}\n",
            "ipv6: {ipv6}\n",
            "unified-delay: {unified_delay}\n",
            "tcp-concurrent: {tcp_concurrent}\n",
            "mixed-port: {proxy_port}\n",
            "listeners: []\n",
            "tun:\n",
            "  enable: false\n",
            "proxy-groups:\n",
            "  - name: FlowProxy Direct\n",
            "    type: select\n",
            "    proxies:\n",
            "      - DIRECT\n",
            "rules:\n",
            "  - MATCH,FlowProxy Direct\n",
        ),
        api_port = api_port,
        secret = secret,
        proxy_port = proxy_port,
        log_level = preferences.log_level.as_wire_value(),
        ipv6 = preferences.ipv6,
        unified_delay = preferences.unified_delay,
        tcp_concurrent = preferences.tcp_concurrent,
    ))
}

struct TemporaryFileGuard {
    path: PathBuf,
    committed: bool,
}

impl TemporaryFileGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }

    fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for TemporaryFileGuard {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}
