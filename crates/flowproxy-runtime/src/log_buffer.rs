use flowproxy_contracts::{RuntimeErrorCode, RuntimeLogEntry, RuntimeLogLevel};
use std::collections::VecDeque;

use crate::redaction::redact_sensitive_text;

pub(crate) struct LogBuffer {
    capacity: usize,
    entries: VecDeque<RuntimeLogEntry>,
    next_sequence: u64,
}

impl LogBuffer {
    pub(crate) fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "log buffer capacity must be positive");
        Self {
            capacity,
            entries: VecDeque::with_capacity(capacity),
            next_sequence: 1,
        }
    }

    pub(crate) fn push(
        &mut self,
        level: RuntimeLogLevel,
        message: impl Into<String>,
        error_code: Option<RuntimeErrorCode>,
        timestamp_ms: i64,
    ) -> RuntimeLogEntry {
        let entry = RuntimeLogEntry {
            sequence: self.next_sequence,
            timestamp_ms,
            level,
            message: redact_sensitive_text(&message.into()),
            error_code,
        };
        self.next_sequence = self.next_sequence.saturating_add(1);

        if self.entries.len() == self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(entry.clone());
        entry
    }

    pub(crate) fn entries(&self) -> Vec<RuntimeLogEntry> {
        self.entries.iter().cloned().collect()
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::LogBuffer;
    use flowproxy_contracts::{RuntimeErrorCode, RuntimeLogLevel};

    #[test]
    fn log_buffer_drops_oldest_entries_and_keeps_sequences_monotonic() {
        let mut buffer = LogBuffer::new(3);

        for index in 0..5 {
            buffer.push(
                RuntimeLogLevel::Info,
                format!("entry {index}"),
                None,
                1_760_000_000_000 + index,
            );
        }

        let entries = buffer.entries();
        assert_eq!(entries.len(), 3);
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.sequence)
                .collect::<Vec<_>>(),
            vec![3, 4, 5]
        );
        assert_eq!(entries[0].message, "entry 2");
    }

    #[test]
    fn log_buffer_redacts_before_storage() {
        let mut buffer = LogBuffer::new(10);

        let entry = buffer.push(
            RuntimeLogLevel::Warn,
            "token=super-secret password: hunter2",
            Some(RuntimeErrorCode::AdapterFailure),
            1_760_000_000_000,
        );

        assert!(!entry.message.contains("super-secret"));
        assert!(!entry.message.contains("hunter2"));
        assert!(!buffer.entries()[0].message.contains("super-secret"));
    }

    #[test]
    fn log_buffer_requires_a_positive_capacity() {
        assert!(std::panic::catch_unwind(|| LogBuffer::new(0)).is_err());
    }
}
