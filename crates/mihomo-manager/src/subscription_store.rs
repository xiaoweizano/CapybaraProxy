//! On-disk library of imported subscriptions.
//!
//! An operator can keep several subscriptions and choose which one the core
//! launches with. Each subscription is a pair of plain files under
//! `subscriptions/`: `<id>.yaml` holds the operator's original document, and
//! `<id>.json` holds the metadata FlowProxy derives from it. A small index file
//! records which id is active.
//!
//! Nothing here validates YAML; the adapter runs `mihomo -t` before a document
//! is stored (or replaces an existing one).

use crate::binary::{map_io_error, random_hex};
use flowproxy_contracts::{RuntimeError, RuntimeErrorCode, SubscriptionUsage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const INDEX_VERSION: u32 = 1;
const INDEX_FILE_NAME: &str = "subscriptions.json";
const SUBSCRIPTIONS_DIRECTORY: &str = "subscriptions";
const MAX_NAME_CHARS: usize = 120;
const MAX_ID_CHARS: usize = 64;
const MAX_OVERRIDE_RULES: usize = 500;
const MAX_RULE_CHARS: usize = 512;
const MAX_OVERRIDE_YAML_BYTES: usize = 1024 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct Index {
    version: u32,
    active_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct Metadata {
    name: String,
    updated_at_ms: i64,
    #[serde(default)]
    proxy_count: Option<u32>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    usage: Option<SubscriptionUsage>,
    /// Rules added on top of the subscription's own rule list.
    #[serde(default)]
    override_rules: Vec<String>,
    /// Top-level YAML blocks that replace the subscription's own.
    #[serde(default)]
    override_yaml: Option<String>,
}

/// Values captured when a subscription document is created or replaced.
///
/// Grouped so [`SubscriptionStore::create`] and [`SubscriptionStore::update`]
/// stay readable: every field comes from the same import or refresh, and adding
/// one should not lengthen every call site.
#[derive(Clone, Debug, Default)]
pub struct SubscriptionInput<'a> {
    pub name: &'a str,
    pub document: &'a str,
    pub source_url: Option<String>,
    pub usage: Option<SubscriptionUsage>,
    pub proxy_count: Option<u32>,
    pub updated_at_ms: i64,
}

/// One stored subscription with its document and metadata.
#[derive(Clone, Debug)]
pub struct StoredSubscription {
    pub id: String,
    pub name: String,
    pub document: String,
    pub updated_at_ms: i64,
    pub proxy_count: Option<u32>,
    pub source_url: Option<String>,
    pub usage: Option<SubscriptionUsage>,
    pub override_rules: Vec<String>,
    pub override_yaml: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SubscriptionStore {
    root: PathBuf,
}

impl SubscriptionStore {
    /// `root` is the Mihomo working directory, next to the active config.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn directory(&self) -> PathBuf {
        self.root.join(SUBSCRIPTIONS_DIRECTORY)
    }

    fn index_path(&self) -> PathBuf {
        self.root.join(INDEX_FILE_NAME)
    }

    fn document_path(&self, id: &str) -> PathBuf {
        self.directory().join(format!("{id}.yaml"))
    }

    fn metadata_path(&self, id: &str) -> PathBuf {
        self.directory().join(format!("{id}.json"))
    }

    /// Stores a new subscription and makes it active. Returns its id.
    pub fn create(&self, input: SubscriptionInput<'_>) -> Result<String, RuntimeError> {
        let id = self.fresh_id()?;
        self.write_document(&id, input.document)?;
        self.write_metadata(
            &id,
            &Metadata {
                name: sanitize_name(input.name),
                updated_at_ms: input.updated_at_ms,
                proxy_count: input.proxy_count,
                source_url: input.source_url,
                usage: input.usage,
                override_rules: Vec::new(),
                override_yaml: None,
            },
        )?;
        let mut index = self.read_index()?;
        index.active_id = Some(id.clone());
        self.write_index(&index)?;
        Ok(id)
    }

    /// Replaces an existing subscription's document and metadata, keeping its
    /// id, override rules and override YAML.
    pub fn update(&self, id: &str, input: SubscriptionInput<'_>) -> Result<(), RuntimeError> {
        let previous = self.read_metadata(id)?;
        self.write_document(id, input.document)?;
        self.write_metadata(
            id,
            &Metadata {
                name: sanitize_name(input.name),
                updated_at_ms: input.updated_at_ms,
                proxy_count: input.proxy_count,
                source_url: input.source_url,
                usage: input.usage,
                override_rules: previous.override_rules,
                override_yaml: previous.override_yaml,
            },
        )
    }

    pub fn remove(&self, id: &str) -> Result<(), RuntimeError> {
        validate_id(id)?;
        remove_file_if_present(&self.document_path(id))?;
        remove_file_if_present(&self.metadata_path(id))?;

        let mut index = self.read_index()?;
        if index.active_id.as_deref() == Some(id) {
            // Promote the surviving subscription with the lowest name so the
            // core always has something to launch with.
            index.active_id = self.list_ids()?.into_iter().next();
        }
        self.write_index(&index)
    }

    pub fn set_active(&self, id: &str) -> Result<(), RuntimeError> {
        validate_id(id)?;
        if !self.document_path(id).exists() {
            return Err(invalid("The subscription no longer exists."));
        }
        let mut index = self.read_index()?;
        index.active_id = Some(id.to_owned());
        self.write_index(&index)
    }

    pub fn active_id(&self) -> Option<String> {
        let index = self.read_index().ok()?;
        let id = index.active_id?;
        self.document_path(&id).exists().then_some(id)
    }

    pub fn set_rules(&self, id: &str, rules: &[String]) -> Result<(), RuntimeError> {
        let rules = sanitize_rules(rules)?;
        let mut metadata = self.read_metadata(id)?;
        metadata.override_rules = rules;
        self.write_metadata(id, &metadata)
    }

    pub fn set_override_yaml(&self, id: &str, yaml: Option<&str>) -> Result<(), RuntimeError> {
        let yaml = match yaml.map(str::trim) {
            None | Some("") => None,
            Some(value) => {
                if value.len() > MAX_OVERRIDE_YAML_BYTES {
                    return Err(invalid("The override document is too large."));
                }
                Some(value.to_owned())
            }
        };
        let mut metadata = self.read_metadata(id)?;
        metadata.override_yaml = yaml;
        self.write_metadata(id, &metadata)
    }

    /// Reads one subscription, or `Ok(None)` when it does not exist.
    pub fn read(&self, id: &str) -> Result<Option<StoredSubscription>, RuntimeError> {
        validate_id(id)?;
        if !self.document_path(id).exists() {
            return Ok(None);
        }
        let document = fs::read_to_string(self.document_path(id))
            .map_err(|error| map_io_error("Could not read the stored subscription", error))?;
        let metadata = self.read_metadata(id).unwrap_or_default();
        Ok(Some(StoredSubscription {
            id: id.to_owned(),
            name: if metadata.name.trim().is_empty() {
                "Imported subscription".to_owned()
            } else {
                metadata.name
            },
            document,
            updated_at_ms: metadata.updated_at_ms,
            proxy_count: metadata.proxy_count,
            source_url: metadata.source_url,
            usage: metadata.usage,
            override_rules: metadata.override_rules,
            override_yaml: metadata.override_yaml,
        }))
    }

    pub fn active(&self) -> Result<Option<StoredSubscription>, RuntimeError> {
        match self.active_id() {
            Some(id) => self.read(&id),
            None => Ok(None),
        }
    }

    /// Every stored subscription, active first, then by name.
    pub fn list(&self) -> Result<Vec<StoredSubscription>, RuntimeError> {
        let active = self.active_id();
        let mut subscriptions = Vec::new();
        for id in self.list_ids()? {
            if let Some(subscription) = self.read(&id)? {
                subscriptions.push(subscription);
            }
        }
        subscriptions.sort_by(|left, right| {
            let left_active = active.as_deref() == Some(left.id.as_str());
            let right_active = active.as_deref() == Some(right.id.as_str());
            right_active
                .cmp(&left_active)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(subscriptions)
    }

    /// Ids present on disk, independent of the index.
    fn list_ids(&self) -> Result<Vec<String>, RuntimeError> {
        let directory = self.directory();
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(map_io_error(
                    "Could not read the subscription directory",
                    error,
                ))
            }
        };

        let mut ids = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| {
                map_io_error("Could not read the subscription directory", error)
            })?;
            let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if let Some(id) = file_name.strip_suffix(".yaml") {
                if validate_id(id).is_ok() {
                    ids.push(id.to_owned());
                }
            }
        }
        ids.sort();
        Ok(ids)
    }

    /// Adopts a document from the pre-library layout.
    ///
    /// Returns `true` when a legacy document was found and stored, so the
    /// caller can delete the old files.
    pub fn adopt_legacy(&self, input: SubscriptionInput<'_>) -> Result<bool, RuntimeError> {
        if !self.list_ids()?.is_empty() {
            // A library already exists; never resurrect a stale legacy file.
            return Ok(false);
        }
        self.create(input)?;
        Ok(true)
    }

    fn fresh_id(&self) -> Result<String, RuntimeError> {
        for _ in 0..8 {
            let id = format!("sub-{}", random_hex(6)?);
            if !self.document_path(&id).exists() && !self.metadata_path(&id).exists() {
                return Ok(id);
            }
        }
        Err(RuntimeError::new(
            RuntimeErrorCode::Internal,
            "FlowProxy could not allocate a subscription identifier.",
            true,
        ))
    }

    fn read_index(&self) -> Result<Index, RuntimeError> {
        match fs::read_to_string(self.index_path()) {
            Ok(contents) => match serde_json::from_str::<Index>(&contents) {
                Ok(index) if index.version == INDEX_VERSION => Ok(index),
                _ => Ok(self.rebuilt_index()),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(self.rebuilt_index()),
            Err(error) => Err(map_io_error("Could not read the subscription index", error)),
        }
    }

    /// Reconstructs the index from the files on disk, used when the index is
    /// missing or unreadable. Picks the first id as active so the library is
    /// never left without one.
    fn rebuilt_index(&self) -> Index {
        Index {
            version: INDEX_VERSION,
            active_id: self.list_ids().ok().and_then(|ids| ids.into_iter().next()),
        }
    }

    fn write_index(&self, index: &Index) -> Result<(), RuntimeError> {
        self.write_json(&self.index_path(), index, "subscription index")
    }

    fn read_metadata(&self, id: &str) -> Result<Metadata, RuntimeError> {
        validate_id(id)?;
        let contents = match fs::read_to_string(self.metadata_path(id)) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Metadata::default())
            }
            Err(error) => {
                return Err(map_io_error(
                    "Could not read the subscription metadata",
                    error,
                ))
            }
        };
        Ok(serde_json::from_str(&contents).unwrap_or_default())
    }

    fn write_metadata(&self, id: &str, metadata: &Metadata) -> Result<(), RuntimeError> {
        validate_id(id)?;
        self.write_json(&self.metadata_path(id), metadata, "subscription metadata")
    }

    fn write_document(&self, id: &str, document: &str) -> Result<(), RuntimeError> {
        validate_id(id)?;
        fs::create_dir_all(self.directory())
            .map_err(|error| map_io_error("Could not create the subscription directory", error))?;
        write_atomically(&self.document_path(id), document.as_bytes())
    }

    fn write_json<T: Serialize>(
        &self,
        path: &Path,
        value: &T,
        label: &str,
    ) -> Result<(), RuntimeError> {
        let encoded = serde_json::to_vec_pretty(value).map_err(|error| {
            RuntimeError::new(
                RuntimeErrorCode::Internal,
                format!("The {label} could not be encoded: {error}"),
                false,
            )
        })?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                map_io_error("Could not create the subscription directory", error)
            })?;
        }
        write_atomically(path, &encoded)
    }
}

/// Writes `contents` to `path` through a temporary file and rename.
fn write_atomically(path: &Path, contents: &[u8]) -> Result<(), RuntimeError> {
    let parent = path.parent().ok_or_else(|| {
        RuntimeError::new(
            RuntimeErrorCode::ConfigInvalid,
            "The subscription path has no parent directory.",
            false,
        )
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| map_io_error("Could not create the subscription directory", error))?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("subscription"),
        std::process::id(),
        sequence
    ));
    let result = fs::File::create(&temporary)
        .and_then(|mut file| {
            file.write_all(contents)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&temporary, path));
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(map_io_error(
            "Could not write the stored subscription",
            error,
        ));
    }
    Ok(())
}

fn remove_file_if_present(path: &Path) -> Result<(), RuntimeError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(map_io_error(
            "Could not remove the stored subscription",
            error,
        )),
    }
}

/// Subscription ids only ever come from [`SubscriptionStore::fresh_id`] or the
/// index, but the command surface accepts them from the webview as well.
pub fn validate_id(id: &str) -> Result<(), RuntimeError> {
    let valid = !id.is_empty()
        && id.len() <= MAX_ID_CHARS
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if valid {
        Ok(())
    } else {
        Err(invalid("The subscription identifier is invalid."))
    }
}

/// Trims, de-duplicates and bounds the operator's custom rule list.
pub fn sanitize_rules(rules: &[String]) -> Result<Vec<String>, RuntimeError> {
    let mut sanitized = Vec::new();
    for rule in rules {
        let trimmed = rule.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.len() > MAX_RULE_CHARS
            || trimmed.chars().any(char::is_control)
            || !trimmed.contains(',')
            || sanitized
                .iter()
                .any(|existing: &String| existing == trimmed)
        {
            if trimmed.len() > MAX_RULE_CHARS || trimmed.chars().any(char::is_control) {
                return Err(invalid(
                    "An override rule is too long or contains invalid characters.",
                ));
            }
            continue;
        }
        sanitized.push(trimmed.to_owned());
        if sanitized.len() >= MAX_OVERRIDE_RULES {
            return Err(invalid("Too many override rules."));
        }
    }
    Ok(sanitized)
}

fn sanitize_name(name: &str) -> String {
    let trimmed: String = name
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    if trimmed.is_empty() {
        "Imported subscription".to_owned()
    } else {
        trimmed
    }
}

fn invalid(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::SubscriptionInvalid, message, false)
}

#[cfg(test)]
mod tests {
    use super::{sanitize_rules, SubscriptionInput, SubscriptionStore};
    use flowproxy_contracts::SubscriptionUsage;

    fn store() -> (tempfile::TempDir, SubscriptionStore) {
        let directory = tempfile::tempdir().expect("temporary directory");
        let store = SubscriptionStore::new(directory.path());
        (directory, store)
    }

    /// Convenience constructor so each test only spells out what it cares about.
    fn input<'a>(name: &'a str, document: &'a str, updated_at_ms: i64) -> SubscriptionInput<'a> {
        SubscriptionInput {
            name,
            document,
            updated_at_ms,
            ..SubscriptionInput::default()
        }
    }

    #[test]
    fn create_stores_the_document_and_makes_it_active() {
        let (_directory, store) = store();

        let id = store
            .create(SubscriptionInput {
                proxy_count: Some(1),
                ..input("Primary", "proxies:\n  - name: A\n", 10)
            })
            .expect("create subscription");

        let active = store.active().expect("read active").expect("active exists");
        assert_eq!(active.id, id);
        assert_eq!(active.name, "Primary");
        assert_eq!(active.document, "proxies:\n  - name: A\n");
        assert_eq!(store.active_id().as_deref(), Some(id.as_str()));
        assert_eq!(store.list().expect("list").len(), 1);
    }

    #[test]
    fn removing_the_active_subscription_promotes_the_next_one() {
        let (_directory, store) = store();
        let first = store
            .create(input("Beta", "proxies:\n  - name: A\n", 1))
            .expect("create first");
        let second = store
            .create(input("Alpha", "proxies:\n  - name: B\n", 2))
            .expect("create second");
        assert_eq!(store.active_id().as_deref(), Some(second.as_str()));

        store.remove(&second).expect("remove active");

        assert_eq!(store.active_id().as_deref(), Some(first.as_str()));
        let ids: Vec<String> = store
            .list()
            .expect("list")
            .into_iter()
            .map(|subscription| subscription.id)
            .collect();
        assert_eq!(ids, vec![first]);
    }

    #[test]
    fn activating_a_subscription_keeps_its_document_and_rules() {
        let (_directory, store) = store();
        let first = store
            .create(input("First", "proxies:\n  - name: A\n", 1))
            .expect("create first");
        store
            .set_rules(&first, &["DOMAIN-SUFFIX,example.com,DIRECT".to_owned()])
            .expect("set rules");
        let second = store
            .create(input("Second", "proxies:\n  - name: B\n", 2))
            .expect("create second");

        store.set_active(&first).expect("activate first");

        let active = store.active().expect("read active").expect("active exists");
        assert_eq!(active.id, first);
        assert_eq!(active.override_rules, ["DOMAIN-SUFFIX,example.com,DIRECT"]);
        assert_ne!(active.id, second);
    }

    #[test]
    fn updating_a_subscription_keeps_its_overrides() {
        let (_directory, store) = store();
        let id = store
            .create(input("Primary", "proxies:\n  - name: A\n", 1))
            .expect("create");
        store
            .set_rules(&id, &["IP-CIDR,10.0.0.0/8,DIRECT".to_owned()])
            .expect("set rules");
        store
            .set_override_yaml(&id, Some("dns:\n  enable: true\n"))
            .expect("set override");

        store
            .update(
                &id,
                SubscriptionInput {
                    source_url: Some("https://provider.example/sub".to_owned()),
                    usage: Some(SubscriptionUsage {
                        download_bytes: Some(1),
                        ..SubscriptionUsage::default()
                    }),
                    proxy_count: Some(2),
                    updated_at_ms: 5,
                    ..input("Renamed", "proxies:\n  - name: B\n", 5)
                },
            )
            .expect("update");

        let subscription = store.read(&id).expect("read").expect("exists");
        assert_eq!(subscription.name, "Renamed");
        assert!(subscription.document.contains("name: B"));
        assert_eq!(
            subscription.source_url.as_deref(),
            Some("https://provider.example/sub")
        );
        assert_eq!(subscription.override_rules, ["IP-CIDR,10.0.0.0/8,DIRECT"]);
        // Stored trimmed: surrounding whitespace carries no meaning here.
        assert_eq!(
            subscription.override_yaml.as_deref(),
            Some("dns:\n  enable: true")
        );
    }

    #[test]
    fn missing_index_is_rebuilt_from_the_documents_on_disk() {
        let (directory, store) = store();
        let id = store
            .create(input("Primary", "proxies:\n  - name: A\n", 1))
            .expect("create");
        std::fs::remove_file(directory.path().join("subscriptions.json")).expect("drop index");

        assert_eq!(store.active_id().as_deref(), Some(id.as_str()));
        assert_eq!(store.list().expect("list").len(), 1);
    }

    #[test]
    fn corrupt_index_falls_back_to_the_documents_on_disk() {
        let (directory, store) = store();
        let id = store
            .create(input("Primary", "proxies:\n  - name: A\n", 1))
            .expect("create");
        std::fs::write(directory.path().join("subscriptions.json"), "{not-json")
            .expect("write corrupt index");

        assert_eq!(store.active_id().as_deref(), Some(id.as_str()));
    }

    #[test]
    fn legacy_documents_are_adopted_only_into_an_empty_library() {
        let (_directory, store) = store();

        assert!(store
            .adopt_legacy(input("Legacy", "proxies:\n  - name: A\n", 3))
            .expect("adopt legacy"));
        assert!(!store
            .adopt_legacy(input(
                "Second legacy",
                "proxies:\n  - name: B\n",
                4
            ))
            .expect("second adoption is a no-op"));
        assert_eq!(store.list().expect("list").len(), 1);
        assert_eq!(store.list().expect("list")[0].name, "Legacy");
    }

    #[test]
    fn rejects_ids_that_could_escape_the_directory() {
        let (_directory, store) = store();
        for id in ["", "../config", "a/b", "a\\b", &"x".repeat(65)] {
            assert!(
                store.read(id).is_err() || store.remove(id).is_err(),
                "{id:?} must be rejected"
            );
        }
    }

    #[test]
    fn rule_sanitizer_drops_duplicates_and_blank_lines_and_bounds_the_list() {
        let rules = sanitize_rules(&[
            "  DOMAIN-SUFFIX,example.com,DIRECT ".to_owned(),
            "DOMAIN-SUFFIX,example.com,DIRECT".to_owned(),
            String::new(),
            "   ".to_owned(),
            "GEOIP,CN,DIRECT".to_owned(),
        ])
        .expect("sanitize");

        assert_eq!(
            rules,
            ["DOMAIN-SUFFIX,example.com,DIRECT", "GEOIP,CN,DIRECT"]
        );
        assert!(sanitize_rules(&["not a rule".to_owned()])
            .expect("sanitize")
            .is_empty());
        assert!(sanitize_rules(&["A\nB".to_owned()]).is_err());
    }
}
