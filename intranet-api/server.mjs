import { createServer } from 'node:http';
import { createHandler, openDatabase } from './app.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function fail(message) {
  console.error(`启动失败：${message}`);
  process.exit(1);
}

const host = process.env.HOST?.trim() || '127.0.0.1';
const port = Number(process.env.PORT?.trim() || 8080);
const dbPath = process.env.DB_PATH?.trim() || './data/todos.db';
const token = process.env.AGENT_TOKEN?.trim() ?? '';

if (!LOOPBACK_HOSTS.has(host)) fail(`HOST 只能是本机地址（127.0.0.1、::1、localhost），当前为 ${host}`);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`PORT 无效：${process.env.PORT}`);
if (!token) fail('AGENT_TOKEN 未设置（请在项目根目录的 .env 中配置）');

const db = openDatabase(dbPath);
const server = createServer(createHandler({ db, token }));

server.on('error', error => fail(error.message));
server.listen(port, host, () => {
  console.log(`内网 API 已启动：http://${host}:${port}（数据库 ${dbPath}）`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在停止...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
