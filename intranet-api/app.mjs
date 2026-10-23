import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_TITLE_LENGTH = 200;
export const MAX_TODOS = 1000;
export const LIST_LIMIT = 200;

const COLLECTION_PATH = /^\/api\/todos$/;
const ITEM_PATH = /^\/api\/todos\/([1-9][0-9]{0,15})$/;
const ALLOWED_FIELDS = new Set(['title', 'completed']);

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      completed   INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos (created_at DESC, id DESC);
  `);
  return db;
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function tokenMatches(header, expected) {
  const token = /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '';
  // Comparing fixed-length digests keeps the check constant-time even when lengths differ.
  return Boolean(token) && timingSafeEqual(digest(token), digest(expected));
}

function toTodo(row) {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function route(pathname, method) {
  const allowed = COLLECTION_PATH.test(pathname)
    ? ['GET', 'POST']
    : ITEM_PATH.test(pathname)
      ? ['GET', 'PATCH', 'DELETE']
      : null;
  if (!allowed) throw new HttpError(404, 'not_found', '接口不存在');
  if (!allowed.includes(method)) {
    throw new HttpError(405, 'method_not_allowed', '不支持该请求方法', { Allow: allowed.join(', ') });
  }
  const idText = ITEM_PATH.exec(pathname)?.[1];
  if (idText === undefined) return { id: null };
  const id = Number(idText);
  if (!Number.isSafeInteger(id)) throw new HttpError(404, 'not_found', '记录不存在');
  return { id };
}

async function readJsonObject(req) {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^application\/json(\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type 必须是 application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', '请求体不能超过 16 KB');
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', '请求体必须是合法的 JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_json', '请求体必须是 JSON 对象');
  }
  return body;
}

function validationError(message) {
  return new HttpError(400, 'validation_error', message);
}

export function validateInput(body, { partial }) {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) throw validationError(`未知字段 ${key}`);
  }
  const result = {};
  if ('title' in body || !partial) {
    if (typeof body.title !== 'string') throw validationError('标题必须是字符串');
    const title = body.title.trim();
    const length = [...title].length;
    if (length < 1 || length > MAX_TITLE_LENGTH) {
      throw validationError(`标题长度必须在 1 到 ${MAX_TITLE_LENGTH} 个字符之间`);
    }
    result.title = title;
  }
  if ('completed' in body) {
    if (typeof body.completed !== 'boolean') throw validationError('completed 必须是布尔值');
    result.completed = body.completed;
  }
  if (partial && Object.keys(result).length === 0) throw validationError('至少需要修改 title 或 completed 中的一个字段');
  return result;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function createHandler({ db, token, now = () => new Date(), log = console.log }) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('token is required');

  const statements = {
    list: db.prepare('SELECT * FROM todos ORDER BY created_at DESC, id DESC LIMIT ?'),
    get: db.prepare('SELECT * FROM todos WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS total FROM todos'),
    insert: db.prepare('INSERT INTO todos (title, completed, created_at, updated_at) VALUES (?, ?, ?, ?)'),
    remove: db.prepare('DELETE FROM todos WHERE id = ?'),
  };

  function findTodo(id) {
    const row = statements.get.get(id);
    if (!row) throw new HttpError(404, 'not_found', '记录不存在');
    return row;
  }

  async function dispatch(req, res, pathname) {
    const { id } = route(pathname, req.method);
    if (!tokenMatches(req.headers.authorization, token)) {
      throw new HttpError(401, 'unauthorized', 'agent 口令无效');
    }

    if (id === null && req.method === 'GET') {
      return sendJson(res, 200, { items: statements.list.all(LIST_LIMIT).map(toTodo) });
    }
    if (id === null && req.method === 'POST') {
      const input = validateInput(await readJsonObject(req), { partial: false });
      if (statements.count.get().total >= MAX_TODOS) {
        throw validationError(`已达 demo 上限 ${MAX_TODOS} 条，请先删除部分待办`);
      }
      const timestamp = now().toISOString();
      const { lastInsertRowid } = statements.insert.run(input.title, input.completed ? 1 : 0, timestamp, timestamp);
      const created = toTodo(findTodo(Number(lastInsertRowid)));
      return sendJson(res, 201, created, { Location: `/api/todos/${created.id}` });
    }
    if (req.method === 'GET') {
      return sendJson(res, 200, toTodo(findTodo(id)));
    }
    if (req.method === 'PATCH') {
      const input = validateInput(await readJsonObject(req), { partial: true });
      findTodo(id);
      const assignments = [];
      const values = [];
      if ('title' in input) {
        assignments.push('title = ?');
        values.push(input.title);
      }
      if ('completed' in input) {
        assignments.push('completed = ?');
        values.push(input.completed ? 1 : 0);
      }
      assignments.push('updated_at = ?');
      values.push(now().toISOString(), id);
      db.prepare(`UPDATE todos SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
      return sendJson(res, 200, toTodo(findTodo(id)));
    }
    const { changes } = statements.remove.run(id);
    if (changes === 0) throw new HttpError(404, 'not_found', '记录不存在');
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }

  return async function handle(req, res) {
    const startedAt = Date.now();
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    res.on('finish', () => {
      log(`${new Date().toISOString()} ${req.method} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`);
    });
    try {
      await dispatch(req, res, pathname);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.code, message: error.message }, error.headers);
        // Drain any unread request body so the connection can be reused after an early error.
        req.resume();
        return;
      }
      console.error('内网 API 内部错误:', error?.message ?? error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error', message: '服务器内部错误' });
      else res.end();
    }
  };
}
