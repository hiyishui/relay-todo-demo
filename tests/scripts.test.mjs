import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { pagesDomain, parseEnv, relayUrlFor, updateEnv } from '../scripts/lib.mjs';

describe('scripts/lib', () => {
  test('parseEnv reads KEY=VALUE lines and ignores comments and blanks', () => {
    const env = parseEnv([
      '# comment',
      '',
      'ACCESS_TOKEN=abc',
      '  AGENT_TOKEN = x=y  ',
      'export SITE_URL=https://a.pages.dev',
      'QUOTED="hello world"',
      "SINGLE='v'",
      'EMPTY=',
      'not a pair',
    ].join('\n'));
    assert.deepEqual(env, {
      ACCESS_TOKEN: 'abc',
      AGENT_TOKEN: 'x=y',
      SITE_URL: 'https://a.pages.dev',
      QUOTED: 'hello world',
      SINGLE: 'v',
      EMPTY: '',
    });
  });

  test('updateEnv replaces existing keys in place, keeps comments and appends new keys', () => {
    const before = '# tokens\nACCESS_TOKEN=old\nAGENT_TOKEN=keep\n';
    const after = updateEnv(before, { ACCESS_TOKEN: 'new', SITE_URL: 'https://x.pages.dev' });
    assert.equal(after, '# tokens\nACCESS_TOKEN=new\nAGENT_TOKEN=keep\nSITE_URL=https://x.pages.dev\n');
    assert.equal(updateEnv('A=1', { B: '2' }), 'A=1\nB=2\n');
    assert.equal(updateEnv('', { A: '1' }), 'A=1\n');
    assert.throws(() => updateEnv('', { A: 'two\nlines' }), /换行/);
  });

  test('pagesDomain picks the *.pages.dev domain of the named project', () => {
    const projects = [
      { 'Project Name': 'other', 'Project Domains': 'other.pages.dev' },
      { 'Project Name': 'relay-todo-demo', 'Project Domains': 'todo.example.com, relay-todo-demo-abc.pages.dev' },
    ];
    assert.equal(pagesDomain(projects, 'relay-todo-demo'), 'relay-todo-demo-abc.pages.dev');
    assert.equal(pagesDomain(projects, 'missing'), null);
    assert.equal(pagesDomain([{ 'Project Name': 'p', 'Project Domains': '' }], 'p'), null);
  });

  test('relayUrlFor maps the site URL to the agent WebSocket endpoint', () => {
    assert.equal(relayUrlFor('https://relay-todo-demo.pages.dev'), 'wss://relay-todo-demo.pages.dev/agent/connect');
    assert.equal(relayUrlFor('https://relay-todo-demo.pages.dev/'), 'wss://relay-todo-demo.pages.dev/agent/connect');
    assert.equal(relayUrlFor('http://127.0.0.1:8787'), 'ws://127.0.0.1:8787/agent/connect');
  });
});
