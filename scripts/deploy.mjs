// npm run deploy
// Deploys the gateway Worker (with the relay Durable Object), uploads the two tokens as Worker
// secrets, creates the Pages project if needed, deploys Pages, and writes SITE_URL / RELAY_URL to .env.
import {
  color, PAGES_DIR, PAGES_PROJECT, pagesDomain, readEnv, relayUrlFor, SECRET_KEYS, wrangler, WORKER_NAME, writeEnvUpdates,
} from './lib.mjs';

function step(index, total, title) {
  console.log(`\n${color.bold(`[${index}/${total}] ${title}`)}`);
}

function fail(message) {
  console.error(`\n${color.fail(`✘ ${message}`)}`);
  process.exit(1);
}

function listPagesProjects() {
  const result = wrangler(['pages', 'project', 'list', '--json'], { capture: true });
  if (result.status !== 0) fail(`查询 Pages 项目失败：\n${result.stderr || result.stdout}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`无法解析 wrangler pages project list 的输出：\n${result.stdout}`);
  }
}

const env = readEnv();
const missing = SECRET_KEYS.filter(key => !env[key]);
if (missing.length > 0) fail(`.env 中缺少 ${missing.join('、')}，请先运行 npm run setup`);

const TOTAL = 5;

step(1, TOTAL, '检查 Cloudflare 登录状态');
if (wrangler(['whoami', '--json'], { capture: true }).status !== 0) {
  fail('尚未登录 Cloudflare，请先运行：npx wrangler login');
}
console.log(color.ok('✔ 已登录'));

step(2, TOTAL, `部署网关 Worker ${WORKER_NAME}（含 Durable Object AgentRelay）`);
if (wrangler(['deploy']).status !== 0) fail('Worker 部署失败，请查看上面的 wrangler 输出');
console.log(color.ok('✔ Worker 已部署（没有公网地址是正常的，它只供 Pages 调用）'));

step(3, TOTAL, `上传口令为 Worker secret：${SECRET_KEYS.join('、')}`);
const secrets = JSON.stringify(Object.fromEntries(SECRET_KEYS.map(key => [key, env[key]])));
const upload = wrangler(['secret', 'bulk'], { input: secrets, capture: true });
if (upload.status !== 0) fail(`上传 secret 失败：\n${upload.stderr || upload.stdout}`);
console.log(color.ok('✔ 口令已上传'));

step(4, TOTAL, `准备 Pages 项目 ${PAGES_PROJECT}`);
if (pagesDomain(listPagesProjects(), PAGES_PROJECT) === null) {
  const created = wrangler(['pages', 'project', 'create', PAGES_PROJECT, '--production-branch', 'main']);
  if (created.status !== 0) fail('创建 Pages 项目失败，请查看上面的 wrangler 输出');
} else {
  console.log(color.ok('✔ 项目已存在'));
}

step(5, TOTAL, '部署 Pages（页面 + 转发 Functions）');
const pages = wrangler(['pages', 'deploy', '--branch', 'main', '--commit-dirty=true'], { cwd: PAGES_DIR });
if (pages.status !== 0) fail('Pages 部署失败，请查看上面的 wrangler 输出');

const domain = pagesDomain(listPagesProjects(), PAGES_PROJECT);
if (!domain) fail(`部署完成，但查不到 ${PAGES_PROJECT} 的 pages.dev 域名，请在 Cloudflare 控制台查看`);
const siteUrl = `https://${domain}`;
const relayUrl = relayUrlFor(siteUrl);
writeEnvUpdates({ SITE_URL: siteUrl, RELAY_URL: relayUrl });

console.log(`\n${color.ok('✔ 部署完成')}`);
console.log(`  访问地址：${color.bold(siteUrl)}`);
console.log(`  中继地址：${relayUrl}（已写入 .env 的 RELAY_URL）`);
console.log(`  访问口令：${color.bold(env.ACCESS_TOKEN)}`);
console.log('\n下一步：');
console.log('  1. 另开一个终端运行 npm start（本机 API + agent），保持运行');
console.log('  2. 运行 npm run check 验证整条链路');
console.log(`  3. 浏览器打开 ${siteUrl}，输入访问口令`);
