const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

const dataFile = path.join(os.tmpdir(), `chuangda-review-mode-${process.pid}.json`);
process.env.DATA_FILE = dataFile;
process.env.STORAGE_DRIVER = 'json';
process.env.NODE_ENV = 'test';
process.env.SKIP_WECHAT_AUTH = 'true';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'admin123';
process.env.REVIEW_TEST_MODE = 'true';
delete process.env.DATABASE_URL;

const { app } = require('../server');

let server;
let base;

async function api(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

test.before(async () => {
  fs.rmSync(dataFile, { force: true });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataFile, { force: true });
});

test('review mode creates an isolated company and approves it without an admin action', async () => {
  const hq = await api('/api/login', {
    method: 'POST', body: { username: 'admin', password: 'admin123' },
  });
  assert.equal(hq.status, 200);

  const companies = await api('/api/companies', { token: hq.json.token });
  const reviewCompany = companies.json.items.find((item) => item.id === 'review-test');
  assert.ok(reviewCompany);
  assert.equal(reviewCompany.name, '测试认证企业');
  assert.equal(Object.prototype.hasOwnProperty.call(reviewCompany, 'certCode'), false);

  const reviewAdmin = await api('/api/login', {
    method: 'POST', body: { username: '123csmp', password: '123csmp' },
  });
  assert.equal(reviewAdmin.status, 200);
  assert.equal(reviewAdmin.json.scope, 'company');
  assert.equal(reviewAdmin.json.companyId, 'review-test');

  const employee = await api('/api/auth/wechat', {
    method: 'POST', body: { code: 'dev:review-mode-user' },
  });
  assert.equal(employee.status, 200);
  const token = employee.json.token;

  const applied = await api('/api/employee/certification', {
    method: 'POST', token, body: { companyId: 'review-test' },
  });
  assert.equal(applied.status, 201);
  assert.equal(applied.json.application.status, 'approved');
  assert.equal(applied.json.autoApproved, true);

  const status = await api('/api/employee/certification', { token });
  assert.equal(status.json.certified.some((item) => item.companyId === 'review-test'), true);
  assert.equal(status.json.pending.some((item) => item.companyId === 'review-test'), false);

  const templates = await api('/api/employee/templates', { token });
  const reviewTemplates = templates.json.items.filter((item) => item.companyId === 'review-test');
  assert.deepEqual(reviewTemplates.map((item) => item.id).sort(), ['classic', 'horizon', 'wave']);

  const codeOnly = await api('/api/employee/certification', {
    method: 'POST', token, body: { code: 'LEGACY' },
  });
  assert.equal(codeOnly.status, 400);
});

test('turning review mode off hides the test enterprise and disables its admin', async () => {
  process.env.REVIEW_TEST_MODE = 'false';
  try {
    const employee = await api('/api/auth/wechat', {
      method: 'POST', body: { code: 'dev:review-mode-off-user' },
    });
    const companies = await api('/api/employee/companies', { token: employee.json.token });
    assert.equal(companies.json.items.some((item) => item.id === 'review-test'), false);

    const login = await api('/api/login', {
      method: 'POST', body: { username: '123csmp', password: '123csmp' },
    });
    assert.equal(login.status, 401);
  } finally {
    process.env.REVIEW_TEST_MODE = 'true';
  }
});
