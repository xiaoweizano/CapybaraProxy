# 第四阶段系统集成检查报告

日期：2026-11-06  
范围：Windows 当前用户系统代理、Journal 恢复、开机启动、TUN 能力探测、
Runtime 生命周期协调、Settings 集成面板和 A/C 截图验收。  
不在范围：TUN 激活、管理员权限操作、订阅下载、安装包、发布签名、Android
实现、macOS/Linux 系统修改。

## 1. 结论

阶段 4 的 Windows 功能与安全边界已完成本轮验收。最新 release 能通过
WebView2 CDP 启动真实应用，管理真实 Mihomo `v1.19.33`，启用和恢复当前用户
系统代理，处理外部代理改动，在核心崩溃、Runtime 重启、脏 Journal 启动恢复和
受控退出时维持正确所有权。开机启动启用、停用和同名冲突保护通过。

TUN 仅探测，未激活，也未修改路由或系统代理以外的网络配置。macOS/Linux 仍为
`unverified`。阶段 5 未开始。

本轮检查修复了以下问题：

1. Windows 验收脚本把异步 Runtime 重启错误地断言为立即 `connected`。真实
   契约是命令先返回 `running_disconnected`，健康检查确认新核心控制 API 后
   才发布 `connected` 并恢复系统代理。脚本已改为验证该完整时序。
2. 开发依赖中 Vitest 3.2.7 及 `tinypool@1.1.1` 存在 2 个 Critical 和
   2 个 Moderate 安全公告。已升级到 Vitest 4.1.12，前端测试全部通过。
3. ESLint 间接依赖 `minimatch@10.2.6` 存在 1 个 Moderate DoS 公告。已通过
   pnpm overrides 锁定到 `^11.0.1`，Lint 和完整依赖审计通过。
4. A/C 截图脚本曾匹配到 Mihomo Core 面板中的 “System proxy” 文本，而非
   Integration 面板，因此“视口内”检查不完整。已改为匹配 Integration 面板
   的 `Launch at login` 和 `TUN interface`，补充纵向视口断言和面板截图。

当前无 P0 问题。发布前仍需完成安装包、签名、长时间资源测试和跨平台验证。

## 2. 验证环境

| 项目 | 本轮实测 |
| --- | --- |
| 操作系统 | Windows 10 专业版 22H2，10.0.19045，x64 |
| Node.js | v24.22.2 |
| pnpm | 10.12.1 |
| Rust | 1.99.1 |
| Cargo | 1.99.1 |
| Mihomo | v1.19.33，Windows amd64 |
| Cargo home | `F:\codex-install\cargo-home` |
| Cargo target | `F:\codex-install\cargo-target` |
| 网络代理 | `http://192.168.1.2:7890` |

## 3. 构建与测试

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 通过，19 个测试文件、89 项测试 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `cargo fmt --all -- --check` | 初次发现并修正格式差异；最终复验通过 |
| `cargo test --workspace` | 通过，112 项测试、0 失败 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `pnpm tauri build --no-bundle` | 通过 |
| `pnpm audit --prod` | 通过，16 个生产依赖，0 漏洞 |
| `pnpm audit` | 通过，338 个依赖，0 漏洞 |
| `cargo-audit audit --file Cargo.lock` | 扫描 415 个 crate，0 漏洞，2 条允许级警告 |

最终无安装包 release：

- 路径：`F:\codex-install\cargo-target\release\capybara-desktop.exe`
- 构建时间：`2026-11-06T13:59:55+08:00`
- 大小：`11,256,832` 字节
- SHA-256：
  `A351109FE79A5D33BEF5DFF2898FFF827BF26DFB0CC3360B4BE97B818F85C441`

RustSec 允许级警告：

- `proc-macro-error@1.0.4`：上游 crate 已停止维护，
  `RUSTSEC-2024-0370`。
- `glib@0.18.5`：`VariantStrIter` 存在已知 unsoundness，
  `RUSTSEC-2024-0429`，来自 GTK/Tauri 依赖链。

这两条不是已披露漏洞命中，但属于上游依赖风险，发布前应随 Tauri/GTK 升级
复核。

## 4. Windows 真实系统验收

验收脚本：`scripts/verify-stage4-windows.mjs`  
证据：`artifacts/stage4-windows-acceptance.json`  
结果：`passed`

已验证：

- capability 状态：系统代理 `available`、开机启动 `available`、TUN `blocked`
  （当前进程未提权）。
- 初始代理 `192.168.1.2:7890` 被完整记录；启用后切换为
  `127.0.0.1:<random-loopback-port>`，停用后恢复原值。
- 模拟外部软件将代理改为 `10.0.0.2:8080` 后，CapybaraProxy 释放 Journal 所有权，
  保留外部值，不覆盖用户修改。
- 强制终止 Mihomo 后 Runtime 进入 `error`，系统代理恢复原值且 Journal 清除。
- Runtime 重启先报告 `running_disconnected`，替换核心连接后切换到
  `connected`，并使用新的回环端口重新启用系统代理。
- 开机启动写入当前用户 `Run\CapybaraProxy`，命令为带引号的 release 绝对路径；
  停用后删除自身值。
- 外部同名 `Run\CapybaraProxy` 值被报告为 `conflict`，启用和停用均不覆盖。
- 应用和核心同时强杀后保留脏 Journal；下一次启动恢复原代理并删除 Journal。
- 受控退出恢复系统代理、结束 CapybaraProxy 和 Mihomo 进程。
- `finally` 路径把测试前代理注册表、开机启动值和 Journal 恢复；本轮实测原
  代理仍为 `192.168.1.2:7890`。

## 5. UI 与主题验收

截图脚本：`scripts/capture-stage4-tauri.mjs`  
证据脚本结果：`status: passed`，两套主题均重载并保持主题选择。

| 主题 | 页面截图 | Integration 截图 |
| --- | --- | --- |
| A Cyber Flow | `artifacts/screenshots/stage4-settings-a.png` | `artifacts/screenshots/stage4-settings-a-integration.png` |
| C Warm Flow | `artifacts/screenshots/stage4-settings-c.png` | `artifacts/screenshots/stage4-settings-c-integration.png` |

实测布局：

- 视口：1280 x 820，devicePixelRatio 1。
- `document`、`body` 和 `.page-viewport` 横向溢出均为 0。
- Integration 面板滚动后完整位于纵向视口内。
- 页面显示 `System proxy`、`Launch at login`、`TUN interface` 和
  `Detection only`。
- A 主题保留深蓝霓虹数据卡片；C 主题保留暖白背景、橙色强调和柔和卡片。
- 两套主题功能结构一致，主题选择在页面重载后保持。

与参考图仍存在的视觉差异：

1. 参考图的信息密度和当前桌面工作台不同，侧栏宽度及卡片比例未逐像素复刻。
2. A 主题 Network Orb 的层次和光效为本地实现，细节与参考图不完全一致。
3. C 主题吉祥物的轮廓、材质和表情细节与参考图存在差异。
4. 节点地图轮廓仍较简化，没有伪造地理节点。

## 6. 安全、生命周期与资源

- UI 命令不接受任意代理端点、注册表路径、可执行文件路径或 shell 输入。
- 系统代理只使用 Runtime 已验证的回环端点。
- Journal 为有版本、有大小限制的结构化 JSON，并使用原子替换。
- 外部代理和外部开机启动值都有所有权保护。
- 生命周期请求串行化；代理恢复失败会阻止受控 Stop/Exit 假装成功。
- 系统集成状态只在 Settings 挂载和显式操作后刷新，没有新增周期 UI 轮询。
- 本阶段没有新增后台线程或常驻 Windows 服务。
- 本阶段未完成 5 至 10 分钟隐藏驻留、稳定流量和大列表资源测试，不能宣称
  已达到最终 CPU/内存预算。

人工未验证项：

- 托盘 Connect、Disconnect、Show、Exit 的真实鼠标点击路径。自动化验收记录
  这四项为 `not_run`，不能标记为人工通过。
- 安装包、签名、升级和卸载流程。
- macOS/Linux 的系统代理、开机启动、托盘、提权和 TUN。

## 7. 残余问题分级

### P0

无。

### P1

1. Release 仍未生成安装包，也未验证签名、升级和卸载。
2. 长时间性能验收未完成，不能确认隐藏驻留和持续流量场景下的资源预算。

### P2

1. 托盘四项交互只完成代码与构建检查，真实鼠标操作待人工验证。
2. 异常强杀后的代理恢复依赖下一次 CapybaraProxy 启动；本阶段没有后台服务缩短
   该恢复窗口。
3. RustSec 有 2 条上游允许级警告，需要随 Tauri/GTK 依赖升级复核。
4. macOS/Linux 未运行验证，系统修改能力保持 `unverified`。

### P3

1. 参考图与实现的侧栏/卡片比例、Orb、吉祥物和地图细节仍有差异。
2. 当前仓库分支尚无提交，文件仍主要是未跟踪状态，缺少版本恢复基线。

## 8. 阶段边界

阶段 4 在 Windows 系统集成、自动测试、release 构建、真实运行验收和 A/C
截图完成后停止。TUN 激活、订阅下载、安装包发布链路、跨平台验证和 Android
实现属于后续阶段。

