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
    /// Prefix of the state line in the menu.
    pub status: &'static str,
    /// Prefix of the current-node line in the menu.
    pub node: &'static str,
    /// Label shown when no node is selected.
    pub no_node: &'static str,
    /// Label of the "open log folder" entry.
    pub open_logs: &'static str,
    pub mode_rule: &'static str,
    pub mode_global: &'static str,
    pub mode_direct: &'static str,
}

/// Returns the localized tray strings for `language`.
pub(crate) fn tray_strings(language: Language) -> TrayStrings {
    match language {
        Language::English => TrayStrings {
            show: "Show FlowProxy",
            exit: "Exit",
            tooltip: "FlowProxy",
            status: "Status",
            node: "Node",
            no_node: "No node selected",
            open_logs: "Open log folder",
            mode_rule: "Mode: Rule",
            mode_global: "Mode: Global",
            mode_direct: "Mode: Direct",
        },
        Language::SimplifiedChinese => TrayStrings {
            show: "显示 FlowProxy",
            exit: "退出",
            tooltip: "FlowProxy",
            status: "状态",
            node: "节点",
            no_node: "未选择节点",
            open_logs: "打开日志目录",
            mode_rule: "模式：规则",
            mode_global: "模式：全局",
            mode_direct: "模式：直连",
        },
    }
}

/// Localized name of a Runtime state, mirroring `runtime.state.*` in the UI.
pub(crate) fn state_label(language: Language, state: RuntimeState) -> &'static str {
    match (language, state) {
        (Language::English, RuntimeState::Stopped) => "Stopped",
        (Language::English, RuntimeState::Starting) => "Starting",
        (Language::English, RuntimeState::RunningDisconnected) => "Running (not connected)",
        (Language::English, RuntimeState::Connected) => "Connected",
        (Language::English, RuntimeState::Stopping) => "Stopping",
        (Language::English, RuntimeState::Error) => "Error",
        (Language::English, RuntimeState::PermissionRequired) => "Permission required",

        (Language::SimplifiedChinese, RuntimeState::Stopped) => "已停止",
        (Language::SimplifiedChinese, RuntimeState::Starting) => "启动中",
        (Language::SimplifiedChinese, RuntimeState::RunningDisconnected) => "运行中（未连接）",
        (Language::SimplifiedChinese, RuntimeState::Connected) => "已连接",
        (Language::SimplifiedChinese, RuntimeState::Stopping) => "停止中",
        (Language::SimplifiedChinese, RuntimeState::Error) => "错误",
        (Language::SimplifiedChinese, RuntimeState::PermissionRequired) => "需要授权",
    }
}

/// Label and enabled state for the connect/disconnect entry.
pub(crate) fn connection_label(language: Language, state: RuntimeState) -> (&'static str, bool) {
    match (language, state) {
        (Language::English, RuntimeState::Stopped | RuntimeState::Error) => ("Connect", true),
        (Language::English, RuntimeState::RunningDisconnected | RuntimeState::Connected) => {
            ("Disconnect", true)
        }
        (Language::English, RuntimeState::Starting) => ("Connecting...", false),
        (Language::English, RuntimeState::Stopping) => ("Disconnecting...", false),
        (Language::English, RuntimeState::PermissionRequired) => ("Connect unavailable", false),

        (Language::SimplifiedChinese, RuntimeState::Stopped | RuntimeState::Error) => {
            ("连接", true)
        }
        (
            Language::SimplifiedChinese,
            RuntimeState::RunningDisconnected | RuntimeState::Connected,
        ) => ("断开", true),
        (Language::SimplifiedChinese, RuntimeState::Starting) => ("连接中…", false),
        (Language::SimplifiedChinese, RuntimeState::Stopping) => ("断开中…", false),
        (Language::SimplifiedChinese, RuntimeState::PermissionRequired) => ("无法连接", false),
    }
}

/// Tooltip text: state, current node and, when available, the live rates.
///
/// Windows truncates a tray tooltip at 128 UTF-16 units; the node name is the
/// only unbounded part, so it is cut to keep the rates visible.
pub(crate) fn tooltip(
    language: Language,
    state: RuntimeState,
    node: Option<&str>,
    speed: Option<&str>,
) -> String {
    let mut text = format!("FlowProxy · {}", state_label(language, state));
    if let Some(node) = node {
        let node = truncate_chars(node, 48);
        text.push('\n');
        text.push_str(&node);
    }
    if let Some(speed) = speed {
        text.push('\n');
        text.push_str(speed);
    }
    text
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }
    let mut truncated = value.chars().take(limit - 1).collect::<String>();
    truncated.push('…');
    truncated
}

#[cfg(test)]
mod tests {
    use super::{connection_label, state_label, tooltip, tray_strings};
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

            assert_ne!(
                state_label(Language::English, state),
                state_label(Language::SimplifiedChinese, state),
                "state label {state:?} is not translated"
            );
        }
    }

    #[test]
    fn tray_menu_items_are_translated() {
        let english = tray_strings(Language::English);
        let chinese = tray_strings(Language::SimplifiedChinese);

        assert_ne!(english.show, chinese.show);
        assert_ne!(english.exit, chinese.exit);
        assert_ne!(english.status, chinese.status);
        assert_ne!(english.no_node, chinese.no_node);
    }

    #[test]
    fn connect_is_enabled_only_when_usable() {
        assert!(connection_label(Language::English, RuntimeState::Stopped).1);
        assert!(!connection_label(Language::English, RuntimeState::Starting).1);
        assert!(!connection_label(Language::English, RuntimeState::PermissionRequired).1);
    }

    #[test]
    fn tooltip_includes_node_and_speed_when_available() {
        let idle = tooltip(Language::English, RuntimeState::Stopped, None, None);
        assert_eq!(idle, "FlowProxy · Stopped");

        let live = tooltip(
            Language::SimplifiedChinese,
            RuntimeState::Connected,
            Some("东京 01"),
            Some("↑1M ↓2M"),
        );
        assert!(live.contains("已连接"));
        assert!(live.contains("东京 01"));
        assert!(live.contains("↑1M ↓2M"));
    }

    #[test]
    fn tooltip_truncates_an_overlong_node_name() {
        let node = "n".repeat(200);
        let text = tooltip(
            Language::English,
            RuntimeState::Connected,
            Some(&node),
            Some("↑0 ↓0"),
        );
        assert!(text.chars().count() < 80);
        assert!(text.contains('…'));
    }
}
