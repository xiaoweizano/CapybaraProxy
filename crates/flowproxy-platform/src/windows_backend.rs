use crate::capabilities::{
    capabilities_from_probe, CapabilityProbe, CapabilityState, CapabilityStatus,
    PlatformCapabilities,
};
use crate::startup::StartupBackend;
use crate::{platform_error, PlatformError, PlatformErrorKind, ProxyBackend, ProxySettings};
use std::collections::HashMap;
use std::env;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::Networking::WinInet::{
    InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
};
use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_QUERY};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_DWORD, REG_SZ,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub const WINDOWS_INTERNET_SETTINGS_KEY: &str =
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";
pub const WINDOWS_PROXY_ENABLE_VALUE: &str = "ProxyEnable";
pub const WINDOWS_PROXY_SERVER_VALUE: &str = "ProxyServer";
pub const WINDOWS_RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
pub const WINDOWS_STARTUP_VALUE_NAME: &str = "FlowProxy";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistryValueKind {
    Dword,
    String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryValue {
    pub kind: RegistryValueKind,
    pub dword: Option<u32>,
    pub string: Option<String>,
}

pub trait WindowsRegistry: Clone {
    fn read_value(&mut self, key: &str, name: &str)
        -> Result<Option<RegistryValue>, PlatformError>;
    fn write_dword(&mut self, key: &str, name: &str, value: u32) -> Result<(), PlatformError>;
    fn write_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), PlatformError>;
    fn delete_value(&mut self, key: &str, name: &str) -> Result<(), PlatformError>;
}

pub trait WindowsWinInetNotifier: Clone {
    fn refresh(&mut self) -> Result<(), PlatformError>;
}

#[derive(Clone, Default)]
pub struct TestProxyRegistry {
    values: Arc<Mutex<HashMap<(String, String), RegistryValue>>>,
}

impl TestProxyRegistry {
    pub fn set_dword(&self, key: &str, name: &str, value: u32) {
        self.values.lock().expect("registry lock").insert(
            (key.to_owned(), name.to_owned()),
            RegistryValue {
                kind: RegistryValueKind::Dword,
                dword: Some(value),
                string: None,
            },
        );
    }

    pub fn set_string(&self, key: &str, name: &str, value: &str) {
        self.values.lock().expect("registry lock").insert(
            (key.to_owned(), name.to_owned()),
            RegistryValue {
                kind: RegistryValueKind::String,
                dword: None,
                string: Some(value.to_owned()),
            },
        );
    }

    pub fn kind_of(&self, key: &str, name: &str) -> Option<RegistryValueKind> {
        self.values
            .lock()
            .expect("registry lock")
            .get(&(key.to_owned(), name.to_owned()))
            .map(|value| value.kind)
    }

    pub fn get_dword(&self, key: &str, name: &str) -> Option<u32> {
        self.values
            .lock()
            .expect("registry lock")
            .get(&(key.to_owned(), name.to_owned()))
            .and_then(|value| value.dword)
    }

    pub fn get_string(&self, key: &str, name: &str) -> Option<String> {
        self.values
            .lock()
            .expect("registry lock")
            .get(&(key.to_owned(), name.to_owned()))
            .and_then(|value| value.string.clone())
    }
}

impl WindowsRegistry for TestProxyRegistry {
    fn read_value(
        &mut self,
        key: &str,
        name: &str,
    ) -> Result<Option<RegistryValue>, PlatformError> {
        Ok(self
            .values
            .lock()
            .expect("registry lock")
            .get(&(key.to_owned(), name.to_owned()))
            .cloned())
    }

    fn write_dword(&mut self, key: &str, name: &str, value: u32) -> Result<(), PlatformError> {
        self.values.lock().expect("registry lock").insert(
            (key.to_owned(), name.to_owned()),
            RegistryValue {
                kind: RegistryValueKind::Dword,
                dword: Some(value),
                string: None,
            },
        );
        Ok(())
    }

    fn write_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), PlatformError> {
        self.values.lock().expect("registry lock").insert(
            (key.to_owned(), name.to_owned()),
            RegistryValue {
                kind: RegistryValueKind::String,
                dword: None,
                string: Some(value.to_owned()),
            },
        );
        Ok(())
    }

    fn delete_value(&mut self, key: &str, name: &str) -> Result<(), PlatformError> {
        self.values
            .lock()
            .expect("registry lock")
            .remove(&(key.to_owned(), name.to_owned()));
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct TestWinInetNotifier {
    refresh_count: Arc<Mutex<usize>>,
}

impl TestWinInetNotifier {
    pub fn refresh_count(&self) -> usize {
        *self.refresh_count.lock().expect("notifier lock")
    }
}

impl WindowsWinInetNotifier for TestWinInetNotifier {
    fn refresh(&mut self) -> Result<(), PlatformError> {
        *self.refresh_count.lock().expect("notifier lock") += 1;
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct RealRegistry;

impl WindowsRegistry for RealRegistry {
    fn read_value(
        &mut self,
        key: &str,
        name: &str,
    ) -> Result<Option<RegistryValue>, PlatformError> {
        read_registry_value(key, name)
    }

    fn write_dword(&mut self, key: &str, name: &str, value: u32) -> Result<(), PlatformError> {
        write_registry_value(key, name, REG_DWORD, &value.to_le_bytes())
    }

    fn write_string(&mut self, key: &str, name: &str, value: &str) -> Result<(), PlatformError> {
        let mut encoded = value.encode_utf16().collect::<Vec<_>>();
        encoded.push(0);
        let bytes = encoded
            .into_iter()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        write_registry_value(key, name, REG_SZ, &bytes)
    }

    fn delete_value(&mut self, key: &str, name: &str) -> Result<(), PlatformError> {
        let key_handle = open_registry_key(key, KEY_WRITE)?;
        let name = wide(name);
        let status = unsafe { RegDeleteValueW(key_handle.0, name.as_ptr()) };
        if status != ERROR_SUCCESS && status != ERROR_FILE_NOT_FOUND {
            return Err(registry_error(
                format!("FlowProxy could not delete registry value {name:?}."),
                status,
            ));
        }
        Ok(())
    }
}

struct RegistryKeyHandle(*mut c_void);

impl Drop for RegistryKeyHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }
}

fn open_registry_key(key: &str, access: u32) -> Result<RegistryKeyHandle, PlatformError> {
    let subkey = key.strip_prefix(r"HKCU\").ok_or_else(|| {
        platform_error(
            PlatformErrorKind::BackendFailure,
            "FlowProxy only accepts current-user registry keys.",
        )
    })?;
    let subkey = wide(subkey);
    let mut handle = std::ptr::null_mut();
    let status =
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, access, &mut handle) };
    if status != ERROR_SUCCESS {
        return Err(registry_error(
            format!("FlowProxy could not open current-user registry key {key}."),
            status,
        ));
    }
    Ok(RegistryKeyHandle(handle))
}

fn read_registry_value(key: &str, name: &str) -> Result<Option<RegistryValue>, PlatformError> {
    let key_handle = open_registry_key(key, KEY_READ)?;
    let name = wide(name);
    let mut value_type = 0;
    let mut size = 0;
    let status = unsafe {
        RegQueryValueExW(
            key_handle.0,
            name.as_ptr(),
            std::ptr::null(),
            &mut value_type,
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if status != ERROR_SUCCESS {
        return Err(registry_error(
            "FlowProxy could not inspect a current-user registry value.",
            status,
        ));
    }
    if size > 64 * 1024 {
        return Err(platform_error(
            PlatformErrorKind::BackendFailure,
            "A current-user registry value exceeded FlowProxy's safety limit.",
        ));
    }

    let mut bytes = vec![0u8; size as usize];
    let status = unsafe {
        RegQueryValueExW(
            key_handle.0,
            name.as_ptr(),
            std::ptr::null(),
            &mut value_type,
            bytes.as_mut_ptr(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(registry_error(
            "FlowProxy could not read a current-user registry value.",
            status,
        ));
    }
    bytes.truncate(size as usize);
    decode_registry_value(value_type, &bytes).map(Some)
}

fn decode_registry_value(value_type: u32, bytes: &[u8]) -> Result<RegistryValue, PlatformError> {
    match value_type {
        REG_DWORD if bytes.len() == 4 => Ok(RegistryValue {
            kind: RegistryValueKind::Dword,
            dword: Some(u32::from_le_bytes(
                bytes.try_into().expect("dword size checked"),
            )),
            string: None,
        }),
        REG_SZ => {
            if bytes.len() % 2 != 0 {
                return Err(registry_type_error(
                    "Registry string data had an odd byte length.",
                ));
            }
            let mut utf16 = bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>();
            while utf16.last() == Some(&0) {
                utf16.pop();
            }
            let string = String::from_utf16(&utf16)
                .map_err(|_| registry_type_error("Registry string data was not valid UTF-16."))?;
            Ok(RegistryValue {
                kind: RegistryValueKind::String,
                dword: None,
                string: Some(string),
            })
        }
        _ => Err(registry_type_error(format!(
            "Registry value used unsupported type {value_type}."
        ))),
    }
}

fn write_registry_value(
    key: &str,
    name: &str,
    value_type: u32,
    bytes: &[u8],
) -> Result<(), PlatformError> {
    let key_handle = open_registry_key(key, KEY_WRITE)?;
    let name = wide(name);
    let status = unsafe {
        RegSetValueExW(
            key_handle.0,
            name.as_ptr(),
            0,
            value_type,
            bytes.as_ptr(),
            bytes.len().try_into().map_err(|_| {
                platform_error(
                    PlatformErrorKind::BackendFailure,
                    "A registry value exceeded the supported size.",
                )
            })?,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(registry_error(
            "FlowProxy could not write a current-user registry value.",
            status,
        ));
    }
    Ok(())
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn registry_error(message: impl Into<String>, status: u32) -> PlatformError {
    platform_error(
        PlatformErrorKind::BackendFailure,
        format!("{} Windows error {}.", message.into(), status),
    )
}

fn registry_type_error(message: impl Into<String>) -> PlatformError {
    platform_error(PlatformErrorKind::BackendFailure, message)
}

#[derive(Clone, Default)]
pub struct RealWinInetNotifier;

impl WindowsWinInetNotifier for RealWinInetNotifier {
    fn refresh(&mut self) -> Result<(), PlatformError> {
        for option in [INTERNET_OPTION_SETTINGS_CHANGED, INTERNET_OPTION_REFRESH] {
            let succeeded =
                unsafe { InternetSetOptionW(std::ptr::null(), option, std::ptr::null(), 0) };
            if succeeded == 0 {
                return Err(platform_error(
                    PlatformErrorKind::BackendFailure,
                    "Windows did not accept the WinINet proxy refresh.",
                ));
            }
        }
        Ok(())
    }
}

pub struct WindowsProxyBackend<R, N> {
    registry: R,
    notifier: N,
}

impl<R, N> WindowsProxyBackend<R, N>
where
    R: WindowsRegistry,
    N: WindowsWinInetNotifier,
{
    pub fn new(registry: R, notifier: N) -> Self {
        Self { registry, notifier }
    }

    fn read_dword(&mut self, name: &str) -> Result<Option<u32>, PlatformError> {
        match self
            .registry
            .read_value(WINDOWS_INTERNET_SETTINGS_KEY, name)?
        {
            None => Ok(None),
            Some(RegistryValue {
                kind: RegistryValueKind::Dword,
                dword: Some(value),
                ..
            }) => Ok(Some(value)),
            Some(_) => Err(registry_type_error(format!(
                "Windows registry value {name} must be REG_DWORD."
            ))),
        }
    }

    fn read_string(&mut self, name: &str) -> Result<Option<String>, PlatformError> {
        match self
            .registry
            .read_value(WINDOWS_INTERNET_SETTINGS_KEY, name)?
        {
            None => Ok(None),
            Some(RegistryValue {
                kind: RegistryValueKind::String,
                string: Some(value),
                ..
            }) => Ok(Some(value)),
            Some(_) => Err(registry_type_error(format!(
                "Windows registry value {name} must be REG_SZ."
            ))),
        }
    }
}

impl<R, N> ProxyBackend for WindowsProxyBackend<R, N>
where
    R: WindowsRegistry,
    N: WindowsWinInetNotifier,
{
    fn read(&mut self) -> Result<ProxySettings, PlatformError> {
        let enabled = self
            .read_dword(WINDOWS_PROXY_ENABLE_VALUE)?
            .map(|value| value != 0);
        let server = self.read_string(WINDOWS_PROXY_SERVER_VALUE)?;
        Ok(ProxySettings { enabled, server })
    }

    fn write_enabled(&mut self, value: Option<bool>) -> Result<(), PlatformError> {
        match value {
            Some(value) => self.registry.write_dword(
                WINDOWS_INTERNET_SETTINGS_KEY,
                WINDOWS_PROXY_ENABLE_VALUE,
                u32::from(value),
            ),
            None => self
                .registry
                .delete_value(WINDOWS_INTERNET_SETTINGS_KEY, WINDOWS_PROXY_ENABLE_VALUE),
        }
    }

    fn write_server(&mut self, value: Option<&str>) -> Result<(), PlatformError> {
        match value {
            Some(value) => self.registry.write_string(
                WINDOWS_INTERNET_SETTINGS_KEY,
                WINDOWS_PROXY_SERVER_VALUE,
                value,
            ),
            None => self
                .registry
                .delete_value(WINDOWS_INTERNET_SETTINGS_KEY, WINDOWS_PROXY_SERVER_VALUE),
        }
    }

    fn refresh(&mut self) -> Result<(), PlatformError> {
        self.notifier.refresh()
    }
}

#[derive(Clone)]
pub struct WindowsStartupBackend<R> {
    registry: R,
}

impl<R> WindowsStartupBackend<R>
where
    R: WindowsRegistry,
{
    pub fn new(registry: R) -> Self {
        Self { registry }
    }
}

impl<R> StartupBackend for WindowsStartupBackend<R>
where
    R: WindowsRegistry,
{
    fn read_command(&mut self) -> Result<Option<String>, PlatformError> {
        match self
            .registry
            .read_value(WINDOWS_RUN_KEY, WINDOWS_STARTUP_VALUE_NAME)?
        {
            None => Ok(None),
            Some(RegistryValue {
                kind: RegistryValueKind::String,
                string: Some(value),
                ..
            }) => Ok(Some(value)),
            Some(_) => Err(registry_type_error(
                "The FlowProxy startup registry value must be REG_SZ.",
            )),
        }
    }

    fn write_command(&mut self, command: &str) -> Result<(), PlatformError> {
        self.registry
            .write_string(WINDOWS_RUN_KEY, WINDOWS_STARTUP_VALUE_NAME, command)
    }

    fn remove_command(&mut self) -> Result<(), PlatformError> {
        self.registry
            .delete_value(WINDOWS_RUN_KEY, WINDOWS_STARTUP_VALUE_NAME)
    }
}

pub trait WindowsSystemProbe {
    fn is_elevated(&mut self) -> Result<bool, PlatformError>;
    fn wintun_installed(&mut self) -> Result<bool, PlatformError>;
}

#[derive(Clone, Default)]
pub struct RealWindowsSystemProbe;

impl WindowsSystemProbe for RealWindowsSystemProbe {
    fn is_elevated(&mut self) -> Result<bool, PlatformError> {
        elevation_status()
    }

    fn wintun_installed(&mut self) -> Result<bool, PlatformError> {
        wintun_installed()
    }
}

pub struct WindowsCapabilityProbe<R, N, S> {
    proxy: WindowsProxyBackend<R, N>,
    startup: WindowsStartupBackend<R>,
    system: S,
}

impl<R, N, S> WindowsCapabilityProbe<R, N, S>
where
    R: WindowsRegistry,
    N: WindowsWinInetNotifier,
    S: WindowsSystemProbe,
{
    pub fn new(registry: R, notifier: N, system: S) -> Self {
        Self {
            proxy: WindowsProxyBackend::new(registry.clone(), notifier),
            startup: WindowsStartupBackend::new(registry),
            system,
        }
    }
}

impl<R, N, S> CapabilityProbe for WindowsCapabilityProbe<R, N, S>
where
    R: WindowsRegistry,
    N: WindowsWinInetNotifier,
    S: WindowsSystemProbe,
{
    fn system_proxy(&mut self) -> CapabilityStatus {
        match self.proxy.read() {
            Ok(_) => {
                CapabilityStatus::available("Current-user system proxy settings are readable.")
            }
            Err(error) => CapabilityStatus::blocked(error.message),
        }
    }

    fn launch_at_login(&mut self) -> CapabilityStatus {
        match self.startup.read_command() {
            Ok(_) => {
                CapabilityStatus::available("Current-user launch-at-login settings are readable.")
            }
            Err(error) => CapabilityStatus::blocked(error.message),
        }
    }

    fn tun(&mut self) -> CapabilityStatus {
        match self.system.is_elevated() {
            Ok(false) => {
                return CapabilityStatus::blocked("TUN requires an elevated FlowProxy process.");
            }
            Err(error) => {
                return CapabilityStatus::unavailable(
                    CapabilityState::Unverified,
                    format!("Elevation could not be verified: {}", error.message),
                );
            }
            Ok(true) => {}
        }

        match self.system.wintun_installed() {
            Ok(false) => CapabilityStatus::blocked(
                "The Wintun driver library is not installed.",
            ),
            Ok(true) => CapabilityStatus::unavailable(
                CapabilityState::Unverified,
                "Elevation and Wintun were detected, but TUN activation is not enabled in this phase.",
            ),
            Err(error) => CapabilityStatus::unavailable(
                CapabilityState::Unverified,
                format!("Wintun could not be verified: {}", error.message),
            ),
        }
    }
}

pub fn capabilities_from_windows_probe() -> PlatformCapabilities {
    let mut probe =
        WindowsCapabilityProbe::new(RealRegistry, RealWinInetNotifier, RealWindowsSystemProbe);
    capabilities_from_probe(&mut probe)
}

pub fn registry_proxy_backend() -> WindowsProxyBackend<RealRegistry, RealWinInetNotifier> {
    WindowsProxyBackend::new(RealRegistry, RealWinInetNotifier)
}

pub fn registry_startup_backend() -> WindowsStartupBackend<RealRegistry> {
    WindowsStartupBackend::new(RealRegistry)
}

pub fn elevation_status() -> Result<bool, PlatformError> {
    let mut token = std::ptr::null_mut();
    let opened = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if opened == 0 {
        return Err(platform_error(
            PlatformErrorKind::BackendFailure,
            "FlowProxy could not open its Windows process token.",
        ));
    }
    let token = RegistryKeyHandle(token);
    let mut elevation = 0u32;
    let mut returned_size = 0u32;
    let succeeded = unsafe {
        GetTokenInformation(
            token.0,
            TokenElevation,
            (&mut elevation as *mut u32).cast(),
            std::mem::size_of::<u32>() as u32,
            &mut returned_size,
        )
    };
    if succeeded == 0 {
        return Err(platform_error(
            PlatformErrorKind::BackendFailure,
            "FlowProxy could not read its Windows elevation state.",
        ));
    }
    Ok(elevation != 0)
}

pub fn wintun_installed() -> Result<bool, PlatformError> {
    let mut candidates = Vec::new();
    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("wintun.dll"));
        }
    }
    if let Some(system_root) = env::var_os("SystemRoot") {
        candidates.push(
            PathBuf::from(system_root)
                .join("System32")
                .join("wintun.dll"),
        );
    }
    if candidates.is_empty() {
        return Ok(false);
    }
    Ok(candidates.iter().any(|candidate| candidate.is_file()))
}
