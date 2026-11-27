//! Converts link-based subscriptions into the Clash/Mihomo YAML document the
//! Runtime expects.
//!
//! Providers hand out three shapes depending on the `User-Agent` and the share
//! link they are given:
//!
//! * a Clash/Mihomo YAML document — used unchanged;
//! * a base64 blob whose decoded text is one share link per line;
//! * the plain share-link list itself (pasted into the YAML box).
//!
//! The last two are common because the link is the same one a phone client
//! uses. This module turns them into a minimal profile with a `Proxy` select
//! group, so the imported subscription behaves like an ordinary one. The
//! conversion is best-effort: unsupported links are dropped, and when nothing
//! can be converted the original text is returned so the caller reports its
//! usual "no proxies" error instead of a misleading one.
//!
//! Supported: `ss://` (SIP002 and legacy), `vmess://`, `vless://`,
//! `trojan://`, `hysteria2://`/`hy2://` and `tuic://`, including the ws, grpc
//! and h2 transports and REALITY options. Every converted profile is still
//! validated by `mihomo -t` before it is installed, so a link this module
//! misreads fails the import instead of starting a broken core.

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine as _;
use serde_json::Value as Json;
use url::Url;

/// Returns a Clash YAML document for `document`.
///
/// Text that already looks like a Clash profile is returned untouched.
pub fn normalize(document: &str) -> String {
    let trimmed = document.trim_start_matches('\u{feff}').trim();
    if looks_like_clash_yaml(trimmed) {
        return document.to_owned();
    }

    if let Some(decoded) = decode_base64_text(trimmed) {
        if let Some(converted) = convert_links(&decoded) {
            return converted;
        }
    }

    convert_links(trimmed).unwrap_or_else(|| document.to_owned())
}

fn looks_like_clash_yaml(text: &str) -> bool {
    text.lines().any(|line| {
        let line = line.trim_end();
        line.starts_with("proxies:") || line.starts_with("proxy-providers:")
    })
}

fn convert_links(text: &str) -> Option<String> {
    let mut proxies: Vec<ProxySpec> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        if let Some(spec) = parse_link(line) {
            if !spec.entries.is_empty() {
                proxies.push(spec);
            }
        }
    }
    if proxies.is_empty() {
        return None;
    }

    deduplicate_names(&mut proxies);
    Some(render(&proxies))
}

fn deduplicate_names(proxies: &mut [ProxySpec]) {
    let mut seen: Vec<String> = Vec::with_capacity(proxies.len());
    for (index, spec) in proxies.iter_mut().enumerate() {
        let base = if spec.name.trim().is_empty() {
            format!("Node {}", index + 1)
        } else {
            spec.name.trim().to_owned()
        };
        let mut candidate = base.clone();
        let mut suffix = 2;
        while seen.iter().any(|existing| existing == &candidate) {
            candidate = format!("{base} {suffix}");
            suffix += 1;
        }
        seen.push(candidate.clone());
        spec.name = candidate;
    }
}

fn render(proxies: &[ProxySpec]) -> String {
    use std::fmt::Write as _;

    let mut out = String::new();
    out.push_str("# Converted by CapybaraProxy from a link-based subscription.\n");
    out.push_str("proxies:\n");
    for spec in proxies {
        let _ = writeln!(out, "  - name: {}", quote(&spec.name));
        let _ = writeln!(out, "    type: {}", spec.kind);
        for (key, value) in &spec.entries {
            write_yaml(&mut out, key, value, 4);
        }
    }

    out.push_str("proxy-groups:\n");
    out.push_str("  - name: \"Proxy\"\n");
    out.push_str("    type: select\n");
    out.push_str("    proxies:\n");
    for spec in proxies {
        let _ = writeln!(out, "      - {}", quote(&spec.name));
    }
    out.push_str("rules:\n");
    out.push_str("  - GEOIP,CN,DIRECT\n");
    out.push_str("  - MATCH,Proxy\n");
    out
}

enum Yaml {
    Str(String),
    Int(i64),
    Bool(bool),
    List(Vec<String>),
    Map(Vec<(&'static str, Yaml)>),
}

struct ProxySpec {
    name: String,
    kind: &'static str,
    entries: Vec<(&'static str, Yaml)>,
}

impl ProxySpec {
    fn new(name: String, kind: &'static str) -> Self {
        Self {
            name,
            kind,
            entries: Vec::new(),
        }
    }

    fn push(&mut self, key: &'static str, value: Yaml) {
        self.entries.push((key, value));
    }

    fn push_str(&mut self, key: &'static str, value: impl Into<String>) {
        self.push(key, Yaml::Str(value.into()));
    }
}

fn write_yaml(out: &mut String, key: &str, value: &Yaml, indent: usize) {
    use std::fmt::Write as _;

    let pad = " ".repeat(indent);
    match value {
        Yaml::Str(value) => {
            let _ = writeln!(out, "{pad}{key}: {}", quote(value));
        }
        Yaml::Int(value) => {
            let _ = writeln!(out, "{pad}{key}: {value}");
        }
        Yaml::Bool(value) => {
            let _ = writeln!(out, "{pad}{key}: {value}");
        }
        Yaml::List(values) => {
            let _ = writeln!(out, "{pad}{key}:");
            for value in values {
                let _ = writeln!(out, "{pad}  - {}", quote(value));
            }
        }
        Yaml::Map(entries) => {
            let _ = writeln!(out, "{pad}{key}:");
            for (key, value) in entries {
                write_yaml(out, key, value, indent + 2);
            }
        }
    }
}

fn quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            character if (character as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => out.push(character),
        }
    }
    out.push('"');
    out
}

fn parse_link(link: &str) -> Option<ProxySpec> {
    let lower = link.to_ascii_lowercase();
    if lower.starts_with("ss://") {
        parse_ss(link)
    } else if lower.starts_with("vmess://") {
        parse_vmess(link)
    } else if lower.starts_with("vless://") {
        parse_vless(link)
    } else if lower.starts_with("trojan://") {
        parse_trojan(link)
    } else if lower.starts_with("hysteria2://") || lower.starts_with("hy2://") {
        parse_hysteria2(link)
    } else if lower.starts_with("tuic://") {
        parse_tuic(link)
    } else {
        None
    }
}

fn parse_ss(link: &str) -> Option<ProxySpec> {
    let body = link.strip_prefix("ss://")?;
    let (body, fragment) = split_fragment(body);

    let (method, password, hostport, plugin) = match body.rsplit_once('@') {
        Some((userinfo, rest)) => {
            let (hostport, query) = split_query(rest);
            let (method, password) = decode_ss_userinfo(userinfo)?;
            (
                method,
                password,
                hostport.to_owned(),
                query_param(query, "plugin"),
            )
        }
        None => {
            // Legacy form: the whole body is base64("method:password@host:port").
            let decoded = decode_base64_text(body)?;
            let (userinfo, hostport) = decoded.rsplit_once('@')?;
            let (hostport, _query) = split_query(hostport);
            let (method, password) = userinfo.split_once(':')?;
            (
                method.to_owned(),
                password.to_owned(),
                hostport.to_owned(),
                None,
            )
        }
    };

    let (host, port) = split_host_port(&hostport)?;
    let mut spec = ProxySpec::new(name_or(fragment, &format!("{host}:{port}")), "ss");
    spec.push_str("server", host);
    spec.push("port", Yaml::Int(i64::from(port)));
    spec.push_str("cipher", method);
    spec.push_str("password", password);
    spec.push("udp", Yaml::Bool(true));

    if let Some(plugin) = plugin {
        apply_ss_plugin(&mut spec, &plugin);
    }
    Some(spec)
}

fn apply_ss_plugin(spec: &mut ProxySpec, plugin: &str) {
    let mut parts = plugin.split(';');
    let name = parts.next().unwrap_or_default();
    let options: Vec<(&str, &str)> = parts.filter_map(|part| part.split_once('=')).collect();
    let option = |key: &str| {
        options
            .iter()
            .find(|(candidate, _)| *candidate == key)
            .map(|(_, value)| (*value).to_owned())
    };

    match name {
        "obfs-local" | "simple-obfs" | "obfs" => {
            let mode = option("obfs").unwrap_or_else(|| "http".to_owned());
            let mut opts = vec![("mode", Yaml::Str(mode))];
            if let Some(host) = option("obfs-host") {
                opts.push(("host", Yaml::Str(host)));
            }
            spec.push_str("plugin", "obfs");
            spec.push("plugin-opts", Yaml::Map(opts));
        }
        "v2ray-plugin" => {
            let mut opts = vec![("mode", Yaml::Str("websocket".to_owned()))];
            if options.iter().any(|(key, _)| *key == "tls") {
                opts.push(("tls", Yaml::Bool(true)));
            }
            if let Some(host) = option("host") {
                opts.push(("host", Yaml::Str(host)));
            }
            if let Some(path) = option("path") {
                opts.push(("path", Yaml::Str(path)));
            }
            spec.push_str("plugin", "v2ray-plugin");
            spec.push("plugin-opts", Yaml::Map(opts));
        }
        _ => {}
    }
}

fn parse_vmess(link: &str) -> Option<ProxySpec> {
    let body = link.strip_prefix("vmess://")?;
    let (body, _fragment) = split_fragment(body);
    let decoded = decode_base64_text(body)?;
    let value: Json = serde_json::from_str(&decoded).ok()?;

    let host = json_text(&value, "add")?;
    let port = json_text(&value, "port")?.parse::<u16>().ok()?;
    let uuid = json_text(&value, "id")?;
    let name = json_text(&value, "ps").unwrap_or_else(|| format!("{host}:{port}"));

    let mut spec = ProxySpec::new(name, "vmess");
    spec.push_str("server", host.clone());
    spec.push("port", Yaml::Int(i64::from(port)));
    spec.push_str("uuid", uuid);
    spec.push(
        "alterId",
        Yaml::Int(
            json_text(&value, "aid")
                .and_then(|aid| aid.parse().ok())
                .unwrap_or(0),
        ),
    );
    spec.push_str(
        "cipher",
        json_text(&value, "scy").unwrap_or_else(|| "auto".to_owned()),
    );
    spec.push("udp", Yaml::Bool(true));

    let tls = json_text(&value, "tls").unwrap_or_default();
    if tls == "tls" {
        spec.push("tls", Yaml::Bool(true));
        if let Some(sni) = json_text(&value, "sni").filter(|sni| !sni.is_empty()) {
            spec.push_str("servername", sni);
        }
    }

    let network = json_text(&value, "net").unwrap_or_else(|| "tcp".to_owned());
    apply_transport(
        &mut spec,
        &network,
        json_text(&value, "path"),
        json_text(&value, "host"),
        None,
    );
    Some(spec)
}

fn parse_vless(link: &str) -> Option<ProxySpec> {
    let url = Url::parse(link).ok()?;
    let uuid = percent_decode(url.username());
    if uuid.is_empty() {
        return None;
    }
    let host = url.host_str()?.to_owned();
    let port = url.port()?;
    let params = query_pairs(&url);

    let mut spec = ProxySpec::new(name_or_url(&url, &format!("{host}:{port}")), "vless");
    spec.push_str("server", host);
    spec.push("port", Yaml::Int(i64::from(port)));
    spec.push_str("uuid", uuid);
    spec.push("udp", Yaml::Bool(true));

    let security = param(&params, "security").unwrap_or_default();
    if matches!(security.as_str(), "tls" | "xtls" | "reality") {
        spec.push("tls", Yaml::Bool(true));
    }
    if let Some(sni) = param(&params, "sni").filter(|sni| !sni.is_empty()) {
        spec.push_str("servername", sni);
    }
    if let Some(flow) = param(&params, "flow").filter(|flow| !flow.is_empty()) {
        spec.push_str("flow", flow);
    }
    if security == "reality" {
        let mut opts = Vec::new();
        if let Some(key) = param(&params, "pbk") {
            opts.push(("public-key", Yaml::Str(key)));
        }
        if let Some(id) = param(&params, "sid") {
            opts.push(("short-id", Yaml::Str(id)));
        }
        spec.push("reality-opts", Yaml::Map(opts));
        spec.push_str(
            "client-fingerprint",
            param(&params, "fp").unwrap_or_else(|| "chrome".to_owned()),
        );
    } else if let Some(fingerprint) = param(&params, "fp") {
        spec.push_str("client-fingerprint", fingerprint);
    }
    apply_insecure(&mut spec, &params);
    apply_transport(
        &mut spec,
        &param(&params, "type").unwrap_or_else(|| "tcp".to_owned()),
        param(&params, "path"),
        param(&params, "host"),
        param(&params, "serviceName"),
    );
    Some(spec)
}

fn parse_trojan(link: &str) -> Option<ProxySpec> {
    let url = Url::parse(link).ok()?;
    let password = percent_decode(url.username());
    if password.is_empty() {
        return None;
    }
    let host = url.host_str()?.to_owned();
    let port = url.port()?;
    let params = query_pairs(&url);

    let mut spec = ProxySpec::new(name_or_url(&url, &format!("{host}:{port}")), "trojan");
    spec.push_str("server", host);
    spec.push("port", Yaml::Int(i64::from(port)));
    spec.push_str("password", password);
    spec.push("udp", Yaml::Bool(true));

    if let Some(sni) = param(&params, "sni")
        .or_else(|| param(&params, "peer"))
        .filter(|sni| !sni.is_empty())
    {
        spec.push_str("sni", sni);
    }
    if let Some(fingerprint) = param(&params, "fp") {
        spec.push_str("client-fingerprint", fingerprint);
    }
    if let Some(alpn) = param(&params, "alpn").filter(|alpn| !alpn.is_empty()) {
        spec.push(
            "alpn",
            Yaml::List(alpn.split(',').map(str::to_owned).collect()),
        );
    }
    apply_insecure(&mut spec, &params);
    apply_transport(
        &mut spec,
        &param(&params, "type").unwrap_or_else(|| "tcp".to_owned()),
        param(&params, "path"),
        param(&params, "host"),
        param(&params, "serviceName"),
    );
    Some(spec)
}

fn parse_hysteria2(link: &str) -> Option<ProxySpec> {
    let url = Url::parse(link).ok()?;
    let password = percent_decode(url.username());
    if password.is_empty() {
        return None;
    }
    let host = url.host_str()?.to_owned();
    let port = url.port()?;
    let params = query_pairs(&url);

    let mut spec = ProxySpec::new(name_or_url(&url, &format!("{host}:{port}")), "hysteria2");
    spec.push_str("server", host);
    spec.push("port", Yaml::Int(i64::from(port)));
    spec.push_str("password", password);

    if let Some(sni) = param(&params, "sni").filter(|sni| !sni.is_empty()) {
        spec.push_str("sni", sni);
    }
    if let Some(obfs) = param(&params, "obfs").filter(|obfs| !obfs.is_empty()) {
        spec.push_str("obfs", obfs);
        if let Some(password) = param(&params, "obfs-password") {
            spec.push_str("obfs-password", password);
        }
    }
    if let Some(alpn) = param(&params, "alpn").filter(|alpn| !alpn.is_empty()) {
        spec.push(
            "alpn",
            Yaml::List(alpn.split(',').map(str::to_owned).collect()),
        );
    }
    apply_insecure(&mut spec, &params);
    Some(spec)
}

fn parse_tuic(link: &str) -> Option<ProxySpec> {
    let url = Url::parse(link).ok()?;
    let uuid = percent_decode(url.username());
    if uuid.is_empty() {
        return None;
    }
    let password = percent_decode(url.password().unwrap_or_default());
    let host = url.host_str()?.to_owned();
    let port = url.port()?;
    let params = query_pairs(&url);

    let mut spec = ProxySpec::new(name_or_url(&url, &format!("{host}:{port}")), "tuic");
    spec.push_str("server", host);
    spec.push("port", Yaml::Int(i64::from(port)));
    spec.push_str("uuid", uuid);
    spec.push_str("password", password);
    spec.push("udp", Yaml::Bool(true));

    if let Some(sni) = param(&params, "sni").filter(|sni| !sni.is_empty()) {
        spec.push_str("sni", sni);
    }
    if let Some(congestion) = param(&params, "congestion_control") {
        spec.push_str("congestion-controller", congestion);
    }
    if let Some(mode) = param(&params, "udp_relay_mode") {
        spec.push_str("udp-relay-mode", mode);
    }
    if let Some(alpn) = param(&params, "alpn").filter(|alpn| !alpn.is_empty()) {
        spec.push(
            "alpn",
            Yaml::List(alpn.split(',').map(str::to_owned).collect()),
        );
    }
    apply_insecure(&mut spec, &params);
    Some(spec)
}

fn apply_insecure(spec: &mut ProxySpec, params: &[(String, String)]) {
    let insecure = param(params, "allowInsecure")
        .or_else(|| param(params, "insecure"))
        .or_else(|| param(params, "allow_insecure"));
    if matches!(insecure.as_deref(), Some("1") | Some("true")) {
        spec.push("skip-cert-verify", Yaml::Bool(true));
    }
}

/// Writes the transport keys shared by VLESS, Trojan and VMess.
fn apply_transport(
    spec: &mut ProxySpec,
    kind: &str,
    path: Option<String>,
    host: Option<String>,
    service_name: Option<String>,
) {
    match kind {
        "ws" => {
            let mut opts = Vec::new();
            if let Some(path) = path.filter(|path| !path.is_empty()) {
                opts.push(("path", Yaml::Str(path)));
            }
            if let Some(host) = host.filter(|host| !host.is_empty()) {
                opts.push(("headers", Yaml::Map(vec![("Host", Yaml::Str(host))])));
            }
            spec.push_str("network", "ws");
            spec.push("ws-opts", Yaml::Map(opts));
        }
        "grpc" => {
            spec.push_str("network", "grpc");
            if let Some(name) = service_name.or(path).filter(|name| !name.is_empty()) {
                spec.push(
                    "grpc-opts",
                    Yaml::Map(vec![("grpc-service-name", Yaml::Str(name))]),
                );
            }
        }
        "h2" | "http" => {
            spec.push_str("network", "h2");
            let mut opts = Vec::new();
            if let Some(path) = path.filter(|path| !path.is_empty()) {
                opts.push(("path", Yaml::Str(path)));
            }
            if let Some(host) = host.filter(|host| !host.is_empty()) {
                opts.push(("host", Yaml::List(vec![host])));
            }
            spec.push("h2-opts", Yaml::Map(opts));
        }
        // `tcp` is Mihomo's default and needs no transport key.
        _ => {}
    }
}

fn json_text(value: &Json, key: &str) -> Option<String> {
    match value.get(key)? {
        Json::String(text) if !text.is_empty() => Some(text.clone()),
        Json::Number(number) => Some(number.to_string()),
        Json::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn query_pairs(url: &Url) -> Vec<(String, String)> {
    url.query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect()
}

fn param(params: &[(String, String)], key: &str) -> Option<String> {
    params
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.clone())
}

fn name_or(fragment: &str, fallback: &str) -> String {
    let name = percent_decode(fragment).trim().to_owned();
    if name.is_empty() {
        fallback.to_owned()
    } else {
        name
    }
}

fn name_or_url(url: &Url, fallback: &str) -> String {
    name_or(url.fragment().unwrap_or_default(), fallback)
}

fn split_fragment(input: &str) -> (&str, &str) {
    match input.split_once('#') {
        Some((body, fragment)) => (body, fragment),
        None => (input, ""),
    }
}

fn split_query(input: &str) -> (&str, &str) {
    match input.split_once('?') {
        Some((body, query)) => (body, query),
        None => (input, ""),
    }
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        if percent_decode(name) == key {
            Some(percent_decode(value))
        } else {
            None
        }
    })
}

fn decode_ss_userinfo(userinfo: &str) -> Option<(String, String)> {
    let decoded = percent_decode(userinfo);
    if let Some((method, password)) = decoded.split_once(':') {
        return Some((method.to_owned(), password.to_owned()));
    }
    let decoded = decode_base64_text(userinfo)?;
    let (method, password) = decoded.split_once(':')?;
    Some((method.to_owned(), password.to_owned()))
}

fn split_host_port(input: &str) -> Option<(String, u16)> {
    let input = input.trim().trim_end_matches('/');
    if let Some(rest) = input.strip_prefix('[') {
        // Bracketed IPv6 literal: `[::1]:443`.
        let (host, rest) = rest.split_once(']')?;
        let port = rest.strip_prefix(':')?.parse().ok()?;
        return Some((host.to_owned(), port));
    }
    let (host, port) = input.rsplit_once(':')?;
    Some((host.to_owned(), port.parse().ok()?))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                out.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Decodes a base64 blob, tolerating missing padding and line wrapping.
fn decode_base64_text(input: &str) -> Option<String> {
    let compact: String = input
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    if compact.is_empty() {
        return None;
    }

    for engine in [&STANDARD, &STANDARD_NO_PAD, &URL_SAFE, &URL_SAFE_NO_PAD] {
        if let Ok(bytes) = engine.decode(compact.as_bytes()) {
            if let Ok(text) = String::from_utf8(bytes) {
                return Some(text);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::normalize;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;

    fn base64(input: &str) -> String {
        STANDARD.encode(input)
    }

    #[test]
    fn leaves_clash_yaml_untouched() {
        let yaml = "proxies:\n  - name: A\n    type: ss\n";
        assert_eq!(normalize(yaml), yaml);
    }

    #[test]
    fn converts_a_base64_link_list() {
        let links = "\
ss://YWVzLTI1Ni1nY206c2VjcmV0@203.0.113.7:8388#Tokyo%2001
vmess://eyJ2IjoiMiIsInBzIjoiT3Nha2EiLCJhZGQiOiIyMDMuMC4xMTMuOCIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJuZXQiOiJ3cyIsInRscyI6InRscyIsImhvc3QiOiJleGFtcGxlLmNvbSIsInBhdGgiOiIvd3MifQ==";
        let converted = normalize(&base64(links));

        assert!(converted.contains("proxies:"));
        assert!(converted.contains("type: ss"));
        assert!(converted.contains("cipher: \"aes-256-gcm\""));
        assert!(converted.contains("name: \"Tokyo 01\""));
        assert!(converted.contains("type: vmess"));
        assert!(converted.contains("network: \"ws\""));
        assert!(converted.contains("proxy-groups:"));
        assert!(converted.contains("MATCH,Proxy"));
    }

    #[test]
    fn converts_plain_links() {
        let links = "trojan://pass@example.com:443?sni=example.com&type=ws&path=%2Fws#Node";
        let converted = normalize(links);
        assert!(converted.contains("type: trojan"));
        assert!(converted.contains("password: \"pass\""));
        assert!(converted.contains("sni: \"example.com\""));
        assert!(converted.contains("path: \"/ws\""));
    }

    #[test]
    fn converts_vless_reality_and_hysteria2() {
        let links = "\
vless://uuid-1@example.com:443?security=reality&sni=www.bing.com&pbk=pub&sid=abcd&fp=chrome&flow=xtls-rprx-vision#Reality
hysteria2://secret@example.com:8443?sni=example.com&insecure=1#HY2";
        let converted = normalize(links);
        assert!(converted.contains("reality-opts:"));
        assert!(converted.contains("public-key: \"pub\""));
        assert!(converted.contains("flow: \"xtls-rprx-vision\""));
        assert!(converted.contains("type: hysteria2"));
        assert!(converted.contains("skip-cert-verify: true"));
    }

    #[test]
    fn decodes_legacy_ss_links() {
        let legacy = format!("ss://{}#Legacy", base64("aes-128-gcm:pw@203.0.113.9:8389"));
        let converted = normalize(&legacy);
        assert!(converted.contains("server: \"203.0.113.9\""));
        assert!(converted.contains("port: 8389"));
        assert!(converted.contains("name: \"Legacy\""));
    }

    #[test]
    fn duplicate_names_are_disambiguated() {
        let links = "\
ss://YWVzLTI1Ni1nY206c2VjcmV0@203.0.113.7:8388#Same
ss://YWVzLTI1Ni1nY206c2VjcmV0@203.0.113.8:8388#Same";
        let converted = normalize(links);
        assert!(converted.contains("name: \"Same\""));
        assert!(converted.contains("name: \"Same 2\""));
    }

    #[test]
    fn unsupported_text_is_returned_unchanged() {
        let html = "<html><body>Not a subscription</body></html>";
        assert_eq!(normalize(html), html);
    }

    #[test]
    fn blank_input_is_returned_unchanged() {
        assert_eq!(normalize("   "), "   ");
    }
}
