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
- 阶段 5：Android Compose UI、A/C 主题、VPNService 授权与前台服务、通知 Stop、网络状态同步、33 项 JVM 测试与 2 项仪器化测试已完成。
- 阶段 6：性能采样、视觉证据、订阅导入和可分发产物。详见 `docs/development/stage-6-performance-report.md`。
- 阶段 7：多订阅库、覆写、DNS/TUN、规则调试器、命令面板、流量记账、诊断包与 CI。详见 `docs/development/ci.md`。
- 当前边界：TUN 仅探测，不激活；macOS/Linux 系统集成未实现；Android 真实 Mihomo Native/TUN 未接入。
- 平台验证边界：桌面仅在 Windows 10 x64 完成运行验收；macOS 和 Linux 仍为 `unverified`。

## 安装与实测

桌面端安装包自带已校验的 Mihomo 核心与 geodata，安装后无需再手动放置文件。

1. 运行 `FlowProxy_<version>_x64-setup.exe`，按当前用户安装（不要求管理员权限）。
2. 启动后进入 **Profiles** 页面，粘贴订阅 YAML 或填写订阅 URL，点击 **Import subscription**。
3. 回到 **Overview**，点击 hero 区域下方的 **Connect**。
4. 状态变为 `Connected` 后，Proxies 页面会列出订阅里的真实节点。
5. 需要走系统代理时，在 **Settings → System integration** 打开 **System proxy**。
6. 界面语言在 **Settings → Appearance → Language** 切换（中文 / English），选择会持久化；旧版 `settings.json` 没有该字段时按系统语言初始化。

Settings 页面按 `配置模式`（简易 / 标准 / 宽松）显示不同数量的分组，全部为单列全宽卡片，顶部有分组导航。除主题、语言与系统集成外，还包括：

- **窗口与启动**：关闭按钮行为（隐藏到托盘 / 退出）、静默启动、启动后自动连接、开机启动。
- **订阅**：启动时更新、自动更新间隔（预设或 1–168 小时自定义）、订阅 User-Agent、
  更新后自动重启核心；也可在此对接外部 Sub-Store 服务后一键导入（宽松模式）。
- **日志**：Runtime 事件写入按天滚动的日志文件，可设置保留天数、打开目录、清空文件；
  可一键导出脱敏诊断包（环境、设置摘要、日志；订阅 URL、Token 与密钥已移除）。
- **内核版本**：可登记并切换多份 Mihomo 构建。登记时记录校验值，切换前重新核对；
  换核在下次启动时生效，内置核心始终可回退。
- **核心与高级内核**：日志级别、IPv6、统一延迟、并发 TCP、固定混合端口、延迟测试地址与超时。
- **系统集成**：系统代理开关与可配置的旁路列表、TUN（已提权且装了 Wintun 时可开启）、
  开机启动。
  系统代理开关会被记住：退出时把三项注册表值（开关、地址、旁路列表）还原为
  用户原值，下次启动核心连接后再自动重新应用。
- **DNS**：以 `dns:` 块写入当前订阅的覆写（预设 Cloudflare / 阿里 / 谷歌 / 系统，
  或自定义解析服务器与 Fake-IP 地址段），刷新订阅不会丢失。
- **托盘**：菜单与提示中显示状态与当前节点、代理模式（规则 / 全局 / 直连，点击即切换）、
  打开日志目录；托盘图标可绘制实时上下行速率（图标数字 / 仅提示 / 不显示）。
- **动画效果**：完整 / 减少。

页面上的常用操作：

- **订阅**：可保存多份订阅并随时切换；显示服务商在 `subscription-userinfo` 中给出的
  已用流量、总量与到期时间；每份订阅可保存自定义规则与覆写 YAML。
- **概览**：除本次会话流量外，还显示「今日」与「近 7 天」累计流量。这份统计由
  FlowProxy 自己按天记账（`traffic.json`），核心重启后不会归零。
- **代理组**：按名称搜索组或节点，按延迟 / 名称排序，一键测速全部组；可折叠分组，
  可置顶常用节点；排序、折叠与置顶状态都会记住；页面底部列出已记录的测速历史。
- **规则**：带搜索框；显示每条规则当前命中的连接数；列出配置里的规则集与代理集来源；
  底部有规则调试器，输入域名或 IP 即可看到会命中哪条规则（仅评估域名与 IP 类规则，
  跳过的规则会明确告知）。
- **连接**：带搜索框；点开一行可看完整详情（域名、目标地址、规则、链路、上传量、
  建立时间）；可一键全部关闭。
- **日志**：带搜索框；可暂停、清空视图。清空视图只影响屏幕，磁盘上的日志文件不受影响。
- **任意页面**：`Ctrl/Cmd + K` 打开命令面板，可跳转页面、切换代理模式、直接选中节点。

订阅能力的完整边界见 `docs/development/subscription-scope.md`。

安装包的内置资源：

- `resources/mihomo/mihomo.exe`：Mihomo `v1.19.33`，启动前校验 SHA-256。
- `resources/geodata/geosite.dat`、`geoip.metadb`：订阅里的 `GEOIP`/`GEOSITE` 规则依赖它们；缺失时 Mihomo 会联网下载并在离线环境超时失败。

构建安装包前先准备资源：

```powershell
node scripts/prepare-bundle-resources.mjs

$env:CARGO_NET_OFFLINE = 'true'
pnpm tauri build --bundles nsis
```

`apps/desktop/src-tauri/resources/` 不入库（约 74 MB 二进制），由上述脚本按固定哈希复制。


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
4. `flowproxy-desktop.exe` 同目录下 `resources\mihomo\mihomo.exe`（安装包的默认布局）。
5. `flowproxy-desktop.exe` 同目录下 `mihomo\mihomo.exe`。
6. Tauri 应用配置目录下 `mihomo\mihomo.exe`，Windows 通常为 `%APPDATA%\com.flowproxy.desktop\mihomo\mihomo.exe`。

开发时若不想重新打包，可以直接指定已校验的文件：

```powershell
$env:FLOWPROXY_MIHOMO_PATH = 'F:\codex-install\mihomo\v1.19.33\mihomo-windows-amd64.exe'
```

安装包已捆绑 Mihomo 与 geodata，无需手动放置。开发构建（`pnpm tauri:dev`、`pnpm tauri build` 且未跑资源准备脚本）不含核心；文件缺失、哈希不符或版本不符时，应用仍可启动，但 Runtime 会显示不可用并拒绝启动核心。

Mihomo 运行时使用应用配置目录下生成的 `mihomo\config.yaml`。导入订阅后，该文件由「订阅原文 + FlowProxy 受控块」生成：订阅里的端口、控制端、secret、`allow-lan`、`bind-address` 和 `authentication` 一律被移除并替换。控制端与 secret 另外通过命令行 `-ext-ctl` / `-secret` 覆盖。候选配置执行 `mihomo -t -d <工作目录> -f <文件>` 校验，`-d` 是必需的——否则带 `GEOIP`/`GEOSITE` 规则的订阅会因为找不到 geodata 而联网超时失败。Windows 系统代理只会在 Runtime 已连接、Settings 中显式启用后切换到 Mihomo 的受控回环端口；Stop、Restart、崩溃恢复、受控退出和下次启动的 Journal 恢复会按所有权规则还原或保护用户改动。本阶段不创建或激活 TUN。

## 检查与构建

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/verify-locale-keys.mjs

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
