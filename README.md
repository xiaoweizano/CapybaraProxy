# FlowProxy V1 — 产品设计与开发规范

> 品牌主张：**Your Network. Your Flow.**  
> 中文表达：让网络自由流动。  
> 文档状态：V1 设计基线（可实施，技术细节以 POC 验证结果为准）

## 本仓库文档

- `docs/product/product-requirements.md`：产品范围、平台、核心功能与行为约定
- `docs/ui-design/design-reference.md`：两张用户确认的 UI 参考图和还原原则
- `docs/ui-design/theme-cyber-flow.md`：A 主题规范（默认）
- `docs/ui-design/theme-warm-flow.md`：C 主题规范（可切换）
- `docs/ui-design/mascot-guidelines.md`：C 主题吉祥物规范
- `docs/ui-design/component-specification.md`：首页布局、组件和交互规格
- `docs/architecture/system-architecture.md`：系统整体架构与模块边界
- `docs/architecture/desktop-tauri-rust.md`：桌面端架构
- `docs/architecture/android-architecture.md`：Android 架构
- `docs/architecture/performance-requirements.md`：性能与资源预算原则
- `docs/development/codex-development-guide.md`：Codex 执行说明、阶段任务与验收标准
- `docs/development/technical-spike-report.md`：第一阶段技术检查与 Windows 验证结果
- `docs/development/stage-2-runtime-report.md`：第二阶段 Runtime 骨架、构建、自动验收与残余风险
- `docs/development/stage-3-mihomo-report.md`：第三阶段真实 Mihomo 集成、安全检查、验收证据与残余风险
- `docs/development/stage-4-system-integration-report.md`：第四阶段 Windows 系统集成、验收证据与残余风险
- `docs/architecture/platform-support-matrix.md`：桌面与 Android 的平台能力状态矩阵
- `docs/architecture/adr-0001-desktop-stack.md`：桌面端首批依赖选型记录
- `assets/design-reference/`：用户提供的 A/C 主题视觉参考图

## 已确认决策

1. 产品名：FlowProxy。
2. 目标平台：Windows、macOS、Linux、Android。
3. 代理核心：Mihomo，由 FlowProxy 自行分发、启动、监控和管理。
4. 桌面方向：React + TypeScript + Tauri + Rust，先做技术验证再锁定具体依赖。
5. Android：Kotlin + Jetpack Compose，使用 Android `VpnService`。
6. 主题：A Cyber Flow 默认；C Warm Flow 可切换。桌面和 Android 均支持。
7. 关闭主窗口：默认隐藏到系统托盘并继续运行代理；设置中可改为退出程序。
8. 性能优先：控制 CPU、内存、后台轮询、动画和高频 UI 更新。
9. UI 以参考图为视觉基准；适配不同分辨率时保持布局关系、视觉层级和组件比例，不机械固定像素。
10. Android 与桌面共享设计 tokens、配置格式和数据契约，不强求共享 UI 代码。

## 给 Codex 的第一条指令

先完整阅读本目录所有 Markdown 规范和两张参考图。第一阶段建立可运行的项目骨架与静态 UI 原型；第二阶段建立隔离的 Fake Runtime 骨架、原生设置和受控退出；第三阶段完成 Windows 上的真实 Mihomo 受控集成；第四阶段完成 Windows 当前用户系统代理、开机启动和系统集成状态。当前 TUN 仅做能力探测，不执行激活；订阅下载、管理员权限操作和完整 Android 功能仍未实现。macOS/Linux 的系统集成保持 `unverified`，不调用未验证的修改后端。不自行改变视觉方向，不一次性实现所有平台功能。每阶段完成后运行构建、测试并汇报实际结果。

## 当前阶段

- 阶段 1：桌面 UI 原型已完成。
- 阶段 2：Runtime 骨架、Runtime Demo UI、原生设置和受控退出已完成。
- 阶段 3：Windows 上的真实 Mihomo 子进程、控制 API、真实数据页面和生命周期集成已完成。
- 阶段 4：Windows 当前用户系统代理、开机启动、恢复 Journal、能力状态和 Settings 集成面板已完成。
- 当前边界：TUN 仅探测，不激活；订阅下载、管理员权限操作和 Android 实现尚未接入。
- 平台验证边界：阶段 4 仅在 Windows 10 x64 上完成运行验收；macOS 和 Linux 仍为 `unverified`。

## 本地运行

依赖安装和构建缓存统一放在 `F:\codex-install`。当前网络环境访问 crates.io 不稳定时，可使用已经锁定的 Cargo 依赖离线构建。

```powershell
$env:HTTP_PROXY = 'http://192.168.1.2:7890'
$env:HTTPS_PROXY = 'http://192.168.1.2:7890'
$env:NO_PROXY = 'localhost,127.0.0.1'
$env:CARGO_HOME = 'F:\codex-install\cargo-home'
$env:CARGO_TARGET_DIR = 'F:\codex-install\cargo-target'

pnpm install
pnpm dev
pnpm tauri:dev
```

## Mihomo 准备

阶段 3 锁定 Mihomo `v1.19.33`，Windows x64 可执行文件的 SHA-256 为：

```text
1cde41cfffd3de0aedad63c0a8515e1ce5eea507e8133aed0f637d316c93800a
```

应用启动时会按以下顺序查找可执行文件，并在执行前同时校验 SHA-256 和 `-v` 版本输出：

1. 环境变量 `FLOWPROXY_MIHOMO_PATH` 指向的文件。
2. `flowproxy-desktop.exe` 同目录下的 `mihomo.exe`。
3. `flowproxy-desktop.exe` 同目录下 `resources\mihomo.exe`。
4. `flowproxy-desktop.exe` 同目录下 `mihomo\mihomo.exe`。
5. Tauri 应用配置目录下 `mihomo\mihomo.exe`，Windows 通常为 `%APPDATA%\com.flowproxy.desktop\mihomo\mihomo.exe`。

本地开发可以直接指定已校验的文件：

```powershell
$env:FLOWPROXY_MIHOMO_PATH = 'F:\codex-install\mihomo\v1.19.33\mihomo-windows-amd64.exe'
```

当前 release 构建不会自动下载或附带 Mihomo。文件缺失、哈希不符或版本不符时，应用仍可启动，但 Runtime 会显示不可用并拒绝启动核心。

Mihomo 运行时使用应用配置目录下生成的 `mihomo\config.yaml`。生成配置固定使用本机回环控制端口、随机 API secret、`allow-lan: false`、`bind-address: 127.0.0.1`、空监听器和禁用 TUN，并对候选配置执行 `mihomo -t` 校验。Windows 系统代理只会在 Runtime 已连接、Settings 中显式启用后切换到 Mihomo 的受控回环端口；Stop、Restart、崩溃恢复、受控退出和下次启动的 Journal 恢复会按所有权规则还原或保护用户改动。本阶段不创建或激活 TUN。

## 检查与构建

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

pnpm audit
& 'F:\codex-install\cargo-tools\bin\cargo-audit.exe' audit --file Cargo.lock
```

已实际验证的无安装包 release 构建：

```powershell
$env:CARGO_NET_OFFLINE = 'true'
pnpm tauri build --no-bundle
```

生成程序位于 `F:\codex-install\cargo-target\release\flowproxy-desktop.exe`。生产组合根连接真实 Mihomo adapter；Overview、Proxies、Rules、Connections、Profiles 和 Logs 的数据均来自运行时控制 API，不可用或未启动时显示明确空态/错误态，不以 Mock 数据冒充真实状态。

Windows 上的 `DIRECT` 延迟测试受外部测试目标影响，可能返回 HTTP 503；这是阶段 3 已记录的已知限制，不代表控制 API 或代理进程失效。

## 维护说明

提交以远程仓库贡献者身份为准；文档更新与对应阶段报告的改动请一并提交，保持 README 与 `docs/` 内容同步。

阶段 2 的具体测试结果、截图和残余风险见 `docs/development/stage-2-runtime-report.md`。阶段 3 的完整验收结果、截图与残余风险见 `docs/development/stage-3-mihomo-report.md`。阶段 4 的系统集成结果、A/C 截图和残余风险见 `docs/development/stage-4-system-integration-report.md`。
