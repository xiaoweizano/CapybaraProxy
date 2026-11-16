use regex::Regex;
use std::sync::OnceLock;

static URL_USERINFO_PATTERN: OnceLock<Regex> = OnceLock::new();

static SECRET_ASSIGNMENT_PATTERN: OnceLock<Regex> = OnceLock::new();

fn url_userinfo_pattern() -> &'static Regex {
    URL_USERINFO_PATTERN.get_or_init(|| {
        Regex::new(r"(?i)(?P<scheme>https?|socks5h?|socks4a?)://[^/\s:@]+:[^/\s@]+@")
            .expect("valid URL userinfo redaction regex")
    })
}

fn secret_assignment_pattern() -> &'static Regex {
    SECRET_ASSIGNMENT_PATTERN.get_or_init(|| {
        Regex::new(
            r#"(?i)\b(?P<key>(?:[a-z0-9]+[_-])*(?:token|secret|password|authorization|api[_-]?key))(?P<key_quote>"?)\s*(?P<separator>[:=])\s*(?:"[^"]*"|'[^']*'|(?:bearer|basic)\s+[^\s,;]+|[^\s,;]+)"#,
        )
        .expect("valid secret assignment redaction regex")
    })
}

pub(crate) fn redact_sensitive_text(input: &str) -> String {
    let without_userinfo = url_userinfo_pattern().replace_all(input, "${scheme}://[REDACTED]@");

    secret_assignment_pattern()
        .replace_all(
            &without_userinfo,
            "${key}${key_quote}${separator}[REDACTED]",
        )
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::redact_sensitive_text;

    #[test]
    fn redacts_common_secret_assignments() {
        let input = "token=abc123 secret: xyz password = \"open sesame\" Authorization: Bearer bearer-token";
        let output = redact_sensitive_text(input);

        for secret in ["abc123", "xyz", "open sesame", "bearer-token"] {
            assert!(
                !output.contains(secret),
                "secret {secret:?} remained in {output:?}"
            );
        }
    }

    #[test]
    fn redacts_quoted_json_secret_fields() {
        let input = r#"{"secret":"json-secret","password": "json-password","Authorization":"Bearer json-token"}"#;
        let output = redact_sensitive_text(input);

        for secret in ["json-secret", "json-password", "json-token"] {
            assert!(
                !output.contains(secret),
                "secret {secret:?} remained in {output:?}"
            );
        }
    }

    #[test]
    fn redacts_compound_secret_keys() {
        let input =
            r#"access_token=access-value api_key: api-value {"client_secret":"client-value"}"#;
        let output = redact_sensitive_text(input);

        for secret in ["access-value", "api-value", "client-value"] {
            assert!(
                !output.contains(secret),
                "secret {secret:?} remained in {output:?}"
            );
        }
    }

    #[test]
    fn redacts_url_userinfo_but_preserves_host_and_path() {
        let output = redact_sensitive_text(
            "subscription: https://alice:top-secret@example.com/api?token=abc123",
        );

        assert!(!output.contains("alice"));
        assert!(!output.contains("top-secret"));
        assert!(!output.contains("abc123"));
        assert!(output.contains("example.com/api"));
    }

    #[test]
    fn leaves_non_sensitive_log_text_unchanged() {
        let input = "Runtime reached running_disconnected after 1 request.";
        assert_eq!(redact_sensitive_text(input), input);
    }
}
