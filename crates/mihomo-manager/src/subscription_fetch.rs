//! Downloads subscription documents from operator-supplied URLs.
//!
//! The Runtime only ever talks to loopback otherwise; this module is the single
//! place that makes an outbound request. It is deliberately narrow: two
//! schemes, a hard size cap, a hard timeout and no redirect into a different
//! scheme. Subscription URLs usually embed credentials, so nothing in here
//! writes the URL into a log or an error message.

use crate::subscription::{preflight, MAX_SUBSCRIPTION_BYTES};
use flowproxy_contracts::{RuntimeError, RuntimeErrorCode};
use std::io::Read;
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: usize = 5;
const USER_AGENT: &str = concat!("FlowProxy/", env!("CARGO_PKG_VERSION"));

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
    validate_url(url)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(REQUEST_TIMEOUT)
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
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| invalid(format!("The download client could not start: {}", redact(&error.to_string()))))?;

    let mut response = client
        .get(url)
        .send()
        .map_err(|error| {
            invalid(format!(
                "The subscription could not be downloaded: {}",
                describe_request_error(&error)
            ))
        })?;

    if !response.status().is_success() {
        return Err(invalid(format!(
            "The subscription server returned HTTP {}.",
            response.status().as_u16()
        )));
    }

    if let Some(length) = response.content_length() {
        if length > MAX_SUBSCRIPTION_BYTES as u64 {
            return Err(invalid(format!(
                "The subscription is larger than the {} MiB limit.",
                MAX_SUBSCRIPTION_BYTES / (1024 * 1024)
            )));
        }
    }

    let mut body = Vec::new();
    let mut buffer = [0_u8; 32 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(|error| {
            invalid(format!(
                "The subscription download failed while reading: {}",
                redact(&error.to_string())
            ))
        })?;
        if read == 0 {
            break;
        }
        if body.len() + read > MAX_SUBSCRIPTION_BYTES {
            return Err(invalid(format!(
                "The subscription is larger than the {} MiB limit.",
                MAX_SUBSCRIPTION_BYTES / (1024 * 1024)
            )));
        }
        body.extend_from_slice(&buffer[..read]);
    }

    let text = String::from_utf8(body)
        .map_err(|_| invalid("The subscription is not valid UTF-8 text."))?;
    preflight(&text)?;
    Ok(text)
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
    use super::validate_url;

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
