# FlowProxy Phase 4 System Integration Design

## Scope

Phase 4 adds desktop operating-system integration without changing the
established UI, Runtime, Mihomo, or Android boundaries.

- Windows: user-level system proxy, launch at login, elevation/Wintun
  detection, tray Connect/Disconnect, and structured integration status.
- macOS/Linux: capability reporting only. No unverified system mutation is
  presented as implemented.
- TUN: detect permission and dependency blockers. Real TUN activation is not
  enabled in this phase.

## Module Boundary

`flowproxy-platform` owns operating-system policy and adapters. The Tauri crate
coordinates this crate with Runtime lifecycle state. React only calls typed
commands and renders returned state; it never receives shell, registry, or
arbitrary path inputs.

Windows adapters use narrowly enabled `windows-sys` features. Network-facing
unit tests inject registry and notification backends, so tests never modify the
developer's real proxy settings or startup registry.

## Windows System Proxy

Registry scope is the current user:

`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`

The managed endpoint is always `127.0.0.1:<Mihomo mixed-port>`.

Before enabling, FlowProxy captures `ProxyEnable` and `ProxyServer` presence and
values. A versioned journal is atomically persisted before either registry
value is changed. The journal records the original value and the exact managed
endpoint.

If any write or WinINet refresh fails, FlowProxy immediately restores the
captured values. The journal remains only when restoration fails, allowing the
next launch to retry recovery.

Disable and crash recovery modify the system proxy only when current values
still equal the journal's managed values. If the user changed the values,
FlowProxy releases journal ownership without overwriting the user's settings.
A missing journal never authorizes disabling a user-owned proxy.

The unavoidable recovery window is between an abrupt process termination and
the next FlowProxy launch. No background service exists in this phase.

## Runtime Lifecycle

- Enabling the system proxy requires a connected Runtime and a verified
  loopback endpoint supplied by the Mihomo adapter.
- Stop, Restart, tray Disconnect, and controlled Exit restore a managed system
  proxy before stopping the core.
- Restart re-enables the proxy after the replacement core exposes its endpoint
  only when the proxy was managed before restart.
- Health detection restores the proxy immediately after an unexpected core
  exit.
- Restoration failure is surfaced and does not pretend that the core or
  application exited cleanly.
- A startup recovery pass runs before the main window is usable.

## Launch at Login

The Windows adapter owns the current-user Run value named `FlowProxy`. The
stored command is exactly one quoted absolute executable path and is never
passed through a shell.

Disabling removes the value only when it matches FlowProxy's expected command.
A foreign value with the same fixed name is preserved and reported as a
structured conflict.

## Capability Status

Every capability reports one of:

- `available`
- `blocked`
- `unsupported`
- `unverified`

Windows reports system proxy and launch-at-login as available when their
backends are readable. TUN reports `blocked` when the process is not elevated
or Wintun is absent. macOS and Linux report unverified support and do not expose
enabled controls.

## Security and Performance

- Commands accept no endpoint, registry path, executable path, or arbitrary
  server input from the UI.
- The endpoint is derived from the private Mihomo adapter port and validated as
  loopback.
- Journal and temporary files use bounded structured JSON and atomic replace.
- Integration status is refreshed on Settings mount and after explicit actions,
  not by a periodic UI poll.
- No additional background thread is introduced for phase 4.

