# CapybaraProxy 桌面 Runtime 骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现阶段 2 的可测试桌面 Runtime 骨架、Runtime Demo UI、Rust 设置持久化和受控退出。

**Architecture:** Tauri 只作为组合根，Runtime、Mihomo adapter 和共享契约拆成三个 crate。前端通过固定 typed commands/events 访问明确标识的 Demo Runtime。

**Tech Stack:** Rust 2021、Tauri 2、Serde、React 19、TypeScript 6、Vitest

---

### Task 1: Cargo workspace 与共享契约

**Files:**
- Create: `Cargo.toml`
- Create: `crates/capybara-contracts/Cargo.toml`
- Create: `crates/capybara-contracts/src/lib.rs`
- Move: `apps/desktop/src-tauri/Cargo.lock` -> `Cargo.lock`
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [x] **Step 1: 定义失败的契约序列化测试**

测试 `RuntimeState` 序列化为 snake_case，`CommandResult` 成功/失败结构稳定，错误码不会因展示文本变化。

- [x] **Step 2: 运行测试确认失败**

Run: `cargo test -p capybara-contracts`
Expected: FAIL because crate and types do not exist.

- [x] **Step 3: 建立 workspace 和 contracts**

定义 `RuntimeBackend`、`RuntimeState`、`RuntimeErrorCode`、`RuntimeError`、`CommandResult<T>`、`RuntimeSnapshot` 和 `RuntimeLogEntry`，全部派生 Serde。

- [x] **Step 4: 运行测试确认通过**

Run: `cargo test -p capybara-contracts`
Expected: PASS.

### Task 2: Mihomo adapter 与 Fake adapter

**Files:**
- Create: `crates/mihomo-manager/Cargo.toml`
- Create: `crates/mihomo-manager/src/lib.rs`
- Test: `crates/mihomo-manager/src/lib.rs`

- [x] **Step 1: 写 fake 生命周期失败测试**

测试 Fake adapter 初始 stopped、start 后 running、stop 后 stopped，重复 start 返回错误。

- [x] **Step 2: 运行测试确认失败**

Run: `cargo test -p capybara-mihomo-manager`
Expected: FAIL because adapter API does not exist.

- [x] **Step 3: 实现 adapter trait 与 fake**

定义 `MihomoAdapter`，实现 `FakeMihomoAdapter`。Fake adapter 不启动进程、不监听端口。

- [x] **Step 4: 运行测试确认通过**

Run: `cargo test -p capybara-mihomo-manager`
Expected: PASS.

### Task 3: Runtime Manager、错误与日志

**Files:**
- Create: `crates/capybara-runtime/Cargo.toml`
- Create: `crates/capybara-runtime/src/lib.rs`
- Create: `crates/capybara-runtime/src/log_buffer.rs`
- Create: `crates/capybara-runtime/src/redaction.rs`
- Test: `crates/capybara-runtime/src/lib.rs`
- Test: `crates/capybara-runtime/src/log_buffer.rs`
- Test: `crates/capybara-runtime/src/redaction.rs`

- [x] **Step 1: 写状态机和脱敏失败测试**

覆盖 start、stop、restart、crash、重复 start、非法 stop、日志上限和 token/password/URL userinfo 脱敏。

- [x] **Step 2: 运行测试确认失败**

Run: `cargo test -p capybara-runtime`
Expected: FAIL because runtime crate does not exist.

- [x] **Step 3: 实现 Runtime Manager**

Runtime Manager 串行化全部状态修改，生成递增 snapshot sequence；日志缓存上限 500；crash 仅允许 Demo backend。

- [x] **Step 4: 运行测试确认通过**

Run: `cargo test -p capybara-runtime`
Expected: PASS.

### Task 4: Rust 设置存储

**Files:**
- Create: `apps/desktop/src-tauri/src/settings.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [x] **Step 1: 写设置失败测试**

覆盖默认值、往返保存、损坏 JSON 回退、未知版本回退和原子替换后无临时残留。

- [x] **Step 2: 运行测试确认失败**

Run: `cargo test -p capybara-desktop settings`
Expected: FAIL because settings module does not exist.

- [x] **Step 3: 实现 SettingsStore**

使用 `serde_json` 和同目录临时文件。正式路径来自 Tauri app config 目录，测试使用注入的临时目录。

- [x] **Step 4: 运行测试确认通过**

Run: `cargo test -p capybara-desktop settings`
Expected: PASS.

### Task 5: Tauri commands、事件和受控退出

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/capabilities/default.json` if no new capability is required, keep it unchanged

- [x] **Step 1: 写 command contract 与退出幂等失败测试**

测试 command result 映射、退出门闩只允许一次、关闭偏好来自设置快照。

- [x] **Step 2: 运行测试确认失败**

Run: `cargo test -p capybara-desktop`
Expected: FAIL because new state and commands are missing.

- [x] **Step 3: 接入 Tauri**

注册 Runtime commands、settings commands 和 exit command；状态/日志变化发送 `runtime-state-changed`、`runtime-log`。托盘 Exit、exit close behavior 和 UI exit 共用受控退出。

- [x] **Step 4: 运行测试确认通过**

Run: `cargo test -p capybara-desktop`
Expected: PASS.

### Task 6: TypeScript contracts 与 bridge

**Files:**
- Create: `apps/desktop/src/platform/runtime.ts`
- Create: `apps/desktop/src/platform/runtime.test.ts`
- Create: `apps/desktop/src/platform/settings.ts`
- Create: `apps/desktop/src/platform/settings.test.ts`
- Modify: `apps/desktop/src/platform/tauri.ts`

- [x] **Step 1: 写 bridge 失败测试**

测试 unavailable 浏览器降级、成功数据、结构化错误、事件 payload 校验和 listener 清理。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @capybara/desktop test -- src/platform`
Expected: FAIL because runtime/settings bridges do not exist.

- [x] **Step 3: 实现 typed bridge**

固定 command 名称和参数，不暴露任意 invoke。事件 listener 返回幂等取消函数。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @capybara/desktop test -- src/platform`
Expected: PASS.

### Task 7: Runtime Demo UI

**Files:**
- Create: `apps/desktop/src/features/runtime/RuntimeDemoPanel.tsx`
- Create: `apps/desktop/src/features/runtime/RuntimeDemoPanel.test.tsx`
- Create: `apps/desktop/src/features/runtime/runtime-demo.css`
- Modify: `apps/desktop/src/main.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPage.tsx`

- [x] **Step 1: 写 UI 失败测试**

测试 Demo 标识、初始 stopped、start/stop/restart/crash、pending 防重复、结构化错误和最近日志。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @capybara/desktop test -- RuntimeDemoPanel`
Expected: FAIL because component does not exist.

- [x] **Step 3: 实现 Runtime Demo**

组件只通过 bridge 访问 Runtime；A/C 主题复用现有 token。Settings 显示面板，Overview Mock 保持不变。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @capybara/desktop test -- RuntimeDemoPanel`
Expected: PASS.

### Task 8: 设置迁移与单一来源

**Files:**
- Modify: `apps/desktop/src/app/App.tsx`
- Modify: `apps/desktop/src/app/theme/ThemeProvider.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPage.tsx`
- Modify: `apps/desktop/src/shared/closeBehavior.ts`
- Test: `apps/desktop/src/app/App.test.tsx`
- Test: `apps/desktop/src/app/theme/ThemeProvider.test.tsx`
- Test: `apps/desktop/src/features/settings/SettingsPage.test.tsx`

- [x] **Step 1: 写迁移失败测试**

测试 Tauri 模式优先读取 Rust 设置、旧 localStorage 一次性迁移、保存失败不更新 UI、浏览器预览保持本地持久化。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @capybara/desktop test -- App ThemeProvider SettingsPage`
Expected: FAIL on new migration expectations.

- [x] **Step 3: 实现单一来源与兼容层**

Tauri 使用 Rust settings；浏览器使用 localStorage。迁移成功后移除旧键或写入稳定迁移标记。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @capybara/desktop test -- App ThemeProvider SettingsPage`
Expected: PASS.

### Task 9: 完整验证与文档

**Files:**
- Create: `docs/development/stage-2-runtime-report.md`
- Modify: `README.md`
- Modify: `docs/development/technical-spike-report.md`
- Modify: `scripts/capture-ui.mjs`

- [x] **Step 1: 运行全部静态检查和测试**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

- [x] **Step 2: 运行 Rust 和构建验证**

Run: `cargo fmt -- --check && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS.

- [x] **Step 3: 构建并启动 release**

Run: `pnpm tauri build --no-bundle`
Expected: PASS and `capybara-desktop.exe` exists.

- [x] **Step 4: 自动操作 Runtime Demo**

通过 WebView2 CDP 验证 start、stop、restart、crash 和错误提示，确认无残留进程。

- [x] **Step 5: 生成 A/C Settings 截图**

生成标准、窄窗口和最小窗口截图，并人工检查布局。

- [x] **Step 6: 更新阶段报告**

记录实际命令、测试数量、release 指纹、截图、已验证行为、残余风险和阶段 3 入口条件。
