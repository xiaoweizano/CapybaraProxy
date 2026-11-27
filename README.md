<div align="center">

<img src="assets/brand/app-icon.png" width="128" alt="CapybaraProxy">

# CapybaraProxy

**跨平台个人网络代理客户端，以 Mihomo 为内核**

[简体中文](README.md) · [English](README.en.md)

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-2ea44f)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![Rust](https://img.shields.io/badge/Rust-1.77-000000)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

</div>

---

## CapybaraProxy 是什么

CapybaraProxy 是一个自带并托管 Mihomo 核心的网络代理客户端。它把订阅、代理组、规则、连接和系统代理放在一个界面里，不需要你编辑 YAML，也不用手动启动核心进程。

安装包自带校验过的 Mihomo 与 geodata，装完就能用。订阅里的控制端口、API 密钥和监听端口始终由客户端接管，订阅本身改不了这些。

## 功能

**订阅**
- 多订阅库：保存多份订阅随时切换，每份独立存储、可单独删除
- 导入方式：订阅链接、Clash / Mihomo YAML，或 `ss://` `vmess://` `vless://` `trojan://` `hysteria2://` `tuic://` 分享链接（自动转换）
- 解析 `subscription-userinfo`，显示已用流量、总量进度与到期时间
- 覆写：每份订阅可保存自定义规则与覆写 YAML，刷新订阅不丢失；端口、密钥等控制项始终由客户端接管
- 自动更新：启动时更新、定时更新（预设或 1–168 小时），可选更新后自动重启核心
- Sub-Store 对接：填后端地址与 token，列出并一键导入

**代理**
- 规则 / 全局 / 直连三种模式，运行中切换无需重启
- 代理组支持搜索、按延迟或名称排序、折叠、置顶常用节点，视图状态会记住
- 单节点测速、整组测速、一键测速全部组；测速历史保留在页面上

**观测**
- 概览：实时上下行速率、流量曲线、会话时长，以及按天记账的**今日**与**近 7 天**累计流量（核心重启不清零）
- 连接：可展开查看完整详情（域名、目标地址、命中规则、链路、上传量、建立时间），支持搜索与一键全部关闭
- 规则：显示每条规则当前命中的连接数，列出规则集与代理集来源
- 规则调试器：输入域名或 IP，按顺序评估规则表，告诉你哪条规则决定路由；无法评估的规则类型会明确列出
- 日志：级别筛选、搜索、暂停、清空视图

**系统**
- Windows 当前用户系统代理，带 journal 备份：退出时恢复你的原值，下次启动自动重新应用
- 系统代理旁路列表可配置，同样纳入备份还原
- TUN 开关：进程已提权且系统装有 Wintun 时可开启
- 开机启动、静默启动、启动后自动连接
- 系统托盘：状态与当前节点、代理模式切换、打开日志目录、实时速率图标
- 按天滚动日志，可设保留天数；一键导出**脱敏**诊断包（不含订阅 URL、Token 与密钥，不联网）

**效率**
- `Ctrl/Cmd + K` 命令面板：跳转页面、切换代理模式、直接选中节点

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Tauri 2 |
| 前端 | React 19 + TypeScript（strict）+ Vite |
| 核心逻辑 | Rust（contracts / runtime / mihomo-manager / platform 四个 crate） |
| 代理核心 | Mihomo（自带，启动前校验 SHA-256 与版本） |
| Android | Kotlin + Jetpack Compose + `VpnService` |
| 测试 | Vitest（131 条）+ cargo test（228 条） |
| 打包 | tauri-bundler（NSIS） |

## 开发

```bash
pnpm install

pnpm dev          # 只启动前端，用于界面调试
pnpm tauri:dev    # 启动完整桌面应用

pnpm lint
pnpm typecheck
pnpm test
node scripts/verify-locale-keys.mjs   # 中英语言包键一致性
```

Rust 侧：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

打包：

```powershell
node scripts/prepare-bundle-resources.mjs   # 按固定哈希准备 Mihomo 与 geodata
pnpm tauri:build                             # 生成 NSIS 安装包
```

`apps/desktop/src-tauri/resources/` 不入库（约 74 MB 二进制），由上面的脚本复制。改动图标后重新生成各平台尺寸：

```bash
pnpm tauri icon assets/brand/app-icon.png
```

可选环境变量：`CAPYBARA_MIHOMO_PATH` 指向一个已校验的核心，`CAPYBARA_CONFIG_ROOT` 覆盖配置目录。离线构建用 `CARGO_NET_OFFLINE=true`。

## 数据存放位置

全部保存在应用配置目录（Windows 下通常是 `%APPDATA%\com.capybara.proxy\`）：

| 路径 | 内容 |
|---|---|
| `settings.json` | 界面与行为设置 |
| `mihomo/subscriptions/` | 订阅原文与元数据 |
| `mihomo/subscriptions.json` | 当前生效的订阅 |
| `mihomo/config.yaml` | 生成的运行配置 |
| `system-proxy.json` | 系统代理的备份与所有权记录 |
| `traffic.json` | 按天流量记账 |
| `cores/` | 登记的内核版本 |

这些文件都是明文，**不做加密**；订阅文件里含服务商凭据，请按文件权限保护。

从旧版本（FlowProxy）升级时，首次启动会把旧目录 `%APPDATA%\com.flowproxy.desktop\` 的内容复制过来，旧目录保留，确认无误后可手动删除。

## 已知限制

- **TUN 需要提权**：进程未以管理员运行，或系统缺少 Wintun 驱动时，开关会禁用并说明原因
- **仅 Windows 完成实测**：macOS / Linux 的系统集成保持 `unverified`，不会调用未经验证的系统修改接口
- **Android 尚未接入真实核心**：界面、主题与 `VpnService` 骨架已完成，真实 Mihomo Native 与 TUN 还没接通
- **一次只有一份生效订阅**：订阅库是并列的多份配置，没有「同一订阅的上一版」回滚
- **不做应用自更新**：内核版本需要手动放入 `cores/` 并登记

## 仓库结构

```
apps/
  desktop/          Tauri 桌面端（React + TypeScript + Rust）
  android/          Android 端（Kotlin + Jetpack Compose）
crates/
  capybara-contracts        跨端共享的数据契约
  capybara-runtime          运行时状态机与日志
  capybara-mihomo-manager   Mihomo 子进程、控制 API、订阅与配置
  capybara-platform         平台能力（系统代理、开机启动、TUN 探测）
packages/
  design-tokens     桌面与 Android 共享的设计令牌
docs/              产品、界面、架构与各阶段报告
scripts/           资源准备、验收与校验脚本
```

## 文档

- 产品需求：`docs/product/product-requirements.md`
- 界面规范：`docs/ui-design/`（参考图、两套主题、吉祥物、组件规格）
- 架构：`docs/architecture/`（总体架构、桌面、Android、性能、平台矩阵）
- 开发：`docs/development/`（各阶段报告、订阅能力边界、CI 说明）

## 免责声明

- **请自行评估使用风险。** 本软件按「现状」提供，不附带任何担保。作者不对因使用或无法使用本软件造成的任何损失负责。
- **订阅由你自己提供。** 客户端只负责下载与托管，不对订阅内容的合法性、可用性负责。
- **系统代理会修改系统设置。** 退出时会还原，但异常退出后请确认「设置 → 系统集成」中的状态。
- **诊断包不含密钥但仍含环境信息。** 分享前请自行检查内容。

## 第三方与致谢

代理核心为 [Mihomo](https://github.com/MetaCubeX/mihomo)，按其原始许可分发；GEOIP / GEOSITE 数据来自 [meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)（GPL-3.0）。图标为项目自有资源。

## 许可

GPL-3.0，见 [LICENSE](LICENSE)。
