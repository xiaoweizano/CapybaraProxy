//! Tray menu content.
//!
//! Windows offers no way to render text next to the tray icon, so everything
//! the tray can show lives in three places: the menu (state, current node),
//! the tooltip (state, node, rates) and the icon itself (rates, see
//! [`crate::speed_icon`]).
//!
//! The summary is read by the Runtime health loop, so it must never block on a
//! core that is stopping: every read is best-effort and falls back to "no
//! value" instead of propagating an error.

use flowproxy_contracts::RuntimeState;

use crate::speed_icon::format_speed;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TraySummary {
    pub state: RuntimeState,
    /// Node selected in the first group that has one, if any.
    pub node: Option<String>,
    /// Live rates; `None` while the core is stopped.
    pub upload_bps: Option<u64>,
    pub download_bps: Option<u64>,
}

impl TraySummary {
    /// True while the core is up, which is also when rates are meaningful.
    pub(crate) fn is_running(&self) -> bool {
        matches!(
            self.state,
            RuntimeState::Connected | RuntimeState::RunningDisconnected
        )
    }

    /// True when this summary would change the state or node line of the menu.
    ///
    /// Rates change every second; rebuilding the menu for them would allocate
    /// on every tick for no visible benefit.
    pub(crate) fn needs_menu_refresh(&self, other: &Self) -> bool {
        self.state != other.state || self.node != other.node
    }

    /// Compact "↑1.2M ↓340K" pair, or `None` when the core is stopped.
    pub(crate) fn speed_label(&self) -> Option<String> {
        match (self.upload_bps, self.download_bps) {
            (Some(upload), Some(download)) => Some(format!(
                "↑{} ↓{}",
                format_speed(upload),
                format_speed(download)
            )),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TraySummary;
    use flowproxy_contracts::RuntimeState;

    fn summary(state: RuntimeState, node: Option<&str>) -> TraySummary {
        TraySummary {
            state,
            node: node.map(str::to_owned),
            upload_bps: Some(0),
            download_bps: Some(0),
        }
    }

    #[test]
    fn running_states_are_reported_as_up() {
        assert!(summary(RuntimeState::Connected, None).is_running());
        assert!(summary(RuntimeState::RunningDisconnected, None).is_running());
        assert!(!summary(RuntimeState::Stopped, None).is_running());
        assert!(!summary(RuntimeState::Error, None).is_running());
    }

    #[test]
    fn menu_refresh_only_tracks_state_and_node() {
        let connected = summary(RuntimeState::Connected, Some("Tokyo"));
        let same = TraySummary {
            upload_bps: Some(9_999),
            ..connected.clone()
        };
        assert!(!connected.needs_menu_refresh(&same));

        let other_node = summary(RuntimeState::Connected, Some("Osaka"));
        assert!(connected.needs_menu_refresh(&other_node));
    }

    #[test]
    fn speed_label_is_absent_while_stopped() {
        let stopped = TraySummary {
            state: RuntimeState::Stopped,
            node: None,
            upload_bps: None,
            download_bps: None,
        };
        assert_eq!(stopped.speed_label(), None);

        let running = TraySummary {
            state: RuntimeState::Connected,
            node: None,
            upload_bps: Some(1_048_576),
            download_bps: Some(2_097_152),
        };
        assert_eq!(running.speed_label().as_deref(), Some("↑1M ↓2M"));
    }
}
