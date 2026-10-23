import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';

import { createAgent } from '../agent/client.mjs';

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.readyState = 0;
    this.sent = [];
    this.closed = null;
    this.listeners = {};
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  emit(type, event = {}) {
    if (type === 'open') this.readyState = 1;
    if (type === 'close') this.readyState = 3;
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  send(data) {
    this.sent.push(data);
  }

  close(code, reason) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
}

const last = () => FakeWebSocket.instances.at(-1);
const flush = () => new Promise(resolve => setImmediate(resolve));

function agent(overrides = {}) {
  const lines = [];
  const events = [];
  const instance = createAgent({
    relayUrl: 'wss://relay.example/agent/connect',
    token: 'agent-secret',
    apiOrigin: 'http://127.0.0.1:8080',
    WebSocketImpl: FakeWebSocket,
    handle: async data => ({ type: 'response', id: JSON.parse(data).id, status: 200, headers: {}, body: '{}' }),
    log: line => lines.push(line),
    onReplaced: () => events.push('replaced'),
    ...overrides,
  });
  return { instance, lines, events };
}

describe('agent client', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  });
  afterEach(() => mock.timers.reset());

  test('connects to the relay with the agent token in the Authorization header', () => {
    const { instance } = agent();
    instance.start();
    assert.equal(last().url, 'wss://relay.example/agent/connect');
    assert.deepEqual(last().options, { headers: { Authorization: 'Bearer agent-secret' } });
    instance.stop();
  });

  test('answers request frames with response frames and ignores pong', async () => {
    const handled = [];
    const { instance } = agent({
      handle: async (data, opts) => {
        handled.push([data, opts]);
        return { type: 'response', id: 'r1', status: 201, headers: {}, body: '{}' };
      },
    });
    instance.start();
    last().emit('open');
    last().emit('message', { data: 'pong' });
    last().emit('message', { data: '{"type":"request","id":"r1"}' });
    await flush();

    assert.equal(handled.length, 1);
    assert.deepEqual(handled[0][1], { apiOrigin: 'http://127.0.0.1:8080', token: 'agent-secret' });
    assert.deepEqual(JSON.parse(last().sent[0]), { type: 'response', id: 'r1', status: 201, headers: {}, body: '{}' });
    instance.stop();
  });

  test('sends ping every 25 s and reconnects when no pong arrives within 10 s', () => {
    const { instance, lines } = agent();
    instance.start();
    const first = last();
    first.emit('open');

    mock.timers.tick(25_000);
    assert.deepEqual(first.sent, ['ping']);
    first.emit('message', { data: 'pong' });
    mock.timers.tick(10_000);
    assert.equal(FakeWebSocket.instances.length, 1, 'pong in time keeps the connection');

    mock.timers.tick(15_000);
    assert.deepEqual(first.sent, ['ping', 'ping']);
    mock.timers.tick(10_000);
    assert.ok(first.closed, 'missing pong closes the socket');
    assert.ok(lines.some(line => line.includes('心跳超时')));

    mock.timers.tick(1_000);
    assert.equal(FakeWebSocket.instances.length, 2, 'reconnects after 1 s');
    instance.stop();
  });

  test('backs off 1, 2, 4 … 30 s while failing and resets after a successful connection', () => {
    const { instance, lines } = agent();
    instance.start();
    const delays = [];
    for (let i = 0; i < 7; i += 1) {
      const count = FakeWebSocket.instances.length;
      last().emit('close', { code: 1006 });
      let waited = 0;
      while (FakeWebSocket.instances.length === count) {
        mock.timers.tick(1_000);
        waited += 1;
      }
      delays.push(waited);
    }
    assert.deepEqual(delays, [1, 2, 4, 8, 16, 30, 30]);
    assert.ok(lines.some(line => line.includes('AGENT_TOKEN')), 'never-opened failure hints at the token');

    last().emit('open');
    last().emit('close', { code: 1006 });
    mock.timers.tick(1_000);
    assert.equal(FakeWebSocket.instances.length, 9, 'backoff resets to 1 s after a successful open');
    instance.stop();
  });

  test('stops for good when replaced by a newer agent (close code 4000)', () => {
    const { instance, events } = agent();
    instance.start();
    last().emit('open');
    last().emit('close', { code: 4000 });
    mock.timers.tick(60_000);
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.deepEqual(events, ['replaced']);
  });

  test('stop() closes the socket and prevents reconnection', () => {
    const { instance } = agent();
    instance.start();
    const socket = last();
    socket.emit('open');
    instance.stop();
    assert.equal(socket.closed.code, 1000);
    socket.emit('close', { code: 1000 });
    mock.timers.tick(60_000);
    assert.equal(FakeWebSocket.instances.length, 1);
  });
});
