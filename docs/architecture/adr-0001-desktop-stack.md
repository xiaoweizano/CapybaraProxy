# ADR-0001：桌面端第一阶段技术栈

- 状态：第一阶段方案已采用
- 日期：2026-11-05
- 范围：Windows 桌面 UI 原型；macOS、Linux 和 Android 尚未进入验证

## 背景

CapybaraProxy 需要跨平台桌面 UI、低后台资源占用、原生窗口和托盘能力，并为后续 Rust Runtime Manager 与 Mihomo 子进程管理保留清晰边界。第一阶段禁止接入真实代理核心、系统代理和 TUN。

## 决策

桌面应用采用以下技术栈：

- 构建：Vite 7 + React 19 + TypeScript 6。
- 原生壳层：Tauri 2 + Rust 2021 edition。
- 路由：React Router，桌面应用使用 `HashRouter`，避免安装包内路由刷新问题。
- 样式：仓库内 CSS 变量与普通 CSS，不引入 UI 组件框架。
- 图标：Lucide React。
- 字体：Sora Variable、Manrope Variable，随前端包本地分发。
- 图表与主视觉：原生 SVG 和 CSS，不引入图表库、Canvas 3D 或 WebGL 依赖。
- 窗口：1280×820 默认尺寸、820×680 最小尺寸、无系统默认标题栏。
- 托盘：Tauri `tray-icon`，提供 Show 与 Exit。
- 关闭行为：默认隐藏到托盘；Settings 可切换为退出应用。

## 理由

- Tauri 复用系统 WebView，包体和常驻内存压力低于自带完整浏览器运行时的方案。
- Rust 壳层可直接承载后续 Runtime Manager 和 typed command/event 边界。
- SVG/CSS 足以实现当前 Orb、吉祥物、曲线和地图示意，避免为装饰效果增加重型依赖。
- 普通 CSS 和现有 tokens 让 A/C 主题保持独立视觉语言，同时复用同一组件语义。
- `HashRouter` 与 Tauri 打包后的静态资源加载方式兼容，不需要额外服务器。

## 后果

- Windows 使用 WebView2，macOS 和 Linux 使用各自系统 WebView；渲染、字体和动画必须逐平台验证。
- 无系统标题栏意味着拖拽、双击最大化、最小化、最大化和关闭控件由应用自行维护。
- 托盘行为具有平台差异，目前只能在代码层确认 Windows 构建和默认关闭隐藏，不能宣称 macOS/Linux 已验收。
- 当前 Mock 层仅用于视觉验收；正式 Runtime 数据和 Mock 数据必须继续隔离。

## 未采用方案

- Electron：未采用，原因是安装体积和后台资源占用更高。
- Flutter Desktop：与已确认的 React + Tauri + Rust 架构不一致。
- 大型 UI 组件库：会引入不需要的样式与运行时负担，不利于还原参考图。
- 重型图表/3D 引擎：当前视觉可用 SVG/CSS 完成，且不符合低资源要求。

## 后续检查点

1. 在 macOS 与 Linux 实机验证自定义标题栏、托盘、字体和 WebView 渲染。
2. 在 Runtime Manager 接入后，以 typed commands/events 替换 Mock 数据源。
3. 对 Windows 安装包、签名、升级和卸载流程单独建立阶段任务。
4. 归档实际 CPU、内存和隐藏窗口资源数据后，再确认正式性能预算。
