# Android：Kotlin + Jetpack Compose

## 1. 模块建议

- `app`: Application、导航、依赖注入入口。
- `feature-overview`: 首页。
- `feature-proxies`: 代理组与节点。
- `feature-rules`: 规则。
- `feature-connections`: 连接。
- `feature-profiles`: 配置。
- `feature-logs`: 日志。
- `feature-settings`: 设置。
- `core-ui`: 通用组件。
- `core-theme`: A/C 主题 tokens。
- `core-data`: Room、DataStore、Repository。
- `vpn-service`: Android VpnService。
- `mihomo-bridge`: Mihomo Native 桥接和生命周期。

## 2. VPN 生命周期

- 通过 Android `VpnService` 请求用户授权。
- 授权状态、服务状态和 Mihomo 状态分别建模。
- 前台服务通知应清楚说明代理运行状态。
- 断开、重连、系统回收和设备重启场景必须测试。
- 不允许 UI 显示 Connected，但 VPNService 或核心实际未运行。

## 3. Native 集成验证

在确认技术路线前先做 spike：
- Mihomo 目标版本能否构建为 Android 可用 native artifact。
- JNI/gomobile 或其他桥接方案的可行性。
- TUN file descriptor 交接方式。
- ABI：至少验证 arm64-v8a；其他 ABI 视发行范围决定。
- 前后台切换、服务重启、网络切换和系统省电策略。
- 许可证、第三方依赖和分发要求。

## 4. UI 主题

- A 默认，C 可选。
- 使用 Compose Material 体系的自定义 tokens，不直接套默认 Material 外观。
- A 的 Orb 与 C 的吉祥物使用独立资源。
- Android 采用移动端信息架构，不缩小桌面侧栏。
- 主题选择持久化，切换不重启代理核心。
