#![cfg(windows)]

use flowproxy_platform::{
    PlatformErrorKind, ProxyBackend, ProxySettings, RegistryValueKind, TestProxyRegistry,
    TestWinInetNotifier, WindowsProxyBackend, WINDOWS_INTERNET_SETTINGS_KEY,
    WINDOWS_PROXY_ENABLE_VALUE, WINDOWS_PROXY_SERVER_VALUE,
};

fn backend(
    registry: &TestProxyRegistry,
) -> WindowsProxyBackend<TestProxyRegistry, TestWinInetNotifier> {
    WindowsProxyBackend::new(registry.clone(), TestWinInetNotifier::default())
}

#[test]
fn windows_proxy_backend_reads_present_values_with_their_wire_types() {
    let registry = TestProxyRegistry::default();
    registry.set_dword(WINDOWS_INTERNET_SETTINGS_KEY, WINDOWS_PROXY_ENABLE_VALUE, 0);
    registry.set_string(
        WINDOWS_INTERNET_SETTINGS_KEY,
        WINDOWS_PROXY_SERVER_VALUE,
        "192.168.1.2:7890",
    );
    let mut backend = backend(&registry);

    assert_eq!(
        backend.read().expect("read proxy settings"),
        ProxySettings {
            enabled: Some(false),
            server: Some("192.168.1.2:7890".to_owned()),
        }
    );
}

#[test]
fn windows_proxy_backend_rejects_proxy_enable_with_the_wrong_registry_type() {
    let registry = TestProxyRegistry::default();
    registry.set_string(
        WINDOWS_INTERNET_SETTINGS_KEY,
        WINDOWS_PROXY_ENABLE_VALUE,
        "1",
    );
    registry.set_string(
        WINDOWS_INTERNET_SETTINGS_KEY,
        WINDOWS_PROXY_SERVER_VALUE,
        "192.168.1.2:7890",
    );
    let mut backend = backend(&registry);

    let error = backend
        .read()
        .expect_err("wrong ProxyEnable type must be rejected");

    assert_eq!(error.kind, PlatformErrorKind::BackendFailure);
    assert_eq!(
        registry.kind_of(WINDOWS_INTERNET_SETTINGS_KEY, WINDOWS_PROXY_ENABLE_VALUE),
        Some(RegistryValueKind::String)
    );
}

#[test]
fn windows_proxy_backend_writes_dword_and_string_values_then_refreshes_winecraft() {
    let registry = TestProxyRegistry::default();
    let notifier = TestWinInetNotifier::default();
    let mut backend = WindowsProxyBackend::new(registry.clone(), notifier.clone());

    backend
        .write_enabled(Some(true))
        .expect("write ProxyEnable");
    backend
        .write_server(Some("127.0.0.1:49153"))
        .expect("write ProxyServer");
    backend.refresh().expect("refresh WinINet");

    assert_eq!(
        registry.get_dword(WINDOWS_INTERNET_SETTINGS_KEY, WINDOWS_PROXY_ENABLE_VALUE),
        Some(1)
    );
    assert_eq!(
        registry
            .get_string(WINDOWS_INTERNET_SETTINGS_KEY, WINDOWS_PROXY_SERVER_VALUE)
            .as_deref(),
        Some("127.0.0.1:49153")
    );
    assert_eq!(notifier.refresh_count(), 1);
}
