// npm run setup [-- --reset]
// Creates or completes .env with the two tokens. Existing values are kept unless --reset is given.
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

import { color, ENV_PATH, readEnv, writeEnvUpdates } from './lib.mjs';

const reset = process.argv.includes('--reset');
const interactive = process.stdin.isTTY && process.stdout.isTTY;
const current = readEnv();

const prompts = [
  ['ACCESS_TOKEN', '访问口令 ACCESS_TOKEN（在网页上输入，直接回车自动生成）：'],
  ['AGENT_TOKEN', 'agent 口令 AGENT_TOKEN（本机 agent 使用，不用记，直接回车自动生成）：'],
];

const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const updates = {};
try {
  for (const [key, question] of prompts) {
    if (!reset && current[key]) continue;
    const answer = rl ? (await rl.question(question)).trim() : '';
    if (/\s/.test(answer)) {
      console.error(color.fail(`${key} 不能包含空白字符`));
      process.exit(1);
    }
    updates[key] = answer || randomBytes(16).toString('hex');
  }
} finally {
  rl?.close();
}

if (Object.keys(updates).length > 0) writeEnvUpdates(updates);
const env = readEnv();

console.log('');
console.log(Object.keys(updates).length > 0 ? color.ok(`✔ 已写入 ${ENV_PATH}（权限 600）`) : color.ok('✔ .env 已存在，口令保持不变（要重新设置请运行 npm run setup -- --reset）'));
console.log(`  访问口令 ACCESS_TOKEN：${color.bold(env.ACCESS_TOKEN)}   ← 打开网页时输入它`);
console.log('  agent 口令 AGENT_TOKEN：已设置');
console.log('');
console.log('下一步：npm run deploy（部署到 Cloudflare），或按 README 先在本地体验。');
