use crate::validate_loopback_endpoint;
use capybara_contracts::{
    ConnectionPage, ConnectionSummary, CorePreferences, DelayProbeSettings, DelaySample,
    GroupDelayResult, LogLevel, ProviderInfo, ProxyGroup, ProxyNode, RoutingMode, RuleItem,
    RuntimeError, RuntimeErrorCode, MAX_DELAY_TIMEOUT_MS, MIN_DELAY_TIMEOUT_MS,
};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const API_TIMEOUT: Duration = Duration::from_millis(1_500);

#[derive(Clone, Debug)]
pub struct LoopbackApiClient {
    endpoint: String,
    secret: String,
}

impl LoopbackApiClient {
    pub fn new(endpoint: &str, secret: &str) -> Result<Self, RuntimeError> {
        validate_loopback_endpoint(endpoint)?;
        if secret.len() < 16 {
            return Err(api_error("The Mihomo API credential is invalid."));
        }
        Ok(Self {
            endpoint: endpoint.trim_end_matches('/').to_owned(),
            secret: secret.to_owned(),
        })
    }

    pub fn get_json(&self, path: &str) -> Result<Value, RuntimeError> {
        self.request_json("GET", path, None)
    }

    pub fn put_json(&self, path: &str, body: &Value) -> Result<Value, RuntimeError> {
        self.request_json("PUT", path, Some(body))
    }

    pub(crate) fn request_json(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, RuntimeError> {
        validate_request_path(path)?;
        let port = self.endpoint_port()?;
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(700))
            .map_err(|_| api_error("The local Mihomo control API is unavailable."))?;
        stream
            .set_read_timeout(Some(API_TIMEOUT))
            .and_then(|()| stream.set_write_timeout(Some(API_TIMEOUT)))
            .map_err(|_| api_error("The local Mihomo control API timed out."))?;

        let body_bytes = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| api_error("The Mihomo control request could not be encoded."))?
            .unwrap_or_default();
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.secret,
            body_bytes.len()
        );
        stream
            .write_all(request.as_bytes())
            .and_then(|()| stream.write_all(&body_bytes))
            .map_err(|_| api_error("The Mihomo control request could not be sent."))?;

        let mut response = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let read = stream
                .read(&mut buffer)
                .map_err(|_| api_error("The Mihomo control response timed out."))?;
            if read == 0 {
                break;
            }
            if response.len().saturating_add(read) > MAX_RESPONSE_BYTES {
                return Err(api_error("The Mihomo control response was too large."));
            }
            response.extend_from_slice(&buffer[..read]);
        }

        parse_http_json_response(&response)
    }

    fn endpoint_port(&self) -> Result<u16, RuntimeError> {
        self.endpoint
            .strip_prefix("http://127.0.0.1:")
            .and_then(|port| port.parse::<u16>().ok())
            .filter(|port| *port > 0)
            .ok_or_else(|| api_error("The local Mihomo control API endpoint is invalid."))
    }
}

fn parse_http_json_response(response: &[u8]) -> Result<Value, RuntimeError> {
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| api_error("The Mihomo control response was incomplete."))?;
    let headers = std::str::from_utf8(&response[..header_end])
        .map_err(|_| api_error("The Mihomo control response was invalid."))?;
    let mut header_lines = headers.split("\r\n");
    let status = header_lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .ok_or_else(|| api_error("The Mihomo control response status was invalid."))?;
    if !(200..300).contains(&status) {
        return Err(RuntimeError::new(
            RuntimeErrorCode::ApiUnavailable,
            format!("The Mihomo control API returned HTTP {status}."),
            status >= 500,
        ));
    }

    let chunked = header_lines.clone().any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding")
                && value.to_ascii_lowercase().contains("chunked")
        })
    });
    let content_length = header_lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("content-length")
            .then(|| value.trim().parse::<usize>().ok())
            .flatten()
    });
    let body = &response[header_end + 4..];
    let body = if chunked {
        decode_chunked(body)?
    } else if let Some(content_length) = content_length {
        body.get(..content_length)
            .ok_or_else(|| api_error("The Mihomo control response was truncated."))?
            .to_vec()
    } else {
        body.to_vec()
    };

    if body.is_empty() {
        return Ok(Value::Null);
    }

    serde_json::from_slice(&body)
        .map_err(|_| api_error("The Mihomo control response contained invalid JSON."))
}

fn decode_chunked(body: &[u8]) -> Result<Vec<u8>, RuntimeError> {
    let mut decoded = Vec::new();
    let mut cursor = 0;
    loop {
        let line_end = body[cursor..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .map(|offset| cursor + offset)
            .ok_or_else(|| api_error("The Mihomo chunked response was incomplete."))?;
        let size_text = std::str::from_utf8(&body[cursor..line_end])
            .map_err(|_| api_error("The Mihomo chunked response was invalid."))?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or(""), 16)
            .map_err(|_| api_error("The Mihomo chunked response was invalid."))?;
        cursor = line_end + 2;
        if size == 0 {
            return Ok(decoded);
        }
        let end = cursor
            .checked_add(size)
            .filter(|end| *end <= body.len())
            .ok_or_else(|| api_error("The Mihomo chunked response was truncated."))?;
        decoded.extend_from_slice(&body[cursor..end]);
        cursor = end
            .checked_add(2)
            .filter(|next| *next <= body.len())
            .ok_or_else(|| api_error("The Mihomo chunked response was truncated."))?;
    }
}

pub fn parse_proxy_groups(payload: &Value) -> Result<Vec<ProxyGroup>, RuntimeError> {
    let proxies = payload
        .get("proxies")
        .and_then(Value::as_object)
        .ok_or_else(|| api_error("The Mihomo proxy response was invalid."))?;
    let mut groups = Vec::new();

    for (name, data) in proxies {
        let Some(all) = data.get("all").and_then(Value::as_array) else {
            continue;
        };
        let node_names = all.iter().filter_map(Value::as_str).collect::<Vec<_>>();
        let nodes = node_names
            .iter()
            .map(|node_name| {
                let node_data = proxies.get(*node_name).unwrap_or(&Value::Null);
                parse_proxy_node(node_name, node_data)
            })
            .collect();
        groups.push(ProxyGroup {
            name: name.clone(),
            group_type: data
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("Selector")
                .to_owned(),
            selected: data
                .get("now")
                .and_then(Value::as_str)
                .or_else(|| node_names.first().copied())
                .unwrap_or_default()
                .to_owned(),
            nodes,
        });
    }

    Ok(groups)
}

fn parse_proxy_node(name: &str, data: &Value) -> ProxyNode {
    let delay_ms = data
        .get("history")
        .and_then(Value::as_array)
        .and_then(|history| history.last())
        .and_then(|entry| entry.get("delay"))
        .and_then(Value::as_u64)
        .and_then(|delay| u32::try_from(delay).ok())
        .filter(|delay| *delay > 0);
    ProxyNode {
        name: name.to_owned(),
        proxy_type: data
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("Unknown")
            .to_owned(),
        udp: data.get("udp").and_then(Value::as_bool).unwrap_or(false),
        delay_ms,
        alive: data.get("alive").and_then(Value::as_bool).unwrap_or(true),
    }
}

pub fn parse_rules(payload: &Value) -> Result<Vec<RuleItem>, RuntimeError> {
    let rules = payload
        .get("rules")
        .and_then(Value::as_array)
        .ok_or_else(|| api_error("The Mihomo rules response was invalid."))?;

    Ok(rules
        .iter()
        .enumerate()
        .map(|(index, rule)| RuleItem {
            index,
            rule_type: rule
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("Unknown")
                .to_owned(),
            payload: rule
                .get("payload")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            proxy: rule
                .get("proxy")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        })
        .collect())
}

pub fn parse_connections(payload: &Value) -> Result<ConnectionPage, RuntimeError> {
    let connections = match payload.get("connections") {
        Some(Value::Array(connections)) => connections.as_slice(),
        Some(Value::Null) => &[],
        _ => return Err(api_error("The Mihomo connections response was invalid.")),
    };
    let summaries = connections
        .iter()
        .filter_map(|connection| {
            let metadata = connection.get("metadata")?;
            let id = connection.get("id")?.as_str()?.to_owned();
            let destination_port = metadata
                .get("destinationPort")
                .and_then(Value::as_str)
                .and_then(|port| port.parse::<u16>().ok())
                .or_else(|| {
                    metadata
                        .get("destinationPort")
                        .and_then(Value::as_u64)
                        .and_then(|port| u16::try_from(port).ok())
                })
                .unwrap_or(0);
            Some(ConnectionSummary {
                id,
                host: metadata
                    .get("host")
                    .and_then(Value::as_str)
                    .filter(|host| !host.is_empty())
                    .unwrap_or("Unknown destination")
                    .to_owned(),
                destination_ip: metadata
                    .get("destinationIP")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                destination_port,
                network: metadata
                    .get("network")
                    .and_then(Value::as_str)
                    .unwrap_or("tcp")
                    .to_owned(),
                rule: connection
                    .get("rule")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                rule_payload: connection
                    .get("rulePayload")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                chains: connection
                    .get("chains")
                    .and_then(Value::as_array)
                    .map(|chains| {
                        chains
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default(),
                upload_bytes: connection
                    .get("upload")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                download_bytes: connection
                    .get("download")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                started_at_ms: connection
                    .get("start")
                    .and_then(parse_timestamp_value)
                    .unwrap_or(0),
            })
        })
        .collect();

    Ok(ConnectionPage {
        upload_total_bytes: payload
            .get("uploadTotal")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        download_total_bytes: payload
            .get("downloadTotal")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        memory_bytes: payload.get("memory").and_then(Value::as_u64).unwrap_or(0),
        connections: summaries,
    })
}

fn parse_timestamp_value(value: &Value) -> Option<i64> {
    if let Some(timestamp) = value.as_i64() {
        return Some(timestamp);
    }
    if let Some(timestamp) = value.as_u64() {
        return i64::try_from(timestamp).ok();
    }
    let value = value.as_str()?;
    if let Ok(timestamp) = value.parse::<i64>() {
        return Some(timestamp);
    }
    parse_rfc3339_ms(value)
}

fn parse_rfc3339_ms(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || !matches!(bytes.get(10), Some(b'T' | b't'))
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }

    let year = parse_digits(&bytes[0..4])? as i32;
    let month = parse_digits(&bytes[5..7])?;
    let day = parse_digits(&bytes[8..10])?;
    let hour = parse_digits(&bytes[11..13])?;
    let minute = parse_digits(&bytes[14..16])?;
    let second = parse_digits(&bytes[17..19])?;
    if !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }

    let mut cursor = 19;
    let mut millis = 0_i64;
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        let fraction_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == fraction_start || cursor - fraction_start > 9 {
            return None;
        }
        let mut fraction = bytes[fraction_start..cursor]
            .iter()
            .fold(0_i64, |value, byte| value * 10 + i64::from(byte - b'0'));
        for _ in 0..(3 - (cursor - fraction_start).min(3)) {
            fraction *= 10;
        }
        for _ in 0..(cursor - fraction_start).saturating_sub(3) {
            fraction /= 10;
        }
        millis = fraction;
    }

    let offset_seconds = match bytes.get(cursor).copied() {
        Some(b'Z' | b'z') if cursor + 1 == bytes.len() => 0_i64,
        Some(sign @ (b'+' | b'-')) if cursor + 6 == bytes.len() => {
            if bytes.get(cursor + 3) != Some(&b':') {
                return None;
            }
            let offset_hour = parse_digits(&bytes[cursor + 1..cursor + 3])? as i64;
            let offset_minute = parse_digits(&bytes[cursor + 4..cursor + 6])? as i64;
            if offset_hour > 23 || offset_minute > 59 {
                return None;
            }
            let offset = (offset_hour * 60 + offset_minute) * 60;
            if sign == b'+' {
                offset
            } else {
                -offset
            }
        }
        _ => return None,
    };

    let days = days_from_civil(year, month as i32, day as i32);
    let local_seconds = days
        .checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600)?
        .checked_add(i64::from(minute) * 60)?
        .checked_add(i64::from(second))?;
    local_seconds
        .checked_sub(offset_seconds)?
        .checked_mul(1_000)?
        .checked_add(millis)
}

fn parse_digits(bytes: &[u8]) -> Option<u32> {
    bytes.iter().try_fold(0_u32, |value, byte| {
        byte.is_ascii_digit()
            .then_some(value * 10 + u32::from(*byte - b'0'))
    })
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn days_from_civil(year: i32, month: i32, day: i32) -> i64 {
    let adjusted_year = year - i32::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    i64::from(era) * 146_097 + i64::from(day_of_era) - 719_468
}

fn validate_request_path(path: &str) -> Result<(), RuntimeError> {
    if !path.starts_with('/')
        || path.starts_with("//")
        || !path.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err(api_error("The Mihomo control request path is invalid."));
    }
    Ok(())
}

pub(crate) fn close_connection(
    client: &LoopbackApiClient,
    connection_id: &str,
) -> Result<(), RuntimeError> {
    client.request_json(
        "DELETE",
        &format!("/connections/{}", encode_path_segment(connection_id)),
        None,
    )?;
    Ok(())
}

/// Closes every open connection at once.
///
/// Mihomo treats `DELETE /connections` as "close all"; the response body is
/// empty on success.
pub(crate) fn close_all_connections(client: &LoopbackApiClient) -> Result<(), RuntimeError> {
    client.request_json("DELETE", "/connections", None)?;
    Ok(())
}

/// Reads the providers the active profile declares.
///
/// Mihomo answers `/providers/proxies` and `/providers/rules` with a map of
/// provider name to metadata. Only display fields are taken: the URL and the
/// refresh timer stay with Mihomo, which owns them at runtime.
pub(crate) fn read_providers(
    client: &LoopbackApiClient,
) -> Result<Vec<ProviderInfo>, RuntimeError> {
    let mut providers = Vec::new();
    for (path, kind) in [
        ("/providers/proxies", "proxy"),
        ("/providers/rules", "rule"),
    ] {
        let payload = client.get_json(path)?;
        let Some(map) = payload.get("providers").and_then(Value::as_object) else {
            continue;
        };
        for (name, data) in map {
            let proxy_count = data
                .get("proxies")
                .and_then(Value::as_array)
                .and_then(|proxies| u32::try_from(proxies.len()).ok());
            let entry_count = data
                .get("ruleCount")
                .and_then(Value::as_u64)
                .and_then(|count| u32::try_from(count).ok())
                .or_else(|| {
                    data.get("proxies")
                        .and_then(Value::as_array)
                        .and_then(|proxies| u32::try_from(proxies.len()).ok())
                });
            providers.push(ProviderInfo {
                name: name.clone(),
                kind: kind.to_owned(),
                vehicle_type: data
                    .get("vehicleType")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                entry_count,
                proxy_count,
            });
        }
    }
    providers.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(providers)
}

pub(crate) fn select_proxy(
    client: &LoopbackApiClient,
    group: &str,
    proxy: &str,
) -> Result<(), RuntimeError> {
    client.put_json(
        &format!("/proxies/{}", encode_path_segment(group)),
        &json!({ "name": proxy }),
    )?;
    Ok(())
}

pub(crate) fn test_delay(
    client: &LoopbackApiClient,
    proxy: &str,
    timeout_ms: u32,
    probe: &DelayProbeSettings,
) -> Result<u32, RuntimeError> {
    let payload = client.get_json(&format!(
        "/proxies/{}/delay?url={}&timeout={}",
        encode_path_segment(proxy),
        encode_query_value(probe.url.trim()),
        timeout_ms.clamp(MIN_DELAY_TIMEOUT_MS, MAX_DELAY_TIMEOUT_MS)
    ))?;
    payload
        .get("delay")
        .and_then(Value::as_u64)
        .and_then(|delay| u32::try_from(delay).ok())
        .ok_or_else(|| api_error("The Mihomo delay response was invalid."))
}

/// Probes every node in `group` with one request.
///
/// Mihomo answers `{"<node>": <delay>}` for the nodes that replied. The
/// response can be large: a group with many nodes still fits comfortably in
/// the client's response cap, and nodes that timed out are simply absent.
pub(crate) fn test_group_delay(
    client: &LoopbackApiClient,
    group: &str,
    timeout_ms: u32,
    probe: &DelayProbeSettings,
) -> Result<GroupDelayResult, RuntimeError> {
    let payload = client.get_json(&format!(
        "/group/{}/delay?url={}&timeout={}",
        encode_path_segment(group),
        encode_query_value(probe.url.trim()),
        timeout_ms.clamp(MIN_DELAY_TIMEOUT_MS, MAX_DELAY_TIMEOUT_MS)
    ))?;

    let entries = payload
        .as_object()
        .ok_or_else(|| api_error("The Mihomo group delay response was invalid."))?;

    let mut delays: Vec<DelaySample> = entries
        .iter()
        .filter_map(|(proxy, value)| {
            let delay = value.as_u64().and_then(|delay| u32::try_from(delay).ok())?;
            (delay > 0).then(|| DelaySample {
                proxy: proxy.clone(),
                delay_ms: delay,
            })
        })
        .collect();
    delays.sort_by(|left, right| left.proxy.cmp(&right.proxy));

    Ok(GroupDelayResult {
        group: group.to_owned(),
        delays,
    })
}

/// Reads the routing mode and log level the core is running with.
pub(crate) fn read_core_preferences(
    client: &LoopbackApiClient,
) -> Result<CorePreferences, RuntimeError> {
    let payload = client.get_json("/configs")?;
    Ok(CorePreferences {
        mode: payload
            .get("mode")
            .and_then(Value::as_str)
            .and_then(RoutingMode::parse),
        log_level: payload
            .get("log-level")
            .and_then(Value::as_str)
            .and_then(LogLevel::parse),
        ipv6: payload.get("ipv6").and_then(Value::as_bool),
    })
}

/// Applies routing mode and/or log level, then reports the values the core
/// actually holds.
///
/// Both keys are hot-reloadable in Mihomo, so no restart is involved. The
/// value is read back instead of echoing the request, which would hide a core
/// that silently rejected the change.
pub(crate) fn update_core_preferences(
    client: &LoopbackApiClient,
    mode: Option<RoutingMode>,
    log_level: Option<LogLevel>,
) -> Result<CorePreferences, RuntimeError> {
    if mode.is_none() && log_level.is_none() {
        return read_core_preferences(client);
    }

    let mut body = serde_json::Map::new();
    if let Some(mode) = mode {
        body.insert("mode".to_owned(), json!(mode.as_wire_value()));
    }
    if let Some(log_level) = log_level {
        body.insert("log-level".to_owned(), json!(log_level.as_wire_value()));
    }

    client.put_json("/configs", &Value::Object(body))?;
    read_core_preferences(client)
}

fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Percent-encodes a query value so a probe URL's own `?`/`&` cannot break out
/// of the `url=` parameter.
fn encode_query_value(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len() * 3);
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn api_error(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::ApiUnavailable, message, true)
}

#[cfg(test)]
mod tests {
    use super::{
        encode_path_segment, parse_connections, parse_http_json_response, validate_request_path,
    };
    use serde_json::json;

    #[test]
    fn path_segments_escape_untrusted_proxy_names() {
        assert_eq!(
            encode_path_segment("Tokyo / 01?#"),
            "Tokyo%20%2F%2001%3F%23"
        );
    }

    #[test]
    fn connection_payload_parses_string_and_numeric_ports() {
        let page = parse_connections(&json!({
            "uploadTotal": 5,
            "downloadTotal": 9,
            "memory": 11,
            "connections": [{
                "id": "a",
                "metadata": {
                    "host": "example.com",
                    "destinationIP": "203.0.113.2",
                    "destinationPort": "443",
                    "network": "tcp"
                },
                "upload": 1,
                "download": 2,
                "start": "1760000000000",
                "chains": ["DIRECT"],
                "rule": "MATCH",
                "rulePayload": ""
            }]
        }))
        .expect("parse connections");

        assert_eq!(page.connections[0].destination_port, 443);
        assert_eq!(page.connections[0].started_at_ms, 1_760_000_000_000);
    }

    #[test]
    fn empty_connection_list_accepts_null_from_mihomo() {
        let page = parse_connections(&json!({
            "downloadTotal": 12,
            "uploadTotal": 7,
            "connections": null,
            "memory": 16
        }))
        .expect("parse empty connections");

        assert_eq!(page.upload_total_bytes, 7);
        assert_eq!(page.download_total_bytes, 12);
        assert_eq!(page.memory_bytes, 16);
        assert!(page.connections.is_empty());
    }

    #[test]
    fn connection_timestamps_accept_numbers_and_rfc3339() {
        let page = parse_connections(&json!({
            "connections": [
                {
                    "id": "numeric",
                    "metadata": {"destinationPort": 443},
                    "start": 1_760_000_000_123_i64
                },
                {
                    "id": "rfc3339",
                    "metadata": {"destinationPort": 443},
                    "start": "2025-10-09T07:33:20.123Z"
                },
                {
                    "id": "offset",
                    "metadata": {"destinationPort": 443},
                    "start": "2025-10-09T15:33:20.123+08:00"
                }
            ]
        }))
        .expect("parse timestamp variants");

        assert_eq!(page.connections[0].started_at_ms, 1_760_000_000_123);
        assert_eq!(page.connections[1].started_at_ms, 1_759_995_200_123);
        assert_eq!(page.connections[2].started_at_ms, 1_759_995_200_123);
    }

    #[test]
    fn empty_successful_response_is_valid_for_delete_operations() {
        let response = b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        assert_eq!(
            parse_http_json_response(response).expect("parse empty response"),
            serde_json::Value::Null
        );
    }

    #[test]
    fn request_paths_reject_header_injection_and_absolute_urls() {
        assert!(validate_request_path("/connections/a%20b").is_ok());
        for invalid in ["connections", "//127.0.0.1/", "/version\r\nX-Test: true"] {
            assert!(
                validate_request_path(invalid).is_err(),
                "{invalid:?} must be rejected"
            );
        }
    }
}
