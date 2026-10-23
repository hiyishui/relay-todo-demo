import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createHandler, MAX_TODOS, openDatabase } from '../intranet-api/app.mjs';

const TOKEN = 'a'.repeat(64);

describe('intranet API', () => {
  let dir;
  let db;
  let server;
  let base;
  const logs = [];

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vpc-todo-'));
    db = openDatabase(join(dir, 'nested', 'todos.db'));
    server = createServer(createHandler({ db, token: TOKEN, log: line => logs.push(line) }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.exec('DELETE FROM todos');
    logs.length = 0;
  });

  function call(method, path, { body, token = TOKEN, contentType = 'application/json' } = {}) {
    const headers = {};
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = contentType;
    return fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  async function create(title) {
    const response = await call('POST', '/api/todos', { body: { title } });
    assert.equal(response.status, 201);
    return response.json();
  }

  test('creates, reads, updates and deletes a todo', async () => {
    const created = await create('  买牛奶  ');
    assert.equal(created.title, '买牛奶');
    assert.equal(created.completed, false);
    assert.equal(created.createdAt, created.updatedAt);

    const fetched = await call('GET', `/api/todos/${created.id}`);
    assert.equal(fetched.status, 200);
    assert.deepEqual(await fetched.json(), created);

    const patched = await call('PATCH', `/api/todos/${created.id}`, { body: { completed: true, title: '买酸奶' } });
    assert.equal(patched.status, 200);
    const updated = await patched.json();
    assert.equal(updated.completed, true);
    assert.equal(updated.title, '买酸奶');

    const removed = await call('DELETE', `/api/todos/${created.id}`);
    assert.equal(removed.status, 204);
    assert.equal(await removed.text(), '');

    const missing = await call('GET', `/api/todos/${created.id}`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'not_found');
  });

  test('POST returns Location and lists newest first', async () => {
    const response = await call('POST', '/api/todos', { body: { title: '第一条' } });
    const first = await response.json();
    assert.equal(response.headers.get('location'), `/api/todos/${first.id}`);
    const second = await create('第二条');

    const list = await call('GET', '/api/todos');
    assert.equal(list.status, 200);
    assert.equal(list.headers.get('cache-control'), 'no-store');
    const { items } = await list.json();
    assert.deepEqual(items.map(item => item.id), [second.id, first.id]);
  });

  test('ids are not reused after deletion', async () => {
    const first = await create('a');
    await call('DELETE', `/api/todos/${first.id}`);
    const second = await create('b');
    assert.ok(second.id > first.id);
  });

  test('rejects missing or wrong service token', async () => {
    for (const token of [null, 'wrong', `${TOKEN}x`]) {
      const response = await call('GET', '/api/todos', { token });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'unauthorized');
    }
  });

  test('rejects unknown paths and methods', async () => {
    assert.equal((await call('GET', '/api/other')).status, 404);
    assert.equal((await call('GET', '/api/todos/abc')).status, 404);
    const put = await call('PUT', '/api/todos/1', { body: { title: 'x' } });
    assert.equal(put.status, 405);
    assert.equal(put.headers.get('allow'), 'GET, PATCH, DELETE');
  });

  test('validates the request body', async () => {
    const cases = [
      [{ body: '{bad', }, 400, 'invalid_json'],
      [{ body: '[]' }, 400, 'invalid_json'],
      [{ body: { title: '' } }, 400, 'validation_error'],
      [{ body: { title: '   ' } }, 400, 'validation_error'],
      [{ body: { title: 'x'.repeat(201) } }, 400, 'validation_error'],
      [{ body: { title: 1 } }, 400, 'validation_error'],
      [{ body: { title: 'ok', owner: 'me' } }, 400, 'validation_error'],
      [{ body: { title: 'ok', completed: 'yes' } }, 400, 'validation_error'],
      [{ body: { title: 'ok' }, contentType: 'text/plain' }, 415, 'unsupported_media_type'],
      [{ body: JSON.stringify({ title: 'x'.repeat(17 * 1024) }) }, 413, 'payload_too_large'],
    ];
    for (const [options, status, code] of cases) {
      const response = await call('POST', '/api/todos', options);
      assert.equal(response.status, status, JSON.stringify(options).slice(0, 80));
      const body = await response.json();
      assert.equal(body.error, code);
      assert.equal(typeof body.message, 'string');
    }
  });

  test('accepts 200 characters counted by Unicode code points', async () => {
    const title = '😀'.repeat(200);
    const created = await create(title);
    assert.equal(created.title, title);
  });

  test('PATCH requires at least one field and an existing todo', async () => {
    const created = await create('x');
    const empty = await call('PATCH', `/api/todos/${created.id}`, { body: {} });
    assert.equal(empty.status, 400);
    const missing = await call('PATCH', '/api/todos/999999', { body: { completed: true } });
    assert.equal(missing.status, 404);
  });

  test('refuses to create more than the demo limit', async () => {
    const insert = db.prepare('INSERT INTO todos (title, completed, created_at, updated_at) VALUES (?, 0, ?, ?)');
    const now = new Date().toISOString();
    for (let i = 0; i < MAX_TODOS; i += 1) insert.run(`t${i}`, now, now);
    const response = await call('POST', '/api/todos', { body: { title: 'one more' } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /上限/);

    const list = await (await call('GET', '/api/todos')).json();
    assert.equal(list.items.length, 200);
  });

  test('logs method, path, status and duration without secrets or bodies', async () => {
    await create('secret title');
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\S+ POST \/api\/todos 201 \d+ms$/);
    assert.ok(!logs[0].includes(TOKEN));
    assert.ok(!logs[0].includes('secret title'));
  });
});
