# 订阅能力范围说明

本文件定义当前版本订阅功能的边界。未列出的能力一律视为未实现。

## 已实现

- 管理员在 Profiles 页面通过两种方式导入一份订阅：
  - 粘贴 YAML
  - 提供 `http://` 或 `https://` 订阅 URL
- 导入前执行 `mihomo -t -d <工作目录> -f <候选文件>` 校验；校验不通过不写入。
- 写入采用原子替换：先写临时文件，校验通过后重命名，失败自动回滚。
- 控制面隔离：订阅中以下顶层键会被移除并替换为 FlowProxy 控制值。

  | 被移除的键 | FlowProxy 写入的值 |
  | --- | --- |
  | `mixed-port`、`port`、`socks-port`、`redir-port`、`tproxy-port` | `mixed-port: <Runtime 预留端口>` |
  | `external-controller`、`external-controller-tls`、`external-controller-unix`、`external-controller-pipe` | 命令行 `-ext-ctl 127.0.0.1:<预留端口>` |
  | `secret` | 命令行 `-secret <每次启动随机生成>` |
  | `allow-lan` | `false` |
  | `bind-address`、`lan-allowed-ips`、`lan-disallowed-ips` | `bind-address: 127.0.0.1` |
  | `authentication` | 移除（含其缩进块） |
  | `external-ui` | 移除 |

- 订阅原文其余部分逐字节保留，包括注释、锚点、多行字符串与规则顺序。
- 移除订阅后回到内置的 `FlowProxy Direct` 直连配置。

## 安全约束

- 订阅 URL 只允许 `http://` 与 `https://`；`file://`、`ftp://` 等一律拒绝。
- URL 长度上限 2048 字符，禁止控制字符。
- 下载超时 30 秒，重定向上限 5 跳，`https` 不允许降级重定向到 `http`。
- 下载体积上限 8 MiB，流式计数，超限立即中止。
- 响应必须为 UTF-8 文本，且包含 `proxies:` 或 `proxy-providers:`。
- **订阅 URL 通常内嵌令牌，因此不会出现在任何日志或错误消息中**；错误信息只报告分类（超时、连接失败、HTTP 状态码、体积超限）。
- 即使订阅里写了 `allow-lan: true` 与 `0.0.0.0` 绑定，实际端口仍只监听 `127.0.0.1`（已实测确认）。

## geodata

订阅里普遍含有 `GEOIP` / `GEOSITE` 规则。Mihomo 在找不到 geodata 时会尝试联网下载，超时 90 秒后判定配置失败。

因此安装包捆绑了：

| 文件 | 来源 | SHA-256 |
| --- | --- | --- |
| `geosite.dat` | meta-rules-dat `latest` | `2bdf171e1862b47cc5cd322ee43e5d066d9963025919ebb58dc7891d2b92643e` |
| `geoip.metadb` | meta-rules-dat `latest` | `4236cf8477d12ceb4837eff39a03a65d5d55a72d3cccdc92e2e36d9cdbd686e3` |

启动与导入时会把它们复制到 Mihomo 工作目录（`<配置目录>\mihomo\`）。这两份是快照，**会随规则更新而过时**，当前没有自动更新机制。

meta-rules-dat 使用 GPL-3.0，与本项目许可证一致。

## 明确未实现

- **多订阅管理**：只支持一份活动订阅，导入新订阅会覆盖旧的。
- **订阅自动更新**：没有定时拉取，也没有"检查更新"按钮。
- **订阅流量与到期信息**：不解析响应头里的 `subscription-userinfo`，不显示已用流量或到期时间。
- **单节点或节点列表导入**：只接受完整配置文档。
- **导入时保留多份历史版本**：没有配置版本管理与回滚到上一版订阅的 UI。
- **`proxy-providers` 的远程节点列表**：`proxy-providers` 段会原样保留，但其中的 `url` 由 Mihomo 在运行时自行拉取，FlowProxy 不代理、不校验、不缓存。
- **订阅内的 TUN 配置会被执行**：`tun:` 段在订阅里保留。当前阶段 TUN 能力本身未验证，实际是否生效取决于 Mihomo 与平台权限。

## 运维注意

- 导入订阅后如果 Runtime 已在运行，需要停止再启动才会用上新配置；界面会给出提示。
- 订阅原文保存在 `<配置目录>\mihomo\config.subscription.yaml`，元数据在同目录 `config.subscription.json`。两者都是明文，**不加密**。
- 若订阅需要 `proxy-providers` 远程拉取，Mihomo 走的是它自己的网络栈，不受 FlowProxy 的 URL 校验约束。
