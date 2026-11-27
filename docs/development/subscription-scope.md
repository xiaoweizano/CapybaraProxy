# 订阅能力范围说明

本文件定义当前版本订阅功能的边界。未列出的能力一律视为未实现。

## 已实现

- 管理员在 Profiles 页面通过两种方式导入一份订阅：
  - 粘贴 YAML
  - 提供 `http://` 或 `https://` 订阅 URL
- **链接格式转换**：机场对非 Clash 客户端下发的订阅是 base64 包装的分享链接列表，
  直接粘贴分享链接也可以。以下形式会被转换成 Clash YAML（其余文本原样返回）：

  | 协议 | 链接形式 |
  | --- | --- |
  | Shadowsocks | `ss://`（SIP002 与旧式 base64 两种写法，含 `plugin=obfs`/`v2ray-plugin`） |
  | VMess | `vmess://`（base64 JSON） |
  | VLESS | `vless://`（含 TLS、REALITY、ws/grpc/h2 传输） |
  | Trojan | `trojan://` |
  | Hysteria2 | `hysteria2://`、`hy2://` |
  | TUIC | `tuic://` |

  转换结果补一个 `Proxy` 选择组与 `GEOIP,CN,DIRECT` / `MATCH,Proxy` 规则；
  节点名重复时按 `名称 2`、`名称 3` 去重。下载请求的 `User-Agent` 为
  `clash.meta/<版本> (FlowProxy)`，机场据此下发 Clash YAML。
- **系统代理**：下载订阅时若 Windows 已配置系统代理（Clash 等客户端常见），
  请求会走该代理；代理连接失败时自动用一次 15 秒超时的直连重试。旁路列表
  （`ProxyOverride`，含 `<local>` 与 `*` 通配）会被遵守，回环地址始终直连。
- **离线预览**：Runtime 停止时，Proxies 与 Rules 页面仍会列出订阅里的分组、节点与规则。
  这份数据由 `subscription_preview` 从订阅原文做浅层解析得到，只用于展示，
  不参与路由，也不会被当成运行中的真实状态（界面会明确标注「Mihomo 未运行」）。
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
- **自动更新**：`Settings → Subscription` 可设置「启动时更新」与「每 N 小时更新」
  （0/6/12/24 小时）。刷新由桌面健康循环在后台完成，成功时发出
  `subscription-updated` 事件；运行中的核心不会自动重启，界面提示需要重启才能加载新节点。
  仅 URL 导入的订阅可自动更新；粘贴导入没有来源地址，会被跳过。
- **Sub-Store 对接**：`Settings → Sub-Store` 可填写外部 Sub-Store 后端地址与
  `x-api-token`，列出后端中的订阅并一键导入。请求复用订阅下载的传输策略
  （系统代理回退、超时、体积与重定向上限），Token 只保存在本地 `settings.json`，
  不写入日志。
- **流量与到期信息**：下载时解析响应头 `subscription-userinfo`
  （`upload` / `download` / `total` 为字节数，`expire` 为秒级时间戳），
  保存在订阅元数据中，Profiles 页面显示已用流量、总量进度与到期时间。
  `total=0` 按「不限量」显示。粘贴导入与不发送该头的服务商不显示这一块。
  该信息是导入时的快照，只有在刷新订阅时才会更新。
- **自定义 User-Agent**：`Settings → Subscription` 可填写下载订阅时发送的
  User-Agent；留空使用内置的 `clash.meta/<版本> (FlowProxy)`。含控制字符或
  超过 512 字符的值会被原生层清除并回退到默认值。

## 安全约束

- 订阅 URL 只允许 `http://` 与 `https://`；`file://`、`ftp://` 等一律拒绝。
- URL 长度上限 2048 字符，禁止控制字符。
- 下载超时 30 秒，重定向上限 5 跳，`https` 不允许降级重定向到 `http`。
- 下载体积上限 8 MiB，流式计数，超限立即中止。
- 响应必须为 UTF-8 文本；转换后必须包含 `proxies:` 或 `proxy-providers:`，否则报错说明支持的格式。
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
- **单节点或节点列表导入**：只接受完整配置文档。
- **导入时保留多份历史版本**：没有配置版本管理与回滚到上一版订阅的 UI。
- **`proxy-providers` 的远程节点列表**：`proxy-providers` 段会原样保留，但其中的 `url` 由 Mihomo 在运行时自行拉取，FlowProxy 不代理、不校验、不缓存。
- **订阅内的 TUN 配置会被执行**：`tun:` 段在订阅里保留。当前阶段 TUN 能力本身未验证，实际是否生效取决于 Mihomo 与平台权限。

## 运维注意

- 导入订阅后如果 Runtime 已在运行，需要停止再启动才会用上新配置；界面会给出提示。
- 订阅原文保存在 `<配置目录>\mihomo\config.subscription.yaml`，元数据在同目录 `config.subscription.json`。两者都是明文，**不加密**。
- 若订阅需要 `proxy-providers` 远程拉取，Mihomo 走的是它自己的网络栈，不受 FlowProxy 的 URL 校验约束。
