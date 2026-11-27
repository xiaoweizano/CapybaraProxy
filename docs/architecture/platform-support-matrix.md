# CapybaraProxy 平台支持矩阵

更新日期：2026-11-24

最近桌面运行验证：Windows 10 专业版 22H2，10.0.19045，x64

最近 Android 运行验证：Android 8.0.0，API 26，x86_64 模拟器
`CapybaraProxy_API_26`（2026-11-07；此后模拟器因缺少硬件加速驱动无法启动，
签名 release APK 未做安装验证）

## 状态定义

| 状态 | 含义 |
| --- | --- |
| 已实现并验证 | 代码已交付，并在当前记录的目标环境中完成运行验收 |
| 已实现但仍可能受目标版本未验证影响 | 主体代码已交付且在已有环境完成部分验证，但目标系统版本、物理设备或特定生命周期仍可能改变行为 |
| 明确未实现 | 当前没有交付对应后端或能力，不得把探测、接口占位或 Mock 展示视为已实现 |

## 桌面能力

| 能力 | Windows | macOS | Linux | 说明 |
| --- | --- | --- | --- | --- |
| A/C 双主题 UI | 已实现并验证 | 已实现但仍可能受目标版本未验证影响 | 已实现但仍可能受目标版本未验证影响 | Windows 已截图和交互验证；macOS/Linux 未运行 |
| 中英双语界面 | 已实现并验证 | 已实现但仍可能受目标版本未验证影响 | 已实现但仍可能受目标版本未验证影响 | Settings 内切换，写入 `settings.json` 的 `language`；Windows 已截图验证切换与持久化；非 Windows 未运行 |
| Mihomo 子进程生命周期 | 已实现并验证 | 已实现但仍可能受目标版本未验证影响 | 已实现但仍可能受目标版本未验证影响 | Windows 已覆盖启动、停止、重启和异常退出；非 Windows 未运行 |
| 当前用户系统代理 | 已实现并验证 | 明确未实现 | 明确未实现 | 当前仅实现 Windows `HKCU` 路径 |
| 开机启动 | 已实现并验证 | 明确未实现 | 明确未实现 | 当前仅实现 Windows 当前用户 `Run` 路径 |
| 系统托盘 | 已实现但仍可能受目标版本未验证影响 | 明确未实现 | 明确未实现 | Windows 托盘菜单已构建，Connect、Disconnect、Show、Exit 的真实鼠标路径仍待人工验证 |
| TUN 激活 | 明确未实现 | 明确未实现 | 明确未实现 | Windows 只探测提权和 Wintun，没有创建 TUN、修改路由或接管流量 |
| 订阅导入（单份） | 已实现并验证 | 已实现但仍可能受目标版本未验证影响 | 已实现但仍可能受目标版本未验证影响 | 粘贴 YAML 或 URL 导入，原子写入；Windows 安装包已端到端验证导入到 Proxies 出节点。非 Windows 未运行 |
| 订阅自动更新 / 多订阅 | 明确未实现 | 明确未实现 | 明确未实现 | 只有一份活动订阅，无定时拉取、无版本回滚。边界见 `docs/development/subscription-scope.md` |
| 捆绑 Mihomo 核心与 geodata | 已实现并验证 | 明确未实现 | 明确未实现 | NSIS 包含核心与 geodata；安装后无需手动放置 |

## Android 能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| A/C 双主题 UI | 已实现并验证 | API 26 模拟器已截图确认 A 主题 Network Orb、C 主题蓝白吉祥物和页面切换 |
| 中英双语界面 | 已实现但仍可能受目标版本未验证影响 | Settings 内切换并持久化到 DataStore；38 项 JVM 测试含字典一致性校验；本轮未做设备安装验证（模拟器缺硬件加速） |
| 主题选择持久化 | 已实现并验证 | 切换到 C 主题后重新启动应用仍保持 C 主题 |
| 网络在线/离线状态同步 | 已实现并验证 | 仪器化测试覆盖冷启动、飞行模式离线和网络恢复 |
| VPNService 授权与接口生命周期 | 已实现但仍可能受目标版本未验证影响 | API 26 已测授权拒绝、允许、通知 Stop、前后台和休眠唤醒；API 35 与物理设备未测 |
| 前台服务通知 | 已实现但仍可能受目标版本未验证影响 | API 26 已验证通知和 Stop；API 35 通知及后台限制未测 |
| Mihomo Native 实际集成 | 明确未实现 | 当前只有 probe-only 契约，没有加载可验证的 Native runtime |
| TUN 路由、DNS 和流量接管 | 明确未实现 | `VpnService.Builder` 只建立未接管流量的 VPN 接口 |
| 订阅导入（单份） | 明确未实现 | Android 端尚无订阅入口，页面数据仍来自隔离 Mock |
| 订阅自动更新 / 多订阅 | 明确未实现 | 尚无订阅下载链路 |

## Windows 当前状态

- 系统代理操作范围固定为当前用户
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`。
- 启用系统代理要求 Runtime 已连接，并只使用 Mihomo adapter 返回的已验证
  `127.0.0.1:<port>` 回环端点。
- 启用前写入有版本、大小受限且原子替换的 `system-proxy.json` Journal。
- 用户或其他软件修改代理后，CapybaraProxy 释放所有权，不覆盖外部值。
- 应用和核心同时异常终止时，下一次应用启动会尝试恢复遗留 Journal。
- 开机启动固定使用当前用户 `Run\CapybaraProxy`，命令仅为带引号的应用绝对路径。
- 同名外部开机启动值会被保留并报告为 `conflict`。
- 无后台 Windows 服务；异常终止到下次启动之间存在无法自动缩小的恢复窗口。
- 托盘菜单代码已完成，但真实鼠标点击路径尚未人工验收。

## Android 当前状态

- 工程按 `app`、`core-model`、`core-theme`、`core-data`、`vpn-service` 和
  `mihomo-bridge` 分离，Compose UI 不直接持有 VPNService 或 Native 生命周期。
- 默认主题为 A Cyber Flow，可在 Settings 切换到 C Warm Flow。A 主题保留
  Network Orb，C 主题保留蓝白色吉祥物，主题动画和流量采样绑定
  `Lifecycle.State.STARTED`。
- 主题选择通过 DataStore 持久化，应用重新启动后的 C 主题持久化已验证。
- VPNService 声明 `exported=false`，受 `BIND_VPN_SERVICE` 保护，并使用
  `START_NOT_STICKY`、前台通知和 Stop action。
- 授权拒绝后 UI 为 `Online / Stopped / Missing`，没有 VPN 服务或 `tun0`。
- 授权允许后 UI 为 `Online / Ready / Missing`，VPNService 和 `tun0` 存在。
- 通知 Stop 后恢复为 `Online / Stopped / Missing`。
- UI 使用代理核心缺失状态，不把没有 Mihomo 的 VPN 接口显示为 Connected。
- 设备重启后的自动恢复没有实现；当前没有 `BOOT_COMPLETED` 接收器，应用重新
  打开后服务状态回到 Stopped。

### Android 验证证据

- JVM 测试：33/33 通过，0 失败、0 错误、0 跳过。
- 仪器化测试：2/2 通过，0 失败、0 错误、0 跳过。
- Lint：0 error、8 warning，全部为 `GradleDependency` 依赖升级提示。
- Debug APK：`10,353,609` 字节。
- APK SHA-256：
  `2F8D01ED6A8BE2CF6E4A97247B242917FC39D752E1E34E91DFF0ED29AD518562`。
- APK Signature Scheme v2 和 4 字节 zipalign 校验通过。

### Android VPN 边界

授权允许后存在 `tun0`，但设备网络证据同时显示：

- VPN 地址仅为 `10.111.0.2/32`。
- 路由只有 `::/0 unreachable`。
- DNS 为空。
- Wi-Fi 仍有有效默认网络和路由。
- 没有把 TUN file descriptor 交给已验证的 Mihomo Native runtime。
- 没有实现路由、DNS 或真实代理流量接管。

因此 `Ready` 只表示 Android VPN 接口已建立，不表示代理隧道可用，不表示用户
流量已经经过 Mihomo，也不表示 Native/TUN 集成完成。

### Android 未验证范围

- API 35 模拟器或物理设备。
- targetSdk 35 下的前台服务、通知和后台启动限制。
- 厂商电池优化、Doze、进程回收和长期后台驻留。
- `onRevoke` 的独立运行验收。
- 设备重启、网络切换组合和真实设备性能。
- 真实 Mihomo Native runtime、Mihomo 配置、TUN FD 交接以及可用代理隧道。

## Windows 订阅与产物状态

- 安装包（NSIS，`currentUser` 模式）自带 Mihomo `v1.19.33` 与 geodata，安装后无需手动放置核心。
- 订阅导入端到端验证通过：粘贴 YAML → 校验 → 写入 → 启动后 Proxies 页面出现订阅节点。
- 订阅原文存于 `%APPDATA%\com.capybara.proxy\mihomo\config.subscription.yaml`，明文，不加密。
- 出站流量的公网可达性**未验证**：验收时本机 DNS 与 IP 直连均超时，混合端口返回 502，只证明代理链路在工作。
- geodata 为快照，会随规则更新过时，无自动更新。
- 安装包约 22 MiB（LZMA solid），解包后约 28.9 MB，其中 Mihomo 核心约 61 MB（未压缩）。

## 非 Windows 边界

macOS 和 Linux 共享部分桌面 UI 与 Runtime 代码，但没有完成目标系统上的系统
代理、开机启动、托盘、提权、WebKitGTK 渲染和 TUN 后端验证。相关平台集成能力
保持“明确未实现”；共享 UI 和进程管理只能标记为“已实现但仍可能受目标版本未
验证影响”。
