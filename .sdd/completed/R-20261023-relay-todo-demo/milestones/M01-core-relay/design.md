# Design: M01 核心链路

## Approach

以 `docs/design.md` §3–§7 为准（canonical）。内网 API 与前端从 `vpc-todo-demo` 移植并改名；网关从旧版移植后去掉服务口令注入，上游改为 DO；新增 DO 中继、agent（handler/client/main）、Pages 转发。

## Boundaries and Contracts

- 中继帧协议：docs/design.md §4.6。
- 超时：agent 8s < DO 9s < Worker 10s。
- Worker 入口只导出 `default` 与 `AgentRelay`。

## Data and Control Flow

docs/design.md §3.2 时序图。

## File Structure Plan

| File | Responsibility | Change |
| --- | --- | --- |
| `intranet-api/app.mjs` `server.mjs` | 业务 API | create（移植） |
| `worker/gateway.js` | 网关 | create（移植+修改） |
| `worker/relay.js` | DO 与 agent 接入 | create |
| `worker/index.js` | 路由 | create |
| `agent/handler.mjs` `client.mjs` `main.mjs` | agent | create |
| `pages/wrangler.toml` `pages/functions/**` | Pages 转发 | create |
| `public/*` | 前端 | create（移植+改文案） |
| `wrangler.toml` | Worker 配置 | create |
| `tests/*.test.mjs` `tests/fakes.mjs` | 测试 | create |

## Risks

- workerd 专有全局（`WebSocketPair`、`WebSocketRequestResponsePair`）在 Node 测试中不存在：用 fakes 注入，真实行为在 M02 用 `wrangler dev` 验证。

## Change Log

| Date | Source | Change | Impact |
| --- | --- | --- | --- |
