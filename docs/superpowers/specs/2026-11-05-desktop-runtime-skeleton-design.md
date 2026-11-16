# FlowProxy 桌面 Runtime 骨架设计

日期：2026-11-05

阶段：开发任务书阶段 2

## 1. 目标

建立可测试的桌面 Runtime 骨架，并用明确标识的 Demo 后端验证完整生命周期，不接入真实 Mihomo、系统代理或 TUN。

本阶段必须完成：

- Fake Mihomo adapter 与 Runtime 状态机。
- start、stop、restart、crash 和错误状态流。
- 重复启动保护与统一错误类型。
- 有上限的运行日志和安全脱敏。
- typed Tauri commands/events。
- Settings Runtime Demo 操作与状态展示。
- Rust 管理的设置持久化，迁移现有主题和关闭行为偏好。
- 关闭窗口驻留、托盘恢复和受控退出。
- 为系统代理和 TUN 保留明确未实现的能力接口。

本阶段明确不实现：

- 下载、安装或启动真实 Mihomo。
- 真实控制 API、系统代理或 TUN。
- Overview 服务数据切换到 Runtime。
- Android 或 macOS/Linux 实机验收。

## 2. 架构

工程使用根级 Cargo workspace：

- `crates/flowproxy-contracts`：共享 Runtime 类型、错误、日志和快照。
- `crates/mihomo-manager`：`MihomoAdapter` trait 和 `FakeMihomoAdapter`。
- `crates/flowproxy-runtime`：状态机、命令串行化、日志缓存和 adapter 编排。
- `apps/desktop/src-tauri`：Tauri 组合根、设置存储、commands/events、窗口与托盘生命周期。
- `apps/desktop/src`：Runtime Demo UI、typed bridge 和现有设置集成。

Runtime crate 不依赖 Tauri。Tauri 通过 `AppState` 持有 Runtime Manager，并把状态变化转换为窗口事件。阶段 3 增加真实 adapter 时不得修改前端 command/event contract。

## 3. Runtime 模型

Runtime 状态：

- `stopped`
- `starting`
- `running_disconnected`
- `connected`
- `stopping`
- `error`
- `permission_required`

阶段 2 Fake adapter 启动后进入 `running_disconnected`。`connected` 和 `permission_required` 只建模，不由 Demo 宣称真实网络连接。

快照字段：

- `backend`: `demo` 或 `mihomo`
- `state`
- `sequence`
- `started_at_ms`
- `last_error`
- `log_count`

所有修改操作必须经过 Runtime Manager。重复 start 返回稳定的 `already_running` 错误，不增加操作次数。crash 仅在 `backend = demo` 时可用，用于验证异常恢复。

## 4. Commands、Events 与错误

Tauri commands：

- `get_runtime_snapshot`
- `start_runtime`
- `stop_runtime`
- `restart_runtime`
- `simulate_runtime_crash`
- `get_runtime_logs`
- `get_settings`
- `save_settings`
- `request_application_exit`

统一 command result 使用：

```text
{ ok: true, data: ... } | { ok: false, error: { code, message, retryable } }
```

状态变化事件为 `runtime-state-changed`，日志事件为 `runtime-log`。状态事件包含完整不可变快照。日志事件只发送新增的单条日志。

## 5. 日志与脱敏

日志保存在固定上限的 `VecDeque` 中，默认最多 500 条。每条记录包含序号、时间、级别、消息和可选错误码。

脱敏规则覆盖：

- `token=`
- `secret=`
- `password=`
- `authorization:`
- URL userinfo
- Clash/Mihomo 常见 `secret` 字段

日志存储前脱敏，不保存原始敏感文本。单元测试必须使用包含敏感信息的输入验证输出不含原值。

## 6. 设置持久化

Rust 设置文件采用版本化 JSON：

```json
{
  "version": 1,
  "theme": "cyber_flow",
  "close_behavior": "hide_to_tray"
}
```

设置文件位于 Tauri app config 目录。写入采用同目录临时文件加原子替换；文件损坏或版本不支持时回退默认值并保留可读错误日志。

Tauri 正式模式的单一来源是 Rust 设置。前端启动时读取 Rust 设置，并把仍存在的 `localStorage` 旧值一次性迁移过去。浏览器预览继续使用 `localStorage`，但不声称原生持久化。

关闭行为在窗口事件发生前从设置存储加载到 `AppState`，因此启动后立即关闭窗口不会落入旧的异步竞态。

## 7. 生命周期与退出

- 默认关闭按钮隐藏窗口，Runtime 和进程保持运行。
- 关闭偏好为 exit 时执行受控退出。
- 托盘 Exit 与 Settings 的“退出应用”共用同一退出流程。
- 受控退出先停止 Demo Runtime，再退出 Tauri。
- 退出流程使用幂等标志，避免关闭事件和托盘事件重复触发。
- stop 和 restart 失败必须返回结构化错误并保持可观察状态。

系统代理与 TUN 通过禁用状态和 `Runtime unavailable` 展示，仅保留 adapter 边界，不提供可执行按钮。

## 8. UI

Settings 新增 `Runtime Demo` 面板，显示：

- `Demo backend` 标识。
- 当前状态和序号。
- Start、Stop、Restart、Simulate crash 操作。
- 最近日志预览。
- 结构化错误反馈。

按钮在执行过程中禁用。Demo 状态不得显示成真实代理已连接，也不得修改 Overview Mock 状态。

## 9. 测试与验收

Rust：

- 状态机合法/非法转换。
- 重复启动保护。
- stop、restart、crash 状态流。
- 日志上限与脱敏。
- 设置默认值、往返保存和损坏文件回退。
- Tauri command contract 与前端 TypeScript 类型保持一致。

前端：

- Runtime Demo 初次加载。
- start、stop、restart、crash 操作。
- pending 防重复点击。
- 错误展示。
- 设置迁移和 Rust 持久化路径。
- 浏览器预览降级路径。

验收命令：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm tauri build --no-bundle
```

Windows release 必须实际启动，Runtime Demo 状态变化必须通过 UI 自动操作验证，并生成 A/C Settings 截图。

## 10. 安全边界

- 不开放 shell、文件系统或网络 capability。
- 前端只能调用固定 typed commands。
- 日志在进入缓存前脱敏。
- 不读取或执行任何未知二进制。
- 不监听网络端口。
- 不修改系统代理或 TUN。
- Demo backend 在 snapshot 中显式标识，防止模拟状态冒充真实核心。
