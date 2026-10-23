# Test Plan: M02 脚本工具、README 与部署验证

## RED Tests

- `tests/scripts.test.mjs`：`parseEnv`（注释、空行、引号、`=` 在值中）、`updateEnv`（替换、追加、保留注释）、`pagesDomain`（多域名、找不到项目）、`relayUrlFor`。

## Regression Tests

- 全部纳入 `npm test`。

## Acceptance Checks

- 本地：`npm run setup` → `npm run dev` → `npm start -- --local` → `npm run check -- --local` 全部通过。
- 线上：`npm run deploy` → `npm start` → `npm run check` 全部通过。
- 负向：停止 `npm start` 后 `npm run check` 报告 agent 未连接（502）并给出建议。

## Manual Checks

- 浏览器打开 SITE_URL 进行增删改查（可用 check 脚本的 CRUD 往返替代）。

## Validation Commands

```bash
npm test
npm run check -- --local
npm run check
```

## Evidence Log

| Date | Task | Phase | Command | Result |
| --- | --- | --- | --- | --- |
| 2026-10-23 | T01 | RED | `node --test tests/scripts.test.mjs` | ERR_MODULE_NOT_FOUND scripts/lib.mjs |
| 2026-10-23 | T01 | GREEN | 同上 | 4/4 pass |
| 2026-10-23 | T02 | — | `npm run setup`（非交互 + pty 交互） | .env 生成，权限 600；回车随机、输入保留 |
| 2026-10-23 | T03 | RED | `npm run check -- --local`（未启动 agent） | 第 4 步失败，提示 agent 未连接 |
| 2026-10-23 | T03 | GREEN | `npm run dev` + `PORT=18080 npm start -- --local` + `npm run check -- --local` | 7/7 通过 |
| 2026-10-23 | T03 | 行为 | 错误 AGENT_TOKEN agent；第二个 agent；SIGINT；心跳 >60s | 被拒绝并退避；旧 agent 收到 4000 退出；两个子进程干净退出；无心跳超时 |
| 2026-10-23 | T03 | 浏览器 | http://127.0.0.1:8787 | 登录、新建、完成、XSS 文本、停止后 502 提示均正常 |
| 2026-10-23 | T05 | RED | `npm run check` / `npm start`（部署前） | 提示先运行 npm run deploy |
| 2026-10-23 | T05 | GREEN | `npm run deploy` | 5 步全部成功，SITE_URL=https://relay-todo-demo.pages.dev |
| 2026-10-23 | T05 | GREEN | `PORT=18080 npm start` + `npm run check`（公司网络） | agent 经 WSS 连上；7/7 通过 |
| 2026-10-23 | T05 | 行为 | 浏览器线上编辑；空闲 2 分钟后只读检查；401/404/405/413 抽查；lsof | 正常；连接保持；被拒请求未到 agent；只监听 127.0.0.1 |
| 2026-10-23 | T05 | 负向 | 停止 npm start 后 `npm run check -- --read-only` | 第 4 步失败并提示启动 npm start |
| 2026-10-23 | 全部 | 回归 | `npm test` | 57/57 pass |
| 2026-10-23 | 复验 | 从零 | README 七 清理命令（pty 确认 y） | Pages、Worker 删除成功 |
| 2026-10-23 | 复验 | 从零 | 干净副本（无 .env/node_modules）按 README 一→二→三→四→五 | npm install、setup（回车×2）、本地 7/7、deploy 首次 5/5、npm start（默认 8080）、check 7/7、浏览器增删改查 |
| 2026-10-23 | 复验 | 日常 | 停止 npm start → 页面提示；setup --reset（输入一个简单口令）→ deploy（项目已存在路径）→ npm start → check 7/7；浏览器旧口令 401 后用新口令登录 | 全部符合 README |
| 2026-10-23 | 复验 | 未登录 | XDG_CONFIG_HOME=空目录 下 npm run dev + agent + check --local | 7/7，确认本地体验无需登录 |
| 2026-10-23 | 复验 | 同步 | 新 .env 同步回工程目录；工程目录 npm start + check + npm test | 7/7；57/57 |
