# FlowProxy

> **Your Network. Your Flow.**
>
> 中文版：[README.md](README.md)

FlowProxy is a cross-platform proxy client. It bundles and supervises the Mihomo core, and puts subscriptions, proxy groups, rules, connections and the system proxy behind one interface instead of asking you to edit YAML or drive a command line.

This repository contains a working Windows desktop build, plus the UI and service skeleton for Android.

---

## Contents

- [Feature overview](#feature-overview)
- [Getting started](#getting-started)
- [The interface](#the-interface)
- [Settings](#settings)
- [Where data lives](#where-data-lives)
- [System integration and safety boundaries](#system-integration-and-safety-boundaries)
- [Local development](#local-development)
- [Checks and builds](#checks-and-builds)
- [Repository layout](#repository-layout)
- [Documentation index](#documentation-index)
- [Confirmed product decisions](#confirmed-product-decisions)
- [Current stage and limits](#current-stage-and-limits)

---

## Feature overview

### Subscriptions

- **Subscription library**: keep several subscriptions and switch which one is active at any time. Each is stored separately and can be removed on its own.
- **Several import paths**: a subscription URL, Clash / Mihomo YAML, or `ss://` `vmess://` `vless://` `trojan://` `hysteria2://` `tuic://` share links (converted automatically).
- **Usage and expiry**: parses the provider's `subscription-userinfo` header and shows used traffic, total allowance and expiry.
- **Overrides**: each subscription can keep its own custom rules and override YAML, and both survive a refresh. Control keys (ports, secret, `allow-lan`, …) stay owned by FlowProxy and cannot be overridden.
- **Automatic refresh**: refresh on launch and on a schedule (presets, or any interval from 1 to 168 hours), optionally restarting the core after an update.
- **Sub-Store**: point at a backend with an `x-api-token`, list its subscriptions and import one in a click.

### Proxying

- Rule, Global and Direct modes, switchable while running without a restart.
- Proxy groups support search by name, sorting by latency or name, collapsing, and pinning favourite nodes. All of that view state is remembered.
- Per-node latency checks, per-group checks, and a single action that probes every group. A latency history sits at the bottom of the page.

### Observation

- The Overview page shows live upload/download rates, a traffic chart, session duration, and **today** and **last 7 days** totals that FlowProxy counts itself — these survive a core restart.
- The Connections page expands a row into full detail (host, destination, matched rule, chain, upload volume, start time), with search and a confirmed "close all".
- The Rules page shows how many live connections each rule is currently handling, and lists the rule-set and proxy-set providers the profile declares.
- **Rule tester**: type a domain or IP and it walks the rule table in order to say which rule decides the route. Rule types it cannot evaluate (GEO, rule sets, process names, …) are listed explicitly rather than guessed at.
- The Logs page filters by level, searches, pauses and clears the view.

### System

- Windows per-user system proxy (three registry values), journalled and restored: your own values come back on exit, and FlowProxy's proxy is re-applied after the next launch.
- A configurable system-proxy bypass list, backed up and restored the same way.
- A TUN switch, available when the process is elevated and the Wintun driver is present; it writes a `tun:` block into the active subscription's override.
- Launch at login, silent start, and connect on launch.
- System tray: state and current node, routing-mode switching, open log folder, and a live speed icon.
- Rotating daily log files with a configurable retention window, plus a one-click **redacted** diagnostic bundle (no subscription URLs, tokens or secrets; nothing is uploaded).

### Getting around

- `Ctrl/Cmd + K` opens a command palette: jump to a page, switch the routing mode, or select a node directly.

---

## Getting started

### Install

Run `FlowProxy_<version>_x64-setup.exe` and install for the current user; no administrator rights are required. The installer bundles a verified Mihomo core and geodata, so nothing has to be placed by hand.

### First run

1. Open **Subscriptions**, paste subscription YAML or enter a subscription URL, then choose **Import subscription**.
2. Go back to **Overview** and choose **Connect**.
3. Once the state reads "Connected", **Proxy groups** lists the real nodes from the subscription.
4. To take over system traffic, open **Settings → System integration** and enable **System proxy**.
5. The interface language switches under **Settings → Appearance → Language** (English / 简体中文) and persists.

> If the core is already running when you import a subscription or change an override, restart it to load the new configuration. With "restart after update" enabled, an automatic refresh takes care of that itself.

---

## The interface

### Overview

Connect / disconnect, live rates, traffic chart, session duration, today and last-7-days totals, proxy group and node selection, latency measurement, node map, active connection count.

### Proxy groups

Three routing modes; search, sort, collapse and pinning for groups and nodes; per-node and per-group latency checks; a latency history at the bottom. While the core is stopped the page shows a read-only preview from the stored subscription, clearly labelled as such.

### Rules

The rule table, search, live hit counts per rule, the rule-set and proxy-set providers, and the rule tester.

### Connections

A connection list with search, per-row detail, per-row close, close-all with confirmation, and pagination.

### Subscriptions

The subscription library (switch / remove), the import form, update, bulk latency checks, the usage panel, and editors for custom rules and override YAML.

### Logs

Live events, level filter, search, pause, clear view, open log folder.

### Settings

Groups are shown according to a "configuration mode" (Simple / Standard / Relaxed) as a single column of full-width cards with group navigation at the top. See the next section.

---

## Settings

| Group | Contents |
| --- | --- |
| Appearance | Theme (Cyber Flow / Warm Flow), language, interface scale, settings mode |
| Window & startup | Close-button behaviour (hide to tray / exit), silent start, connect on launch, launch at login |
| System integration | System proxy switch, bypass list, TUN switch, startup status |
| Subscription | Update on launch, automatic update interval, restart after update, subscription User-Agent |
| Logs | Write to disk, retention days, open folder, export diagnostics, clear files |
| Core | Log level, IPv6 |
| Core versions | Register, switch and fall back between Mihomo builds |
| Tray | Show state and node, speed display (icon digits / tooltip only / hidden), motion preference |
| Advanced core | Unified delay, concurrent TCP, fixed mixed port, latency probe URL and timeout |
| DNS | Preset or custom resolvers, Fake-IP range |
| Sub-Store | Backend address, token, list and import subscriptions |

---

## Where data lives

| Content | Location |
| --- | --- |
| Settings | `settings.json` in the app config directory |
| Subscription documents and metadata | `<config dir>/mihomo/subscriptions/` |
| Active subscription index | `<config dir>/mihomo/subscriptions.json` |
| Generated runtime configuration | `<config dir>/mihomo/config.yaml` |
| System proxy journal | `<config dir>/system-proxy.json` |
| Daily traffic ledger | `<config dir>/traffic.json` |
| Core version index and builds | `<config dir>/cores/` |
| Logs | Daily files in the OS application log directory |

On Windows the app config directory is usually `%APPDATA%\com.flowproxy.desktop`. All of these files are plaintext and **not encrypted**; subscription files carry provider credentials and are protected by file permissions only.

---

## System integration and safety boundaries

### What FlowProxy owns

Mihomo's control port, API secret, proxy listening port, `allow-lan` and bind address are **not** decided by the subscription. On import these top-level keys are removed and replaced with values FlowProxy generates at start:

| Removed key | Value FlowProxy writes |
| --- | --- |
| `mixed-port`, `port`, `socks-port`, `redir-port`, `tproxy-port` | A reserved loopback port |
| `external-controller` and its variants | `-ext-ctl 127.0.0.1:<port>` on the command line |
| `secret` | Randomly generated per start, passed via `-secret` |
| `allow-lan` | `false` |
| `bind-address`, `lan-allowed-ips`, `lan-disallowed-ips` | `127.0.0.1` |
| `authentication`, `external-ui` | Removed |

The rest of the subscription is preserved byte for byte, including comments, anchors and rule order.

### Verification

- The core binary is checked for SHA-256 and `-v` output before it is executed.
- A configuration runs `mihomo -t -d <working dir> -f <file>` before it becomes active.
- Subscription URLs must be `http://` or `https://`, with length and character limits; downloads have a timeout, a size cap and redirect rules, and `https` may not be downgraded to `http`.
- Subscription URLs embed tokens, so they **never appear in any log or error message**.
- Subscription identifiers are validated and cannot be used for path traversal.

### Platform status

| Platform | Status |
| --- | --- |
| Windows 10 x64 | Verified: real core, system proxy, launch at login, tray, TUN (elevation + Wintun) |
| macOS / Linux | Unverified: no unverified system-modifying backend is called; capabilities report `unverified` |
| Android | UI, themes and a `VpnService` skeleton; real Mihomo native and TUN are not wired up yet |

---

## Local development

```powershell
pnpm install
pnpm dev          # front end only, for UI work
pnpm tauri:dev    # the full desktop app
```

Optional environment variables (offline builds or behind a proxy):

```powershell
$env:CARGO_HOME = 'F:\codex-install\cargo-home'
$env:CARGO_TARGET_DIR = 'F:\codex-install\cargo-target'
$env:CARGO_NET_OFFLINE = 'true'
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:NO_PROXY = 'localhost,127.0.0.1'
```

If a development build has no bundled core, point at a verified executable:

```powershell
$env:FLOWPROXY_MIHOMO_PATH = 'F:\path\to\mihomo.exe'
```

### Core lookup order

At start the core is looked up in this order; the first hit is checked for SHA-256 and version:

1. The file named by `FLOWPROXY_MIHOMO_PATH`
2. `mihomo.exe` next to `flowproxy-desktop.exe`
3. `resources\mihomo.exe` next to it
4. `resources\mihomo\mihomo.exe` (the installer layout)
5. `mihomo\mihomo.exe` next to it
6. `mihomo\mihomo.exe` in the config directory

A build registered and activated under **Core versions** takes precedence over all of the above.

### Building the installer

```powershell
node scripts/prepare-bundle-resources.mjs
pnpm tauri:build
```

`apps/desktop/src-tauri/resources/` is not committed (about 74 MB of binaries); the script above copies them by fixed hash.

---

## Checks and builds

```powershell
pnpm lint
pnpm typecheck
pnpm test                      # front-end unit tests
pnpm build
node scripts/verify-locale-keys.mjs   # English/Chinese locale key parity

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Current state: 131 front-end tests and 223 Rust tests pass; `clippy -D warnings` is clean; the two locale files agree on 525 keys.

GitHub Actions (`.github/workflows/verify.yml`) runs the checks above on every push and pull request; dependency auditing reports without blocking. See `docs/development/ci.md`.

The other `verify-*.mjs` scripts are local acceptance tools: they launch an installed build and drive the UI over CDP, so they are not part of CI.

---

## Repository layout

```
apps/
  desktop/          Tauri desktop app (React + TypeScript + Rust)
  android/          Android app (Kotlin + Jetpack Compose)
crates/
  flowproxy-contracts   Data contracts shared across platforms
  flowproxy-runtime     Runtime state machine and logging
  mihomo-manager        Mihomo child process, control API, subscriptions, profiles
  flowproxy-platform    Platform capabilities (system proxy, startup, TUN probe)
packages/
  design-tokens     Design tokens shared by desktop and Android
docs/              Product, UI, architecture and per-stage reports
scripts/           Resource preparation, acceptance and verification scripts
```

---

## Documentation index

- Product: `docs/product/product-requirements.md`
- UI: `docs/ui-design/design-reference.md`, `theme-cyber-flow.md`, `theme-warm-flow.md`, `mascot-guidelines.md`, `component-specification.md`
- Architecture: `docs/architecture/system-architecture.md`, `desktop-tauri-rust.md`, `android-architecture.md`, `performance-requirements.md`, `platform-support-matrix.md`, `adr-0001-desktop-stack.md`
- Development: the stage reports (1–6) under `docs/development/`, plus `subscription-scope.md` (subscription limits), `i18n-scope.md` and `ci.md`
- Visual references: `assets/design-reference/`

---

## Confirmed product decisions

1. Product name: FlowProxy.
2. Target platforms: Windows, macOS, Linux, Android.
3. Proxy core: Mihomo, distributed, started, monitored and managed by FlowProxy.
4. Desktop stack: React + TypeScript + Tauri + Rust.
5. Android: Kotlin + Jetpack Compose, using Android `VpnService`.
6. Themes: Cyber Flow by default, Warm Flow switchable.
7. Closing the main window hides it to the tray and keeps the proxy running; this can be changed to exit in Settings.
8. Performance first: CPU, memory, background polling and animation are all budgeted.
9. The UI follows the design references; adapting to a resolution keeps the layout relationships and visual hierarchy rather than pinning pixels.
10. Android and desktop share design tokens and data contracts; they do not share UI code.

---

## Current stage and limits

### Done

- Stage 1: desktop UI prototype
- Stage 2: Runtime skeleton, native settings and controlled exit
- Stage 3: real Mihomo child process, control API and live data pages on Windows
- Stage 4: Windows system proxy, launch at login, journal recovery and capability states
- Stage 5: Android Compose UI, A/C themes, `VpnService` authorisation and foreground service
- Stage 6: performance sampling, subscription import and distributable artifacts
- Stage 7: subscription library, overrides, DNS / TUN, rule tester, command palette, traffic ledger, diagnostics and CI

### Current limits

- TUN needs an elevated process and the Wintun driver; the switch stays disabled and explains why when either is missing.
- macOS / Linux system integration remains `unverified`; no unverified modifying backend is called.
- Android's real Mihomo native layer and TUN are not wired up.
- One subscription is active at a time; the library holds parallel profiles but there is no "previous version of the same subscription" rollback.
- The app does not update itself; core builds are placed and registered by hand.

---

## Maintenance

Submit documentation updates together with the code change they describe, so this README and `docs/` stay in step. Chinese is the default version; `README.en.md` must be updated in the same commit.
