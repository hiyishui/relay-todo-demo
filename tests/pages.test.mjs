import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { onRequest as onAgent } from '../pages/functions/agent/connect.js';
import { onRequest as onApi } from '../pages/functions/api/[[path]].js';

describe('pages functions', () => {
  for (const [name, onRequest] of [['/api/*', onApi], ['/agent/connect', onAgent]]) {
    test(`${name} hands the original request to the gateway Worker unchanged`, async () => {
      const seen = [];
      const env = { GATEWAY: { fetch: async req => (seen.push(req), new Response('ok', { status: 201 })) } };
      const request = new Request('https://relay-todo-demo.pages.dev/api/todos?x=1', {
        method: 'POST',
        headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
        body: '{"title":"t"}',
      });

      const response = await onRequest({ request, env });

      assert.equal(response.status, 201);
      assert.deepEqual(seen, [request]);
    });

    test(`${name} returns 502 when the Service binding is missing`, async () => {
      const response = await onRequest({ request: new Request('https://x.pages.dev/api/todos'), env: {} });
      assert.equal(response.status, 502);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.json()).error, 'upstream_unavailable');
    });
  }
});
