# 第三阶段 Mihomo 集成检查报告

日期：2026-11-06  
范围：Windows 桌面端真实 Mihomo 集成、控制 API、真实数据页面、生命周期和安全边界。  
不在范围：TUN、系统代理、管理员权限操作、订阅下载、Android 实现和发布签名。

## 1. 结论

阶段 3 的 Windows 功能验收已经完成。应用能够发现并校验锁定的 Mihomo `v1.19.33`，启动、停止、重启和监控真实子进程，并通过仅供本机访问的控制 API 提供代理组、节点选择、规则、连接、Profile、流量和日志数据。A/C 双主题和生产页面继续可用。

本轮未发现 P0 问题。检查中修复了两项需要优先处理的问题：

1. Runtime 健康轮询可能在 Start/Stop/Restart 之后回写旧结果，覆盖较新的状态。现在轮询结果提交前会校验 Runtime sequence，并增加了回归测试。
2. Mihomo 配置校验器的 stdout/stderr 读取此前没有明确容量上限。现在限制为 64 KiB，并增加超限回归测试。

同时补齐了 Mihomo GPL 许可证归档，修正了 Windows 验收脚本路径处理，并将计划中错误的“优雅停止”描述改为实际实现的“立即终止并等待回收”。

当前不能宣称达到发布级完成状态：依赖漏洞审计、5 至 10 分钟性能验收、安装包、签名、升级卸载以及 macOS/Linux 验收仍未完成。

## 2. 架构与模块边界

| 层级 | 位置 | 职责 |
| --- | --- | --- |
| 共享契约 | `crates/flowproxy-contracts` | Runtime、核心信息、代理、延迟、流量、连接、规则、Profile 和错误码 |
| Mihomo 管理 | `crates/mihomo-manager` | 二进制校验、配置生成、原子写入、进程管理、日志采集和 loopback API client |
| Runtime | `crates/flowproxy-runtime` | 状态机、并发控制、健康轮询、崩溃检测、日志脱敏和有界缓存 |
| Tauri 组合根 | `apps/desktop/src-tauri` | 固定 typed commands/events、设置、托盘和受控退出 |
| 前端平台层 | `apps/desktop/src/platform` | 固定 bridge，不向业务组件暴露任意 shell、路径、URL 或 HTTP 调用 |
| 前端功能层 | `apps/desktop/src/features` | Overview、Proxies、Rules、Connections、Profiles、Logs 和 Settings |
| 前端状态层 | `apps/desktop/src/app/runtime` | Runtime context、外部 telemetry store 和受控频率采样 |

模块边界符合现有架构文档。进程与 HTTP 操作不持有 Runtime 状态锁；生产组合根只创建真实 `MihomoCoreAdapter`，Fake adapter 仅用于测试。前端高频流量数据由独立外部 store 分发，没有写入整页 React state。

## 3. 验证环境

| 项目 | 实测结果 |
| --- | --- |
| 操作系统 | Windows 10 专业版 22H2，10.0.19045，x64 |
| Node.js | v24.22.1 |
| pnpm | 10.12.1 |
| Rust | 1.99.1，stable-x86_64-pc-windows-msvc |
| Tauri | 2.12.5 |
| Cargo home | `F:\codex-install\cargo-home` |
| Cargo target | `F:\codex-install\cargo-target` |
| Mihomo | v1.19.33，Windows amd64 |
| 代理 | `http://192.168.1.2:7890`，本次审计请求超时 |

## 4. 构建与测试

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 通过，17 个测试文件、73 项测试 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo test --workspace` | 通过，80 项测试、0 失败 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过，无警告 |
| `pnpm tauri build --no-bundle` | 通过 |
| `pnpm audit --prod --audit-level high` | 未完成，代理 `192.168.1.2:7890` 连接超时 |
| `cargo audit` | 未完成，当前环境未安装 `cargo-audit` |

Rust 测试分布：

- `flowproxy-contracts`：8
- `flowproxy-desktop`：15
- `flowproxy-mihomo-manager`：29
- `flowproxy-runtime`：28

最新 release：

- 路径：`F:\codex-install\cargo-target\release\flowproxy-desktop.exe`
- 大小：11,130,368 B
- SHA-256：`77015DC1D05AFCF7D3BD553B490963FEE0894CDFD7F47ABB674B8A9E5089BE62`
- 构建时间：2026-11-06 10:42:03

## 5. Mihomo Runtime 验收

使用最新 release 和真实 `mihomo-windows-amd64.exe` 通过 WebView2 CDP 执行：

```json
{
  "initialBackend": "mihomo",
  "startedState": "connected",
  "duplicateStart": "already_running",
  "version": "v1.19.33",
  "proxyGroups": 2,
  "proxySelection": "DIRECT",
  "rules": 1,
  "profiles": 1,
  "activeConnections": 1,
  "crashState": "error",
  "stoppedState": "stopped",
  "loopbackListeners": [
    "127.0.0.1:58376",
    "127.0.0.1:58377"
  ]
}
```

已验证：

- 锁定二进制 SHA-256 和版本匹配后才允许执行。
- 控制 API 与代理端口均只监听 `127.0.0.1`。
- 重复 Start 返回稳定的 `already_running`。
- 代理组选择调用进入真实控制 API。
- Rules、Profiles 和活动连接来自真实 Mihomo 数据。
- 强制终止核心后 Runtime 进入 `error`，重新启动使用新的 PID。
- Restart 和 Stop 成功，停止后没有遗留 Mihomo 进程。
- 验收结束后应用进程、核心进程、控制端口、代理端口和 CDP 端口均已释放。

`DIRECT` 延迟测试返回 HTTP 503，并映射为结构化 `api_unavailable`。这是当前隔离 DIRECT profile 与外部测试目标组合下的已知限制，不代表 Runtime 或控制 API 崩溃。

## 6. 生命周期与资源采样

生命周期脚本通过真实 release 执行可见采样、关闭到托盘、隐藏采样和受控退出：

| 场景 | 采样时长 | CPU | 聚合 Working Set | 进程数 |
| --- | ---: | ---: | ---: | ---: |
| 可见且已连接 | 3.204 s | 0.92% | 517,033,984 B | 9 |
| 隐藏到托盘 | 3.207 s | 0.00% | 491,245,568 B | 9 |

隐藏前后 telemetry sample 计数保持 `13 -> 13`，说明前端流量采样在窗口隐藏后停止。应用和 Mihomo 在受控退出后均为 0 个进程。

该证据只证明短时行为，不满足 `performance-requirements.md` 要求的 5 至 10 分钟空闲、持续流量和隐藏驻留场景，不能据此确认最终 CPU/内存预算。

## 7. 安全与依赖检查

- 生成配置固定使用 `external-controller: 127.0.0.1`、`allow-lan: false`、`bind-address: 127.0.0.1`、`listeners: []` 和 `tun.enable: false`。
- 每次核心会话生成随机 API secret；日志和配置校验输出会脱敏。
- 子进程使用固定参数和 `std::process::Command` 启动，不经过 shell。
- Tauri 只暴露固定 typed commands；代理名、连接 ID 和延迟超时均有长度、控制字符或范围校验。
- 配置先写同目录临时文件，成功校验后原子替换，失败时恢复旧文件。
- 日志缓存和配置校验输出有界，避免无界内存增长。
- 密钥扫描未发现真实凭据。命中的 secret、password、token 和 Bearer 内容均为测试夹具或脱敏规则样例。
- Mihomo GPL 许可证已归档到 `third_party/mihomo/LICENSE`，SHA-256 为 `8CEB4B9EE5ADEDDE47B31E975C1D90C73AD27B6B165A1DCD80C7C545EB65B903`。
- 前端未引入图表库、3D 引擎或大型状态管理库。
- 两个依赖漏洞审计均未完成，具体原因见第 4 节，不能记为通过。

## 8. A/C 截图与视觉检查

阶段 3 共保留 22 张真实数据截图，位于 `artifacts/screenshots/`：

- Overview A/C、窄窗口和最小窗口。
- Proxies、Rules、Connections、Profiles、Logs 的 A/C 页面。
- Settings A/C、窄窗口和最小窗口。

已实际检查 `stage3-overview-a.png` 和 `stage3-overview-c.png`：

- A 主题保留深蓝背景、蓝紫霓虹、发光 Network Orb 和科技感数据卡片。
- C 主题保留暖白背景、蓝白吉祥物、橙蓝点缀和柔和圆角阴影。
- A/C 页面功能结构一致，没有明显裁切、重叠或横向溢出。

与参考图仍有差异：

1. 参考图展示型小卡片与实际桌面工作台的信息密度不同，侧栏和卡片比例仍有差异。
2. C 主题吉祥物的轮廓、材质和细节经过本地实现，与参考图不完全一致。
3. 品牌字标和 Network Orb 细节没有逐像素复刻。
4. 节点地图轮廓较简化。
5. 没有可信节点地理数据时显示 `Location data unavailable`，没有伪造地图节点。

## 9. 问题分级

### P0

无。

### P1

1. **依赖漏洞审计未完成。** 代理连接超时导致 `pnpm audit` 失败，当前环境也没有 `cargo-audit`。发布前必须恢复可重复执行的 npm 和 RustSec 审计。
2. **性能验收不足。** 当前只有约 3.2 秒的可见/隐藏采样，尚未覆盖 5 至 10 分钟空闲、稳定连接、持续流量和大列表场景。
3. **Mihomo 分发链路未完成。** Release 不附带也不自动下载核心，用户必须手工放置指定文件名或设置环境变量。发布前需要确定签名、下载、校验、升级和 GPL 分发方案。

### P2

1. 核心停止使用立即 `kill` 加 `wait`，没有优雅关闭协议。当前能可靠回收进程，但会直接中断活动连接。
2. 隐藏窗口后前端采样停止，但 Rust 健康轮询仍固定每 1.5 秒运行。短时 CPU 为 0.00%，仍需长测后决定是否增加隐藏态退避。
3. 聚合 Working Set 在隐藏态约为 491 MB，主要来自 WebView2 多进程。当前没有正式内存预算，不能判定是否达标。
4. 仅完成 Windows 验证。macOS、Linux 的进程管理、WebView、字体、阴影和托盘行为尚未验证。
5. 尚未生成 NSIS 安装包，也未验证代码签名、升级和卸载。

### P3

1. 参考图与实现仍有侧栏比例、卡片比例、品牌字标、吉祥物细节和地图轮廓差异。
2. `DIRECT` 延迟测试可能返回 HTTP 503，需要在后续测试目标策略中消除或提供更明确的用户提示。
3. 当前分支尚无提交，仓库文件仍全部处于未跟踪状态，缺少可恢复版本基线。

## 10. 阶段结论

阶段 3 的 Windows 真实 Mihomo 功能与安全边界验收到此结束。阶段 4 不得在本报告中自动展开；TUN、系统代理、管理员权限操作和 Android 实现仍需后续独立任务。
