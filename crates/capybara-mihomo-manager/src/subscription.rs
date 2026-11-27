//! Subscription profile handling.
//!
//! Mihomo subscriptions are full configuration documents. CapybaraProxy cannot use
//! them verbatim: the control endpoint, the API secret and the listening ports
//! are owned by the Runtime safety policy, not by the subscription author. This
//! module rewrites the small set of keys CapybaraProxy controls and leaves the rest
//! of the document untouched, byte for byte.
//!
//! A full YAML round-trip (parse then re-serialize) is deliberately avoided: it
//! would reflow comments, anchors and block scalars, and it would need a YAML
//! dependency. Line-level rewriting keeps the operator's file recognisable and
//! makes the injection rules easy to audit.

use crate::subscription_store::sanitize_rules;
use capybara_contracts::{RuntimeError, RuntimeErrorCode, StartupPreferences};
use std::fmt::Write as _;

/// Maximum accepted size of a subscription document.
pub const MAX_SUBSCRIPTION_BYTES: usize = 8 * 1024 * 1024;

/// Top-level keys CapybaraProxy takes ownership of. Any occurrence is removed from
/// the imported document and replaced with the Runtime-controlled value.
const CONTROLLED_TOP_LEVEL_KEYS: &[&str] = &[
    "mixed-port",
    "port",
    "socks-port",
    "redir-port",
    "tproxy-port",
    "external-controller",
    "external-controller-tls",
    "external-controller-unix",
    "external-controller-pipe",
    "external-ui",
    "secret",
    "allow-lan",
    "bind-address",
    "authentication",
    "lan-allowed-ips",
    "lan-disallowed-ips",
];

/// Header CapybaraProxy writes in front of every imported document.
const CAPYBARA_HEADER: &str = "\
# CapybaraProxy managed configuration. The keys below are controlled by the app and
# were removed from the imported subscription; everything else is unchanged.
";

/// Result of validating and normalising an imported subscription.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedSubscription {
    /// Document ready to be validated by `mihomo -t` and installed as the
    /// active `config.yaml`.
    pub profile: String,
    /// Number of top-level `proxies:` entries that look like list items.
    pub proxy_count: usize,
    /// Number of top-level `proxy-groups:` entries that look like list items.
    pub proxy_group_count: usize,
}

/// Rejects documents that cannot plausibly be a Mihomo configuration.
///
/// This is a cheap pre-flight check so that an HTML error page or a truncated
/// download fails with a clear message instead of a `mihomo -t` dump.
pub fn preflight(yaml: &str) -> Result<(), RuntimeError> {
    if yaml.trim().is_empty() {
        return Err(invalid("The subscription document is empty."));
    }
    if yaml.len() > MAX_SUBSCRIPTION_BYTES {
        return Err(invalid(format!(
            "The subscription document is larger than the {} MiB limit.",
            MAX_SUBSCRIPTION_BYTES / (1024 * 1024)
        )));
    }
    let has_proxies = yaml.lines().any(|line| {
        let trimmed = line.trim_end();
        trimmed == "proxies:"
            || trimmed.starts_with("proxies: #")
            || trimmed.starts_with("proxy-providers:")
            || trimmed.starts_with("proxy-providers: ")
    });
    if !has_proxies {
        return Err(invalid(
            "The subscription document has no proxies or proxy-providers section. \
             A Clash/Mihomo YAML profile is required; share links in ss://, vmess://, \
             vless://, trojan://, hysteria2:// or tuic:// form are converted automatically.",
        ));
    }
    Ok(())
}

/// Rewrites a subscription document so that it can be launched by CapybaraProxy.
///
/// `proxy_port` is the loopback port the Runtime has reserved for the mixed
/// proxy listener. The control endpoint, secret and LAN policy are supplied on
/// the command line by the adapter, so only the proxy port and the
/// loopback-only binding are written here.
pub fn prepare_profile(yaml: &str, proxy_port: u16) -> Result<PreparedSubscription, RuntimeError> {
    prepare_profile_with(yaml, proxy_port, StartupPreferences::default())
}

/// Same as [`prepare_profile`], with the operator's startup settings applied.
///
/// `mode`, `log-level` and `ipv6` are not part of the safety policy, so they
/// are only overridden when the operator changed them from the defaults. The
/// subscription's own value survives when it matches the default, which keeps
/// the rewritten document as close to the provider's as possible.
pub fn prepare_profile_with(
    yaml: &str,
    proxy_port: u16,
    preferences: StartupPreferences,
) -> Result<PreparedSubscription, RuntimeError> {
    prepare_profile_full(yaml, proxy_port, preferences, &[], None)
}

/// Same as [`prepare_profile_with`], plus the operator's overrides.
///
/// Custom rules are inserted before the document's final catch-all rule
/// (`MATCH`), so they win over the provider's rules without turning the
/// operator's entries into dead code behind a `MATCH,Proxy` line. When the
/// document has no catch-all they are appended. Override YAML replaces whole
/// top-level blocks by key.
pub fn prepare_profile_full(
    yaml: &str,
    proxy_port: u16,
    preferences: StartupPreferences,
    override_rules: &[String],
    override_yaml: Option<&str>,
) -> Result<PreparedSubscription, RuntimeError> {
    preflight(yaml)?;
    if proxy_port == 0 {
        return Err(invalid("The Mihomo proxy port must be non-zero."));
    }

    let overrides = parse_override_blocks(override_yaml);

    let mut output = String::with_capacity(yaml.len() + 256);
    output.push_str(CAPYBARA_HEADER);
    writeln!(output, "mixed-port: {proxy_port}").expect("writing to a String cannot fail");
    output.push_str("allow-lan: false\n");
    output.push_str("bind-address: 127.0.0.1\n");

    let preferences_overrides: Vec<(&str, String)> = if preferences.is_default() {
        Vec::new()
    } else {
        vec![
            (
                "log-level",
                preferences.log_level.as_wire_value().to_owned(),
            ),
            ("ipv6", preferences.ipv6.to_string()),
            ("unified-delay", preferences.unified_delay.to_string()),
            ("tcp-concurrent", preferences.tcp_concurrent.to_string()),
        ]
    };
    let overridden_keys: Vec<&str> = preferences_overrides.iter().map(|(key, _)| *key).collect();
    for (key, value) in &preferences_overrides {
        writeln!(output, "{key}: {value}").expect("writing to a String cannot fail");
    }

    let mut skipping_continuation = false;
    let mut proxy_count = 0_usize;
    let mut proxy_group_count = 0_usize;
    let mut section: Option<&str> = None;
    // Indentation of the section's own list items, learned from the first one.
    let mut section_item_indent: Option<usize> = None;
    let mut pending_rules_inserted = false;
    let mut current_section_owned = false;
    let mut emitted_overrides: std::collections::BTreeSet<String> =
        std::collections::BTreeSet::new();

    let rules = sanitize_rules(override_rules)?;

    for line in yaml.lines() {
        if skipping_continuation {
            if line.starts_with(' ') || line.starts_with('\t') {
                continue;
            }
            skipping_continuation = false;
        }

        // An override block replaces the document's own, in place, including
        // its indented body. Checked before the controlled/pinned branches so
        // an override never has to know which keys CapybaraProxy owns.
        if let Some(key) = override_block_key(&overrides, line) {
            if !emitted_overrides.contains(key) {
                let replacement = overrides.get(key).expect("key came from the map");
                output.push_str(replacement);
                if !replacement.ends_with('\n') {
                    output.push('\n');
                }
                emitted_overrides.insert((*key).to_owned());
            }
            skipping_continuation = true;
            section = None;
            section_item_indent = None;
            current_section_owned = true;
            continue;
        }

        if let Some((key, rest)) = split_top_level_key(line) {
            if CONTROLLED_TOP_LEVEL_KEYS.contains(&key) || overridden_keys.contains(&key) {
                // Inline values (`key: value`) end here. A bare `key:` may be
                // followed by an indented block, which is skipped in the next
                // iterations.
                if rest.trim().is_empty() || rest.trim_start().starts_with('#') {
                    skipping_continuation = true;
                }
                continue;
            }

            section = Some(key);
            section_item_indent = None;
            current_section_owned = false;
        } else if line.starts_with("---") {
            section = None;
            section_item_indent = None;
            current_section_owned = false;
        }

        // Insert the operator's rules just before the catch-all rule.
        if !current_section_owned
            && !pending_rules_inserted
            && !rules.is_empty()
            && is_catch_all_rule(line)
        {
            for rule in &rules {
                writeln!(output, "  - {rule}").expect("writing to a String cannot fail");
            }
            pending_rules_inserted = true;
        }

        if let Some(indent) = list_item_indent(line) {
            match section {
                Some("proxies") | Some("proxy-groups") => {
                    let expected = *section_item_indent.get_or_insert(indent);
                    // Nested items (for example the `proxies:` list inside a
                    // group) are indented further and must not be counted.
                    if indent != expected {
                        output.push_str(line);
                        output.push('\n');
                        continue;
                    }
                    if section == Some("proxies") {
                        proxy_count += 1;
                    } else {
                        proxy_group_count += 1;
                    }
                }
                _ => {}
            }
        }

        output.push_str(line);
        output.push('\n');
    }

    // No catch-all: the operator's rules still belong in the table, at the end.
    if !pending_rules_inserted && !rules.is_empty() && !current_section_owned {
        for rule in &rules {
            writeln!(output, "  - {rule}").expect("writing to a String cannot fail");
        }
    }

    // Blocks the document never mentioned are appended whole, so an override
    // can also introduce a section the provider did not send.
    for (key, block) in &overrides {
        if emitted_overrides.iter().any(|emitted| emitted == key) {
            continue;
        }
        output.push_str(block);
        if !block.ends_with('\n') {
            output.push('\n');
        }
    }

    Ok(PreparedSubscription {
        profile: output,
        proxy_count,
        proxy_group_count,
    })
}

/// True for a rule line whose type is `MATCH`.
fn is_catch_all_rule(line: &str) -> bool {
    let trimmed = line.trim_start();
    let Some(item) = trimmed.strip_prefix("- ") else {
        return false;
    };
    item.trim_start()
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("MATCH"))
        && item.trim_start()[5..].starts_with(',')
}

/// Returns the override key that `line` starts, if any.
///
/// A match is a column-zero key that has a block in `overrides`; the line may
/// either be the bare `key:` header or an inline `key: value` entry.
fn override_block_key<'a>(
    overrides: &'a std::collections::BTreeMap<&'a str, String>,
    line: &str,
) -> Option<&'a str> {
    let key = split_top_level_key(line)?.0;
    overrides.get_key_value(key).map(|(key, _)| *key)
}

/// Splits an override document into whole top-level blocks keyed by name.
///
/// Comments and blank lines above a block are dropped: an override only makes
/// sense as complete keys. A block runs until the next column-zero key. Keys
/// CapybaraProxy controls are dropped together with their body, because the safety
/// policy has to win over anything the operator pastes.
fn parse_override_blocks(override_yaml: Option<&str>) -> std::collections::BTreeMap<&str, String> {
    let Some(yaml) = override_yaml else {
        return std::collections::BTreeMap::new();
    };

    let mut blocks: Vec<(&str, String)> = Vec::new();
    // True while skipping the body of a blocked key.
    let mut skipping = false;
    for line in yaml.lines() {
        if let Some((key, _)) = split_top_level_key(line) {
            skipping = CONTROLLED_TOP_LEVEL_KEYS.contains(&key)
                || key == "rules"
                || key == "mixed-port"
                || key == "secret";
            if !skipping {
                blocks.push((key, String::new()));
            }
        }
        if skipping {
            continue;
        }
        if let Some((_, block)) = blocks.last_mut() {
            block.push_str(line);
            block.push('\n');
        }
    }

    blocks.into_iter().collect()
}

fn invalid(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::SubscriptionInvalid, message, false)
}

/// Returns the indentation width when `line` starts a YAML list item.
fn list_item_indent(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    if trimmed.len() == line.len() {
        // Items under a top-level section are indented.
        return None;
    }
    if trimmed.starts_with("- ") || trimmed == "-" {
        Some(line.len() - trimmed.len())
    } else {
        None
    }
}

/// Splits `key: value` where the key starts at column zero.
///
/// Returns `None` for comments, blank lines, document markers, list items and
/// anything indented.
fn split_top_level_key(line: &str) -> Option<(&str, &str)> {
    if line.is_empty()
        || line.starts_with(' ')
        || line.starts_with('\t')
        || line.starts_with('#')
        || line.starts_with('-')
        || line.starts_with('%')
    {
        return None;
    }
    let (key, rest) = line.split_once(':')?;
    let key = key.trim_end();
    if key.is_empty() || key.contains(' ') || key.contains('\t') {
        return None;
    }
    Some((key, rest))
}

#[cfg(test)]
mod tests {
    use super::{preflight, prepare_profile, MAX_SUBSCRIPTION_BYTES};

    const SAMPLE: &str = "\
# operator notes
mixed-port: 7890
port: 7891
socks-port: 7892
allow-lan: true
bind-address: 0.0.0.0
external-controller: 0.0.0.0:9090
secret: \"operator-secret\"
proxies:
  - name: Tokyo 01
    type: ss
    server: 203.0.113.7
    port: 8388
  - name: Osaka 01
    type: ss
    server: 203.0.113.8
    port: 8388
proxy-groups:
  - name: Proxy
    type: select
    proxies:
      - Tokyo 01
      - Osaka 01
rules:
  - GEOIP,CN,DIRECT
  - MATCH,Proxy
";

    #[test]
    fn removes_controlled_keys_and_injects_runtime_values() {
        let prepared = prepare_profile(SAMPLE, 49_153).expect("profile should prepare");
        let profile = prepared.profile;

        assert!(profile.contains("mixed-port: 49153"));
        assert!(profile.contains("allow-lan: false"));
        assert!(profile.contains("bind-address: 127.0.0.1"));

        assert!(!profile.contains("mixed-port: 7890"));
        assert!(!profile.contains("port: 7891"));
        assert!(!profile.contains("socks-port: 7892"));
        assert!(!profile.contains("allow-lan: true"));
        assert!(!profile.contains("bind-address: 0.0.0.0"));
        assert!(!profile.contains("external-controller: 0.0.0.0:9090"));
        assert!(!profile.contains("operator-secret"));
    }

    #[test]
    fn keeps_nodes_groups_and_rules_intact() {
        let prepared = prepare_profile(SAMPLE, 49_153).expect("profile should prepare");
        assert!(prepared.profile.contains("  - name: Tokyo 01"));
        assert!(prepared.profile.contains("  - name: Osaka 01"));
        assert!(prepared.profile.contains("  - GEOIP,CN,DIRECT"));
        assert!(prepared.profile.contains("# operator notes"));
        assert_eq!(prepared.proxy_count, 2);
        assert_eq!(prepared.proxy_group_count, 1);
    }

    #[test]
    fn removes_indented_authentication_block() {
        let yaml = "\
authentication:
  - \"user:password\"
proxies:
  - name: A
    type: ss
rules:
  - MATCH,DIRECT
";
        let prepared = prepare_profile(yaml, 1000).expect("profile should prepare");
        assert!(!prepared.profile.contains("user:password"));
        assert!(prepared.profile.contains("  - name: A"));
        assert!(!prepared.profile.contains("\n  - \"user:password\""));
    }

    #[test]
    fn multi_document_sections_are_still_scanned() {
        let yaml = "\
proxies:
  - name: A
    type: ss
---
rules:
  - MATCH,DIRECT
";
        let prepared = prepare_profile(yaml, 1000).expect("profile should prepare");
        assert_eq!(prepared.proxy_count, 1);
        assert!(prepared.profile.contains("---"));
    }

    #[test]
    fn preparing_twice_does_not_nest_the_managed_header() {
        // The adapter stores the operator's original document, so start always
        // prepares from clean input. Guard against persisting a prepared copy
        // by accident: a second pass must stay idempotent in key terms.
        let once = prepare_profile(SAMPLE, 1000).expect("first pass");
        let twice = prepare_profile(&once.profile, 2000).expect("second pass");

        assert_eq!(
            twice.profile.matches("mixed-port:").count(),
            1,
            "exactly one mixed-port line must survive"
        );
        assert!(twice.profile.contains("mixed-port: 2000"));
        assert!(!twice.profile.contains("mixed-port: 1000"));
        assert_eq!(
            twice.profile.matches("bind-address:").count(),
            1,
            "exactly one bind-address line must survive"
        );
        assert_eq!(twice.proxy_count, 2);
    }

    #[test]
    fn rejects_empty_documents() {
        assert!(prepare_profile("   \n\n", 1000).is_err());
    }

    #[test]
    fn rejects_documents_without_nodes() {
        let error = prepare_profile("rules:\n  - MATCH,DIRECT\n", 1000)
            .expect_err("document without proxies must be rejected");
        assert!(error.message.contains("proxies"));
    }

    #[test]
    fn startup_preferences_override_core_keys_and_win_over_the_subscription() {
        use capybara_contracts::{LogLevel, StartupPreferences};

        let yaml = "\
proxies:
  - name: A
    type: ss
unified-delay: false
tcp-concurrent: false
log-level: debug
";
        let preferences = StartupPreferences {
            log_level: LogLevel::Warning,
            ipv6: true,
            unified_delay: true,
            tcp_concurrent: true,
            proxy_port: 0,
        };
        let prepared =
            super::prepare_profile_with(yaml, 1000, preferences).expect("profile should prepare");

        assert!(prepared.profile.contains("unified-delay: true"));
        assert!(prepared.profile.contains("tcp-concurrent: true"));
        assert!(prepared.profile.contains("ipv6: true"));
        assert!(!prepared.profile.contains("unified-delay: false"));
        assert!(!prepared.profile.contains("tcp-concurrent: false"));
        assert!(!prepared.profile.contains("log-level: debug"));
        assert_eq!(prepared.profile.matches("unified-delay:").count(), 1);
    }

    #[test]
    fn default_preferences_keep_the_providers_values() {
        let yaml = "\
proxies:
  - name: A
    type: ss
unified-delay: false
";
        let prepared = prepare_profile(yaml, 1000).expect("profile should prepare");
        assert!(prepared.profile.contains("unified-delay: false"));
    }

    #[test]
    fn rejects_zero_proxy_port() {
        assert!(prepare_profile(SAMPLE, 0).is_err());
    }

    #[test]
    fn rejects_oversized_documents() {
        let big = format!("proxies:\n{}", "x".repeat(MAX_SUBSCRIPTION_BYTES));
        let error = preflight(&big).expect_err("oversized document must be rejected");
        assert!(error.message.contains("MiB"));
    }

    #[test]
    fn comments_are_not_mistaken_for_keys() {
        let yaml = "\
# mixed-port: 1234
proxies:
  - name: A
    type: ss
";
        let prepared = prepare_profile(yaml, 1000).expect("profile should prepare");
        assert!(prepared.profile.contains("# mixed-port: 1234"));
        assert!(prepared.profile.contains("mixed-port: 1000"));
    }

    const WITH_CATCH_ALL: &str = "\
proxies:
  - name: A
    type: ss
rules:
  - GEOIP,CN,DIRECT
  - MATCH,Proxy
";

    #[test]
    fn override_rules_land_before_the_catch_all_rule() {
        use super::prepare_profile_full;
        use capybara_contracts::StartupPreferences;

        let rules = vec![
            "DOMAIN-SUFFIX,corp.example,DIRECT".to_owned(),
            "IP-CIDR,10.0.0.0/8,DIRECT".to_owned(),
        ];
        let prepared = prepare_profile_full(
            WITH_CATCH_ALL,
            1000,
            StartupPreferences::default(),
            &rules,
            None,
        )
        .expect("profile should prepare");

        let profile = &prepared.profile;
        let custom = profile
            .find("DOMAIN-SUFFIX,corp.example,DIRECT")
            .expect("custom rule");
        let geo = profile.find("GEOIP,CN,DIRECT").expect("provider rule");
        let catch_all = profile.find("MATCH,Proxy").expect("catch-all");
        // Provider rules keep their authority, the operator's rules still run
        // before the blanket route.
        assert!(geo < custom);
        assert!(custom < catch_all);
        assert!(profile.contains("IP-CIDR,10.0.0.0/8,DIRECT"));
    }

    #[test]
    fn override_rules_without_a_catch_all_are_appended() {
        use super::prepare_profile_full;
        use capybara_contracts::StartupPreferences;

        let yaml = "\
proxies:
  - name: A
    type: ss
rules:
  - GEOIP,CN,DIRECT
";
        let prepared = prepare_profile_full(
            yaml,
            1000,
            StartupPreferences::default(),
            &["DOMAIN,example.com,Proxy".to_owned()],
            None,
        )
        .expect("profile should prepare");

        let profile = &prepared.profile;
        let geo = profile.find("GEOIP,CN,DIRECT").expect("provider rule");
        let custom = profile
            .find("DOMAIN,example.com,Proxy")
            .expect("custom rule");
        assert!(geo < custom);
    }

    #[test]
    fn override_yaml_replaces_a_whole_block_and_ignores_controlled_keys() {
        use super::prepare_profile_full;
        use capybara_contracts::StartupPreferences;

        let yaml = "\
proxies:
  - name: A
    type: ss
dns:
  enable: false
  nameserver:
    - 1.1.1.1
rules:
  - MATCH,Proxy
";
        let override_yaml = "\
dns:
  enable: true
  nameserver:
    - 8.8.8.8
mixed-port: 9999
secret: sneaky
";
        let prepared = prepare_profile_full(
            yaml,
            1000,
            StartupPreferences::default(),
            &[],
            Some(override_yaml),
        )
        .expect("profile should prepare");
        let profile = &prepared.profile;

        assert!(profile.contains("8.8.8.8"));
        assert!(!profile.contains("1.1.1.1"));
        // The dns key appears exactly once: replaced, not appended.
        assert_eq!(profile.matches("\ndns:").count(), 1);
        // The safety policy still wins over the override document.
        assert!(profile.contains("mixed-port: 1000"));
        assert!(!profile.contains("mixed-port: 9999"));
        assert!(!profile.contains("sneaky"));
    }

    #[test]
    fn override_yaml_can_introduce_a_block_the_provider_never_sent() {
        use super::prepare_profile_full;
        use capybara_contracts::StartupPreferences;

        let prepared = prepare_profile_full(
            WITH_CATCH_ALL,
            1000,
            StartupPreferences::default(),
            &[],
            Some("tun:\n  enable: false\n  stack: system\n"),
        )
        .expect("profile should prepare");

        assert!(prepared
            .profile
            .contains("tun:\n  enable: false\n  stack: system"));
    }
}
