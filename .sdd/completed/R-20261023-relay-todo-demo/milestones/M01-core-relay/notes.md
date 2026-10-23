# Notes: M01 核心链路

## Decisions

- 2026-10-23：两把口令 `ACCESS_TOKEN`、`AGENT_TOKEN`；agent 自己给本机 API 加口令，中继消息不含口令。
- 2026-10-23：网关校验放在 Worker（无效请求不消耗 DO 额度）。

## Manual-Test Findings

- None

## Bug Notes

- None

## Implementation Notes

- 旧工程 `vpc-todo-demo` 中的 public/、intranet-api/ 可直接复制后改名。
