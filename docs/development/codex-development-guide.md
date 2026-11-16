# Codex 开发任务书

## 0. 执行总则

开始前必须阅读：
- 根目录 `README.md`
- `docs/product/`
- `docs/ui-design/`
- `docs/architecture/`
- `docs/development/`
- `assets/design-reference/` 两张图片

严格遵循已确认决策：
- A Cyber Flow 默认，C Warm Flow 可切换。
- 桌面和 Android 都支持 A/C。
- 关闭窗口默认驻留托盘，设置可改为退出。
- 桌面优先 React + Tauri + Rust。
- Android 使用 Kotlin + Jetpack Compose。
- Mihomo 自行管理。
- CPU、内存和后台资源优先。
- UI 以两张参考图为视觉基准。

禁止：
- 自行改产品名、主题方向、导航结构。
- 把 Electron 或 Flutter 擅自替换为正式桌面方案。
- 未验证就宣称 Android Mihomo Native 集成已经可用。
- 在第一阶段引入真实代理核心和系统级网络修改。
- 使用随机数据冒充真实运行状态。
- 在未说明的情况下增加大型依赖。

## 1. 阶段 0：仓库检查和技术验证

任务：
1. 检查开发环境、Rust、Node、包管理器、Android SDK、JDK。
2. 创建 ADR，记录桌面 Tauri + Rust、Android Compose 的选择及待验证风险。
3. 验证 Tauri 在 Windows、macOS、Linux 的构建条件。
4. 验证 Linux WebKitGTK 依赖。
5. 调研并验证 Mihomo 锁定版本的许可证、分发方式和控制 API。
6. Android Native spike：验证构建产物、桥接和 TUN FD 方案。
7. 输出 `docs/development/technical-spike-report.md`。

验收：
- 不把未验证项写成已完成。
- 所有平台限制、依赖、许可证风险有记录。
- 不因某个平台暂时无法构建而静默删除该平台。

## 2. 阶段 1：项目骨架和静态 UI

桌面：
1. 建立 React + TypeScript + Tauri 工程。
2. 建立导航和页面路由。
3. 建立主题 token 系统。
4. 完成 A/C 主题切换和持久化。
5. 完成 Overview 静态页面。
6. 按参考图还原桌面布局和卡片比例。
7. 实现托盘与关闭窗口隐藏行为的 UI/接口骨架；若平台能力尚未接通，明确标注。

Android：
1. 建立 Kotlin + Compose 工程骨架。
2. 建立主题 tokens 和 A/C 切换。
3. 完成移动端 Overview 静态原型。
4. 不缩放桌面 UI，使用移动端布局。

数据：
- 原型数据必须集中放在 mock 层。
- UI 标注 mock 状态，后续可整体替换。
- 不让 mock 数据进入正式 Runtime 层。

验收：
- 两端能构建。
- A/C 切换可用且持久化。
- 截图与参考图进行视觉比对。
- 没有代理核心集成也能运行 UI。

## 3. 阶段 2：桌面 Runtime 骨架

任务：
1. 建立 Rust Runtime Manager。
2. 实现进程状态机和统一错误类型。
3. 建立 Mihomo adapter 接口，先用 fake adapter 测试。
4. 实现日志采集和脱敏。
5. 实现 Tauri typed commands/events。
6. 实现窗口关闭隐藏、托盘重新打开、托盘退出。
7. 实现设置持久化。
8. 预留系统代理/TUN adapter，不要伪造已实现状态。

验收：
- 假核心可以验证 start/stop/restart/crash 状态流。
- 重复启动不会创建多个核心实例。
- 关闭窗口后进程仍驻留。
- 托盘 Exit 能执行受控退出。
- 日志不包含订阅凭据和 API secret。

## 4. 阶段 3：Mihomo 集成

任务：
1. 锁定 Mihomo 版本并归档许可证审查结论。
2. 核心二进制获取、校验和版本管理。
3. 启动参数、工作目录和配置路径。
4. 控制 API 本机绑定和随机密钥。
5. 健康检查、状态同步和异常退出恢复。
6. 配置校验、原子写入、切换和回滚。
7. 接入代理组、节点、延迟、流量、连接和日志数据。

验收：
- 所有 UI 状态来自真实核心。
- 核心异常退出可检测。
- 配置错误有可理解的错误提示。
- 不能通过 UI 任意执行 shell。
- 控制 API 不暴露给局域网或公网。

## 5. 阶段 4：系统集成

按平台分别实施：
- Windows：系统代理、TUN 权限、托盘、开机启动。
- macOS：系统代理、TUN/网络扩展所需能力、签名和权限。
- Linux：系统代理、TUN 权限、托盘与桌面环境差异。

验收：
- 每项能力有平台支持矩阵。
- 权限拒绝时 UI 明确提示。
- 退出/崩溃后不会遗留错误系统代理状态。
- 系统代理和 TUN 的启用/关闭可验证。

## 6. 阶段 5：Android 实现

任务：
1. 完成 VPNService 授权和生命周期。
2. 完成 Mihomo Native bridge 技术验证。
3. 建立前台服务通知和状态同步。
4. 实现配置、节点、代理组、流量、连接和日志展示。
5. 完成网络切换、休眠、重启、服务回收场景。
6. A/C 双主题和吉祥物资源接入。

验收：
- Android VPN 状态与 UI 一致。
- 授权拒绝、服务停止、核心异常均可恢复。
- 后台运行遵循 Android 前台服务和电池策略。
- 不宣称未经验证的 Native 集成能力。

## 7. 阶段 6：性能与视觉验收

视觉：
- 对照 A/C 参考图逐页截图。
- 桌面至少覆盖标准窗口和窄窗口。
- Android 覆盖至少两种屏幕尺寸。
- 检查字体、间距、颜色、阴影、曲线、Orb 和吉祥物。
- 主题切换不影响功能状态。

性能：
- 执行 `performance-requirements.md` 全部场景。
- 分开记录 UI 与 Mihomo 资源。
- 检查窗口隐藏后的 CPU、内存和后台唤醒。
- 检查流量高频更新是否造成整页渲染。
- 优化前后都保留测量数据。

## 8. 每次 Codex 任务的工作方式

每次任务开始：
1. 阅读相关规范。
2. 检查当前仓库状态，不覆盖用户已有修改。
3. 说明本次计划和涉及文件。
4. 小步实现。
5. 执行格式化、lint、单元测试和构建。
6. 汇报完成项、未完成项、测试结果和风险。
7. 更新文档。

不要一次性实现全部阶段。每个阶段单独提交或形成可审查的变更集。

## 9. Codex 首轮提示词

请先阅读仓库中的 README.md 和 docs/ 下所有产品、UI、架构、性能及开发规范，并查看 assets/design-reference/ 中的两张 FlowProxy 参考图。

当前任务只执行阶段 0 和阶段 1 的桌面工程骨架准备。先检查仓库和开发环境，不要覆盖已有文件。采用 React + TypeScript + Tauri + Rust。建立可运行的桌面工程、导航、Overview 静态 UI、A/C 双主题和主题持久化。A 为默认主题，严格以参考图为视觉基准。暂不集成 Mihomo，不实现真实系统代理/TUN，不要用假数据冒充真实状态。完成后运行构建和测试，提供运行方法、截图、测试结果、已知差异和下一步建议。Android 只建立独立工程方案，不要在本任务中同时展开完整实现。
