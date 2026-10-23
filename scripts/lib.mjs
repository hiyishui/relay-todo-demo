import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = join(ROOT, '.env');
export const PAGES_DIR = join(ROOT, 'pages');
export const PAGES_PROJECT = 'relay-todo-demo';
export const WORKER_NAME = 'relay-todo-demo-gateway';
export const LOCAL_SITE_URL = 'http://127.0.0.1:8787';
export const SECRET_KEYS = ['ACCESS_TOKEN', 'AGENT_TOKEN'];

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

/** Sets keys in .env text: existing lines are replaced in place, new keys are appended. */
export function updateEnv(text, updates) {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  for (const [key, value] of Object.entries(updates)) {
    if (/[\r\n]/.test(value)) throw new Error(`${key} 的值不能包含换行`);
    const index = lines.findIndex(line => !/^\s*#/.test(line) && LINE.exec(line)?.[1] === key);
    if (index === -1) lines.push(`${key}=${value}`);
    else lines[index] = `${key}=${value}`;
  }
  return `${lines.join('\n')}\n`;
}

export function readEnvText() {
  return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
}

export function readEnv() {
  return parseEnv(readEnvText());
}

export function writeEnvUpdates(updates) {
  writeFileSync(ENV_PATH, updateEnv(readEnvText(), updates), { mode: 0o600 });
  chmodSync(ENV_PATH, 0o600);
}

export function pagesDomain(projects, name) {
  const project = projects.find(item => item['Project Name'] === name);
  if (!project) return null;
  const domains = String(project['Project Domains'] ?? '').split(/,\s*/);
  return domains.find(domain => domain.endsWith('.pages.dev')) ?? null;
}

export function relayUrlFor(siteUrl) {
  const url = new URL(siteUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/agent/connect';
  return url.href;
}

function accountFromEnvFile() {
  const id = readEnv().CLOUDFLARE_ACCOUNT_ID;
  return id ? { CLOUDFLARE_ACCOUNT_ID: id } : {};
}

/** Runs the project's wrangler. `capture` returns stdout/stderr instead of printing them. */
export function wrangler(args, { cwd = ROOT, input, capture = false } = {}) {
  const bin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  if (!existsSync(bin)) {
    throw new Error('找不到 wrangler，请先在项目根目录运行 npm install');
  }
  const result = spawnSync(bin, args, {
    cwd,
    input,
    encoding: 'utf8',
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
    // CLOUDFLARE_ACCOUNT_ID in .env selects the account when the login has access to several.
    env: { ...accountFromEnvFile(), ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export const color = {
  ok: text => `\x1b[32m${text}\x1b[0m`,
  fail: text => `\x1b[31m${text}\x1b[0m`,
  warn: text => `\x1b[33m${text}\x1b[0m`,
  bold: text => `\x1b[1m${text}\x1b[0m`,
};
