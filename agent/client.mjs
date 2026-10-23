import { handleRelayMessage } from './handler.mjs';

export const HEARTBEAT_MS = 25_000;
export const PONG_TIMEOUT_MS = 10_000;
export const MIN_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 30_000;
// Close code the relay uses when a newer agent takes over.
export const REPLACED_CLOSE_CODE = 4000;

/**
 * Keeps one outbound WebSocket to the relay open: authenticates with the agent token, answers
 * request frames, sends heartbeats (corporate proxies drop idle connections silently) and
 * reconnects with exponential backoff.
 */
export function createAgent({
  relayUrl,
  token,
  apiOrigin,
  WebSocketImpl = globalThis.WebSocket,
  handle = handleRelayMessage,
  log = message => console.log(`${new Date().toISOString()} ${message}`),
  onReplaced = () => {},
}) {
  const OPEN = WebSocketImpl.OPEN ?? 1;
  let socket = null;
  let retryMs = MIN_RETRY_MS;
  let heartbeat = null;
  let pongTimer = null;
  let reconnectTimer = null;
  let stopped = false;

  function stopHeartbeat() {
    clearInterval(heartbeat);
    clearTimeout(pongTimer);
    heartbeat = null;
    pongTimer = null;
  }

  function scheduleReconnect(reason) {
    stopHeartbeat();
    socket = null;
    if (stopped || reconnectTimer) return;
    log(`${reason}，${retryMs / 1000} 秒后重连`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  }

  function connect() {
    log(`正在连接中继 ${relayUrl}`);
    const ws = new WebSocketImpl(relayUrl, { headers: { Authorization: `Bearer ${token}` } });
    socket = ws;
    let opened = false;

    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      opened = true;
      retryMs = MIN_RETRY_MS;
      log(`已连接中继，请求将转发到 ${apiOrigin}`);
      heartbeat = setInterval(() => {
        ws.send('ping');
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => {
          if (socket !== ws) return;
          ws.close(4001, 'heartbeat timeout');
          scheduleReconnect('心跳超时');
        }, PONG_TIMEOUT_MS);
      }, HEARTBEAT_MS);
    });

    ws.addEventListener('message', async event => {
      if (socket !== ws) return;
      if (event.data === 'pong') {
        clearTimeout(pongTimer);
        return;
      }
      const reply = await handle(event.data, { apiOrigin, token });
      if (reply && ws.readyState === OPEN) ws.send(JSON.stringify(reply));
    });

    ws.addEventListener('close', event => {
      if (socket !== ws) return;
      if (event.code === REPLACED_CLOSE_CODE) {
        stopped = true;
        stopHeartbeat();
        socket = null;
        log('已有新的 agent 连接到中继，本 agent 停止');
        onReplaced();
        return;
      }
      scheduleReconnect(opened
        ? `与中继的连接断开（code ${event.code}）`
        : '连接中继失败（请检查网络、RELAY_URL，以及 .env 中的 AGENT_TOKEN 是否与已部署的一致）');
    });

    // An 'error' event is always followed by 'close', which handles reconnection.
    ws.addEventListener('error', () => {});
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      stopHeartbeat();
      socket?.close(1000, 'agent stopped');
      socket = null;
    },
  };
}
