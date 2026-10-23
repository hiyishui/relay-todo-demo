import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AgentRelay, connectAgent } from '../worker/relay.js';
import { fakeCtx, fakeSocket, fakeUpgrade } from './fakes.mjs';

function apiRequest(method = 'GET', path = '/api/todos', { body, headers = {} } = {}) {
  return new Request(`http://intranet-api${path}`, { method, headers, body });
}

// Socket that answers every request frame with `reply(frame)` on the next microtask.
function answeringSocket(relay, reply) {
  const socket = fakeSocket(data => {
    const frame = JSON.parse(data);
    queueMicrotask(() => relay.webSocketMessage(socket, JSON.stringify(reply(frame))));
  });
  return socket;
}

describe('relay durable object', () => {
  test('lets the runtime answer agent pings without waking the object', () => {
    const ctx = fakeCtx();
    new AgentRelay(ctx, {});
    assert.equal(ctx.autoResponse.request, 'ping');
    assert.equal(ctx.autoResponse.response, 'pong');
  });

  test('accepts an agent socket with the agent tag and closes older agents', async () => {
    const ctx = fakeCtx();
    const upgrade = fakeUpgrade();
    const relay = new AgentRelay(ctx, {}, upgrade);
    const old = fakeSocket();
    ctx.sockets.push(old);

    const response = await relay.fetch(new Request('http://relay/agent/connect', { headers: { Upgrade: 'websocket' } }));

    assert.equal(response.status, 101);
    assert.equal(response.webSocket, upgrade.created[0].client);
    assert.deepEqual(ctx.tags.get(upgrade.created[0].server), ['agent']);
    assert.equal(old.closedWith.code, 4000);
  });

  test('sends a request frame and resolves with the matching response frame', async () => {
    const ctx = fakeCtx();
    const relay = new AgentRelay(ctx, {}, { timeoutMs: 1000 });
    const socket = fakeSocket(data => {
      const { id } = JSON.parse(data);
      queueMicrotask(() => relay.webSocketMessage(socket, JSON.stringify({ type: 'response', id: 'other', status: 500, body: 'x' })));
      queueMicrotask(() => relay.webSocketMessage(socket, JSON.stringify({
        type: 'response',
        id,
        status: 201,
        headers: { 'content-type': 'application/json', location: '/api/todos/7', 'set-cookie': 'a=b' },
        body: '{"id":7}',
      })));
    });
    ctx.sockets.push(socket);

    const response = await relay.fetch(apiRequest('POST', '/api/todos?x=1', {
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer leak', cookie: 'c=d' },
      body: '{"title":"t"}',
    }));

    const frame = JSON.parse(socket.sent[0]);
    assert.equal(frame.type, 'request');
    assert.equal(typeof frame.id, 'string');
    assert.equal(frame.method, 'POST');
    assert.equal(frame.path, '/api/todos?x=1');
    assert.deepEqual(frame.headers, { 'content-type': 'application/json', accept: 'application/json' });
    assert.equal(frame.body, '{"title":"t"}');
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('location'), '/api/todos/7');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { id: 7 });
    assert.equal(relay.pending.size, 0);
  });

  test('uses the newest open agent and returns 204 without a body', async () => {
    const ctx = fakeCtx();
    const relay = new AgentRelay(ctx, {}, { timeoutMs: 1000 });
    const older = fakeSocket();
    const newest = answeringSocket(relay, ({ id }) => ({ type: 'response', id, status: 204, body: 'ignored' }));
    const closed = fakeSocket();
    closed.readyState = 3;
    ctx.sockets.push(older, newest, closed);

    const response = await relay.fetch(apiRequest('DELETE', '/api/todos/1'));

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(older.sent.length, 0);
    assert.equal(JSON.parse(newest.sent[0]).body, null);
  });

  test('returns 502 when no agent is connected', async () => {
    const relay = new AgentRelay(fakeCtx(), {});
    const response = await relay.fetch(apiRequest());
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error, 'upstream_unavailable');
  });

  test('returns 504 when the agent does not answer in time', async () => {
    const relay = new AgentRelay(fakeCtx([fakeSocket()]), {}, { timeoutMs: 20 });
    const response = await relay.fetch(apiRequest());
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error, 'upstream_timeout');
    assert.equal(relay.pending.size, 0);
  });

  test('fails pending requests with 502 when their socket closes or errors', async () => {
    for (const event of ['webSocketClose', 'webSocketError']) {
      const ctx = fakeCtx();
      const relay = new AgentRelay(ctx, {}, { timeoutMs: 1000 });
      const socket = fakeSocket(() => queueMicrotask(() => relay[event](socket, 1006, '', false)));
      ctx.sockets.push(socket);

      const response = await relay.fetch(apiRequest());

      assert.equal(response.status, 502, event);
      assert.equal(relay.pending.size, 0);
    }
  });

  test('returns 502 when sending to the socket throws', async () => {
    const ctx = fakeCtx();
    const relay = new AgentRelay(ctx, {}, { timeoutMs: 1000 });
    const socket = fakeSocket(() => { throw new Error('closed'); });
    ctx.sockets.push(socket);
    const response = await relay.fetch(apiRequest());
    assert.equal(response.status, 502);
    assert.equal(relay.pending.size, 0);
  });

  test('rejects response frames with an invalid status as 502 and ignores junk frames', async () => {
    const ctx = fakeCtx();
    const relay = new AgentRelay(ctx, {}, { timeoutMs: 1000 });
    const socket = fakeSocket(data => {
      const { id } = JSON.parse(data);
      queueMicrotask(() => {
        relay.webSocketMessage(socket, 'not json');
        relay.webSocketMessage(socket, new ArrayBuffer(4));
        relay.webSocketMessage(socket, JSON.stringify({ type: 'request', id, status: 200 }));
        relay.webSocketMessage(socket, JSON.stringify({ type: 'response', id, status: 101 }));
      });
    });
    ctx.sockets.push(socket);

    const response = await relay.fetch(apiRequest());
    assert.equal(response.status, 502);
  });
});

describe('agent connect endpoint', () => {
  const quiet = () => {};

  function relayEnv(seen = []) {
    return {
      AGENT_TOKEN: 'agent-secret',
      RELAY: {
        idFromName: name => `id:${name}`,
        get: id => ({ fetch: request => (seen.push([id, request]), new Response('accepted')) }),
      },
    };
  }

  test('requires a WebSocket upgrade', async () => {
    const response = await connectAgent(new Request('https://x/agent/connect'), relayEnv(), quiet);
    assert.equal(response.status, 426);
    assert.equal((await response.json()).error, 'upgrade_required');
  });

  test('rejects a missing or wrong agent token before reaching the relay', async () => {
    for (const authorization of [undefined, 'Bearer wrong']) {
      const seen = [];
      const headers = { Upgrade: 'websocket' };
      if (authorization) headers.Authorization = authorization;
      const response = await connectAgent(new Request('https://x/agent/connect', { headers }), relayEnv(seen), quiet);
      assert.equal(response.status, 401);
      assert.equal(seen.length, 0);
    }
  });

  test('hands an authenticated upgrade to the "default" relay object and logs without the token', async () => {
    const seen = [];
    const lines = [];
    const request = new Request('https://x/agent/connect', {
      headers: { Upgrade: 'websocket', Authorization: 'Bearer agent-secret' },
    });
    const response = await connectAgent(request, relayEnv(seen), line => lines.push(line));
    assert.equal(await response.text(), 'accepted');
    assert.deepEqual(seen.map(([id]) => id), ['id:default']);
    assert.equal(seen[0][1], request);
    assert.match(lines[0], / GET \/agent\/connect 200 \d+ms$/);
    assert.ok(!lines[0].includes('agent-secret'));
  });

  test('returns 502 when the relay binding is missing', async () => {
    const request = new Request('https://x/agent/connect', {
      headers: { Upgrade: 'websocket', Authorization: 'Bearer agent-secret' },
    });
    const response = await connectAgent(request, { AGENT_TOKEN: 'agent-secret' }, quiet);
    assert.equal(response.status, 502);
  });
});
