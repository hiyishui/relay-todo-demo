const TOKEN_KEY = 'relay-todo-demo.token';

const $ = id => document.getElementById(id);
const els = {
  status: $('status'),
  tokenForm: $('token-form'),
  tokenInput: $('token-input'),
  app: $('app'),
  logout: $('logout'),
  newForm: $('new-form'),
  newTitle: $('new-title'),
  list: $('list'),
  empty: $('empty'),
  count: $('count'),
  refresh: $('refresh'),
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const getToken = () => localStorage.getItem(TOKEN_KEY);

function showStatus(message, kind = 'error') {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
  els.status.hidden = false;
}

function clearStatus() {
  els.status.hidden = true;
  els.status.textContent = '';
}

function showLogin(message) {
  els.app.hidden = true;
  els.logout.hidden = true;
  els.tokenForm.hidden = false;
  els.tokenInput.value = '';
  els.tokenInput.focus();
  if (message) showStatus(message);
}

function showApp() {
  els.tokenForm.hidden = true;
  els.app.hidden = false;
  els.logout.hidden = false;
}

function messageFor(status, body) {
  switch (status) {
    case 400: return body?.message || '请求参数不正确';
    case 404: return '记录不存在，可能已被删除';
    case 413:
    case 415: return '请求格式不正确';
    case 429: return '今日免费额度已用完，北京时间 08:00 恢复';
    case 502:
    case 504: return '内网服务不可达，请确认本机已运行 npm start';
    default: return body?.message || `请求失败（${status}）`;
  }
}

async function api(method, path, body) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${getToken()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, '网络异常，请稍后重试');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    showLogin('口令无效，请重新输入');
    throw new ApiError(401, '口令无效，请重新输入');
  }
  if (!response.ok) throw new ApiError(response.status, messageFor(response.status, data));
  return data;
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    showStatus(error.message || '操作失败');
    if (error instanceof ApiError && error.status === 404) await loadTodos().catch(() => {});
  }
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function renderTodo(todo) {
  const item = document.createElement('li');
  item.className = todo.completed ? 'item done' : 'item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = todo.completed;
  checkbox.setAttribute('aria-label', '切换完成状态');
  checkbox.addEventListener('change', () => run(async () => {
    await api('PATCH', `/api/todos/${todo.id}`, { completed: checkbox.checked });
    await loadTodos();
  }));

  const content = document.createElement('div');
  content.className = 'content';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = todo.title;
  const meta = document.createElement('small');
  meta.className = 'muted';
  meta.textContent = `更新于 ${formatTime(todo.updatedAt)}`;
  content.append(title, meta);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'link';
  edit.textContent = '编辑';
  edit.addEventListener('click', () => startEdit(content, title, todo));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link danger';
  remove.textContent = '删除';
  remove.addEventListener('click', () => {
    if (!confirm(`删除“${todo.title}”？`)) return;
    run(async () => {
      await api('DELETE', `/api/todos/${todo.id}`);
      await loadTodos();
    });
  });

  item.append(checkbox, content, edit, remove);
  return item;
}

function startEdit(content, title, todo) {
  const input = document.createElement('input');
  input.value = todo.title;
  input.maxLength = 200;
  input.className = 'edit';
  let finished = false;
  const finish = async save => {
    if (finished) return;
    finished = true;
    const next = input.value.trim();
    if (!save || next === todo.title) {
      input.replaceWith(title);
      return;
    }
    await run(async () => {
      await api('PATCH', `/api/todos/${todo.id}`, { title: next });
      clearStatus();
    });
    await run(loadTodos);
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(false));
  title.replaceWith(input);
  input.focus();
  input.select();
}

let loadSequence = 0;

async function loadTodos() {
  const sequence = ++loadSequence;
  const { items } = await api('GET', '/api/todos');
  // A slower, older response must not overwrite the result of a newer load.
  if (sequence !== loadSequence) return;
  els.list.replaceChildren(...items.map(renderTodo));
  els.empty.hidden = items.length > 0;
  const done = items.filter(todo => todo.completed).length;
  els.count.textContent = `共 ${items.length} 条，已完成 ${done} 条`;
}

els.tokenForm.addEventListener('submit', event => {
  event.preventDefault();
  const token = els.tokenInput.value.trim();
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  clearStatus();
  showApp();
  run(loadTodos);
});

els.newForm.addEventListener('submit', event => {
  event.preventDefault();
  const title = els.newTitle.value.trim();
  if (!title) return;
  run(async () => {
    await api('POST', '/api/todos', { title });
    els.newTitle.value = '';
    clearStatus();
    await loadTodos();
  });
});

els.refresh.addEventListener('click', () => run(async () => {
  await loadTodos();
  clearStatus();
}));

els.logout.addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  els.list.replaceChildren();
  clearStatus();
  showLogin();
});

if (getToken()) {
  showApp();
  run(loadTodos);
} else {
  showLogin();
}
