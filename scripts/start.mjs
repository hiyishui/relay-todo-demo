// npm start [-- --local]
// Runs the intranet API and the agent together with prefixed logs. If either exits, both stop.
// --local points the agent at a local `npm run dev` instead of the deployed site.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { color, LOCAL_SITE_URL, readEnv, relayUrlFor, ROOT } from './lib.mjs';

const local = process.argv.includes('--local');
const fileEnv = readEnv();
// Like `node --env-file`: variables already set in the shell win over .env.
const env = { ...fileEnv, ...process.env };
if (local) env.RELAY_URL = relayUrlFor(LOCAL_SITE_URL);

if (!env.AGENT_TOKEN) {
  console.error(color.fail('.env 中没有 AGENT_TOKEN，请先运行 npm run setup'));
  process.exit(1);
}
if (!env.RELAY_URL) {
  console.error(color.fail('.env 中没有 RELAY_URL，请先运行 npm run deploy；只在本地体验时用 npm start -- --local'));
  process.exit(1);
}

console.log(`中继地址：${env.RELAY_URL}${local ? '（本地 wrangler dev）' : ''}`);
console.log('按 Ctrl+C 停止。\n');

const children = new Map();
let stopping = false;

function run(name, args, paint) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', line => console.log(`${paint(`[${name}]`)} ${line}`));
  }
  child.on('exit', code => {
    children.delete(name);
    if (!stopping) {
      console.log(color.warn(`\n[${name}] 已退出（code ${code}），停止其他进程`));
      stop(code || 1);
    } else if (children.size === 0) {
      process.exit(process.exitCode ?? 0);
    }
  });
  children.set(name, child);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children.values()) child.kill('SIGTERM');
  if (children.size === 0) process.exit(code);
  setTimeout(() => process.exit(code), 5000).unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('api', ['--disable-warning=ExperimentalWarning', 'intranet-api/server.mjs'], text => `\x1b[36m${text}\x1b[0m`);
run('agent', ['agent/main.mjs'], text => `\x1b[35m${text}\x1b[0m`);
