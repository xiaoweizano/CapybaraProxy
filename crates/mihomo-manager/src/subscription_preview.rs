//! Static extraction of node, group and rule names from a stored subscription.
//!
//! This is a *display* helper for the offline case: while the Runtime is
//! stopped there is no control API, but the operator still wants to see what
//! the imported subscription contains. It must never be used to drive routing —
//! Mihomo parses the real document itself, and this module only reads enough to
//! render a read-only list.
//!
//! Deliberately shallow. Indentation is tracked only to tell a list entry from
//! its own continuation lines; nested keys such as a group's member list are
//! handled by tracking one level of depth.

use flowproxy_contracts::{ProxyGroup, ProxyNode, RuleItem};

/// Upper bound so a pathological document cannot exhaust the UI.
const MAX_ENTRIES: usize = 500;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SubscriptionPreview {
    pub groups: Vec<ProxyGroup>,
    pub rules: Vec<RuleItem>,
}

impl SubscriptionPreview {
    pub fn is_empty(&self) -> bool {
        self.groups.iter().all(|group| group.nodes.is_empty()) && self.rules.is_empty()
    }
}

/// Parses the display-only summary of a subscription document.
pub fn preview(yaml: &str) -> SubscriptionPreview {
    let mut preview = SubscriptionPreview::default();

    let mut section = Section::Other;
    // Indentation of the section's own list items, learned from the first one.
    let mut item_indent: Option<usize> = None;
    // Indentation of a nested member list inside a group.
    let mut member_indent: Option<usize> = None;

    let mut node: Option<ProxyNode> = None;
    let mut loose_nodes: Vec<ProxyNode> = Vec::new();
    let mut group: Option<(String, Vec<String>)> = None;

    for raw in yaml.lines() {
        let line = raw.trim_end();
        if line.is_empty() || line.trim_start().starts_with('#') {
            continue;
        }

        // A key at column zero starts a new section.
        if !raw.starts_with(' ') && !raw.starts_with('\t') {
            flush_node(&mut loose_nodes, &mut node);
            flush_group(&mut preview, &mut group);
            section = match top_level_key(line) {
                Some("proxies") => Section::Proxies,
                Some("proxy-groups") => Section::ProxyGroups,
                Some("rules") => Section::Rules,
                _ => Section::Other,
            };
            item_indent = None;
            member_indent = None;
            continue;
        }

        let indent = raw.len() - raw.trim_start().len();
        let body = raw.trim_start();

        match section {
            Section::Proxies | Section::ProxyGroups => {
                let expected = *item_indent.get_or_insert(indent);
                if indent == expected && body.starts_with('-') {
                    flush_node(&mut loose_nodes, &mut node);
                    flush_group(&mut preview, &mut group);
                    member_indent = None;

                    if section == Section::Proxies {
                        node = Some(blank_node());
                    } else {
                        group = Some((String::new(), Vec::new()));
                    }

                    // Inline form: `- name: Tokyo 01`
                    if let Some(("name", value)) = key_value(body.trim_start_matches('-').trim()) {
                        if let Some(node) = node.as_mut() {
                            node.name = unquote(value);
                        } else if let Some((name, _)) = group.as_mut() {
                            *name = unquote(value);
                        }
                    }
                    continue;
                }

                // Continuation lines of the current item.
                if indent > expected {
                    if section == Section::ProxyGroups {
                        if body.starts_with("proxies:") {
                            member_indent = Some(indent);
                            continue;
                        }
                        if let Some(member_start) = body.strip_prefix('-') {
                            if let Some((_, members)) = group.as_mut() {
                                let name = unquote(member_start.trim());
                                if !name.is_empty() {
                                    members.push(name);
                                }
                            }
                            continue;
                        }
                    }

                    if let Some((key, value)) = key_value(body) {
                        match key {
                            "name" => {
                                if let Some(node) = node.as_mut() {
                                    node.name = unquote(value);
                                } else if let Some((name, _)) = group.as_mut() {
                                    *name = unquote(value);
                                }
                            }
                            "type" => {
                                if let Some(node) = node.as_mut() {
                                    node.proxy_type = normalize_type(value);
                                }
                            }
                            _ => {}
                        }
                    }
                    let _ = member_indent;
                }
            }
            Section::Rules => {
                let expected = *item_indent.get_or_insert(indent);
                if indent != expected || !body.starts_with('-') {
                    continue;
                }
                let rule = body.trim_start_matches('-').trim();
                if let Some((rule_type, rest)) = rule.split_once(',') {
                    let mut parts = rest.split(',');
                    let payload = parts.next().unwrap_or("").trim();
                    let target = parts.next().unwrap_or("").trim();
                    if !rule_type.trim().is_empty() && preview.rules.len() < MAX_ENTRIES {
                        preview.rules.push(RuleItem {
                            index: preview.rules.len(),
                            rule_type: rule_type.trim().to_owned(),
                            payload: unquote(payload),
                            proxy: unquote(target),
                        });
                    }
                }
            }
            Section::Other => {}
        }
    }

    flush_node(&mut loose_nodes, &mut node);
    flush_group(&mut preview, &mut group);

    // A subscription without any proxy-groups still lists usable nodes.
    if preview.groups.is_empty() && !loose_nodes.is_empty() {
        preview.groups.push(ProxyGroup {
            name: "Subscription".to_owned(),
            group_type: "Selector".to_owned(),
            selected: loose_nodes.first().map(|n| n.name.clone()).unwrap_or_default(),
            nodes: loose_nodes,
        });
    } else if let Some(group) = preview.groups.first_mut() {
        // Attach the flat node list when the groups did not enumerate members.
        if group.nodes.is_empty() && !loose_nodes.is_empty() {
            group.nodes = loose_nodes;
        }
    }

    // Give the first group a selected node so the UI has something to show.
    if let Some(group) = preview.groups.first_mut() {
        if group.selected.is_empty() {
            group.selected = group
                .nodes
                .first()
                .map(|node| node.name.clone())
                .unwrap_or_default();
        }
    }

    preview
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Section {
    Proxies,
    ProxyGroups,
    Rules,
    Other,
}

fn blank_node() -> ProxyNode {
    ProxyNode {
        name: String::new(),
        proxy_type: String::new(),
        udp: false,
        delay_ms: None,
        alive: true,
    }
}

fn flush_node(loose_nodes: &mut Vec<ProxyNode>, node: &mut Option<ProxyNode>) {
    let Some(parsed) = node.take() else {
        return;
    };
    if parsed.name.is_empty() || loose_nodes.len() >= MAX_ENTRIES {
        return;
    }
    loose_nodes.push(parsed);
}

fn flush_group(preview: &mut SubscriptionPreview, group: &mut Option<(String, Vec<String>)>) {
    let Some((name, members)) = group.take() else {
        return;
    };
    if name.is_empty() || preview.groups.len() >= MAX_ENTRIES {
        return;
    }

    let selected = members
        .iter()
        .find(|member| member.as_str() != "DIRECT")
        .or_else(|| members.first())
        .cloned()
        .unwrap_or_default();
    preview.groups.push(ProxyGroup {
        name,
        group_type: "Selector".to_owned(),
        selected,
        nodes: members.iter().map(|member| member_node(member)).collect(),
    });
}

fn member_node(name: &str) -> ProxyNode {
    ProxyNode {
        name: name.to_owned(),
        proxy_type: String::new(),
        udp: false,
        delay_ms: None,
        alive: true,
    }
}

/// Returns the key when the line is a top-level `key:` entry (or `key: value`).
///
/// Section headers like `proxies:` have an empty value, so the value must not
/// be required here.
fn top_level_key(line: &str) -> Option<&str> {
    let (key, _) = line.split_once(':')?;
    let key = key.trim();
    if key.is_empty() || key.contains(' ') || key.contains('\t') {
        return None;
    }
    Some(key)
}

fn key_value(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    let key = key.trim();
    if key.is_empty() || key.contains(' ') {
        return None;
    }
    Some((key, value.trim()))
}

fn unquote(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_owned()
}

/// Maps Mihomo's lowercase protocol ids to the labels used by the UI.
fn normalize_type(value: &str) -> String {
    match unquote(value).to_ascii_lowercase().as_str() {
        "ss" | "shadowsocks" => "Shadowsocks",
        "ssr" | "shadowsocksr" => "ShadowsocksR",
        "vmess" => "VMess",
        "vless" => "VLESS",
        "trojan" => "Trojan",
        "hysteria" => "Hysteria",
        "hysteria2" => "Hysteria2",
        "tuic" => "TUIC",
        "socks5" => "Socks5",
        "http" => "HTTP",
        "wireguard" => "WireGuard",
        "direct" => "Direct",
        _ => return unquote(value),
    }
    .to_owned()
}

#[cfg(test)]
mod tests {
    use super::preview;

    const SAMPLE: &str = "\
proxies:
  - name: Tokyo 01
    type: ss
    server: 203.0.113.7
  - name: Osaka 01
    type: vmess
    server: 203.0.113.8
proxy-groups:
  - name: Proxy
    type: select
    proxies:
      - Tokyo 01
      - Osaka 01
rules:
  - GEOIP,CN,DIRECT
  - DOMAIN-SUFFIX,example.com,Proxy
  - MATCH,Proxy
";

    #[test]
    fn extracts_groups_with_members() {
        let parsed = preview(SAMPLE);

        assert_eq!(parsed.groups.len(), 1);
        let group = &parsed.groups[0];
        assert_eq!(group.name, "Proxy");
        assert_eq!(group.selected, "Tokyo 01");
        assert_eq!(group.nodes.len(), 2);
        assert_eq!(group.nodes[1].name, "Osaka 01");
    }

    #[test]
    fn extracts_rules_with_payload_and_target() {
        let parsed = preview(SAMPLE);

        assert_eq!(parsed.rules.len(), 3);
        assert_eq!(parsed.rules[0].rule_type, "GEOIP");
        assert_eq!(parsed.rules[0].payload, "CN");
        assert_eq!(parsed.rules[0].proxy, "DIRECT");
        assert_eq!(parsed.rules[1].payload, "example.com");
        assert_eq!(parsed.rules[2].rule_type, "MATCH");
    }

    #[test]
    fn nodes_without_groups_still_appear() {
        let parsed = preview(
            "proxies:\n  - name: Solo\n    type: trojan\nrules:\n  - MATCH,DIRECT\n",
        );

        assert_eq!(parsed.groups.len(), 1);
        assert_eq!(parsed.groups[0].nodes[0].name, "Solo");
        assert_eq!(parsed.groups[0].nodes[0].proxy_type, "Trojan");
    }

    #[test]
    fn handles_inline_list_items_and_quotes() {
        let parsed = preview(
            "proxies:\n  - {name: \"Quoted Node\", type: vless}\n",
        );

        // Inline mappings are skipped rather than mis-parsed.
        assert!(parsed.is_empty() || parsed.groups[0].nodes.is_empty());
    }

    #[test]
    fn does_not_misfire_on_nested_proxies_key() {
        let parsed = preview(SAMPLE);
        // The group's `proxies:` member list must not restart a new section.
        assert_eq!(parsed.groups.len(), 1);
    }

    #[test]
    fn empty_document_yields_nothing() {
        assert!(preview("").is_empty());
        assert!(preview("# only a comment\n").is_empty());
    }

    #[test]
    fn normalizes_common_protocol_ids() {
        let parsed = preview("proxies:\n  - name: A\n    type: vmess\n");
        assert_eq!(parsed.groups[0].nodes[0].proxy_type, "VMess");
    }
}
