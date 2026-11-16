# 第五阶段 Android 实现检查报告

日期：2026-11-07

范围：Android Compose UI、A/C 主题、主题持久化、VPNService 授权与前台服务、
通知 Stop、网络状态同步、Mihomo bridge 边界、JVM 测试、仪器化测试、Lint 和
Debug APK 构建。

不在范围：真实 Mihomo Android Native/TUN 接入、可用代理隧道、发布签名、阶段 6
性能与视觉验收。

## 1. 结论

阶段 5 在当前 API 26 模拟器验收范围内完成：

- 33 项 JVM 测试通过，0 失败、0 错误、0 跳过。
- 2 项 Android 仪器化测试通过，0 失败、0 错误、0 跳过。
- `:app:lintDebug` 通过，0 error、8 warning；8 项均为
  `GradleDependency` 依赖升级提示。
- Debug APK 构建、v2 签名校验和 4 字节 zipalign 校验通过。
- A/C 双主题、默认 A 主题、主题持久化、A 主题 Network Orb 和 C 主题
  蓝白吉祥物已在模拟器中复验。
- VPN 授权拒绝、授权允许、通知 Stop 和网络离线/恢复路径已有设备证据。
- Mihomo bridge 仍为探测边界，没有把 Native/TUN 标记为可用。

本结论不等于真实代理隧道已经可用。当前 `VPN ready` 只表示 Android
VPNService 建立了未被 Mihomo 接管的 VPN 接口。API 35 后台限制、物理设备、
设备重启后的自动恢复和真实 Mihomo Native/TUN 仍未验证或未实现。

## 2. 验证环境

| 项目 | 实测值 |
| --- | --- |
| 操作系统 | Windows 10 专业版 22H2，10.0.19045，x64 |
| JDK | Temurin 17，`F:\codex-install\jdk17` |
| Gradle | 8.9，`F:\codex-install\gradle\gradle-8.9` |
| Android SDK | `F:\codex-install\android-sdk` |
| Build Tools | 35.0.0 |
| compileSdk / targetSdk | 35 / 35 |
| minSdk | 26 |
| AVD | `FlowProxy_API_26` |
| 设备 | `emulator-5556` |
| Android | 8.0.0，API 26，x86_64 |
| 网络代理 | `192.168.1.2:7890`，Lint 验证期间可用 |
| 模拟器加速 | `emulator-check accel` 退出码 6，未安装 Android Emulator Hypervisor Driver；模拟器可运行，但不代表真实设备性能 |

## 3. 本轮修正

此前网络恢复期间，仪器化测试使用 `assumeTrue`，网络条件不满足时可能把测试
静默标记为跳过。现已改为：

- 使用外层 `RuleChain`，在 `MainActivity` 创建前等待 Android 默认网络，
  最长 60 秒。
- 冷启动后继续等待 `FlowProxyApplication.networkMonitor.available == true`，
  再断言 UI 显示 `Online`。
- 飞行模式测试等待系统默认网络消失、应用状态变为 Offline，再恢复网络并断言
  应用重新显示 Online。
- 删除静默跳过路径；失败会明确超时并输出网络回调诊断信息。

对应文件：

`apps/android/app/src/androidTest/kotlin/com/flowproxy/android/NetworkAvailabilityInstrumentedTest.kt`

最终按真实测试顺序执行完整仪器测试套件，结果为 2/2 通过，未跳过。

## 4. 测试与构建

### 4.1 JVM 单元测试

实际强制重跑：

```powershell
gradle.bat -p apps/android `
  :core-model:test `
  :vpn-service:testDebugUnitTest `
  :app:testDebugUnitTest `
  --rerun-tasks --no-daemon --no-parallel --max-workers=2
```

结果：`BUILD SUCCESSFUL in 39s`。

| 测试套件 | 数量 | 失败 | 错误 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| `VpnActionPolicyTest` | 12 | 0 | 0 | 0 |
| `MobileNavigationTest` | 2 | 0 | 0 | 0 |
| `MihomoCapabilityEvaluatorTest` | 3 | 0 | 0 | 0 |
| `ProxyStatusTest` | 7 | 0 | 0 | 0 |
| `RuntimeSupportTest` | 5 | 0 | 0 | 0 |
| `VpnServiceCommandTest` | 4 | 0 | 0 | 0 |
| **合计** | **33** | **0** | **0** | **0** |

### 4.2 Android 仪器化测试

实际执行：

```powershell
gradle.bat -p apps/android :app:connectedDebugAndroidTest `
  --rerun-tasks --no-daemon --no-parallel --max-workers=2
```

结果：

- Gradle：`BUILD SUCCESSFUL in 6m 30s`
- JUnit XML：2 tests，0 failures，0 errors，0 skipped
- 测试套件耗时：161.044 秒
- 完成时间：2026-11-07T04:59:11

覆盖场景：

- API 26 模拟器冷启动且 Android 有默认网络时，FlowProxy 显示 `Online`。
- 飞行模式开启后系统默认网络消失，FlowProxy 显示 `Offline`。
- 飞行模式关闭且网络恢复后，FlowProxy 重新显示 `Online`。

### 4.3 Lint

代理恢复后实际执行：

```powershell
$env:GRADLE_OPTS='-Dhttp.proxyHost=192.168.1.2 -Dhttp.proxyPort=7890 `
  -Dhttps.proxyHost=192.168.1.2 -Dhttps.proxyPort=7890'

gradle.bat -p apps/android :app:lintDebug `
  --rerun-tasks --no-daemon --no-parallel --max-workers=2
```

结果：`BUILD SUCCESSFUL in 1m 21s`。

| 严重级别 | 数量 | 类型 |
| --- | ---: | --- |
| Error | 0 | 无 |
| Warning | 8 | 全部为 `GradleDependency` 依赖版本可升级提示 |

报告：

`apps/android/app/build/reports/lint-results-debug.xml`

本轮没有代码、资源、生命周期或安全类 Lint 警告。8 项依赖升级提示不阻塞
阶段 5，但应在后续依赖维护中处理并重新执行完整验证。

### 4.4 Debug APK

实际执行：

```powershell
gradle.bat -p apps/android :app:assembleDebug `
  --rerun-tasks --no-daemon --no-parallel --max-workers=2
```

| 项目 | 复核结果 |
| --- | --- |
| 路径 | `F:\codex-proxy\apps\android\app\build\outputs\apk\debug\app-debug.apk` |
| UTC 时间 | `2026-11-07T05:03:14.0496183Z` |
| 大小 | `10,353,609` 字节 |
| SHA-256 | `2F8D01ED6A8BE2CF6E4A97247B242917FC39D752E1E34E91DFF0ED29AD518562` |
| 包名 | `com.flowproxy.android` |
| versionName | `0.1.0-stage5` |
| minSdk | 26 |
| targetSdk / compileSdk | 35 / 35 |
| APK 签名 | APK Signature Scheme v2 有效 |
| zipalign | 4 字节对齐通过 |

Debug 证书 SHA-256：

`07ad59c4a4930bb21e6849980656d7a4a937c6bcdeb829b61f2acc4c811dd2de`

该 APK 是可安装的 Debug 产物，不是发布签名产物。

## 5. 设备运行验收

### 5.1 A/C 双主题与导航

证据目录：

`docs/development/screenshots/stage5`

关键截图：

- A 主题：`flowproxy-stage5-final-theme-a.png`
- C 主题：`flowproxy-stage5-final-theme-c.png`
- C 主题重新启动后持久化：`flowproxy-stage5-final-theme-c-persisted.png`
- Overview、Proxies、Rules、Connections、Profiles、Logs 和 Settings 页面均有
  最终截图及 UIAutomator XML。

人工查看和设备 XML 确认：

- A 主题为深蓝背景、蓝紫霓虹和发光 Network Orb。
- C 主题为暖白背景、蓝白吉祥物和橙蓝点缀。
- 切换到 C 主题并重新启动应用后仍保持 C 主题。
- 七个导航目标均可到达，底部导航与 More 页面切换正常。

### 5.2 VPN 授权与状态同步

| 场景 | 实测结果 | 证据 |
| --- | --- | --- |
| 授权前 | `Online / Stopped / Missing` | `flowproxy-stage5-vpn-baseline.png` |
| 授权拒绝 | `Online / Stopped / Missing`，没有 VPN 服务或 `tun0` | `flowproxy-stage5-vpn-denied-fixed.png` |
| 授权允许 | `Online / Ready / Missing`，VPNService 运行且 `tun0` 存在 | `flowproxy-stage5-vpn-ready.png` |
| 前台通知 | 显示 VPN 接口就绪且代理核心不可用 | `flowproxy-stage5-vpn-notification-expanded.png` |
| 通知 Stop | 回到 `Online / Stopped / Missing` | `flowproxy-stage5-vpn-stopped.png` |
| 应用重新启动 | 回到 `Online / Stopped / Missing` | `flowproxy-stage5-relaunch-fixed.xml` |

通知正文为：

`VPN interface ready · proxy core unavailable`

该文案和 UI 状态没有把缺少代理核心的 VPN 接口显示成真实 Connected。

### 5.3 VPN 接口边界

原始网络证据：

`docs/development/screenshots/stage5/flowproxy-stage5-vpn-connectivity.txt`

设备状态显示：

- VPN 接口 `tun0` 存在。
- 地址仅为 `10.111.0.2/32`。
- 路由只有 `::/0 unreachable`。
- DNS 为空。
- Wi-Fi 仍有有效默认网络和路由。
- 应用没有把 TUN file descriptor 交给已验证的 Mihomo runtime。
- 当前没有路由、DNS 或真实代理流量接管。

因此 `Ready` 只表示 VPN 接口存在，不表示代理隧道可用，也不表示用户流量已经
经过 Mihomo。

### 5.4 生命周期与网络切换

已有模拟器证据：

- 应用进入后台后再次打开，VPN 接口保持 Ready。
- 模拟器休眠和唤醒后，VPN 状态与 UI 保持 Ready。
- 飞行模式切换触发 Offline，恢复网络后重新显示 Online。
- 通知 Stop 和应用强制停止后状态回到 Stopped。

未覆盖：

- `onRevoke` 的独立运行验收。
- 设备重启后的自动 VPN 恢复。当前没有 `BOOT_COMPLETED` 接收器，服务使用
  `START_NOT_STICKY`，不宣称自动恢复。
- API 35 的前台服务与后台启动限制。
- 厂商电池优化、进程回收和物理设备上的长期驻留。

## 6. 架构、依赖与安全复核

### 6.1 模块边界

Android 工程保持以下分层：

- `app`：Compose UI、导航、Activity 和 ViewModel。
- `core-model`：主题、状态、流量历史和状态转换。
- `core-theme`：A/C 主题 tokens。
- `core-data`：DataStore 设置持久化。
- `vpn-service`：Android VPNService 和前台通知。
- `mihomo-bridge`：Mihomo Native/JNI 能力探测边界。

未发现 Compose 页面直接启动 Mihomo、直接持有 Native FD 或把 VPNService 生命
周期塞入 UI 的耦合。原型数据集中在隔离的 DemoCatalog，没有进入 Runtime 或
VpnService。

### 6.2 性能与后台行为

原始证据：

- `flowproxy-stage5-top-background.txt`
- `flowproxy-stage5-meminfo-background.txt`
- `flowproxy-stage5-gfxinfo-initial.txt`
- `flowproxy-stage5-gfxinfo-foreground.txt`
- `flowproxy-stage5-gfxinfo-background.txt`

实测：

- 后台采样 CPU：0.0%。
- 后台 RES：112 MB。
- 后台 PSS：39,795 KB。
- 最近一次前后台采样均未新增帧，说明采样窗口内没有持续动画刷新。
- 冷启动采样为 15/15 janky frames，100% janky。

冷启动采样发生在无硬件加速的 API 26 模拟器上，不能用于宣告真实设备性能通过。
动画和流量采样绑定 `Lifecycle.State.STARTED`，但完整性能验收属于阶段 6。

### 6.3 依赖

生产依赖集中在 Compose、Lifecycle、DataStore、Coroutines 和 AndroidX。未引入
图表库、3D 引擎或大型 UI 框架。`androidTest` 依赖只进入测试 APK，不进入生产
实现。Lint 的 8 个警告均为已有依赖版本可升级。

### 6.4 安全

- VPNService 声明 `exported=false`，并受 `BIND_VPN_SERVICE` 保护。
- 授权拒绝不会启动服务。
- `VpnService.prepare`、服务启动和停止路径处理 `SecurityException` 和
  `IllegalStateException`。
- `allowBackup=false`。
- 未实现系统代理修改、TUN 路由接管或管理员权限操作。
- Mihomo bridge 只探测契约，不加载未经确认的 Native 产物。
- Debug 证书只用于本地验证，不可用于发布。

本轮 Lint 未发现安全类问题，但这不是完整安全审计。真实订阅凭据、Mihomo
配置和 Native 库进入工程后，需要补充密钥存储、输入校验和供应链审计。

## 7. 问题与风险

### P0

未发现必须立即修复的 P0 问题。

### P1

1. 仅在 API 26 x86_64 模拟器完成运行验收。APK 的 targetSdk 为 35，API 35
   前台服务、通知和后台启动限制仍可能影响目标版本行为，因此 Android
   VPNService 状态为“已实现但仍可能受目标版本未验证影响”。
2. 尚无物理设备验证。厂商电池策略、Doze、进程回收和真实网络切换仍可能
   改变服务存活和通知行为。
3. 真实 Mihomo Native/TUN 明确未实现。当前只能证明 VPN 接口生命周期和
   probe-only 边界，不能宣称代理流量可用。

### P2

1. 设备重启后的自动 VPN 恢复没有实现。当前行为是服务非粘性，应用重新打开后
   状态回到 Stopped。
2. `onRevoke`、设备重启和 API 35 后台限制没有独立实机验收。
3. 无硬件加速模拟器的冷启动采样为 15/15 janky frames，不能作为真实设备流畅
   度结论。
4. Lint 有 8 个 `GradleDependency` 依赖升级提示，不影响当前功能，但应在依赖
   维护任务中处理。

### P3

真实代理隧道、发布签名、供应链审计、API 35 设备矩阵和阶段 6 视觉性能验收
仍属于后续任务。

## 8. 完成状态

| 阶段 5 要求 | 状态 | 证据与边界 |
| --- | --- | --- |
| VPNService 授权和生命周期 | 已实现但仍可能受目标版本未验证影响 | API 26 模拟器已测授权拒绝、允许、通知 Stop、前后台与休眠唤醒；API 35 和物理设备未测 |
| Mihomo Native bridge 技术验证 | 明确未实现 | 只完成 probe-only 契约和边界，没有可加载 Native runtime 或 TUN FD 交接 |
| 前台服务通知和状态同步 | 已实现并验证 | 通知、Stop 和 UI 状态一致；目标版本限制仍有残余风险 |
| 配置、节点、代理组、流量、连接和日志展示 | 已实现并验证 | 页面可运行，数据来自隔离 Mock |
| 网络切换、休眠、重启、服务回收 | 已实现但仍可能受目标版本未验证影响 | 飞行模式、前后台、休眠恢复、通知 Stop 和应用重启已验证；设备重启自动恢复未实现 |
| A/C 双主题和吉祥物资源 | 已实现并验证 | API 26 模拟器截图、导航和 C 主题持久化均通过 |

## 9. 阶段边界

阶段 5 在当前 API 26 模拟器和文档限定范围内完成并停止。不得将本报告解释为：

- Android 代理流量已经可用。
- Mihomo Native/TUN 已经接入。
- API 35 或所有物理设备已经验证。
- 阶段 6 视觉与性能验收已经完成。

下一阶段开始前如需提升发布可信度，应先完成 API 35 设备矩阵、物理设备后台
策略验证和真实 Native/TUN 技术 Spike；这些不属于本轮自动展开范围。
