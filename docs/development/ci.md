# 持续集成

`.github/workflows/verify.yml` 在每次推送 `main` 和每个 PR 上运行，覆盖 README「检查与构建」中的静态检查：

| Job | 内容 |
| --- | --- |
| `frontend` | `pnpm lint`、`typecheck`、`test`、`build`，以及 `node scripts/verify-locale-keys.mjs`（中英语言包键一致性） |
| `rust` | `cargo fmt --check`、`cargo clippy -D warnings`、`cargo test --workspace`（Windows runner，与发布平台一致） |
| `audit` | `pnpm audit` 与 `cargo audit`，只报告不阻断（依赖公告不应卡住无关改动） |

`scripts/verify-i18n.mjs` 及其它 `verify-*.mjs` 仍保留为本地验收脚本：它们启动已安装的程序并通过 CDP 驱动界面，不属于 CI 的范围。

## 本地等价命令

```powershell
pnpm lint; pnpm typecheck; pnpm test; pnpm build
node scripts/verify-locale-keys.mjs
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```
