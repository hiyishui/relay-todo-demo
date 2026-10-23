import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { handleRelayMessage } from '../agent/handler.mjs';
import { createHandler, openDatabase } from '../intranet-api/app.mjs';
import worker from '../worker/index.js';
import { AgentRelay } from '../worker/relay.js';
import { fakeCtx, fakeSocket } from './fakes.mjs';

const ACCESS_TOKEN = 'letmein';
const AGENT_TOKEN = 'agent-secret';

// Real Worker entry, gateway, relay object, agent handler and intranet API over HTTP.
// Only the WebSocket between the relay and the agent is replaced by direct calls.
describe('worker → relay DO → agent → intranet API', () => {
  let db;
  let server;
  let origin;
  let env;

  before(async () => {
    db = openDatabase(':memory:');
    server = createServer(createHandler({ db, token: AGENT_TOKEN, log: () => {} }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;

    const ctx = fakeCtx();
    const relay = new AgentRelay(ctx, {}, { timeoutMs: 5000 });
    const socket = fakeSocket(async data => {
      const reply = await handleRelayMessage(data, { apiOrigin: origin, token: AGENT_TOKEN, log: () => {} });
      relay.webSocketMessage(socket, JSON.stringify(reply));
    });
    ctx.sockets.push(socket);
    env = {
      ACCESS_TOKEN,
      AGENT_TOKEN,
      RELAY: { idFromName: () => 'default', get: () => ({ fetch: (url, init) => relay.fetch(new Request(url, init)) }) },
    };
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });

  async function call(method, path, body, token = ACCESS_TOKEN) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const request = new Request(`https://relay-todo-demo.pages.dev${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const original = console.log;
    console.log = () => {};
    try {
      return await worker.fetch(request, env);
    } finally {
      console.log = original;
    }
  }

  test('full CRUD round trip', async () => {
    const created = await call('POST', '/api/todos', { title: '经中继创建' });
    assert.equal(created.status, 201);
    const todo = await created.json();
    assert.equal(todo.title, '经中继创建');
    assert.equal(created.headers.get('location'), `/api/todos/${todo.id}`);
    assert.equal(created.headers.get('cache-control'), 'no-store');

    const list = await (await call('GET', '/api/todos')).json();
    assert.deepEqual(list.items.map(item => item.id), [todo.id]);

    const patched = await call('PATCH', `/api/todos/${todo.id}`, { completed: true });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).completed, true);

    const invalid = await call('PATCH', `/api/todos/${todo.id}`, { title: '' });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).message, /标题长度/);

    const removed = await call('DELETE', `/api/todos/${todo.id}`);
    assert.equal(removed.status, 204);
    assert.equal((await call('GET', `/api/todos/${todo.id}`)).status, 404);
  });

  test('a wrong access token never reaches the intranet API', async () => {
    const response = await call('GET', '/api/todos', undefined, 'wrong');
    assert.equal(response.status, 401);
  });
});
