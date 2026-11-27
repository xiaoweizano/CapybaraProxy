//! Resolves the operating system's proxy so subscription downloads take the
//! same route as the user's existing proxy client.
//!
//! Most subscription hosts are only reachable through the proxy client that is
//! already running (Clash and friends publish a system-wide HTTP proxy on
//! Windows). reqwest does not read that setting by default in this build, so
//! the Windows registry is consulted directly. When no system proxy is set the
//! request stays with reqwest's regular behaviour, which already honours the
//! `HTTP_PROXY`/`HTTPS_PROXY` environment variables.

/// Returns the proxy URL to use for `destination`, or `None` when the request
/// should go direct.
pub fn proxy_url_for(destination: &str) -> Option<String> {
    let url = reqwest::Url::parse(destination).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    platform::proxy_url_for(&host)
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD,
        REG_EXPAND_SZ, REG_SZ,
    };

    const INTERNET_SETTINGS: &str =
        "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

    struct Settings {
        server: String,
        overrides: String,
    }

    pub fn proxy_url_for(host: &str) -> Option<String> {
        let settings = read_settings()?;
        if bypasses(host, &settings.overrides) {
            return None;
        }
        select_server(&settings.server)
    }

    fn read_settings() -> Option<Settings> {
        let mut key: HKEY = std::ptr::null_mut();
        let subkey = wide(INTERNET_SETTINGS);
        let status =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut key) };
        if status != ERROR_SUCCESS {
            return None;
        }

        let enabled = read_u32(key, "ProxyEnable").unwrap_or(0);
        let server = read_string(key, "ProxyServer");
        let overrides = read_string(key, "ProxyOverride").unwrap_or_default();
        unsafe { RegCloseKey(key) };

        if enabled == 0 {
            return None;
        }
        server.map(|server| Settings { server, overrides })
    }

    /// Picks the HTTP-capable entry out of a `ProxyServer` value, which may be
    /// either `host:port` or `http=host:port;https=host:port;socks=host:port`.
    pub(super) fn select_server(raw: &str) -> Option<String> {
        let mut http = None;
        let mut https = None;
        let mut plain = None;
        for entry in raw.split(';') {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            match entry.split_once('=') {
                Some((scheme, value)) => {
                    let value = value.trim();
                    if value.is_empty() {
                        continue;
                    }
                    match scheme.trim().to_ascii_lowercase().as_str() {
                        // Prefer `http=`: it is the ordinary HTTP proxy that
                        // can also tunnel HTTPS with CONNECT.
                        "http" => http = Some(value),
                        "https" => https = Some(value),
                        _ => {}
                    }
                }
                None => plain = Some(entry),
            }
        }

        let server = http.or(https).or(plain)?;
        Some(if server.contains("://") {
            server.to_owned()
        } else {
            format!("http://{server}")
        })
    }

    /// Windows' bypass list uses `;` separators and `*` wildcards; `<local>`
    /// stands for host names without a dot.
    pub(super) fn bypasses(host: &str, overrides: &str) -> bool {
        overrides
            .split(';')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .any(|entry| {
                let entry = entry.to_ascii_lowercase();
                if entry == "<local>" {
                    return !host.contains('.');
                }
                glob_matches(&entry, host)
            })
    }

    fn glob_matches(pattern: &str, text: &str) -> bool {
        let pattern: Vec<char> = pattern.chars().collect();
        let text: Vec<char> = text.chars().collect();
        let (mut p, mut t) = (0_usize, 0_usize);
        let mut star: Option<(usize, usize)> = None;

        loop {
            if p < pattern.len() && t < text.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
                p += 1;
                t += 1;
            } else if p < pattern.len() && pattern[p] == '*' {
                star = Some((p, t));
                p += 1;
            } else if let Some((star_p, star_t)) = star {
                star = Some((star_p, star_t + 1));
                p = star_p + 1;
                t = star_t + 1;
            } else {
                return false;
            }

            if t == text.len() {
                break;
            }
        }

        pattern[p..].iter().all(|character| *character == '*')
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn read_u32(key: HKEY, name: &str) -> Option<u32> {
        let name = wide(name);
        let mut kind = 0_u32;
        let mut value = 0_u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                (&mut value as *mut u32).cast::<u8>(),
                &mut size,
            )
        };
        (status == ERROR_SUCCESS && kind == REG_DWORD).then_some(value)
    }

    fn read_string(key: HKEY, name: &str) -> Option<String> {
        let name = wide(name);
        let mut kind = 0_u32;
        let mut size = 0_u32;
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS || size == 0 {
            return None;
        }

        let mut buffer = vec![0_u8; size as usize];
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                buffer.as_mut_ptr(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS || (kind != REG_SZ && kind != REG_EXPAND_SZ) {
            return None;
        }

        let units: Vec<u16> = buffer[..size as usize]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .take_while(|unit| *unit != 0)
            .collect();
        String::from_utf16(&units).ok()
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn proxy_url_for(_host: &str) -> Option<String> {
        None
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::platform::{bypasses, select_server};

    #[test]
    fn selects_http_entry_from_scheme_list() {
        assert_eq!(
            select_server("http=192.168.1.2:7890;https=192.168.1.2:7893;socks=10.0.0.1:1"),
            Some("http://192.168.1.2:7890".to_owned())
        );
        assert_eq!(
            select_server("https=192.168.1.2:7890"),
            Some("http://192.168.1.2:7890".to_owned())
        );
    }

    #[test]
    fn selects_plain_host_port() {
        assert_eq!(
            select_server(" 192.168.1.2:7890 "),
            Some("http://192.168.1.2:7890".to_owned())
        );
        assert_eq!(
            select_server("http://proxy.local:8080"),
            Some("http://proxy.local:8080".to_owned())
        );
        assert_eq!(select_server("   "), None);
        assert_eq!(select_server("socks=10.0.0.1:1080"), None);
    }

    #[test]
    fn honours_bypass_list() {
        let overrides = "localhost;127.*;*.skytech.io;<local>";
        assert!(bypasses("127.0.0.1", overrides));
        assert!(bypasses("localhost", overrides));
        assert!(bypasses("panel.skytech.io", overrides));
        assert!(bypasses("intranet", overrides));
        assert!(!bypasses("provider.example.com", overrides));
    }

    #[test]
    fn wildcard_matching_is_not_greedy_across_dots_only() {
        assert!(bypasses("a.b.example.com", "*.example.com"));
        assert!(!bypasses("example.com", "*.example.com"));
        assert!(bypasses("anything", "*"));
    }
}
