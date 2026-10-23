// Minimal stand-ins for the Workers-only APIs used by worker/relay.js (Durable Object state, WebSocket).

globalThis.WebSocketRequestResponsePair ??= class {
  constructor(request, response) {
    this.request = request;
    this.response = response;
  }
};

export function fakeCtx(sockets = []) {
  return {
    sockets,
    tags: new Map(),
    autoResponse: null,
    setWebSocketAutoResponse(pair) {
      this.autoResponse = pair;
    },
    getWebSockets() {
      return [...this.sockets];
    },
    acceptWebSocket(ws, tags = []) {
      this.sockets.push(ws);
      this.tags.set(ws, tags);
    },
  };
}

export function fakeSocket(onSend = () => {}) {
  return {
    readyState: 1,
    sent: [],
    closedWith: null,
    send(data) {
      this.sent.push(data);
      onSend(data);
    },
    close(code, reason) {
      this.readyState = 3;
      this.closedWith = { code, reason };
    },
  };
}

// Replaces `new WebSocketPair()` and the 101 response, which Node's Response does not allow.
export function fakeUpgrade() {
  const created = [];
  return {
    created,
    createPair: () => {
      const pair = { client: fakeSocket(), server: fakeSocket() };
      created.push(pair);
      return [pair.client, pair.server];
    },
    upgradeResponse: client => ({ status: 101, webSocket: client }),
  };
}
