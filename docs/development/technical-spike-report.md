# 第一阶段技术检查报告

日期：2026-11-05

范围：CapybaraProxy 桌面 UI 原型，Windows 优先验证

> 本报告只记录第一阶段结果，不包含第二阶段 Runtime 骨架。当前构建、测试、依赖审计和 Runtime Demo 验收以 `docs/development/stage-2-runtime-report.md` 为准；本报告中的审计数据是第一阶段当次证据，不能替代第二阶段复验。

## 1. 结论

第一阶段桌面原型已具备可运行的 React + TypeScript + Tauri + Rust 骨架。Windows release 程序已实际启动，原生无边框窗口和 WebView 内容可渲染；A/C 主题、七个导航入口、Overview Mock 首页、Settings 基础结构和主题持久化均已验证。

本轮阶段检查未发现 P0/P1 缺陷。检查中发现并修复了延迟状态语义问题：高延迟和未测量延迟不得使用成功状态，未测量延迟仪表不得绘制发光端点。其余未完成项均为当前阶段明确排除的能力，或已记录的验证边界。

本阶段没有接入 Mihomo、真实 Runtime、TUN、系统代理或管理员权限操作。

## 2. 验证环境

| 项目 | 实测结果 |
| --- | --- |
| 操作系统 | Windows 10 专业版 22H2，10.0.19045，x64 |
| WebView2 | 156.0.4314.58 |
| MSVC | Visual Studio 生成工具 2022 |
| Rust | 1.99.1，stable-x86_64-pc-windows-msvc |
| Cargo | 1.99.1 |
| Node.js | 22.14.0 |
| pnpm | 10.12.1 |
| Edge 截图环境 | 156.0.4314.58 |
| Tauri | 2.12.5 |
| Tauri Build | 2.7.4 |

依赖安装目录、pnpm 缓存、Cargo home 和 Cargo target 均配置在 `F:\codex-install`。本轮最终无安装包构建使用 `F:\codex-install\cargo-target`，因此 release 产物位于该目录的 `release` 子目录。

## 3. 构建与测试结果

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过，无 ESLint 输出 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 11 个测试文件、30 项测试全部通过 |
| `pnpm build` | 通过；JS 323.61 kB（gzip 100.58 kB），CSS 37.98 kB（gzip 10.80 kB） |
| `cargo fmt -- --check` | 通过 |
| `cargo test` | 2 项测试通过 |
| `cargo clippy --all-targets -- -D warnings` | 通过，无警告 |
| `cargo check` | 通过 |
| `node --check scripts/capture-ui.mjs` | 通过 |
| `pnpm audit --prod --audit-level high` | 通过，未发现已知生产依赖漏洞 |
| `cargo audit` | 407 个 crate 扫描完成；无实际 vulnerability，存在 2 条允许的 warning |
| `tauri build --no-bundle` | 通过；Tauri 阶段 JS 322.58 kB（gzip 100.25 kB），CSS 37.87 kB（gzip 10.78 kB） |

RustSec warning：

- `RUSTSEC-2024-0370`：`proc-macro-error 1.0.4` 已停止维护，属于构建期传递依赖。
- `RUSTSEC-2024-0429`：`glib 0.18.5` 存在 unsound 警告，当前主要涉及 Linux 路径，Windows 构建未触发；进入 Linux 验证阶段时需要复核升级条件。

release 程序路径：

`F:\codex-install\cargo-target\release\capybara-desktop.exe`

release 可执行文件大小：9,179,136 B。

release SHA-256：`55BAC6DE0CFC0FC3AD0C832800D27753E82C8EE3FBB80AD1C06B813CA0786039`。

## 4. 已验证行为

- Windows release 程序成功启动，原生无边框窗口和 WebView UI 正常渲染。
- 使用 WebView2 CDP 实际点击并验证 Overview、Proxies、Rules、Connections、Profiles、Logs、Settings 七个导航入口。
- A Cyber Flow 为默认主题，C Warm Flow 可通过主题控件切换。
- A/C 主题在页面重载后均保持选择，主题键为 `capybara.theme`。
- A 主题首页显示 Network Orb，C 主题首页显示原创蓝白吉祥物 SVG。
- 生产资源指纹与本次构建产物一致；本地字体加载成功，没有横向溢出。
- 未发现运行时异常、控制台错误或生产 CSP 资源阻断。
- Overview 明确显示 `Mock preview` 和 `Mock locations`，没有把示例代理状态包装为真实 Runtime 状态。
- 流量、会话和连接区域分别明确标记为 `Mock traffic`、`Mock sessions`，生产图表模块本身不再合成默认流量。
- 流量图表在独立组件内采样和更新，历史数据限制为 28 个采样点。
- Proxy Group 切换会过滤节点并自动选择该组首节点，节点延迟和地图标记同步更新；该行为仍仅属于隔离的 Mock 预览。
- 首页隐藏时图表采样停止；原生隐藏状态同时暂停 CSS 动画。
- 默认关闭请求会隐藏窗口并保留进程；切换关闭偏好后，原生命令和本地持久化均通过测试。
- A/C 标准窗口、900px 窄窗口、实际最小 820×680 窗口以及 Settings 截图均已生成，检查范围内没有横向溢出或可见组件越界；最小高度下允许纵向滚动。

运行截图：

- `artifacts/screenshots/release-overview-a.png`
- `artifacts/screenshots/release-overview-c.png`
- `artifacts/screenshots/release-overview-a-narrow.png`
- `artifacts/screenshots/release-overview-c-narrow.png`
- `artifacts/screenshots/release-overview-a-minimum.png`
- `artifacts/screenshots/release-overview-c-minimum.png`
- `artifacts/screenshots/release-settings-a.png`
- `artifacts/screenshots/release-settings-c.png`
- `artifacts/screenshots/release-settings-a-narrow.png`
- `artifacts/screenshots/release-settings-c-narrow.png`
- `artifacts/screenshots/release-settings-a-minimum.png`
- `artifacts/screenshots/release-settings-c-minimum.png`

## 5. 资源短测

测试对象为 release 程序及其 WebView2 进程树。CPU 百分比按单核增量折算，不代表整机或多核总占用百分比。

| 场景 | 时长 | 进程数 | CPU 增量 | 单核 CPU | 工作集 | 私有内存 | 句柄 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A 主题前台 | 10 秒 | 7 | 0.172 秒 | 1.72% | 466,644,992 B（约 445 MB） | 226,824,192 B（约 216 MB） | 未记录 |
| C 主题前台 | 10 秒 | 7 | 0.266 秒 | 2.66% | 475,639,808 B（约 454 MB） | 236,068,864 B（约 225 MB） | 未记录 |
| 主窗口隐藏 | 60 秒 | 7 | 0.172 秒 | 0.29% | 422.0 MB，变化 -0.2 MB | 196.8 MB，变化 -0.3 MB | 3,730，变化 -20 |

隐藏场景中，页面可见性为 `hidden`，流量采样值保持不变，证明隐藏后没有继续更新图表。内存主要来自 WebView2 子进程，不能仅归因于 React 应用代码。

这些数据仅为 10 秒和 60 秒短测，不满足 `performance-requirements.md` 要求的 5 到 10 分钟场景，不能据此确认长期无增长或最终性能预算达标。

## 6. 问题分级与处置

### 已修复

1. 高延迟和未测量延迟使用了成功视觉状态，可能误导用户。现已分别映射为警告/不可用状态，并增加回归测试。
2. 未测量延迟的环形仪表仍会绘制终点光点。现仅在存在有效有限数值时绘制该端点，并增加回归测试。
3. Rust 测试代码存在 rustfmt 格式问题。现已修复并通过 `cargo fmt -- --check`。
4. 截图脚本固定调试端口，重复运行时可能与现有进程冲突。现支持通过 `CAPYBARA_CDP_PORT` 指定端口。
5. Proxy Group 切换此前只更新本地显示，节点列表不联动。现已按代理组过滤节点、自动选择组内首节点，并同步更新延迟和地图。
6. 生产图表模块此前可能在空数据时合成默认曲线。现已移除合成流量，空数据保持不绘制；Mock 流量只在明确隔离的预览数据层提供。
7. Mock 流量、会话和连接数据此前标注不够明确。现已分别显示 `Mock traffic`、`Mock sessions` 等提示，避免被误认为真实运行状态。

### 残余风险

1. 侧栏宽度为 226/1280，约占 17.7%；参考图约为 22%-25%，比例仍有可见差异。
2. A/C 视觉与参考图仍存在差异：品牌字标、C 吉祥物质感、地图细节和标准窗口底部留白比例不完全一致。
3. 节点地图是明确标注的 Mock 位置示意，不是可信地理数据；不得在后续阶段复用为真实节点地理位置。
4. 启动时 localStorage 主题偏好异步同步 Rust，存在极小的首次关闭行为竞态；需要在 Runtime 阶段改为单一持久化来源或完成状态握手。
5. 60 秒隐藏测试表现稳定，但未执行 5 到 10 分钟长测，也没有长时间流量持续变化测试；现有短测不能宣称最终性能预算达标。
6. 当前代理地址访问 crates.io 时可能受 Schannel TLS 与 DNS 影响。工程已生成 `Cargo.lock`，全新机器仍需可用网络或预先准备离线 crate 缓存。
7. 仅验证 Windows。macOS、Linux 的 WebView、字体、透明、阴影和托盘行为未验证；RustSec 的 `glib` 警告也应在 Linux 路径复核。
8. 当前自动化桌面会话无法可靠定位通知区中的托盘图标；托盘 Show/Exit 仍需人工鼠标验收。
9. 尚未构建 NSIS 安装包，也未验证签名、升级、卸载和发布流程。
10. 窗口级最小化、最大化、关闭失败目前只记录控制台错误，没有面向用户的错误提示；正式阶段接入统一错误反馈时应补齐。
11. 当前退出路径使用 `app.exit(0)`。第一阶段没有 Runtime 子进程时可接受，接入 Mihomo 和 Runtime Manager 后必须改为受控清理后再退出。
12. 当前七个路由均由主包直接引入，没有按页面懒加载。第一阶段页面轻量，未形成明显资源问题；后续 Proxies、Connections、Logs 等服务页变重时应拆分路由包。

## 7. 托盘验证边界

Tauri 已创建托盘菜单和隐藏的 `tray_icon_app` 原生消息窗口，代码包含 Show、Exit、托盘左键恢复与关闭行为切换。默认关闭隐藏已经通过标准窗口关闭消息自动验证。

当前自动化桌面会话无法公开定位 Windows 通知区中收起的 CapybaraProxy 图标，因此“点击托盘 Show 恢复窗口”和“点击托盘 Exit 退出”仍要求人工鼠标验收，不能记录为已自动验证。

## 8. 后续入口条件

进入下一阶段前应人工确认 Windows 托盘 Show/Exit 与 Settings 的“退出应用”路径，并补做 5 到 10 分钟隐藏驻留测试。Runtime Manager、Mihomo、系统代理和 TUN 必须继续作为后续独立阶段实施，不能复用本阶段 Mock 数据冒充真实状态。
