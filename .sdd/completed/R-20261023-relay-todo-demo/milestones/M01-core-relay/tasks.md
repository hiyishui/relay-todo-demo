# Tasks: M01 核心链路

- [x] T01-intranet-api: 移植内网 API
  - Status: DONE
  - Boundary: `intranet-api/`、`tests/intranet-api.test.mjs`
  - Depends On: None
  - RED Test: 移植测试，模块缺失时失败
  - Done Criteria: RED/GREEN 记录；`npm test` 通过

- [x] T02-gateway: Worker 网关
  - Status: DONE
  - Boundary: `worker/gateway.js`、`tests/gateway.test.mjs`
  - Depends On: None
  - RED Test: `tests/gateway.test.mjs`
  - Done Criteria: 同上

- [x] T03-relay: DO 中继与 agent 接入端点
  - Status: DONE
  - Boundary: `worker/relay.js`、`tests/relay.test.mjs`、`tests/fakes.mjs`
  - Depends On: T02（tokenMatches）
  - RED Test: `tests/relay.test.mjs`
  - Done Criteria: 同上

- [x] T04-agent: agent handler + client + main
  - Status: DONE
  - Boundary: `agent/`、`tests/agent-*.test.mjs`
  - Depends On: None
  - RED Test: `tests/agent-handler.test.mjs`、`tests/agent-client.test.mjs`
  - Done Criteria: 同上

- [x] T05-entry-pages-integration: Worker 入口、Pages 转发、集成测试、wrangler.toml
  - Status: DONE
  - Boundary: `worker/index.js`、`pages/`、`wrangler.toml`、`tests/worker-entry.test.mjs`、`tests/pages.test.mjs`、`tests/integration.test.mjs`
  - Depends On: T01–T04
  - RED Test: 三个测试文件
  - Done Criteria: 同上

- [x] T06-frontend: 前端移植
  - Status: DONE
  - Boundary: `public/`
  - Depends On: None
  - RED Test: 无自动化前端测试面；M02 本地联调时验证（MANUAL_VERIFY）
  - Note: 页面行为在 M02/T03 本地联调与 M02/T05 线上验证中确认
  - Done Criteria: 文案与存储 key 已改；M02 中页面可用
