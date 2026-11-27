//! Daily transfer counters that outlive a core restart.
//!
//! Mihomo's `/connections` totals reset whenever the core restarts, so the
//! Overview page cannot answer "how much did I use today" on its own. This
//! module keeps a small per-day ledger next to the settings: the health loop
//! adds the delta between two samples, and the UI reads the accumulated value.
//!
//! The file is JSON, bounded to `MAX_DAYS`, and written through a temporary
//! file and rename so a crash mid-write cannot corrupt it. It stores counters
//! only — no hosts, no rules.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const LEDGER_FILE_NAME: &str = "traffic.json";
const LEDGER_VERSION: u32 = 1;
/// Days kept in the ledger. A year of daily rows is still tiny.
const MAX_DAYS: usize = 400;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// Transfer totals for one calendar day, in bytes.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct DayTotals {
    pub upload_bytes: u64,
    pub download_bytes: u64,
}

/// What the Overview page shows: today's row plus a short rolling window.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, serde::Serialize)]
pub struct TrafficSummary {
    pub today: DayTotals,
    pub week: DayTotals,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
struct Ledger {
    version: u32,
    /// Keyed by `YYYY-MM-DD` in local time, so "today" matches what the
    /// operator sees on their clock rather than UTC.
    days: std::collections::BTreeMap<String, DayTotals>,
}

impl Default for Ledger {
    fn default() -> Self {
        Self {
            version: LEDGER_VERSION,
            days: std::collections::BTreeMap::new(),
        }
    }
}

pub struct TrafficLedger {
    path: PathBuf,
}

impl TrafficLedger {
    pub fn new(directory: impl AsRef<Path>) -> Self {
        Self {
            path: directory.as_ref().join(LEDGER_FILE_NAME),
        }
    }

    /// Adds a delta to today's row and returns the new totals.
    ///
    /// A write failure is returned so the caller can log it, but the caller
    /// must not treat it as fatal: the in-memory sample is still valid.
    pub fn record(&self, today: &str, upload: u64, download: u64) -> std::io::Result<DayTotals> {
        let mut ledger = self.load();
        let totals = ledger.days.entry(today.to_owned()).or_default();
        totals.upload_bytes = totals.upload_bytes.saturating_add(upload);
        totals.download_bytes = totals.download_bytes.saturating_add(download);
        let totals = *totals;

        // Keep only the most recent days; the map is ordered by date string,
        // which sorts chronologically for the fixed-width format.
        while ledger.days.len() > MAX_DAYS {
            let Some(oldest) = ledger.days.keys().next().cloned() else {
                break;
            };
            ledger.days.remove(&oldest);
        }

        self.save(&ledger)?;
        Ok(totals)
    }

    /// Totals for one day, or zeroes when the day has no row.
    pub fn day(&self, date: &str) -> DayTotals {
        self.load().days.get(date).copied().unwrap_or_default()
    }

    /// Today's totals plus the last seven rows, for the Overview page.
    pub fn summary(&self) -> TrafficSummary {
        TrafficSummary {
            today: self.day(&crate::local_date()),
            week: self.recent_totals(7),
        }
    }

    /// Totals for the last `days` rows, including `today`.
    ///
    /// The ledger is ordered by date, so the window is simply its tail.
    pub fn recent_totals(&self, days: usize) -> DayTotals {
        let ledger = self.load();
        let mut totals = DayTotals::default();
        for day in ledger.days.values().rev().take(days.max(1)) {
            totals.upload_bytes = totals.upload_bytes.saturating_add(day.upload_bytes);
            totals.download_bytes = totals.download_bytes.saturating_add(day.download_bytes);
        }
        totals
    }

    fn load(&self) -> Ledger {
        match fs::read_to_string(&self.path) {
            Ok(contents) => match serde_json::from_str::<Ledger>(&contents) {
                Ok(ledger) if ledger.version == LEDGER_VERSION => ledger,
                // A future or corrupt file starts fresh rather than blocking
                // the counter forever.
                _ => Ledger::default(),
            },
            Err(_) => Ledger::default(),
        }
    }

    fn save(&self, ledger: &Ledger) -> std::io::Result<()> {
        let parent = self.path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let temporary = parent.join(format!(
            ".{LEDGER_FILE_NAME}.{}.{}.tmp",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let encoded = serde_json::to_vec_pretty(ledger).map_err(std::io::Error::other)?;
        let result = fs::File::create(&temporary)
            .and_then(|mut file| {
                file.write_all(&encoded)?;
                file.sync_all()
            })
            .and_then(|()| fs::rename(&temporary, &self.path));
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::TrafficLedger;

    fn ledger() -> (tempfile::TempDir, TrafficLedger) {
        let directory = tempfile::tempdir().expect("temporary directory");
        let ledger = TrafficLedger::new(directory.path());
        (directory, ledger)
    }

    #[test]
    fn deltas_accumulate_on_the_same_day() {
        let (_directory, ledger) = ledger();

        ledger.record("2026-11-27", 100, 200).expect("record");
        let totals = ledger.record("2026-11-27", 50, 25).expect("record");

        assert_eq!(totals.upload_bytes, 150);
        assert_eq!(totals.download_bytes, 225);
        assert_eq!(ledger.day("2026-11-27").upload_bytes, 150);
    }

    #[test]
    fn recent_totals_sum_the_tail_of_the_ledger() {
        let (_directory, ledger) = ledger();

        ledger.record("2026-11-25", 100, 100).expect("record");
        ledger.record("2026-11-26", 10, 10).expect("record");
        ledger.record("2026-11-27", 1, 1).expect("record");

        let week = ledger.recent_totals(7);
        let day = ledger.recent_totals(1);

        assert_eq!(week.upload_bytes, 111);
        assert_eq!(day.upload_bytes, 1);
    }

    #[test]
    fn days_are_kept_separately() {
        let (_directory, ledger) = ledger();

        ledger.record("2026-11-26", 10, 20).expect("record");
        ledger.record("2026-11-27", 1, 2).expect("record");

        assert_eq!(ledger.day("2026-11-26").upload_bytes, 10);
        assert_eq!(ledger.day("2026-11-27").upload_bytes, 1);
        assert_eq!(ledger.day("2026-11-25").upload_bytes, 0);
    }

    #[test]
    fn a_corrupt_ledger_starts_fresh_instead_of_failing() {
        let (directory, ledger) = ledger();
        std::fs::write(directory.path().join("traffic.json"), "{not-json")
            .expect("write corrupt ledger");

        let totals = ledger.record("2026-11-27", 5, 6).expect("record");

        assert_eq!(totals.upload_bytes, 5);
        assert_eq!(totals.download_bytes, 6);
    }

    #[test]
    fn saturating_add_never_wraps() {
        let (_directory, ledger) = ledger();

        ledger.record("2026-11-27", u64::MAX, 0).expect("record");
        let totals = ledger.record("2026-11-27", 1, 0).expect("record");

        assert_eq!(totals.upload_bytes, u64::MAX);
    }
}
