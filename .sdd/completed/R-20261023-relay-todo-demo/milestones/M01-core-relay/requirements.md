# Requirements: M01 核心链路

## User Need

浏览器发起的待办增删改查，经 Worker 网关和 DO 中继，通过本机 agent 的出站 WSS 连接到达本机 API。

## Acceptance Criteria

- 内网 API 的 5 个接口与业务校验符合 docs/design.md §5，口令变量为 `AGENT_TOKEN`。
- 网关按 §4.3 校验 `ACCESS_TOKEN`、白名单、16 KB，不向上游转发 Authorization/Cookie。
- `/agent/connect` 只接受带正确 `AGENT_TOKEN` 的 WebSocket 升级。
- DO 按 §4.4 转发并配对响应：无 agent 502、超时 504、断开 502、新 agent 替换旧 agent、ping 自动回复。
- agent 按 §4.5 再做白名单、自己加口令、超时/不可达映射、响应体上限，并能心跳与退避重连。
- Pages Function 原样转发，无绑定时 502。
- 集成测试：网关 → DO → agent → 真实内网 API（HTTP）完整 CRUD。
- 前端 502 文案改为提示 `npm start`。

## Boundary

This milestone owns: `intranet-api/` `agent/` `worker/` `pages/` `public/` `wrangler.toml` `tests/`（除脚本测试）。

This milestone does not own: `scripts/`、README、真实部署。

## Dependencies

- None

## Change Impact

If this milestone changes, revalidate: `npm test`；M02 的本地与线上检查。

## Change Log

| Date | Source | Change | Impact |
| --- | --- | --- | --- |
| 2026-10-23 | 用户需求 | 初始 | — |
