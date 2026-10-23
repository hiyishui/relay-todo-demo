# Notes: M02 脚本工具、README 与部署验证

## Decisions

- 2026-10-23：deploy 支持 .env 中的 CLOUDFLARE_ACCOUNT_ID（多账号场景）。
- 2026-10-23：验证时 8080 被旧工程占用，使用 PORT=18080；README 常见问题已覆盖。

## Manual-Test Findings

- WSS 升级可以穿过 Pages Function → Service 绑定 → Worker → DO（roadmap 风险已消除）。
- 公司网络可出站 WSS 到 pages.dev，连接经 25s 心跳稳定保持。

## Bug Notes

- None

## Implementation Notes

- `wrangler whoami --json` 未登录时退出码非 0；`wrangler pages project list --json` 返回 `[{ "Project Name", "Project Domains", ... }]`。
