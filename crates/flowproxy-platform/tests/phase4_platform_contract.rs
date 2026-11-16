use flowproxy_platform::{
    capabilities_from_probe, CapabilityProbe, CapabilityState, CapabilityStatus,
    PlatformCapabilities,
};

struct FakeCapabilityProbe {
    system_proxy: CapabilityStatus,
    launch_at_login: CapabilityStatus,
    tun: CapabilityStatus,
}

impl CapabilityProbe for FakeCapabilityProbe {
    fn system_proxy(&mut self) -> CapabilityStatus {
        self.system_proxy.clone()
    }

    fn launch_at_login(&mut self) -> CapabilityStatus {
        self.launch_at_login.clone()
    }

    fn tun(&mut self) -> CapabilityStatus {
        self.tun.clone()
    }
}

#[test]
fn capabilities_keep_blocked_and_unverified_states_distinct() {
    let mut probe = FakeCapabilityProbe {
        system_proxy: CapabilityStatus::available("Current-user proxy registry is readable."),
        launch_at_login: CapabilityStatus::available("Current-user startup registry is readable."),
        tun: CapabilityStatus::blocked("Administrator permission is required."),
    };

    let capabilities = capabilities_from_probe(&mut probe);

    assert_eq!(
        capabilities,
        PlatformCapabilities {
            system_proxy: CapabilityStatus::available("Current-user proxy registry is readable."),
            launch_at_login: CapabilityStatus::available(
                "Current-user startup registry is readable."
            ),
            tun: CapabilityStatus::blocked("Administrator permission is required."),
        }
    );
    assert_eq!(capabilities.tun.state, CapabilityState::Blocked);
}

#[test]
fn capability_status_rejects_available_without_a_readable_backend() {
    let mut probe = FakeCapabilityProbe {
        system_proxy: CapabilityStatus::unavailable(
            CapabilityState::Unverified,
            "System proxy support has not been verified on this platform.",
        ),
        launch_at_login: CapabilityStatus::unavailable(
            CapabilityState::Unsupported,
            "Launch at login is unsupported by this build.",
        ),
        tun: CapabilityStatus::unavailable(
            CapabilityState::Unverified,
            "TUN support has not been verified on this platform.",
        ),
    };

    let capabilities = capabilities_from_probe(&mut probe);

    assert_eq!(capabilities.system_proxy.state, CapabilityState::Unverified);
    assert_eq!(
        capabilities.launch_at_login.state,
        CapabilityState::Unsupported
    );
    assert_eq!(capabilities.tun.state, CapabilityState::Unverified);
}
