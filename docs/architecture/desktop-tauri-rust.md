# 桌面端：React + Tauri + Rust

## 1. 技术职责

- React + TypeScript：页面、主题、组件和交互。
- CSS/SVG/Canvas：视觉效果、Orb 和轻量图表。
- Tauri：窗口、托盘、应用生命周期、前后端命令边界。
- Rust：Mihomo 进程、系统代理、TUN、文件、权限、状态管理。
- Mihomo：代理核心。

## 2. 窗口与托盘

- 关闭按钮默认执行 hide，不退出进程。
- 托盘图标常驻（用户配置允许时）。
- 托盘菜单提供 Show、Connect/Disconnect、Exit。
- Exit 触发应用级退出流程，而不是直接杀进程。
- 托盘能力按 Windows/macOS/Linux 分别验证。
- Linux 桌面环境和托盘实现差异必须记录。

## 3. Runtime Manager

建议状态机：
`Stopped → Starting → RunningDisconnected → Connected`
并支持 `Stopping`、`Error`、`PermissionRequired`。

Runtime Manager 负责：
- 启动参数和工作目录。
- 核心版本、路径和校验。
- 子进程监控。
- 标准输出/错误输出读取与日志脱敏。
- 优雅停止、超时后强制终止。
- 异常退出检测。
- 控制 API 健康检查。
- 系统代理/TUN 状态协调。

## 4. 前后端通信

- 低频命令使用 typed Tauri commands。
- 状态变化使用事件。
- 高频流量数据采用节流/批量事件，避免每个采样点都 IPC。
- UI 订阅只在页面可见时开启必要数据流。
- 所有 command 返回统一结果类型：成功数据或结构化错误。

## 5. WebView 差异

Tauri 使用系统 WebView。Windows、macOS、Linux 的 WebView 实现和版本存在差异。必须对字体、模糊、阴影、动画、Canvas、窗口透明效果和滚动行为进行实际验证，尤其 Linux WebKitGTK。

## 6. 发行前检查

- Windows：签名、安装/卸载、权限提升、系统代理清理。
- macOS：签名、公证、权限说明、TUN 能力。
- Linux：目标发行版、WebKitGTK 依赖、托盘环境、权限。
- Mihomo 许可证和分发义务需针对锁定版本审查。
