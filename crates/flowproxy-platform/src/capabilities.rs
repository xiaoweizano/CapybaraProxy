use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityState {
    Available,
    Blocked,
    Unsupported,
    Unverified,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CapabilityStatus {
    pub state: CapabilityState,
    pub message: String,
}

impl CapabilityStatus {
    pub fn available(message: impl Into<String>) -> Self {
        Self {
            state: CapabilityState::Available,
            message: message.into(),
        }
    }

    pub fn blocked(message: impl Into<String>) -> Self {
        Self {
            state: CapabilityState::Blocked,
            message: message.into(),
        }
    }

    pub fn unavailable(state: CapabilityState, message: impl Into<String>) -> Self {
        debug_assert_ne!(state, CapabilityState::Available);
        Self {
            state,
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PlatformCapabilities {
    pub system_proxy: CapabilityStatus,
    pub launch_at_login: CapabilityStatus,
    pub tun: CapabilityStatus,
}

pub trait CapabilityProbe {
    fn system_proxy(&mut self) -> CapabilityStatus;
    fn launch_at_login(&mut self) -> CapabilityStatus;
    fn tun(&mut self) -> CapabilityStatus;
}

pub fn capabilities_from_probe(probe: &mut impl CapabilityProbe) -> PlatformCapabilities {
    PlatformCapabilities {
        system_proxy: probe.system_proxy(),
        launch_at_login: probe.launch_at_login(),
        tun: probe.tun(),
    }
}

pub fn unverified_capabilities(message: impl Into<String>) -> PlatformCapabilities {
    let message = message.into();
    PlatformCapabilities {
        system_proxy: CapabilityStatus::unavailable(
            CapabilityState::Unverified,
            format!("System proxy support is unverified. {message}"),
        ),
        launch_at_login: CapabilityStatus::unavailable(
            CapabilityState::Unverified,
            format!("Launch at login support is unverified. {message}"),
        ),
        tun: CapabilityStatus::unavailable(
            CapabilityState::Unverified,
            format!("TUN support is unverified. {message}"),
        ),
    }
}
