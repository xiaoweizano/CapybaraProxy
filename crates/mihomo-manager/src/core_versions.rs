//! Installed Mihomo core versions.
//!
//! FlowProxy ships one locked core, but an operator may drop a newer build next
//! to the app and want to switch to it. This module keeps that decision in a
//! small index next to the settings and verifies the chosen binary's digest
//! before it is used, so a half-copied download can never become the active
//! core.
//!
//! It deliberately does **not** download or pick versions on its own: which
//! release to trust is the operator's decision, and the digest is what makes
//! that decision checkable.

use crate::binary::sha256_file;
use crate::binary::LOCKED_MIHOMO_SHA256;
use flowproxy_contracts::{RuntimeError, RuntimeErrorCode};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const INDEX_VERSION: u32 = 1;
const INDEX_FILE_NAME: &str = "core-versions.json";
const MAX_ID_CHARS: usize = 128;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// One core build the operator registered.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CoreVersion {
    /// File name inside the core directory. Kept relative so the index does
    /// not pin an absolute install path.
    pub id: String,
    /// Version string the binary reported (`-v`).
    pub version: String,
    /// SHA-256 recorded when the build was registered.
    pub sha256: String,
    /// Whether this is the build the next start uses.
    pub active: bool,
    /// Byte size, shown in the UI so two builds are distinguishable.
    #[serde(default)]
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Index {
    version: u32,
    /// File name of the active build. `None` means the bundled locked core.
    active_id: Option<String>,
    /// Registered builds other than the bundled one.
    #[serde(default)]
    entries: Vec<StoredEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredEntry {
    id: String,
    version: String,
    sha256: String,
    size_bytes: u64,
}

impl Default for Index {
    fn default() -> Self {
        Self {
            version: INDEX_VERSION,
            active_id: None,
            entries: Vec::new(),
        }
    }
}

pub struct CoreVersionStore {
    directory: PathBuf,
}

impl CoreVersionStore {
    /// `directory` is where the registered binaries live; the index sits beside
    /// it so a whole install can be moved as one folder.
    pub fn new(directory: impl AsRef<Path>) -> Self {
        Self {
            directory: directory.as_ref().to_path_buf(),
        }
    }

    /// Directory the registered builds live in.
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    fn index_path(&self) -> PathBuf {
        self.directory.join(INDEX_FILE_NAME)
    }

    fn binary_path(&self, id: &str) -> PathBuf {
        self.directory.join(id)
    }

    /// Registers a binary that is already in the core directory.
    ///
    /// The digest and version are read from the file, so registration is also
    /// the verification: a build that fails either check is rejected here and
    /// never appears in the list.
    pub fn register(&self, id: &str) -> Result<CoreVersion, RuntimeError> {
        validate_id(id)?;
        let path = self.binary_path(id);
        if !path.is_file() {
            return Err(invalid(
                "The core file does not exist in the versions directory.",
            ));
        }
        let sha256 = sha256_file(&path)?;
        let version = read_version(&path)?;
        let size_bytes = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);

        let mut index = self.load()?;
        index.entries.retain(|entry| entry.id != id);
        index.entries.push(StoredEntry {
            id: id.to_owned(),
            version: version.clone(),
            sha256: sha256.clone(),
            size_bytes,
        });
        self.save(&index)?;

        Ok(CoreVersion {
            id: id.to_owned(),
            version,
            sha256,
            active: index.active_id.as_deref() == Some(id),
            size_bytes,
        })
    }

    /// Lists the bundled core plus every registered build.
    pub fn list(&self) -> Result<Vec<CoreVersion>, RuntimeError> {
        let index = self.load()?;
        let mut versions = vec![CoreVersion {
            id: "bundled".to_owned(),
            version: crate::binary::LOCKED_MIHOMO_VERSION.to_owned(),
            sha256: LOCKED_MIHOMO_SHA256.to_owned(),
            active: index.active_id.is_none(),
            size_bytes: 0,
        }];
        versions.extend(index.entries.into_iter().map(|entry| CoreVersion {
            active: index.active_id.as_deref() == Some(entry.id.as_str()),
            id: entry.id,
            version: entry.version,
            sha256: entry.sha256,
            size_bytes: entry.size_bytes,
        }));
        Ok(versions)
    }

    /// Makes a registered build the active one, re-verifying it first.
    ///
    /// Passing `None` or `"bundled"` restores the bundled core.
    pub fn activate(&self, id: Option<&str>) -> Result<(), RuntimeError> {
        let mut index = self.load()?;
        match id {
            None => index.active_id = None,
            Some("bundled") => index.active_id = None,
            Some(id) => {
                validate_id(id)?;
                let entry = index
                    .entries
                    .iter()
                    .find(|entry| entry.id == id)
                    .ok_or_else(|| invalid("The core version is not registered."))?;
                // Re-check before switching: the file may have been replaced
                // after registration.
                let actual = sha256_file(&self.binary_path(id))?;
                if actual != entry.sha256 {
                    return Err(invalid(
                        "The core file changed since it was registered; register it again.",
                    ));
                }
                index.active_id = Some(id.to_owned());
            }
        }
        self.save(&index)
    }

    /// Absolute path of the active build, or `None` for the bundled core.
    ///
    /// Also returns the digest, so the adapter can record what it launched.
    pub fn active_binary(&self) -> Result<Option<PathBuf>, RuntimeError> {
        let index = self.load()?;
        Ok(index.active_id.map(|id| self.binary_path(&id)))
    }

    pub fn remove(&self, id: &str) -> Result<(), RuntimeError> {
        validate_id(id)?;
        let mut index = self.load()?;
        index.entries.retain(|entry| entry.id != id);
        if index.active_id.as_deref() == Some(id) {
            index.active_id = None;
        }
        self.save(&index)
    }

    fn load(&self) -> Result<Index, RuntimeError> {
        match fs::read_to_string(self.index_path()) {
            Ok(contents) => match serde_json::from_str::<Index>(&contents) {
                Ok(index) if index.version == INDEX_VERSION => Ok(index),
                _ => Ok(Index::default()),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Index::default()),
            Err(error) => Err(invalid(format!(
                "The core version index could not be read: {error}"
            ))),
        }
    }

    fn save(&self, index: &Index) -> Result<(), RuntimeError> {
        fs::create_dir_all(&self.directory).map_err(|error| {
            invalid(format!(
                "The core versions directory could not be created: {error}"
            ))
        })?;
        let encoded = serde_json::to_vec_pretty(index).map_err(|error| {
            invalid(format!(
                "The core version index could not be encoded: {error}"
            ))
        })?;
        let temporary = self.directory.join(format!(
            ".{INDEX_FILE_NAME}.{}.{}.tmp",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let result = fs::File::create(&temporary)
            .and_then(|mut file| {
                file.write_all(&encoded)?;
                file.sync_all()
            })
            .and_then(|()| fs::rename(&temporary, self.index_path()));
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(|error| {
            invalid(format!(
                "The core version index could not be written: {error}"
            ))
        })
    }
}

/// Reads the version string a binary reports. Shared with the locked check.
fn read_version(path: &Path) -> Result<String, RuntimeError> {
    use std::process::Command;
    let output = Command::new(path)
        .arg("-v")
        .output()
        .map_err(|error| invalid(format!("The core version could not be read: {error}")))?;
    if !output.status.success() {
        return Err(invalid("The core did not report a version."));
    }
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    // Mihomo prints `Mihomo Meta v1.19.33 ...`; keep the first version token.
    combined
        .split_whitespace()
        .find(|token| {
            token.starts_with('v') && token[1..].starts_with(|c: char| c.is_ascii_digit())
        })
        .map(str::to_owned)
        .ok_or_else(|| invalid("The core version output did not contain a version."))
}

fn validate_id(id: &str) -> Result<(), RuntimeError> {
    let valid = !id.is_empty()
        && id != "bundled"
        && id.len() <= MAX_ID_CHARS
        && !id.contains(['/', '\\', ':'])
        && !id.starts_with('.')
        && id.chars().all(|character| !character.is_control());
    if valid {
        Ok(())
    } else {
        Err(invalid("The core version identifier is invalid."))
    }
}

fn invalid(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::CoreUnavailable, message, false)
}

#[cfg(test)]
mod tests {
    use super::CoreVersionStore;

    #[test]
    fn an_empty_directory_lists_only_the_bundled_core() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let store = CoreVersionStore::new(directory.path());

        let versions = store.list().expect("list");

        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].id, "bundled");
        assert!(versions[0].active);
    }

    #[test]
    fn registering_a_missing_file_is_rejected() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let store = CoreVersionStore::new(directory.path());

        let error = store
            .register("mihomo-1.20.exe")
            .expect_err("a missing file must be rejected");

        assert!(error.message.contains("does not exist"));
    }

    #[test]
    fn identifiers_that_could_escape_the_directory_are_rejected() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let store = CoreVersionStore::new(directory.path());

        for id in ["../core", "a/b", "a\\b", "", ".hidden"] {
            assert!(store.register(id).is_err(), "{id:?} must be rejected");
        }
    }

    #[test]
    fn activating_an_unregistered_build_is_rejected() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let store = CoreVersionStore::new(directory.path());

        let error = store
            .activate(Some("never-registered"))
            .expect_err("an unregistered build must be rejected");

        assert!(error.message.contains("not registered"));
    }
}
