# CapybaraProxy

> **Your Network. Your Flow.** / 让网络自由流动。
>
> English: [README.en.md](README.en.md)

CapybaraProxy 是一个跨平台的网络代理客户端。它自带并托管 Mihomo 核心，用统一的界面管理订阅、代理组、规则、连接与系统代理，而不是让用户直接编辑 YAML 或操作命令行。

当前代码库包含可运行的 Windows 桌面端，以及 Android 端的界面与服务骨架。

---

## 目录

- [能力概览](#能力概览)
- [快速开始](#快速开始)
- [界面说明](#界面说明)
- [设置项](#设置项)
- [数据存放位置](#数据存放位置)
- [系统集成与安全边界](#系统集成与安全边界)
- [本地开发](#本地开发)
- [检查与构建](#检查与构建)
- [仓库结构](#仓库结构)
- [文档索引](#文档索引)
- [已确认的产品决策](#已确认的产品决策)
- [当前阶段与边界](#当前阶段与边界)

---

## 能力概览

### 订阅

- **多订阅库**：保存多份订阅并随时切换生效项，每份独立存储、可单独删除。
- **多种导入方式**：订阅链接、Clash / Mihomo YAML，或 `ss://` `vmess://` `vless://` `trojan://` `hysteria2://` `tuic://` 分享链接（自动转换）。
- **流量与到期**：解析服务商的 `subscription-userinfo` 响应头，显示已用流量、总量进度与到期时间。
- **覆写**：每份订阅可单独保存自定义规则与覆写 YAML，刷新订阅不会丢失；控制项（端口、密钥、`allow-lan` 等）始终由 CapybaraProxy 接管，覆写无法覆盖。
- **自动更新**：启动时更新与定时更新（预设间隔或 1–168 小时自定义），可配置更新后自动重启核心。
- **Sub-Store 对接**：填写后端地址与 `x-api-token`，列出并一键导入。

### 代理

- 规则 / 全局 / 直连三种模式，运行中即可切换，无需重启。
- 代理组支持按名称搜索、按延迟或名称排序、折叠、置顶常用节点，这些视图状态会被记住。
- 单节点测速、整组测速、一键测速全部组；测速历史按时间倒序保留在页面上。

### 观测

- 概览页显示实时上下行速率、流量曲线、会话时长，以及由 CapybaraProxy 自己记账的**今日**与**近 7 天**累计流量（核心重启不清零）。
- 连接页可展开单条连接的完整详情（域名、目标地址、命中规则、链路、上传量、建立时间），支持搜索与一键全部关闭。
- 规则页显示每条规则当前命中的连接数，并列出配置里的规则集与代理集来源。
- **规则调试器**：输入域名或 IP，按顺序评估规则表，告诉你哪条规则会决定路由；无法评估的规则类型（GEO、规则集、进程名等）会明确列出而不是假装判断。
- 日志页支持级别筛选、搜索、暂停与清空视图。

### 系统

- Windows 当前用户系统代理（注册表三项），带 journal 备份与还原，退出时恢复用户原值、下次启动自动重新应用。
- 系统代理旁路列表可配置，同样纳入备份还原。
- TUN 开关：进程已提权且系统装有 Wintun 驱动时可开启，以 `tun:` 块写入当前订阅的覆写。
- 开机启动、静默启动、启动后自动连接。
- 系统托盘：状态与当前节点、代理模式切换、打开日志目录、实时速率图标。
- 按天滚动的日志文件，可设置保留天数；一键导出**脱敏**诊断包（不含订阅 URL、Token 与密钥，不联网）。

### 效率

- `Ctrl/Cmd + K` 命令面板：跳转页面、切换代理模式、直接选中节点。

---

## 快速开始

### 安装

运行安装包 `CapybaraProxy_<version>_x64-setup.exe`，按当前用户安装，不需要管理员权限。安装包已捆绑校验过的 Mihomo 核心与 geodata，无需手动放置文件。

### 从旧版本升级

产品由 FlowProxy 更名为 CapybaraProxy，应用标识符也随之变更，配置目录从
`%APPDATA%com.flowproxy.desktop` 变为 `%APPDATA%com.capybara.proxy`。

新版本首次启动时会**自动复制**旧目录到新位置（设置、订阅、流量记账、日志等），
旧目录保持原样，确认无误后可手动删除。复制只在目标目录尚无 `settings.json`
时发生，因此不会覆盖已经用过新版的数据。

开机启动项、系统代理等系统状态会在下次启动时按新路径重新写入。

### 第一次使用

1. 打开 **订阅** 页面，粘贴订阅 YAML 或填写订阅链接，点击 **导入订阅**。
2. 回到 **概览**，点击 **连接**。
3. 状态变为「已连接」后，**代理组** 页面会列出订阅里的真实节点。
4. 需要接管系统流量时，在 **设置 → 系统集成** 打开 **系统代理**。
5. 界面语言在 **设置 → 外观 → 语言** 切换（中文 / English），选择会持久化。

> 导入订阅或修改覆写后如果核心已在运行，需要重启核心才能加载新配置。开启「更新后重启」后，自动更新会自行完成这一步。

---

## 界面说明

### 概览

连接 / 断开、实时速率、流量曲线、会话时长、今日与近 7 天流量、当前代理组与节点选择、延迟测量、节点地图、活动连接数。

### 代理组

三种路由模式；组与节点的搜索、排序、折叠与置顶；单节点与整组测速；页面底部为测速历史。核心未运行时显示订阅里的离线预览，并明确标注为只读。

### 规则

规则表、搜索、每条规则的实时命中数、规则集与代理集来源、规则调试器。

### 连接

连接列表、搜索、单条详情、单条关闭、全部关闭（带确认）、分页。

### 订阅

订阅库（切换 / 删除）、导入表单、更新订阅、批量测速、用量面板、自定义规则与覆写 YAML 编辑。

### 日志

实时事件、级别筛选、搜索、暂停、清空视图、打开日志目录。

### 设置

按「配置模式」（简易 / 标准 / 宽松）显示不同数量的分组，全部为单列全宽卡片，顶部有分组导航。详见下一节。

---

## 设置项

| 分组 | 内容 |
| --- | --- |
| 外观 | 主题（Cyber Flow / Warm Flow）、语言、界面缩放、设置模式 |
| 窗口与启动 | 关闭按钮行为（隐藏到托盘 / 退出）、静默启动、启动后自动连接、开机启动 |
| 系统集成 | 系统代理开关、旁路列表、TUN 开关、启动项状态 |
| 订阅 | 启动时更新、自动更新间隔、更新后自动重启、订阅 User-Agent |
| 日志 | 写入磁盘、保留天数、打开目录、导出诊断包、清空文件 |
| 核心 | 日志级别、IPv6 |
| 内核版本 | 登记、切换、回退 Mihomo 构建 |
| 托盘 | 显示状态与节点、速率显示方式（图标数字 / 仅提示 / 不显示）、动画效果 |
| 高级内核 | 统一延迟、并发 TCP、固定混合端口、延迟测试地址与超时 |
| DNS | 预设或自定义解析服务器、Fake-IP 地址段 |
| Sub-Store | 后端地址、Token、列出并导入订阅 |

---

## 数据存放位置

| 内容 | 位置 |
| --- | --- |
| 设置 | 应用配置目录下的 `settings.json` |
| 订阅原文与元数据 | `<配置目录>/mihomo/subscriptions/` |
| 生效订阅索引 | `<配置目录>/mihomo/subscriptions.json` |
| 生成的运行配置 | `<配置目录>/mihomo/config.yaml` |
| 系统代理 journal | `<配置目录>/system-proxy.json` |
| 每日流量记账 | `<配置目录>/traffic.json` |
| 内核版本索引与构建 | `<配置目录>/cores/` |
| 日志 | 系统应用日志目录下的按天文件 |

Windows 上应用配置目录通常为 `%APPDATA%\com.capybara.proxy`。以上文件均为明文，**不做加密**；订阅文件里含服务商凭据，按文件权限保护。

---

## 系统集成与安全边界

### 托管什么

Mihomo 的控制端口、API 密钥、代理监听端口、`allow-lan` 与绑定地址**不由订阅决定**。导入订阅时这些顶层键会被移除，替换为 CapybaraProxy 在启动时生成的值：

| 被移除的键 | CapybaraProxy 写入的值 |
| --- | --- |
| `mixed-port`、`port`、`socks-port`、`redir-port`、`tproxy-port` | 预留的回环端口 |
| `external-controller` 及其变体 | 命令行 `-ext-ctl 127.0.0.1:<端口>` |
| `secret` | 每次启动随机生成，经 `-secret` 传入 |
| `allow-lan` | `false` |
| `bind-address`、`lan-allowed-ips`、`lan-disallowed-ips` | `127.0.0.1` |
| `authentication`、`external-ui` | 移除 |

订阅的其余部分逐字节保留，包括注释、锚点与规则顺序。

### 校验

- 核心二进制在执行前同时校验 SHA-256 与 `-v` 版本输出。
- 配置在生效前执行 `mihomo -t -d <工作目录> -f <文件>`。
- 订阅 URL 仅允许 `http://` 与 `https://`，限制长度与字符；下载有超时、体积上限与重定向规则，`https` 不允许降级到 `http`。
- 订阅 URL 内嵌令牌，因此**不会出现在任何日志或错误消息中**。
- 订阅标识符经过校验，不能用于路径穿越。

### 平台状态

| 平台 | 状态 |
| --- | --- |
| Windows 10 x64 | 已实测：真实核心、系统代理、开机启动、托盘、TUN（需提权 + Wintun） |
| macOS / Linux | 未验证：不调用未经验证的系统修改后端，能力状态显示为 `unverified` |
| Android | 界面、主题与 `VpnService` 骨架已完成；真实 Mihomo Native 与 TUN 尚未接入 |

---

## 本地开发

```powershell
pnpm install
pnpm dev          # 只启动前端，用于界面调试
pnpm tauri:dev    # 启动完整桌面应用
```

可选的环境变量（离线或需要代理时）：

```powershell
$env:CARGO_HOME = 'F:\codex-install\cargo-home'
$env:CARGO_TARGET_DIR = 'F:\codex-install\cargo-target'
$env:CARGO_NET_OFFLINE = 'true'
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:NO_PROXY = 'localhost,127.0.0.1'
```

如果开发构建里没有捆绑核心，可以指向一个已校验的可执行文件：

```powershell
$env:CAPYBARA_MIHOMO_PATH = 'F:\path\to\mihomo.exe'
```

### 核心查找顺序

启动时按以下顺序查找，命中后校验 SHA-256 与版本：

1. `CAPYBARA_MIHOMO_PATH` 指向的文件
2. `capybara-desktop.exe` 同目录的 `mihomo.exe`
3. 同目录 `resources\mihomo.exe`
4. 同目录 `resources\mihomo\mihomo.exe`（安装包默认布局）
5. 同目录 `mihomo\mihomo.exe`
6. 配置目录下 `mihomo\mihomo.exe`

若在 **内核版本** 中登记并启用了自定义构建，则优先使用该构建。

### 构建安装包

```powershell
node scripts/prepare-bundle-resources.mjs
pnpm tauri:build
```

`apps/desktop/src-tauri/resources/` 不入库（约 74 MB 二进制），由上述脚本按固定哈希复制。

---

## 检查与构建

```powershell
pnpm lint
pnpm typecheck
pnpm test                      # 前端单元测试
pnpm build
node scripts/verify-locale-keys.mjs   # 中英语言包键一致性

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

当前状态：前端 131 项测试、Rust 228 项测试全部通过；`clippy -D warnings` 无告警；中英语言包 525 个键一致。

仓库内配置了 GitHub Actions（`.github/workflows/verify.yml`），在推送与 PR 时运行上述检查；依赖审计只报告不阻断。详见 `docs/development/ci.md`。

`scripts/` 下的其它 `verify-*.mjs` 是本地验收脚本：它们会启动已安装的程序并通过 CDP 驱动界面，不属于 CI 范围。

---

## 仓库结构

```
apps/
  desktop/          Tauri 桌面端（React + TypeScript + Rust）
  android/          Android 端（Kotlin + Jetpack Compose）
crates/
  capybara-contracts   跨端共享的数据契约
  capybara-runtime     运行时状态机与日志
  capybara-mihomo-manager   Mihomo 子进程、控制 API、订阅与配置
  capybara-platform    平台能力（系统代理、开机启动、TUN 探测）
packages/
  design-tokens     桌面与 Android 共享的设计令牌
docs/              产品、界面、架构与各阶段报告
scripts/           资源准备、验收与校验脚本
```

---

## 文档索引

- 产品：`docs/product/product-requirements.md`
- 界面：`docs/ui-design/design-reference.md`、`theme-cyber-flow.md`、`theme-warm-flow.md`、`mascot-guidelines.md`、`component-specification.md`
- 架构：`docs/architecture/system-architecture.md`、`desktop-tauri-rust.md`、`android-architecture.md`、`performance-requirements.md`、`platform-support-matrix.md`、`adr-0001-desktop-stack.md`
- 开发：`docs/development/` 下的阶段报告（1–6）、`subscription-scope.md`（订阅能力边界）、`i18n-scope.md`、`ci.md`
- 视觉参考：`assets/design-reference/`

---

## 已确认的产品决策

1. 产品名：CapybaraProxy。
2. 目标平台：Windows、macOS、Linux、Android。
3. 代理核心：Mihomo，由 CapybaraProxy 自行分发、启动、监控与管理。
4. 桌面技术栈：React + TypeScript + Tauri + Rust。
5. Android：Kotlin + Jetpack Compose，使用 Android `VpnService`。
6. 主题：默认 Cyber Flow，可切换 Warm Flow。
7. 关闭主窗口默认隐藏到托盘并继续运行，可在设置中改为退出。
8. 性能优先：控制 CPU、内存、后台轮询与动画开销。
9. UI 以设计参考图为基准，适配分辨率时保持布局关系与视觉层级，不机械固定像素。
10. Android 与桌面共享设计令牌与数据契约，不强求共享 UI 代码。

---

## 当前阶段与边界

### 已完成

- 阶段 1：桌面 UI 原型
- 阶段 2：Runtime 骨架、原生设置与受控退出
- 阶段 3：Windows 上的真实 Mihomo 子进程、控制 API 与真实数据页面
- 阶段 4：Windows 系统代理、开机启动、恢复 journal 与能力状态
- 阶段 5：Android Compose UI、A/C 主题、`VpnService` 授权与前台服务
- 阶段 6：性能采样、订阅导入与可分发产物
- 阶段 7：多订阅库、覆写、DNS / TUN、规则调试器、命令面板、流量记账、诊断包与 CI

### 当前限制

- TUN 需要进程已提权且系统装有 Wintun；未满足时开关禁用并说明原因。
- macOS / Linux 的系统集成保持 `unverified`，不调用未验证的修改后端。
- Android 的真实 Mihomo Native 与 TUN 尚未接入。
- 只支持一份生效订阅；订阅库是并列的多份配置，没有「同一订阅的上一版」回滚。
- 应用自身不自动更新；内核版本需要手动放入并登记。

---

## 维护说明

文档更新请与对应代码改动一并提交，保持本 README 与 `docs/` 内容同步。中文版为默认版本，英文版（`README.en.md`）需同步修改。
