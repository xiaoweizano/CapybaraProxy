# 第二阶段 Runtime 骨架检查报告

日期：2026-11-05

范围：CapybaraProxy 桌面 Runtime 骨架、Runtime Demo UI、原生设置持久化和受控退出；Windows 优先验证。

## 1. 结论

阶段 2 在既定范围内完成。Fake Mihomo adapter、Runtime 状态机、typed Tauri commands/events、Rust 设置存储、关闭到托盘、受控退出和 Settings 中的 Runtime Demo 已实现并通过 Windows release 自动验收。

本轮未发现 P0/P1 产品缺陷。检查过程中发现并修复了两项问题：

1. `access_token`、`api_key`、`client_secret` 等复合密钥字段此前可能绕过日志脱敏。现已扩展脱敏规则并增加回归测试。
2. Runtime CDP 验收脚本可能在 React 尚未挂载时提前设置路由，造成冷启动误报。现会先等待应用壳和主导航就绪，再进入 Settings。

本阶段没有接入真实 Mihomo 进程、TUN、系统代理或管理员权限操作，也没有把 Demo Runtime 描述为真实代理状态。

## 2. 架构与模块边界

| 层级 | 位置 | 职责 |
| --- | --- | --- |
| 共享契约 | `crates/capybara-contracts` | Runtime 状态、错误码、命令结果、快照和日志类型 |
| Mihomo adapter | `crates/mihomo-manager` | `MihomoAdapter` 接口与无进程副作用的 Fake adapter |
| Runtime | `crates/capybara-runtime` | 状态机、串行化变更、日志缓冲、脱敏和错误映射 |
| Tauri 组合根 | `apps/desktop/src-tauri` | 命令/事件注册、原生设置、托盘和受控退出 |
| 前端平台层 | `apps/desktop/src/platform` | 固定 typed bridge，不向业务组件暴露任意 invoke |
| 前端功能层 | `apps/desktop/src/features/runtime` | Runtime Demo UI，只通过 bridge 访问 Runtime |
| 设置与主题 | `apps/desktop/src/app` | 原生设置迁移、主题状态和 A/C 主题切换 |

Runtime 修改由单个互斥锁串行化，快照序号单调递增。日志容量固定为 500，并先脱敏再写入。Demo adapter 不启动进程、不监听端口，不与正式 Mihomo 能力混淆。

## 3. 验证环境

| 项目 | 实测结果 |
| --- | --- |
| 操作系统 | Windows 10 专业版 22H2，10.0.19045，x64 |
| Node.js | 22.14.0 |
| pnpm | 10.12.1 |
| Rust | 1.99.1，stable-x86_64-pc-windows-msvc |
| Cargo target | `F:\codex-install\cargo-target` |
| Cargo home | `F:\codex-install\cargo-home` |
| Tauri | 2.12.5 |
| 代理 | `http://192.168.1.2:7890` |

## 4. 构建与测试结果

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 通过，15 个测试文件、54 项测试 |
| `pnpm build` | 通过；JS 335.40 kB（gzip 103.74 kB），CSS 43.95 kB（gzip 11.69 kB） |
| `cargo fmt -- --check` | 通过 |
| `cargo test --workspace` | 通过，38 项测试 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过，无警告 |
| `pnpm tauri build --no-bundle` | 通过 |
| `pnpm audit --prod --audit-level high` | 通过，未发现已知生产依赖漏洞 |
| `cargo audit` | 无法执行，当前环境未安装 `cargo-audit` |

Rust 测试分布：

- `capybara-contracts`：5
- `capybara-desktop`：12
- `capybara-mihomo-manager`：3
- `capybara-runtime`：18

release 程序：

- 路径：`F:\codex-install\cargo-target\release\capybara-desktop.exe`
- 大小：10,843,648 B
- SHA-256：`680D61321981511C51BE0221652018E8B459C719EA94D37AF6B40163B21E5D70`

## 5. Runtime 自动验收

使用最新 release 冷启动，并通过 WebView2 CDP 实际操作 Runtime Demo：

```json
{
  "duplicateStart": "already_running",
  "sequenceAfterStart": 2,
  "sequenceAfterRestart": 6,
  "crashMessage": "The Demo Runtime simulated an unexpected core exit.",
  "themePersistedAcrossReload": true,
  "finalRuntimeState": "Stopped",
  "finalTheme": "cyber_flow"
}
```

已验证：

- Start、Stop、Restart 和崩溃模拟状态转换。
- 重复 Start 返回稳定的 `already_running` 结构化错误。
- Restart 后 snapshot sequence 前移。
- Runtime 日志显示预期 Demo 崩溃信息。
- C 主题在页面重载后保持，随后可恢复 A 主题。
- 验收结束后通过 `request_application_exit` 受控退出；应用进程数为 0，`9333` 无监听进程。

## 6. A/C 主题截图与布局

最终 release 已重新生成 12 张截图：

- `artifacts/screenshots/stage2-overview-a.png`
- `artifacts/screenshots/stage2-overview-c.png`
- `artifacts/screenshots/stage2-overview-a-narrow.png`
- `artifacts/screenshots/stage2-overview-c-narrow.png`
- `artifacts/screenshots/stage2-overview-a-minimum.png`
- `artifacts/screenshots/stage2-overview-c-minimum.png`
- `artifacts/screenshots/stage2-settings-a.png`
- `artifacts/screenshots/stage2-settings-c.png`
- `artifacts/screenshots/stage2-settings-a-narrow.png`
- `artifacts/screenshots/stage2-settings-c-narrow.png`
- `artifacts/screenshots/stage2-settings-a-minimum.png`
- `artifacts/screenshots/stage2-settings-c-minimum.png`

截图脚本在 1280x820、900x820 和 820x680 下检查页面横向溢出及关键组件边界，全部通过。最小高度允许页面纵向滚动。

与参考图仍存在以下视觉差异：

1. 侧栏约占 1280 宽的 17.7%，参考图约为 22%-25%，当前侧栏偏窄。
2. 品牌字标和图标处理与参考图不完全一致。
3. C 主题吉祥物可辨识，但轮廓、材质和柔和层次比参考图简化。
4. 节点地图更偏结构示意，地理轮廓和细节少于参考图。
5. 标准窗口的卡片比例、间距和底部留白仍有差异。
6. Settings 是阶段 2 的必要扩展页面，参考图中没有对应页面。

上述差异属于视觉还原度问题，未发现裁切、重叠或横向滚动。

## 7. 问题分级与残余风险

### P0/P1

无。

### P2

1. `RuntimeManager` 在持有内部互斥锁时调用 adapter 的 start/stop。Fake adapter 为同步内存操作，当前安全；阶段 3 接入真实子进程后必须改为可超时、可取消的异步操作，避免慢进程阻塞所有状态读取和命令。
2. 当前环境未安装 `cargo-audit`，因此本轮只有 pnpm 生产依赖审计结果，没有新的 RustSec 扫描证据。
3. 托盘 Show/Exit 的真实鼠标交互仍未能自动定位通知区图标，需要人工验收；受控退出命令本身已通过 CDP 验证。
4. 性能验证仍是短时测试，没有完成 5 到 10 分钟以上的持续流量和隐藏驻留测试，不能据此确认最终资源预算。

### P3

1. 窗口最小化、最大化和关闭失败目前只写入控制台，没有面向用户的错误反馈。
2. 原生设置读取失败时会显示启动时的 localStorage 缓存值，同时展示读取错误；保存仍走原生存储且失败不会伪装成功，但缓存可见性需要在正式设置页继续收敛。
3. Runtime 部分日志文本仍使用 Demo 专用表述，接入真实 Mihomo 前需要改为适配器事件和通用错误文本。
4. 仅验证 Windows。macOS、Linux 的 WebView、字体、阴影和托盘行为尚未验证。
5. 尚未验证安装包、代码签名、升级和卸载流程。
6. 主包暂未按页面懒加载。当前页面规模下未造成明显问题，后续服务页变重时需要拆分。
7. 当前分支尚无提交，仓库文件均处于未跟踪状态。阶段 2 完成后应建立首个可恢复的版本控制基线。

## 8. 依赖与资源检查

前端生产依赖保持轻量：React、React DOM、React Router、Tauri API、Lucide 和两组字体包。没有引入图表库、3D 引擎或大型状态管理库；流量图和 Network Orb 均为轻量本地实现。

Fake Runtime 不创建子进程、不监听端口。流量图独立采样并限制历史点数；文档隐藏时暂停流量采样和 CSS 动画。当前没有随机数据冒充真实代理状态，Overview 明确标记 `Mock preview`、`Mock traffic`、`Mock sessions` 和 `Mock locations`。

## 9. 阶段 3 入口条件

进入真实 Mihomo 管理前必须：

1. 设计异步 Runtime adapter、操作超时、取消、进程退避重启和崩溃回收。
2. 保持 Fake adapter 仅用于测试和 Demo，不让 Mock 数据进入正式运行状态。
3. 补齐真实进程日志采集、脱敏和退出清理。
4. 恢复 Cargo 依赖安全审计能力并保留可重复执行的审计证据。
5. 补做长时资源测试和 Windows 托盘人工验收。
6. 明确 Mihomo 二进制来源、校验、版本和升级策略。

阶段 2 到此停止，不包含真实 Mihomo、TUN、系统代理、管理员权限或 Android 实现。
