import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as entry from '../worker/index.js';

const silence = async fn => {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
};

function relayBinding(seen) {
  return {
    idFromName: name => `id:${name}`,
    get: id => ({ fetch: (url, init) => (seen.push({ id, url, init }), Response.json({ items: [] })) }),
  };
}

describe('worker entry', () => {
  test('exports only the fetch handler and the AgentRelay Durable Object class', () => {
    assert.deepEqual(Object.keys(entry).sort(), ['AgentRelay', 'default']);
    assert.equal(typeof entry.default.fetch, 'function');
  });

  test('routes /agent/connect to the agent endpoint', async () => {
    const response = await silence(() => entry.default.fetch(new Request('https://x/agent/connect'), { AGENT_TOKEN: 'a' }));
    assert.equal(response.status, 426);
  });

  test('routes /api/* through the gateway to the "default" relay object', async () => {
    const seen = [];
    const env = { ACCESS_TOKEN: 'letmein', RELAY: relayBinding(seen) };
    const response = await silence(() => entry.default.fetch(
      new Request('https://x/api/todos', { headers: { Authorization: 'Bearer letmein' } }),
      env,
    ));
    assert.equal(response.status, 200);
    assert.equal(seen[0].id, 'id:default');
    assert.equal(seen[0].url, 'http://intranet-api/api/todos');

    const denied = await silence(() => entry.default.fetch(new Request('https://x/api/todos'), env));
    assert.equal(denied.status, 401);
    assert.equal(seen.length, 1);
  });

  test('returns 502 for API calls when the relay binding is missing', async () => {
    const response = await silence(() => entry.default.fetch(
      new Request('https://x/api/todos', { headers: { Authorization: 'Bearer letmein' } }),
      { ACCESS_TOKEN: 'letmein' },
    ));
    assert.equal(response.status, 502);
  });
});
