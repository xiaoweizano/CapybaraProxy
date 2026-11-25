//! Tray menu strings.
//!
//! The tray is built by the Rust side, so it cannot read the React resource
//! files. This module mirrors the small subset of strings the tray needs and
//! keeps them in sync with the UI language.

use crate::settings::Language;
use flowproxy_contracts::RuntimeState;

pub(crate) struct TrayStrings {
    pub show: &'static str,
    pub exit: &'static str,
    pub tooltip: &'static str,
}

/// Returns the localized tray strings for `language`.
pub(crate) fn tray_strings(language: Language) -> TrayStrings {
    match language {
        Language::English => TrayStrings {
            show: "Show FlowProxy",
            exit: "Exit",
            tooltip: "FlowProxy",
        },
        Language::SimplifiedChinese => TrayStrings {
            show: "显示 FlowProxy",
            exit: "退出",
            tooltip: "FlowProxy",
        },
    }
}

/// Label and enabled state for the connect/disconnect entry.
pub(crate) fn connection_label(
    language: Language,
    state: RuntimeState,
) -> (&'static str, bool) {
    match (language, state) {
        (Language::English, RuntimeState::Stopped | RuntimeState::Error) => ("Connect", true),
        (
            Language::English,
            RuntimeState::RunningDisconnected | RuntimeState::Connected,
        ) => ("Disconnect", true),
        (Language::English, RuntimeState::Starting) => ("Connecting...", false),
        (Language::English, RuntimeState::Stopping) => ("Disconnecting...", false),
        (Language::English, RuntimeState::PermissionRequired) => ("Connect unavailable", false),

        (Language::SimplifiedChinese, RuntimeState::Stopped | RuntimeState::Error) => ("连接", true),
        (
            Language::SimplifiedChinese,
            RuntimeState::RunningDisconnected | RuntimeState::Connected,
        ) => ("断开", true),
        (Language::SimplifiedChinese, RuntimeState::Starting) => ("连接中…", false),
        (Language::SimplifiedChinese, RuntimeState::Stopping) => ("断开中…", false),
        (Language::SimplifiedChinese, RuntimeState::PermissionRequired) => ("无法连接", false),
    }
}

#[cfg(test)]
mod tests {
    use super::{connection_label, tray_strings};
    use crate::settings::Language;
    use flowproxy_contracts::RuntimeState;

    #[test]
    fn english_and_chinese_differ_for_every_visible_label() {
        for state in [
            RuntimeState::Stopped,
            RuntimeState::Starting,
            RuntimeState::RunningDisconnected,
            RuntimeState::Connected,
            RuntimeState::Stopping,
            RuntimeState::Error,
            RuntimeState::PermissionRequired,
        ] {
            let (english, english_enabled) = connection_label(Language::English, state);
            let (chinese, chinese_enabled) = connection_label(Language::SimplifiedChinese, state);

            assert_ne!(english, chinese, "state {state:?} is not translated");
            assert_eq!(
                english_enabled, chinese_enabled,
                "state {state:?} disagrees on enabled"
            );
        }
    }

    #[test]
    fn tray_menu_items_are_translated() {
        let english = tray_strings(Language::English);
        let chinese = tray_strings(Language::SimplifiedChinese);

        assert_ne!(english.show, chinese.show);
        assert_ne!(english.exit, chinese.exit);
    }

    #[test]
    fn connect_is_enabled_only_when_usable() {
        assert!(connection_label(Language::English, RuntimeState::Stopped).1);
        assert!(!connection_label(Language::English, RuntimeState::Starting).1);
        assert!(!connection_label(Language::English, RuntimeState::PermissionRequired).1);
    }
}
