<div align="center">

<img src="assets/brand/app-icon.png" width="128" alt="CapybaraProxy">

# CapybaraProxy

**A cross-platform proxy client built on the Mihomo core**

[简体中文](README.zh-CN.md) · **English**

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-2ea44f)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![Rust](https://img.shields.io/badge/Rust-1.77-000000)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

</div>

---

## What CapybaraProxy is

CapybaraProxy bundles and supervises the Mihomo core and puts subscriptions, proxy groups, rules, connections and the system proxy behind one interface. You do not edit YAML, and you do not start the core by hand.

The installer ships a verified Mihomo binary and geodata, so it works right after install. The control port, API secret and listening ports always belong to the client — a subscription cannot change them.

## Features

**Subscriptions**
- Subscription library: keep several and switch at any time, each stored independently and removable on its own
- Import paths: subscription URL, Clash / Mihomo YAML, or `ss://` `vmess://` `vless://` `trojan://` `hysteria2://` `tuic://` share links (converted automatically)
- Parses `subscription-userinfo` to show used traffic, total allowance and expiry
- Overrides: each subscription can keep custom rules and override YAML that survive a refresh; ports and secret stay under client control
- Automatic updates on launch and on a schedule (presets, or any 1–168 hour interval), optionally restarting the core afterwards
- Sub-Store: point at a backend and list or import its subscriptions in a click

**Proxying**
- Rule, Global and Direct modes, switchable while running without a restart
- Group search, sorting by latency or name, collapsing, and pinning favourites — the view state is remembered
- Per-node checks, per-group checks, and one action for every group; a latency history stays on the page

**Observation**
- Overview: live rates, traffic chart, session duration, and **today** / **last 7 days** totals counted per day by the client (they survive a core restart)
- Connections: expand a row for full detail (host, destination, matched rule, chain, upload volume, start time), with search and a confirmed "close all"
- Rules: live hit count per rule, plus the rule-set and proxy-set providers the profile declares
- Rule tester: type a domain or IP and it walks the rule table to say which rule decides the route; rule types it cannot evaluate are listed rather than guessed
- Logs: level filter, search, pause, clear view

**System**
- Windows per-user system proxy, journalled: your own values come back on exit and the client's proxy is re-applied after the next launch
- A configurable bypass list, backed up and restored the same way
- TUN switch, available when the process is elevated and Wintun is installed
- Launch at login, silent start, connect on launch
- Tray: state and current node, routing-mode switching, open log folder, live speed icon
- Rotating daily logs with a retention setting; a one-click **redacted** diagnostic bundle (no subscription URLs, tokens or secrets; nothing is uploaded)

**Getting around**
- `Ctrl/Cmd + K` command palette: jump to a page, switch the routing mode, or select a node

## Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2 |
| Front end | React 19 + TypeScript (strict) + Vite |
| Core logic | Rust (four crates: contracts / runtime / mihomo-manager / platform) |
| Proxy core | Mihomo (bundled; SHA-256 and version verified before launch) |
| Android | Kotlin + Jetpack Compose + `VpnService` |
| Tests | Vitest (131) + cargo test (228) |
| Packaging | tauri-bundler (NSIS) |

## Development

```bash
pnpm install

pnpm dev          # front end only, for UI work
pnpm tauri:dev    # the full desktop app

pnpm lint
pnpm typecheck
pnpm test
node scripts/verify-locale-keys.mjs   # English/Chinese locale key parity
```

Rust side:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Packaging:

```powershell
node scripts/prepare-bundle-resources.mjs   # stages Mihomo and geodata by fixed hash
pnpm tauri:build                             # produces the NSIS installer
```

`apps/desktop/src-tauri/resources/` is not committed (about 74 MB of binaries); the script above copies it. After changing the icon, regenerate every platform size:

```bash
pnpm tauri icon assets/brand/app-icon.png
```

Optional environment variables: `CAPYBARA_MIHOMO_PATH` points at a verified core, `CAPYBARA_CONFIG_ROOT` overrides the config directory. Offline builds use `CARGO_NET_OFFLINE=true`.

## Where data lives

Everything sits in the app config directory (usually `%APPDATA%\com.capybara.proxy\` on Windows):

| Path | Contents |
|---|---|
| `settings.json` | Interface and behaviour settings |
| `mihomo/subscriptions/` | Subscription documents and metadata |
| `mihomo/subscriptions.json` | The active subscription |
| `mihomo/config.yaml` | The generated runtime configuration |
| `system-proxy.json` | System proxy backup and ownership record |
| `traffic.json` | Daily traffic ledger |
| `cores/` | Registered core builds |

All of these are plaintext and **not encrypted**; subscription files carry provider credentials, so protect them with file permissions.

Upgrading from the previous name (FlowProxy) copies the old directory `%APPDATA%\com.flowproxy.desktop\` across on first launch. The old directory is left in place and can be deleted once you are satisfied.

## Known limits

- **TUN needs elevation**: without an elevated process or the Wintun driver the switch stays disabled and explains why
- **Windows only is verified**: macOS / Linux system integration stays `unverified`; no unverified modifying API is called
- **Android is not wired to the real core yet**: UI, themes and the `VpnService` skeleton are done, the Mihomo native layer and TUN are not
- **One active subscription at a time**: the library holds parallel profiles but offers no rollback to a previous version of the same subscription
- **No self-update**: core builds are placed in `cores/` and registered by hand

## Repository layout

```
apps/
  desktop/          Tauri desktop app (React + TypeScript + Rust)
  android/          Android app (Kotlin + Jetpack Compose)
crates/
  capybara-contracts        Data contracts shared across platforms
  capybara-runtime          Runtime state machine and logging
  capybara-mihomo-manager   Mihomo child process, control API, subscriptions, profiles
  capybara-platform         Platform capabilities (system proxy, startup, TUN probe)
packages/
  design-tokens     Design tokens shared by desktop and Android
docs/              Product, UI, architecture and per-stage reports
scripts/           Resource preparation, acceptance and verification scripts
```

## Documentation

- Product requirements: `docs/product/product-requirements.md`
- UI: `docs/ui-design/` (references, both themes, mascot, component spec)
- Architecture: `docs/architecture/` (overview, desktop, Android, performance, platform matrix)
- Development: `docs/development/` (stage reports, subscription limits, CI notes)

## Disclaimer

- **Use it at your own risk.** The software is provided as is, without warranty. The author is not liable for any loss arising from its use or inability to use it.
- **You supply the subscriptions.** The client downloads and hosts them; it does not vouch for their legality or availability.
- **The system proxy modifies system settings.** It is restored on exit, but after an abnormal exit check the state under Settings → System integration.
- **The diagnostic bundle contains no secrets but does contain environment details.** Review it before sharing.

## Third party

The proxy core is [Mihomo](https://github.com/MetaCubeX/mihomo), distributed under its own licence; GEOIP / GEOSITE data comes from [meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) (GPL-3.0). The icon is an original project asset.

## License

GPL-3.0 — see [LICENSE](LICENSE).
