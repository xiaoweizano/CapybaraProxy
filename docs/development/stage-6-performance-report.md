# 阶段 6 性能与视觉验收报告

日期：2026-11-24
数据采集日期：2026-11-07
范围：桌面端（Windows）性能采样、A/C 双主题视觉证据、可分发产物验收。
Android 视觉与性能见阶段 5 报告；本轮 Android 只补齐签名产物。

## 1. 结论

- 四个性能场景共 20 分钟稳态采样全部完成，数据完整可用。
- 视觉证据 42 张（7 路由 × 2 主题 × 3 视口）全部生成。
- 本轮新增的产物验收：NSIS 安装包、签名 release APK、端到端导入订阅流程。

**必须明确的两点限制：**

1. `artifacts/stage6-performance-before.json` 的 `status` 是 `failed`。失败点在四个性能场景**全部跑完之后**的托盘查找步骤（`showHiddenWindow` 用 UI Automation 找任务栏图标失败）。性能数据本身没有缺失，但这份文件不能整体标为通过。
2. `artifacts/stage6-performance-smoke-fixed.json` 是 `passed`，但每个场景只采样 300~600 ms、2 个样本。**它是一个冒烟检查，不能替代长采样结论。** 本报告的性能数据只用 `performance-before.json`。

## 2. 验证环境

| 项目 | 实测值 |
| --- | --- |
| 操作系统 | Windows 10 Pro，10.0.19045，x64 |
| 逻辑处理器 | 8 |
| 物理内存 | 34,233,077,760 字节（约 31.9 GiB） |
| 被测程序 | `capybara-desktop.exe`（release，`--no-bundle` 构建） |
| 窗口模式 | 标准窗口 1280×820 |
| 主题 | A Cyber Flow |

## 3. 性能数据

采样方式：PowerShell 按进程组采集 CPU 时间与内存，按场景持续轮询。

| 场景 | 说明 | 时长 | 样本 | CPU 均值 | CPU 时间 | 工作集 | 私有字节 | 进程数 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| idle | 首页，Runtime 停止 | 300 s | 35 | 0.079% | 1.922 s | 413 MB | 194 MB | 7 |
| stable | 首页，已连接空闲 | 300 s | 30 | 0.069% | 1.656 s | 455 MB | 265 MB | 9 |
| traffic | 首页，持续流量 | 300 s | 30 | 6.067% | 147 s | 460 MB | 269 MB | 9 |
| hidden | 托盘隐藏，已连接 | 600 s | 59 | 0.059% | 2.828 s | 457 MB | 266 MB | 9 |

冷启动到可交互：5,975 ms（`stage6-performance-before.json` 的 `startup.interactiveMs`；另一次采集记录为 6,225~6,403 ms，属同一量级）。

### 3.1 判读

- **空闲与隐藏场景 CPU 都在 0.1% 以下**，说明轮询间隔、动画暂停和隐藏窗口策略有效。隐藏 10 分钟只消耗 2.828 s CPU 时间。
- **持续流量场景 6.067%** 是唯一明显偏高的场景。该场景在 5 分钟内持续推送仪表盘与流量图更新，属于预期成本；对应的 CPU 时间 147 s 与 8 逻辑核 300 s 的总量相比约占 6%。尚未做优化前后对比，因此不能宣称已优化。
- **内存**：工作集约 413~460 MB，其中约 260~270 MB 为私有字节。连接后增加约 70 MB（多出的 2 个进程是 Mihomo 核心相关）。Mihomo 进程本身不在这些数字里单独分离，这是本轮的方法局限。
- **进程数从 7 增至 9**（连接后），符合"主程序 + WebView2 子进程 + Mihomo 核心"的结构。

### 3.2 未覆盖与局限

- 没有单独分离 UI 与 Mihomo 的 CPU/内存，`performance-requirements.md` 的这一项要求未满足。
- 未做窄窗口（900×820）与最小窗口（820×680）下的性能采样，只做了视觉截图。
- 未做优化前后对比数据。
- 托盘交互路径在自动化里失败，`hidden` 场景的进入方式是脚本直接控制，不是真实鼠标路径。

## 4. 视觉证据

视觉检查覆盖 7 个页面 × 2 套主题（cyber_flow / warm_flow）× 3 种视口
（1280×820、900×820、820×680）。检查时 `runtime.state` 为 `connected`，
页面渲染的是真实数据而非空态。

未人工逐张核对全部截图的视觉保真度；这一项仍待人工目视确认。

## 5. 可分发产物验收

### 5.1 桌面 NSIS 安装包

| 项目 | 值 |
| --- | --- |
| 路径 | `F:\codex-install\cargo-target\release\bundle\nsis\CapybaraProxy_0.2.0_x64-setup.exe` |
| 大小 | 23,064,741 字节（约 22 MiB，LZMA solid） |
| 安装模式 | `currentUser`（不要求管理员权限） |
| 解包后体积 | 约 28.9 MB（含 61 MB 未压缩的 Mihomo exe，压缩后显著变小） |

安装后目录结构（实测）：

```text
<InstallDir>\
  capybara-desktop.exe
  resources\
    mihomo\mihomo.exe        (61,247,488 字节，SHA-256 与锁定版本一致)
    geodata\geosite.dat
    geodata\geoip.metadb
    manifest.json
  uninstall.exe
```

### 5.2 安装器静默安装的已知问题

首次安装（目标目录不存在时）用 `/S` 静默模式可以正常完成，实测安装到用户选择的目录并落位了全部资源。

**已安装过的情况下再执行 `setup.exe /S` 会卡住**：安装器进程常驻不退出，也不更新目标目录，只能手动结束进程。表现见本轮复现（两个 `CapybaraProxy_0.2.0_x64-setup` 进程停留数分钟无进展）。常规的图形界面双击安装不受影响，但**用脚本重复部署同一个安装包时需要注意**。

本轮最终二进制是直接复制到安装目录做验收的，目录结构与安装器产出的一致（`resources/mihomo/mihomo.exe`、`resources/geodata/*`）。安装器本身的覆盖安装行为列为 P2 待查。

### 5.3 端到端验收结果

脚本 `scripts/verify-packaged-acceptance.mjs`，驱动真实 UI：

| 步骤 | 结果 |
| --- | --- |
| 未设置 `CAPYBARA_MIHOMO_PATH` 时能找到捆绑核心 | 通过 |
| 在 Profiles 页面粘贴 YAML 导入订阅 | 通过，提示 "Subscription imported" |
| 点击 Overview 的 Connect 启动 Runtime | 通过，状态变为 `Connected` |
| 导入的节点出现在 Proxies 页面 | 通过（`Proxy → Local Test`） |
| 活动配置是导入的订阅 | 通过（`source: "subscription"`） |
| 混合端口监听并返回代理层响应 | 通过（端口存在，返回 HTTP 状态码） |
| 出站真实流量 | **未验证**：验收时本机 DNS 与 IP 直连均超时，只有上游代理短暂可用后也中断。代理返回 502 说明链路本身在工作，但没有证明外网可达。 |

证据：`artifacts/stage6-packaged-acceptance.json`，`result: "passed"`。

### 5.4 Android 签名 release APK

| 项目 | 值 |
| --- | --- |
| 路径 | `apps/android/app/build/outputs/apk/release/app-release.apk` |
| 大小 | 7,108,691 字节 |
| SHA-256 | `c69c7c4170e3ab711f8ec43cc4b2f280f0c01044a29749d3c42c1e37faa8c705` |
| versionName / versionCode | `0.2.0-stage6` / `2` |
| 签名 | APK Signature Scheme v2 有效，单签名者 |
| 证书 DN | `CN=CapybaraProxy, OU=Development, O=CapybaraProxy, L=Local, ST=Local, C=CN` |
| 证书 SHA-256 | `1e81a340b493e80de1490dea41c9e2bf99e5974f0aeec698d21277822f337696` |
| zipalign | 4 字节对齐通过 |

**未完成**：安装到设备验证。本机模拟器无法启动（`x86_64 emulation currently requires hardware acceleration`，未安装 Android Emulator Hypervisor Driver），与阶段 5 记录的环境限制一致。APK 的安装与运行行为仍以阶段 5 的 Debug 构建结果为准。

**证书保管**：keystore 位于 `F:\codex-install\capybara-keystore\capybara-release.jks`，密码在同目录 `.password`，两者都不入库。**后续所有版本必须使用同一证书签名**，否则无法覆盖安装。

## 6. 本轮发现并修复的问题

1. **订阅配置被双重注入**（`crates/mihomo-manager/src/core_adapter.rs`）。导入时保存的是已注入受控块的文本，启动时又注入一次，导致 `config.yaml` 里出现两份 header。已改为：校验用注入后的临时副本，持久化用用户原文。新增回归测试 `preparing_twice_does_not_nest_the_managed_header`。
2. **`validate_profile` 缺少 `-d`**。带 `GEOIP`/`GEOSITE` 规则的订阅在无 geodata 时会尝试联网下载并 90 秒超时失败。已补 `-d <工作目录>`。
3. **Release UI 没有启动 Runtime 的入口**。只有托盘菜单能启动，界面无从操作。已在 Overview 的 hero 区增加 Connect / Disconnect 按钮。

## 7. 风险与未完成项

### P1

1. 出站流量未验证。本机当前无外网，502 只证明代理链路存在。
2. 模拟器无硬件加速，签名 APK 未做安装验证。
3. 性能采样未分离 UI 与 Mihomo 资源。

### P2

1. 托盘真实鼠标路径仍未人工验收（阶段 4 起就是遗留项）。
2. geodata 是快照，会随规则更新过时，无自动更新机制。
3. 42 张视觉截图未人工逐张核对。
4. `stage6-performance-before.json` 的托盘步骤失败，若要完整通过需修复 UI Automation 查找逻辑后重跑。

### P3

MSI 安装包未产出（WiX 工具链不在离线缓存），窄窗口与最小窗口的性能采样未做，优化前后对比未做。

## 8. 边界声明

本报告不得被解释为：

- 代理隧道已在公网验证可用。
- 性能已经优化。
- Android release APK 已在设备上验证。
- 视觉与参考图已逐张人工确认一致。
