# CapybaraProxy 系统架构

## 1. 总体结构

### Desktop

React + TypeScript UI
→ Tauri command/event boundary
→ Rust Runtime Manager
→ Mihomo process / controller API
→ OS integration adapters

### Android

Jetpack Compose UI
→ ViewModel / UseCase
→ Android VPNService
→ Mihomo Android integration
→ Android system VPN/TUN APIs

### Shared contracts

- 配置 schema 与 YAML 示例
- 节点、代理组、规则、连接、流量数据模型
- Runtime 状态枚举
- 错误码与错误对象
- 主题 tokens 和设计语义
- 导入导出格式

共享契约，不强求共享 UI 或所有业务实现。

## 2. 模块边界

- `ui`: 纯展示和交互，不直接管理系统进程。
- `application`: 用例、状态编排和业务校验。
- `runtime`: 核心进程生命周期和状态协调。
- `mihomo`: Mihomo 适配器、控制 API、配置和版本管理。
- `platform`: 系统代理、TUN、托盘、开机启动、通知等平台能力。
- `storage`: 配置元数据、偏好、布局和安全存储。
- `contracts`: 跨端数据协议和 schema。

## 3. Mihomo 集成原则

- Mihomo 版本必须锁定并记录来源、校验和、许可证。
- 不假设存在可直接复用的官方 Android SDK。
- Android Native 集成必须单独验证构建、JNI/gomobile/原生接口、TUN FD 传递和生命周期。
- Desktop 优先将 Mihomo 作为受控子进程运行；控制 API 只监听本机受限地址。
- 控制 API 密钥不得暴露给不可信页面或写入日志。
- 配置文件写入采用临时文件 + 校验 + 原子替换策略。
- 核心异常退出要更新状态并提供重启能力。

## 4. 安全边界

- Tauri 开启最小权限 capability。
- UI 不允许任意执行 shell 命令。
- Rust 命令接口使用强类型参数并校验。
- 控制 API 仅允许本机访问，配置随机密钥。
- 订阅 URL、密码、token 等敏感信息脱敏。
- 不将用户配置上传到外部服务。
- 下载核心和更新包需校验哈希；签名验证作为发行要求。

## 5. 数据存储建议

桌面：
- SQLite 保存配置元数据、用户偏好、工作台布局、历史摘要。
- Mihomo 配置单独保存，避免把整个配置复制进普通数据库。
- 密钥和敏感字段优先使用系统凭据库。

Android：
- DataStore 保存轻量偏好。
- Room 保存配置元数据、历史和必要索引。
- 敏感数据使用 Android Keystore 支持的方案保护。

## 6. 目录建议

```text
CapybaraProxy/
├── apps/
│   ├── desktop/                 # React + Tauri
│   └── android/                 # Kotlin + Compose
├── crates/
│   ├── capybara-runtime/
│   ├── mihomo-manager/
│   ├── system-proxy/
│   ├── tun-manager/
│   └── shared-contracts/
├── packages/
│   ├── ui/
│   ├── theme-tokens/
│   └── contracts/
├── assets/
│   ├── brand/
│   ├── mascot/
│   └── design-reference/
├── docs/
├── scripts/
└── third_party/
    └── mihomo/                  # 仅在许可证和分发策略确认后纳入
```

## 7. 依赖策略

先选择少量成熟依赖。每个新增依赖必须说明用途、维护状态、许可证、包体/运行时影响。避免为了动效引入大型 3D 引擎或重型 UI 框架。
