export const MAX_BODY_BYTES = 16 * 1024;
export const UPSTREAM_TIMEOUT_MS = 10_000;

const COLLECTION_PATH = /^\/api\/todos$/;
const ITEM_PATH = /^\/api\/todos\/[1-9][0-9]{0,15}$/;
const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'location'];
// Only the path and query reach the intranet API (through the relay and the agent); the host is a placeholder.
const UPSTREAM_ORIGIN = 'http://intranet-api';

class GatewayError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function allowedMethods(pathname) {
  if (COLLECTION_PATH.test(pathname)) return ['GET', 'POST'];
  if (ITEM_PATH.test(pathname)) return ['GET', 'PATCH', 'DELETE'];
  return null;
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Compares SHA-256 digests byte by byte so the time taken does not depend on where the tokens differ.
export async function tokenMatches(header, expected) {
  const token = /^Bearer (.+)$/i.exec(header ?? '')?.[1] ?? '';
  if (!token || typeof expected !== 'string' || !expected) return false;
  const [a, b] = await Promise.all([sha256(token), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function readLimitedBody(request) {
  if (!request.body) return new Uint8Array();
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new GatewayError(413, 'payload_too_large', '请求体不能超过 16 KB');
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new GatewayError(413, 'payload_too_large', '请求体不能超过 16 KB');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function callUpstream(upstream, url, init, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new GatewayError(504, 'upstream_timeout', '内网服务响应超时')), timeoutMs);
  });
  try {
    return await Promise.race([upstream.fetch(url, init), timeout]);
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(502, 'upstream_unavailable', '内网服务不可达');
  } finally {
    clearTimeout(timer);
  }
}

async function proxy(request, { accessToken, upstream }, { timeoutMs }) {
  const url = new URL(request.url);
  const methods = allowedMethods(url.pathname);
  if (!methods) throw new GatewayError(404, 'not_found', '接口不存在');
  if (!methods.includes(request.method)) {
    throw new GatewayError(405, 'method_not_allowed', '不支持该请求方法', { Allow: methods.join(', ') });
  }
  if (!(await tokenMatches(request.headers.get('authorization'), accessToken))) {
    throw new GatewayError(401, 'unauthorized', '口令无效');
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init = { method: request.method, headers };
  if (request.method === 'POST' || request.method === 'PATCH') {
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^application\/json(\s*;|$)/i.test(contentType)) {
      throw new GatewayError(415, 'unsupported_media_type', 'Content-Type 必须是 application/json');
    }
    init.body = await readLimitedBody(request);
  }
  if (!upstream) throw new GatewayError(502, 'upstream_unavailable', '网关未配置中继');

  const response = await callUpstream(upstream, `${UPSTREAM_ORIGIN}${url.pathname}${url.search}`, init, timeoutMs);
  const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const body = response.status === 204 ? null : response.body;
  return new Response(body, { status: response.status, headers: responseHeaders });
}

/**
 * Validates a browser API request and forwards it to `upstream` (the relay Durable Object).
 * Everything that can be rejected here is rejected before it costs a Durable Object request.
 */
export async function handleRequest(request, { accessToken, upstream }, { log = console.log, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const { pathname } = new URL(request.url);
  let response;
  try {
    response = await proxy(request, { accessToken, upstream }, { timeoutMs });
  } catch (error) {
    if (!(error instanceof GatewayError)) {
      log(`${new Date().toISOString()} gateway_error ${error?.name ?? 'Error'}`);
      error = new GatewayError(500, 'internal_error', '网关内部错误');
    }
    response = jsonResponse(error.status, { error: error.code, message: error.message }, error.headers);
  }
  log(`${new Date().toISOString()} ${request.method} ${pathname} ${response.status} ${Date.now() - startedAt}ms`);
  return response;
}
