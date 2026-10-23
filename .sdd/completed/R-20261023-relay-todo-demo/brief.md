# Brief: Relay Todo Demo（WSS + Durable Object）

## Source Request

“不用 vpc 了，原来建的 vpc-todo-demo 也不合适了。现在改用 wss+do 的方式实现。请新建工程，并先写设计文档，再写实现，最后在 readme 里面写结构清晰易懂的部署和验证步骤，必要情况下在代码里面提供脚本工具。确保按 readme 提供的步骤能顺利部署成功。”

项目名由用户选定：`relay-todo-demo`。

## Goal

在公司网络（DNS 不解析 workers.dev、UDP 7844 被封）下，跑通 浏览器 → pages.dev → Worker → DO ⇄ WSS 443 ⇄ 本机 agent → 本机 API → SQLite 的待办增删改查；按 README 能一次部署成功并验证。

## Non-Goals

- 修改或删除旧工程 `vpc-todo-demo`（完成后再询问用户如何处理）。
- 多用户、高可用、HTTPS 代理支持。

## Constraints

- 全部免费额度；不需要自己的域名；本机不开入站端口。
- Node.js ≥ 22.13，零运行时依赖；devDependency 只有 wrangler。
- 口令可以是简单字符串。

## Current Interpretation

完整设计见 `docs/design.md`。拆为两个里程碑：M01 核心链路（本地可测），M02 脚本工具 + README + 真实部署验证。
