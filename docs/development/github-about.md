# GitHub About 设置参考

仓库页右侧 **About** 面板里需要填两项：**Description**（一句话简介，上限 350 字符）和
**Topics**（标签）。下面按用途分成几版，选一版复制即可。

设置位置：仓库页右上方齿轮图标 → 编辑 Description / Website / Topics。

---

## Description（简介）

### 版本 A — 最简洁（推荐）

**English**

```text
Cross-platform proxy client bundling the Mihomo core. Subscriptions, proxy groups, rules, connections and the system proxy in one interface.
```

**中文**

```text
跨平台代理客户端，自带 Mihomo 内核。订阅、代理组、规则、连接与系统代理集中在一个界面里。
```

> 分别 140 / 48 字符，远低于 350 的上限，搜索结果与移动端都不会被截断。

---

### 版本 B — 强调平台与技术栈

**English**

```text
A Tauri + Rust proxy client for Windows and Android. Ships a verified Mihomo core, manages subscriptions and the Windows system proxy, and never lets a subscription take over its control ports.
```

**中文**

```text
基于 Tauri + Rust 的 Windows / Android 代理客户端。自带校验过的 Mihomo 内核，管理订阅与 Windows 系统代理，订阅无法接管控制端口。
```

---

### 版本 C — 强调能力清单

**English**

```text
Mihomo-based proxy client with a subscription library, rule overrides, DNS/TUN settings, a rule tester and per-day traffic accounting. Windows verified; Android UI in progress.
```

**中文**

```text
基于 Mihomo 的代理客户端：多订阅库、规则覆写、DNS/TUN 设置、规则调试器与按天流量记账。Windows 已完成实测，Android 界面开发中。
```

---

## Topics（标签）

GitHub Topics 建议 6–10 个，全部小写、用连字符。按仓库实际情况：

```text
proxy
mihomo
clash
tauri
rust
react
typescript
windows
android
kotlin
```

**取舍建议**

- 想被「找代理客户端」的人搜到 → 保留 `proxy` `mihomo` `clash`
- 想被「找 Tauri 项目」的人搜到 → 保留 `tauri` `rust` `react` `typescript`
- `android` `kotlin` 你目前只有 UI 骨架，可以留，也可以先去掉以免误导
- 不要加 `vpn`：本项目的 TUN 只在特定条件下可用，Android 的 `VpnService` 还没接真实内核

---

## Website（可选）

没有官网就留空。如果有，填 README 或 Releases 页面即可，例如：

```text
https://github.com/xiaoweizano/CapybaraProxy/releases
```

---

## 顺带建议

- **不要勾选 "Use your README as the description"**：GitHub 会把 README 第一段（`<div align="center">` 那段）原样抓成简介，显示效果很差。
- 语言方面：About 只有一份 Description，不能中英并存。因为现在默认界面是英文，建议填**英文版**；中文版可以放在 README 里，读者点进去就能看到。
