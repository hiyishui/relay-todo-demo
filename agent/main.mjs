import { createAgent } from './client.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

function fail(message) {
  console.error(`agent 启动失败：${message}`);
  process.exit(1);
}

const relayUrl = process.env.RELAY_URL?.trim() ?? '';
const token = process.env.AGENT_TOKEN?.trim() ?? '';
const port = Number(process.env.PORT?.trim() || 8080);

if (!token) fail('AGENT_TOKEN 未设置（先运行 npm run setup）');
if (!relayUrl) fail('RELAY_URL 未设置（先运行 npm run deploy，它会写入 .env；本地联调用 npm start -- --local）');
if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`PORT 无效：${process.env.PORT}`);

let relay;
try {
  relay = new URL(relayUrl);
} catch {
  fail(`RELAY_URL 不是合法的 URL：${relayUrl}`);
}
if (relay.protocol !== 'wss:' && !(relay.protocol === 'ws:' && LOOPBACK_HOSTS.has(relay.hostname))) {
  fail(`RELAY_URL 必须以 wss:// 开头（本机调试可用 ws://127.0.0.1），当前为 ${relayUrl}`);
}

const agent = createAgent({
  relayUrl: relay.href,
  token,
  apiOrigin: `http://127.0.0.1:${port}`,
  onReplaced: () => process.exit(1),
});

function shutdown(signal) {
  console.log(`${new Date().toISOString()} 收到 ${signal}，agent 停止`);
  agent.stop();
  setTimeout(() => process.exit(0), 200).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

agent.start();
