# Test Plan: M01 核心链路

## RED Tests

- `tests/intranet-api.test.mjs`：5 个接口、校验、口令（移植，使用 AGENT_TOKEN 语义）。
- `tests/gateway.test.mjs`：白名单、口令、415/413、头过滤（不转发 Authorization）、502/504 映射、日志不含口令。
- `tests/relay.test.mjs`：自动心跳、转发与配对、最新连接、无 agent 502、超时 504、断开 502、无效状态 502、替换旧 agent；`connectAgent` 426/401/转交 DO。
- `tests/agent-handler.test.mjs`：转发与加口令、头过滤、白名单 403、502/504、响应体上限、忽略畸形帧。
- `tests/agent-client.test.mjs`：连接带口令、收到请求帧回复响应帧、心跳超时重连、退避与重置、stop 后不再重连。
- `tests/worker-entry.test.mjs`：入口导出、路由到 agent 端点和网关。
- `tests/pages.test.mjs`：原样转发、无绑定 502。
- `tests/integration.test.mjs`：网关 → DO → agent → 真实 HTTP 内网 API 完整 CRUD。

## Regression Tests

- 同上全部纳入 `npm test`。

## Acceptance Checks

- `npm test` 全部通过。

## Manual Checks

- 前端在 M02 本地联调时人工/脚本检查。

## Validation Commands

```bash
npm test
```

## Evidence Log

| Date | Task | Phase | Command | Result |
| --- | --- | --- | --- | --- |
| 2026-10-23 | T01 | RED | `npm test` | ERR_MODULE_NOT_FOUND intranet-api/app.mjs |
| 2026-10-23 | T01 | GREEN | `npm test` | 10/10 pass |
| 2026-10-23 | T02 | RED | `node --test tests/gateway.test.mjs` | ERR_MODULE_NOT_FOUND worker/gateway.js |
| 2026-10-23 | T02 | GREEN | 同上 | 8/8 pass |
| 2026-10-23 | T03 | RED | `node --test tests/relay.test.mjs` | ERR_MODULE_NOT_FOUND worker/relay.js |
| 2026-10-23 | T03 | GREEN | 同上 | 13/13 pass |
| 2026-10-23 | T04 | RED | `node --test tests/agent-*.test.mjs` | ERR_MODULE_NOT_FOUND agent/client.mjs |
| 2026-10-23 | T04 | GREEN | 同上 | 12/12 pass；main.mjs 参数校验手动验证 4 种错误提示 |
| 2026-10-23 | T05 | RED | `node --test tests/worker-entry.test.mjs tests/pages.test.mjs tests/integration.test.mjs` | ERR_MODULE_NOT_FOUND worker/index.js |
| 2026-10-23 | T05 | GREEN | `npm test` | 53/53 pass |
| 2026-10-23 | T06 | — | grep 检查 | 前端无 vpc/cloudflared 残留；行为留待 M02 验证 |
