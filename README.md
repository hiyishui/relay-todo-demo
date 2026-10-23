# Relay Todo Demo

一个最小的待办事项（增删改查）demo：**页面放在 Cloudflare Pages，数据留在你自己的电脑上**。电脑不需要公网 IP，也不开放任何入站端口，只要能**出站访问 443 端口**就能用，公司网络也可以。

```text
浏览器 ──https──► relay-todo-demo.pages.dev（Cloudflare Pages）
                    ├─ 页面（public/）
                    └─ /api/* ──► 网关 Worker ──► Durable Object（中继）
                                                      ▲
                                                      │ WSS 443，由本机 agent 主动连出去
                                                      │
你的电脑 ─────────── agent ──► 本机 API（127.0.0.1:8080）──► SQLite（data/todos.db）
```

- 全部使用 Cloudflare 免费额度，不需要自己的域名，不需要 `cloudflared`。
- 设计说明见 [docs/design.md](docs/design.md)。

**目录**

1. [准备工作](#一准备工作只做一次)
2. [本地体验（可选）](#二本地体验可选不需要-cloudflare)
3. [部署到 Cloudflare](#三部署到-cloudflare)
4. [启动本机服务并验证](#四启动本机服务并验证)
5. [日常使用](#五日常使用)
6. [常见问题](#六常见问题)
7. [清理](#七清理)
8. [参考](#八参考)

---

## 一、准备工作（只做一次）

### 1. 环境要求

| 项目 | 要求 | 检查命令 |
|---|---|---|
| Node.js | ≥ 22.13 | `node --version` |
| Cloudflare 账号 | 免费账号即可 | — |
| 网络 | 能打开 `https://pages.dev`，能出站访问 443 端口 | 浏览器打开任意 `*.pages.dev` 网站 |

### 2. 安装依赖

```bash
cd relay-todo-demo
npm install
```

只会安装开发工具 `wrangler`，运行时没有第三方依赖。

### 3. 设置口令

```bash
npm run setup
```

它会依次询问两把口令，**直接回车就自动生成**，结果写入 `.env`（权限 600，不会被提交）：

| 口令 | 用途 | 需要记住吗 |
|---|---|---|
| `ACCESS_TOKEN` | 打开网页时输入的访问口令 | 需要（命令结束时会显示） |
| `AGENT_TOKEN` | 本机 agent 连接 Cloudflare 用 | 不需要 |

口令可以是任意不含空格的字符串，例如 `abc`。忘记访问口令时，查看 `.env` 中的 `ACCESS_TOKEN`，或再次运行 `npm run setup`（已有的值会保留并显示出来）。

---

## 二、本地体验（可选，不需要 Cloudflare）

想先看看效果，可以在本机跑完整条链路。Worker 和 Durable Object 由 `wrangler dev` 在本机模拟，**不需要登录 Cloudflare**。不需要的话直接跳到[第三部分](#三部署到-cloudflare)。

打开三个终端，都进入 `relay-todo-demo` 目录：

| 终端 | 命令 | 看到这些说明正常 |
|---|---|---|
| 1 | `npm run dev` | `Ready on http://127.0.0.1:8787` |
| 2 | `npm start -- --local` | `[api] 内网 API 已启动` 和 `[agent] 已连接中继` |
| 3 | `npm run check -- --local` | 7 项全部 `✔`，最后一行“全部通过” |

然后浏览器打开 <http://127.0.0.1:8787>，输入访问口令，就可以增删改查了。

体验完在终端 2、终端 1 分别按 `Ctrl+C` 停止。

---

## 三、部署到 Cloudflare

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开授权页面，点 **Allow**。

> 如果最后停在一个打不开的页面（`welcome.developers.workers.dev ... This site can't be reached`），不用管，**登录其实已经成功**，那只是一张提示页，某些网络解析不了 `workers.dev`。

确认已登录：

```bash
npx wrangler whoami
```

能看到账号名和 Account ID 即可。

### 2. 一键部署

```bash
npm run deploy
```

脚本会依次完成 5 步，每步成功都会打勾：

| 步骤 | 做什么 |
|---|---|
| 1 | 检查是否已登录 |
| 2 | 部署网关 Worker `relay-todo-demo-gateway`（含 Durable Object）。输出 `No targets deployed` 是正常的：这个 Worker 故意不开放公网地址，只供 Pages 调用 |
| 3 | 把 `.env` 中的两把口令上传为 Worker secret |
| 4 | 第一次部署时创建 Pages 项目 `relay-todo-demo` |
| 5 | 部署 Pages（页面 + 转发函数），并把实际访问地址写入 `.env` 的 `SITE_URL`、`RELAY_URL` |

成功时最后会显示：

```text
✔ 部署完成
  访问地址：https://relay-todo-demo.pages.dev
  中继地址：wss://relay-todo-demo.pages.dev/agent/connect（已写入 .env 的 RELAY_URL）
  访问口令：……
```

> 如果 `relay-todo-demo.pages.dev` 已经被别人占用，Cloudflare 会分配一个带后缀的地址（例如 `relay-todo-demo-abc.pages.dev`）。以脚本输出和 `.env` 中的 `SITE_URL` 为准，后续命令会自动使用它。

`npm run deploy` 可以重复执行：改了代码、换了口令，再运行一次即可。

---

## 四、启动本机服务并验证

### 1. 启动本机 API 和 agent（终端 1，保持运行）

```bash
npm start
```

看到这三行说明正常：

```text
中继地址：wss://relay-todo-demo.pages.dev/agent/connect
[api] 内网 API 已启动：http://127.0.0.1:8080（数据库 ./data/todos.db）
[agent] …… 已连接中继，请求将转发到 http://127.0.0.1:8080
```

### 2. 验证整条链路（终端 2）

```bash
npm run check
```

它会依次检查：首页能打开 → 不带口令被拒绝 → agent 入口可达 → 带口令读列表 → 新建、修改、删除一条检查记录。全部通过时显示：

```text
✔ [1/7] 打开首页
✔ [2/7] 不带口令访问 API 应被拒绝（401）
✔ [3/7] agent 入口可达（非 WebSocket 请求应返回 426）
✔ [4/7] 带口令读取待办列表
✔ [5/7] 新建一条检查记录
✔ [6/7] 修改这条记录为已完成
✔ [7/7] 删除这条记录

全部通过：浏览器打开 https://relay-todo-demo.pages.dev，输入访问口令即可使用。
```

某一步失败时，脚本会停下来说明原因和处理办法。刚创建的 `pages.dev` 地址有时需要 1–2 分钟才能访问，第 1 步失败时稍等再试。

### 3. 在浏览器中使用

打开 `.env` 中 `SITE_URL` 的地址，输入访问口令，就可以增删改查了。这时终端 1 会同步打印每个请求，例如：

```text
[agent] 2026-10-23T02:08:32.556Z POST /api/todos 201 3ms
[api] 2026-10-23T02:08:32.556Z POST /api/todos 201 1ms
```

---

## 五、日常使用

**每次演示：** 只需在项目目录运行 `npm start`，保持终端打开。停止时按 `Ctrl+C`；停止后网页仍能打开，但操作会提示“内网服务不可达，请确认本机已运行 npm start”，重新 `npm start` 后自动恢复。

演示期间不要让电脑休眠，可以另开一个终端运行 `caffeinate -dims`（结束时按 `Ctrl+C`）。

**更换口令：**

```bash
npm run setup -- --reset   # 重新设置两把口令
npm run deploy             # 上传新口令
```

然后在终端 1 按 `Ctrl+C`，重新运行 `npm start`。浏览器中保存的旧口令会失效，页面会要求重新输入。

**修改代码后：** 重新运行 `npm run deploy`；改了 `agent/` 或 `intranet-api/` 只需重启 `npm start`。

**清空数据：** 停止 `npm start` 后删除 `data/` 目录。

**查看云端日志：** `npx wrangler tail relay-todo-demo-gateway`。

---

## 六、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `npm run deploy` 提示“尚未登录 Cloudflare” | 没有登录或登录已过期 | `npx wrangler login` |
| `npm run deploy` 报 `More than one account available` | 登录的用户能访问多个账号 | `npx wrangler whoami` 查到 Account ID，在 `.env` 中加一行 `CLOUDFLARE_ACCOUNT_ID=<ID>` 后重试 |
| `npm start` 提示“.env 中没有 RELAY_URL” | 还没部署 | 先运行 `npm run deploy`；只在本地体验时用 `npm start -- --local` |
| `[api]` 报 `EADDRINUSE` | 8080 端口被占用 | `lsof -nP -iTCP:8080 -sTCP:LISTEN` 找出占用者并停止；或者换端口：`PORT=8081 npm start`（API 和 agent 会一起改，不需要重新部署） |
| `[agent]` 反复提示“连接中继失败” | 网络不通；或 `.env` 中的 `AGENT_TOKEN` 与已部署的不一致 | 先确认浏览器能打开 `SITE_URL`；再运行一次 `npm run deploy` 同步口令 |
| `[agent]` 提示“已有新的 agent 连接到中继，本 agent 停止” | 同一时间只允许一个 agent，另一个终端或另一台电脑也运行了 `npm start` | 只保留一个 `npm start` |
| `npm run check` 第 1 步失败 | 新建的 `pages.dev` 地址还没生效；或当前网络打不开 `pages.dev` | 等 1–2 分钟重试；换网络确认 |
| `npm run check` 第 4 步提示“agent 没有连上中继” | `npm start` 没在运行，或 agent 还在重连 | 查看终端 1 的 `[agent]` 日志，确认出现“已连接中继” |
| `npm run check` 第 4 步提示 `ACCESS_TOKEN 与已部署的不一致` | 改过 `.env` 但没有重新部署 | `npm run deploy` |
| 网页反复要求输入口令 | 输入的口令不对 | 查看 `.env` 中的 `ACCESS_TOKEN` |
| 网页提示“内网服务不可达” | 本机 `npm start` 没在运行，或电脑休眠了 | 重新运行 `npm start` |
| 网页提示“今日免费额度已用完” | 当天请求超过免费额度 | 北京时间 08:00 自动恢复 |
| 浏览器打不开 `*.workers.dev` | 某些网络不解析 `workers.dev` | 正常，本项目不使用 `workers.dev`，入口是 `pages.dev` |

---

## 七、清理

不再使用时，删除云端资源：

```bash
npx wrangler pages project delete relay-todo-demo
npx wrangler delete relay-todo-demo-gateway
```

然后删除本机数据和口令：

```bash
rm -rf data .env
```

---

## 八、参考

### 命令速查

| 命令 | 作用 |
|---|---|
| `npm run setup` | 生成或补全 `.env` 中的两把口令（`-- --reset` 重新设置） |
| `npm run dev` | 本地运行 Worker、Durable Object 和页面（<http://127.0.0.1:8787>） |
| `npm start` | 同时运行本机 API 和 agent（`-- --local` 连本地 `npm run dev`） |
| `npm run deploy` | 部署 Worker、上传口令、部署 Pages，并写入 `SITE_URL`、`RELAY_URL` |
| `npm run check` | 逐步验证整条链路（`-- --local` 检查本地；`-- --read-only` 不写入数据） |
| `npm test` | 运行全部自动化测试（不访问 Cloudflare） |
| `npm run api` / `npm run agent` | 单独运行本机 API 或 agent（排查问题用） |

### 目录结构

| 路径 | 说明 |
|---|---|
| `public/` | 页面：`index.html`、`app.js`、`styles.css` 等，以及安全响应头 `_headers` |
| `pages/` | Pages 项目：`wrangler.toml`（Service 绑定 `GATEWAY`）和 `functions/`（把 `/api/*`、`/agent/connect` 转给网关 Worker） |
| `worker/` | 网关 Worker：`gateway.js`（口令、白名单、16 KB 上限）、`relay.js`（Durable Object 中继）、`index.js`（路由） |
| `agent/` | 本机 agent：`client.mjs`（连接、心跳、重连）、`handler.mjs`（把请求转给本机 API） |
| `intranet-api/` | 本机 API：Node.js + SQLite，只监听 `127.0.0.1` |
| `scripts/` | `setup`、`start`、`deploy`、`check` 脚本 |
| `tests/` | `node --test` 测试 |
| `wrangler.toml` | 网关 Worker 配置 |
| `.env.example` | `.env` 的模板 |

### 接口

所有接口都需要请求头 `Authorization: Bearer <ACCESS_TOKEN>`。

| 方法与路径 | 请求体 | 成功响应 |
|---|---|---|
| `GET /api/todos` | — | 200 `{"items":[...]}`，按创建时间倒序，最多 200 条 |
| `GET /api/todos/:id` | — | 200 待办对象 |
| `POST /api/todos` | `{"title":"..."}` | 201 待办对象 |
| `PATCH /api/todos/:id` | `{"title"?:"...","completed"?:true}` | 200 待办对象 |
| `DELETE /api/todos/:id` | — | 204 |

错误统一返回 `{"error":"代码","message":"说明"}`，状态码含义见 [docs/design.md](docs/design.md) §5.4。标题 1–200 个字符，最多 1,000 条。

### 安全要点

- 本机没有任何入站端口：API 只监听 `127.0.0.1`，agent 只向外连接。
- 网关 Worker 没有公网地址，只能经 Pages 调用；口令错误、路径不对的请求在网关就被拒绝。
- agent 只转发 5 个待办接口，而且自己给本机 API 加口令，中继消息里没有任何口令。
- 免费额度：页面请求免费；每次 API 调用约消耗 1 次 Workers 请求和 1 次 Durable Object 请求（各每天 10 万次）；agent 空闲时不消耗 Durable Object 时长。
