// npm run check [-- --local] [-- --read-only]
// Verifies the whole chain step by step and explains what to do when a step fails.
import { color, LOCAL_SITE_URL, readEnv } from './lib.mjs';

const local = process.argv.includes('--local');
const readOnly = process.argv.includes('--read-only');
const env = { ...readEnv(), ...process.env };
const site = local ? LOCAL_SITE_URL : env.SITE_URL;
const token = env.ACCESS_TOKEN;

if (!token) {
  console.error(color.fail('✘ .env 中没有 ACCESS_TOKEN，请先运行 npm run setup'));
  process.exit(1);
}
if (!site) {
  console.error(color.fail('✘ .env 中没有 SITE_URL，请先运行 npm run deploy（只检查本地时用 npm run check -- --local）'));
  process.exit(1);
}

const START_HINT = local
  ? '确认 npm run dev 和 npm start -- --local 都在运行'
  : '确认另一个终端里的 npm start 正在运行，并查看 [agent] 日志是否出现“已连接中继”';

async function call(method, path, { auth = true, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, site), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (for example the HTML page).
  }
  return { status: response.status, text, json };
}

function explainApiFailure(status, json) {
  if (status === 401) return 'ACCESS_TOKEN 与已部署的不一致：重新运行 npm run deploy 上传口令';
  if (status === 502 && json?.message?.includes('agent')) return `agent 没有连上中继：${START_HINT}`;
  if (status === 502) return `内网服务不可达（${json?.message ?? '无详情'}）：${START_HINT}`;
  if (status === 504) return '本机 API 响应超时：查看 [api] 日志，必要时重启 npm start';
  if (status === 429) return '今日免费额度已用完，北京时间 08:00 恢复';
  return `意外的响应：${status} ${json?.message ?? ''}`;
}

const steps = [
  ['打开首页', async () => {
    const { status, text } = await call('GET', '/', { auth: false });
    if (status === 200 && text.includes('Relay Todo Demo')) return null;
    return local
      ? `返回 ${status}：确认 npm run dev 正在运行`
      : `返回 ${status}：新建的 pages.dev 域名可能需要 1–2 分钟生效，稍后重试；或检查网络能否访问 ${site}`;
  }],
  ['不带口令访问 API 应被拒绝（401）', async () => {
    const { status, json } = await call('GET', '/api/todos', { auth: false });
    if (status === 401) return null;
    if (status === 502) return `返回 502（${json?.message ?? ''}）：Pages 没有连到网关 Worker，重新运行 npm run deploy`;
    return `返回 ${status}，期望 401`;
  }],
  ['agent 入口可达（非 WebSocket 请求应返回 426）', async () => {
    const { status } = await call('GET', '/agent/connect', { auth: false });
    return status === 426 ? null : `返回 ${status}，期望 426：重新运行 npm run deploy`;
  }],
  ['带口令读取待办列表', async () => {
    const { status, json } = await call('GET', '/api/todos');
    if (status === 200 && Array.isArray(json?.items)) return null;
    return explainApiFailure(status, json);
  }],
];

let created = null;
if (!readOnly) {
  steps.push(
    ['新建一条检查记录', async () => {
      const { status, json } = await call('POST', '/api/todos', { body: { title: `[check] ${new Date().toISOString()}` } });
      if (status !== 201) return explainApiFailure(status, json);
      created = json;
      return null;
    }],
    ['修改这条记录为已完成', async () => {
      const { status, json } = await call('PATCH', `/api/todos/${created.id}`, { body: { completed: true } });
      return status === 200 && json?.completed === true ? null : explainApiFailure(status, json);
    }],
    ['删除这条记录', async () => {
      const { status, json } = await call('DELETE', `/api/todos/${created.id}`);
      return status === 204 ? null : explainApiFailure(status, json);
    }],
  );
}

console.log(`检查 ${site}${local ? '（本地）' : ''}\n`);
for (const [index, [title, run]] of steps.entries()) {
  const label = `[${index + 1}/${steps.length}] ${title}`;
  let problem;
  try {
    problem = await run();
  } catch (error) {
    problem = error?.name === 'TimeoutError'
      ? '请求超时：检查网络'
      : `请求失败（${error?.cause?.code ?? error?.message}）：${local ? '确认 npm run dev 正在运行' : `检查网络能否访问 ${site}`}`;
  }
  if (problem) {
    console.log(`${color.fail('✘')} ${label}\n  ${problem}`);
    process.exit(1);
  }
  console.log(`${color.ok('✔')} ${label}`);
}

console.log(`\n${color.ok('全部通过')}：浏览器打开 ${color.bold(site)}，输入访问口令即可使用。`);
