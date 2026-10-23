import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { handleRelayMessage, MAX_RESPONSE_BYTES } from '../agent/handler.mjs';

const API = 'http://127.0.0.1:8080';
const TOKEN = 'agent-secret';
const quiet = () => {};

function frame(overrides = {}) {
  return JSON.stringify({
    type: 'request',
    id: 'req-1',
    method: 'GET',
    path: '/api/todos',
    headers: { accept: 'application/json', cookie: 'c=d', authorization: 'Bearer forged' },
    body: null,
    ...overrides,
  });
}

const options = extra => ({ apiOrigin: API, token: TOKEN, log: quiet, ...extra });

describe('agent handler', () => {
  test('calls the local API with its own token and relays the response', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{"id":3}', {
        status: 201,
        headers: { 'Content-Type': 'application/json', Location: '/api/todos/3', 'X-Other': '1' },
      });
    };
    const lines = [];
    const reply = await handleRelayMessage(
      frame({ method: 'POST', path: '/api/todos?a=1', headers: { 'content-type': 'application/json' }, body: '{"title":"t"}' }),
      options({ fetchImpl, log: line => lines.push(line) }),
    );

    assert.equal(calls[0].url, 'http://127.0.0.1:8080/api/todos?a=1');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.deepEqual(calls[0].init.headers, { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` });
    assert.equal(calls[0].init.body, '{"title":"t"}');
    assert.deepEqual(reply, {
      type: 'response',
      id: 'req-1',
      status: 201,
      headers: { 'content-type': 'application/json', location: '/api/todos/3' },
      body: '{"id":3}',
    });
    assert.match(lines[0], / POST \/api\/todos 201 \d+ms$/);
    assert.ok(!lines[0].includes(TOKEN));
    assert.ok(!lines[0].includes('title'));
  });

  test('replaces forwarded authorization, drops other headers and GET bodies', async () => {
    let seen;
    const fetchImpl = async (url, init) => ((seen = init), new Response(null, { status: 204 }));
    const reply = await handleRelayMessage(frame({ body: 'ignored' }), options({ fetchImpl }));
    assert.deepEqual(seen.headers, { accept: 'application/json', authorization: `Bearer ${TOKEN}` });
    assert.equal(seen.body, undefined);
    assert.equal(reply.status, 204);
    assert.equal(reply.body, null);
  });

  test('refuses paths, hosts and methods outside the whitelist without calling the API', async () => {
    let called = false;
    const fetchImpl = async () => ((called = true), new Response('{}'));
    for (const overrides of [
      { path: '/api/other' },
      { path: '/api/todos/abc' },
      { path: '/admin' },
      { path: '//evil.example/api/todos' },
      { path: 'http://evil.example/api/todos' },
      { path: '/api/todos/../../etc' },
      { path: 42 },
      { method: 'PUT' },
      { method: 'DELETE', path: '/api/todos' },
    ]) {
      const reply = await handleRelayMessage(frame(overrides), options({ fetchImpl }));
      assert.equal(reply.status, 403, JSON.stringify(overrides));
      assert.equal(JSON.parse(reply.body).error, 'forbidden');
    }
    assert.equal(called, false);
  });

  test('maps an unreachable API to 502 and a slow one to 504', async () => {
    const down = await handleRelayMessage(frame(), options({
      fetchImpl: async () => { throw new TypeError('fetch failed'); },
    }));
    assert.equal(down.status, 502);
    assert.equal(JSON.parse(down.body).error, 'upstream_unavailable');

    const slow = await handleRelayMessage(frame(), options({
      timeoutMs: 10,
      fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    }));
    assert.equal(slow.status, 504);
    assert.equal(JSON.parse(slow.body).error, 'upstream_timeout');
  });

  test('refuses to relay a response body larger than the limit', async () => {
    const reply = await handleRelayMessage(frame(), options({
      fetchImpl: async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)),
    }));
    assert.equal(reply.status, 502);
  });

  test('ignores frames that are not requests', async () => {
    for (const data of ['not json', '{"id":"x"}', '{"type":"response","id":"x"}', '{"type":"request"}', 'pong']) {
      assert.equal(await handleRelayMessage(data, options()), null, data);
    }
  });
});
