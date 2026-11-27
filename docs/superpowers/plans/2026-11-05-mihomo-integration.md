# CapybaraProxy Desktop Mihomo Integration Implementation Plan

> **Goal:** Complete desktop phase 3 with a real, locally managed Mihomo core, real control API data, safe configuration activation, crash detection, and real-data desktop pages.

**Scope:** Desktop Windows integration only. No system proxy, TUN, privilege elevation, subscription downloading, or Android implementation.

## Locked Core

- Version: `v1.19.33`
- Windows asset: `mihomo-windows-amd64-v1.19.33.zip`
- GitHub asset digest: `sha256:6ab2180875f9f6fff8b19386d760daec257f66b45f72b3afc650634272fa837a`
- Extracted executable SHA-256: `1cde41cfffd3de0aedad63c0a8515e1ce5eea507e8133aed0f637d316c93800a`
- License: GNU GPL v3
- Local development cache: `F:\codex-install\mihomo\v1.19.33`

## Architecture

- `capybara-contracts` owns serializable runtime, proxy, traffic, rule, connection, profile, and core information contracts.
- `capybara-mihomo-manager` owns binary verification, safe configuration rendering, atomic profile activation, process lifecycle, log collection, and the loopback-only control API client.
- `capybara-runtime` owns state transitions and exposes adapter data without holding the state lock across process or HTTP work.
- Tauri is the composition root. It exposes only fixed typed commands/events and never an arbitrary shell, path, URL, or HTTP API.
- React reads real Runtime data. Mock Overview data is not rendered by the production application.

## Tasks

### Task 1: Contracts and Security Boundaries

- [x] Add tests for new snake_case contracts and structured error codes.
- [x] Add core, proxy group, delay, traffic, connection, rule, and profile payloads.
- [x] Keep existing phase 2 payloads backward compatible.

### Task 2: Binary and Configuration Management

- [x] Add failing tests for binary hash/version verification and safe profile rendering.
- [x] Resolve only known executable candidates and verify the locked hash before execution.
- [x] Force loopback control binding, per-session secrets, `allow-lan: false`, and disabled TUN/listeners.
- [x] Validate candidate YAML with `mihomo -t`.
- [x] Write active profiles via same-directory temporary files, flush, atomic replacement, and rollback.

### Task 3: Real Process Adapter and Control API

- [x] Add failing tests for lifecycle, timeout, crash detection, secret redaction, and local API behavior.
- [x] Spawn exactly one child process with sanitized arguments and no shell.
- [x] Capture bounded, redacted stdout/stderr logs.
- [x] Terminate the managed child immediately, then wait for it to be reaped.
- [x] Query version, proxies, delay, connections, traffic totals, and rules from the loopback API.

> Implementation note: the Windows core currently uses immediate `kill` followed by `wait`. A graceful-shutdown protocol is not implemented in phase 3 and remains a follow-up item.

### Task 4: Runtime Concurrency and Recovery

- [x] Add a test proving a slow adapter operation does not block snapshot reads.
- [x] Split state and operation synchronization so HTTP/process work never holds the state lock.
- [x] Poll process and health state, publish crash transitions, and clean up on application exit.
- [x] Keep Demo adapter test-only in the production composition root.

### Task 5: Tauri and Frontend Real Data

- [x] Register fixed commands for core info, telemetry, proxy selection, delay tests, connections, rules, and profiles.
- [x] Replace the Settings Demo panel with the real Runtime control panel.
- [x] Move Overview to real groups, nodes, latency, traffic, status, and connections.
- [x] Implement real Proxies, Rules, Connections, Profiles, and Logs views.
- [x] Use a shared external-store telemetry sampler that runs only while visible.
- [x] Preserve A/C themes, Orb, mascot, navigation, and persisted theme selection.

### Task 6: Verification

- [x] Run frontend tests, lint, typecheck, and production build.
- [x] Run Rust format, tests, clippy, and release build.
- [x] Start the real core, verify loopback-only listener and release of API port after exit.
- [x] Verify start, stop, restart, delay, selection, telemetry, crash recovery, and profile rollback.
- [x] Capture A/C Overview and real-data page screenshots.
- [x] Record short resource samples and hidden-window behavior.
- [x] Update the phase 3 report with measured results and remaining risks.

> Performance note: the recorded samples cover approximately 3.2 seconds per visible/hidden state. The 5-10 minute idle, connected, traffic, and hidden-residency scenarios required by `performance-requirements.md` are still outstanding.

> External network note: package registry and Cargo advisory audits require the configured `192.168.1.2:7890` proxy and may be unavailable in the current environment. Any failure is reported rather than treated as a pass.

