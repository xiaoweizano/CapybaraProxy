//! End-to-end check of the download path against a loopback fixture server.
//!
//! The fixture answers with a base64 share-link list the way a provider serves a
//! non-Clash client, which is the shape that used to fail the import. The proxy
//! lookup must stay out of the way for a loopback address, so no test here
//! depends on the machine's proxy configuration.

use capybara_mihomo_manager::subscription_fetch;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;

fn serve_once(body: &str) -> (u16, mpsc::Receiver<String>, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture subscription server");
    let port = listener.local_addr().expect("fixture address").port();
    let body = body.to_owned();
    let (request_tx, request_rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept fixture request");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut buffer).expect("read request");
            if read == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..read]);
        }
        request_tx
            .send(String::from_utf8_lossy(&request).into_owned())
            .expect("publish request");
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write fixture response");
    });
    (port, request_rx, handle)
}

#[test]
fn downloads_and_converts_a_base64_link_list() {
    let links = "\
ss://YWVzLTI1Ni1nY206c2VjcmV0@203.0.113.7:8388#Tokyo%2001
trojan://pass@example.com:443?sni=example.com#Trojan";
    let encoded = {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine as _;
        STANDARD.encode(links)
    };
    let (port, request_rx, handle) = serve_once(&encoded);

    let document = subscription_fetch::fetch(&format!("http://127.0.0.1:{port}/sub"))
        .expect("download should succeed");

    handle.join().expect("fixture server");
    let request = request_rx.recv().expect("capture request");
    assert!(
        request
            .to_ascii_lowercase()
            .contains("user-agent: clash.meta/"),
        "the provider must see a Clash client: {request}"
    );

    assert!(document.contains("proxies:"), "{document}");
    assert!(document.contains("name: \"Tokyo 01\""), "{document}");
    assert!(document.contains("type: trojan"), "{document}");
    assert!(document.contains("MATCH,Proxy"), "{document}");
}

#[test]
fn a_clash_yaml_response_is_returned_verbatim() {
    let yaml = "proxies:\n  - name: Original\n    type: ss\n    server: 203.0.113.7\n    port: 8388\n    cipher: aes-256-gcm\n    password: pw\n";
    let (port, _request_rx, handle) = serve_once(yaml);

    let document = subscription_fetch::fetch(&format!("http://127.0.0.1:{port}/sub"))
        .expect("download should succeed");

    handle.join().expect("fixture server");
    assert_eq!(document, yaml);
}

#[test]
fn an_unsupported_body_reports_the_expected_format() {
    let (port, _request_rx, handle) = serve_once("<html><body>login required</body></html>");

    let error = subscription_fetch::fetch(&format!("http://127.0.0.1:{port}/sub"))
        .expect_err("an HTML page is not a subscription");

    handle.join().expect("fixture server");
    assert!(error.message.contains("no proxies"), "{}", error.message);
    assert!(error.message.contains("share links"), "{}", error.message);
}

#[test]
fn plain_text_downloads_carry_headers_and_skip_clash_normalisation() {
    let body = r#"{"data":[{"name":"Airport","url":"https://example.com/sub"}]}"#;
    let (port, request_rx, handle) = serve_once(body);

    let text = subscription_fetch::fetch_text(
        &format!("http://127.0.0.1:{port}/api/subs"),
        &[("x-api-token", "token-value")],
        1024 * 1024,
    )
    .expect("plain download should succeed");

    handle.join().expect("fixture server");
    let request = request_rx.recv().expect("capture request");
    assert!(request.starts_with("GET /api/subs "));
    assert!(request
        .to_ascii_lowercase()
        .contains("x-api-token: token-value"));
    assert_eq!(text, body);
}

#[test]
fn plain_text_downloads_enforce_the_size_cap() {
    let body = "x".repeat(4096);
    let (port, _request_rx, handle) = serve_once(&body);

    let error =
        subscription_fetch::fetch_text(&format!("http://127.0.0.1:{port}/api/subs"), &[], 1024)
            .expect_err("oversized response must be rejected");

    handle.join().expect("fixture server");
    assert!(error.message.contains("MiB"));
}
