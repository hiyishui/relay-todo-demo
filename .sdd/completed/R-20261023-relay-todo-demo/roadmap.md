# Roadmap: Relay Todo Demo

## Milestones

| Milestone | Goal | Boundary | Depends On | Validation Focus | Status |
| --- | --- | --- | --- | --- | --- |
| M01-core-relay | 内网 API、agent、Worker 网关、DO 中继、Pages 转发、前端 | `intranet-api/` `agent/` `worker/` `pages/` `public/` `wrangler.toml` | None | `npm test`（单元 + 集成） | DONE |
| M02-tooling-deploy | 脚本工具、README、本地与线上部署验证 | `scripts/` `README.md` `package.json` 脚本、`.env.example` | M01 | `npm test`；`npm run dev` + `npm start -- --local` + `npm run check -- --local`；按 README 真实部署 + `npm run check` | PENDING |

## Sequencing

M01 先完成并通过测试；M02 依赖 M01 的模块和接口。

## Risks

- WebSocket 升级能否穿过 Pages Function → Service 绑定 → Worker → DO：M02 真实部署时验证；若失败改为 Pages Function 直接绑定 DO（`script_name`）。
- 公司网络是否放行到 pages.dev 的 WSS：M02 验证；失败则记录为环境限制。
