# Requirements: M02 脚本工具、README 与部署验证

## User Need

按 README 的步骤，能在本机一次性部署成功并验证整条链路；必要操作由脚本完成。

## Acceptance Criteria

- `npm run setup` 生成/补全 `.env`（交互，回车随机生成；非交互时自动生成；保留已有值；权限 600）。
- `npm start` 同时运行内网 API 与 agent，`--local` 连本地 `wrangler dev`；任一退出则全部退出；Ctrl+C 干净退出。
- `npm run deploy`：未登录时给出明确提示；部署 Worker；只上传两把口令为 secret；不存在则创建 Pages 项目；部署 Pages；把实际 `SITE_URL`、`RELAY_URL` 写入 `.env`。
- `npm run check`：首页 200 → 无口令 401 → 读列表 → 新建/修改/删除检查记录；失败时给出原因与建议；`--local` 支持。
- README 结构清晰：是什么 → 准备 → 本地体验（可选）→ 部署 → 验证 → 日常使用 → 常见问题 → 清理。
- 在本机按 README 实际执行：本地模式检查通过；线上部署成功且 `npm run check` 通过。

## Boundary

This milestone owns: `scripts/`、`README.md`、`package.json` scripts、`.env.example`、`.gitignore`、`tests/scripts.test.mjs`。

This milestone does not own: M01 的运行时代码（若部署验证暴露 M01 缺陷，回到 M01 修复并记录）。

## Dependencies

- M01-core-relay

## Change Impact

If this milestone changes, revalidate: README 步骤重新走一遍。

## Change Log

| Date | Source | Change | Impact |
| --- | --- | --- | --- |
| 2026-10-23 | 用户需求 | 初始 | — |
