# 界面多语言范围说明

本文件定义当前版本 i18n 的边界。

## 已实现

### 桌面端（Tauri + React）

- 基于 `i18next` + `react-i18next`，资源在 `apps/desktop/src/i18n/locales/`。
- 支持 English、简体中文两种语言。
- 切换入口：**Settings → Appearance → Language**。
- 持久化：写入 `%APPDATA%\com.flowproxy.desktop\settings.json` 的 `language` 字段，
  同时缓存到 `localStorage`（`flowproxy.language`）用于首帧渲染。
- `settings.json` 若没有 `language` 字段（旧版本写入），按系统语言初始化，
  不会把中文系统上的升级用户强制切回英文。
- 切换时同步更新 `<html lang>`，`Intl` 日期/时间格式跟随语言。
- 字典完整性由测试保证：键集合必须一致、不允许空串、插值占位符必须一致。

### Android（Compose）

- 采用与前缀无关的字典实现（`app/src/main/kotlin/com/flowproxy/android/i18n/`），
  不依赖 `values-xx` 资源或 AppCompat，因此 API 26–35 行为一致。
- 支持 English、简体中文两种语言。
- 切换入口：**Settings → Language**。
- 持久化：DataStore 的 `language_id`。
- 字典一致性由 JVM 测试校验（键集合一致、无未翻译项、语言 ID 往返）。

## 未翻译的内容（有意保留原文）

- **后端错误消息**：Rust 与 Android 原生层返回的 `RuntimeError.message`、
  `MihomoCapabilityReport.detail` 等技术诊断信息保持英文。这些文本含动态上下文，
  逐条翻译容易产生误导；界面上以「错误码 + 原文」的形式展示，便于检索。
- **Mihomo 自身的日志与规则类型**：来自核心，不做改写。
- **品牌与专有名词**：`FlowProxy`、`Cyber Flow`、`Warm Flow`、`Mihomo`、`TUN`、`ABI`。
- **订阅内容**（节点名、代理组名、规则 payload）：属于用户数据。

## 明确未实现

- 除中英以外的语言。
- 数字、货币、复数的高级本地化（`Intl` 仅用于日期时间与字节单位数字）。
- Android 通知文案跟随**系统语言**（`values-zh-rCN` 资源），不受应用内语言开关影响。
  应用内切换只覆盖 Compose 界面；通知由系统在前台服务里渲染，需要独立改动才能联动。
- 跟随系统语言自动切换（除首次初始化外）：一旦用户手动选择，就以持久化值为准。

## 已覆盖但曾经遗漏

- **桌面托盘菜单**：由 Rust 侧构建，见 `apps/desktop/src-tauri/src/tray_strings.rs`；
  `save_settings` 写入后重建菜单，所以切换语言立即生效。

## 维护

新增界面文案时：

1. 先加到 `en.ts` / `EnglishStrings.kt`；
2. 再补 `zh-CN.ts` / `ChineseStrings.kt`（桌面端编译期会报缺失键，Android 也是）；
3. 跑 `pnpm test`（桌面）与 `:app:testDebugUnitTest`（Android），
   字典一致性与占位符检查会拦住遗漏。