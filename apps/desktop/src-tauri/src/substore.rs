//! Sub-Store backend integration.
//!
//! CapybaraProxy does not bundle a conversion engine; when the operator already runs
//! [Sub-Store](https://github.com/sub-store-org/Sub-Store) the settings page can
//! list its subscriptions and import one directly.
//!
//! Only two requests are made: `GET /api/subs` to list, and the subscription's
//! own `url` (fetched by the normal import path) to download. The backend token
//! is sent as `x-api-token` and never appears in an error message or a log.

use crate::settings::is_valid_substore_url;
use capybara_contracts::{RuntimeError, RuntimeErrorCode};
use capybara_mihomo_manager::subscription_fetch;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A Sub-Store server answers with a small JSON document; 4 MiB is generous.
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
/// Bound on the number of listed subscriptions, so a hostile backend cannot
/// make the settings page render an unbounded list.
const MAX_SUBSCRIPTIONS: usize = 500;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SubStoreSubscription {
    /// Display name shown in the settings page.
    pub name: String,
    /// Download URL the normal subscription import path can use.
    pub url: String,
}

/// Lists the subscriptions stored on a Sub-Store backend.
pub(crate) fn list(base_url: &str, token: &str) -> Result<Vec<SubStoreSubscription>, RuntimeError> {
    let base_url = base_url.trim();
    if !is_valid_substore_url(base_url) {
        return Err(invalid(
            "The Sub-Store address must be an http:// or https:// base URL without a path.",
        ));
    }
    if token.chars().any(char::is_control) {
        return Err(invalid("The Sub-Store token contains invalid characters."));
    }

    let endpoint = format!("{}/api/subs", base_url.trim_end_matches('/'));
    let headers: Vec<(&str, &str)> = if token.is_empty() {
        Vec::new()
    } else {
        vec![("x-api-token", token)]
    };

    let body = subscription_fetch::fetch_text(&endpoint, &headers, MAX_RESPONSE_BYTES)
        .map_err(|error| invalid(error.message))?;

    parse_subscriptions(&body)
}

/// Parses `GET /api/subs`.
///
/// Sub-Store returns `{ "data": [ … ] }` in recent versions and a bare array in
/// older ones; both are accepted. Field names also drifted (`name` /
/// `displayName`), so every field is read leniently and an entry without a
/// usable URL is skipped rather than failing the whole list.
pub(crate) fn parse_subscriptions(body: &str) -> Result<Vec<SubStoreSubscription>, RuntimeError> {
    let parsed: Value = serde_json::from_str(body)
        .map_err(|_| invalid("The Sub-Store response is not valid JSON."))?;

    let entries = match parsed {
        Value::Array(entries) => entries,
        Value::Object(mut object) => match object.remove("data") {
            Some(Value::Array(entries)) => entries,
            // An auth failure can come back as `{ "status": "failed", … }`.
            _ => {
                return Err(invalid(
                    "The Sub-Store response did not contain a subscription list.",
                ))
            }
        },
        _ => {
            return Err(invalid(
                "The Sub-Store response did not contain a subscription list.",
            ))
        }
    };

    let mut subscriptions = Vec::new();
    for entry in entries.into_iter().take(MAX_SUBSCRIPTIONS) {
        let Value::Object(fields) = entry else {
            continue;
        };
        let url = string_field(&fields, &["url", "subUrl"]);
        let Some(url) = url else {
            continue;
        };
        let name = string_field(&fields, &["displayName", "name", "remark"])
            .unwrap_or_else(|| "Sub-Store subscription".to_owned());
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            continue;
        }
        subscriptions.push(SubStoreSubscription { name, url });
    }

    Ok(subscriptions)
}

fn string_field(fields: &serde_json::Map<String, Value>, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(Value::String(value)) = fields.get(*name) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_owned());
            }
        }
    }
    None
}

fn invalid(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(RuntimeErrorCode::SubscriptionInvalid, message, false)
}

#[cfg(test)]
mod tests {
    use super::{list, parse_subscriptions};

    #[test]
    fn parses_the_wrapped_data_shape() {
        let body = r#"{"data":[
            {"name":"Airport","url":"https://example.com/a"},
            {"displayName":"Backup","url":"https://example.com/b"}
        ]}"#;

        let subscriptions = parse_subscriptions(body).expect("parse data shape");

        assert_eq!(subscriptions.len(), 2);
        assert_eq!(subscriptions[0].name, "Airport");
        assert_eq!(subscriptions[1].name, "Backup");
    }

    #[test]
    fn parses_a_bare_array_and_skips_unusable_entries() {
        let body = r#"[
            {"name":"","url":"https://example.com/a"},
            {"name":"No URL"},
            {"name":"File","url":"file:///etc/passwd"},
            {"name":"Good","url":"https://example.com/b"}
        ]"#;

        let subscriptions = parse_subscriptions(body).expect("parse bare array");

        assert_eq!(
            subscriptions,
            vec![
                super::SubStoreSubscription {
                    name: "Sub-Store subscription".to_owned(),
                    url: "https://example.com/a".to_owned(),
                },
                super::SubStoreSubscription {
                    name: "Good".to_owned(),
                    url: "https://example.com/b".to_owned(),
                }
            ]
        );
    }

    #[test]
    fn reports_a_clear_error_for_unexpected_responses() {
        assert!(parse_subscriptions("not json").is_err());
        assert!(parse_subscriptions(r#"{"status":"failed"}"#).is_err());
        assert!(parse_subscriptions("null").is_err());
    }

    #[test]
    fn rejects_addresses_that_are_not_a_base_url() {
        assert!(list("", "token").is_err());
        assert!(list("https://example.com/prefix", "token").is_err());
        assert!(list("ftp://example.com", "token").is_err());
    }
}
