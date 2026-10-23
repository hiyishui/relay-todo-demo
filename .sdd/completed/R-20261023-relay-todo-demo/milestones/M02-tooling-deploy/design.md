# Design: M02 脚本工具、README 与部署验证

## Approach

以 `docs/design.md` §10 为准。脚本全部用 Node.js 内置模块；纯函数放在 `scripts/lib.mjs` 以便单元测试，带副作用的流程放在各脚本中。

## Boundaries and Contracts

- `scripts/lib.mjs`：`parseEnv(text)`、`updateEnv(text, updates)`（保留注释与顺序）、`readEnvFile/writeEnvFile`（600）、`pagesDomain(projects, name)`（从 `wrangler pages project list --json` 取 `*.pages.dev`）、`relayUrlFor(siteUrl)`、`runWrangler(args, opts)`。
- deploy 用 `wrangler whoami --json` 判断登录（未登录退出码非 0）；secret 通过 stdin JSON 传给 `wrangler secret bulk`。
- Pages 部署在 `pages/` 目录执行 `wrangler pages deploy --branch main --commit-dirty=true`。

## Data and Control Flow

setup → (.env) → deploy → (.env 增加 SITE_URL/RELAY_URL) → start（读取 .env）→ check（读取 .env）。

## File Structure Plan

| File | Responsibility | Change |
| --- | --- | --- |
| `scripts/lib.mjs` | 公共函数 | create |
| `scripts/setup.mjs` | 生成 .env | create |
| `scripts/start.mjs` | 启动 API + agent | create |
| `scripts/deploy.mjs` | 一键部署 | create |
| `scripts/check.mjs` | 链路验证 | create |
| `tests/scripts.test.mjs` | lib 单元测试 | create |
| `README.md` | 使用文档 | create |
| `package.json` `.env.example` `.gitignore` | 配置 | create |

## Risks

- `wrangler` 输出格式变化：只依赖 `--json` 输出和退出码。
- Pages 域名被占用：用 `pages project list --json` 查询实际域名。

## Change Log

| Date | Source | Change | Impact |
| --- | --- | --- | --- |
