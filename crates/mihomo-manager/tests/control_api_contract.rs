use flowproxy_mihomo_manager::{parse_proxy_groups, parse_rules, LoopbackApiClient};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

#[test]
fn loopback_client_adds_bearer_auth_and_parses_json() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture API");
    let port = listener.local_addr().expect("fixture address").port();
    let (request_tx, request_rx) = mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept fixture request");
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("request timeout");
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
        let body = r#"{"version":"1.19.33","meta":true}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("write fixture response");
    });
    let client = LoopbackApiClient::new(
        &format!("http://127.0.0.1:{port}"),
        "0123456789abcdef0123456789abcdef",
    )
    .expect("create loopback client");

    let response = client.get_json("/version").expect("read fixture API");

    assert_eq!(response["version"], "1.19.33");
    let request = request_rx.recv().expect("capture request");
    assert!(request.starts_with("GET /version HTTP/1.1\r\n"));
    assert!(request.contains("Authorization: Bearer 0123456789abcdef0123456789abcdef\r\n"));
    server.join().expect("join fixture server");
}

#[test]
fn proxy_and_rule_payloads_are_converted_to_typed_contracts() {
    let groups = parse_proxy_groups(&json!({
        "proxies": {
            "DIRECT": {
                "type": "Direct",
                "udp": true,
                "alive": true,
                "history": []
            },
            "FlowProxy Direct": {
                "type": "Selector",
                "now": "DIRECT",
                "all": ["DIRECT"]
            }
        }
    }))
    .expect("parse proxy groups");
    let rules = parse_rules(&json!({
        "rules": [
            {"type": "MATCH", "payload": "", "proxy": "FlowProxy Direct"}
        ]
    }))
    .expect("parse rules");

    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].name, "FlowProxy Direct");
    assert_eq!(groups[0].selected, "DIRECT");
    assert_eq!(groups[0].nodes[0].delay_ms, None);
    assert_eq!(rules[0].index, 0);
    assert_eq!(rules[0].rule_type, "MATCH");
}
