const TOKEN_KEY = 'chuangda_admin_token';

function token() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(value) {
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function api(path, options = {}) {
  const headers = {};
  let body;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (token()) headers.Authorization = 'Bearer ' + token();
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    setToken('');
    const error = new Error((data.error && data.error.message) || '请先登录');
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const error = new Error((data.error && data.error.message) || '请求失败');
    error.status = response.status;
    throw error;
  }
  return data;
}
