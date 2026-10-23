import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { handleRequest, MAX_BODY_BYTES, tokenMatches } from '../worker/gateway.js';

const ACCESS_TOKEN = 'letmein';
const quiet = { log: () => {} };

function fakeUpstream(respond = () => Response.json({ items: [] })) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      const body = init.body === undefined ? undefined : new TextDecoder().decode(init.body);
      calls.push({ url, init, body });
      return respond(url, init);
    },
  };
}

const config = (upstream = fakeUpstream()) => ({ accessToken: ACCESS_TOKEN, upstream });

function request(method, path, { token = ACCESS_TOKEN, body, headers = {} } = {}) {
  const allHeaders = { ...headers };
  if (token !== null) allHeaders.Authorization = `Bearer ${token}`;
  return new Request(`https://relay-todo-demo.pages.dev${path}`, { method, headers: allHeaders, body });
}

describe('worker gateway', () => {
  test('tokenMatches accepts only an exact non-empty bearer token', async () => {
    assert.equal(await tokenMatches('Bearer abc', 'abc'), true);
    assert.equal(await tokenMatches('bearer abc', 'abc'), true);
    assert.equal(await tokenMatches('Bearer abcd', 'abc'), false);
    assert.equal(await tokenMatches('abc', 'abc'), false);
    assert.equal(await tokenMatches(null, 'abc'), false);
    assert.equal(await tokenMatches('Bearer ', ''), false);
    assert.equal(await tokenMatches('Bearer abc', undefined), false);
  });

  test('forwards an allowed request with only content-type and accept headers', async () => {
    const upstream = fakeUpstream(() => new Response(JSON.stringify({ id: 1 }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', Location: '/api/todos/1', 'Set-Cookie': 'x=1', Server: 'node' },
    }));
    const response = await handleRequest(
      request('POST', '/api/todos?x=1', {
        body: JSON.stringify({ title: '买牛奶' }),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: 'session=1' },
      }),
      config(upstream),
      quiet,
    );

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 1 });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('location'), '/api/todos/1');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('server'), null);

    const [{ url, init, body }] = upstream.calls;
    assert.equal(url, 'http://intranet-api/api/todos?x=1');
    assert.equal(init.method, 'POST');
    assert.equal(body, JSON.stringify({ title: '买牛奶' }));
    assert.deepEqual([...init.headers.keys()].sort(), ['accept', 'content-type']);
  });

  test('passes through 204 and upstream errors unchanged', async () => {
    const noContent = await handleRequest(request('DELETE', '/api/todos/7'), config(fakeUpstream(() => new Response(null, { status: 204 }))), quiet);
    assert.equal(noContent.status, 204);
    assert.equal(await noContent.text(), '');

    const invalid = await handleRequest(
      request('PATCH', '/api/todos/7', { body: '{}', headers: { 'Content-Type': 'application/json' } }),
      config(fakeUpstream(() => Response.json({ error: 'validation_error', message: '至少需要修改' }, { status: 400 }))),
      quiet,
    );
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'validation_error');
  });

  test('rejects missing or wrong access tokens without calling upstream', async () => {
    for (const token of [null, 'wrong', '']) {
      const upstream = fakeUpstream();
      const response = await handleRequest(request('GET', '/api/todos', { token }), config(upstream), quiet);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'unauthorized');
      assert.equal(upstream.calls.length, 0);
    }
    const upstream = fakeUpstream();
    const unset = await handleRequest(request('GET', '/api/todos'), { upstream, accessToken: undefined }, quiet);
    assert.equal(unset.status, 401);
    assert.equal(upstream.calls.length, 0);
  });

  test('only allows the five REST routes', async () => {
    const upstream = fakeUpstream();
    for (const path of ['/api', '/api/other', '/api/todos/abc', '/api/todos/0', '/api/todos/1/x', '/api/todos/12345678901234567']) {
      const response = await handleRequest(request('GET', path), config(upstream), quiet);
      assert.equal(response.status, 404, path);
    }
    const put = await handleRequest(request('PUT', '/api/todos/1', { body: '{}' }), config(upstream), quiet);
    assert.equal(put.status, 405);
    assert.equal(put.headers.get('allow'), 'GET, PATCH, DELETE');
    const deleteAll = await handleRequest(request('DELETE', '/api/todos'), config(upstream), quiet);
    assert.equal(deleteAll.status, 405);
    assert.equal(deleteAll.headers.get('allow'), 'GET, POST');
    assert.equal(upstream.calls.length, 0);
  });

  test('requires JSON bodies no larger than 16 KB', async () => {
    const upstream = fakeUpstream();
    const wrongType = await handleRequest(
      request('POST', '/api/todos', { body: 'title=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
      config(upstream),
      quiet,
    );
    assert.equal(wrongType.status, 415);

    const tooLarge = await handleRequest(
      request('POST', '/api/todos', { body: 'x'.repeat(MAX_BODY_BYTES + 1), headers: { 'Content-Type': 'application/json' } }),
      config(upstream),
      quiet,
    );
    assert.equal(tooLarge.status, 413);

    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 20; i += 1) controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    });
    const streamed = await handleRequest(
      new Request('https://relay-todo-demo.pages.dev/api/todos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half',
      }),
      config(upstream),
      quiet,
    );
    assert.equal(streamed.status, 413);
    assert.equal(upstream.calls.length, 0);
  });

  test('maps a missing relay and upstream exceptions to 502, and slowness to 504', async () => {
    const missing = await handleRequest(request('GET', '/api/todos'), { accessToken: ACCESS_TOKEN, upstream: null }, quiet);
    assert.equal(missing.status, 502);

    const unavailable = await handleRequest(
      request('GET', '/api/todos'),
      config(fakeUpstream(() => { throw new Error('Durable Object reset'); })),
      quiet,
    );
    assert.equal(unavailable.status, 502);
    const body = await unavailable.json();
    assert.equal(body.error, 'upstream_unavailable');
    assert.ok(!JSON.stringify(body).includes('reset'));

    const slow = fakeUpstream(() => new Promise(() => {}));
    const timedOut = await handleRequest(request('GET', '/api/todos'), config(slow), { ...quiet, timeoutMs: 20 });
    assert.equal(timedOut.status, 504);
    assert.equal((await timedOut.json()).error, 'upstream_timeout');
  });

  test('logs one line per request without tokens or bodies', async () => {
    const lines = [];
    await handleRequest(
      request('POST', '/api/todos', { body: JSON.stringify({ title: 'secret title' }), headers: { 'Content-Type': 'application/json' } }),
      config(),
      { log: line => lines.push(line) },
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\S+ POST \/api\/todos 200 \d+ms$/);
    for (const secret of [ACCESS_TOKEN, 'secret title']) assert.ok(!lines[0].includes(secret));
  });
});
