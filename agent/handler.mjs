// Turns one request frame from the relay into an HTTP call to the local intranet API.
// The agent only calls apiOrigin, only for the gateway's whitelisted routes, and adds the
// AGENT_TOKEN itself, so a forged relay cannot use it to reach anything else on this machine.

export const AGENT_UPSTREAM_TIMEOUT_MS = 8_000;
// A WebSocket message is limited to 1 MiB on Cloudflare; leave room for the frame envelope.
export const MAX_RESPONSE_BYTES = 512 * 1024;

const COLLECTION_PATH = /^\/api\/todos$/;
const ITEM_PATH = /^\/api\/todos\/[1-9][0-9]{0,15}$/;
const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'location'];

function allowedMethods(pathname) {
  if (COLLECTION_PATH.test(pathname)) return ['GET', 'POST'];
  if (ITEM_PATH.test(pathname)) return ['GET', 'PATCH', 'DELETE'];
  return [];
}

function errorReply(id, status, error, message) {
  return {
    type: 'response',
    id,
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ error, message }),
  };
}

function resolveTarget(path, apiOrigin) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  const url = new URL(path, apiOrigin);
  return url.origin === new URL(apiOrigin).origin ? url : null;
}

async function callApi(frame, url, { token, fetchImpl, timeoutMs }) {
  const { id, method } = frame;
  const headers = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = frame.headers?.[name];
    if (typeof value === 'string') headers[name] = value;
  }
  headers.authorization = `Bearer ${token}`;
  const hasBody = (method === 'POST' || method === 'PATCH') && typeof frame.body === 'string';

  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: hasBody ? frame.body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return error?.name === 'TimeoutError'
      ? errorReply(id, 504, 'upstream_timeout', '本机 API 响应超时')
      : errorReply(id, 502, 'upstream_unavailable', '本机 API 未启动或不可达');
  }

  const replyHeaders = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) replyHeaders[name] = value;
  }
  const body = response.status === 204 ? null : await response.text();
  if (body !== null && Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    return errorReply(id, 502, 'upstream_unavailable', '本机 API 响应过大');
  }
  return { type: 'response', id, status: response.status, headers: replyHeaders, body };
}

/** Returns a response frame for a request frame, or null for anything that is not a request frame. */
export async function handleRelayMessage(data, {
  apiOrigin,
  token,
  fetchImpl = fetch,
  timeoutMs = AGENT_UPSTREAM_TIMEOUT_MS,
  log = console.log,
} = {}) {
  let frame;
  try {
    frame = JSON.parse(data);
  } catch {
    return null;
  }
  if (frame?.type !== 'request' || typeof frame.id !== 'string') return null;

  const startedAt = Date.now();
  const url = resolveTarget(frame.path, apiOrigin);
  const reply = url && allowedMethods(url.pathname).includes(frame.method)
    ? await callApi(frame, url, { token, fetchImpl, timeoutMs })
    : errorReply(frame.id, 403, 'forbidden', 'agent 拒绝转发该请求');

  log(`${new Date().toISOString()} ${frame.method} ${url?.pathname ?? '-'} ${reply.status} ${Date.now() - startedAt}ms`);
  return reply;
}
