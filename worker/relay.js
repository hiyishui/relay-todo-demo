import { jsonResponse, tokenMatches } from './gateway.js';

export const RELAY_TIMEOUT_MS = 9_000;
export const AGENT_PATH = '/agent/connect';

const AGENT_TAG = 'agent';
const WS_OPEN = 1;
const RELAYED_REQUEST_HEADERS = ['content-type', 'accept'];
const RELAYED_RESPONSE_HEADERS = ['content-type', 'location'];

const unavailable = message => jsonResponse(502, { error: 'upstream_unavailable', message });

export function relayStub(env) {
  return env.RELAY.get(env.RELAY.idFromName('default'));
}

/** `/agent/connect`: authenticates the intranet agent's WebSocket upgrade and hands it to the relay object. */
export async function connectAgent(request, env, log = console.log) {
  const startedAt = Date.now();
  let response;
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    response = jsonResponse(426, { error: 'upgrade_required', message: '需要 WebSocket 连接' });
  } else if (!(await tokenMatches(request.headers.get('authorization'), env.AGENT_TOKEN))) {
    response = jsonResponse(401, { error: 'unauthorized', message: 'agent 口令无效' });
  } else if (!env.RELAY) {
    response = unavailable('网关未配置中继');
  } else {
    response = await relayStub(env).fetch(request);
  }
  log(`${new Date().toISOString()} ${request.method} ${AGENT_PATH} ${response.status} ${Date.now() - startedAt}ms`);
  return response;
}

/**
 * Durable Object that holds the agent's WebSocket and relays API requests over it.
 *
 * A single instance ("default") is used. Requests are sent as JSON frames and matched to the
 * agent's replies by id. The WebSocket Hibernation API lets an idle connection cost no duration,
 * and "ping" is answered by the runtime itself without waking the object. While a request is
 * pending the object stays active, so the in-memory `pending` map is safe.
 */
export class AgentRelay {
  constructor(ctx, env, {
    timeoutMs = RELAY_TIMEOUT_MS,
    createPair = () => Object.values(new WebSocketPair()),
    upgradeResponse = client => new Response(null, { status: 101, webSocket: client }),
  } = {}) {
    this.ctx = ctx;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.createPair = createPair;
    this.upgradeResponse = upgradeResponse;
    this.pending = new Map();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.acceptAgent();
    return this.relay(request);
  }

  acceptAgent() {
    for (const old of this.ctx.getWebSockets(AGENT_TAG)) {
      try {
        old.close(4000, 'replaced by a newer agent');
      } catch {
        // Already closing.
      }
    }
    const [client, server] = this.createPair();
    this.ctx.acceptWebSocket(server, [AGENT_TAG]);
    return this.upgradeResponse(client);
  }

  async relay(request) {
    const agent = this.ctx.getWebSockets(AGENT_TAG).filter(ws => ws.readyState === WS_OPEN).at(-1);
    if (!agent) return unavailable('内网服务不可达（agent 未连接）');

    const url = new URL(request.url);
    const headers = {};
    for (const name of RELAYED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    const hasBody = request.method === 'POST' || request.method === 'PATCH';
    const frame = {
      type: 'request',
      id: crypto.randomUUID(),
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers,
      body: hasBody ? await request.text() : null,
    };

    const response = new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        resolve(jsonResponse(504, { error: 'upstream_timeout', message: '内网服务响应超时' }));
      }, this.timeoutMs);
      this.pending.set(frame.id, { resolve, timer, ws: agent });
    });
    try {
      agent.send(JSON.stringify(frame));
    } catch {
      this.settle(frame.id, unavailable('内网服务不可达（agent 连接已断开）'));
    }
    return response;
  }

  settle(id, response) {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(response);
  }

  failPendingOn(ws) {
    for (const [id, entry] of this.pending) {
      if (entry.ws === ws) this.settle(id, unavailable('内网服务不可达（agent 连接已断开）'));
    }
  }

  webSocketMessage(ws, data) {
    if (typeof data !== 'string') return;
    let frame;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (frame?.type !== 'response' || typeof frame.id !== 'string' || !this.pending.has(frame.id)) return;
    if (!Number.isInteger(frame.status) || frame.status < 200 || frame.status > 599) {
      this.settle(frame.id, unavailable('agent 返回了无效响应'));
      return;
    }
    const headers = new Headers();
    for (const name of RELAYED_RESPONSE_HEADERS) {
      const value = frame.headers?.[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    const body = frame.status === 204 || frame.status === 304 ? null : (frame.body ?? '');
    this.settle(frame.id, new Response(body, { status: frame.status, headers }));
  }

  webSocketClose(ws) {
    this.failPendingOn(ws);
    try {
      ws.close();
    } catch {
      // The runtime may already have completed the close handshake.
    }
  }

  webSocketError(ws) {
    this.failPendingOn(ws);
  }
}
