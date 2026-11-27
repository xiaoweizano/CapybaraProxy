//! Downloads subscription documents from operator-supplied URLs.
//!
//! The Runtime only ever talks to loopback otherwise; this module is the single
//! place that makes an outbound request. It is deliberately narrow: two
//! schemes, a hard size cap, a hard timeout and no redirect into a different
//! scheme. Subscription URLs usually embed credentials, so nothing in here
//! writes the URL into a log or an error message.

use crate::subscription::{preflight, MAX_SUBSCRIPTION_BYTES};
use crate::subscription_convert;
use crate::system_proxy;
use capybara_contracts::{RuntimeError, RuntimeErrorCode, SubscriptionUsage};
use std::io::Read;
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// A direct retry after a failed system-proxy attempt should not stack a full
/// request timeout on top of the first wait.
const DIRECT_RETRY_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REDIRECTS: usize = 5;
/// Providers decide the response format from the client name. A Clash
/// identifier is required to get a YAML profile; anything else is served the
/// base64 share-link list that phone clients consume.
pub const DEFAULT_USER_AGENT: &str =
    concat!("clash.meta/", env!("CARGO_PKG_VERSION"), " (CapybaraProxy)");
/// Longest operator-supplied User-Agent accepted in settings.
const MAX_USER_AGENT_CHARS: usize = 512;

/// Validates a subscription URL without revealing it in the error message.
pub fn validate_url(url: &str) -> Result<(), RuntimeError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(invalid("The subscription URL is empty."));
    }
    if trimmed.len() > 2048 {
        return Err(invalid("The subscription URL is too long."));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(invalid("The subscription URL contains invalid characters."));
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err(invalid(
            "The subscription URL must start with https:// or http://.",
        ));
    }
    Ok(())
}

/// Fetches a subscription document and returns its body.
///
/// Errors never contain the URL. Operators get a stable message and can check
/// the address themselves.
pub fn fetch(url: &str) -> Result<String, RuntimeError> {
    fetch_with_user_agent(url, None).map(|(document, _)| document)
}

/// Same as [`fetch`], plus the usage numbers from the response header.
///
/// `user_agent` overrides the built-in Clash identifier; an empty or invalid
/// value falls back to [`DEFAULT_USER_AGENT`] instead of failing the import.
pub fn fetch_with_user_agent(
    url: &str,
    user_agent: Option<&str>,
) -> Result<(String, SubscriptionUsage), RuntimeError> {
    let (response, _) = send_request_with(url, &[], user_agent)?;
    let usage = parse_subscription_userinfo(
        response
            .headers()
            .get("subscription-userinfo")
            .and_then(|value| value.to_str().ok()),
    );
    let document = read_subscription_body(response)?;
    Ok((document, usage))
}

/// Fetches a document that is *not* a subscription, such as a Sub-Store API
/// response.
///
/// Shares the transport policy with [`fetch`] — scheme check, system-proxy
/// hint, short direct retry, redirect rules, header support — but leaves the
/// body untouched: no Clash normalisation, no `proxies:` requirement.
pub fn fetch_text(
    url: &str,
    headers: &[(&str, &str)],
    max_bytes: usize,
) -> Result<String, RuntimeError> {
    let (response, _) = send_request_with(url, headers, None)?;
    read_body(response, max_bytes)
}

fn send_request_with(
    url: &str,
    headers: &[(&str, &str)],
    user_agent: Option<&str>,
) -> Result<(reqwest::blocking::Response, bool), RuntimeError> {
    validate_url(url)?;
    let user_agent = normalize_user_agent(user_agent);

    // Subscription hosts are usually only reachable through the proxy client
    // the operator already runs, so the system proxy is consulted before the
    // first attempt. It is a hint, not a requirement: an unparsable setting
    // falls back to reqwest's own configuration.
    let proxy = system_proxy::proxy_url_for(url);
    let client = build_client(proxy.as_deref(), user_agent)?;

    let mut request = client.get(url);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }

    let response = match request.send() {
        Ok(response) => response,
        Err(error) if proxy.is_some() && is_transport_error(&error) => {
            // A proxy client can exit without clearing the system proxy. One
            // short direct attempt keeps the import working in that case.
            let mut retry = build_direct_client(user_agent)?.get(url);
            for (name, value) in headers {
                retry = retry.header(*name, *value);
            }
            retry.send().map_err(|error| {
                invalid(format!(
                    "The download failed: {} (tried the system proxy and a direct connection)",
                    describe_request_error(&error)
                ))
            })?
        }
        Err(error) => {
            return Err(invalid(format!(
                "The download failed: {}",
                describe_request_error(&error)
            )))
        }
    };

    if !response.status().is_success() {
        return Err(invalid(format!(
            "The server returned HTTP {}.",
            response.status().as_u16()
        )));
    }

    Ok((response, proxy.is_some()))
}

fn read_subscription_body(response: reqwest::blocking::Response) -> Result<String, RuntimeError> {
    let text = read_body(response, MAX_SUBSCRIPTION_BYTES)?;
    // Providers answer a non-Clash client with a base64 share-link list. The
    // conversion only rewrites text that is not already a Clash document, so a
    // normal profile passes through untouched.
    let text = subscription_convert::normalize(&text);
    preflight(&text)?;
    Ok(text)
}

fn read_body(
    mut response: reqwest::blocking::Response,
    max_bytes: usize,
) -> Result<String, RuntimeError> {
    if let Some(length) = response.content_length() {
        if length > max_bytes as u64 {
            return Err(too_large(max_bytes));
        }
    }

    let mut body = Vec::new();
    let mut buffer = [0_u8; 32 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(|error| {
            invalid(format!(
                "The download failed while reading: {}",
                redact(&error.to_string())
            ))
        })?;
        if read == 0 {
            break;
        }
        if body.len() + read > max_bytes {
            return Err(too_large(max_bytes));
        }
        body.extend_from_slice(&buffer[..read]);
    }

    String::from_utf8(body).map_err(|_| invalid("The response is not valid UTF-8 text."))
}

fn too_large(max_bytes: usize) -> RuntimeError {
    invalid(format!(
        "The response is larger than the {} MiB limit.",
        max_bytes / (1024 * 1024)
    ))
}

fn build_client(
    proxy: Option<&str>,
    user_agent: &str,
) -> Result<reqwest::blocking::Client, RuntimeError> {
    let mut builder = client_builder(REQUEST_TIMEOUT, user_agent);

    // An unusable proxy entry is ignored rather than turned into an import
    // error: the request can still succeed directly. Without a system proxy
    // reqwest stays on its default behaviour, which includes the
    // `HTTP_PROXY`/`HTTPS_PROXY` environment variables.
    if let Some(proxy) = proxy.and_then(|proxy| reqwest::Proxy::all(proxy).ok()) {
        builder = builder.proxy(proxy);
    }

    builder.build().map_err(client_start_error)
}

fn build_direct_client(user_agent: &str) -> Result<reqwest::blocking::Client, RuntimeError> {
    client_builder(DIRECT_RETRY_TIMEOUT, user_agent)
        .no_proxy()
        .build()
        .map_err(client_start_error)
}

/// Returns the configured User-Agent when it is a single printable header
/// value, otherwise the built-in Clash identifier.
fn normalize_user_agent(candidate: Option<&str>) -> &str {
    match candidate.map(str::trim) {
        Some(value)
            if !value.is_empty()
                && value.len() <= MAX_USER_AGENT_CHARS
                && !value.chars().any(|character| character.is_control()) =>
        {
            value
        }
        _ => DEFAULT_USER_AGENT,
    }
}

/// Parses a `subscription-userinfo` header.
///
/// The header is a `key=value; key=value` list sent by Clash-compatible
/// providers: `upload`, `download`, `total` in bytes and `expire` in epoch
/// seconds. Anything unparsable is skipped, so a provider that only reports
/// some fields still shows what it did report.
pub fn parse_subscription_userinfo(header: Option<&str>) -> SubscriptionUsage {
    let Some(header) = header else {
        return SubscriptionUsage::default();
    };

    let mut usage = SubscriptionUsage::default();
    for entry in header.split(';') {
        let Some((key, value)) = entry.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim().trim_matches('"');
        match key.as_str() {
            "upload" => usage.upload_bytes = value.parse::<u64>().ok(),
            "download" => usage.download_bytes = value.parse::<u64>().ok(),
            "total" => usage.total_bytes = value.parse::<u64>().ok(),
            "expire" => {
                usage.expire_at_ms = value
                    .parse::<i64>()
                    .ok()
                    .filter(|seconds| *seconds > 0)
                    // Providers send seconds; the UI formats milliseconds.
                    .and_then(|seconds| seconds.checked_mul(1_000))
            }
            _ => {}
        }
    }
    usage
}

fn client_builder(timeout: Duration, user_agent: &str) -> reqwest::blocking::ClientBuilder {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            // Keep the redirect chain short and refuse cross-scheme hops, so
            // an `https://` subscription cannot be bounced to plain HTTP.
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error(RedirectAbort::TooMany);
            }
            let previous_https = attempt
                .previous()
                .last()
                .is_some_and(|url| url.scheme() == "https");
            if previous_https && attempt.url().scheme() != "https" {
                return attempt.error(RedirectAbort::DownGrade);
            }
            attempt.follow()
        }))
        .user_agent(user_agent)
}

fn client_start_error(error: reqwest::Error) -> RuntimeError {
    invalid(format!(
        "The download client could not start: {}",
        redact(&error.to_string())
    ))
}

fn is_transport_error(error: &reqwest::Error) -> bool {
    error.is_connect() || error.is_timeout()
}

#[derive(Debug)]
enum RedirectAbort {
    TooMany,
    DownGrade,
}

impl std::fmt::Display for RedirectAbort {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooMany => formatter.write_str("too many redirects"),
            Self::DownGrade => formatter.write_str("redirect would downgrade to plain HTTP"),
        }
    }
}

impl std::error::Error for RedirectAbort {}

fn describe_request_error(error: &reqwest::Error) -> String {
    // reqwest's Display includes the full URL, which may carry a token. Only
    // the classification and the underlying source are reported.
    if error.is_timeout() {
        return "the request timed out".to_owned();
    }
    if error.is_connect() {
        return "the connection could not be established".to_owned();
    }
    if error.is_decode() {
        return "the response could not be decoded".to_owned();
    }
    if error.is_redirect() {
        return "the redirect was rejected".to_owned();
    }

    let mut source = std::error::Error::source(error);
    while let Some(inner) = source {
        let message = inner.to_string();
        if !message.is_empty() && !message.contains("://") {
            return redact(&message);
        }
        source = inner.source();
    }
    "the request failed".to_owned()
}

/// Strips anything that looks like a URL from a message.
fn redact(message: &str) -> String {
    if message.contains("://") {
        "the request failed".to_owned()
    } else {
        message.to_owned()
    }
}

fn invalid(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::SubscriptionInvalid, message, true)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_user_agent, parse_subscription_userinfo, validate_url, DEFAULT_USER_AGENT,
    };

    #[test]
    fn parses_subscription_userinfo() {
        let usage = parse_subscription_userinfo(Some(
            "upload=1024; download=2048; total=10737418240; expire=1767225600",
        ));

        assert_eq!(usage.upload_bytes, Some(1_024));
        assert_eq!(usage.download_bytes, Some(2_048));
        assert_eq!(usage.total_bytes, Some(10 * 1024 * 1024 * 1024));
        assert_eq!(usage.expire_at_ms, Some(1_767_225_600_000));
    }

    #[test]
    fn userinfo_tolerates_spacing_quotes_and_missing_fields() {
        let usage = parse_subscription_userinfo(Some(" download=\"12\" ; total=0 "));

        assert_eq!(usage.upload_bytes, None);
        assert_eq!(usage.download_bytes, Some(12));
        assert_eq!(usage.total_bytes, Some(0));
        assert_eq!(usage.expire_at_ms, None);
    }

    #[test]
    fn userinfo_ignores_garbage_and_absent_header() {
        assert!(parse_subscription_userinfo(None).is_empty());
        assert!(parse_subscription_userinfo(Some("nonsense")).is_empty());
        assert!(parse_subscription_userinfo(Some("upload=abc; expire=0")).is_empty());
    }

    #[test]
    fn user_agent_falls_back_when_the_override_is_unusable() {
        assert_eq!(normalize_user_agent(None), DEFAULT_USER_AGENT);
        assert_eq!(normalize_user_agent(Some("   ")), DEFAULT_USER_AGENT);
        assert_eq!(
            normalize_user_agent(Some("clash\r\nX: 1")),
            DEFAULT_USER_AGENT
        );
        assert_eq!(
            normalize_user_agent(Some(" ClashParty/1.0 ")),
            "ClashParty/1.0"
        );
    }

    #[test]
    fn accepts_http_and_https() {
        assert!(validate_url("https://example.com/sub?token=abc").is_ok());
        assert!(validate_url("http://127.0.0.1:8080/sub").is_ok());
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("ftp://example.com/sub").is_err());
        assert!(validate_url("gopher://example.com").is_err());
    }

    #[test]
    fn rejects_empty_and_control_characters() {
        assert!(validate_url("   ").is_err());
        assert!(validate_url("https://example.com/\nsub").is_err());
        assert!(validate_url("https://example.com/\u{0}").is_err());
    }

    #[test]
    fn rejects_overlong_urls() {
        let long = format!("https://example.com/{}", "a".repeat(2100));
        assert!(validate_url(&long).is_err());
    }
}
