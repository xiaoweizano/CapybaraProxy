mod capabilities;
mod startup;
mod system_proxy;

pub use capabilities::{
    capabilities_from_probe, unverified_capabilities, CapabilityProbe, CapabilityState,
    CapabilityStatus, PlatformCapabilities,
};
pub use startup::{
    StartupActionOutcome, StartupBackend, StartupManager, StartupState, StartupStatus,
};
pub(crate) use system_proxy::platform_error;
pub use system_proxy::{
    PlatformError, PlatformErrorKind, ProxyBackend, ProxyRecovery, ProxySettings,
    SystemProxyManager, SystemProxySnapshot,
};

#[cfg(windows)]
mod windows_backend;

#[cfg(windows)]
pub use windows_backend::{
    capabilities_from_windows_probe, elevation_status, registry_proxy_backend,
    registry_startup_backend, wintun_installed, RealRegistry, RealWinInetNotifier, RegistryValue,
    RegistryValueKind, TestProxyRegistry, TestWinInetNotifier, WindowsCapabilityProbe,
    WindowsProxyBackend, WindowsRegistry, WindowsStartupBackend, WindowsSystemProbe,
    WindowsWinInetNotifier, WINDOWS_INTERNET_SETTINGS_KEY, WINDOWS_PROXY_ENABLE_VALUE,
    WINDOWS_PROXY_SERVER_VALUE, WINDOWS_RUN_KEY, WINDOWS_STARTUP_VALUE_NAME,
};
