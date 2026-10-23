# Tasks: M02 脚本工具、README 与部署验证

- [x] T01-lib: scripts/lib.mjs 纯函数
  - Status: DONE
  - Boundary: `scripts/lib.mjs`、`tests/scripts.test.mjs`
  - Depends On: None
  - RED Test: `tests/scripts.test.mjs`
  - Done Criteria: RED/GREEN 记录；`npm test` 通过

- [x] T02-scripts: setup / start / deploy / check
  - Status: DONE
  - Boundary: `scripts/*.mjs`、`package.json`
  - Depends On: T01、M01
  - RED Test: 无单元测试面（进程编排与外部 CLI）；由 T03/T05 的端到端执行验证
  - Done Criteria: 本地与线上检查通过

- [x] T03-local-e2e: 本地模式端到端验证
  - Status: DONE
  - Boundary: 运行验证，不改代码（发现缺陷回到对应任务）
  - Depends On: T02
  - RED Test: `npm run check -- --local` 在未启动 agent 时失败（502），启动后通过
  - Done Criteria: 证据记录

- [x] T04-readme: README
  - Status: DONE
  - Boundary: `README.md`
  - Depends On: T02
  - RED Test: 不适用（文档）
  - Done Criteria: 覆盖 requirements 中的全部章节

- [x] T05-deploy-e2e: 按 README 真实部署与验证
  - Status: DONE
  - Boundary: Cloudflare 资源 `relay-todo-demo-gateway`、`relay-todo-demo`
  - Depends On: T04
  - RED Test: `npm run check` 在部署前失败，部署并启动后通过
  - Done Criteria: 证据记录；validation GO
