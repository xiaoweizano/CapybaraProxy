# CapybaraProxy Phase 4 System Integration Plan

## Slice 1: Platform Proxy Ownership

1. Add `capybara-platform` and injectable system-proxy backend tests.
2. Implement endpoint validation, atomic journal persistence, enable, disable,
   partial-failure rollback, external-change protection, and startup recovery.

## Slice 2: Startup and Capability Probes

1. Add exact-command launch-at-login policy and foreign-value protection.
2. Add platform capability matrix, elevation probe, Wintun detection, and
   structured blockers.
3. Add Windows registry/WinINet/token adapters with minimal `windows-sys`
   features.

## Slice 3: Runtime Endpoint and Lifecycle

1. Expose the verified Mihomo loopback proxy endpoint through the adapter and
   Runtime public API.
2. Serialize system integration lifecycle in Tauri.
3. Restore before Stop/Restart/Exit, re-enable after Restart, and recover after
   core-crash detection.

## Slice 4: Commands, Tray, and UI

1. Add typed status/enable/disable/startup commands and stable errors.
2. Add tray Connect/Disconnect using the controlled lifecycle.
3. Add Settings integration controls with A/C shared behavior and no polling.
4. Replace phase-3 placeholder text with current capability state.

## Slice 5: Verification and Documentation

1. Run frontend tests, lint, typecheck, and build.
2. Run Rust format, workspace tests, clippy, and Tauri release build.
3. Run Windows verification with journal and registry backup/restore.
4. Capture A/C Settings screenshots.
5. Publish the platform support matrix and phase 4 report with explicit TUN and
   non-Windows unverified boundaries.

